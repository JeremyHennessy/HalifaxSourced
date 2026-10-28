// Reusable manual review producer. Nothing here publishes, activates a schedule or uses AI.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {join,isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {digest,locationContract} from './weather-aggregation.mjs';
import {normalizeGfsDecoded,aggregateIssuedArchive} from './weather-model-archive.mjs';
import {normalizeEcmwfDecoded,extractReviewedListing} from './weather-ecmwf-adapter.mjs';
import {reviewedModelRegistry,validateModelManifest,REFRESH_ADMISSION_REVIEW_ID} from './weather-model-publication.mjs';
import {parseRobotsPolicy} from './robots-policy.mjs';
import {openRefreshRun,bootstrapRefreshState,sha256,jsonBytes,readPrivate} from './weather-model-refresh-state.mjs';
import {createRefreshTransport,transientDisposition,RefreshStop} from './weather-model-refresh-transport.mjs';
import {REFRESH_SOURCE_CONTRACTS,nextGfsListing,nextIfsListing,selectMatchingTargets,buildGfsFieldRequest,buildIfsRangeRequest} from './weather-model-discovery.mjs';
const root=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const codeFiles=['scripts/refresh-weather-models.mjs','scripts/review-weather-model-refresh.mjs','scripts/lib/weather-model-refresh-publication.mjs','scripts/lib/weather-publication.mjs','scripts/lib/weather-grib-replay.mjs','scripts/lib/link-access-policy.mjs','scripts/lib/weather-review-journal.mjs','scripts/lib/weather-model-publication.mjs','scripts/lib/eccc-weather.mjs','data/source-quarantine.json','scripts/lib/weather-model-refresh.mjs','scripts/lib/weather-model-refresh-state.mjs','scripts/lib/weather-model-refresh-transport.mjs','scripts/lib/weather-model-discovery.mjs','scripts/lib/weather-model-archive.mjs','scripts/lib/weather-aggregation.mjs','scripts/lib/weather-ecmwf-adapter.mjs','scripts/weather/decode-gfs-temperature.py','scripts/weather/requirements-eccodes-reviewed.txt','scripts/lib/fetch-public-source.mjs','scripts/lib/source-access-state.mjs','scripts/lib/robots-policy.mjs','source-integrity.js','data/source-link-access-holds.json'];
export async function refreshInputs(){
 const registry=JSON.parse(await fs.readFile(join(root,'data/weather-model-registry.json'))),locations=JSON.parse(await fs.readFile(join(root,'data/weather-locations.json'))),policy=JSON.parse(await fs.readFile(join(root,'data/weather-model-refresh-policy.json')));
 assert.equal(policy.admissionReviewId,REFRESH_ADMISSION_REVIEW_ID);assert.equal(policy.version,1);assert.equal(policy.kind,'manual_halifax_model_refresh_policy');assert.equal(policy.scheduleEnabled,false);assert.deepEqual(policy.sourceIds,['noaa','ecmwf']);assert.deepEqual(policy.modelIds,['gfs','ecmwf_ifs']);assert.deepEqual(policy.pointIds,['halifax_peninsula','bedford','dartmouth']);assert.equal(policy.minimumCadenceMinutes,55);assert.equal(policy.maxTargets,5);assert.equal(policy.futureWindowHours,24);assert.equal(policy.variable,'temperature_2m');assert.equal(policy.unit,'C');assert.equal(policy.publication,'review_only_no_public_artifact_writes');assert.equal(registry.liveCollectionEnabled,false);
 const code=Object.fromEntries(await Promise.all(codeFiles.map(async p=>[p,sha256(await fs.readFile(join(root,p)))])));
 const manifestBytes=await fs.readFile(join(root,'weather-evidence/current.json')),manifest=validateModelManifest(JSON.parse(manifestBytes));assert.match(manifest.archivePath,/^weather-evidence\/issuances\/[a-f0-9]{64}\.json$/);const archiveBytes=await readPrivate(join(root,manifest.archivePath));assert.equal(sha256(archiveBytes),manifest.archiveSha256);const baselineSha256=sha256(manifestBytes),baseline={kind:'accepted_publication_baseline',manifestSha256:baselineSha256,archiveSha256:manifest.archiveSha256,archivePath:manifest.archivePath,issuedAt:JSON.parse(archiveBytes).issuedAt,...(manifest.version===2?{refreshReceipt:manifest.refreshReceipt,lastAttempt:manifest.lastAttempt}:{})};
 return {registry,locations,policy,policySha256:digest({policy,registry,locations,code}),baselineSha256,baseline};
}
export function candidateRegistry(registry,policy){const r=reviewedModelRegistry(registry);for(const s of r.sources)if(policy.sourceIds.includes(s.id))s.acceptedAdmissionReviewIds=[...new Set([...s.acceptedAdmissionReviewIds,policy.admissionReviewId])];return r;}
function metadataEvidence(page){return {url:page.url,status:page.status,attemptedAt:page.attemptedAt,headersReceivedAt:page.headersReceivedAt,completedAt:page.completedAt,bodyBase64:page.body.toString('base64'),bodyBytes:page.body.length,bodySha256:page.bodySha256};}
const cachedRecord=page=>Object.fromEntries(['url','sourceId','kind','attemptedAt','headersReceivedAt','completedAt','status','headers','requestedRange','bodySha256','bodyBytes','complete'].map(k=>[k,page[k]]));
export async function decodeRefreshField({bodyPath,sourceId,points,python,directory}){
 assert.ok(isAbsolute(python),'explicit reviewed isolated WEATHER_GRIB_PYTHON is required');
 const pointPath=join(directory,'decoder-points.json');try{await fs.writeFile(pointPath,jsonBytes(points),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;assert.deepEqual(JSON.parse(await readPrivate(pointPath,4096)),points);}
 const r=await promisify(execFile)(python,['-I',join(root,'scripts/weather/decode-gfs-temperature.py'),bodyPath,pointPath,sourceId==='noaa'?'gfs':'ecmwf_ifs'],{cwd:directory,timeout:15000,maxBuffer:1024*1024});return JSON.parse(r.stdout);
}
export function archiveFromCaptures(captures,validTimes,{registry,locations,policy,issuedAt}){
 const r=candidateRegistry(registry,policy),points=[...locationContract(locations).values()].filter(p=>policy.pointIds.includes(p.id));
 const targets=validTimes.flatMap(valid=>points.map(p=>({locationId:p.id,variable:'temperature_2m',unit:'C',validStart:valid,validEnd:valid,eventDefinition:null})));
 const rows=captures.flatMap(c=>c.sourceId==='noaa'?normalizeGfsDecoded(c.decoded,c.receipt,{locations}):normalizeEcmwfDecoded(c.decoded,c.receipt,{locations}));
 const outcomes=policy.modelIds.flatMap(modelId=>targets.map(target=>{const selected=rows.filter(r=>r.modelId===modelId&&r.locationId===target.locationId&&Date.parse(r.validStart)===Date.parse(target.validStart));assert.equal(selected.length,1,'exact complete matched model/point/instant required');const row=selected[0];return {modelId,target,status:'complete',latestKnownModelReferenceTime:row.modelReferenceTime,knownAt:row.firstRetrievedAt,captureIds:[row.sourceBodySha256],rows:selected,reason:'Bounded reviewed-path manual refresh; software/model version still unverified'};}));
 const archive={version:1,kind:'review_only_halifax_model_archive',issuedAt,registrySha256:digest(r),locationsSha256:digest(locations),targets,captures,outcomes,minFamilies:2};
 const aggregation=aggregateIssuedArchive(archive,{registry:r,locations});assert.equal(aggregation.publicationAuthorized,false);return {archive,aggregation,registry:r};
}
export function requireCompleteRefreshAggregation(aggregation,expectedCells){assert.ok(aggregation.outputs.length===expectedCells&&aggregation.outputs.every(o=>o.prediction!==null&&o.availableFamilies.length===2&&o.availableFamilies.includes('gfs')&&o.availableFamilies.includes('ecmwf')),'matched model coverage expired or became ineligible at issuance');}

// A publication is not a state reset. Only the last complete candidate from this
// same immutable store can advance its baseline; unrelated edits still stop.
export async function verifyRefreshBaseline({directory,inputs,prior}){
 const known=prior.state?.acceptedBaselineSha256||prior.genesis.baselineSha256;
 if(inputs.baselineSha256===known)return;
 const previous=prior.state,proof=inputs.baseline.refreshReceipt,good=previous?.lastKnownGood;
 assert.ok(previous?.lastAttempt?.status==='success'&&good?.path&&proof,'accepted baseline changed; reviewed migration required');
 assert.equal(proof.kind,'reviewed_manual_model_refresh');assert.equal(proof.admissionReviewId,REFRESH_ADMISSION_REVIEW_ID);assert.equal(proof.policySha256,inputs.policySha256);assert.equal(proof.runNumber,previous.runNumber);
 assert.equal(proof.candidateSha256,good.sha256);assert.equal(proof.finalSha256,prior.predecessorFinalSha256);
 assert.equal(good.path,`runs/${String(previous.runNumber).padStart(6,'0')}/candidate.json`);
 const candidate=JSON.parse(await readPrivate(join(directory,good.path)));assert.equal(candidate.coverage,'complete');
 assert.equal(sha256(jsonBytes(candidate.archive)),inputs.baseline.archiveSha256);assert.equal(candidate.issuedAt,inputs.baseline.issuedAt);
 assert.deepEqual(inputs.baseline.lastAttempt,previous.lastAttempt);
 assert.ok(Date.parse(inputs.baseline.issuedAt)>=Date.parse(previous.acceptedBaselineIssuedAt||inputs.baseline.issuedAt),'baseline issuance rollback');
}
export async function bootstrapModelRefresh(directory,inputs,now=new Date().toISOString()){
 assert.equal(inputs.policy.enabled,true,'manual model bootstrap disabled pending review');const resolved=resolve(directory);assert.ok(isAbsolute(directory)&&!resolved.startsWith(root+'/')&&resolved!==root,'private durable store must be outside repository');
 await bootstrapRefreshState(resolved,{policySha256:inputs.policySha256,baselineSha256:inputs.baselineSha256,createdAt:now});
}
export async function collectModelRefresh({directory,inputs,python,now=()=>new Date().toISOString(),transportFactory=createRefreshTransport,decode=decodeRefreshField}){
 const {policy,locations,registry,policySha256}=inputs;assert.equal(policy.enabled,true,'manual model producer disabled pending review');assert.equal(policy.scheduleEnabled,false);assert.ok(isAbsolute(directory)&&!resolve(directory).startsWith(root+'/')&&resolve(directory)!==root,'outside-repository private store required');
 const attemptedAt=now(),run=await openRefreshRun(directory,{policySha256,now:attemptedAt}),transport=transportFactory({run,now});
 const previous=run.state,cache={...(previous?.metadataCache||{})},captures=[],fieldCache={},pages={};let outcome={disposition:'ready',reason:'complete',transientCount:0},candidate=null;
 const request=async descriptor=>{let cached=descriptor.kind==='field'?null:cache[descriptor.url]||null;if(descriptor.kind==='index'&&cached&&Date.parse(cached.attemptedAt)<Date.parse(pages.ecmwf.finalPage.completedAt))cached=null;const page=await transport.request({...descriptor,cached});if(descriptor.kind!=='field')cache[descriptor.url]=cachedRecord(page);return page;};
 try{
  await verifyRefreshBaseline({directory,inputs,prior:run});
  assert.ok(isAbsolute(python),'reviewed isolated interpreter required before source requests');
  const points=[...locationContract(locations).values()].filter(p=>policy.pointIds.includes(p.id)).map(p=>({id:p.id,latitude:p.latitude,longitude:p.longitude}));assert.equal(points.length,3);
  for(const sourceId of policy.sourceIds){
   const contract=REFRESH_SOURCE_CONTRACTS[sourceId],robotsPage=await request({sourceId,url:contract.robotsUrl,kind:'robots',maximumBytes:64*1024});
   const robots=[404,410].includes(robotsPage.status)?{state:'absent'}:parseRobotsPolicy(new TextDecoder('utf-8',{fatal:true}).decode(robotsPage.body));assert.ok(['absent','parsed'].includes(robots.state),'unavailable robots policy');
   let url=contract.rootUrl,result,page;const visited=new Set();
   for(let depth=0;depth<contract.maxListingPages;depth++){
    assert.ok(!visited.has(url),'listing cycle');visited.add(url);page=await request({sourceId,url,kind:'listing',maximumBytes:contract.listingByteLimit,robots});
    result=(sourceId==='noaa'?nextGfsListing:nextIfsListing)(page,{now:now()});if(result.kind!=='listing')break;url=result.url;
   }
   assert.ok(result&&result.kind!=='listing','listing traversal budget');if(result.kind==='unavailable'&&!['newest_listed_reference_is_stale'].includes(result.reason))throw new RefreshStop('unrecognized_or_incomplete_listing_'+result.reason);if(result.kind==='files'&&sourceId==='ecmwf'&&!result.listingProof)throw new RefreshStop('unrecognized_empty_IFS_listing');pages[sourceId]={...result,robots,finalPage:page};
  }
  const matching=selectMatchingTargets({gfs:pages.noaa,ifs:pages.ecmwf,now:now(),maxTargets:policy.maxTargets});await run.append({event:'actual_listed_target_selection',matching});
  if(!matching.targets.length)throw new RefreshStop(matching.reason||'no_matched_future_targets','partial');
  for(const target of matching.targets){
   for(const sourceId of policy.sourceIds){
    if(Date.parse(target.validTime)<=Date.parse(now()))throw new RefreshStop('target_expired_before_acquisition','partial');
    const field=sourceId==='noaa'?target.gfs:target.ifs;const age=Date.parse(now())-Date.parse(field.modelReferenceTime);if(age>=REFRESH_SOURCE_CONTRACTS[sourceId].maxReferenceAgeHours*3600000)throw new RefreshStop('model_reference_expired_during_run','partial');let descriptor,indexPage;
    if(sourceId==='noaa')descriptor=buildGfsFieldRequest(field,{now:now()});
    else{indexPage=await request({sourceId,url:field.indexUrl,kind:'index',maximumBytes:256*1024,robots:pages[sourceId].robots});if(Date.parse(field.validTime)<=Date.parse(now())||Date.parse(now())-Date.parse(field.modelReferenceTime)>=REFRESH_SOURCE_CONTRACTS[sourceId].maxReferenceAgeHours*3600000)throw new RefreshStop('local_forecast_freshness_elapsed_after_index','partial');descriptor=buildIfsRangeRequest(indexPage,field,{now:now(),listingProof:pages.ecmwf.listingProof});descriptor.range=descriptor.rangeHeader;}
    const key=digest({sourceId,url:descriptor.url,range:descriptor.range||null,metadataSha256:sourceId==='noaa'?field.listingBodySha256:indexPage.bodySha256});
    const retained=previous?.fieldCache?.[key];let capture;
    if(retained){capture=JSON.parse((await run.readBlob(retained)).toString('utf8'));capture.bodyBase64=(await run.readBlob(capture.id)).toString('base64');assert.equal(capture.sourceId,sourceId);assert.equal(capture.receipt.url,descriptor.url);assert.equal(Date.parse(capture.decoded.validAt),Date.parse(target.validTime));await run.append({event:'retained_exact_field_no_request_or_clock_change',sourceId,url:descriptor.url,bodySha256:capture.id,originalCompletedAt:capture.receipt.completedAt});}
    else{
     const response=await request({...descriptor,sourceId,kind:'field',maximumBytes:descriptor.maximumBytes,robots:pages[sourceId].robots});
     const decoded=await decode({bodyPath:join(directory,'blobs',response.bodySha256),sourceId,points,python,directory:run.directory});
     assert.equal(Date.parse(decoded.validAt),Date.parse(target.validTime));assert.equal(Date.parse(decoded.modelReferenceTime),Date.parse(field.modelReferenceTime));if(Date.parse(decoded.validAt)<=Date.parse(now()))throw new RefreshStop('decoded_target_expired_before_acceptance','partial');assert.deepEqual(decoded.points.map(p=>p.locationId).sort(),policy.pointIds.slice().sort());
     const receipt={version:1,kind:'reviewed_model_source_capture',sourceId,url:response.url,attemptedAt:response.attemptedAt,headersReceivedAt:response.headersReceivedAt,completedAt:response.completedAt,status:response.status,bodySha256:response.bodySha256,bodyBytes:response.bodyBytes,admissionReviewId:policy.admissionReviewId,decoderId:sourceId==='noaa'?'gfs-temperature-eccodes-v1':'ecmwf-ifs-temperature-eccodes-v1',decoderResultSha256:digest(decoded)};
     if(sourceId==='ecmwf')receipt.rangeEvidence={requestedRange:descriptor.range,contentRange:response.headers['content-range'],contentEncoding:'identity',index:metadataEvidence(indexPage),listing:extractReviewedListing(metadataEvidence(pages.ecmwf.finalPage))};
     capture={id:response.bodySha256,sourceId,bodyBase64:response.body.toString('base64'),receipt,decoded};
    }
    (sourceId==='noaa'?normalizeGfsDecoded:normalizeEcmwfDecoded)(capture.decoded,capture.receipt,{locations});captures.push(capture);const {bodyBase64,...captureMetadata}=capture;fieldCache[key]=await run.blob(jsonBytes(captureMetadata));
   }
  }
  const issuedAt=now();if(!matching.targets.every(t=>Date.parse(t.validTime)>Date.parse(issuedAt)))throw new RefreshStop('target_expired_before_issuance','partial');if(captures.some(c=>Date.parse(issuedAt)-Date.parse(c.decoded.modelReferenceTime)>=REFRESH_SOURCE_CONTRACTS[c.sourceId].maxReferenceAgeHours*3600000))throw new RefreshStop('model_reference_expired_before_issuance','partial');
  const result=archiveFromCaptures(captures,matching.targets.map(t=>t.validTime),{registry,locations,policy,issuedAt});
  requireCompleteRefreshAggregation(result.aggregation,matching.targets.length*3);
  candidate={kind:'review_only_model_refresh_candidate',version:1,publicationAuthorized:false,accuracyImprovementEstablished:false,policySha256,issuedAt,coverage:matching.status,missingTargets:matching.missingTargets,archive:result.archive,registry:result.registry,locations};
  const bytes=jsonBytes(candidate);assert.ok(bytes.length<=32*1024*1024,'candidate evidence byte budget');await fs.writeFile(join(run.directory,'candidate.json'),bytes,{flag:'wx',mode:0o600});const h=await fs.open(join(run.directory,'candidate.json'),'r');try{await h.sync();}finally{await h.close();}
  const body=sha256(bytes);candidate={path:`runs/${String(run.runNumber).padStart(6,'0')}/candidate.json`,sha256:body,issuedAt,coverage:matching.status};
  if(matching.status!=='complete')outcome={disposition:'ready',reason:'partial_matched_future_coverage',transientCount:0};
 }catch(error){
  if(error instanceof RefreshStop&&error.disposition==='backoff')outcome=transientDisposition(error.details.receipt,Buffer.from(error.details.bodyBase64,'base64'),previous?.transientCount||0);
  else if(error instanceof RefreshStop&&error.disposition==='partial')outcome={disposition:'ready',reason:error.message,transientCount:0};
  else outcome={disposition:'held',reason:error.message.slice(0,240),transientCount:previous?.transientCount||0};
  await run.append({event:'collection_stopped',...outcome});
 }
 await transport.drain();const completedAt=now();
 const selectedCache=Object.fromEntries(Object.entries(cache).sort((a,b)=>Date.parse(b[1].completedAt)-Date.parse(a[1].completedAt)).slice(0,32));
 const state={version:1,acceptedBaselineSha256:inputs.baselineSha256,acceptedBaselineIssuedAt:inputs.baseline.issuedAt,runNumber:run.runNumber,attemptedAt,completedAt,...outcome,nextAttemptNotBefore:outcome.disposition==='held'?null:outcome.nextAttemptNotBefore||new Date(Date.parse(completedAt)+policy.minimumCadenceMinutes*60000).toISOString(),lastAttempt:{status:outcome.disposition==='held'?'held':outcome.disposition==='backoff'?'failed':candidate?.coverage==='complete'?'success':'partial',attemptedAt,completedAt,reason:outcome.reason},metadataCache:selectedCache,fieldCache:Object.keys(fieldCache).length?fieldCache:previous?.fieldCache||{},candidate,lastKnownGood:candidate?.coverage==='complete'?candidate:previous?.lastKnownGood||inputs.baseline,stats:transport.stats(),publicationAuthorized:false};
 const final=await run.finish(state);return {state,final};
}
