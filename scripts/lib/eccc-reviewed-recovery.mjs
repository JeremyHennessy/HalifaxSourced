// One specific reviewed new acquisition after a known HTTP200 local semantic
// rejection. Never a reset, source-access exception, retry loop or cache fallback.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {constants} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {ENDPOINT,hash} from './eccc-weather.mjs';
import {jsonBytes,validateCapture} from './weather-capture.mjs';
import {verifyFinalReceipt,requireExactCache} from './weather-run-lineage.mjs';
import {sourceAccessState} from './source-access-state.mjs';
import {openWeatherReviewJournal} from './weather-review-journal.mjs';
const root=resolve(fileURLToPath(new URL('../../',import.meta.url)));
export const RECOVERY_ID='eccc-40645063122-http200-clock-review-1';
export const RECOVERY_DIRECTORY='weather-evidence/recoveries/eccc-40645063122';
export const RECOVERY_REVIEW_PATH=RECOVERY_DIRECTORY+'/review.json';
export const ORIGINAL_IDENTITY=Object.freeze({repository:'JeremyHennessy/HalifaxSourced',repositoryId:'1348899318',workflowPath:'.github/workflows/weather-preview.yml',workflowId:'399017463',runId:'40645063122',runNumber:1,runAttempt:1,sha:'2af4b308391a6696b02208bd7afdc07b093d3135',ref:'refs/heads/main'});
export const RECOVERY_BINDING=Object.freeze({version:1,kind:'single_reviewed_eccc_semantic_recovery',reviewId:RECOVERY_ID,endpoint:ENDPOINT,originalIdentity:ORIGINAL_IDENTITY,payloadSha256:'8f1d941299b710244387af37cf1678e06e77c0544f8b8eed6035fde34a6e45b1',finalReceiptSha256:'bd2c5136c2f86ee6b661085a0352784a42d1d7c75d40aa2f848debf68cd3bfcc',journalSha256:'6db258c2103f3e7dab7115a6b8e735fa3462a669feae0303fa697ec814136e66',originalReason:'ERR_ASSERTION: future source clock',notBefore:'2026-10-28T07:33:27.502Z',expiresAt:'2026-10-29T00:00:00.000Z',expectedRunNumber:2,expectedRunAttempt:1,event:'workflow_dispatch',maximumSourceRequests:1,reviewedDiagnosticBaseTree:'76677b77075dd7276fdb8e84328ddbe168190a7e'});
export const RECOVERY_CACHE_KEY='weather-reviewed-recovery-v1-1348899318-399017463-'+RECOVERY_ID;
const same=(a,b)=>assert.deepEqual(a,b,'reviewed recovery binding differs');
const sha=value=>assert.match(value,/^[a-f0-9]{64}$/);
const json=async path=>JSON.parse(await fs.readFile(path,'utf8'));
export function recoveryRequested(env){const value=env.WEATHER_REVIEWED_RECOVERY_ID??'none';assert.ok(['none',RECOVERY_ID].includes(value),'unreviewed recovery input');return value===RECOVERY_ID;}
export const recoveryPaths=paths=>Object.fromEntries(Object.entries({reservation:'weather-recovery-consumption.json',local:'weather-recovery-local-proof.json',use:'weather-recovery-use.jsonl',originalPayload:'weather-recovery-original-payload.json',originalFinal:'weather-recovery-original-final.json',originalJournal:'weather-recovery-original-journal.jsonl'}).map(([key,name])=>[key,new URL(name,paths.payload)]));
export async function recoveryCodeState({repo=root,requireClean=true}={}){
 const paths=execFileSync('git',['ls-files','-z'],{cwd:repo,encoding:'utf8'}).split('\0').filter(p=>p&&p!==RECOVERY_REVIEW_PATH).sort();
 assert.ok(paths.includes('scripts/lib/eccc-reviewed-recovery.mjs')&&paths.includes('.github/workflows/weather-preview.yml'),'recovery code must be tracked');
 if(requireClean)execFileSync('git',['diff','--exit-code','HEAD','--',...paths,RECOVERY_REVIEW_PATH],{cwd:repo,stdio:'pipe'});
 return {checkoutSha:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),codeDigest:hash(JSON.stringify(await Promise.all(paths.map(async p=>[p,hash(await fs.readFile(resolve(repo,p)))]))))};
}
export async function loadRecoveryReview(){const bytes=await fs.readFile(resolve(root,RECOVERY_REVIEW_PATH),'utf8'),review=JSON.parse(bytes);assert.equal(bytes,jsonBytes(review),'review descriptor must retain exact canonical bytes');const {approvedCodeDigest,...binding}=review;sha(approvedCodeDigest);same(binding,RECOVERY_BINDING);return review;}
export function validateRecoveryBindings({env,plan,payloadBytes,finalBytes,journalBytes,review,registry,now,codeState}){
 assert.equal(recoveryRequested(env),true);same(Object.fromEntries(Object.keys(RECOVERY_BINDING).map(k=>[k,review[k]])),RECOVERY_BINDING);assert.deepEqual(Object.keys(review).sort(),[...Object.keys(RECOVERY_BINDING),'approvedCodeDigest'].sort());
 assert.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch');assert.equal(env.WEATHER_INITIALIZE_REVIEW_CACHE,'false');assert.equal(plan.events.current,'workflow_dispatch');assert.equal(plan.events.predecessor,'workflow_dispatch');same(plan.predecessor,ORIGINAL_IDENTITY);
 for(const k of ['repository','repositoryId','workflowPath','workflowId','ref'])assert.equal(plan.current[k],ORIGINAL_IDENTITY[k]);
 assert.equal(plan.current.runNumber,2);assert.equal(plan.current.runAttempt,1);assert.notEqual(plan.current.runId,ORIGINAL_IDENTITY.runId);assert.equal(plan.current.sha,env.GITHUB_SHA);assert.equal(codeState.checkoutSha,env.GITHUB_SHA);assert.equal(codeState.codeDigest,review.approvedCodeDigest,'recovery code differs from independently reviewed digest');
 const at=Date.parse(now);assert.ok(Number.isFinite(at)&&at>=Date.parse(review.notBefore)&&at<Date.parse(review.expiresAt),'outside reviewed recovery time window');
 assert.equal(registry.sources?.length,1);const source=registry.sources[0];assert.equal(source.id,'eccc-halifax-citypage');assert.equal(source.enabled,true);assert.equal(source.state,'manual_refresh_ready');assert.equal(source.endpoint,ENDPOINT);assert.equal(source.refreshPolicy?.scheduleEnabled,false);same(source.requestPolicy,{maximumBytes:524288,timeoutMs:20000,redirects:false,retries:0,maximumReturnedFeatures:2});
 requireExactCache({hit:env.WEATHER_PAYLOAD_CACHE_HIT,matchedKey:env.WEATHER_PAYLOAD_CACHE_KEY,expectedKey:plan.predecessorCacheKey});requireExactCache({hit:env.WEATHER_RECEIPT_CACHE_HIT,matchedKey:env.WEATHER_RECEIPT_CACHE_KEY,expectedKey:plan.predecessorCacheKey+'-final'});
 assert.equal(hash(payloadBytes),review.payloadSha256,'not the exact reviewed failed payload');assert.equal(hash(finalBytes),review.finalReceiptSha256,'not the exact paired final receipt');assert.equal(hash(journalBytes),review.journalSha256,'not the reviewed HTTP200 journal');
 const payload=JSON.parse(payloadBytes);assert.equal(payload.blocked,true);assert.equal(payload.decision,'collected');same(payload.manifest.sourceRun,ORIGINAL_IDENTITY);same(payload.manifest.lastAttempt,{status:'failed',attemptedAt:'2026-10-28T06:38:27.184Z',completedAt:'2026-10-28T06:38:27.502Z',reason:review.originalReason});
 verifyFinalReceipt(JSON.parse(finalBytes),ORIGINAL_IDENTITY,payloadBytes);
 const events=journalBytes.toString().trim().split('\n').map(JSON.parse);assert.equal(events.length,2);same(events[0],{status:'pending',attemptedAt:'2026-10-28T06:38:27.184Z',url:ENDPOINT});same(events[1],{status:'failed',attemptedAt:'2026-10-28T06:38:27.184Z',completedAt:'2026-10-28T06:38:27.502Z',reason:review.originalReason,response:{url:ENDPOINT,httpStatus:200,responseAt:'2026-10-28T06:38:27.499Z'}});
 return {payload,envelope:validateCapture(payload.manifest,jsonBytes(payload.capture))};
}
function noAccessRestriction(){const state=sourceAccessState();assert.equal(state.access.find(ENDPOINT),null,'source access restriction supersedes reviewed semantic recovery');assert.equal(state.pendingAccessHolds.length,0,'new access restrictions cannot be cleared by recovery');assert.equal(state.pendingTransportReviews.length,0,'unknown transport cannot be cleared by recovery');return state;}
async function durableBytes(path,bytes){const handle=await fs.open(path,'wx',0o600);try{await handle.writeFile(bytes);await handle.sync();const directory=await fs.open(dirname(fileURLToPath(path)),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await directory.sync();}finally{await directory.close();}}finally{await handle.close();}}
async function evidenceInputs({paths}){return {payloadBytes:await fs.readFile(paths.payload),finalBytes:await fs.readFile(paths.receipt),journalBytes:await fs.readFile(resolve(root,RECOVERY_DIRECTORY,'original-journal.jsonl'))};}
export async function reserveReviewedRecovery({env,paths,plan,registry,now=new Date().toISOString()}){
 assert.equal(recoveryRequested(env),true);assert.equal(env.WEATHER_RECOVERY_EXISTING_HIT,'','existing/unknown recovery consumption cannot be reset');assert.equal(env.WEATHER_RECOVERY_EXISTING_KEY,'','existing/unknown recovery cache match cannot be reset');
 const review=await loadRecoveryReview(),codeState=await recoveryCodeState(),evidence=await evidenceInputs({paths});validateRecoveryBindings({env,plan,registry,now,review,codeState,...evidence});const access=noAccessRestriction();await access.drainDecisions();noAccessRestriction();
 const rp=recoveryPaths(paths),reservation={version:1,kind:'reviewed_recovery_consumption_reservation',reviewId:RECOVERY_ID,reviewSha256:hash(jsonBytes(review)),current:plan.current,predecessor:plan.predecessor,predecessorPayloadSha256:review.payloadSha256,predecessorFinalSha256:review.finalReceiptSha256,journalSha256:review.journalSha256,reservedAt:now,nonce:randomUUID(),state:'one_use_reserved_before_source_request',cacheKey:RECOVERY_CACHE_KEY};
 // The exclusive durable reservation precedes every transport and all optional
 // work. Interrupted/missing/unsaved reservation never authorizes acquisition.
 const handle=await openWeatherReviewJournal(fileURLToPath(rp.reservation),reservation);await handle.close();
 await durableBytes(rp.originalPayload,evidence.payloadBytes);await durableBytes(rp.originalFinal,evidence.finalBytes);await durableBytes(rp.originalJournal,evidence.journalBytes);
 const bytes=await fs.readFile(rp.reservation);await durableBytes(rp.local,jsonBytes({version:1,kind:'local_recovery_reservation_proof',current:plan.current,reservationSha256:hash(bytes),reviewSha256:reservation.reviewSha256}));
 return reservation;
}
const capabilities=new WeakMap();
export async function authorizeReservedRecovery({env,paths,plan,registry,payloadBytes,finalBytes,now=new Date().toISOString()}){
 const review=await loadRecoveryReview(),codeState=await recoveryCodeState(),journalBytes=await fs.readFile(resolve(root,RECOVERY_DIRECTORY,'original-journal.jsonl'));
 const {envelope}=validateRecoveryBindings({env,paths,plan,registry,payloadBytes,finalBytes,journalBytes,review,codeState,now});
 requireExactCache({hit:env.WEATHER_RECOVERY_CACHE_HIT,matchedKey:env.WEATHER_RECOVERY_CACHE_KEY,expectedKey:RECOVERY_CACHE_KEY});
 const rp=recoveryPaths(paths),bytes=await fs.readFile(rp.reservation),reservation=JSON.parse(bytes),proof=await json(rp.local);
 same(proof,{version:1,kind:'local_recovery_reservation_proof',current:plan.current,reservationSha256:hash(bytes),reviewSha256:hash(jsonBytes(review))});
 same(Object.keys(reservation).sort(),['version','kind','reviewId','reviewSha256','current','predecessor','predecessorPayloadSha256','predecessorFinalSha256','journalSha256','reservedAt','nonce','state','cacheKey'].sort());
 same(reservation.current,plan.current);same(reservation.predecessor,plan.predecessor);assert.equal(reservation.version,1);assert.equal(reservation.kind,'reviewed_recovery_consumption_reservation');assert.equal(reservation.reviewId,RECOVERY_ID);assert.equal(reservation.reviewSha256,proof.reviewSha256);assert.equal(reservation.cacheKey,RECOVERY_CACHE_KEY);assert.equal(reservation.predecessorPayloadSha256,review.payloadSha256);assert.equal(reservation.predecessorFinalSha256,review.finalReceiptSha256);assert.equal(reservation.journalSha256,review.journalSha256);assert.equal(reservation.state,'one_use_reserved_before_source_request');assert.match(reservation.nonce,/^[a-f0-9-]{36}$/);assert.ok(Date.parse(reservation.reservedAt)>=Date.parse(review.notBefore)&&Date.parse(reservation.reservedAt)<=Date.parse(now));
 for(const [path,expected]of [[rp.originalPayload,review.payloadSha256],[rp.originalFinal,review.finalReceiptSha256],[rp.originalJournal,review.journalSha256]])assert.equal(hash(await fs.readFile(path)),expected,'original evidence changed or lost');
 const access=noAccessRestriction();await access.drainDecisions();noAccessRestriction();
 const record={version:1,kind:'consumed_reviewed_eccc_recovery',reviewId:RECOVERY_ID,reviewSha256:proof.reviewSha256,consumptionSha256:hash(bytes),consumedBy:plan.current,originalPayloadSha256:review.payloadSha256,originalFinalSha256:review.finalReceiptSha256,originalJournalSha256:review.journalSha256};
 const handle=await openWeatherReviewJournal(fileURLToPath(rp.use),{event:'recovery_consumed_before_source_request',...record,consumedAt:now});await handle.close();
 const capability=Object.freeze({reviewId:RECOVERY_ID});capabilities.set(capability,{envelopeSha256:hash(jsonBytes(envelope)),used:false,transportStarted:false,notBefore:review.notBefore,expiresAt:review.expiresAt,record});return {capability,record};
}
export function consumeReviewedRecoveryCapability(capability,previous){
 const admitted=capabilities.get(capability);assert.ok(admitted&&!admitted.used,'no unused reviewed recovery capability');assert.equal(hash(jsonBytes(previous)),admitted.envelopeSha256,'recovery does not match the exact failed envelope');noAccessRestriction();admitted.used=true;return admitted.record;
}
export function validateRecoveryHistory(record){
 same(Object.keys(record).sort(),['version','kind','reviewId','reviewSha256','consumptionSha256','consumedBy','originalPayloadSha256','originalFinalSha256','originalJournalSha256'].sort());assert.equal(record.version,1);assert.equal(record.kind,'consumed_reviewed_eccc_recovery');assert.equal(record.reviewId,RECOVERY_ID);sha(record.reviewSha256);sha(record.consumptionSha256);assert.equal(record.originalPayloadSha256,RECOVERY_BINDING.payloadSha256);assert.equal(record.originalFinalSha256,RECOVERY_BINDING.finalReceiptSha256);assert.equal(record.originalJournalSha256,RECOVERY_BINDING.journalSha256);assert.equal(record.consumedBy.runNumber,2);assert.equal(record.consumedBy.runAttempt,1);for(const key of ['repository','repositoryId','workflowPath','workflowId','ref'])assert.equal(record.consumedBy[key],ORIGINAL_IDENTITY[key]);assert.match(record.consumedBy.runId,/^[1-9]\d*$/);assert.match(record.consumedBy.sha,/^[a-f0-9]{40}$/);return record;
}

export function beforeReviewedRecoveryRequest(capability,target){
 const admitted=capabilities.get(capability);assert.ok(admitted?.used&&!admitted.transportStarted,'reviewed recovery permits only one source request');assert.equal(String(target),ENDPOINT);const now=Date.now();assert.ok(now>=Date.parse(admitted.notBefore)&&now<Date.parse(admitted.expiresAt),'reviewed recovery expired before transport');noAccessRestriction();admitted.transportStarted=true;
}
