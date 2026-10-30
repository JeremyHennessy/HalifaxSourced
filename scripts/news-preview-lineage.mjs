import { mkdir, readFile, writeFile, appendFile, rename, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { validateNewsCache, prepareNewsCache } from './import-regional-news.mjs';
import { environmentIdentity, githubMetadata, resolveNewsLineage, requireSamePlan, requireExactCache, verifyFinalReceipt, finalReceipt, payloadDigest } from './lib/news-run-lineage.mjs';
const root = new URL('../',import.meta.url);
const json = async path => JSON.parse(await readFile(path,'utf8'));
const fail = message => { throw new Error(`news_lineage_${message}`); };
export const lineagePaths = base => ({payload:new URL('news-preview.json',base),receipt:new URL('news-preview-final.json',base),predecessorReceipt:new URL('news-preview-predecessor.json',base),plan:new URL('news-preview-lineage-plan.json',base),collected:new URL('news-preview-collected.json',base),preflightFailure:new URL('news-preview-preflight-failure.json',base)});
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
export async function createLineagePlan({env, paths, metadata, now = () => new Date()}) {
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
      await appendFile(env.GITHUB_OUTPUT,`bootstrap=${plan.predecessor === null}\ncache-key=${plan.cacheKey}\npredecessor-cache-key=${plan.predecessorCacheKey || ''}\n`);
      break;
    }
    case 'collect': await collectWithLineage({env,paths,registry:await json(new URL('data/news-source-registry.json',root)),collect:runCollector}); break;
    case 'complete': await completeLineage({env,paths}); break;
    case 'verify-final-save': await verifyReceiptSaved({env,paths}); break;
    default: fail('invalid_command');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
