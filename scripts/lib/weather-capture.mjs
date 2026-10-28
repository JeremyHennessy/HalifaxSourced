// Accepted captures are immutable evidence; fixtures are only regression inputs.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {projectEccc,acceptedEnvelope,hash,stamp} from './eccc-weather.mjs';
export const MANIFEST_PATH='data/weather/current.json';
export const jsonBytes=value=>JSON.stringify(value,null,2)+'\n';
const keys=(value,expected)=>assert.deepEqual(Object.keys(value).sort(),expected.slice().sort(),'unexpected capture/manifest fields');
export function captureBundle(body,receipt){projectEccc(body,receipt);return {version:1,body,receipt};}
export function captureManifest(capture,{mode='recorded_snapshot_no_refresh',lastAttempt=null,sourceRun=null}={}){
  const bytes=jsonBytes(capture),digest=hash(bytes);
  return {version:1,kind:'accepted_eccc_halifax_capture',mode,capturePath:`data/weather/captures/${digest}.json`,captureSha256:digest,lastAttempt:lastAttempt||acceptedEnvelope(projectEccc(capture.body,capture.receipt),capture.receipt).lastAttempt,sourceRun};
}
export function validateCapture(manifest,captureBytes){
  keys(manifest,['version','kind','mode','capturePath','captureSha256','lastAttempt','sourceRun']);
  assert.equal(manifest.version,1);assert.equal(manifest.kind,'accepted_eccc_halifax_capture');
  assert.ok(['recorded_snapshot_no_refresh','reviewed_refresh'].includes(manifest.mode));
  assert.match(manifest.captureSha256,/^[a-f0-9]{64}$/);assert.equal(manifest.capturePath,`data/weather/captures/${manifest.captureSha256}.json`);
  assert.equal(hash(captureBytes),manifest.captureSha256,'immutable capture digest');
  const capture=JSON.parse(captureBytes);keys(capture,['version','body','receipt']);assert.equal(capture.version,1);
  assert.equal(capture.receipt.version,1);
  const data=projectEccc(capture.body,capture.receipt);
  data.fixture=capture.receipt.kind==='manual_source_admission_probe';
  data.admissionState=data.fixture?'reviewed_eccc_recorded_snapshot_not_operationally_activated':'reviewed_eccc_refresh';
  const attempt=manifest.lastAttempt;assert.ok(attempt&&typeof attempt==='object');
  assert.ok(['success','not_modified','failed','held','partial','pending'].includes(attempt.status));
  stamp(attempt.attemptedAt);stamp(attempt.completedAt);assert.ok(Date.parse(attempt.completedAt)>=Date.parse(attempt.attemptedAt));
  assert.ok(Date.parse(attempt.completedAt)>=Date.parse(capture.receipt.retrievedAt),'attempt cannot predate retained capture');
  if(attempt.status==='success')assert.deepEqual(attempt,acceptedEnvelope(data,capture.receipt).lastAttempt);
  else {assert.ok(Date.parse(attempt.attemptedAt)>=Date.parse(capture.receipt.retrievedAt));assert.ok(Object.keys(attempt).every(k=>['status','attemptedAt','completedAt','reason'].includes(k)));}
  if(attempt.reason!==undefined)assert.ok(typeof attempt.reason==='string'&&attempt.reason.length<=240);
  if(manifest.mode==='recorded_snapshot_no_refresh')assert.equal(manifest.sourceRun,null);
  else {assert.ok(manifest.sourceRun&&typeof manifest.sourceRun==='object');keys(manifest.sourceRun,['repository','repositoryId','workflowPath','workflowId','runId','runNumber','runAttempt','sha','ref']);for(const key of ['repositoryId','workflowId','runId'])assert.match(manifest.sourceRun[key],/^[1-9][0-9]*$/);assert.ok(Number.isSafeInteger(manifest.sourceRun.runNumber)&&manifest.sourceRun.runNumber>0);assert.equal(manifest.sourceRun.ref,'refs/heads/main');assert.equal(manifest.sourceRun.repository,'JeremyHennessy/HalifaxSourced');assert.equal(manifest.sourceRun.workflowPath,'.github/workflows/weather-preview.yml');assert.match(manifest.sourceRun.sha,/^[a-f0-9]{40}$/);assert.equal(manifest.sourceRun.runAttempt,1);}
  return {version:1,activation:manifest.mode,lastAttempt:attempt,lastKnownGood:data};
}
export async function loadCurrentWeather(root=new URL('../../',import.meta.url)){
  const manifest=JSON.parse(await readFile(new URL(MANIFEST_PATH,root),'utf8'));
  assert.match(manifest.capturePath||'',/^data\/weather\/captures\/[a-f0-9]{64}\.json$/);
  const captureBytes=await readFile(new URL(manifest.capturePath,root),'utf8');
  return {manifest,captureBytes,capture:JSON.parse(captureBytes),envelope:validateCapture(manifest,captureBytes)};
}
export const weatherBrowserBytes=envelope=>'// Accepted ECCC evidence. Offline builds preserve all original clocks.\nwindow.HalifaxWeather = '+jsonBytes(envelope).trim()+';\n';
export async function writeIfChanged(path,bytes){let before;try{before=await readFile(path,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}if(before!==bytes)await writeFile(path,bytes);}
export async function preserveCapture(root,capture){const manifest=captureManifest(capture),path=resolve(root,manifest.capturePath);await mkdir(dirname(path),{recursive:true});try{await writeFile(path,jsonBytes(capture),{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;assert.equal(await readFile(path,'utf8'),jsonBytes(capture),'never replace capture');}return manifest;}
