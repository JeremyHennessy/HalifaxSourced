// Immutable reviewed evidence -> small public projection. No network or live activation.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {hash,stamp} from './eccc-weather.mjs';
import {digest,stableJson,locationContract} from './weather-aggregation.mjs';
import {aggregateIssuedArchive} from './weather-model-archive.mjs';
export const MODEL_MANIFEST='weather-evidence/current.json';
export const REFRESH_ADMISSION_REVIEW_ID='halifax-gfs-ifs-refresh-v1';
export function validateModelManifest(manifest){
 const extra=manifest.version===2?['refreshReceipt']:[];
 assert.deepEqual(Object.keys(manifest).sort(),['archivePath','archiveSha256','baseRegistrySha256','kind','lastAttempt','version',...extra].sort());
 assert.ok([1,2].includes(manifest.version));assert.equal(manifest.kind,'accepted_reviewed_halifax_model_issuance');
 for(const key of ['archiveSha256','baseRegistrySha256'])assert.match(manifest[key],/^[a-f0-9]{64}$/);
 assert.equal(manifest.archivePath,`weather-evidence/issuances/${manifest.archiveSha256}.json`);
 if(manifest.version===2){
  assert.deepEqual(Object.keys(manifest.lastAttempt).sort(),['attemptedAt','completedAt','reason','status']);assert.equal(manifest.lastAttempt.status,'success');assert.equal(manifest.lastAttempt.reason,'complete');
  const receipt=manifest.refreshReceipt;
  assert.deepEqual(Object.keys(receipt).sort(),['admissionReviewId','candidateSha256','finalSha256','kind','policySha256','runNumber','version']);
  assert.equal(receipt.version,1);assert.equal(receipt.kind,'reviewed_manual_model_refresh');assert.equal(receipt.admissionReviewId,REFRESH_ADMISSION_REVIEW_ID);
  assert.ok(Number.isSafeInteger(receipt.runNumber)&&receipt.runNumber>0&&receipt.runNumber<=9999);
  for(const key of ['candidateSha256','finalSha256','policySha256'])assert.match(receipt[key],/^[a-f0-9]{64}$/);
 }
 return manifest;
}
export function manifestModelRegistry(registry,manifest){
 validateModelManifest(manifest);const result=structuredClone(registry);
 if(manifest.version===2)for(const source of result.sources.filter(s=>['noaa','ecmwf'].includes(s.id)))source.acceptedAdmissionReviewIds=[...new Set([...source.acceptedAdmissionReviewIds,manifest.refreshReceipt.admissionReviewId])];
 return result;
}
export function reviewedModelRegistry(registry){
 assert.equal(registry.liveCollectionEnabled,false);const r=structuredClone(registry);
 for(const model of r.models)model.enabled=['gfs','ecmwf_ifs'].includes(model.id);
 for(const source of r.sources){source.enabled=['noaa','ecmwf'].includes(source.id);if(source.enabled){assert.ok(source.acceptedAdmissionReviewIds?.length&&source.acceptedDecoderIds?.length,'source capture admission review required');source.accessState='admitted_review_only';}}
 return r; // Contribution from reviewed captures, never authorization to collect or schedule.
}
const targetKey=t=>stableJson({locationId:t.locationId,variable:t.variable,unit:t.unit,validStart:Date.parse(stamp(t.validStart)),validEnd:Date.parse(stamp(t.validEnd)),eventDefinition:t.eventDefinition??null});
export function publicModelProjection(archive,{registry,locations,lastAttempt,refreshReceipt=null}){
 const acceptedRegistry=reviewedModelRegistry(registry),result=aggregateIssuedArchive(archive,{registry:acceptedRegistry,locations});
 assert.ok(['success','failed','held','partial','pending','unknown'].includes(lastAttempt.status));stamp(lastAttempt.attemptedAt);stamp(lastAttempt.completedAt);assert.ok(Date.parse(lastAttempt.completedAt)>=Date.parse(lastAttempt.attemptedAt));if(lastAttempt.status==='success'){if(refreshReceipt){assert.equal(refreshReceipt.kind,'reviewed_manual_model_refresh');assert.equal(refreshReceipt.admissionReviewId,REFRESH_ADMISSION_REVIEW_ID);assert.ok(Date.parse(lastAttempt.attemptedAt)<=Date.parse(archive.issuedAt)&&Date.parse(lastAttempt.completedAt)>=Date.parse(archive.issuedAt),'reviewed run must span its frozen issuance');}else assert.ok(Date.parse(lastAttempt.completedAt)<=Date.parse(archive.issuedAt),'successful capture after frozen issuance');}assert.ok(Date.parse(lastAttempt.completedAt)>=Math.max(...archive.captures.map(c=>Date.parse(c.receipt.completedAt))),'health receipt cannot predate accepted facts');
 const models=acceptedRegistry.models.filter(m=>m.enabled),points=[...locationContract(locations).values()].filter(p=>p.role==='core');
 assert.ok(archive.targets.length>0&&archive.targets.length<=30,'small reviewed forecast horizon');
 assert.ok(archive.targets.every(t=>points.some(p=>p.id===t.locationId)&&t.variable==='temperature_2m'&&t.unit==='C'&&t.validStart===t.validEnd&&t.eventDefinition===null),'public projection only reviewed core temperature instants');
 for(const capture of archive.captures.filter(c=>c.sourceId==='ecmwf'))assert.equal(capture.receipt.rangeEvidence.listing.kind,'reviewed_listing_anchor_extract','public repository evidence must not redistribute portal HTML/JavaScript');
 const captures=new Map(archive.captures.map(c=>[c.id,c]));
 const forecasts=result.outputs.map(output=>{
  const outcomes=archive.outcomes.filter(o=>targetKey(o.target)===targetKey(output.target));
  const contributors=outcomes.filter(o=>o.status==='complete').flatMap(o=>o.rows).map(row=>{
   const capture=captures.get(row.sourceBodySha256);assert.ok(capture);
   return {modelId:row.modelId,sourceId:row.sourceId,family:row.dependencyGroup,valueC:row.value,modelReferenceTime:row.modelReferenceTime,sourceIssuedAt:row.sourceIssuedAt??null,firstAvailableAt:row.firstAvailableAt,firstRetrievedAt:row.firstRetrievedAt,sourceUrl:capture.receipt.url,sourceBodySha256:row.sourceBodySha256,eligibleAtIssue:output.availableFamilies.includes(row.dependencyGroup),support:{gridLatitude:row.support.gridLatitude,gridLongitude:row.support.gridLongitude,distanceKm:row.support.distanceKm}};
  }).sort((a,b)=>a.modelId.localeCompare(b.modelId));
  const values=output.candidate?.contributors.map(r=>r.value)||[];
  return {locationId:output.target.locationId,validAt:output.target.validStart,predictionC:output.prediction,status:output.candidate?output.status:output.availableFamilies.length?'partial':'unavailable',families:output.availableFamilies,spread:{kind:'uncalibrated_model_disagreement',minC:values.length?Math.min(...values):null,maxC:values.length?Math.max(...values):null},candidateId:output.candidate?.id??null,contributors,omissions:outcomes.filter(o=>o.status!=='complete').map(o=>({modelId:o.modelId,status:o.status,reason:o.reason}))};
 });
 const sourceStates=registry.sources.map(source=>({id:source.id,name:source.id==='eccc'?'ECCC numerical-model GeoMet (official forecast separate)':source.name,status:['noaa','ecmwf'].includes(source.id)?'accepted':source.accessState.startsWith('held_')?'held':'unknown',accessState:source.accessState,reason:['noaa','ecmwf'].includes(source.id)?'Saved reviewed fields only; no automatic model refresh is active.':source.serviceAdmission||'No admitted direct source access.',termsUrl:source.termsUrl??null,documentationUrl:source.documentationUrl??null,contributes:forecasts.some(f=>f.contributors.some(c=>c.sourceId===source.id))}));
 return {version:1,kind:'halifax_model_forecast_snapshot',issuedAt:archive.issuedAt,lastAttempt,refreshMode:'recorded_reviewed_snapshot_no_automatic_refresh',receiptMaxAgeHours:12,points:points.map(p=>({id:p.id,name:p.name,latitude:p.latitude,longitude:p.longitude,role:p.role})),models:models.map(m=>({id:m.id,name:m.name,sourceId:m.sourceId,family:m.dependencyGroup,maxRunAgeHours:m.maxRunAgeHours})),sourceStates,forecasts,archiveSha256:result.archiveSha256,accuracyImprovementEstablished:false,wholeMunicipalityCoverageCertified:false,variableCoverage:['temperature_2m'],contextPointCoverage:'not_in_this_capture',attribution:[{sourceId:'noaa',text:'NOAA/NCEP GFS data; derived point extraction and equal-family aggregation by HalifaxSourced. No NOAA endorsement.',url:'https://www.weather.gov/disclaimer'},{sourceId:'ecmwf',text:'This service is based on data and products of the European Centre for Medium-Range Weather Forecasts (ECMWF). © 2026 ECMWF. Data licensed CC BY 4.0; HalifaxSourced modified the data through nearest-grid point extraction and equal-family aggregation. ECMWF disclaims liability for data errors, omissions, availability and resulting loss or damage. No endorsement or accuracy warranty is implied.',url:'https://www.ecmwf.int/en/forecasts/datasets/open-data',termsUrl:'https://apps.ecmwf.int/datasets/licences/general/',licenceUrl:'https://creativecommons.org/licenses/by/4.0/'}],limitations:['Model grid forecasts, not station observations or calibrated neighbourhood forecasts.','Only two admitted model families, three core points, temperature and the displayed valid instants; not all weather sources.','Raw model disagreement is not a calibrated prediction interval or probability.','Model reference time is not publication time; publication/first availability remain unknown where not evidenced.','No prospective skill improvement has been established.']};
}
export async function loadPublicModelProjection(root=new URL('../../',import.meta.url)){
 const manifest=JSON.parse(await readFile(new URL(MODEL_MANIFEST,root),'utf8'));
 validateModelManifest(manifest);
 const bytes=await readFile(new URL(manifest.archivePath,root));assert.ok(bytes.length<=32*1024*1024);assert.equal(hash(bytes),manifest.archiveSha256,'immutable accepted archive bytes');
 const registry=JSON.parse(await readFile(new URL('data/weather-model-registry.json',root))),locations=JSON.parse(await readFile(new URL('data/weather-locations.json',root)));assert.equal(digest(registry),manifest.baseRegistrySha256,'accepted admission policy changed');
 return {manifest,archive:JSON.parse(bytes),projection:publicModelProjection(JSON.parse(bytes),{registry:manifestModelRegistry(registry,manifest),locations,lastAttempt:manifest.lastAttempt,refreshReceipt:manifest.refreshReceipt})};
}
export const publicModelBytes=projection=>'// Reviewed model captures; offline projection preserves original clocks.\nwindow.HalifaxWeatherModels = '+JSON.stringify(projection,null,2).replace(/</g,'\\u003c')+';\n';
