import { mkdir, readFile, writeFile, appendFile, rename, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { validateNewsCache, prepareNewsCache } from './import-regional-news.mjs';
import { environmentIdentity, githubMetadata, resolveNewsLineage, requireSamePlan, requireExactCache, verifyFinalReceipt, finalReceipt, payloadDigest } from './lib/news-run-lineage.mjs';
import { NEWS_RECOVERY_ANCHOR, resolveNewsRecoveryHistory, createNewsRecoveryPlan, verifyNewsRecoveryCheckpoint, requireSameNewsRecoveryPlan, writeNewsRecoveryClaim, verifyNewsRecoveryClaimFile, isVerifiedNewsRecoveryCheckpoint, executeNewsRecoveryPass } from './lib/news-preview-recovery.mjs';
const root = new URL('../',import.meta.url);
const json = async path => JSON.parse(await readFile(path,'utf8'));
const fail = message => { throw new Error(`news_lineage_${message}`); };
export const lineagePaths = base => ({payload:new URL('news-preview.json',base),receipt:new URL('news-preview-final.json',base),predecessorReceipt:new URL('news-preview-predecessor.json',base),plan:new URL('news-preview-lineage-plan.json',base),collected:new URL('news-preview-collected.json',base),preflightFailure:new URL('news-preview-preflight-failure.json',base),recoveryHistory:new URL('news-preview-recovery-history.json',base),recoveryToken:new URL('news-preview-recovery-token.json',base),recoveryConsumed:new URL('news-preview-recovery-consumed.json',base),recoveryZip:new URL('news-preview-anchor.zip',base)});
const absent = async path => { try { await access(path); fail('unexpected_existing_completion_or_bootstrap_file'); } catch(e) { if (e.code !== 'ENOENT') throw e; } };
const validateCollectedPayload = bytes => {
  try { return validateNewsCache(JSON.parse(bytes)); }
  catch { fail('invalid_collected_payload'); } // Never claim transport did not run.
};
const writeJson = (path,value) => writeFile(path,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
function requireCurrent(plan,env) {
  const current = environmentIdentity(env);
  if (plan.events?.current !== env.GITHUB_EVENT_NAME) fail('plan_current_event_mismatch');
  for (const [key,value] of Object.entries(current)) if (plan.current?.[key] !== value) fail('plan_current_identity_mismatch');
}
const allowedMetadataTarget = path => typeof path === 'string' && /^\/repos\/JeremyHennessy\/HalifaxSourced(?:\/actions\/(?:runs\/[1-9][0-9]*|workflows\/[1-9][0-9]*\/runs\?per_page=100&page=1))?$/.test(path) ? path : null;
const diagnosticErrorClasses = new Set(['http_status','wrong_mime','oversized_declared_body','oversized_body','missing_body','malformed_json','timeout','transport_unknown','metadata_validation']);
const errorClassFor = error => {
  if (diagnosticErrorClasses.has(error?.metadataDiagnostic?.errorClass)) return error.metadataDiagnostic.errorClass;
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'timeout';
  if (String(error?.message || '').startsWith('news_lineage_')) return 'metadata_validation';
  return 'transport_unknown';
};
export async function createLineagePlan({env, paths, metadata, now = () => new Date(), anchor=NEWS_RECOVERY_ANCHOR, readPolicy=readCurrentRecoveryPolicy}) {
  if(env.NEWS_RECOVERY_APPROVED==='true'||env.NEWS_RECOVERY_GLOBAL_CALL_APPROVED==='true') return createRecoveryLineagePlan({env,paths,metadata,anchor,readPolicy});
  let attemptedTarget = null;
  const trackedMetadata = async path => {
    attemptedTarget = allowedMetadataTarget(path);
    try { return await (metadata || githubMetadata)(path); }
    catch (error) { if (!error.metadataDiagnostic) error.metadataDiagnostic = {target:attemptedTarget,errorClass:errorClassFor(error)}; throw error; }
  };
  try {
    const plan = await resolveNewsLineage({env,metadata:trackedMetadata});
    await writeJson(paths.plan,plan);
    return plan;
  } catch (error) {
    let identity = null;
    try { identity = environmentIdentity(env); } catch {}
    const detail = error.metadataDiagnostic || {};
    const clock = now();
    const diagnostic = {
      version:1,
      kind:'news_preview_preflight_failure',
      runIdentity:identity,
      phase:'lineage_preflight',
      target:allowedMetadataTarget(detail.target) || attemptedTarget,
      status:Number.isSafeInteger(detail.status) && detail.status >= 100 && detail.status <= 599 ? detail.status : null,
      mime:typeof detail.mime === 'string' && detail.mime.length <= 80 && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(detail.mime) ? detail.mime : null,
      declaredBodyBytes:Number.isSafeInteger(detail.declaredBodyBytes) && detail.declaredBodyBytes >= 0 ? detail.declaredBodyBytes : null,
      errorClass:errorClassFor(error),
      observedAt:(clock instanceof Date ? clock : new Date(clock)).toISOString()
    };
    // Diagnostics are best effort evidence only. A write failure preserves the
    // preflight failure and cannot create a plan or make the run eligible.
    try { await writeJson(paths.preflightFailure,diagnostic); } catch {}
    if (env.GITHUB_STEP_SUMMARY) {
      const lines = [
        '## Regional news review preflight',
        '',
        `**Operational status:** blocked during lineage preflight (${diagnostic.errorClass}).`,
        `**GitHub metadata target:** ${diagnostic.target || 'not reached'}.`,
        '**Published content freshness:** unchanged; this attempt did not collect sources or establish new content freshness.',
        ''
      ].join('\n');
      try { await appendFile(env.GITHUB_STEP_SUMMARY,lines); } catch {}
    }
    throw error;
  }
}
const fileDigest = async path => payloadDigest(await readFile(path));
const readCurrentRecoveryPolicy=async()=>({registry:await json(new URL('data/news-source-registry.json',root)),registrySha256:await fileDigest(new URL('data/news-source-registry.json',root)),accessPolicySha256:await fileDigest(new URL('data/source-link-access-holds.json',root))});
async function currentRecoveryInputs({env,paths,metadata,anchor=NEWS_RECOVERY_ANCHOR,readPolicy=readCurrentRecoveryPolicy}) {
  const evidence=await resolveNewsRecoveryHistory({env,metadata,anchor});
  const {registry,registrySha256,accessPolicySha256}=await readPolicy();
  const plan=createNewsRecoveryPlan({env,evidence,checkpointMode:env.NEWS_RECOVERY_CHECKPOINT_MODE,registry,registrySha256,accessPolicySha256,anchor});
  return {evidence,registry,registrySha256,accessPolicySha256,plan};
}
async function createRecoveryLineagePlan({env,paths,metadata,anchor=NEWS_RECOVERY_ANCHOR,readPolicy=readCurrentRecoveryPolicy}) {
  let target=null;
  const tracked=async path=>{target=path;try{return await (metadata||githubMetadata)(path);}catch(error){if(!error.metadataDiagnostic)error.metadataDiagnostic={target:path,errorClass:'transport_unknown'};throw error;}};
  try{
    const {plan,evidence}=await currentRecoveryInputs({env,paths,metadata:tracked,anchor,readPolicy});
    await writeJson(paths.plan,plan); await writeJson(paths.recoveryHistory,{version:1,kind:'news_preview_recovery_history',anchor,predecessor:evidence.predecessor,gaps:evidence.gaps});
    return {...plan,predecessorCacheKey:anchor.payloadKey,checkpointCacheKey:anchor.payloadKey,recovery:true};
  }catch(error){
    const reason=String(error?.message||'').match(/^news_recovery_([a-z0-9_]+)$/)?.[1]||error?.metadataDiagnostic?.errorClass||'transport_unknown';
    const status=error?.metadataDiagnostic?.status;
    const diagnostic={version:1,kind:'news_preview_recovery_preflight_failure',runId:/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID||'')?env.GITHUB_RUN_ID:null,runNumber:/^[1-9][0-9]*$/.test(env.GITHUB_RUN_NUMBER||'')?Number(env.GITHUB_RUN_NUMBER):null,target:typeof(error?.metadataDiagnostic?.target||target)==='string'&&/^\/repos\/JeremyHennessy\/HalifaxSourced\/actions\//.test(error.metadataDiagnostic?.target||target)?(error.metadataDiagnostic?.target||target):null,status:Number.isSafeInteger(status)&&status>=100&&status<=599?status:null,failureClass:reason,observedAt:new Date().toISOString()};
    try{await writeJson(paths.preflightFailure,diagnostic);}catch{}
    if(env.GITHUB_STEP_SUMMARY)try{await appendFile(env.GITHUB_STEP_SUMMARY,`## Regional news recovery preflight\n\n**Status:** stopped before checkpoint restore or source transport (${reason}).\n**Metadata target:** ${diagnostic.target||'not reached'}.\n**Published content freshness:** unchanged.\n\n`);}catch{}
    throw error;
  }
}
async function verifiedRecoveryCheckpoint({env,paths,evidence,metadata,anchor=NEWS_RECOVERY_ANCHOR}) {
  const mode=env.NEWS_RECOVERY_CHECKPOINT_MODE;
  if(mode==='exact-cache') return verifyNewsRecoveryCheckpoint({mode,anchor,anchorMetadata:evidence.anchor,payloadBytes:await readFile(paths.payload),receiptBytes:await readFile(paths.receipt),cachePayloadHit:env.NEWS_RECOVERY_PAYLOAD_CACHE_HIT,cachePayloadKey:env.NEWS_RECOVERY_PAYLOAD_CACHE_KEY,cacheReceiptHit:env.NEWS_RECOVERY_RECEIPT_CACHE_HIT,cacheReceiptKey:env.NEWS_RECOVERY_RECEIPT_CACHE_KEY});
  const artifactMetadata=await (metadata||githubMetadata)(`/repos/JeremyHennessy/HalifaxSourced/actions/artifacts/${anchor.artifactId}`);
  return verifyNewsRecoveryCheckpoint({mode,anchor,anchorMetadata:evidence.anchor,artifactMetadata,artifactZip:await readFile(paths.recoveryZip)});
}
export async function claimNewsRecovery({env,paths,metadata,createClaim=true,anchor=NEWS_RECOVERY_ANCHOR,readPolicy=readCurrentRecoveryPolicy}) {
  const stored=await json(paths.plan), {plan,evidence,registrySha256,accessPolicySha256}=await currentRecoveryInputs({env,paths,metadata,anchor,readPolicy});
  requireSameNewsRecoveryPlan(stored,plan);
  const proof=await verifiedRecoveryCheckpoint({env,paths,evidence,metadata,anchor});
  if(!isVerifiedNewsRecoveryCheckpoint(proof))fail('checkpoint_proof_missing');
  // Confirm source IDs and collection configuration still match the restored run-5 snapshot.
  const registry=await json(new URL('data/news-source-registry.json',root));
  const expectedIds=registry.sources.map(s=>s.id).sort(),actualIds=proof.payload.diagnostics.map(d=>d.sourceId).sort();
  if(JSON.stringify(expectedIds)!==JSON.stringify(actualIds))fail('checkpoint_registry_ids_mismatch');
  for(const source of registry.sources){const old=proof.payload.diagnostics.find(d=>d.sourceId===source.id);const configHash=payloadDigest(JSON.stringify([source.id,source.feedUrl,source.allowedHosts,source.source_type]));if(old.configHash!==configHash)fail('checkpoint_source_config_mismatch');}
  if(registrySha256!==stored.registrySha256||accessPolicySha256!==stored.accessPolicySha256)fail('recovery_policy_changed');
  if(createClaim&&proof.mode==='exact-artifact'){
    await writeFile(paths.payload,proof.payloadBytes,{flag:'wx'});
    await writeFile(paths.receipt,proof.receiptBytes,{flag:'wx'});
  }
  if(createClaim){await writeNewsRecoveryClaim({plan:stored,path:paths.recoveryToken});await verifyNewsRecoveryClaimFile({plan:stored,path:paths.recoveryToken});}
  else await verifyNewsRecoveryClaimFile({plan:stored,path:paths.recoveryToken});
  return {plan:stored,proof};
}
export async function collectWithRecovery({env,paths,metadata,registry,collect,claimRecovery=claimNewsRecovery,anchor=NEWS_RECOVERY_ANCHOR,readPolicy=readCurrentRecoveryPolicy}) {
  const {plan,proof}=await claimRecovery({env,paths,metadata,createClaim:false,anchor,readPolicy});
  const {registrySha256,accessPolicySha256}=await readPolicy();
  await absent(paths.predecessorReceipt);
  const previous=validateNewsCache(proof.payload);
  const result=await executeNewsRecoveryPass({plan,proof,env,registrySha256,accessPolicySha256,tokenBytes:await readFile(paths.recoveryToken),consumedPath:paths.recoveryConsumed,previous,collect:async()=>{await rename(paths.receipt,paths.predecessorReceipt);await collect();},loadResult:async()=>validateCollectedPayload(await readFile(paths.payload))});
  const bytes=await readFile(paths.payload);
  await writeJson(paths.collected,{version:3,kind:'news_preview_collected',identity:plan.current,payloadSha256:payloadDigest(bytes),transportDecisionsDrained:true});
  return plan;
}
export async function collectWithLineage({env,paths,registry,metadata,collect}) {
  // Recheck official current/predecessor metadata after restore, before even
  // constructing robots/transport objects. A stored plan is not authorization.
  const plan = await resolveNewsLineage({env,metadata});
  requireSamePlan(await json(paths.plan),plan);
  await absent(paths.collected);
  await absent(paths.predecessorReceipt);
  if (plan.predecessor) {
    requireExactCache({hit:env.NEWS_PAYLOAD_CACHE_HIT,matchedKey:env.NEWS_PAYLOAD_CACHE_KEY,expectedKey:plan.predecessorCacheKey});
    requireExactCache({hit:env.NEWS_RECEIPT_CACHE_HIT,matchedKey:env.NEWS_RECEIPT_CACHE_KEY,expectedKey:`${plan.predecessorCacheKey}-final`});
    const payload = await readFile(paths.payload);
    validateNewsCache(JSON.parse(payload));
    verifyFinalReceipt(await json(paths.receipt),plan.predecessor,payload);
    await rename(paths.receipt,paths.predecessorReceipt); // Retain original evidence.
  } else {
    await absent(paths.payload); await absent(paths.receipt);
    await prepareNewsCache({artifact:paths.payload,registry,env});
  }
  const previous = validateNewsCache(await json(paths.payload));
  await collect(); // Production: wait for collector process exit, not a stale file.
  const bytes = await readFile(paths.payload), result = validateCollectedPayload(bytes);
  for (const old of previous.diagnostics.filter(d => d.accessHeld)) {
    const retained = result.diagnostics.find(d => d.sourceId === old.sourceId);
    if (!retained?.accessHeld || retained.sourceHost !== old.sourceHost) fail('lost_access_hold');
  }
  // Never cached/restored. Only this completed current collector creates it.
  await writeJson(paths.collected,{version:3,kind:'news_preview_collected',identity:plan.current,payloadSha256:payloadDigest(bytes),transportDecisionsDrained:true});
  return plan;
}
async function verifyCollection({env,paths}) {
  const plan = await json(paths.plan); requireCurrent(plan,env);
  const bytes = await readFile(paths.payload); validateCollectedPayload(bytes);
  requireSamePlan(await json(paths.collected),{version:3,kind:'news_preview_collected',identity:plan.current,payloadSha256:payloadDigest(bytes),transportDecisionsDrained:true});
  return {plan,bytes};
}
export async function completeLineage({env,paths}) {
  const {plan,bytes} = await verifyCollection({env,paths});
  // Save actions may warn and still exit zero; require an exact cache lookup.
  requireExactCache({hit:env.NEWS_SAVED_CACHE_HIT,matchedKey:env.NEWS_SAVED_CACHE_KEY,expectedKey:plan.cacheKey});
  await writeJson(paths.receipt,finalReceipt(plan.current,bytes));
}
export async function verifyReceiptSaved({env,paths}) {
  const {plan,bytes} = await verifyCollection({env,paths});
  verifyFinalReceipt(await json(paths.receipt),plan.current,bytes);
  requireExactCache({hit:env.NEWS_SAVED_CACHE_HIT,matchedKey:env.NEWS_SAVED_CACHE_KEY,expectedKey:`${plan.cacheKey}-final`});
}
export async function runCollector({spawnImpl = spawn} = {}) {
  await new Promise((resolve,reject) => {
    const child = spawnImpl(process.execPath,['scripts/import-regional-news.mjs'],{cwd:root,stdio:'inherit'});
    child.once('error',reject);
    child.once('exit',(code,signal) => code === 0 && !signal ? resolve() : reject(new Error(`news_collector_not_complete_${signal || code}`)));
  });
}
async function main() {
  const env = process.env, paths = lineagePaths(new URL('artifacts/',root));
  await mkdir(new URL('artifacts/',root),{recursive:true});
  switch (process.argv[2]) {
    case 'plan': {
      const plan = await createLineagePlan({env,paths});
      if (!env.GITHUB_OUTPUT) fail('missing_actions_output');
      await appendFile(env.GITHUB_OUTPUT,`bootstrap=${plan.predecessor === null}\ncache-key=${plan.cacheKey}\npredecessor-cache-key=${plan.predecessorCacheKey || ''}\nrecovery=${Boolean(plan.recovery)}\ncheckpoint-mode=${plan.checkpointMode || ''}\ncheckpoint-cache-key=${plan.checkpointCacheKey || ''}\n`);
      break;
    }
    case 'claim-recovery': await claimNewsRecovery({env,paths}); break;
    case 'collect': {
      const registry=await json(new URL('data/news-source-registry.json',root));
      if(env.NEWS_RECOVERY_APPROVED==='true'||env.NEWS_RECOVERY_GLOBAL_CALL_APPROVED==='true') await collectWithRecovery({env,paths,registry,collect:runCollector});
      else await collectWithLineage({env,paths,registry,collect:runCollector});
      break;
    }
    case 'complete': await completeLineage({env,paths}); break;
    case 'verify-final-save': await verifyReceiptSaved({env,paths}); break;
    default: fail('invalid_command');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
