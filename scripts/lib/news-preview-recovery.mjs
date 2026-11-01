import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { NEWS_REPOSITORY, NEWS_WORKFLOW, cacheKey, environmentIdentity, githubMetadata, payloadDigest, verifyFinalReceipt } from './news-run-lineage.mjs';
import { validateNewsCache } from '../import-regional-news.mjs';
import { newsArtifactFiles } from './news-health-receipt.mjs';

const fail = reason => { throw new Error(`news_recovery_${reason}`); };
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const positive = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const json = bytes => { try { return JSON.parse(Buffer.from(bytes).toString('utf8')); } catch { fail('invalid_checkpoint_json'); } };
const shaJson = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const withoutPlanDigest = plan => { const {planSha256,...body}=plan; return body; };
const verifiedProofs = new WeakSet();

export const NEWS_RECOVERY_ANCHOR = Object.freeze({
  repository: NEWS_REPOSITORY, repositoryId: '1348899318', workflowPath: NEWS_WORKFLOW,
  workflowId: '398735078', runNumber: 5, runId: '40826153584', attempt: 1,
  event: 'schedule', ref: 'refs/heads/main', sha: '0a622a37c4aca0e8512f0e22b9f55ccefacf7a2d',
  artifactId: '12876876744', artifactName: 'regional-news-review-only', artifactSize: 4456,
  artifactSha256: '5217023f1dce43cd8fe2405ffdeda02ac22107a0cfc6a0f28da95d5aa0a6c7d5',
  payloadSha256: 'da918b2e6170b22d10ec24fb3f93c6218fc3ef801c816a547b85797b4a5aee8d',
  payloadKey: 'news-review-v3-1348899318-398735078-5-40826153584-1-0a622a37c4aca0e8512f0e22b9f55ccefacf7a2d'
});

function anchorIdentity(anchor=NEWS_RECOVERY_ANCHOR) {
  return {repository:NEWS_REPOSITORY,repositoryId:anchor.repositoryId,workflowPath:NEWS_WORKFLOW,workflowId:anchor.workflowId,runId:anchor.runId,runNumber:anchor.runNumber,runAttempt:anchor.attempt,sha:anchor.sha,ref:anchor.ref};
}
function checkRun(run, number, conclusion = 'failure', anchor=NEWS_RECOVERY_ANCHOR) {
  if (!run || Number(run.run_number) !== number || !positive(run.id) || Number(run.workflow_id) !== Number(anchor.workflowId) || run.path !== NEWS_WORKFLOW || run.repository?.full_name !== NEWS_REPOSITORY || String(run.repository?.id) !== anchor.repositoryId || run.head_branch !== 'main' || !sha(run.head_sha) || run.run_attempt !== 1 || run.status !== 'completed' || run.conclusion !== conclusion || !['schedule','workflow_dispatch'].includes(run.event)) fail('invalid_gap_run');
}
export function validateNewsRecoveryGapJobs(entry) {
  if (!Array.isArray(entry.jobs) || entry.jobs.length!==1 || entry.jobs[0].name!=='preview') fail('missing_or_ambiguous_gap_jobs');
  if(entry.jobs.some(job=>String(job.run_id)!==String(entry.run.id)||String(job.head_sha)!==entry.run.head_sha||job.run_attempt!==1||job.status!=='completed'||job.conclusion!=='failure'))fail('gap_job_identity_mismatch');
  let gateCount=0, collectCount=0;
  const steps=entry.jobs.flatMap(job=>Array.isArray(job.steps)?job.steps:[]);
  for(const step of steps){
    if(step.name==='Verify current run and exact sequential predecessor with public GitHub metadata') {gateCount++;if(step.conclusion!=='failure') fail('gap_not_pre_transport_failure');}
    if(step.name==='Verify receipt and digest before any news or robots request') {collectCount++;if(step.conclusion!=='skipped') fail('gap_collector_not_skipped');}
  }
  if(gateCount!==1||collectCount!==1) fail('gap_failure_stage_unproven');
  const gateIndex=steps.findIndex(step=>step.name==='Verify current run and exact sequential predecessor with public GitHub metadata');
  const collectIndex=steps.findIndex(step=>step.name==='Verify receipt and digest before any news or robots request');
  const safePostGateSteps=new Set(['Upload nonpublishable review evidence even after an interrupted or denied collection','Post Run actions/checkout@v6','Complete job']);
  if(gateIndex<0||collectIndex<=gateIndex||steps.slice(gateIndex+1).some(step=>safePostGateSteps.has(step.name)? !['success','skipped'].includes(step.conclusion) : step.conclusion!=='skipped')) fail('gap_transport_may_have_started');
  return entry.jobs.map(job=>({id:String(job.id),name:job.name,conclusion:job.conclusion,steps:job.steps.map(step=>({name:step.name,conclusion:step.conclusion}))}));
}

