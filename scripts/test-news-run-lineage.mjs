import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,access,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';
import { environmentIdentity,resolveNewsLineage,githubMetadata,cacheKey,finalReceipt,verifyFinalReceipt,requireExactCache,NEWS_REPOSITORY,NEWS_WORKFLOW } from './lib/news-run-lineage.mjs';
import { lineagePaths,createLineagePlan,collectWithLineage,completeLineage,verifyReceiptSaved,runCollector } from './news-preview-lineage.mjs';
import { collectNews } from './import-regional-news.mjs';
globalThis.fetch = () => { throw new Error('network_forbidden_in_news_lineage_tests'); };
const copy = value => structuredClone(value);
const env = {GITHUB_REPOSITORY:NEWS_REPOSITORY,GITHUB_REPOSITORY_ID:'123',GITHUB_SERVER_URL:'https://github.com',GITHUB_API_URL:'https://api.github.com',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ID:'200',GITHUB_RUN_NUMBER:'2',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:'b'.repeat(40),GITHUB_REF:'refs/heads/main',GITHUB_WORKFLOW_REF:`${NEWS_REPOSITORY}/${NEWS_WORKFLOW}@refs/heads/main`,NEWS_INITIALIZE_REVIEW_CACHE:'false'};
const repository = {id:123,full_name:NEWS_REPOSITORY,private:false,default_branch:'main'};
const prior = {id:100,workflow_id:44,run_number:1,run_attempt:1,repository,path:NEWS_WORKFLOW,head_sha:'a'.repeat(40),head_branch:'main',event:'workflow_dispatch',status:'completed',conclusion:'success'};
const current = {...prior,id:200,run_number:2,head_sha:env.GITHUB_SHA,status:'in_progress',conclusion:null};
function metadataFixture({repo=repository,run=current,predecessor=prior,list={total_count:2,workflow_runs:[current,prior]},onCall=()=>{}} = {}) {
  return async path => {
    onCall(path);
    if (path === `/repos/${NEWS_REPOSITORY}`) return copy(repo);
    if (path === `/repos/${NEWS_REPOSITORY}/actions/runs/${run.id}`) return copy(run);
    if (path === `/repos/${NEWS_REPOSITORY}/actions/runs/${predecessor.id}`) return copy(predecessor);
    if (path === `/repos/${NEWS_REPOSITORY}/actions/workflows/${run.workflow_id}/runs?per_page=100&page=1`) return copy(list);
    throw new Error(`unexpected_fixture_metadata_path:${path}`);
  };
}
const plan = await resolveNewsLineage({env,metadata:metadataFixture()});
assert.equal(plan.predecessor.runNumber,1);
assert.match(plan.cacheKey,/^news-review-v3-123-44-2-200-1-b{40}$/);
const bootEnv = {...env,GITHUB_RUN_ID:'100',GITHUB_RUN_NUMBER:'1',GITHUB_SHA:prior.head_sha,NEWS_INITIALIZE_REVIEW_CACHE:'true'};
const bootMeta = metadataFixture({run:{...prior,status:'in_progress',conclusion:null}});
assert.equal((await resolveNewsLineage({env:bootEnv,metadata:bootMeta})).predecessor,null);
function chainFixture(currentEvent,predecessorEvent='workflow_dispatch',runNumber=3) {
 const run={...current,event:currentEvent,run_number:runNumber};
 const predecessor={...prior,event:predecessorEvent,run_number:runNumber-1};
 return {
  env:{...env,GITHUB_EVENT_NAME:currentEvent,GITHUB_RUN_NUMBER:String(runNumber),NEWS_INITIALIZE_REVIEW_CACHE:currentEvent==='schedule'?undefined:'false'},
  metadata:metadataFixture({run,predecessor,list:{total_count:runNumber,workflow_runs:[run,predecessor]}}),run,predecessor
 };
}
const scheduledChain=chainFixture('schedule','workflow_dispatch',2);
const eventChains=['workflow_dispatch','schedule'].flatMap(currentEvent=>['workflow_dispatch','schedule'].map(predecessorEvent=>chainFixture(currentEvent,predecessorEvent)));
for (const chain of [scheduledChain,...eventChains]) {
 const resolved=await resolveNewsLineage(chain);
 assert.equal(resolved.current.runNumber,Number(chain.env.GITHUB_RUN_NUMBER));
 assert.equal(resolved.predecessor.runNumber,resolved.current.runNumber-1);
}
// Absent dispatch inputs are normal only on schedule; true never is. Preserve
// the v3 cache/receipt identity so a verified pre-schedule manual run remains usable.
for(const requested of [undefined,'','false']) {
 const scheduled=await resolveNewsLineage({...scheduledChain,env:{...scheduledChain.env,NEWS_INITIALIZE_REVIEW_CACHE:requested}});
 assert.deepEqual({...scheduled,events:plan.events},plan);
 assert.deepEqual(scheduled.events,{current:'schedule',predecessor:'workflow_dispatch'});
}
for (const patch of [{GITHUB_RUN_ATTEMPT:'2'},{GITHUB_RUN_ATTEMPT:'01'},{GITHUB_RUN_NUMBER:'0'},{GITHUB_RUN_NUMBER:'NaN'},{GITHUB_REPOSITORY_ID:'wrong'},{GITHUB_SHA:'bad'},{GITHUB_REPOSITORY:'evil/fork'},{GITHUB_SERVER_URL:'https://example.org'},{GITHUB_API_URL:'https://example.org'},{GITHUB_EVENT_NAME:'pull_request'},{GITHUB_EVENT_NAME:'pull_request_target'},{GITHUB_EVENT_NAME:'push'},{GITHUB_EVENT_NAME:'repository_dispatch'},{GITHUB_EVENT_NAME:'workflow_run'},{GITHUB_EVENT_NAME:'schedule',NEWS_INITIALIZE_REVIEW_CACHE:'true'},{GITHUB_EVENT_NAME:'schedule',NEWS_INITIALIZE_REVIEW_CACHE:'invalid'},{GITHUB_WORKFLOW_REF:'other'},{NEWS_INITIALIZE_REVIEW_CACHE:undefined}]) {
 let reads=0; await assert.rejects(resolveNewsLineage({env:{...env,...patch},metadata:async()=>{reads++;throw new Error('must_not_read');}})); assert.equal(reads,0);
}
for (const patch of [{private:true},{default_branch:'other'},{id:124},{full_name:'other/repo'}]) await assert.rejects(resolveNewsLineage({env,metadata:metadataFixture({repo:{...repository,...patch}})}));
for (const patch of [{run_attempt:2},{run_number:3},{head_sha:'c'.repeat(40)},{workflow_id:null},{path:'.github/workflows/other.yml'},{repository:{...repository,id:124}},{status:'completed',conclusion:'success'},{status:'queued'},{head_branch:'feature'},{event:'push'},{event:'schedule'},{event:'pull_request'}]) await assert.rejects(resolveNewsLineage({env,metadata:metadataFixture({run:{...current,...patch}})}));
await assert.rejects(resolveNewsLineage({env:scheduledChain.env,metadata:metadataFixture()}),/current_event_mismatch/);
for(const requested of [undefined,'','false','true']) await assert.rejects(resolveNewsLineage({env:{...bootEnv,GITHUB_EVENT_NAME:'schedule',NEWS_INITIALIZE_REVIEW_CACHE:requested},metadata:metadataFixture({run:{...prior,event:'schedule',status:'in_progress',conclusion:null}})}));
for (const chain of eventChains) {
 for (const event of ['push','pull_request','pull_request_target','workflow_run','repository_dispatch']) {
  const predecessor={...chain.predecessor,event};
  await assert.rejects(resolveNewsLineage({env:chain.env,metadata:metadataFixture({run:chain.run,predecessor,list:{total_count:3,workflow_runs:[chain.run,predecessor]}})}),/invalid_run_metadata/);
 }
 // Two individually allowed events must still agree between list and direct API.
 await assert.rejects(resolveNewsLineage({env:chain.env,metadata:metadataFixture({run:chain.run,predecessor:{...chain.predecessor,event:chain.predecessor.event==='schedule'?'workflow_dispatch':'schedule'},list:{total_count:3,workflow_runs:[chain.run,chain.predecessor]}})}),/predecessor_not_exact_success_attempt_one/);
}
for (const status of ['failure','cancelled','timed_out','skipped','neutral','action_required','stale',null]) await assert.rejects(resolveNewsLineage({env,metadata:metadataFixture({predecessor:{...prior,conclusion:status}})}));
for (const patch of [{status:'in_progress'},{run_attempt:2},{workflow_id:45},{head_sha:'c'.repeat(40)},{run_number:0},{head_branch:'feature'},{path:'.github/workflows/other.yml'},{repository:{...repository,id:124}}]) await assert.rejects(resolveNewsLineage({env,metadata:metadataFixture({predecessor:{...prior,...patch}})}));
for (const list of [{total_count:0,workflow_runs:[]},{total_count:2,workflow_runs:[current,{...prior,run_number:3}]},{total_count:3,workflow_runs:[current,prior,prior]}, {}, {total_count:0,workflow_runs:[prior]}, {total_count:1,workflow_runs:[{}]}]) await assert.rejects(resolveNewsLineage({env,metadata:metadataFixture({list})}));
await assert.rejects(resolveNewsLineage({env:{...env,NEWS_INITIALIZE_REVIEW_CACHE:'true'},metadata:metadataFixture({list:{total_count:0,workflow_runs:[]}})}),/bootstrap_is_not_recovery/);
await assert.rejects(resolveNewsLineage({env:{...bootEnv,NEWS_INITIALIZE_REVIEW_CACHE:'false'},metadata:bootMeta}),/bootstrap_required/);
await assert.rejects(resolveNewsLineage({env,metadata:async()=>{throw new Error('api_unavailable');}}));
for (const hit of ['false','',undefined]) assert.throws(()=>requireExactCache({hit,matchedKey:plan.predecessorCacheKey,expectedKey:plan.predecessorCacheKey}));
assert.throws(()=>requireExactCache({hit:'true',matchedKey:`${plan.predecessorCacheKey}-other`,expectedKey:plan.predecessorCacheKey}));

