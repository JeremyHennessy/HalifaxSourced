import { mkdir, readFile, writeFile, appendFile, rename, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { validateNewsCache, prepareNewsCache } from './import-regional-news.mjs';
import { environmentIdentity, resolveNewsLineage, requireSamePlan, requireExactCache, verifyFinalReceipt, finalReceipt, payloadDigest } from './lib/news-run-lineage.mjs';
const root = new URL('../',import.meta.url);
const json = async path => JSON.parse(await readFile(path,'utf8'));
const fail = message => { throw new Error(`news_lineage_${message}`); };
export const lineagePaths = base => ({payload:new URL('news-preview.json',base),receipt:new URL('news-preview-final.json',base),predecessorReceipt:new URL('news-preview-predecessor.json',base),plan:new URL('news-preview-lineage-plan.json',base),collected:new URL('news-preview-collected.json',base)});
const absent = async path => { try { await access(path); fail('unexpected_existing_completion_or_bootstrap_file'); } catch(e) { if (e.code !== 'ENOENT') throw e; } };
const validateCollectedPayload = bytes => {
  try { return validateNewsCache(JSON.parse(bytes)); }
  catch { fail('invalid_collected_payload'); } // Never claim transport did not run.
};
const writeJson = (path,value) => writeFile(path,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
function requireCurrent(plan,env) {
  const current = environmentIdentity(env);
  for (const [key,value] of Object.entries(current)) if (plan.current?.[key] !== value) fail('plan_current_identity_mismatch');
}
export async function createLineagePlan({env, paths, metadata}) {
  const plan = await resolveNewsLineage({env,metadata});
  await writeJson(paths.plan,plan);
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
