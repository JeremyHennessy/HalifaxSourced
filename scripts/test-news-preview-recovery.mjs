import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,access,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { cacheKey,finalReceipt,NEWS_REPOSITORY,NEWS_WORKFLOW,payloadDigest,githubMetadata } from './lib/news-run-lineage.mjs';
import { NEWS_RECOVERY_ANCHOR,resolveNewsRecoveryHistory,validateNewsRecoveryGapJobs,createNewsRecoveryApprovalDescriptor,createNewsRecoveryPlan,verifyNewsRecoveryCheckpoint,isVerifiedNewsRecoveryCheckpoint,requireSameNewsRecoveryPlan,writeNewsRecoveryClaim,verifyNewsRecoveryClaimFile,executeNewsRecoveryPass,requireRecoveryHoldsPreserved } from './lib/news-preview-recovery.mjs';
import { lineagePaths,createLineagePlan,claimNewsRecovery,collectWithRecovery,completeLineage,verifyReceiptSaved } from './news-preview-lineage.mjs';

globalThis.fetch=()=>{throw new Error('network_forbidden_in_news_recovery_tests');};
for(const path of [`/repos/${NEWS_REPOSITORY}/actions/runs/600/jobs?per_page=100&page=1`,`/repos/${NEWS_REPOSITORY}/actions/runs/600/jobs?per_page=100&page=20`,`/repos/${NEWS_REPOSITORY}/actions/artifacts/12876876744`,`/repos/${NEWS_REPOSITORY}/actions/workflows/398735078/runs?per_page=100&page=20`]){
  const value={path};
  assert.deepEqual(await githubMetadata(path,{fetchImpl:async url=>{assert.equal(url,`https://api.github.com${path}`);return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});}}),value);
}
await assert.rejects(githubMetadata(`/repos/${NEWS_REPOSITORY}/actions/workflows/398735078/runs?per_page=100&page=21`,{fetchImpl:()=>assert.fail('unbounded metadata pagination')}),/news_lineage_invalid_metadata_path/);
await assert.rejects(githubMetadata(`/repos/${NEWS_REPOSITORY}/actions/runs/600/jobs?per_page=100&page=21`,{fetchImpl:()=>assert.fail('unbounded jobs pagination')}),/news_lineage_invalid_metadata_path/);
const repo={id:1348899318,full_name:NEWS_REPOSITORY,private:false,default_branch:'main'};
const env={GITHUB_REPOSITORY:NEWS_REPOSITORY,GITHUB_REPOSITORY_ID:'1348899318',GITHUB_SERVER_URL:'https://github.com',GITHUB_API_URL:'https://api.github.com',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ID:'800',GITHUB_RUN_NUMBER:'8',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:'b'.repeat(40),GITHUB_REF:'refs/heads/main',GITHUB_WORKFLOW_REF:`${NEWS_REPOSITORY}/${NEWS_WORKFLOW}@refs/heads/main`,NEWS_INITIALIZE_REVIEW_CACHE:'false',NEWS_RECOVERY_APPROVED:'true',NEWS_RECOVERY_GLOBAL_CALL_APPROVED:'true',NEWS_RECOVERY_PREDECESSOR_RUN_ID:'700',NEWS_RECOVERY_PREDECESSOR_RUN_NUMBER:'7',NEWS_RECOVERY_CHECKPOINT_MODE:'exact-cache'};
const shaFor=n=>n===8?env.GITHUB_SHA:n.toString(16).repeat(40);
const run=(n,id,status='completed',conclusion='failure',event='schedule')=>({id,workflow_id:398735078,run_number:n,run_attempt:1,repository:repo,path:NEWS_WORKFLOW,head_sha:shaFor(n),head_branch:'main',event,status,conclusion,created_at:`2026-10-${String(n).padStart(2,'0')}T00:00:00Z`,updated_at:`2026-10-${String(n).padStart(2,'0')}T00:01:00Z`});
const current=run(8,800,'in_progress',null,'workflow_dispatch');
const r6=run(6,600),r7=run(7,700),anchorRun={...run(5,Number(NEWS_RECOVERY_ANCHOR.runId),'completed','success','schedule'),head_sha:NEWS_RECOVERY_ANCHOR.sha};
const gate={name:'Verify current run and exact sequential predecessor with public GitHub metadata',conclusion:'failure'};
const collect={name:'Verify receipt and digest before any news or robots request',conclusion:'skipped'};
const job=n=>({id:n*10,name:'preview',run_id:n*100,head_sha:shaFor(n),run_attempt:1,status:'completed',conclusion:'failure',steps:[structuredClone(gate),structuredClone(collect),{name:'Upload nonpublishable review evidence even after an interrupted or denied collection',conclusion:'success'}]});
const metadata=async path=>{
  if(path===`/repos/${NEWS_REPOSITORY}`)return structuredClone(repo);
  if(path===`/repos/${NEWS_REPOSITORY}/actions/runs/800`)return structuredClone(current);
  if(path===`/repos/${NEWS_REPOSITORY}/actions/runs/${NEWS_RECOVERY_ANCHOR.runId}`)return structuredClone(anchorRun);
  if(path===`/repos/${NEWS_REPOSITORY}/actions/workflows/398735078/runs?per_page=100&page=1`)return {total_count:8,workflow_runs:[current,r7,r6,anchorRun]};
  for(const item of [r6,r7]){
    if(path===`/repos/${NEWS_REPOSITORY}/actions/runs/${item.id}`)return structuredClone(item);
    if(path===`/repos/${NEWS_REPOSITORY}/actions/runs/${item.id}/jobs?per_page=100&page=1`)return {total_count:1,jobs:[job(item.run_number)]};
  }
  throw new Error(`unexpected_metadata_path:${path}`);
};
const evidence=await resolveNewsRecoveryHistory({env,metadata});
assert.deepEqual(evidence.gaps.map(g=>g.run.runNumber),[6,7]);
assert.equal(evidence.predecessor.id,'700');
for(const altered of [
  async path=>{const value=await metadata(path);if(path.includes('/runs?'))value.workflow_runs=value.workflow_runs.filter(r=>r.run_number!==6);return value;},
  async path=>{const value=await metadata(path);if(path.endsWith('/runs/700/jobs?per_page=100&page=1'))value.jobs[0].steps[1].conclusion='success';return value;},
  async path=>{const value=await metadata(path);if(path.endsWith('/runs/600'))value.head_sha='c'.repeat(40);return value;}
]) await assert.rejects(resolveNewsRecoveryHistory({env,metadata:altered}),/news_recovery_/);
const cleanupMetadata=async path=>{const value=await metadata(path);if(path.endsWith('/runs/700/jobs?per_page=100&page=1'))value.jobs[0].steps.push({name:'Post Run actions/checkout@v6',conclusion:'success'},{name:'Complete job',conclusion:'success'});return value;};
assert.equal((await resolveNewsRecoveryHistory({env,metadata:cleanupMetadata})).gaps.length,2,'verified post-checkout cleanup and job completion may succeed after failed preflight');
const unsafeCleanupMetadata=async path=>{const value=await metadata(path);if(path.endsWith('/runs/700/jobs?per_page=100&page=1'))value.jobs[0].steps.push({name:'Unexpected source step',conclusion:'success'});return value;};
await assert.rejects(resolveNewsRecoveryHistory({env,metadata:unsafeCleanupMetadata}),/news_recovery_gap_transport_may_have_started/);
const run14={id:'41280216473',run_number:14,head_sha:'934b6aca57f7ed4530931b7a7a18bb3a029a56b'},run14Gate={...gate},run14Collect={...collect};
const realRun14Job={id:124770445207,name:'preview',run_id:'41280216473',head_sha:run14.head_sha,run_attempt:1,status:'completed',conclusion:'failure',steps:[run14Gate,run14Collect,{name:'Upload nonpublishable review evidence even after an interrupted or denied collection',conclusion:'success'},{name:'Post Run actions/checkout@v6',conclusion:'success'},{name:'Complete job',conclusion:'success'}]};
assert.equal(validateNewsRecoveryGapJobs({run:run14,jobs:[realRun14Job]}).length,1,'run 14 job 124770445207 preserves the observed cleanup labels');
assert.throws(()=>validateNewsRecoveryGapJobs({run:run14,jobs:[{...realRun14Job,steps:[...realRun14Job.steps,{name:'Unexpected successful cache restore',conclusion:'success'}]}]}),/news_recovery_gap_transport_may_have_started/);
await assert.rejects(resolveNewsRecoveryHistory({env:{...env,GITHUB_RUN_NUMBER:'9',GITHUB_RUN_ID:'900'},metadata}),/explicit_predecessor_or_concurrent_run_mismatch/);
await assert.rejects(resolveNewsRecoveryHistory({env:{...env,GITHUB_RUN_ATTEMPT:'2'},metadata}),/invalid_current_environment_or_rerun/,'reruns cannot claim the reviewed descriptor');
await assert.rejects(resolveNewsRecoveryHistory({env:{...env,GITHUB_RUN_NUMBER:'27',GITHUB_RUN_ID:'2700',NEWS_RECOVERY_PREDECESSOR_RUN_NUMBER:'26',NEWS_RECOVERY_PREDECESSOR_RUN_ID:'2600'},metadata}),/gap_history_exceeds_bounded_review/);
await assert.rejects(resolveNewsRecoveryHistory({env:{...env,NEWS_RECOVERY_GLOBAL_CALL_APPROVED:'false'},metadata}),/both_explicit_approvals_required/);
await assert.rejects(resolveNewsRecoveryHistory({env:{...env,GITHUB_EVENT_NAME:'push'},metadata}),/invalid_current_environment_or_rerun/,'unsupported cache-action warning event cannot reach claim creation');
await assert.rejects(resolveNewsRecoveryHistory({env:{...env,GITHUB_REF:'refs/tags/recovery'},metadata}),/invalid_current_environment_or_rerun/,'tag refs cannot reach cache-miss classification');

