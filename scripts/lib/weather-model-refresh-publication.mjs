// Local, model-only review boundary. No network, workflow/cache restore or activation.
// The exact private store is mandatory: hashes are not source-authorship proofs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {join,resolve,dirname,isAbsolute,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import {digest} from './weather-aggregation.mjs';
import {aggregateIssuedArchive} from './weather-model-archive.mjs';
import {extractReviewedListing} from './weather-ecmwf-adapter.mjs';
import {REFRESH_SOURCE_CONTRACTS,buildGfsFieldRequest,nextGfsListing,nextIfsListing,selectMatchingTargets} from './weather-model-discovery.mjs';
import {candidateRegistry,refreshInputs,requireCompleteRefreshAggregation} from './weather-model-refresh.mjs';
import {inspectRefreshState,readPrivate,jsonBytes,sha256} from './weather-model-refresh-state.mjs';
import {MODEL_MANIFEST,REFRESH_ADMISSION_REVIEW_ID,manifestModelRegistry,loadPublicModelProjection,publicModelProjection,publicModelBytes,validateModelManifest} from './weather-model-publication.mjs';
import {replayGribCaptures} from './weather-grib-replay.mjs';
import {parseRobotsPolicy,robotsPolicyAllows} from './robots-policy.mjs';
import {weatherCodeDigest} from './weather-publication.mjs';

export const MODEL_REFRESH_CONTRACT='review/model-refresh-publication.json';
export const MODEL_REFRESH_DATA_FILES=[MODEL_MANIFEST,'data/build/halifax-weather-models.json','data/weather-models.js'];
const MAX_PACKAGE_BYTES=34*1024*1024;
const configurationFiles=['data/weather-model-registry.json','data/weather-locations.json','data/weather-model-refresh-policy.json','data/source-quarantine.json','data/source-link-access-holds.json'];
const configurationDigest=async root=>digest(await Promise.all(configurationFiles.map(async path=>[path,sha256(await readPrivate(join(root,path)))])));
const exact=(value,fields)=>assert.deepEqual(Object.keys(value).sort(),fields.slice().sort(),'unexpected model refresh fields');
const withinClock=(candidate,state,clock)=>{const now=typeof clock==='function'?clock():clock;assert.ok(Number.isFinite(now)&&now>=Date.parse(state.completedAt),'future completed refresh cannot be accepted');assert.ok(candidate.archive.targets.every(t=>Date.parse(t.validStart)>now),'candidate target expired before publication');assert.ok(candidate.archive.captures.every(c=>now-Date.parse(c.decoded.modelReferenceTime)<REFRESH_SOURCE_CONTRACTS[c.sourceId].maxReferenceAgeHours*3600000),'model reference expired before publication');};
const absent=async path=>{try{await fs.lstat(path);assert.fail('unexpected existing file: '+path);}catch(error){if(error.code!=='ENOENT')throw error;}};
async function rootIdentity(directory){assert.ok(isAbsolute(directory),'absolute private store required');assert.equal(await fs.realpath(directory),resolve(directory),'symlinked private store prohibited');}
async function body(directory,hash,bytes){const result=await readPrivate(join(directory,'blobs',hash),8*1024*1024);assert.equal(sha256(result),hash);assert.equal(result.length,bytes);return result;}
const metadata=(receipt,bytes)=>Object.fromEntries([...['url','status','attemptedAt','headersReceivedAt','completedAt','bodyBytes','bodySha256'].map(k=>[k,receipt[k]]),['bodyBase64',bytes.toString('base64')]]);
const receiptMatches=(a,b)=>['url','sourceId','attemptedAt','headersReceivedAt','completedAt','status','bodySha256','bodyBytes'].every(k=>a[k]===b[k]);

