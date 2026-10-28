// Read-only, bounded producer. No accepted data writes, no credentials or publication.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,appendFile,rename,access} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {environmentIdentity,resolveWeatherLineage,requireSamePlan,requireExactCache,verifyFinalReceipt,finalReceipt,payloadDigest} from './lib/weather-run-lineage.mjs';
import {captureBundle,captureManifest,validateCapture,loadCurrentWeather,jsonBytes} from './lib/weather-capture.mjs';
import {collectEcccReview} from './lib/eccc-weather-adapter.mjs';
import {recoveryRequested,RECOVERY_CACHE_KEY,reserveReviewedRecovery,authorizeReservedRecovery,validateRecoveryHistory} from './lib/eccc-reviewed-recovery.mjs';
import {sourceAccessState} from './lib/source-access-state.mjs';
const root=new URL('../',import.meta.url),json=async p=>JSON.parse(await readFile(p,'utf8'));
export const lineagePaths=base=>Object.fromEntries(['payload','receipt','predecessorReceipt','plan','collected','journal'].map((key,i)=>[key,new URL(['weather-preview.json','weather-preview-final.json','weather-preview-predecessor.json','weather-preview-lineage-plan.json','weather-preview-collected.json','eccc-weather-review-journal.jsonl'][i],base)]));
const absent=async path=>{try{await access(path);throw Error('weather_lineage_existing_state');}catch(e){if(e.code!=='ENOENT')throw e;}};
const writeJson=(p,x)=>writeFile(p,jsonBytes(x),{flag:'wx'});
export function validateWeatherCache(payload){
  assert.deepEqual(Object.keys(payload).sort(),['blocked','capture','decision','manifest','version',...(Object.hasOwn(payload,'recovery')?['recovery']:[])].sort());if(payload.recovery)validateRecoveryHistory(payload.recovery);assert.equal(payload.version,1);assert.equal(typeof payload.blocked,'boolean');
  const envelope=validateCapture(payload.manifest,jsonBytes(payload.capture));
  assert.ok(['collected','not_modified','rejected','retained_hold','cadence_deferred','bootstrap'].includes(payload.decision));
  if(!['success','not_modified'].includes(envelope.lastAttempt.status))assert.equal(payload.blocked,true,'lost failure hold');
  if(['rejected','retained_hold'].includes(payload.decision))assert.equal(payload.blocked,true);
  if(payload.decision==='rejected')assert.ok(!['success','not_modified'].includes(envelope.lastAttempt.status),'rejected decision cannot claim source success');
  return payload;
}
export async function createLineagePlan({env,paths,metadata}){recoveryRequested(env);const plan=await resolveWeatherLineage({env,metadata});await writeJson(paths.plan,plan);return plan;}
export async function collectWithLineage({env,paths,registry,metadata,collect=collectEcccReview,current,now=Date.now(),drain=()=>sourceAccessState().drainDecisions()}){
  assert.equal(registry.sources?.[0]?.enabled,true,'Weather collection disabled');
  const plan=await resolveWeatherLineage({env,metadata});requireSamePlan(await json(paths.plan),plan);
  await absent(paths.collected);await absent(paths.predecessorReceipt);await absent(paths.journal);
  let previous,predecessorBytes,predecessorFinalBytes;
  if(plan.predecessor){
    requireExactCache({hit:env.WEATHER_PAYLOAD_CACHE_HIT,matchedKey:env.WEATHER_PAYLOAD_CACHE_KEY,expectedKey:plan.predecessorCacheKey});
    requireExactCache({hit:env.WEATHER_RECEIPT_CACHE_HIT,matchedKey:env.WEATHER_RECEIPT_CACHE_KEY,expectedKey:plan.predecessorCacheKey+'-final'});
    const bytes=await readFile(paths.payload);predecessorBytes=bytes;predecessorFinalBytes=await readFile(paths.receipt);previous=validateWeatherCache(JSON.parse(bytes));verifyFinalReceipt(JSON.parse(predecessorFinalBytes),plan.predecessor,bytes);await rename(paths.receipt,paths.predecessorReceipt);
  }else{
    await absent(paths.payload);await absent(paths.receipt);
    const accepted=current||await loadCurrentWeather(root);
    previous=validateWeatherCache({version:1,manifest:accepted.manifest,capture:accepted.capture,blocked:!['success','not_modified'].includes(accepted.manifest.lastAttempt.status),decision:'bootstrap'});
  }
  const elapsed=now-Date.parse(previous.manifest.lastAttempt.completedAt);
  let result,recovery=null;
  if(recoveryRequested(env)){assert.ok(previous.blocked,'reviewed recovery only applies to the exact blocked predecessor');recovery=await authorizeReservedRecovery({env,paths,plan,registry,payloadBytes:predecessorBytes,finalBytes:predecessorFinalBytes,now:new Date(now).toISOString()});}
  if(previous.blocked&&!recovery){result={...previous,decision:'retained_hold'};}
  else if(!Number.isFinite(elapsed)||elapsed<55*60000){result={...previous,decision:'cadence_deferred'};}
  else{
    const outcome=await collect({registry,journalPath:paths.journal.pathname,previous:validateCapture(previous.manifest,jsonBytes(previous.capture)),previousCapture:previous.capture,recoveryCapability:recovery?.capability||null});
    await drain(); // Pending/late restriction decisions must settle before receipt.
    const good=outcome.candidate?.lastAttempt?.status==='success',unchanged=outcome.candidate?.lastAttempt?.status==='not_modified';
    const capture=good?captureBundle(outcome.body,outcome.receipt):previous.capture;
    const manifest=captureManifest(capture,{mode:'reviewed_refresh',lastAttempt:outcome.candidate.lastAttempt,sourceRun:plan.current});
    result={version:1,manifest,capture,blocked:!good&&!unchanged,decision:unchanged?'not_modified':good?'collected':'rejected'};
  }
  if(recovery)result.recovery=recovery.record;else if(previous.recovery)result.recovery=previous.recovery;
  validateWeatherCache(result);if(previous.blocked&&!recovery)assert.equal(result.blocked,true,'lost hold');if(previous.recovery)assert.deepEqual(result.recovery,previous.recovery,'lost recovery history');
  await writeFile(paths.payload,jsonBytes(result));
  const bytes=await readFile(paths.payload);
  await writeJson(paths.collected,{version:1,kind:'weather_preview_collected',identity:plan.current,payloadSha256:payloadDigest(bytes),transportDecisionsDrained:true});
  return plan;
}
async function verified({env,paths}){
  const plan=await json(paths.plan),identity=environmentIdentity(env);assert.equal(plan.events?.current,env.GITHUB_EVENT_NAME,'weather plan event mismatch');for(const [k,v]of Object.entries(identity))assert.equal(plan.current[k],v);
  const bytes=await readFile(paths.payload);validateWeatherCache(JSON.parse(bytes));
  requireSamePlan(await json(paths.collected),{version:1,kind:'weather_preview_collected',identity:plan.current,payloadSha256:payloadDigest(bytes),transportDecisionsDrained:true});return {plan,bytes};
}
export function weatherCollectionOutcome(payload){
 validateWeatherCache(payload);const status=payload.manifest.lastAttempt.status;
 const accepted=!payload.blocked&&((payload.decision==='collected'&&status==='success')||(payload.decision==='not_modified'&&status==='not_modified'));
 return {version:1,kind:'weather_source_collection_outcome',sourceStatus:status,decision:payload.decision,blocked:payload.blocked,newCaptureAccepted:accepted&&status==='success',retainedCaptureRevalidated:accepted&&status==='not_modified',publicationEligible:accepted,sourceAttemptAt:payload.manifest.lastAttempt.attemptedAt,sourceCompletedAt:payload.manifest.lastAttempt.completedAt,retainedCaptureRetrievedAt:payload.capture.receipt.retrievedAt,retainedCaptureSha256:payload.manifest.captureSha256,summary:accepted?(status==='success'?'Source refresh accepted for separate publication review; not deployed.':'Retained capture conditionally revalidated; original fact clocks unchanged.'):'No source refresh accepted for publication. Retained facts and blocking state are private review evidence; successful cache persistence is not a successful weather refresh.'};
}
export async function reportWeatherOutcome({env,paths}){
 const {plan,bytes}=await verified({env,paths});verifyFinalReceipt(await json(paths.receipt),plan.current,bytes);
 const result={...weatherCollectionOutcome(JSON.parse(bytes)),privateContinuity:'final_payload_receipt_verified'};await writeJson(new URL('weather-preview-outcome.json',paths.payload),result);
 if(env.GITHUB_STEP_SUMMARY)await appendFile(env.GITHUB_STEP_SUMMARY,`## ECCC weather collection outcome\n\n${result.summary}\n\n- Source status: **${result.sourceStatus}**; blocked: **${result.blocked}**.\n- New capture accepted: **${result.newCaptureAccepted}**.\n- Publication eligible: **${result.publicationEligible}**.\n- Private payload/final-receipt continuity: verified.\n- Retained capture retrieved: ${result.retainedCaptureRetrievedAt}.\n`);
 console.log(JSON.stringify(result,null,2));return result;
}
export async function completeLineage({env,paths}){const {plan,bytes}=await verified({env,paths});requireExactCache({hit:env.WEATHER_SAVED_CACHE_HIT,matchedKey:env.WEATHER_SAVED_CACHE_KEY,expectedKey:plan.cacheKey});await writeJson(paths.receipt,finalReceipt(plan.current,bytes));}
export async function verifyReceiptSaved({env,paths}){const {plan,bytes}=await verified({env,paths});verifyFinalReceipt(await json(paths.receipt),plan.current,bytes);requireExactCache({hit:env.WEATHER_SAVED_CACHE_HIT,matchedKey:env.WEATHER_SAVED_CACHE_KEY,expectedKey:plan.cacheKey+'-final'});}
async function main(){const env=process.env,paths=lineagePaths(new URL('artifacts/',root));await mkdir(new URL('artifacts/',root),{recursive:true});const registry=await json(new URL('data/weather-source-registry.json',root));assert.equal(registry.sources[0].enabled,true,'Weather review is disabled; no metadata/source requests permitted');
 if(env.GITHUB_EVENT_NAME==='schedule')assert.equal(registry.sources[0].refreshPolicy?.scheduleEnabled,true,'Weather schedule is not activated');
 switch(process.argv[2]){
 case 'plan':{const plan=await createLineagePlan({env,paths});assert.ok(env.GITHUB_OUTPUT);await appendFile(env.GITHUB_OUTPUT,`bootstrap=${plan.predecessor===null}\ncache-key=${plan.cacheKey}\npredecessor-cache-key=${plan.predecessorCacheKey||''}\nrecovery-requested=${recoveryRequested(env)}\nrecovery-cache-key=${recoveryRequested(env)?RECOVERY_CACHE_KEY:''}\n`);break;}
 case 'reserve-recovery':{const plan=await resolveWeatherLineage({env});requireSamePlan(await json(paths.plan),plan);await reserveReviewedRecovery({env,paths,plan,registry});break;}
 case 'collect':await collectWithLineage({env,paths,registry});break;
 case 'report':await reportWeatherOutcome({env,paths});break;
 case 'complete':await completeLineage({env,paths});break;
 case 'verify-final-save':await verifyReceiptSaved({env,paths});break;
 default:throw Error('weather_lineage_invalid_command');}}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