/** Resolve the current run and every failed gap from official Actions metadata. */
export async function resolveNewsRecoveryHistory({env,metadata=githubMetadata,maxPages=20,anchor=NEWS_RECOVERY_ANCHOR}) {
  if(env.NEWS_RECOVERY_APPROVED!=='true'||env.NEWS_RECOVERY_GLOBAL_CALL_APPROVED!=='true') fail('both_explicit_approvals_required');
  const identity=environmentIdentity(env);
  if(env.GITHUB_EVENT_NAME!=='workflow_dispatch'||identity.ref!==anchor.ref||env.NEWS_INITIALIZE_REVIEW_CACHE!=='false') fail('invalid_recovery_environment');
  const pNumber=Number(env.NEWS_RECOVERY_PREDECESSOR_RUN_NUMBER),pId=String(env.NEWS_RECOVERY_PREDECESSOR_RUN_ID||'');
  if(!Number.isSafeInteger(pNumber)||pNumber<=anchor.runNumber||!positive(pId)||identity.runNumber!==pNumber+1) fail('explicit_predecessor_or_concurrent_run_mismatch');
  if(pNumber-anchor.runNumber>20)fail('gap_history_exceeds_bounded_review');
  const repo=await metadata(`/repos/${NEWS_REPOSITORY}`);
  if(repo?.full_name!==NEWS_REPOSITORY||String(repo.id)!==anchor.repositoryId||repo.private!==false||repo.default_branch!=='main') fail('repository_metadata_mismatch');
  const current=await metadata(`/repos/${NEWS_REPOSITORY}/actions/runs/${identity.runId}`);
  if(String(current.id)!==identity.runId||current.run_number!==identity.runNumber||current.run_attempt!==1||current.status!=='in_progress'||current.conclusion!==null||current.event!=='workflow_dispatch'||current.path!==NEWS_WORKFLOW||Number(current.workflow_id)!==Number(anchor.workflowId)||current.head_sha!==env.GITHUB_SHA||current.head_branch!=='main'||current.repository?.full_name!==NEWS_REPOSITORY||String(current.repository?.id)!==anchor.repositoryId) fail('current_metadata_mismatch');
  const found=[]; let total=null;
  for(let page=1;page<=maxPages;page++){
    const list=await metadata(`/repos/${NEWS_REPOSITORY}/actions/workflows/${anchor.workflowId}/runs?per_page=100&page=${page}`);
    if(!Array.isArray(list?.workflow_runs)||!Number.isSafeInteger(list.total_count)||list.total_count<list.workflow_runs.length||list.workflow_runs.length>100) fail('invalid_history_listing');
    total=list.total_count;
    found.push(...list.workflow_runs.filter(run=>Number(run.run_number)>anchor.runNumber&&Number(run.run_number)<=pNumber));
    if(found.length>=pNumber-anchor.runNumber||page*100>=total) break;
  }
  const expectedCount=pNumber-anchor.runNumber;
  if(found.length!==expectedCount) fail('incomplete_or_duplicate_gap_listing');
  const byNumber=new Map();
  for(const run of found){const n=Number(run.run_number);if(byNumber.has(n)) fail('ambiguous_gap_run');byNumber.set(n,run);}
  const gaps=[];
  for(let n=anchor.runNumber+1;n<=pNumber;n++){
    const listed=byNumber.get(n); if(!listed) fail('missing_gap_run');
    const run=await metadata(`/repos/${NEWS_REPOSITORY}/actions/runs/${listed.id}`);checkRun(run,n,'failure',anchor);
    if(String(run.id)!==String(listed.id)||run.head_sha!==listed.head_sha||run.event!==listed.event||run.conclusion!==listed.conclusion||run.status!==listed.status||run.run_attempt!==listed.run_attempt) fail('gap_listing_direct_mismatch');
    const jobs=await metadata(`/repos/${NEWS_REPOSITORY}/actions/runs/${run.id}/jobs?per_page=100&page=1`);
    if(!Array.isArray(jobs?.jobs)||jobs.jobs.length!==1||jobs.total_count!==1) fail('invalid_gap_job_metadata');
    const normalizedJobs=validateNewsRecoveryGapJobs({run,jobs:jobs.jobs});
    gaps.push({run:{id:String(run.id),runNumber:n,attempt:run.run_attempt,event:run.event,status:run.status,conclusion:run.conclusion,sha:run.head_sha,createdAt:run.created_at,updatedAt:run.updated_at},jobs:normalizedJobs});
  }
  const predecessor=gaps.at(-1).run;
  if(predecessor.id!==pId||predecessor.runNumber!==pNumber) fail('explicit_predecessor_identity_mismatch');
  const anchorRun=await metadata(`/repos/${NEWS_REPOSITORY}/actions/runs/${anchor.runId}`);
  checkRun(anchorRun,anchor.runNumber,'success',anchor);
  if(String(anchorRun.id)!==anchor.runId||anchorRun.head_sha!==anchor.sha||anchorRun.event!=='schedule') fail('anchor_run_identity_mismatch');
  return {identity,current,predecessor,gaps,anchor:anchorRun};
}