export function validateRefreshCandidate(candidate,inputs){
 exact(candidate,['kind','version','publicationAuthorized','accuracyImprovementEstablished','policySha256','issuedAt','coverage','missingTargets','archive','registry','locations']);
 assert.equal(candidate.version,1);assert.equal(candidate.kind,'review_only_model_refresh_candidate');assert.equal(candidate.publicationAuthorized,false);assert.equal(candidate.accuracyImprovementEstablished,false);
 assert.equal(candidate.coverage,'complete','partial refresh is not publishable');assert.deepEqual(candidate.missingTargets,[]);
 assert.equal(candidate.policySha256,inputs.policySha256);assert.deepEqual(candidate.locations,inputs.locations);assert.deepEqual(candidate.registry,candidateRegistry(inputs.registry,inputs.policy));
 const archive=candidate.archive;assert.equal(archive.issuedAt,candidate.issuedAt);assert.equal(archive.minFamilies,2);assert.equal(archive.targets.length,15);assert.equal(archive.captures.length,10);
 const times=[...new Set(archive.targets.map(t=>Date.parse(t.validStart)))].sort((a,b)=>a-b);assert.equal(times.length,5);
 for(let i=0;i<times.length;i++){
  assert.equal(times[i]%(3*3600000),0);if(i)assert.equal(times[i]-times[i-1],3*3600000);
  assert.ok(times[i]>Date.parse(candidate.issuedAt)&&times[i]<=Date.parse(candidate.issuedAt)+24*3600000,'bounded future target required');
  assert.deepEqual(archive.targets.filter(t=>Date.parse(t.validStart)===times[i]).map(t=>t.locationId).sort(),inputs.policy.pointIds.slice().sort());
 }
 for(const sourceId of inputs.policy.sourceIds){
  const captures=archive.captures.filter(c=>c.sourceId===sourceId);assert.equal(captures.length,5);assert.equal(new Set(captures.map(c=>Date.parse(c.decoded.modelReferenceTime))).size,1,'one newest cycle per family');
  for(const capture of captures){assert.equal(capture.receipt.admissionReviewId,REFRESH_ADMISSION_REVIEW_ID);assert.deepEqual(capture.decoded.points.map(p=>p.locationId).sort(),inputs.policy.pointIds.slice().sort());assert.ok(Date.parse(candidate.issuedAt)-Date.parse(capture.decoded.modelReferenceTime)<REFRESH_SOURCE_CONTRACTS[sourceId].maxReferenceAgeHours*3600000);if(sourceId==='ecmwf')assert.equal(capture.receipt.rangeEvidence.listing.kind,'reviewed_listing_anchor_extract','portal bytes cannot be published');}
 }
 const result=aggregateIssuedArchive(archive,{registry:candidate.registry,locations:inputs.locations});requireCompleteRefreshAggregation(result,15);return candidate;
}

