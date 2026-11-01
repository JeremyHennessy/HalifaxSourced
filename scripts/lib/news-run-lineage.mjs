import { createHash } from 'node:crypto';

export const NEWS_REPOSITORY = 'JeremyHennessy/HalifaxSourced';
export const NEWS_WORKFLOW = '.github/workflows/news-preview.yml';
const fail = reason => { throw new Error(`news_lineage_${reason}`); };
const positive = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 && String(Number(value)) === String(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
export const payloadDigest = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const allowedEvent = event => event === 'workflow_dispatch' || event === 'schedule';

export function environmentIdentity(env) {
  // Scheduled events have no dispatch inputs. Only an absent/empty/false value
  // is admissible for them; they can never opt into bootstrap or reset a cache.
  const validInitialization = env.GITHUB_EVENT_NAME === 'schedule'
    ? [undefined,'','false'].includes(env.NEWS_INITIALIZE_REVIEW_CACHE)
    : ['true','false'].includes(env.NEWS_INITIALIZE_REVIEW_CACHE);
  if (env.GITHUB_REPOSITORY !== NEWS_REPOSITORY || env.GITHUB_SERVER_URL !== 'https://github.com' || env.GITHUB_API_URL !== 'https://api.github.com' || !allowedEvent(env.GITHUB_EVENT_NAME) || env.GITHUB_RUN_ATTEMPT !== '1' || ![env.GITHUB_REPOSITORY_ID,env.GITHUB_RUN_ID,env.GITHUB_RUN_NUMBER].every(positive) || !sha(env.GITHUB_SHA) || !env.GITHUB_REF?.startsWith('refs/heads/') || env.GITHUB_WORKFLOW_REF !== `${NEWS_REPOSITORY}/${NEWS_WORKFLOW}@${env.GITHUB_REF}` || !validInitialization) fail('invalid_current_environment_or_rerun');
  return {repository:NEWS_REPOSITORY,repositoryId:String(env.GITHUB_REPOSITORY_ID),workflowPath:NEWS_WORKFLOW,runId:String(env.GITHUB_RUN_ID),runNumber:Number(env.GITHUB_RUN_NUMBER),runAttempt:1,sha:env.GITHUB_SHA,ref:env.GITHUB_REF};
}

// Public official metadata only. No token, redirect, retry, publisher or robots
// request is possible here. Rate limiting, unavailable API and bad JSON are stops.
export async function githubMetadata(path, {fetchImpl = globalThis.fetch} = {}) {
  const safePath = /^\/repos\/JeremyHennessy\/HalifaxSourced(?:\/actions\/(?:runs\/[1-9][0-9]*|runs\/[1-9][0-9]*\/(?:jobs|artifacts)\?per_page=100&page=(?:[1-9]|1[0-9]|20)|artifacts\/[1-9][0-9]*|workflows\/[1-9][0-9]*\/runs\?per_page=100&page=(?:[1-9]|1[0-9]|20)))?$/.test(path);
  if (!safePath) fail('invalid_metadata_path');
  const diagnostic = {target:path,status:null,mime:null,declaredBodyBytes:null,errorClass:'transport_unknown'};
  const error = errorClass => { const failure = new Error(`news_lineage_${errorClass}`); failure.metadataDiagnostic = {...diagnostic,errorClass}; throw failure; };
  let response;
  try { response = await fetchImpl(`https://api.github.com${path}`,{redirect:'error',signal:AbortSignal.timeout(10000),headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'HalifaxSourced-news-lineage'}}); }
  catch (cause) { error(cause?.name === 'TimeoutError' || cause?.name === 'AbortError' ? 'timeout' : 'transport_unknown'); }
  diagnostic.status = Number.isSafeInteger(response.status) ? response.status : null;
  diagnostic.mime = (response.headers.get('content-type') || '').split(';',1)[0].trim().toLowerCase() || null;
  const declared = response.headers.get('content-length');
  diagnostic.declaredBodyBytes = declared !== null && /^\d+$/.test(declared) && Number.isSafeInteger(Number(declared)) ? Number(declared) : null;
  if (response.status !== 200) error('http_status');
  if (diagnostic.mime !== 'application/json') error('wrong_mime');
  if (diagnostic.declaredBodyBytes !== null && diagnostic.declaredBodyBytes > 2_000_000) error('oversized_declared_body');
  if (!response.body) error('missing_body');
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  try {
    while (true) { let item; try { item = await reader.read(); } catch(cause) { error(cause?.name === 'TimeoutError' || cause?.name === 'AbortError' ? 'timeout' : 'transport_unknown'); } if (item.done) break; size += item.value.byteLength; if (size > 2_000_000) error('oversized_body'); chunks.push(Buffer.from(item.value)); }
    let decoded; try { decoded = new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)); } catch { error('malformed_json'); }
    try { return JSON.parse(decoded); } catch { error('malformed_json'); }
  } finally { await reader.cancel().catch(()=>{}); }
}