/** Validate the actual restored bytes. A caller cannot substitute a digest claim. */
export function verifyNewsRecoveryCheckpoint({mode,anchor=NEWS_RECOVERY_ANCHOR,anchorMetadata,artifactMetadata,artifactZip,payloadBytes,receiptBytes,collectedBytes,planBytes,predecessorReceiptBytes,cachePayloadHit,cachePayloadKey,cacheReceiptHit,cacheReceiptKey}) {
  checkRun(anchorMetadata,anchor.runNumber,'success',anchor);
  if(String(anchorMetadata.id)!==anchor.runId||anchorMetadata.head_sha!==anchor.sha||anchorMetadata.event!==anchor.event) fail('checkpoint_anchor_identity_mismatch');
  let payload=payloadBytes,receipt=receiptBytes,collected=null,plan=null,predecessorReceipt=null;
  if(mode==='exact-cache'){
    if(cachePayloadHit!=='true'||cachePayloadKey!==anchor.payloadKey||cacheReceiptHit!=='true'||cacheReceiptKey!==`${anchor.payloadKey}-final`) fail('exact_cache_key_miss_or_mismatch');
  } else if(mode==='exact-artifact'){
    if(!artifactMetadata||String(artifactMetadata.id)!==anchor.artifactId||artifactMetadata.name!==anchor.artifactName||artifactMetadata.size_in_bytes!==anchor.artifactSize||artifactMetadata.digest!==`sha256:${anchor.artifactSha256}`||artifactMetadata.expired!==false||String(artifactMetadata.workflow_run?.id)!==anchor.runId||String(artifactMetadata.workflow_run?.repository_id)!==anchor.repositoryId||String(artifactMetadata.workflow_run?.head_repository_id)!==anchor.repositoryId||artifactMetadata.workflow_run?.head_branch!=='main'||artifactMetadata.workflow_run?.head_sha!==anchor.sha) fail('artifact_metadata_mismatch');
    if(!Buffer.isBuffer(artifactZip)||artifactZip.length!==anchor.artifactSize||payloadDigest(artifactZip)!==anchor.artifactSha256) fail('artifact_zip_digest_mismatch');
    let entries; try{entries=newsArtifactFiles(artifactZip);}catch{fail('artifact_zip_structure_mismatch');}
    payload=entries['news-preview.json']; receipt=entries['news-preview-final.json']; collected=entries['news-preview-collected.json']; plan=entries['news-preview-lineage-plan.json']; predecessorReceipt=entries['news-preview-predecessor.json'];
    if(!payloadBytes||!Buffer.from(payloadBytes).equals(payload)||!receiptBytes||!Buffer.from(receiptBytes).equals(receipt)) fail('artifact_extracted_bytes_mismatch');
  } else fail('invalid_checkpoint_mode');
  if(!Buffer.isBuffer(payload)||payloadDigest(payload)!==anchor.payloadSha256) fail('checkpoint_payload_digest_mismatch');
  if(!Buffer.isBuffer(receipt))fail('missing_checkpoint_final_receipt');
  const parsedPayload=validateNewsCache(json(payload));
  const identity=anchorIdentity(anchor);
  verifyFinalReceipt(json(receipt),identity,payload);
  if(mode==='exact-artifact'){
    const expectedCollected={version:3,kind:'news_preview_collected',identity,payloadSha256:anchor.payloadSha256,transportDecisionsDrained:true};
    const parsedPlan=json(plan), prior=json(predecessorReceipt);
    if(JSON.stringify(json(collected))!==JSON.stringify(expectedCollected)) fail('artifact_collected_receipt_mismatch');
    if(parsedPlan.version!==3||JSON.stringify(parsedPlan.current)!==JSON.stringify(identity)||parsedPlan.cacheKey!==anchor.payloadKey||parsedPlan.events?.current!=='schedule'||!parsedPlan.predecessor||parsedPlan.predecessor.runNumber!==anchor.runNumber-1||parsedPlan.predecessor.runAttempt!==1) fail('artifact_lineage_plan_mismatch');
    if(prior.version!==3||prior.kind!=='news_preview_final'||prior.identity?.runId!==parsedPlan.predecessor.runId||prior.identity?.sha!==parsedPlan.predecessor.sha||prior.cacheKey!==parsedPlan.predecessorCacheKey||!digest(prior.payloadSha256)||prior.transportDecisionsDrained!==true||prior.payloadCacheVerified!==true) fail('artifact_predecessor_receipt_mismatch');
  }
  const proof={mode,payloadBytes:Buffer.from(payload),receiptBytes:Buffer.from(receipt),receipt:json(receipt),payload:parsedPayload,anchorIdentity:identity,payloadSha256:anchor.payloadSha256};
  verifiedProofs.add(proof); return proof;
}
export const isVerifiedNewsRecoveryCheckpoint = proof => verifiedProofs.has(proof);

