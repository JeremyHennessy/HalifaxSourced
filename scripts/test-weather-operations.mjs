// Offline fixtures only: no external source or metadata requests.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm,readdir,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {captureBundle,captureManifest,validateCapture,loadCurrentWeather,jsonBytes,weatherBrowserBytes,preserveCapture} from './lib/weather-capture.mjs';
import {packageWeather,validateWeatherArtifact} from './lib/weather-publication.mjs';
import {finalReceipt} from './lib/weather-run-lineage.mjs';
import {collectEcccReview} from './lib/eccc-weather-adapter.mjs';
import {validateWeatherCache} from './weather-preview-lineage.mjs';
import {LANES,planPreviewUpdates,laneForPath} from './lib/preview-coordinator.mjs';
import contract from '../weather-contract.js';
const copy=x=>structuredClone(x),read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
const fixture=captureBundle(await read('scripts/fixtures/weather/eccc-citypage-20261028.json'),JSON.parse(await read('scripts/fixtures/weather/eccc-citypage-20261028-receipt.json')));
const fixtureManifest=captureManifest(fixture);
const actual={capture:fixture,manifest:fixtureManifest,envelope:validateCapture(fixtureManifest,jsonBytes(fixture))};
await loadCurrentWeather(); // Actual packaged capture must also pass semantics, whatever its accepted date/outcome.
const registry=JSON.parse(await read('data/weather-source-registry.json'));registry.sources[0].enabled=true; // memory only
const identity={repository:'JeremyHennessy/HalifaxSourced',repositoryId:'123',workflowPath:'.github/workflows/weather-preview.yml',workflowId:'44',runId:'200',runNumber:2,runAttempt:1,sha:'b'.repeat(40),ref:'refs/heads/main'};
const receipt={...actual.capture.receipt,kind:'guarded_weather_review',attemptedAt:'2026-10-28T02:43:00Z',responseAt:'2026-10-28T02:43:02Z',retrievedAt:'2026-10-28T02:43:03Z'};
const capture=captureBundle(actual.capture.body,receipt),manifest=captureManifest(capture,{mode:'reviewed_refresh',sourceRun:identity});
const envelope=validateCapture(manifest,jsonBytes(capture));
assert.equal(envelope.lastKnownGood.retrievedAt,receipt.retrievedAt);assert.equal(envelope.lastKnownGood.observations[0].observedAt,actual.envelope.lastKnownGood.observations[0].observedAt);
assert.equal(envelope.lastKnownGood.forecast.issuedAt,actual.envelope.lastKnownGood.forecast.issuedAt);assert.equal(envelope.lastKnownGood.fixture,false);
assert.equal(contract.evaluate(envelope,Date.parse(receipt.retrievedAt)).observations[0].status,'stale','new receipt never freshens old observation');
assert.equal(contract.evaluate(envelope,Date.parse(receipt.retrievedAt)).warnings.status,'unavailable','new receipt never freshens old warning source clock');
for(const mutate of [m=>m.capturePath='../fixture.json',m=>m.captureSha256='0'.repeat(64),m=>m.extra=true,m=>m.lastAttempt.completedAt='2099-01-01T00:00:00Z',m=>m.sourceRun.workflowPath='.github/workflows/news-preview.yml']){const m=copy(manifest);mutate(m);assert.throws(()=>validateCapture(m,jsonBytes(capture)));}
assert.throws(()=>validateCapture(manifest,jsonBytes({...capture,body:'{}'})));
const temp=await mkdtemp(join(tmpdir(),'weather-operations-'));
const fetchBefore=globalThis.fetch;globalThis.fetch=()=>assert.fail('external network forbidden');
try{
  // Immutable originals and future accepted body receipts coexist.
  const saved=await preserveCapture(temp,capture);await preserveCapture(temp,capture);assert.equal(saved.captureSha256,manifest.captureSha256);
  await writeFile(join(temp,saved.capturePath),'tampered');await assert.rejects(preserveCapture(temp,capture),/never replace/);
  const root=join(temp,'repo');await mkdir(root);execFileSync('git',['init','-q'],{cwd:root});
  for(const p of ['app-weather.js','weather-contract.js','data/weather/current.json',actual.manifest.capturePath]){await mkdir(dirname(join(root,p)),{recursive:true});await writeFile(join(root,p),p==='data/weather/current.json'?jsonBytes(actual.manifest):p===actual.manifest.capturePath?jsonBytes(actual.capture):await read(p));}
  execFileSync('git',['add','.'],{cwd:root});
  const payload={version:1,manifest,capture,blocked:false,decision:'collected'},bytes=jsonBytes(payload),final=finalReceipt(identity,bytes),artifactRoot=join(temp,'artifact');
  assert.equal(await packageWeather({root,output:artifactRoot,payloadBytes:bytes,receipt:final,identity}),true);
  const files=async (base,path='')=>(await Promise.all((await readdir(join(base,path),{withFileTypes:true})).map(e=>e.isDirectory()?files(base,join(path,e.name)):join(path,e.name)))).flat();
  const artifactFiles=await files(artifactRoot),options={root,artifactRoot,artifactFiles,runId:'200',headSha:identity.sha};
  assert.deepEqual((await validateWeatherArtifact(options)).sort(),['data/weather/current.json','data/build/halifax-weather.json','data/weather.js',manifest.capturePath].sort());
  await assert.rejects(validateWeatherArtifact({...options,artifactFiles:[...artifactFiles,'data/news.js']}),/unexpected/);
  await assert.rejects(validateWeatherArtifact({...options,artifactFiles:artifactFiles.filter(p=>p!=='data/weather.js')}),/unexpected/);
  await assert.rejects(validateWeatherArtifact({...options,runId:'201'}));
  await assert.rejects(validateWeatherArtifact({...options,headSha:'c'.repeat(40)}),/run SHA mismatch/);
  const js=await readFile(join(artifactRoot,'data/weather.js'),'utf8');await writeFile(join(artifactRoot,'data/weather.js'),js+'alert(1)');await assert.rejects(validateWeatherArtifact(options),/wrapper mismatch/);await writeFile(join(artifactRoot,'data/weather.js'),js);
  const code=await readFile(join(root,'app-weather.js'),'utf8');await writeFile(join(root,'app-weather.js'),code+'\n// changed rendering');await assert.rejects(validateWeatherArtifact(options),/baseline changed/);await writeFile(join(root,'app-weather.js'),code);
  const malformed=copy(payload);malformed.manifest.lastAttempt={status:'failed',attemptedAt:'2026-10-28T03:00:00Z',completedAt:'2026-10-28T03:00:01Z'};assert.throws(()=>validateWeatherCache(malformed),/lost failure hold/);
  // Run the actual existing promoter against a private checkout; no GitHub/API calls.
  await writeFile(join(root,'data/news.js'),'fixture news must remain untouched');
  execFileSync(process.execPath,[fileURLToPath(new URL('promote-preview-artifacts.mjs',import.meta.url))],{cwd:root,env:{...process.env,ARTIFACT_NAME:'weather-preview',ARTIFACT_DIR:artifactRoot,ARTIFACT_RUN_ID:'200',ARTIFACT_HEAD_SHA:identity.sha,BASE_COMMIT_SHA:identity.sha,SOURCE_WORKFLOW_NAME:'ECCC Halifax Weather Preview (Review Required)'},stdio:'pipe'});
  assert.equal(await readFile(join(root,'data/news.js'),'utf8'),'fixture news must remain untouched');
  assert.equal(await readFile(join(root,'data/weather.js'),'utf8'),weatherBrowserBytes(envelope));
  assert.equal(await readFile(join(root,actual.manifest.capturePath),'utf8'),jsonBytes(actual.capture));
  assert.equal(await readFile(join(root,manifest.capturePath),'utf8'),jsonBytes(capture));
  assert.equal(JSON.parse(await readFile(join(root,'data/build/promotion-receipts/weather-preview.json'),'utf8')).state,'prepared-for-review');
  // Actual adapter conditional transport: no invented validators, 304 keeps all old clocks.
  const conditional=copy(actual.capture);conditional.receipt.responseHeaders.etag='"fixture-etag"';conditional.receipt.responseHeaders['last-modified']='Wed, 28 Oct 2026 00:43:33 GMT';let requests=0;
  globalThis.fetch=async(url,options)=>{requests++;assert.equal(options.headers['If-None-Match'],'"fixture-etag"');assert.equal(options.headers['If-Modified-Since'],'Wed, 28 Oct 2026 00:43:33 GMT');assert.equal(options.headers['Cache-Control'],undefined);assert.match(await readFile(join(temp,'304.jsonl'),'utf8'),/pending/);return new Response(null,{status:304});};
  const unchanged=await collectEcccReview({registry,previous:actual.envelope,previousCapture:conditional,journalPath:join(temp,'304.jsonl')});assert.equal(requests,1);assert.equal(unchanged.candidate.lastAttempt.status,'not_modified');assert.strictEqual(unchanged.candidate.lastKnownGood,actual.envelope.lastKnownGood);assert.deepEqual(unchanged.receipt,conditional.receipt);assert.equal(unchanged.validationReceipt.retainedBodySha256,actual.capture.receipt.sha256);assert.equal(contract.evaluate(unchanged.candidate,Date.now()).warnings.status,'unavailable');
  globalThis.fetch=async()=>new Response(null,{status:304});const unsolicited=await collectEcccReview({registry,previous:actual.envelope,journalPath:join(temp,'bad304.jsonl')});assert.equal(unsolicited.candidate.lastAttempt.status,'failed');
  globalThis.fetch=async()=>new Response(new Uint8Array([0xff,0xfe]),{headers:{'content-type':'application/json'}});const invalidUtf8=await collectEcccReview({registry,previous:actual.envelope,journalPath:join(temp,'bad-utf8.jsonl')});assert.equal(invalidUtf8.candidate.lastAttempt.status,'failed');assert.deepEqual(invalidUtf8.candidate.lastKnownGood,actual.envelope.lastKnownGood);
  globalThis.fetch=async()=>new Response(Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(actual.capture.body)]),{headers:{'content-type':'application/json'}});const bom=await collectEcccReview({registry,previous:actual.envelope,journalPath:join(temp,'bad-bom.jsonl')});assert.equal(bom.candidate.lastAttempt.status,'failed','never silently strip source bytes before hashing');
  const broken=copy(conditional);broken.receipt.responseHeaders.etag='bad\r\nheader';await assert.rejects(collectEcccReview({registry,previous:actual.envelope,previousCapture:broken,journalPath:join(temp,'bad-validator.jsonl')}));
}finally{globalThis.fetch=fetchBefore;await rm(temp,{recursive:true,force:true});}
const lane=LANES.find(x=>x.artifact==='weather-preview');assert.equal(lane.manualOnly,true);assert.equal(laneForPath(manifest.capturePath),'weather');assert.equal(laneForPath('data/news.js'),null);
const run={id:200,name:lane.workflow,path:'.github/workflows/weather-preview.yml',status:'completed',conclusion:'success',head_branch:'main',head_repository:{full_name:identity.repository},event:'workflow_dispatch',created_at:'2026-10-28T03:00:00Z',artifacts:[{name:lane.artifact,expired:false}]};
const state={repository:identity.repository,now:'2026-10-28T03:01:00Z',lanes:{[lane.artifact]:{runs:[run]}},openPulls:[]};
assert.equal(planPreviewUpdates(state).matrix.include.length,0,'no automatic weather promotion');assert.equal(planPreviewUpdates({...state,manual:{artifact:lane.artifact,runId:200}}).matrix.include.length,1);
assert.equal(planPreviewUpdates({...state,manual:{artifact:lane.artifact,runId:200},openPulls:[{reservedGroups:['weather']}]}).matrix.include.length,0,'active weather review reserved');
const workflow=await read('.github/workflows/weather-preview.yml');assert.doesNotMatch(workflow,/^  (?:schedule|push|pull_request|pull_request_target):/m);assert.doesNotMatch(workflow,/contents: write|pull-requests: write|restore-keys:|gh workflow run|git push/);assert.match(workflow,/if: always\(\)/);assert.match(workflow,/eccc-weather-review-journal\.jsonl/);
console.log('Weather operations passed: immutable/current separation, true clocks, strict schema/hash parity, 304 and validator handling, LKG retention, weather-only publication/malicious JS rejection, unchanged-code baseline, manual review reservation; zero external requests.');