// Test bounded official-API transport itself, including no credentials/redirects.
const goodApi = async(url,options) => {assert.equal(url,`https://api.github.com/repos/${NEWS_REPOSITORY}`);assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.authorization,undefined);return new Response(JSON.stringify(repository),{headers:{'content-type':'application/json'}});};
assert.deepEqual(await githubMetadata(`/repos/${NEWS_REPOSITORY}`,{fetchImpl:goodApi}),repository);
const preflightCases=[
 ['403','http_status',new Response('{}',{status:403,headers:{'content-type':'application/json'}}),403],
 ['429','http_status',new Response('{}',{status:429,headers:{'content-type':'application/json'}}),429],
 ['5xx','http_status',new Response('{}',{status:503,headers:{'content-type':'application/json'}}),503],
 ['wrong MIME','wrong_mime',new Response('{}',{headers:{'content-type':'text/html'}}),200],
 ['missing body','missing_body',new Response(null,{headers:{'content-type':'application/json'}}),200],
 ['oversized declared body','oversized_declared_body',new Response('{}',{headers:{'content-type':'application/json','content-length':'2000001'}}),200],
 ['oversized streamed body','oversized_body',new Response('x'.repeat(2_000_001),{headers:{'content-type':'application/json'}}),200],
 ['malformed JSON','malformed_json',new Response('not-json',{headers:{'content-type':'application/json'}}),200]
];
for(const [label,errorClass,response,status] of preflightCases){
 await assert.rejects(githubMetadata(`/repos/${NEWS_REPOSITORY}`,{fetchImpl:async()=>response}),error=>{
  assert.equal(error.metadataDiagnostic.errorClass,errorClass,label);assert.equal(error.metadataDiagnostic.target,`/repos/${NEWS_REPOSITORY}`);assert.equal(error.metadataDiagnostic.status,status);return true;
 });
}
await assert.rejects(githubMetadata(`/repos/${NEWS_REPOSITORY}`,{fetchImpl:async()=>{const error=new Error('secret network detail');error.name='TimeoutError';throw error;}}),error=>{assert.deepEqual(error.metadataDiagnostic,{target:`/repos/${NEWS_REPOSITORY}`,status:null,mime:null,declaredBodyBytes:null,errorClass:'timeout'});assert.doesNotMatch(error.message,/secret network detail/);return true;});
await assert.rejects(githubMetadata(`/repos/${NEWS_REPOSITORY}`,{fetchImpl:async()=>{throw new Error('secret network detail');}}),error=>{assert.equal(error.metadataDiagnostic.errorClass,'transport_unknown');assert.doesNotMatch(error.message,/secret network detail/);return true;});
// A failed initial plan persists only the bounded receipt, before there is any
// plan or collector eligibility. Even a failed receipt write remains blocked.
for(const [label,errorClass,response] of [...preflightCases.slice(0,5),['timeout','timeout',null]]){
 const dir=await mkdtemp(`${tmpdir()}/news-preflight-`),paths=lineagePaths(pathToFileURL(`${dir}/`)),summary=`${dir}/summary.md`;let collectorCalls=0;
 try{
  const fetchImpl=async()=>{if(label==='timeout'){const error=new Error('secret timeout detail');error.name='TimeoutError';throw error;}return response;};
  const failedMetadata=path=>githubMetadata(path,{fetchImpl});
  await assert.rejects(createLineagePlan({env:{...env,GITHUB_STEP_SUMMARY:summary},paths,metadata:failedMetadata,now:()=>new Date('2026-10-30T00:00:00.000Z')}));
  await assert.rejects(collectWithLineage({env,paths,metadata:failedMetadata,collect:async()=>{collectorCalls++;}}));
  const diagnostic=JSON.parse(await readFile(paths.preflightFailure,'utf8'));
  assert.equal(diagnostic.kind,'news_preview_preflight_failure');assert.equal(diagnostic.phase,'lineage_preflight');assert.equal(diagnostic.errorClass,errorClass);assert.equal(diagnostic.runIdentity.runId,env.GITHUB_RUN_ID);assert.equal(diagnostic.target,`/repos/${NEWS_REPOSITORY}`);assert.equal(diagnostic.observedAt,'2026-10-30T00:00:00.000Z');
  assert.doesNotMatch(JSON.stringify(diagnostic),/secret|not-json|\{\}/);assert.equal(collectorCalls,0);await assert.rejects(access(paths.plan),{code:'ENOENT'});
  const report=await readFile(summary,'utf8');assert.match(report,/Operational status:\*\* blocked during lineage preflight/);assert.match(report,/Published content freshness:\*\* unchanged/);
 } finally {await rm(dir,{recursive:true,force:true});}
}
{
 const dir=await mkdtemp(`${tmpdir()}/news-preflight-write-failure-`),paths=lineagePaths(pathToFileURL(`${dir}/`));
 try{await writeFile(paths.preflightFailure,'sentinel');await assert.rejects(createLineagePlan({env,paths,metadata:async()=>{throw new Error('metadata unavailable');}}));assert.equal(await readFile(paths.preflightFailure,'utf8'),'sentinel');await assert.rejects(access(paths.plan),{code:'ENOENT'});}finally{await rm(dir,{recursive:true,force:true});}
}
{
 const dir=await mkdtemp(`${tmpdir()}/news-preflight-untrusted-error-`),paths=lineagePaths(pathToFileURL(`${dir}/`));
 try{
  const unsafe=new Error('secret details');unsafe.metadataDiagnostic={target:'/private/path?token=secret',status:999,mime:'a'.repeat(500),declaredBodyBytes:-1,errorClass:'secret-error-class'};
  await assert.rejects(createLineagePlan({env,paths,metadata:async()=>{throw unsafe;}}));
  const diagnostic=JSON.parse(await readFile(paths.preflightFailure,'utf8'));
  assert.equal(diagnostic.target,`/repos/${NEWS_REPOSITORY}`);assert.equal(diagnostic.status,null);assert.equal(diagnostic.mime,null);assert.equal(diagnostic.declaredBodyBytes,null);assert.equal(diagnostic.errorClass,'transport_unknown');assert.doesNotMatch(JSON.stringify(diagnostic),/secret|private/);
 }finally{await rm(dir,{recursive:true,force:true});}
}
await assert.rejects(githubMetadata('https://publisher.example/feed',{fetchImpl:()=>assert.fail('invalid path requested')}));