// Synthetic anchor fixtures let the byte-verification path be exercised without
// downloading or duplicating the separately reviewed production artifact.
const payloadBytes=Buffer.from(JSON.stringify({version:2,disposition:'nonpublishable_requires_review',candidates:[],diagnostics:[]}));
const anchor={...NEWS_RECOVERY_ANCHOR,runId:'500',runNumber:5,sha:shaFor(5),artifactId:'9000',artifactSize:1,artifactSha256:'d'.repeat(64),payloadSha256:payloadDigest(payloadBytes),payloadKey:cacheKey({repository:NEWS_REPOSITORY,repositoryId:'1348899318',workflowId:'398735078',runNumber:5,runId:'500',runAttempt:1,sha:shaFor(5)})};
const anchorIdentity={repository:NEWS_REPOSITORY,repositoryId:'1348899318',workflowPath:NEWS_WORKFLOW,workflowId:'398735078',runId:'500',runNumber:5,runAttempt:1,sha:anchor.sha,ref:'refs/heads/main'};
const receiptBytes=Buffer.from(JSON.stringify(finalReceipt(anchorIdentity,payloadBytes)));
const anchorMetadata={...anchorRun,id:500,head_sha:anchor.sha};
const artifactMetadataFor=a=>({id:a.artifactId,name:a.artifactName,size_in_bytes:a.artifactSize,digest:`sha256:${a.artifactSha256}`,expired:false,workflow_run:{id:a.runId,repository_id:a.repositoryId,head_repository_id:a.repositoryId,head_branch:'main',head_sha:a.sha}});
const validProof=verifyNewsRecoveryCheckpoint({mode:'exact-cache',anchor,anchorMetadata,payloadBytes,receiptBytes,cachePayloadHit:'true',cachePayloadKey:anchor.payloadKey,cacheReceiptHit:'true',cacheReceiptKey:`${anchor.payloadKey}-final`});
assert.equal(isVerifiedNewsRecoveryCheckpoint(validProof),true);
for(const patch of [
  {cachePayloadHit:'false'},
  {cachePayloadKey:'prefix-'+anchor.payloadKey},
  {cacheReceiptHit:'false'},
  {cacheReceiptKey:anchor.payloadKey},
  {payloadBytes:Buffer.from('wrong bytes')},
  {receiptBytes:null},
  {anchorMetadata:{...anchorMetadata,head_sha:'c'.repeat(40)}},
  {receiptBytes:Buffer.from(JSON.stringify({...JSON.parse(receiptBytes),identity:{...anchorIdentity,runId:'501'}}))}
]) assert.throws(()=>verifyNewsRecoveryCheckpoint({mode:'exact-cache',anchor,anchorMetadata,payloadBytes,receiptBytes,cachePayloadHit:'true',cachePayloadKey:anchor.payloadKey,cacheReceiptHit:'true',cacheReceiptKey:`${anchor.payloadKey}-final`,...patch}),/news_/);
assert.throws(()=>verifyNewsRecoveryCheckpoint({mode:'exact-artifact',anchor,anchorMetadata,artifactMetadata:{id:'9001',name:anchor.artifactName,size_in_bytes:1,digest:`sha256:${anchor.artifactSha256}`,workflow_run:{id:'500',head_sha:anchor.sha}}}),/news_recovery_artifact_metadata_mismatch/);
assert.throws(()=>verifyNewsRecoveryCheckpoint({mode:'exact-artifact',anchor,anchorMetadata,artifactMetadata:artifactMetadataFor(anchor),artifactZip:Buffer.from('bad')}),/news_recovery_artifact_zip_digest_mismatch/);
const priorIdentity={...anchorIdentity,runId:'400',runNumber:4,sha:'4'.repeat(40)},priorReceipt=finalReceipt(priorIdentity,Buffer.from('prior payload'));
const artifactPlan={version:3,current:anchorIdentity,predecessor:priorIdentity,cacheKey:anchor.payloadKey,predecessorCacheKey:cacheKey(priorIdentity),events:{current:'schedule',predecessor:'schedule'}};
const collectedBytes=Buffer.from(JSON.stringify({version:3,kind:'news_preview_collected',identity:anchorIdentity,payloadSha256:anchor.payloadSha256,transportDecisionsDrained:true}));
function makeZip(files){
  const locals=[],centrals=[];let offset=0;
  for(const [name,bytes] of Object.entries(files)){
    const nameBytes=Buffer.from(name),data=Buffer.from(bytes),compressed=deflateRawSync(data),local=Buffer.alloc(30+nameBytes.length);
    local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0,6);local.writeUInt16LE(8,8);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(nameBytes.length,26);nameBytes.copy(local,30);locals.push(local,compressed);
    const central=Buffer.alloc(46+nameBytes.length);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(nameBytes.length,28);central.writeUInt32LE(offset,42);nameBytes.copy(central,46);centrals.push(central);offset+=local.length+compressed.length;
  }
  const centralBytes=Buffer.concat(centrals),centralOffset=offset,end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(5,8);end.writeUInt16LE(5,10);end.writeUInt32LE(centralBytes.length,12);end.writeUInt32LE(centralOffset,16);return Buffer.concat([...locals,centralBytes,end]);
}
const artifactZip=makeZip({'news-preview-collected.json':collectedBytes,'news-preview-final.json':receiptBytes,'news-preview-lineage-plan.json':Buffer.from(JSON.stringify(artifactPlan)),'news-preview-predecessor.json':Buffer.from(JSON.stringify(priorReceipt)),'news-preview.json':payloadBytes});
const artifactAnchor={...anchor,artifactSize:artifactZip.length,artifactSha256:payloadDigest(artifactZip)};
const validArtifactProof=verifyNewsRecoveryCheckpoint({mode:'exact-artifact',anchor:artifactAnchor,anchorMetadata,artifactMetadata:artifactMetadataFor(artifactAnchor),artifactZip,payloadBytes,receiptBytes});
assert.equal(validArtifactProof.payloadSha256,artifactAnchor.payloadSha256);
assert.throws(()=>verifyNewsRecoveryCheckpoint({mode:'exact-artifact',anchor:artifactAnchor,anchorMetadata,artifactMetadata:artifactMetadataFor(artifactAnchor),artifactZip:Buffer.concat([artifactZip,Buffer.from('x')]),payloadBytes,receiptBytes}),/news_recovery_artifact_zip_digest_mismatch/);
const missingReceiptZip=makeZip({'news-preview-collected.json':collectedBytes,'news-preview-lineage-plan.json':Buffer.from(JSON.stringify(artifactPlan)),'news-preview-predecessor.json':Buffer.from(JSON.stringify(priorReceipt)),'news-preview.json':payloadBytes});
const missingReceiptAnchor={...anchor,artifactSize:missingReceiptZip.length,artifactSha256:payloadDigest(missingReceiptZip)};
assert.throws(()=>verifyNewsRecoveryCheckpoint({mode:'exact-artifact',anchor:missingReceiptAnchor,anchorMetadata,artifactMetadata:artifactMetadataFor(missingReceiptAnchor),artifactZip:missingReceiptZip,payloadBytes}),/news_recovery_artifact_zip_structure_mismatch/);