export async function readCompletedModelRefresh({directory,inputs=undefined}){
 inputs??=await refreshInputs();await rootIdentity(directory);await absent(join(directory,'writer.lock'));
 const inspected=await inspectRefreshState(directory,inputs.policySha256),state=inspected.state;
 assert.ok(state&&state.disposition==='ready'&&state.lastAttempt.status==='success','only latest completed successful refresh may be reviewed');
 assert.equal(state.publicationAuthorized,false);assert.equal(state.lastAttempt.reason,'complete');assert.equal(state.candidate?.coverage,'complete');assert.deepEqual(state.candidate,state.lastKnownGood);
 assert.equal(state.candidate.path,`runs/${String(state.runNumber).padStart(6,'0')}/candidate.json`,'cannot publish earlier retained success after a later attempt');
 const bytes=await readPrivate(join(directory,state.candidate.path)),candidate=validateRefreshCandidate(JSON.parse(bytes),inputs);assert.equal(sha256(bytes),state.candidate.sha256);
 assert.equal(state.candidate.issuedAt,candidate.issuedAt);assert.ok(Date.parse(state.lastAttempt.attemptedAt)<=Date.parse(candidate.issuedAt));assert.ok(Date.parse(state.lastAttempt.completedAt)>=Date.parse(candidate.issuedAt));
 exact(state.lastAttempt,['status','attemptedAt','completedAt','reason']);assert.equal(state.attemptedAt,state.lastAttempt.attemptedAt);assert.equal(state.completedAt,state.lastAttempt.completedAt);
 // Match original source receipts, including reused immutable fields, to private
 // journal evidence. Never export these journals, source HTML or response headers.
 const events=[];let current;
 for(let n=1;n<=state.runNumber;n++){
  const parsed=(await readPrivate(join(directory,'runs',String(n).padStart(6,'0'),'journal.jsonl'),2*1024*1024)).toString().trim().split('\n').map(line=>JSON.parse(line));events.push(...parsed);if(n===state.runNumber)current=parsed;
 }
 const pending=current.filter(e=>e.event==='request_pending'),complete=current.filter(e=>e.event==='response_complete');assert.equal(current.filter(e=>e.event==='request_unresolved').length,0,'unresolved source outcome');assert.equal(complete.length,pending.length);assert.equal(pending.length,state.stats.operations);assert.ok(pending.length<=27);assert.equal(complete.reduce((n,r)=>n+r.bodyBytes,0),state.stats.totalBytes);assert.ok(state.stats.totalBytes<=40*1024*1024);
 for(let i=0;i<pending.length;i++){assert.equal(pending[i].requestNumber,i+1);for(const key of ['url','sourceId','kind','attemptedAt','requestedRange'])assert.equal(complete[i][key],pending[i][key]);assert.equal(complete[i].complete,true);assert.ok([200,206,304,404,410].includes(complete[i].status));}
 const selections=current.filter(e=>e.event==='actual_listed_target_selection');assert.equal(selections.length,1);const matching=selections[0].matching;assert.equal(matching.status,'complete');assert.deepEqual(matching.missingTargets,[]);assert.equal(matching.targets.length,5);
 assert.deepEqual([...new Set(candidate.archive.targets.map(t=>Date.parse(t.validStart)))].sort(),matching.targets.map(t=>Date.parse(t.validTime)).sort());

 // Replay the entire newest-listed traversal, not just plausible filenames.
 const discoveries={};
 for(const sourceId of inputs.policy.sourceIds){
  const contract=REFRESH_SOURCE_CONTRACTS[sourceId],robot=state.metadataCache[contract.robotsUrl];assert.ok(robot);const robotBody=await body(directory,robot.bodySha256,robot.bodyBytes);
  const robots=[404,410].includes(robot.status)?{state:'absent'}:parseRobotsPolicy(new TextDecoder('utf-8',{fatal:true}).decode(robotBody));assert.ok(['absent','parsed'].includes(robots.state));
  let url=contract.rootUrl,discovery;
  for(let depth=0;depth<contract.maxListingPages;depth++){
   assert.ok(robotsPolicyAllows(robots,url));const record=state.metadataCache[url];assert.ok(record&&record.kind==='listing'&&record.sourceId===sourceId,'missing exact discovery page');
   const page={...record,body:await body(directory,record.bodySha256,record.bodyBytes)};discovery=(sourceId==='noaa'?nextGfsListing:nextIfsListing)(page,{now:candidate.issuedAt});if(discovery.kind!=='listing')break;url=discovery.url;
  }
  assert.equal(discovery?.kind,'files');discoveries[sourceId]=discovery;
  for(const capture of candidate.archive.captures.filter(c=>c.sourceId===sourceId)){assert.ok(robotsPolicyAllows(robots,capture.receipt.url));if(sourceId==='ecmwf')assert.ok(robotsPolicyAllows(robots,capture.receipt.rangeEvidence.index.url));}
 }
 assert.deepEqual(selectMatchingTargets({gfs:discoveries.noaa,ifs:discoveries.ecmwf,now:candidate.issuedAt,maxTargets:5}),matching,'newest actual discovery/target replay differs');
 const responses=events.filter(e=>e.event==='response_complete'&&e.complete===true);
 const find=(receipt,kind)=>{const matches=responses.filter(e=>e.kind===kind&&receiptMatches(e,receipt));assert.ok(matches.length>0,'candidate source receipt absent from immutable private journal');return matches[0];};
 for(const capture of candidate.archive.captures){
  const receipt=find(capture.receipt,'field');assert.deepEqual(await body(directory,receipt.bodySha256,receipt.bodyBytes),Buffer.from(capture.bodyBase64,'base64'));
  const target=matching.targets.find(t=>Date.parse(t.validTime)===Date.parse(capture.decoded.validAt));assert.ok(target);const field=target[capture.sourceId==='noaa'?'gfs':'ifs'];assert.equal(Date.parse(field.modelReferenceTime),Date.parse(capture.decoded.modelReferenceTime));
  const listings=responses.filter(r=>r.kind==='listing'&&r.sourceId===capture.sourceId&&r.url===field.listingUrl&&r.bodySha256===field.listingBodySha256&&r.completedAt===field.listedAt);assert.ok(listings.length,'actual selected listing must be retained');const listing=listings[0],listingBody=await body(directory,listing.bodySha256,listing.bodyBytes),page={...listing,body:listingBody};
  const discovered=(capture.sourceId==='noaa'?nextGfsListing:nextIfsListing)(page,{now:candidate.issuedAt});assert.equal(discovered.kind,'files');assert.ok(discovered.fields.some(f=>digest(f)===digest(field)),'selected field not in retained actual listing');
  if(capture.sourceId==='noaa')assert.equal(buildGfsFieldRequest(field,{now:candidate.issuedAt}).url,capture.receipt.url);
  else{
   const evidence=capture.receipt.rangeEvidence;assert.equal(receipt.requestedRange,evidence.requestedRange);assert.equal(receipt.headers['content-range'],evidence.contentRange);
   const index=find({...evidence.index,sourceId:'ecmwf'},'index');assert.deepEqual(await body(directory,index.bodySha256,index.bodyBytes),Buffer.from(evidence.index.bodyBase64,'base64'));
   // A reused field retains its original listing and index clocks, not this run's.
   const original=responses.find(r=>r.kind==='listing'&&r.url===evidence.listing.url&&r.bodySha256===evidence.listing.sourceBodySha256&&r.completedAt===evidence.listing.completedAt);assert.ok(original,'original extraction provenance missing');
   assert.deepEqual(extractReviewedListing(metadata(original,await body(directory,original.bodySha256,original.bodyBytes))),evidence.listing);
  }
 }
 const finalBytes=await readPrivate(join(directory,'runs',String(state.runNumber).padStart(6,'0'),'final.json'),8192);
 return {inputs,inspected,state,candidate,candidateBytes:bytes,finalSha256:sha256(finalBytes)};
}