const now='2026-10-27T12:00:00.000Z';
const source = {id:'fixture',name:'Fixture newsroom',source_type:'official_public_notice',homeUrl:'https://www.example.org/',feedUrl:'https://www.example.org/feed',allowedHosts:['www.example.org'],enabled:true,status:'admitted',admission:{reviewedAt:now,reviewer:'Fixture reviewer',accessEvidence:'Fixture only',schemaEvidence:'Fixture RSS',dateEvidence:'Fixture dates',rightsEvidence:'Fixture original metadata'}};
// Exercise the actual production child-process completion adapter. A process
// must exit successfully, not merely emit a payload or start/finish a callback.
for(const [code,signal] of [[0,null],[1,null],[null,'SIGTERM']]) {
 const child=new EventEmitter();let finished=false;
 const done=runCollector({spawnImpl:(command,args,options)=>{
  assert.equal(command,process.execPath);assert.deepEqual(args,['scripts/import-regional-news.mjs']);assert.equal(options.stdio,'inherit');return child;
 }}).then(()=>{finished=true;});
 await Promise.resolve();assert.equal(finished,false);
 child.emit('exit',code,signal);
 if(code===0) {await done;assert.equal(finished,true);} else await assert.rejects(done,/news_collector_not_complete/);
}
await assert.rejects(runCollector({spawnImpl:()=>{const child=new EventEmitter();queueMicrotask(()=>child.emit('error',new Error('spawn_failed')));return child;}}),/spawn_failed/);
const registry = {version:1,sources:[source]};
const empty={version:2,disposition:'nonpublishable_requires_review',candidates:[],diagnostics:[]};
const held=await collectNews(registry,{now,fetchFeed:async()=>{throw Object.assign(new Error('transport_unresolved'),{accessHeld:true});}});
let heldRequests=0;
const stillHeld=await collectNews(registry,{now:'2027-10-27T12:00:00.000Z',previous:held,fetchFeed:async()=>{heldRequests++;throw new Error('must_not_retry_unknown');}});
assert.equal(heldRequests,0);assert.equal(stillHeld.diagnostics[0].error,'transport_unresolved');
assert.equal(stillHeld.diagnostics[0].accessHeld,true);
assert.equal(stillHeld.diagnostics[0].lastAttemptAt,held.diagnostics[0].lastAttemptAt);
const payload=Buffer.from(JSON.stringify(held)+'\n');
const receipt=finalReceipt(plan.predecessor,payload);
verifyFinalReceipt(receipt,plan.predecessor,payload);
for(const patch of [{version:2},{kind:'other'},{identity:{...receipt.identity,runId:'101'}},{identity:{...receipt.identity,runAttempt:2}},{identity:{...receipt.identity,sha:'c'.repeat(40)}},{identity:{...receipt.identity,workflowId:'45'}},{identity:{...receipt.identity,repository:'other/repo'}},{cacheKey:'news-review-v2-123'},{transportDecisionsDrained:false},{payloadCacheVerified:false},{payloadSha256:'0'.repeat(64)},{unknown:true}]) assert.throws(()=>verifyFinalReceipt({...receipt,...patch},plan.predecessor,payload));
assert.throws(()=>verifyFinalReceipt(receipt,plan.predecessor,Buffer.from(payload+' ')));
const restoreEnv={...env,NEWS_PAYLOAD_CACHE_HIT:'true',NEWS_PAYLOAD_CACHE_KEY:plan.predecessorCacheKey,NEWS_RECEIPT_CACHE_HIT:'true',NEWS_RECEIPT_CACHE_KEY:`${plan.predecessorCacheKey}-final`};
let scenarios=0;
async function scenario(fn,{bootstrap=false,chain}={}) {
 const dir=await mkdtemp(`${tmpdir()}/news-lineage-`), paths=lineagePaths(pathToFileURL(`${dir}/`));
 const testEnv=copy(chain?.env || (bootstrap?bootEnv:restoreEnv)), metadata=chain?.metadata || (bootstrap?bootMeta:metadataFixture());
 try {
  const currentPlan=await createLineagePlan({env:testEnv,paths,metadata});
  if(!bootstrap) {
   Object.assign(testEnv,{NEWS_PAYLOAD_CACHE_HIT:'true',NEWS_PAYLOAD_CACHE_KEY:currentPlan.predecessorCacheKey,NEWS_RECEIPT_CACHE_HIT:'true',NEWS_RECEIPT_CACHE_KEY:`${currentPlan.predecessorCacheKey}-final`});
   await writeFile(paths.payload,payload);await writeFile(paths.receipt,JSON.stringify(finalReceipt(currentPlan.predecessor,payload)));
  }
  await fn({env:testEnv,paths,metadata,plan:currentPlan});scenarios++;
 } finally {await rm(dir,{recursive:true,force:true});}
}
const missing=async path=>assert.rejects(access(path),{code:'ENOENT'});
const noFalseZeroRequests = error => {assert.doesNotMatch(error.message,/no_source_requests|no_requests/);return true;};
// Every rejection below must precede both the robots and news transport boundary.
async function blocked(change,options) {
 await scenario(async context=>{
  let robots=0,feeds=0;
  const options={...context,registry,collect:async()=>{robots++;feeds++;assert.fail('transport_must_not_start');}};
  await change(options);
  await assert.rejects(collectWithLineage(options));
  assert.equal(robots,0);assert.equal(feeds,0);await missing(options.paths.collected);
 },options);
}
for(const patch of [{NEWS_PAYLOAD_CACHE_HIT:'false'},{NEWS_PAYLOAD_CACHE_KEY:'news-review-v2-123'},{NEWS_PAYLOAD_CACHE_KEY:plan.cacheKey},{NEWS_RECEIPT_CACHE_HIT:''},{NEWS_RECEIPT_CACHE_KEY:`${plan.predecessorCacheKey}-final-stale`},{GITHUB_RUN_ATTEMPT:'2'},{NEWS_INITIALIZE_REVIEW_CACHE:'true'}]) await blocked(async o=>Object.assign(o.env,patch));
for(const field of ['payload','receipt']) await blocked(async o=>rm(o.paths[field]));
await blocked(async o=>writeFile(o.paths.payload,'bad-json'));
await blocked(async o=>writeFile(o.paths.payload,JSON.stringify(empty)));
await blocked(async o=>writeFile(o.paths.receipt,JSON.stringify({...receipt,transportDecisionsDrained:false})));
await blocked(async o=>writeFile(o.paths.receipt,'bad-json'));
await blocked(async o=>writeFile(o.paths.plan,JSON.stringify({...plan,current:{...plan.current,sha:'f'.repeat(40)}})));
await blocked(async o=>{o.metadata=async()=>{throw new Error('rate_limited');};});
for(const conclusion of ['cancelled','failure','timed_out']) await blocked(async o=>{o.metadata=metadataFixture({predecessor:{...prior,conclusion}});});
await blocked(async o=>{o.metadata=metadataFixture({predecessor:{...prior,run_attempt:2}});});
await blocked(async o=>{o.metadata=metadataFixture({list:{total_count:0,workflow_runs:[]}});});
// Rerunning a prior succeeded run must also invalidate an already restored cache.
await blocked(async o=>{o.metadata=metadataFixture({predecessor:{...prior,status:'in_progress',conclusion:null,run_attempt:2}});});