const registry={version:1,sources:[{id:'global-halifax',feedUrl:'https://globalnews.ca/halifax/feed',enabled:true}]},registrySha256='a'.repeat(64),accessPolicySha256='c'.repeat(64);
const approval=createNewsRecoveryApprovalDescriptor({anchor,evidence,checkpointMode:'exact-cache',registry,registrySha256,accessPolicySha256,approvedCommit:env.GITHUB_SHA});
const approvedEnv={...env,NEWS_RECOVERY_DESCRIPTOR_SHA256:approval.sha256};
const plan=createNewsRecoveryPlan({env:approvedEnv,evidence,checkpointMode:'exact-cache',registry,registrySha256,accessPolicySha256,anchor});
const samePlan=createNewsRecoveryPlan({env:approvedEnv,evidence,checkpointMode:'exact-cache',registry,registrySha256,accessPolicySha256,anchor});
assert.throws(()=>createNewsRecoveryPlan({env:{...approvedEnv,NEWS_RECOVERY_DESCRIPTOR_SHA256:'0'.repeat(64)},evidence,checkpointMode:'exact-cache',registry,registrySha256,accessPolicySha256,anchor}),/news_recovery_pre_reviewed_descriptor_mismatch/);
assert.throws(()=>createNewsRecoveryPlan({env:approvedEnv,evidence:{...evidence,predecessor:{...evidence.predecessor,id:'701'}},checkpointMode:'exact-cache',registry,registrySha256,accessPolicySha256,anchor}),/news_recovery_pre_reviewed_descriptor_mismatch/,'a changed concurrent predecessor invalidates the reviewed descriptor');
requireSameNewsRecoveryPlan(plan,samePlan);
assert.throws(()=>requireSameNewsRecoveryPlan(plan,{...samePlan,accessPolicySha256:'e'.repeat(64)}),/news_recovery_preflight_plan_changed/);
assert.throws(()=>createNewsRecoveryPlan({env,evidence,checkpointMode:'exact-cache',registry:{version:1,sources:[{id:'global-halifax',enabled:true},{id:'held',enabled:true}]},registrySha256,accessPolicySha256,anchor}),/news_recovery_current_source_allowlist_mismatch/);
const heldPrevious={diagnostics:[{sourceId:'global-halifax',sourceHost:'globalnews.ca',accessHeld:true}]};
assert.equal(requireRecoveryHoldsPreserved(heldPrevious,{diagnostics:[{sourceId:'global-halifax',sourceHost:'globalnews.ca',accessHeld:true}]}),true);
assert.throws(()=>requireRecoveryHoldsPreserved(heldPrevious,{diagnostics:[{sourceId:'global-halifax',sourceHost:'globalnews.ca',accessHeld:false}]}),/news_recovery_lost_access_hold/);
assert.throws(()=>requireRecoveryHoldsPreserved({diagnostics:[{sourceId:'global-halifax',sourceHost:'globalnews.ca',configHash:'a'.repeat(64),status:'access_held',accessHeld:true,etag:null,lastModified:null,lastAttemptAt:'2026-01-01',lastSuccessAt:null,retryNotBefore:null,error:'source_access_hold'}]},{diagnostics:[{sourceId:'global-halifax',sourceHost:'globalnews.ca',configHash:'a'.repeat(64),status:'access_held',accessHeld:true,etag:null,lastModified:null,lastAttemptAt:'2026-01-01',lastSuccessAt:null,retryNotBefore:null,error:'changed'}]}),/news_recovery_lost_access_hold/);

