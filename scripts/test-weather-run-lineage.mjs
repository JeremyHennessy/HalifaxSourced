import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {environmentIdentity,resolveWeatherLineage,githubMetadata,cacheKey,finalReceipt,verifyFinalReceipt,requireExactCache,WEATHER_REPOSITORY,WEATHER_WORKFLOW} from './lib/weather-run-lineage.mjs';
import {lineagePaths,createLineagePlan,collectWithLineage,completeLineage,verifyReceiptSaved,weatherCollectionOutcome,reportWeatherOutcome} from './weather-preview-lineage.mjs';
import {captureBundle,captureManifest,jsonBytes,validateCapture} from './lib/weather-capture.mjs';
globalThis.fetch=()=>{throw Error('network_forbidden_in_weather_lineage_tests');};
const copy = value => structuredClone(value);
const env = {GITHUB_REPOSITORY:WEATHER_REPOSITORY,GITHUB_REPOSITORY_ID:'123',GITHUB_SERVER_URL:'https://github.com',GITHUB_API_URL:'https://api.github.com',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ID:'200',GITHUB_RUN_NUMBER:'2',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:'b'.repeat(40),GITHUB_REF:'refs/heads/main',GITHUB_WORKFLOW_REF:`${WEATHER_REPOSITORY}/${WEATHER_WORKFLOW}@refs/heads/main`,WEATHER_INITIALIZE_REVIEW_CACHE:'false'};
const repository = {id:123,full_name:WEATHER_REPOSITORY,private:false,default_branch:'main'};
const prior = {id:100,workflow_id:44,run_number:1,run_attempt:1,repository,path:WEATHER_WORKFLOW,head_sha:'a'.repeat(40),head_branch:'main',event:'workflow_dispatch',status:'completed',conclusion:'success'};
const current = {...prior,id:200,run_number:2,head_sha:env.GITHUB_SHA,status:'in_progress',conclusion:null};
function metadataFixture({repo=repository,run=current,predecessor=prior,list={total_count:2,workflow_runs:[current,prior]},onCall=()=>{}} = {}) {
  return async path => {
    onCall(path);
    if (path === `/repos/${WEATHER_REPOSITORY}`) return copy(repo);
    if (path === `/repos/${WEATHER_REPOSITORY}/actions/runs/${run.id}`) return copy(run);
    if (path === `/repos/${WEATHER_REPOSITORY}/actions/runs/${predecessor.id}`) return copy(predecessor);
    if (path === `/repos/${WEATHER_REPOSITORY}/actions/workflows/${run.workflow_id}/runs?per_page=100&page=1`) return copy(list);
    throw new Error(`unexpected_fixture_metadata_path:${path}`);
  };
}
const plan = await resolveWeatherLineage({env,metadata:metadataFixture()});
assert.equal(plan.predecessor.runNumber,1);
assert.match(plan.cacheKey,/^weather-review-v1-123-44-2-200-1-b{40}$/);
const bootEnv = {...env,GITHUB_RUN_ID:'100',GITHUB_RUN_NUMBER:'1',GITHUB_SHA:prior.head_sha,WEATHER_INITIALIZE_REVIEW_CACHE:'true'};
const bootMeta = metadataFixture({run:{...prior,status:'in_progress',conclusion:null}});
assert.equal((await resolveWeatherLineage({env:bootEnv,metadata:bootMeta})).predecessor,null);
for (const patch of [{GITHUB_RUN_ATTEMPT:'2'},{GITHUB_RUN_ATTEMPT:'01'},{GITHUB_RUN_NUMBER:'0'},{GITHUB_RUN_NUMBER:'NaN'},{GITHUB_REPOSITORY_ID:'wrong'},{GITHUB_SHA:'bad'},{GITHUB_REPOSITORY:'evil/fork'},{GITHUB_SERVER_URL:'https://example.org'},{GITHUB_API_URL:'https://example.org'},{GITHUB_EVENT_NAME:'pull_request'},{GITHUB_WORKFLOW_REF:'other'},{WEATHER_INITIALIZE_REVIEW_CACHE:undefined}]) {
 let reads=0; await assert.rejects(resolveWeatherLineage({env:{...env,...patch},metadata:async()=>{reads++;throw new Error('must_not_read');}})); assert.equal(reads,0);
}
for (const patch of [{private:true},{default_branch:'other'},{id:124},{full_name:'other/repo'}]) await assert.rejects(resolveWeatherLineage({env,metadata:metadataFixture({repo:{...repository,...patch}})}));
for (const patch of [{run_attempt:2},{run_number:3},{head_sha:'c'.repeat(40)},{workflow_id:null},{path:'.github/workflows/other.yml'},{repository:{...repository,id:124}},{status:'completed',conclusion:'success'},{status:'queued'},{head_branch:'feature'},{event:'push'}]) await assert.rejects(resolveWeatherLineage({env,metadata:metadataFixture({run:{...current,...patch}})}));
for (const status of ['failure','cancelled','timed_out','skipped','neutral','action_required','stale',null]) await assert.rejects(resolveWeatherLineage({env,metadata:metadataFixture({predecessor:{...prior,conclusion:status}})}));
for (const patch of [{status:'in_progress'},{run_attempt:2},{workflow_id:45},{head_sha:'c'.repeat(40)},{run_number:0},{head_branch:'feature'},{path:'.github/workflows/other.yml'},{repository:{...repository,id:124}}]) await assert.rejects(resolveWeatherLineage({env,metadata:metadataFixture({predecessor:{...prior,...patch}})}));
for (const list of [{total_count:0,workflow_runs:[]},{total_count:2,workflow_runs:[current,{...prior,run_number:3}]},{total_count:3,workflow_runs:[current,prior,prior]}, {}, {total_count:0,workflow_runs:[prior]}, {total_count:1,workflow_runs:[{}]}]) await assert.rejects(resolveWeatherLineage({env,metadata:metadataFixture({list})}));
await assert.rejects(resolveWeatherLineage({env:{...env,WEATHER_INITIALIZE_REVIEW_CACHE:'true'},metadata:metadataFixture({list:{total_count:0,workflow_runs:[]}})}),/bootstrap_is_not_recovery/);
await assert.rejects(resolveWeatherLineage({env:{...bootEnv,WEATHER_INITIALIZE_REVIEW_CACHE:'false'},metadata:bootMeta}),/bootstrap_required/);
await assert.rejects(resolveWeatherLineage({env,metadata:async()=>{throw new Error('api_unavailable');}}));
for (const hit of ['false','',undefined]) assert.throws(()=>requireExactCache({hit,matchedKey:plan.predecessorCacheKey,expectedKey:plan.predecessorCacheKey}));
assert.throws(()=>requireExactCache({hit:'true',matchedKey:`${plan.predecessorCacheKey}-other`,expectedKey:plan.predecessorCacheKey}));