function runIdentity(run, base) {
  if (!run || ![run.id,run.workflow_id,run.run_number,run.run_attempt].every(positive) || run.repository?.full_name !== base.repository || String(run.repository?.id) !== base.repositoryId || run.path !== NEWS_WORKFLOW || !sha(run.head_sha) || !allowedEvent(run.event) || (run.run_number === 1 && run.event !== 'workflow_dispatch') || `refs/heads/${run.head_branch}` !== base.ref) fail('invalid_run_metadata');
  // Keep the v3 identity/cache/receipt format compatible with the verified manual
  // bootstrap. Event identity is checked independently against official metadata.
  return {repository:base.repository,repositoryId:base.repositoryId,workflowPath:NEWS_WORKFLOW,workflowId:String(run.workflow_id),runId:String(run.id),runNumber:run.run_number,runAttempt:run.run_attempt,sha:run.head_sha,ref:base.ref};
}
export function cacheKey(identity) {
  return `news-review-v3-${identity.repositoryId}-${identity.workflowId}-${identity.runNumber}-${identity.runId}-${identity.runAttempt}-${identity.sha}`;
}
export async function resolveNewsLineage({env, metadata = githubMetadata}) {
  const expected = environmentIdentity(env);
  const repository = await metadata(`/repos/${NEWS_REPOSITORY}`);
  if (repository?.full_name !== expected.repository || String(repository.id) !== expected.repositoryId || repository.private !== false || `refs/heads/${repository.default_branch}` !== expected.ref) fail('not_public_default_branch');
  const currentRun = await metadata(`/repos/${NEWS_REPOSITORY}/actions/runs/${expected.runId}`);
  const current = runIdentity(currentRun,expected);
  if (currentRun.event !== env.GITHUB_EVENT_NAME) fail('current_event_mismatch');
  for (const [key,value] of Object.entries(expected)) if (current[key] !== value) fail('current_identity_mismatch');
  if (currentRun.status !== 'in_progress' || currentRun.conclusion !== null) fail('current_not_running');
  if (current.runNumber === 1) {
    if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.NEWS_INITIALIZE_REVIEW_CACHE !== 'true') fail('explicit_first_run_bootstrap_required');
    return {version:3,current,predecessor:null,cacheKey:cacheKey(current),predecessorCacheKey:null,events:{current:currentRun.event,predecessor:null}};
  }
  if (env.NEWS_INITIALIZE_REVIEW_CACHE === 'true') fail('bootstrap_is_not_recovery');
  // Do not filter by branch/status/event: failed, skipped and cancelled runs must
  // remain visible. A bounded listing that cannot locate N-1 fails closed.
  const list = await metadata(`/repos/${NEWS_REPOSITORY}/actions/workflows/${current.workflowId}/runs?per_page=100&page=1`);
  if (!Array.isArray(list?.workflow_runs) || !Number.isSafeInteger(list.total_count) || list.total_count < list.workflow_runs.length || list.workflow_runs.length > 100 || list.workflow_runs.some(r => !positive(r?.id) || !positive(r?.run_number))) fail('invalid_run_listing');
  const matches = list.workflow_runs.filter(r => r.run_number === current.runNumber - 1);
  if (matches.length !== 1) fail('missing_or_ambiguous_sequential_predecessor');
  const listed = runIdentity(matches[0],expected);
  const predecessorRun = await metadata(`/repos/${NEWS_REPOSITORY}/actions/runs/${listed.runId}`);
  const predecessor = runIdentity(predecessorRun,expected);
  if (!same(predecessor,listed) || predecessorRun.event !== matches[0].event || predecessor.workflowId !== current.workflowId || predecessor.runNumber !== current.runNumber-1 || predecessor.runId === current.runId || predecessor.runAttempt !== 1 || predecessorRun.status !== 'completed' || predecessorRun.conclusion !== 'success' || matches[0].status !== 'completed' || matches[0].conclusion !== 'success') fail('predecessor_not_exact_success_attempt_one');
  return {version:3,current,predecessor,cacheKey:cacheKey(current),predecessorCacheKey:cacheKey(predecessor),events:{current:currentRun.event,predecessor:predecessorRun.event}};
}
export function requireExactCache({hit,matchedKey,expectedKey}) {
  if (hit !== 'true' || matchedKey !== expectedKey) fail('exact_cache_missing');
}
export function verifyFinalReceipt(receipt, identity, bytes) {
  const expected = {version:3,kind:'news_preview_final',identity,cacheKey:cacheKey(identity),payloadSha256:payloadDigest(bytes),transportDecisionsDrained:true,payloadCacheVerified:true};
  if (!same(receipt,expected)) fail('invalid_final_receipt_or_payload_digest');
  return receipt;
}
export function finalReceipt(identity, bytes) {
  return {version:3,kind:'news_preview_final',identity,cacheKey:cacheKey(identity),payloadSha256:payloadDigest(bytes),transportDecisionsDrained:true,payloadCacheVerified:true};
}
export function requireSamePlan(a,b) { if (!same(a,b)) fail('plan_changed'); }