const dir=await mkdtemp(`${tmpdir()}/news-recovery-e2e-`),paths=lineagePaths(pathToFileURL(`${dir}/`));
try{
  await writeNewsRecoveryClaim({plan,path:paths.recoveryToken});
  assert.equal(await verifyNewsRecoveryClaimFile({plan,path:paths.recoveryToken}),true,'the own claim is read back before collection');
  const tokenBytes=await readFile(paths.recoveryToken);
  let collectorCalls=0;
  const consumed={plan,proof:validProof,env,registrySha256,accessPolicySha256,tokenBytes,consumedPath:paths.recoveryConsumed,previous:validProof.payload,collect:async()=>{collectorCalls++;},loadResult:async()=>validProof.payload};
  await assert.rejects(executeNewsRecoveryPass({...consumed,previous:{diagnostics:[]}}),/news_recovery_recovery_proof_payload_or_anchor_mismatch/);
  await assert.rejects(executeNewsRecoveryPass({...consumed,proof:{...validProof,anchorIdentity:{...validProof.anchorIdentity,runId:'wrong'}}}),/news_recovery_recovery_proof_payload_or_anchor_mismatch/);
  await executeNewsRecoveryPass(consumed);
  assert.equal(collectorCalls,1,'verified approval permits one collector invocation');
  assert.equal(JSON.parse(await readFile(paths.recoveryConsumed,'utf8')).kind,'news_preview_recovery_consumed');
  await assert.rejects(executeNewsRecoveryPass(consumed),{code:'EEXIST'},'one local job cannot consume the same plan twice');
  assert.equal(collectorCalls,1,'a repeated claim cannot invoke collection again');
  await assert.rejects(executeNewsRecoveryPass({...consumed,accessPolicySha256:'e'.repeat(64),consumedPath:paths.recoveryZip}),/news_recovery_recovery_plan_changed/);
  assert.equal(collectorCalls,1,'a changed global policy blocks the collector');
  await assert.rejects(writeNewsRecoveryClaim({plan,path:paths.recoveryToken}),{code:'EEXIST'},'claim creation is single-use within the exact run');
  await assert.rejects(executeNewsRecoveryPass({...consumed,tokenBytes:Buffer.from(JSON.stringify({kind:'news_preview_recovery_claim',key:plan.tokenKey,planSha256:plan.planSha256,current:{...plan.current,runId:'other'}})),consumedPath:paths.recoveryZip}),/news_recovery_own_claim_identity_mismatch/);
}finally{await rm(dir,{recursive:true,force:true});}