// Scheduled/manual transitions use the same exact receipt protocol, including
// existing manual v3 receipts. Every broken chain stays outside both transports.
for(const chain of [scheduledChain,...eventChains]) {
 const options={chain};
 for(const patch of [{GITHUB_RUN_ATTEMPT:'2'},{GITHUB_EVENT_NAME:'push'},{GITHUB_EVENT_NAME:'pull_request'},{GITHUB_REPOSITORY:'evil/fork'},{NEWS_INITIALIZE_REVIEW_CACHE:'true'},{NEWS_PAYLOAD_CACHE_HIT:'false'},{NEWS_RECEIPT_CACHE_HIT:'false'},{NEWS_PAYLOAD_CACHE_KEY:'older-successful-cache'},{NEWS_RECEIPT_CACHE_KEY:'fallback-final'}]) await blocked(async o=>Object.assign(o.env,patch),options);
 for(const field of ['payload','receipt']) await blocked(async o=>rm(o.paths[field]),options);
 await blocked(async o=>writeFile(o.paths.payload,JSON.stringify(empty)),options);
 await blocked(async o=>writeFile(o.paths.receipt,JSON.stringify({...finalReceipt(o.plan.predecessor,payload),transportDecisionsDrained:false})),options);
 for(const patch of [{conclusion:'failure'},{conclusion:'cancelled'},{conclusion:'timed_out'},{status:'in_progress',conclusion:null},{run_attempt:2},{event:'push'},{event:'pull_request'}]) await blocked(async o=>{
  const predecessor={...chain.predecessor,...patch};
  o.metadata=metadataFixture({run:chain.run,predecessor,list:{total_count:3,workflow_runs:[chain.run,predecessor]}});
 },options);
 if(chain.predecessor.run_number>1) await blocked(async o=>{
  // Even two mutually consistent API replies cannot change the admitted event
  // between plan and collection. Event fields stay in the uncached plan only.
  const predecessor={...chain.predecessor,event:chain.predecessor.event==='schedule'?'workflow_dispatch':'schedule'};
  o.metadata=metadataFixture({run:chain.run,predecessor,list:{total_count:3,workflow_runs:[chain.run,predecessor]}});
 },options);
 await scenario(async context=>{
  let robots=0,feeds=0;
  await collectWithLineage({...context,registry,collect:async()=>{
   const previous=JSON.parse(await readFile(context.paths.payload,'utf8'));
   const result=await collectNews(registry,{previous,now:'2027-10-27T12:00:00.000Z',fetchFeed:async()=>{robots++;feeds++;throw new Error('held_source_must_not_request');}});
   assert.equal(result.diagnostics[0].accessHeld,true);
   assert.equal(result.diagnostics[0].error,'transport_unresolved');
   assert.equal(result.diagnostics[0].lastAttemptAt,held.diagnostics[0].lastAttemptAt);
   await writeFile(context.paths.payload,JSON.stringify(result));
  }});
  assert.equal(robots,0);assert.equal(feeds,0);
  const saved={...context.env,NEWS_SAVED_CACHE_HIT:'true',NEWS_SAVED_CACHE_KEY:context.plan.cacheKey};
  await assert.rejects(completeLineage({env:{...saved,GITHUB_EVENT_NAME:chain.run.event==='schedule'?'workflow_dispatch':'schedule',NEWS_INITIALIZE_REVIEW_CACHE:'false'},paths:context.paths}),/plan_current_event_mismatch/);
  await missing(context.paths.receipt);
  await completeLineage({env:saved,paths:context.paths});
  await verifyReceiptSaved({env:{...saved,NEWS_SAVED_CACHE_KEY:`${context.plan.cacheKey}-final`},paths:context.paths});
  verifyFinalReceipt(JSON.parse(await readFile(context.paths.receipt)),context.plan.current,await readFile(context.paths.payload));
 },options);
}
// A first-ever scheduled event never initializes, even with no dispatch inputs
// or an asserted true input. Rejection precedes file creation and both transports.
for(const requested of [undefined,'','false','true']) {
 const dir=await mkdtemp(`${tmpdir()}/news-first-schedule-`),paths=lineagePaths(pathToFileURL(`${dir}/`));
 let robots=0,feeds=0;
 try {
  await assert.rejects(collectWithLineage({env:{...bootEnv,GITHUB_EVENT_NAME:'schedule',NEWS_INITIALIZE_REVIEW_CACHE:requested},paths,registry,metadata:metadataFixture({run:{...prior,event:'schedule',status:'in_progress',conclusion:null}}),collect:async()=>{robots++;feeds++;}}));
  assert.equal(robots,0);assert.equal(feeds,0);await missing(paths.payload);await missing(paths.collected);
 } finally {await rm(dir,{recursive:true,force:true});}
}