async function publicationFiles({root,directory,inputs,python,replay=replayGribCaptures,now=()=>Date.now()}){
 const codeSha256=await weatherCodeDigest(root),configurationSha256=await configurationDigest(root);
 const result=await readCompletedModelRefresh({directory,inputs});({inputs}=result);const {state,candidate,finalSha256}=result;
 assert.equal(await fs.realpath(root),resolve(root),'symlink repository root');
 assert.equal(inputs.baselineSha256,state.acceptedBaselineSha256||result.inspected.genesis.baselineSha256,'private run was collected against a different accepted baseline');
 const current=await loadPublicModelProjection(pathToFileURL(resolve(root)+'/'));assert.equal(sha256(await readPrivate(join(root,MODEL_MANIFEST))),inputs.baselineSha256,'accepted baseline changed after package/review');
 assert.ok(Date.parse(candidate.issuedAt)>Date.parse(current.archive.issuedAt),'issuance rollback or repeated candidate');
 withinClock(candidate,state,now);
 await replay(candidate.archive.captures,{locations:inputs.locations,python});
 const recheck=async()=>{withinClock(candidate,state,now);assert.equal(await weatherCodeDigest(root),codeSha256,'code changed during review');assert.equal(await configurationDigest(root),configurationSha256,'policy/configuration changed during review');await absent(join(directory,'writer.lock'));const latest=await inspectRefreshState(directory,inputs.policySha256);assert.equal(latest.runNumber,state.runNumber+1,'private run advanced during review');assert.equal(latest.predecessorFinalSha256,finalSha256,'private final receipt changed during review');assert.equal(sha256(await readPrivate(join(root,MODEL_MANIFEST))),inputs.baselineSha256,'accepted baseline changed during review');withinClock(candidate,state,now);await absent(join(directory,'writer.lock'));};await recheck();
 const archiveBytes=jsonBytes(candidate.archive),archiveSha256=sha256(archiveBytes),archivePath=`weather-evidence/issuances/${archiveSha256}.json`;
 const manifest=validateModelManifest({version:2,kind:'accepted_reviewed_halifax_model_issuance',archivePath,archiveSha256,baseRegistrySha256:digest(inputs.registry),lastAttempt:state.lastAttempt,refreshReceipt:{version:1,kind:'reviewed_manual_model_refresh',admissionReviewId:REFRESH_ADMISSION_REVIEW_ID,runNumber:state.runNumber,policySha256:inputs.policySha256,candidateSha256:sha256(result.candidateBytes),finalSha256}});
 const projection=publicModelProjection(candidate.archive,{registry:manifestModelRegistry(inputs.registry,manifest),locations:inputs.locations,lastAttempt:manifest.lastAttempt,refreshReceipt:manifest.refreshReceipt});
 const contract={version:1,kind:'model_only_reviewed_refresh_publication',publicationAuthorized:false,baselineManifestSha256:inputs.baselineSha256,codeSha256,manifestSha256:sha256(jsonBytes(manifest)),candidateSha256:sha256(result.candidateBytes),finalSha256,policySha256:inputs.policySha256,runNumber:state.runNumber,scope:'two_families_three_core_points_temperature_five_instants',accuracyImprovementEstablished:false};
 const files={[MODEL_MANIFEST]:jsonBytes(manifest),[archivePath]:archiveBytes,'data/build/halifax-weather-models.json':jsonBytes(projection),'data/weather-models.js':Buffer.from(publicModelBytes(projection)),[MODEL_REFRESH_CONTRACT]:jsonBytes(contract)};
 assert.ok(Object.values(files).reduce((n,b)=>n+b.length,0)<=MAX_PACKAGE_BYTES);return {files,manifest,contract,recheck};
}
async function artifactFiles(directory){
 assert.equal(await fs.realpath(directory),resolve(directory),'symlink artifact root');const files=[];let bytes=0,entries=0;const directories=new Set(['review','data','data/build','weather-evidence','weather-evidence/issuances']);
 async function walk(path){for(const entry of await fs.readdir(path,{withFileTypes:true})){const p=join(path,entry.name);assert.ok(++entries<=10,'unexpected artifact entry count');assert.ok(!entry.isSymbolicLink(),'artifact symlink prohibited');if(entry.isDirectory()){assert.ok(directories.has(relative(directory,p).split('\\').join('/')),'unexpected artifact directory');await walk(p);}else{assert.ok(entry.isFile());files.push(relative(directory,p).split('\\').join('/'));assert.ok(files.length<=5,'unexpected artifact files');bytes+=(await fs.stat(p)).size;assert.ok(bytes<=MAX_PACKAGE_BYTES);}}}await walk(directory);return files.sort();
}
export async function packageModelRefresh(options){
 const {files,manifest,contract}=await publicationFiles(options),output=resolve(options.output);assert.ok(isAbsolute(options.output));
 for(const parent of [options.root,options.directory]){const r=relative(resolve(parent),output);assert.ok(r==='..'||r.startsWith('..'+(process.platform==='win32'?'\\':'/'))||isAbsolute(r),'package must be separate from repository and private store');}
 assert.equal(await fs.realpath(dirname(output)),dirname(output),'symlink package parent prohibited');
 await fs.mkdir(output,{mode:0o700});for(const [path,bytes]of Object.entries(files)){await fs.mkdir(dirname(join(output,path)),{recursive:true});await fs.writeFile(join(output,path),bytes,{flag:'wx',mode:0o600});}return {manifest,contract,files:Object.keys(files)};
}
export async function validateModelRefreshArtifact(options){
 const result=await publicationFiles(options),actual=await artifactFiles(resolve(options.output));assert.deepEqual(actual,Object.keys(result.files).sort(),'unexpected or missing model publication files');
 for(const [path,bytes]of Object.entries(result.files))assert.deepEqual(await readPrivate(join(options.output,path)),bytes,'model artifact differs from exact private run/rebuilt projection');return result;
}
async function safePublicationTarget(root,path,{create=false}={}){
 root=resolve(root);const destination=resolve(root,path);let parent=root;
 for(const segment of relative(root,dirname(destination)).split(/[\\/]/).filter(Boolean)){
  parent=join(parent,segment);try{const s=await fs.lstat(parent);assert.ok(s.isDirectory()&&!s.isSymbolicLink(),'symlink publication directory');}catch(error){if(error.code!=='ENOENT')throw error;if(create)await fs.mkdir(parent,{mode:0o755});}
 }
 try{const s=await fs.lstat(destination);assert.ok(s.isFile()&&!s.isSymbolicLink(),'publication target must be regular');}catch(error){if(error.code!=='ENOENT')throw error;}
 await absent(destination+'.model-refresh-pending');await absent(destination+'.model-refresh-rollback');
}
export async function applyModelRefreshArtifact(options){
 const {files,manifest,recheck}=await validateModelRefreshArtifact(options);await recheck();
 const targets=[manifest.archivePath,...MODEL_REFRESH_DATA_FILES.filter(p=>p!==MODEL_MANIFEST),MODEL_MANIFEST];
 for(const path of targets)await safePublicationTarget(options.root,path);
 for(const path of targets)await safePublicationTarget(options.root,path,{create:true});
 const staged=[];
 async function writeStage(path,bytes){const handle=await fs.open(path,'wx',0o644);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}}
 try{
  for(const path of targets){
   const destination=join(options.root,path);let previous=null;try{previous=await readPrivate(destination);}catch(error){if(error.code!=='ENOENT')throw error;}
   if(path===manifest.archivePath&&previous){assert.deepEqual(previous,files[path],'cannot replace immutable model evidence');continue;}
   const temporary=destination+'.model-refresh-pending',item={path,destination,temporary,previous,committed:false};staged.push(item);await writeStage(temporary,files[path]);
  }
  // The last freshness/code/policy/private-run check is before ANY public file
  // replacement. A rejected late check leaves every accepted input unchanged.
  await recheck();
  for(const item of staged){
   if(item.path===manifest.archivePath){await fs.link(item.temporary,item.destination);item.committed=true;await fs.unlink(item.temporary);}
   else{await fs.rename(item.temporary,item.destination);item.committed=true;}
  }
 }catch(error){
  // Restore exact original bytes if a filesystem write fails partway through.
  // Only files staged/created by this operation are removed; source evidence in
  // the private store is never touched. A crash still requires branch review.
  for(const item of staged.filter(x=>x.committed).reverse()){
   if(item.previous===null)await fs.unlink(item.destination);
   else{const rollback=item.destination+'.model-refresh-rollback';await writeStage(rollback,item.previous);await fs.rename(rollback,item.destination);}
  }
  throw error;
 }finally{
  for(const item of staged)try{await fs.unlink(item.temporary);}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 return [...MODEL_REFRESH_DATA_FILES,manifest.archivePath];
}