// Offline runner fixture follows the wrapper's claim -> sole collector -> receipt path.
const runnerDir=await mkdtemp(`${tmpdir()}/news-recovery-runner-`);
const runnerPaths=lineagePaths(pathToFileURL(`${runnerDir}/`));
const prepareRunner=async paths=>{
  await writeFile(paths.payload,payloadBytes);
  await writeFile(paths.receipt,receiptBytes);
  await writeFile(paths.plan,JSON.stringify(plan));
  await writeNewsRecoveryClaim({plan,path:paths.recoveryToken});
  await verifyNewsRecoveryClaimFile({plan,path:paths.recoveryToken});
};
const offlineRun=async(paths,claimRecovery,collect)=>collectWithRecovery({
  env:approvedEnv,paths,registry,claimRecovery,collect,
  readPolicy:async()=>({registry,registrySha256,accessPolicySha256})
});
try{
  let failedPreflightTransport=0;
  await assert.rejects(offlineRun(runnerPaths,async()=>{throw new Error('preflight_changed');},async()=>{failedPreflightTransport++;}),/preflight_changed/);
  assert.equal(failedPreflightTransport,0,'preflight failure cannot invoke the collector');

  await prepareRunner(runnerPaths);
  let transportCalls=0;
  const verifyClaim=async()=>{await verifyNewsRecoveryClaimFile({plan,path:runnerPaths.recoveryToken});return {plan,proof:validProof};};
  await offlineRun(runnerPaths,verifyClaim,async()=>{transportCalls++;await writeFile(runnerPaths.payload,payloadBytes);});
  assert.equal(transportCalls,1,'approved descriptor and exact run permit one collector call');
  assert.deepEqual(await readFile(runnerPaths.predecessorReceipt),receiptBytes,'run-5 receipt is retained before current receipt completion');
  await completeLineage({env:{...approvedEnv,NEWS_SAVED_CACHE_HIT:'true',NEWS_SAVED_CACHE_KEY:plan.cacheKey},paths:runnerPaths});
  await verifyReceiptSaved({env:{...approvedEnv,NEWS_SAVED_CACHE_HIT:'true',NEWS_SAVED_CACHE_KEY:`${plan.cacheKey}-final`},paths:runnerPaths});
  await assert.rejects(offlineRun(runnerPaths,verifyClaim,async()=>{transportCalls++;}),/unexpected_existing_completion_or_bootstrap_file/);
  assert.equal(transportCalls,1,'a second dispatch cannot collect against the consumed run identity');

  const failedAfterDir=await mkdtemp(`${tmpdir()}/news-recovery-after-consume-`),failedAfterPaths=lineagePaths(pathToFileURL(`${failedAfterDir}/`));
  try{
    await prepareRunner(failedAfterPaths);
    let afterConsumeCalls=0;
    const failedCollect=async()=>{afterConsumeCalls++;throw new Error('collector_failed_after_claim');};
    await assert.rejects(offlineRun(failedAfterPaths,async()=>({plan,proof:validProof}),failedCollect),/collector_failed_after_claim/);
    await access(failedAfterPaths.recoveryConsumed);
    await assert.rejects(offlineRun(failedAfterPaths,async()=>({plan,proof:validProof}),failedCollect),/unexpected_existing_completion_or_bootstrap_file|EEXIST/);
    assert.equal(afterConsumeCalls,1,'post-claim failure remains at-most-once and is not retried');
  }finally{await rm(failedAfterDir,{recursive:true,force:true});}
}finally{await rm(runnerDir,{recursive:true,force:true});}