await scenario(async context=>{
 const events=[];
 const metadata=metadataFixture({onCall:path=>events.push(`metadata:${path}`)});
 // www/apex + retired ID hold remains intact through the lineage protocol.
 const alias={...source,id:'renamed',homeUrl:'https://example.org/',feedUrl:'https://example.org/feed',allowedHosts:['example.org']};
 let robots=0,feeds=0;
 await collectWithLineage({...context,metadata,registry:{version:1,sources:[alias]},collect:async()=>{
  events.push('collector-start');
  const previous=JSON.parse(await readFile(context.paths.payload,'utf8'));
  const result=await collectNews({version:1,sources:[alias]},{previous,now,fetchFeed:async()=>{robots++;feeds++;throw new Error('held_alias_must_not_request');}});
  events.push('transport-decisions-drained');
  await writeFile(context.paths.payload,JSON.stringify(result));events.push('payload-written');
 }});
 assert.equal(robots,0);assert.equal(feeds,0);
 assert.ok(events.indexOf('collector-start')>=4);
 assert.deepEqual(events.slice(-3),['collector-start','transport-decisions-drained','payload-written']);
 assert.deepEqual(JSON.parse(await readFile(context.paths.predecessorReceipt,'utf8')),receipt);
 await missing(context.paths.receipt);
 const saved={...context.env,NEWS_SAVED_CACHE_HIT:'true',NEWS_SAVED_CACHE_KEY:plan.cacheKey};
 // Action success/warning without an exact cache must not create a receipt.
 for(const patch of [{NEWS_SAVED_CACHE_HIT:'false'},{NEWS_SAVED_CACHE_KEY:plan.predecessorCacheKey},{NEWS_SAVED_CACHE_KEY:`${plan.cacheKey}-prefix`}]) {
  await assert.rejects(completeLineage({env:{...saved,...patch},paths:context.paths}),noFalseZeroRequests);await missing(context.paths.receipt);
 }
 await completeLineage({env:saved,paths:context.paths});
 const currentReceipt=JSON.parse(await readFile(context.paths.receipt,'utf8'));
 verifyFinalReceipt(currentReceipt,plan.current,await readFile(context.paths.payload));
 await assert.rejects(verifyReceiptSaved({env:{...saved,NEWS_SAVED_CACHE_HIT:'false'},paths:context.paths}),noFalseZeroRequests);
 await assert.rejects(verifyReceiptSaved({env:saved,paths:context.paths}));
 await verifyReceiptSaved({env:{...saved,NEWS_SAVED_CACHE_KEY:`${plan.cacheKey}-final`},paths:context.paths});
 // Payload loss/corruption after successful collection cannot be completed.
 await writeFile(context.paths.payload,JSON.stringify(empty));
 await assert.rejects(verifyReceiptSaved({env:{...saved,NEWS_SAVED_CACHE_KEY:`${plan.cacheKey}-final`},paths:context.paths}));
});
// Failure/interruption after receiving a restriction keeps the payload evidence,
// but no completion marker or final receipt can bless it (nor a restored file).
for(const mutate of [false,true]) await scenario(async context=>{
 await assert.rejects(collectWithLineage({...context,registry,collect:async()=>{
  if(mutate) await writeFile(context.paths.payload,payload);
  throw new Error('collector_killed_or_exit_nonzero_after_transport');
 }}));
 assert.deepEqual(await readFile(context.paths.payload),payload);
 await missing(context.paths.collected);await missing(context.paths.receipt);
 await assert.rejects(completeLineage({env:{...context.env,NEWS_SAVED_CACHE_HIT:'true',NEWS_SAVED_CACHE_KEY:plan.cacheKey},paths:context.paths}));
});
await scenario(async context=>{
 await writeFile(context.paths.collected,JSON.stringify({version:3,kind:'news_preview_collected',identity:plan.predecessor,payloadSha256:receipt.payloadSha256,transportDecisionsDrained:true}));
 await assert.rejects(completeLineage({env:{...context.env,NEWS_SAVED_CACHE_HIT:'true',NEWS_SAVED_CACHE_KEY:plan.cacheKey},paths:context.paths}));
});
await scenario(async context=>{
 // A stale restored file plus an asserted cache hit is never completion.
 await assert.rejects(completeLineage({env:{...context.env,NEWS_SAVED_CACHE_HIT:'true',NEWS_SAVED_CACHE_KEY:plan.cacheKey},paths:context.paths}));
 assert.deepEqual(JSON.parse(await readFile(context.paths.receipt)),receipt);
});
await scenario(async context=>{
 await assert.rejects(collectWithLineage({...context,registry,collect:async()=>writeFile(context.paths.payload,JSON.stringify(empty))}),error=>{assert.match(error.message,/lost_access_hold/);return noFalseZeroRequests(error);});
 await missing(context.paths.collected);
});
await scenario(async context=>{
 await assert.rejects(collectWithLineage({...context,registry,collect:async()=>writeFile(context.paths.payload,JSON.stringify({version:'bad'}))}),noFalseZeroRequests);
 await missing(context.paths.collected);
});
await scenario(async context=>{
 await collectWithLineage({...context,registry,collect:async()=>{}});
 await writeFile(context.paths.payload,JSON.stringify({version:'bad'}));
 await assert.rejects(completeLineage({env:{...context.env,NEWS_SAVED_CACHE_HIT:'true',NEWS_SAVED_CACHE_KEY:plan.cacheKey},paths:context.paths}),noFalseZeroRequests);
});
await scenario(async context=>{
 let requests=0;
 await collectWithLineage({...context,registry,collect:async()=>{
  const previous=JSON.parse(await readFile(context.paths.payload));assert.deepEqual(previous,empty);
  const result=await collectNews(registry,{previous,now,fetchFeed:async()=>{requests++;return '<rss version="2.0"><channel></channel></rss>';}});
  await writeFile(context.paths.payload,JSON.stringify(result));
 }});
 assert.equal(requests,1);
 await access(context.paths.collected);
 await assert.rejects(collectWithLineage({...context,registry,collect:()=>assert.fail('second bootstrap')}));
},{bootstrap:true});
for(const field of ['payload','receipt']) await scenario(async context=>{
 await writeFile(context.paths[field],field==='payload'?payload:JSON.stringify(receipt));
 let requests=0;
 await assert.rejects(collectWithLineage({...context,registry,collect:async()=>{requests++;}}));
 assert.equal(requests,0);
 if(field==='payload') assert.deepEqual(await readFile(context.paths.payload),payload);
},{bootstrap:true});