// Test bounded official-API transport itself, including no credentials/redirects.
const goodApi = async(url,options) => {assert.equal(url,`https://api.github.com/repos/${WEATHER_REPOSITORY}`);assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.authorization,undefined);return new Response(JSON.stringify(repository),{headers:{'content-type':'application/json'}});};
assert.deepEqual(await githubMetadata(`/repos/${WEATHER_REPOSITORY}`,{fetchImpl:goodApi}),repository);
for (const response of [new Response('{}',{status:403,headers:{'content-type':'application/json'}}),new Response('{}',{status:429,headers:{'content-type':'application/json'}}),new Response('{}',{headers:{'content-type':'text/html'}}),new Response('not-json',{headers:{'content-type':'application/json'}}),new Response('{}',{headers:{'content-type':'application/json','content-length':'2000001'}}),new Response('x'.repeat(2_000_001),{headers:{'content-type':'application/json'}})]) await assert.rejects(githubMetadata(`/repos/${WEATHER_REPOSITORY}`,{fetchImpl:async()=>response}));
await assert.rejects(githubMetadata('https://publisher.example/feed',{fetchImpl:()=>assert.fail('invalid path requested')}));

// Schedules may only continue an established chain, never bootstrap or impersonate dispatch.
assert.equal((await resolveWeatherLineage({env:{...env,GITHUB_EVENT_NAME:'schedule'},metadata:metadataFixture({run:{...current,event:'schedule'}})})).predecessor.runNumber,1);
await assert.rejects(resolveWeatherLineage({env:{...bootEnv,GITHUB_EVENT_NAME:'schedule'},metadata:bootMeta}));
await assert.rejects(resolveWeatherLineage({env:{...env,GITHUB_EVENT_NAME:'schedule'},metadata:metadataFixture()}),/event_mismatch/);
// Both official predecessor metadata reads and every plan/collect event must agree.
await assert.rejects(resolveWeatherLineage({env,metadata:metadataFixture({predecessor:{...prior,event:'schedule'}})}),/invalid_run_metadata/);
const eventPrior={...prior,id:150,run_number:2,event:'workflow_dispatch'},eventCurrent={...current,id:250,run_number:3};
const eventEnv={...env,GITHUB_RUN_ID:'250',GITHUB_RUN_NUMBER:'3'};
await assert.rejects(resolveWeatherLineage({env:eventEnv,metadata:metadataFixture({run:eventCurrent,predecessor:{...eventPrior,event:'schedule'},list:{total_count:3,workflow_runs:[eventCurrent,eventPrior]}})}),/predecessor_not_exact_success_attempt_one/);
const fixture=captureBundle(await readFile(new URL('fixtures/weather/eccc-citypage-20261028.json',import.meta.url),'utf8'),JSON.parse(await readFile(new URL('fixtures/weather/eccc-citypage-20261028-receipt.json',import.meta.url),'utf8')));
const fixtureManifest=captureManifest(fixture),accepted={capture:fixture,manifest:fixtureManifest,envelope:validateCapture(fixtureManifest,jsonBytes(fixture))},registry=JSON.parse(await readFile(new URL('../data/weather-source-registry.json',import.meta.url),'utf8'));registry.sources[0].enabled=true;
const base={version:1,manifest:accepted.manifest,capture:accepted.capture,blocked:false,decision:'bootstrap'};
const bytes=Buffer.from(jsonBytes(base)),receipt=finalReceipt(plan.predecessor,bytes);
for(const patch of [{version:3},{kind:'news_preview_final'},{identity:{...receipt.identity,runId:'101'}},{identity:{...receipt.identity,runAttempt:2}},{cacheKey:'weather-review-v0'},{transportDecisionsDrained:false},{payloadCacheVerified:false},{payloadSha256:'0'.repeat(64)},{unknown:true}])assert.throws(()=>verifyFinalReceipt({...receipt,...patch},plan.predecessor,bytes));
assert.throws(()=>verifyFinalReceipt(receipt,plan.predecessor,Buffer.from(bytes+' ')));
const restoreEnv={...env,WEATHER_PAYLOAD_CACHE_HIT:'true',WEATHER_PAYLOAD_CACHE_KEY:plan.predecessorCacheKey,WEATHER_RECEIPT_CACHE_HIT:'true',WEATHER_RECEIPT_CACHE_KEY:plan.predecessorCacheKey+'-final'};
let scenarios=0;
async function scenario(fn,{bootstrap=false,payload=base}={}){
 const dir=await mkdtemp(`${tmpdir()}/weather-lineage-`),paths=lineagePaths(pathToFileURL(dir+'/')),testEnv=copy(bootstrap?bootEnv:restoreEnv),metadata=bootstrap?bootMeta:metadataFixture();
 try{await createLineagePlan({env:testEnv,paths,metadata});if(!bootstrap){const b=jsonBytes(payload);await writeFile(paths.payload,b);await writeFile(paths.receipt,jsonBytes(finalReceipt(plan.predecessor,b)));}await fn({env:testEnv,paths,metadata,registry,current:accepted,now:Date.parse('2026-10-28T04:00:00Z'),drain:async()=>{}});scenarios++;}finally{await rm(dir,{recursive:true,force:true});}
}
async function blocked(change){await scenario(async c=>{let calls=0;c.collect=async()=>{calls++;assert.fail('transport forbidden');};await change(c);let old;try{old=await readFile(c.paths.collected,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}await assert.rejects(collectWithLineage(c));assert.equal(calls,0);if(old!==undefined)assert.equal(await readFile(c.paths.collected,'utf8'),old);else await assert.rejects(access(c.paths.collected),{code:'ENOENT'});});}
await blocked(async c=>{c.env.WEATHER_PAYLOAD_CACHE_HIT='false';});
await blocked(async c=>{c.env.WEATHER_RECEIPT_CACHE_HIT='false';});
await blocked(async c=>{c.env.WEATHER_RECEIPT_CACHE_KEY+='-other';});
await blocked(async c=>{await rm(c.paths.payload);});
await blocked(async c=>{await rm(c.paths.receipt);});
await blocked(async c=>{await writeFile(c.paths.payload,jsonBytes({...base,blocked:true}));});
await blocked(async c=>{await writeFile(c.paths.receipt,jsonBytes({...receipt,transportDecisionsDrained:false}));});
await blocked(async c=>{await writeFile(c.paths.journal,'pending');});
await blocked(async c=>{await writeFile(c.paths.collected,'{}');});
await blocked(async c=>{await writeFile(c.paths.predecessorReceipt,'{}');});
await blocked(async c=>{const p=JSON.parse(await readFile(c.paths.plan,'utf8'));p.current.sha='c'.repeat(40);await writeFile(c.paths.plan,jsonBytes(p));});
await blocked(async c=>{c.registry={...registry,sources:[{...registry.sources[0],enabled:false}]};});
await blocked(async c=>{c.metadata=metadataFixture({predecessor:{...prior,conclusion:'cancelled'}});});
await blocked(async c=>{const p=JSON.parse(await readFile(c.paths.plan,'utf8'));p.events.current='schedule';await writeFile(c.paths.plan,jsonBytes(p));});
await scenario(async c=>{let calls=0;await collectWithLineage({...c,now:Date.parse(accepted.manifest.lastAttempt.completedAt)+59999,collect:async()=>{calls++;}});assert.equal(calls,0);const p=JSON.parse(await readFile(c.paths.payload,'utf8'));assert.equal(p.decision,'cadence_deferred');assert.deepEqual(p.manifest,accepted.manifest);});
const held=copy(base);held.blocked=true;held.manifest.lastAttempt={status:'held',attemptedAt:'2026-10-28T01:43:00Z',completedAt:'2026-10-28T01:43:03Z',reason:'fixture_denial'};
await scenario(async c=>{let calls=0;await collectWithLineage({...c,now:Date.parse('2027-10-28T04:00:00Z'),collect:async()=>{calls++;}});assert.equal(calls,0);const p=JSON.parse(await readFile(c.paths.payload,'utf8'));assert.equal(p.blocked,true);assert.equal(p.decision,'retained_hold');assert.deepEqual(p.manifest,held.manifest);},{payload:held});
await scenario(async c=>{let calls=0,drained=false;await collectWithLineage({...c,collect:async()=>{calls++;return {candidate:{...accepted.envelope,lastAttempt:{status:'failed',attemptedAt:'2026-10-28T03:00:00Z',completedAt:'2026-10-28T03:00:01Z',reason:'fixture_schema_failure'}}};},drain:async()=>{drained=true;}});assert.equal(calls,1);assert.equal(drained,true);const p=JSON.parse(await readFile(c.paths.payload,'utf8'));assert.equal(p.blocked,true);assert.equal(p.decision,'rejected');assert.deepEqual(p.capture,accepted.capture);assert.deepEqual(validateCapture(p.manifest,jsonBytes(p.capture)).lastKnownGood,accepted.envelope.lastKnownGood);
 await assert.rejects(completeLineage(c),/exact_cache_missing/);
 const save={...c,env:{...c.env,WEATHER_SAVED_CACHE_HIT:'true',WEATHER_SAVED_CACHE_KEY:plan.cacheKey}};await completeLineage(save);await assert.rejects(verifyReceiptSaved(save),/exact_cache_missing/);
 await verifyReceiptSaved({...save,env:{...save.env,WEATHER_SAVED_CACHE_KEY:plan.cacheKey+'-final'}});
 await assert.rejects(completeLineage(save),{code:'EEXIST'});
 const f=JSON.parse(await readFile(c.paths.receipt,'utf8'));verifyFinalReceipt(f,plan.current,await readFile(c.paths.payload));const report=await reportWeatherOutcome(c);assert.equal(report.publicationEligible,false);assert.equal(report.sourceStatus,'failed');assert.equal(report.newCaptureAccepted,false);assert.match(report.summary,/successful cache persistence is not a successful weather refresh/);
});
// Collector rejection/late drain failure never creates a false completed marker.
for(const phase of ['collect','drain'])await scenario(async c=>{await assert.rejects(collectWithLineage({...c,collect:async()=>{if(phase==='collect')throw Error('fixture interruption');return {candidate:{...accepted.envelope,lastAttempt:{status:'failed',attemptedAt:'2026-10-28T03:00:00Z',completedAt:'2026-10-28T03:00:01Z'}}};},drain:async()=>{throw Error('fixture drain failure');}}));await assert.rejects(access(c.paths.collected),{code:'ENOENT'});});
await scenario(async c=>{await collectWithLineage({...c,collect:async()=>({candidate:{...accepted.envelope,lastAttempt:{status:'failed',attemptedAt:'2026-10-28T03:00:00Z',completedAt:'2026-10-28T03:00:01Z'}}})});assert.equal(JSON.parse(await readFile(c.paths.payload,'utf8')).blocked,true);},{bootstrap:true});
console.log(`Weather lineage passed: public exact-run identity/bootstrap/rerun/history rejection, exact cache/final digest, ${scenarios} persistence/hold/cadence/drain scenarios; zero external requests.`);
