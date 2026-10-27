import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { fetchGuardedSource, withSourceDeadline } from './lib/fetch-public-source.mjs';
import { createRobotsAllows } from './lib/robots-policy.mjs';
import { sourceAccessState } from './lib/source-access-state.mjs';
import { validateNewsRegistry, parseNewsFeed, NEWS_MAX_BYTES, validNewsDate, canonicalNewsUrl, newsId } from './lib/news-contract.mjs';
const root = new URL('../', import.meta.url);
export async function boundedNewsBody(response) {
  if (Number(response.headers.get('content-length')) > NEWS_MAX_BYTES) throw new Error('news_byte_limit');
  if (!response.body) throw new Error('missing_news_body');
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try {
    while (true) { const {done,value} = await reader.read(); if(done) break; length += value.byteLength; if(length > NEWS_MAX_BYTES) throw new Error('news_byte_limit'); chunks.push(Buffer.from(value)); }
    return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
  } finally { reader.cancel().catch(()=>{}); }
}
const cacheVersion = 2;
const fingerprint = source => createHash('sha256').update(JSON.stringify([source.id,source.feedUrl,source.allowedHosts,source.source_type])).digest('hex');
const validator = value => value === null || (typeof value === 'string' && value.length > 0 && value.length <= 1000 && !/[\u0000-\u001f\u007f]/.test(value));
export function validateNewsCache(previous) {
  const fail = () => { throw new Error('invalid_previous_news_cache_no_requests'); };
  if (previous?.version !== cacheVersion || previous.disposition !== 'nonpublishable_requires_review' || !Array.isArray(previous.candidates) || !Array.isArray(previous.diagnostics) || previous.candidates.length > 2000 || previous.diagnostics.length > 20) fail();
  const ids = new Set();
  for (const d of previous.diagnostics) {
    if (typeof d.sourceHost !== 'string' || !/^[a-z0-9.-]+$/.test(d.sourceHost) || typeof d.sourceId !== 'string' || ids.has(d.sourceId) || !/^[a-f0-9]{64}$/.test(d.configHash) || !['disabled','pending_review','not_modified','failed_preserved','access_held'].includes(d.status) || typeof d.accessHeld !== 'boolean' || !validator(d.etag) || !validator(d.lastModified) || ![d.lastAttemptAt,d.lastSuccessAt,d.retryNotBefore].every(x => x === null || validNewsDate(x))) fail();
    if (d.status === 'access_held' && !d.accessHeld) fail();
    ids.add(d.sourceId);
  }
  for (const row of previous.candidates) {
    if (!ids.has(row.sourceId) || row.reviewStatus !== 'pending' || !validNewsDate(row.observedAt) || !validNewsDate(row.publishedAt) || row.publishedPrecision !== 'instant' || (row.modifiedAt !== null && !validNewsDate(row.modifiedAt)) || typeof row.title !== 'string' || row.title.length > 300 || /[<>\u0000-\u001f]/.test(row.title) || typeof row.sourceGUID !== 'string' || row.sourceGUID.length > 1000 || Object.keys(row).some(k => !['id','canonicalUrl','sourceId','sourceName','sourceGUID','source_type','title','publishedAt','publishedPrecision','modifiedAt','observedAt','reviewStatus'].includes(k))) fail();
    try { if (canonicalNewsUrl(row.canonicalUrl,[new URL(row.canonicalUrl).hostname]) !== row.canonicalUrl || newsId(row.canonicalUrl) !== row.id) fail(); } catch { fail(); }
  }
  return previous;
}
export async function collectNews(registry, {fetchFeed, now = new Date().toISOString(), previous = null}) {
  validateNewsRegistry(registry);
  if (!validNewsDate(now)) throw new Error('invalid_news_collection_clock');
  if (previous !== null) validateNewsCache(previous);
  previous ||= {candidates:[],diagnostics:[]};
  const candidates = [], diagnostics = [];
  const heldHosts = new Set(previous.diagnostics.filter(d => d.accessHeld).map(d => d.sourceHost));
  for (const source of [...registry.sources].sort((a,b) => a.id.localeCompare(b.id))) {
    const old = previous.diagnostics.find(d => d.sourceId === source.id);
    // Source configuration changes invalidate conditional validators, never an
    // access hold. A source ID cannot escape a hold by changing its feed URL.
    const sameConfig = old?.configHash === fingerprint(source);
    const state = {sourceId:source.id,sourceHost:old?.accessHeld ? old.sourceHost : new URL(source.feedUrl || source.homeUrl).hostname,configHash:fingerprint(source),status:'disabled',etag:sameConfig ? old.etag : null,lastModified:sameConfig ? old.lastModified : null,lastAttemptAt:old?.lastAttemptAt || null,lastSuccessAt:sameConfig ? old.lastSuccessAt : null,retryNotBefore:old?.retryNotBefore || null,accessHeld:Boolean(old?.accessHeld || heldHosts.has(new URL(source.feedUrl || source.homeUrl).hostname))};
    const retained = previous.candidates.filter(r => r.sourceId === source.id);
    if (state.accessHeld) { candidates.push(...retained); diagnostics.push({...state,status:'access_held'}); continue; }
    if (!source.enabled) { candidates.push(...retained); diagnostics.push(state); continue; }
    if (state.retryNotBefore && state.retryNotBefore > now) { candidates.push(...retained); diagnostics.push({...state,status:'failed_preserved'}); continue; }
    state.lastAttemptAt = now;
    try {
      const response = await fetchFeed(source,{etag:state.etag,lastModified:state.lastModified});
      const result = typeof response === 'string' ? {status:200,xml:response,etag:null,lastModified:null} : response;
      if (!result || ![200,304].includes(result.status)) throw new Error('invalid_news_transport_result');
      if (result.status === 304) {
        if (!sameConfig || !state.lastSuccessAt || (!state.etag && !state.lastModified)) throw new Error('unexpected_news_304');
        candidates.push(...retained); state.status = 'not_modified';
      } else {
        const incoming = parseNewsFeed(result.xml,source,now);
        for (const row of incoming) {
          const existing = retained.find(r => r.id === row.id);
          if (existing && JSON.stringify({...existing,observedAt:null}) === JSON.stringify({...row,observedAt:null})) row.observedAt = existing.observedAt;
        }
        candidates.push(...incoming); state.status = 'pending_review';
        state.etag = validator(result.etag ?? null) ? result.etag ?? null : null;
        state.lastModified = validator(result.lastModified ?? null) ? result.lastModified ?? null : null;
      }
      state.lastSuccessAt = now; state.retryNotBefore = null;
    } catch(error) {
      candidates.push(...retained);
      state.accessHeld = Boolean(error.accessHeld || error.accessHold || /source_access_hold|robots_disallow|news_http_(401|403|429)/.test(error.message));
      if (state.accessHeld) heldHosts.add(state.sourceHost);
      state.status = state.accessHeld ? 'access_held' : 'failed_preserved';
      state.retryNotBefore = state.accessHeld ? null : new Date(Date.parse(now)+24*3600000).toISOString();
      state.error = String(error.message).replace(/[<>\u0000-\u001f]/g,'').slice(0,160);
    }
    diagnostics.push(state);
  }
  // Preserve retired source holds as tombstones, preventing remove/re-add reset.
  for (const old of previous.diagnostics) if (old.accessHeld && !registry.sources.some(s => s.id === old.sourceId)) diagnostics.push(old);
  candidates.sort((a,b) => a.id.localeCompare(b.id) || a.sourceId.localeCompare(b.sourceId));
  return {version:cacheVersion, disposition:'nonpublishable_requires_review', candidates, diagnostics};
}
export function mayInitializeNewsCache({requested, runNumber, runAttempt, eventName, exists}) {
  return requested === 'true' && runNumber === '1' && runAttempt === '1' && eventName === 'workflow_dispatch' && exists === false;
}
export async function prepareNewsCache({artifact, registry, env = process.env}) {
  validateNewsRegistry(registry);
  let exists = false;
  try { const content = await readFile(artifact,'utf8'); exists = true; validateNewsCache(JSON.parse(content)); }
  catch(error) { if(error.code !== 'ENOENT') throw error; }
  if (env.NEWS_INITIALIZE_REVIEW_CACHE === 'true') {
    if (!mayInitializeNewsCache({requested:env.NEWS_INITIALIZE_REVIEW_CACHE,runNumber:env.GITHUB_RUN_NUMBER,runAttempt:env.GITHUB_RUN_ATTEMPT,eventName:env.GITHUB_EVENT_NAME,exists})) throw new Error('news_cache_initialization_not_authorized');
    await mkdir(new URL('.', artifact),{recursive:true});
    await writeFile(artifact,JSON.stringify({version:cacheVersion,disposition:'nonpublishable_requires_review',candidates:[],diagnostics:[]},null,2)+'\n',{flag:'wx'});
    return;
  }
  if (!exists) throw new Error('news_cache_missing_no_requests');
}
async function main() {
  const registry = JSON.parse(await readFile(new URL('data/news-source-registry.json',root),'utf8'));
  let previous = null;
  const artifact = new URL('artifacts/news-preview.json',root);
  if (process.argv.includes('--prepare-review-cache')) { await prepareNewsCache({artifact,registry}); return; }
  try { previous = JSON.parse(await readFile(artifact,'utf8')); validateNewsCache(previous); }
  catch(e) { throw e; }
  const userAgent = 'HalifaxSourced/1.0 (regional news metadata preview)';
  const robotsAllows = createRobotsAllows({userAgent});
  const result = await collectNews(registry, {previous, fetchFeed: (source, cache) => withSourceDeadline(async signal => {
    const conditional = {};
    if(cache.etag) conditional['If-None-Match'] = cache.etag;
    if(cache.lastModified) conditional['If-Modified-Since'] = cache.lastModified;
    const response = await fetchGuardedSource(source.feedUrl, {signal,headers:{...conditional,'User-Agent':userAgent,Accept:'application/rss+xml, application/atom+xml, application/xml, text/xml'}}, robotsAllows);
    if(response.status === 304) return {status:304};
    if(response.status !== 200) throw new Error(`news_http_${response.status}`);
    const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if(!['application/rss+xml','application/atom+xml','application/xml','text/xml'].includes(type)) throw new Error('invalid_news_media_type');
    return {status:200,xml:await boundedNewsBody(response),etag:response.headers.get('etag'),lastModified:response.headers.get('last-modified')};
  },12000).catch(error => { if(sourceAccessState().access.find(source.feedUrl)) error.accessHeld = true; throw error; })});
  await sourceAccessState().drainDecisions();
  await mkdir(new URL('artifacts/',root),{recursive:true});
  await writeFile(artifact, JSON.stringify(result,null,2)+'\n');
  console.log(`News preview: ${result.candidates.length} nonpublishable candidates; accepted data unchanged.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
