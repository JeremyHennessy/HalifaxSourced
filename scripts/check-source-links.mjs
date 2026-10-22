import integrity from '../source-integrity.js';
import { fetchGuardedSource as fetch, withSourceDeadline } from './lib/fetch-public-source.mjs';
import { classifyLifecycleLanguage, lifecycleText } from './lib/lifecycle-language.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { linkHealthUrls } from './lib/link-health-urls.mjs';
import { accessHost, accessStatuses, createAccessHolds, digest, parseRetryAfter, policyObservations, policyPath, validateAccessPolicy } from './lib/link-access-policy.mjs';
import { linkCounts, lifecycleCandidates, lifecycleContentLimit } from './lib/link-health-report.mjs';
import { sourceAccessState } from './lib/source-access-state.mjs';
const load = async (name, fallback) => JSON.parse(await readFile(new URL('../data/build/' + name + '.json', import.meta.url), 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return JSON.stringify(fallback); }));
// Missing/malformed policy fails before any transport. Holds are not a cache and
// apply across commits, runs and cache settings. Never synthesize fresh evidence.
const registry = sourceAccessState(), {policy,access} = registry;
const catalog = await load('catalog', {restaurants:[]}), firstParty = await load('first-party-sources', {records:[]}), facts = await load('structured-place-facts', {records:[]}), city = await load('city-events', {events:[]});
const release = process.env.LINK_HEALTH_SCOPE === 'release';
const collectLifecycle = process.env.GITHUB_EVENT_NAME !== 'pull_request';
const sourceCommitSha = process.env.SOURCE_COMMIT_SHA || process.env.GITHUB_SHA || null;
const timeoutMs = Number(process.env.LINK_HEALTH_TIMEOUT_MS || 8000), concurrency = Math.max(1, Math.min(20, Number(process.env.LINK_HEALTH_CONCURRENCY || 10))), limit = Number(process.env.LINK_HEALTH_LIMIT ?? 1500);
if (![timeoutMs,concurrency,limit].every(Number.isFinite) || timeoutMs <= 0 || limit < 0) throw Error('Invalid link audit bounds');
const universe = linkHealthUrls({catalog, firstParty, facts, city}, release);
const list = universe.urls.slice(0, limit > 0 ? limit : undefined), results = new Array(list.length);
let reusable = new Map(), reusedFrom = null;
if (process.env.LINK_HEALTH_REUSE_RECENT === '1') {
  const previous = await load('source-link-health-report', {});
  if (sourceCommitSha && previous.sourceCommitSha === sourceCommitSha && previous.version === 3 && previous.accessPolicySha256 === digest(policy) && integrity.publicationState(previous.generatedAt,Date.now(),1/24).isRecent) { reusedFrom = {sourceCommitSha, generatedAt:previous.generatedAt, accessPolicySha256:previous.accessPolicySha256, reportSha256:digest(previous)}; reusable = new Map((previous.results || []).filter(item => item.state === 'ok' && item.attempted === true && item.status >= 200 && item.status < 300 && item.receipts?.at(-1)?.observedAt === item.observedAt && item.receipts.at(-1).status === item.status && item.receipts.every(receipt => !access.find(receipt.url)) && integrity.publicationState(item.observedAt, Date.now(), 1 / 24).isRecent).map(item => [item.url, item])); }
}
const domainTails = new Map();
let cursor = 0;
function held(item, hold, attemptedAt = null, receipts = [], holdTarget = item.url) {
  const priorObservation = policyObservations(policy).find(row => row.url === item.url) || null;
  return {...item, assessedAt:new Date().toISOString(), attempted:receipts.length > 0 || attemptedAt !== null, attemptedAt, observedAt:null, status:null, state:'held', finalUrl:null, attempt:receipts.at(-1)?.attempt || 0, confirmedBroken:false, lifecycle:[], priorObservation, accessHold:hold, holdTarget, receipts};
}
async function inspect(item) {
  if (!integrity.safeSource(item.url)) return {...item, assessedAt:new Date().toISOString(), attempted:false, attemptedAt:null, observedAt:null, status:null, state:'quarantined', error:'quarantined_cross_entity_redirect', finalUrl:null, attempt:0, confirmedBroken:false, lifecycle:[], receipts:[]};
  const initialHold = access.find(item.url);
  if (initialHold) return held(item, initialHold);
  const prior = reusable.get(item.url);
  if (prior) return {...prior, ...item, assessedAt:new Date().toISOString(), attempted:false, attemptedAt:null, attempt:0, observationAttemptedAt:prior.attemptedAt, observationAttempt:prior.attempt, lifecycle:[], contentReceipt:undefined, ...(prior.contentReceipt?{priorContentReceipt:prior.contentReceipt}:{}), reusedObservation:true, reusedFrom};
  const receipts = [];
  let attemptedAt = null, blocked = null, blockedTarget = null, last;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      last = await withSourceDeadline(async signal => {
        let finalReceipt;
        const response = await fetch(item.url, {method:'GET', headers:{'User-Agent':'HalifaxSourced/1.0 (+https://github.com/JeremyHennessy/HalifaxSourced)', Accept:'text/html,application/xhtml+xml,*/*;q=0.2'}, signal}, async target => {
          blocked = access.find(target); blockedTarget = target;
          if (blocked) throw Error('link_access_hold');
          return true;
        }, {
          beforeRequest(target) { attemptedAt ||= new Date().toISOString(); },
          afterResponse(target, response, transportReceipt) {
            finalReceipt = {...transportReceipt, attempt};
            if ([301,302,303,307,308].includes(response.status) && response.headers.get('location')) finalReceipt.redirectUrl = new URL(response.headers.get('location'), target).href;
            receipts.push(finalReceipt);
          }
        });
        const status = response.status;
        const state = response.ok ? 'ok' : [404,410].includes(status) ? 'broken' : [401,403].includes(status) ? 'restricted' : [408,425,429,500,502,503,504].includes(status) ? 'transient' : 'http_error';
        const lifecycle = [];
        let contentReceipt;
        const mediaType=(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (collectLifecycle && response.ok && item.kinds.includes('official_website') && ['text/html','application/xhtml+xml'].includes(mediaType)) {
          const reader = response.body?.getReader(); let bytesRead = 0, html = '', termination='eof'; const decoder = new TextDecoder();
          if (reader) {
            while (bytesRead < lifecycleContentLimit) {
              const chunk = await reader.read(); if (chunk.done) break;
              const available=chunk.value.subarray(0,lifecycleContentLimit-bytesRead);
              bytesRead += available.length; html += decoder.decode(available,{stream:true});
              if (bytesRead === lifecycleContentLimit) { termination='byte_limit'; break; }
            }
            html += decoder.decode(); await reader.cancel(); signal.throwIfAborted();
            contentReceipt={version:1,url:finalReceipt.url,status:finalReceipt.status,observedAt:finalReceipt.observedAt,completedAt:new Date().toISOString(),mediaType,maxBytes:lifecycleContentLimit,bytesRead,termination,readCompleted:true,cancelCompleted:true};
            const text = lifecycleText(html), signals = classifyLifecycleLanguage(text);
            for (const [kind, phrases] of Object.entries(signals)) for (const phrase of phrases) { const offset = text.toLowerCase().indexOf(phrase); lifecycle.push({kind, phrase, excerpt:text.slice(Math.max(0,offset-180), offset+400), reviewState:'candidate_requires_location_review'}); }
          }
        } else try { await response.body?.cancel(); } catch {}
        signal.throwIfAborted();
        return {...item, assessedAt:new Date().toISOString(), attempted:true, attemptedAt, observedAt:finalReceipt.observedAt, status, state, finalUrl:finalReceipt.url, attempt, lifecycle, ...(contentReceipt?{contentReceipt}:{}), receipts};
      }, timeoutMs);
      // Only two actual hard responses confirm breakage, never a hold/timeout.
      if (last.state !== 'broken' || attempt === 2) return {...last, confirmedBroken:Boolean(last.state === 'broken' && attempt === 2 && [404,410].includes(receipts.filter(row => row.attempt === 1).at(-1)?.status))};
    } catch (error) {
      if (error.code === 'SOURCE_ACCESS_HOLD') return held(item,error.accessHold,attemptedAt,receipts,error.holdTarget);
      if (blocked) return held(item, blocked, attemptedAt, receipts, blockedTarget);
      return {...item, assessedAt:new Date().toISOString(), attempted:attemptedAt !== null, attemptedAt, observedAt:null, status:null, state:/quarantined/.test(error.message) ? 'quarantined' : 'transient', error:error.name === 'TimeoutError' ? 'timeout' : error.message, finalUrl:null, attempt:attemptedAt ? attempt : 0, confirmedBroken:false, lifecycle:[], receipts};
    }
  }
  return last;
}
async function worker() {
  while (true) {
    const index = cursor++; if (index >= list.length) return;
    const item = list[index], host = accessHost(item.url);
    const previous = domainTails.get(host) || Promise.resolve();
    const current = previous.then(() => inspect(item));
    domainTails.set(host, current.catch(() => {}));
    results[index] = await current;
  }
}
await Promise.all(Array.from({length:Math.min(concurrency,list.length || 1)}, worker));
await registry.drainDecisions();
const counts = linkCounts(results);
const payload = {version:3, lifecycleExtraction:collectLifecycle, generatedAt:new Date().toISOString(), sourceCommitSha, sourceWorkflowRunId:process.env.GITHUB_RUN_ID || null, sourceWorkflowRunAttempt:process.env.GITHUB_RUN_ATTEMPT || null, accessPolicySha256:digest(policy), scope:release ? 'active_catalog_official_social_menu_actions' : 'all_sources', totalCatalogRecords:catalog.restaurants.length, activeCatalogRecords:universe.activeCatalogRecords, totalUniqueUrls:universe.urls.length, limit, timeoutMs, complete:results.length === universe.urls.length, counts, broken:results.filter(item => item.confirmedBroken), restricted:results.filter(item => item.state === 'restricted'), transient:results.filter(item => item.state === 'transient'), held:results.filter(item => item.state === 'held'), lifecycleCandidates:lifecycleCandidates(results, collectLifecycle), pendingAccessHolds:registry.pendingAccessHolds, pendingTransportReviews:registry.pendingTransportReviews, lateRestrictionReceipts:registry.lateRestrictionReceipts, results};
for (const directory of ['artifacts','data/build']) { await mkdir(new URL('../' + directory, import.meta.url), {recursive:true}); await writeFile(new URL('../' + directory + '/source-link-health-report.json', import.meta.url), JSON.stringify(payload,null,2)+'\n'); }
console.log(JSON.stringify({scope:payload.scope, complete:payload.complete, totalUniqueUrls:universe.urls.length, lifecycleCandidates:payload.lifecycleCandidates.length, pendingAccessHolds:payload.pendingAccessHolds.length, diagnosticReport:"artifacts/source-link-health-report.json", ...counts},null,2));