export function requireRecoveryHoldsPreserved(previous,result){
  if(!Array.isArray(previous?.diagnostics)||!Array.isArray(result?.diagnostics))fail('missing_runtime_hold_diagnostics');
  for(const old of previous.diagnostics.filter(d=>d.accessHeld)){
    const retained=result.diagnostics.find(d=>d.sourceId===old.sourceId);
    for(const field of ['sourceHost','configHash','status','accessHeld','etag','lastModified','lastAttemptAt','lastSuccessAt','retryNotBefore','error'])if(retained?.[field]!==old[field])fail('lost_access_hold');
  }
  return true;
}

export function createNewsRecoveryApprovalDescriptor({anchor=NEWS_RECOVERY_ANCHOR,evidence,checkpointMode,registry,registrySha256,accessPolicySha256,approvedCommit}){
  const source=registry?.sources?.find(item=>item.id==='global-halifax');
  if(!sha(approvedCommit)||!source?.feedUrl||!digest(registrySha256)||!digest(accessPolicySha256)||!Array.isArray(evidence?.gaps))fail('approval_descriptor_inputs_invalid');
  const identity=run=>({id:String(run.id),runNumber:Number(run.runNumber),attempt:Number(run.attempt),event:run.event,status:run.status,conclusion:run.conclusion,sha:run.sha});
  const body={version:1,kind:'news_preview_recovery_approval_descriptor',anchor,predecessor:identity(evidence.predecessor),gaps:evidence.gaps.map(({run})=>({run:identity(run),requiredEvidence:{failedStep:'Verify current run and exact sequential predecessor with public GitHub metadata',failedConclusion:'failure',collectorStep:'Verify receipt and digest before any news or robots request',collectorConclusion:'skipped'}})),approvedCommit,currentRunNumber:Number(evidence.current?.run_number),currentRef:anchor.ref,registrySha256,accessPolicySha256,checkpointMode,source:{id:source.id,endpoint:source.feedUrl},maxCollectionPasses:1};
  return {descriptor:body,sha256:shaJson(body)};
}

/** Gate the sole collector call and check retained runtime holds afterward. */
export async function executeNewsRecoveryPass({plan,proof,env,registrySha256,accessPolicySha256,tokenBytes,consumedPath,previous,collect,loadResult}){
  if(!verifiedProofs.has(proof)||!Buffer.isBuffer(proof.payloadBytes)||payloadDigest(proof.payloadBytes)!==proof.payloadSha256||proof.anchorIdentity?.runId!==plan?.anchor?.runId||proof.anchorIdentity?.sha!==plan?.anchor?.sha||proof.payloadSha256!==plan?.anchor?.payloadSha256||payloadDigest(Buffer.from(JSON.stringify(previous)))!==payloadDigest(Buffer.from(JSON.stringify(proof.payload))))fail('recovery_proof_payload_or_anchor_mismatch');
  await consumeNewsRecoveryPlan({plan,proof,env,registrySha256,accessPolicySha256,tokenBytes,consumedPath});
  await collect();
  const result=await loadResult();
  requireRecoveryHoldsPreserved(previous,result);
  return result;
}

