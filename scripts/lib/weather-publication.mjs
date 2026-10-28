// Weather-only artifact contract; never trusts executable JS supplied by a producer.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {hash} from './eccc-weather.mjs';
import {MANIFEST_PATH,jsonBytes,validateCapture,weatherBrowserBytes,loadCurrentWeather} from './weather-capture.mjs';
import {validateWeatherCache} from '../weather-preview-lineage.mjs';
import {verifyFinalReceipt} from './weather-run-lineage.mjs';
export const WEATHER_ARTIFACT='weather-preview';
export const WEATHER_REVIEW_FILES=['artifacts/weather-publication-contract.json','artifacts/weather-preview.json','artifacts/weather-preview-final.json'];
export const WEATHER_DATA_FILES=['data/weather/current.json','data/build/halifax-weather.json','data/weather.js'];
export async function weatherCodeDigest(root){
  // No expedited gate: this is an additional unchanged-code check. Include all
  // tracked code/workflows/vendor/schema/config, excluding only data/docs/reports.
  const paths=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(p=>p&&!/^(data|docs|artifacts)\//.test(p)&&!/\.md$/.test(p)).sort();
  assert.ok(paths.includes('app-weather.js')&&paths.includes('weather-contract.js'));
  return hash(JSON.stringify(await Promise.all(paths.map(async p=>[p,hash(await readFile(resolve(root,p)))]))));
}
export async function packageWeather({root,output,payloadBytes,receipt,identity}){
  verifyFinalReceipt(receipt,identity,payloadBytes);
  const payload=validateWeatherCache(JSON.parse(payloadBytes));
  const manifest=payload.manifest,envelope=validateCapture(manifest,jsonBytes(payload.capture));
  // Deferred/held carry-forward runs are evidence only, not new publication.
  if(!['collected','not_modified'].includes(payload.decision))return false;
  assert.deepEqual(manifest.sourceRun,identity);
  const contract={version:1,kind:'weather_only_publication',identity,codeSha256:await weatherCodeDigest(root),payloadSha256:hash(payloadBytes)};
  const files={[MANIFEST_PATH]:jsonBytes(manifest),[manifest.capturePath]:jsonBytes(payload.capture),'data/build/halifax-weather.json':jsonBytes(envelope),'data/weather.js':weatherBrowserBytes(envelope),'artifacts/weather-publication-contract.json':jsonBytes(contract),'artifacts/weather-preview.json':payloadBytes,'artifacts/weather-preview-final.json':jsonBytes(receipt)};
  for(const [path,bytes]of Object.entries(files)){await mkdir(dirname(resolve(output,path)),{recursive:true});await writeFile(resolve(output,path),bytes,{flag:'wx'});}
  return true;
}
export async function validateWeatherArtifact({root,artifactRoot,artifactFiles,runId,headSha}){
  const read=p=>readFile(resolve(artifactRoot,p),'utf8');
  const contract=JSON.parse(await read(WEATHER_REVIEW_FILES[0]));
  assert.deepEqual(Object.keys(contract).sort(),['codeSha256','identity','kind','payloadSha256','version']);assert.equal(contract.version,1);assert.equal(contract.kind,'weather_only_publication');
  assert.equal(contract.identity.repository,'JeremyHennessy/HalifaxSourced');assert.equal(contract.identity.workflowPath,'.github/workflows/weather-preview.yml');assert.equal(contract.identity.runAttempt,1);assert.equal(contract.identity.ref,'refs/heads/main');assert.equal(contract.identity.runId,String(runId));assert.match(headSha||'',/^[a-f0-9]{40}$/);assert.equal(contract.identity.sha,headSha,'producer run SHA mismatch');
  assert.equal(contract.codeSha256,await weatherCodeDigest(root),'tested app/code baseline changed; recollect/review, never restore an old tree');
  const bytes=await read('artifacts/weather-preview.json');assert.equal(hash(bytes),contract.payloadSha256);verifyFinalReceipt(JSON.parse(await read('artifacts/weather-preview-final.json')),contract.identity,bytes);
  const payload=validateWeatherCache(JSON.parse(bytes));assert.ok(['collected','not_modified'].includes(payload.decision));assert.deepEqual(payload.manifest.sourceRun,contract.identity);
  const manifest=JSON.parse(await read(MANIFEST_PATH));assert.deepEqual(manifest,payload.manifest);
  const promoted=[...WEATHER_DATA_FILES,manifest.capturePath];assert.deepEqual(artifactFiles.slice().sort(),[...promoted,...WEATHER_REVIEW_FILES].sort(),'unexpected or missing weather artifact files');
  const captureBytes=await read(manifest.capturePath);assert.equal(captureBytes,jsonBytes(payload.capture));const envelope=validateCapture(manifest,captureBytes);
  assert.equal(await read('data/build/halifax-weather.json'),jsonBytes(envelope),'derived weather JSON mismatch');assert.equal(await read('data/weather.js'),weatherBrowserBytes(envelope),'weather browser wrapper mismatch');
  const current=await loadCurrentWeather(pathToRoot(root));
  assert.ok(Date.parse(manifest.lastAttempt.completedAt)>=Date.parse(current.manifest.lastAttempt.completedAt),'weather attempt rollback');
  assert.ok(Date.parse(envelope.lastKnownGood.retrievedAt)>=Date.parse(current.envelope.lastKnownGood.retrievedAt),'weather capture rollback');
  if(manifest.lastAttempt.status!=='success')assert.equal(manifest.captureSha256,current.manifest.captureSha256,'failure/304 cannot replace last-known-good');
  try{assert.equal(await readFile(resolve(root,manifest.capturePath),'utf8'),captureBytes,'cannot overwrite immutable evidence');}catch(e){if(e.code!=='ENOENT')throw e;}
  return promoted;
}
import {pathToFileURL} from 'node:url';
const pathToRoot=root=>pathToFileURL(resolve(root)+'/');