// Integration fixture runs the real plan/claim/checkpoint/collect/receipt wrappers.
const realRegistry=JSON.parse(await readFile(new URL('../data/news-source-registry.json',import.meta.url),'utf8'));
const realRegistryBytes=await readFile(new URL('../data/news-source-registry.json',import.meta.url));
const realPolicyBytes=await readFile(new URL('../data/source-link-access-holds.json',import.meta.url));
const realRegistrySha=payloadDigest(realRegistryBytes),realPolicySha=payloadDigest(realPolicyBytes);
const realPolicy=async()=>({registry:realRegistry,registrySha256:realRegistrySha,accessPolicySha256:realPolicySha});
const integrationPayloadBytes=Buffer.from(JSON.stringify({
  version:2,disposition:'nonpublishable_requires_review',candidates:[],
  diagnostics:realRegistry.sources.map(source=>({
    sourceId:source.id,sourceHost:new URL(source.feedUrl||source.homeUrl).hostname,
    configHash:payloadDigest(JSON.stringify([source.id,source.feedUrl,source.allowedHosts,source.source_type])),
    status:source.enabled?'pending_review':'disabled',accessHeld:false,
    etag:null,lastModified:null,lastAttemptAt:null,lastSuccessAt:null,retryNotBefore:null
  }))
}));
const integrationAnchor={...anchor,payloadSha256:payloadDigest(integrationPayloadBytes)};
const integrationIdentity={...anchorIdentity,sha:integrationAnchor.sha};
const integrationReceiptBytes=Buffer.from(JSON.stringify(finalReceipt(integrationIdentity,integrationPayloadBytes)));
const integrationEnv={...env,NEWS_RECOVERY_PAYLOAD_CACHE_HIT:'true',NEWS_RECOVERY_PAYLOAD_CACHE_KEY:integrationAnchor.payloadKey,NEWS_RECOVERY_RECEIPT_CACHE_HIT:'true',NEWS_RECOVERY_RECEIPT_CACHE_KEY:`${integrationAnchor.payloadKey}-final`};
const integrationCurrent=structuredClone(current);
const integrationRuns=[integrationCurrent,r7,r6,{...run(5,500,'completed','success','schedule'),head_sha:integrationAnchor.sha}];
const integrationMetadata=async path=>{
  if(path===`/repos/${NEWS_REPOSITORY}`)return structuredClone(repo);
  if(path===`/repos/${NEWS_REPOSITORY}/actions/runs/800`)return structuredClone(integrationCurrent);
  if(path===`/repos/${NEWS_REPOSITORY}/actions/workflows/398735078/runs?per_page=100&page=1`)return {total_count:4,workflow_runs:structuredClone(integrationRuns)};
  if(path===`/repos/${NEWS_REPOSITORY}/actions/runs/500`)return structuredClone(integrationRuns[3]);
  for(const item of [r6,r7]){
    if(path===`/repos/${NEWS_REPOSITORY}/actions/runs/${item.id}`)return structuredClone(item);
    if(path===`/repos/${NEWS_REPOSITORY}/actions/runs/${item.id}/jobs?per_page=100&page=1`)return {total_count:1,jobs:[job(item.run_number)]};
  }
  throw new Error(`unexpected_integration_metadata_path:${path}`);
};
const integrationEvidence=await resolveNewsRecoveryHistory({env:integrationEnv,metadata:integrationMetadata,anchor:integrationAnchor});
const integrationApproval=createNewsRecoveryApprovalDescriptor({anchor:integrationAnchor,evidence:integrationEvidence,checkpointMode:'exact-cache',registry:realRegistry,registrySha256:realRegistrySha,accessPolicySha256:realPolicySha,approvedCommit:integrationEnv.GITHUB_SHA});
const approvedIntegrationEnv={...integrationEnv,NEWS_RECOVERY_DESCRIPTOR_SHA256:integrationApproval.sha256};
const integrationDir=await mkdtemp(`${tmpdir()}/news-recovery-real-wrapper-`),integrationPaths=lineagePaths(pathToFileURL(`${integrationDir}/`));
const prepareIntegration=async(paths,metadata=integrationMetadata,readPolicy=realPolicy)=>{
  await createLineagePlan({env:approvedIntegrationEnv,paths,metadata,anchor:integrationAnchor,readPolicy});
  await writeFile(paths.payload,integrationPayloadBytes);
  await writeFile(paths.receipt,integrationReceiptBytes);
};
try{
  let realTransportCalls=0;
  await prepareIntegration(integrationPaths);
  const claimed=await claimNewsRecovery({env:approvedIntegrationEnv,paths:integrationPaths,metadata:integrationMetadata,anchor:integrationAnchor,readPolicy:realPolicy});
  assert.equal(claimed.plan.approvalDescriptorSha256,integrationApproval.sha256);
  assert.equal(realTransportCalls,0,'the real claim wrapper verifies checkpoint and writes claim without collecting');
  await collectWithRecovery({env:approvedIntegrationEnv,paths:integrationPaths,metadata:integrationMetadata,registry:realRegistry,anchor:integrationAnchor,readPolicy:realPolicy,collect:async()=>{realTransportCalls++;await writeFile(integrationPaths.payload,integrationPayloadBytes);}});
  assert.equal(realTransportCalls,1,'real claim/checkpoint wrapper reaches its sole injected collector once');
  await completeLineage({env:{...approvedIntegrationEnv,NEWS_SAVED_CACHE_HIT:'true',NEWS_SAVED_CACHE_KEY:claimed.plan.cacheKey},paths:integrationPaths});
  await verifyReceiptSaved({env:{...approvedIntegrationEnv,NEWS_SAVED_CACHE_HIT:'true',NEWS_SAVED_CACHE_KEY:`${claimed.plan.cacheKey}-final`},paths:integrationPaths});

  const changedDir=await mkdtemp(`${tmpdir()}/news-recovery-changed-metadata-`),changedPaths=lineagePaths(pathToFileURL(`${changedDir}/`));
  try{
    await prepareIntegration(changedPaths);
    const changedMetadata=async path=>{const value=await integrationMetadata(path);if(path.endsWith('/runs?per_page=100&page=1'))value.workflow_runs.find(r=>r.run_number===7).head_sha='c'.repeat(40);if(path.endsWith('/runs/700'))value.head_sha='c'.repeat(40);return value;};
    let calls=0;
    await assert.rejects(collectWithRecovery({env:approvedIntegrationEnv,paths:changedPaths,metadata:changedMetadata,registry:realRegistry,anchor:integrationAnchor,readPolicy:realPolicy,collect:async()=>{calls++;}}),/news_recovery_/);
    assert.equal(calls,0,'changed predecessor metadata stops before source transport');
  }finally{await rm(changedDir,{recursive:true,force:true});}

  const policyDir=await mkdtemp(`${tmpdir()}/news-recovery-changed-policy-`),policyPaths=lineagePaths(pathToFileURL(`${policyDir}/`));
  try{
    await prepareIntegration(policyPaths);
    let calls=0;
    await assert.rejects(collectWithRecovery({env:approvedIntegrationEnv,paths:policyPaths,metadata:integrationMetadata,registry:realRegistry,anchor:integrationAnchor,readPolicy:async()=>({...await realPolicy(),accessPolicySha256:'e'.repeat(64)}),collect:async()=>{calls++;}}),/news_recovery_/);
    assert.equal(calls,0,'changed access policy stops before source transport');
  }finally{await rm(policyDir,{recursive:true,force:true});}
}finally{await rm(integrationDir,{recursive:true,force:true});}