// The shipped workflow must call these tested gates in order, without an alternate
// direct collector path, prefix fallback, unguarded event, permissive error or write.
const workflow=await readFile(new URL('../.github/workflows/news-preview.yml',import.meta.url),'utf8');
for(const forbidden of [/restore-keys:/,/news-review-v2/,/continue-on-error:/,/contents: write/,/actions: write/,/secrets\./,/node scripts\/import-regional-news.mjs/]) assert.doesNotMatch(workflow,forbidden);
assert.equal(workflow.split('permissions:\n')[0],`name: Regional News Preview (Review Required)
on:
  # Review-only collection attempts, not successful collection or publication.
  schedule:
    - cron: "17 */6 * * *"
  workflow_dispatch:
    inputs:
      initialize_review_cache:
        description: "Initialize only the genuine first run; never resets prior cache or holds"
        type: boolean
        default: false
        required: false
`);
assert.match(workflow,/permissions:\n  contents: read\nconcurrency:/);
assert.match(workflow,/    if: \(github.event_name == 'schedule' \|\| github.event_name == 'workflow_dispatch'\) && github.ref == format\('refs\/heads\/\{0\}', github.event.repository.default_branch\)/);
assert.match(workflow,/timeout-minutes: 10/);
assert.match(workflow,/NEWS_INITIALIZE_REVIEW_CACHE: \$\{\{ inputs.initialize_review_cache \}\}/);
const updatePolicy=JSON.parse(await readFile(new URL('../data/update-policy.json',import.meta.url),'utf8'));
assert.equal(updatePolicy.lanes.find(lane=>lane.id==='regional-news').targetHours,6);
assert.match(updatePolicy.unchangedPolicy,/No content commit or full Quality Gate for receipt-only changes/);
const promotion=await readFile(new URL('../.github/workflows/promote-preview-artifacts.yml',import.meta.url),'utf8');
assert.doesNotMatch(promotion,/Regional News Preview|regional-news-review-only|news-preview.yml/);
for(const command of ['plan','collect','complete','verify-final-save']) assert.equal(workflow.split(`node scripts/news-preview-lineage.mjs ${command}\n`).length-1,1);
const stages=['node scripts/news-preview-lineage.mjs plan','id: review-cache','id: final-receipt','node scripts/news-preview-lineage.mjs collect','name: Save only a completed current payload','id: saved-payload','node scripts/news-preview-lineage.mjs complete','name: Save final receipt separately','id: saved-final','node scripts/news-preview-lineage.mjs verify-final-save'];
for(let i=1;i<stages.length;i++) assert.ok(workflow.indexOf(stages[i])>workflow.indexOf(stages[i-1]),stages[i]);
assert.equal((workflow.match(/lookup-only: true/g)||[]).length,2);
assert.equal((workflow.match(/fail-on-cache-miss: true/g)||[]).length,4);
const quality=await readFile(new URL('../.github/workflows/quality-gate.yml',import.meta.url),'utf8');
assert.match(quality,/node scripts\/test-news-run-lineage.mjs/);
assert.match(workflow,/uses: actions\/checkout@v6\n        with:\n          ref: \$\{\{ github.sha \}\}/);
assert.match(workflow,/concurrency:[\s\S]*?cancel-in-progress: false/);
assert.match(workflow,/name: Upload nonpublishable review evidence even after an interrupted or denied collection[\s\S]*?if: always\(\)[\s\S]*?artifacts\/news-preview\*\.json/);
console.log(`News lineage tests passed: manual/scheduled current/N-1 event identity matrix, manual-only first-run bootstrap, exact compatible v3 cache/receipt/digest verification, ${scenarios} offline file/transport scenarios, interrupted/rerun/cache-loss/held-source stops and guarded six-hour review-only workflow ordering. No network calls.`);