export function createNewsRecoveryPlan({env,evidence,checkpointMode,registry,registrySha256,accessPolicySha256,anchor=NEWS_RECOVERY_ANCHOR}) {
  if(env.NEWS_RECOVERY_APPROVED!=='true'||env.NEWS_RECOVERY_GLOBAL_CALL_APPROVED!=='true') fail('both_explicit_approvals_required');
  if(env.GITHUB_REPOSITORY!==NEWS_REPOSITORY||env.GITHUB_REPOSITORY_ID!==anchor.repositoryId||env.GITHUB_EVENT_NAME!=='workflow_dispatch'||env.GITHUB_RUN_ATTEMPT!=='1'||env.GITHUB_REF!==anchor.ref||env.GITHUB_WORKFLOW_REF!==`${NEWS_REPOSITORY}/${NEWS_WORKFLOW}@${anchor.ref}`||env.NEWS_INITIALIZE_REVIEW_CACHE!=='false'||!sha(env.GITHUB_SHA))fail('invalid_recovery_identity');
  if(!['exact-cache','exact-artifact'].includes(checkpointMode)) fail('invalid_checkpoint_mode');
  if(registry?.version!==1||!Array.isArray(registry.sources)||registry.sources.filter(source=>source.enabled).length!==1||registry.sources.find(source=>source.id==='global-halifax')?.enabled!==true||registry.sources.some(source=>source.id!=='global-halifax'&&source.enabled)) fail('current_source_allowlist_mismatch');
  if(!digest(registrySha256)||!digest(accessPolicySha256)) fail('missing_current_policy_fingerprints');
  const approval=createNewsRecoveryApprovalDescriptor({anchor,evidence,checkpointMode,registry,registrySha256,accessPolicySha256,approvedCommit:env.GITHUB_SHA});
  if(!digest(env.NEWS_RECOVERY_DESCRIPTOR_SHA256)||env.NEWS_RECOVERY_DESCRIPTOR_SHA256!==approval.sha256)fail('pre_reviewed_descriptor_mismatch');
  if(evidence?.identity?.runId!==env.GITHUB_RUN_ID||evidence.identity.runNumber!==Number(env.GITHUB_RUN_NUMBER)||evidence.predecessor?.id!==String(env.NEWS_RECOVERY_PREDECESSOR_RUN_ID)||evidence.predecessor.runNumber!==Number(env.NEWS_RECOVERY_PREDECESSOR_RUN_NUMBER)) fail('evidence_current_or_predecessor_mismatch');
  if(String(evidence.current?.id)!==env.GITHUB_RUN_ID||Number(evidence.current?.workflow_id)!==Number(anchor.workflowId)||evidence.current?.path!==NEWS_WORKFLOW||evidence.current?.repository?.full_name!==NEWS_REPOSITORY||String(evidence.current?.repository?.id)!==anchor.repositoryId||evidence.current?.head_branch!=='main'||evidence.current?.event!=='workflow_dispatch'||evidence.current?.run_attempt!==1||evidence.current?.run_number!==Number(env.GITHUB_RUN_NUMBER)||evidence.current?.head_sha!==env.GITHUB_SHA||evidence.current?.status!=='in_progress'||evidence.current?.conclusion!==null||evidence.predecessor?.runNumber!==Number(evidence.current.run_number)-1||!Array.isArray(evidence.gaps)||evidence.gaps.length!==evidence.predecessor.runNumber-anchor.runNumber)fail('recovery_evidence_incomplete');
  for(let index=0;index<evidence.gaps.length;index++)if(evidence.gaps[index].run?.runNumber!==anchor.runNumber+index+1||evidence.gaps[index].run?.conclusion!=='failure'||evidence.gaps[index].run?.attempt!==1)fail('recovery_gap_sequence_invalid');
  const current={repository:NEWS_REPOSITORY,repositoryId:anchor.repositoryId,workflowPath:NEWS_WORKFLOW,workflowId:anchor.workflowId,runId:String(evidence.current.id),runNumber:evidence.current.run_number,runAttempt:1,sha:evidence.current.head_sha,ref:anchor.ref};
  const predecessor={id:evidence.predecessor.id,runNumber:evidence.predecessor.runNumber,attempt:1,sha:evidence.predecessor.sha};
  const currentCacheKey=cacheKey({repository:NEWS_REPOSITORY,repositoryId:anchor.repositoryId,workflowId:anchor.workflowId,runNumber:current.runNumber,runId:current.runId,runAttempt:1,sha:current.sha});
  const plan={version:1,kind:'news_preview_one_use_recovery',checkpointMode,anchor,current,predecessor,events:{current:'workflow_dispatch',predecessor:evidence.predecessor.event},failedGaps:evidence.gaps,approvalDescriptor:approval.descriptor,approvalDescriptorSha256:approval.sha256,sourceAllowlist:['global-halifax'],maxCollectionPasses:1,registrySha256,accessPolicySha256,tokenKey:`news-recovery-v1-${current.runId}-${current.runAttempt}-${current.sha}-${approval.sha256}`,cacheKey:currentCacheKey,payloadKey:currentCacheKey};
  plan.planSha256=shaJson(plan); return plan;
}