const workflow=await readFile(new URL('../.github/workflows/news-preview.yml',import.meta.url),'utf8');
assert.match(workflow,/recovery_approval:[\s\S]*?default: false/);
assert.match(workflow,/approve_global_feed_call:[\s\S]*?default: false/);
assert.match(workflow,/recovery_descriptor_sha256:[\s\S]*?reviewed immutable recovery descriptor/);
assert.match(workflow,/concurrency:[\s\S]*?group: regional-news-review-cache[\s\S]*?cancel-in-progress: false/);
assert.match(workflow,/Verify run-5 bytes, receipts, gap history and current policy before claiming recovery[\s\S]*?node scripts\/news-preview-lineage.mjs claim-recovery[\s\S]*?node scripts\/news-preview-lineage.mjs collect/);
assert.doesNotMatch(workflow,/NEWS_RECOVERY_TOKEN_CACHE|prior-recovery-token|recovery-token-key/,'recovery no longer depends on ambiguous token-cache misses');
assert.match(workflow,/Restore only the exact successful predecessor payload[\s\S]*?steps\.lineage\.outputs\.recovery != 'true'/);
assert.doesNotMatch(workflow,/restore-keys:|NEWS_RECOVERY_CHECKPOINT_MODE:.*latest|Regional News Preview.*workflow_run/);
console.log('News recovery tests passed: official contiguous pre-transport gap resolution, concurrency/current predecessor gate, pinned anchor bytes/receipts, artifact/cache mismatch, policy/registry fingerprints, descriptor-bound exact-run own claim and local single-use marker. No network calls.');