export function requireSameNewsRecoveryPlan(plan,currentPlan){if(!plan||!currentPlan||shaJson(withoutPlanDigest(plan))!==shaJson(withoutPlanDigest(currentPlan)))fail('preflight_plan_changed');}

/**
 * The exact-run local claim is created with wx and read back before this
 * function is called. Replay is prevented across Actions reruns by attempt=1,
 * and across dispatches by binding the descriptor to predecessor+1 and the
 * unique current run identity.
 */
export async function consumeNewsRecoveryPlan({plan,proof,env,registrySha256,accessPolicySha256,tokenBytes,consumedPath}) {
  if(!verifiedProofs.has(proof))fail('checkpoint_proof_not_verified');
  if(plan?.kind!=='news_preview_one_use_recovery'||proof.anchorIdentity?.runId!==plan.anchor?.runId||proof.anchorIdentity?.sha!==plan.anchor?.sha||proof.payloadSha256!==plan.anchor?.payloadSha256||plan.current?.runId!==env.GITHUB_RUN_ID||plan.current?.runAttempt!==1||plan.current?.sha!==env.GITHUB_SHA||Number(env.GITHUB_RUN_ATTEMPT)!==1||plan.current.runNumber!==Number(plan.predecessor.runNumber)+1||plan.sourceAllowlist?.join(',')!=='global-halifax'||plan.maxCollectionPasses!==1||plan.registrySha256!==registrySha256||plan.accessPolicySha256!==accessPolicySha256) fail('recovery_plan_changed');
  if(!Buffer.isBuffer(tokenBytes)) fail('own_claim_not_verified');
  const token=json(tokenBytes); if(token.kind!=='news_preview_recovery_claim'||token.planSha256!==plan.planSha256||JSON.stringify(token.current)!==JSON.stringify(plan.current)||token.key!==plan.tokenKey) fail('own_claim_identity_mismatch');
  const {planSha256,...body}=plan; if(!digest(planSha256)||shaJson(body)!==planSha256) fail('recovery_plan_digest_mismatch');
  // wx prevents duplicate calls within this job; reruns are denied by attempt=1.
  await writeFile(consumedPath,JSON.stringify({version:1,kind:'news_preview_recovery_consumed',planSha256,current:plan.current,consumedAt:new Date().toISOString()})+'\n',{flag:'wx'});
  return true;
}

export async function writeNewsRecoveryClaim({plan,path}){
  const claim={version:1,kind:'news_preview_recovery_claim',key:plan.tokenKey,planSha256:plan.planSha256,current:plan.current,createdAt:new Date().toISOString()};
  await writeFile(path,JSON.stringify(claim,null,2)+'\n',{flag:'wx'}); return claim;
}

export async function verifyNewsRecoveryClaimFile({plan,path}){
  const claim=json(await readFile(path)); if(claim.kind!=='news_preview_recovery_claim'||claim.key!==plan.tokenKey||claim.planSha256!==plan.planSha256||JSON.stringify(claim.current)!==JSON.stringify(plan.current))fail('claim_file_mismatch'); return true;
}
