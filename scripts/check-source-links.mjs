import { fetchGuardedSource as fetch } from './lib/fetch-public-source.mjs';
import { withSourceDeadline } from './lib/fetch-public-source.mjs';
import { classifyLifecycleLanguage, lifecycleText } from './lib/lifecycle-language.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { reviewedLocationLinks } from './lib/reviewed-corrections.mjs';
const load = async (name, fallback) => JSON.parse(await readFile(new URL('../data/build/' + name + '.json', import.meta.url), 'utf8').catch(() => JSON.stringify(fallback)));
const catalog = await load('catalog', {restaurants:[]}), firstParty = await load('first-party-sources', {records:[]}), facts = await load('structured-place-facts', {records:[]}), city = await load('city-events', {events:[]});
const release = process.env.LINK_HEALTH_SCOPE === 'release';
const timeoutMs = Number(process.env.LINK_HEALTH_TIMEOUT_MS || 8000), concurrency = Math.max(1, Math.min(20, Number(process.env.LINK_HEALTH_CONCURRENCY || 10))), limit = Number(process.env.LINK_HEALTH_LIMIT ?? 1500);
const inactive = new Set(['permanently_closed','seasonally_closed', 'seasonally_closed','temporarily_closed','moved','replaced']);
const activeIds = new Set(catalog.restaurants.filter(item => !inactive.has(item.operatingStatus)).map(item => item.id));
const urls = new Map();
function add(value, kind, id) {
  if (release && !activeIds.has(id)) return;
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return;
    if (!urls.has(url.href)) urls.set(url.href, {url:url.href, kinds:new Set(), entities:new Set()});
    urls.get(url.href).kinds.add(kind); if (id) urls.get(url.href).entities.add(id);
  } catch { /* Missing/non-URL fields are not invented as destinations. */ }
}
for (const item of catalog.restaurants) {
  add(item.website, 'official_website', item.id);
  if (!release) for (const source of item.sources || []) add(source.url, `place_source:${source.type || 'source'}`, item.id);
}
for (const link of reviewedLocationLinks(catalog.restaurants)) add(link.url, link.kind, link.restaurantId);
for (const item of firstParty.records || []) {
  for (const source of item.socialProfiles || []) add(source.profileUrl || source.url, `social:${source.platform}`, item.restaurantId);
  for (const source of item.linkHubs || []) add(source.url, `link_hub:${source.platform}`, item.restaurantId);
  for (const source of item.relatedLinks || []) add(source.url, `action:${source.kind}`, item.restaurantId);
}
for (const item of facts.records || []) for (const [field, kind] of [['menus','menu'],['reservations','reservation'],['ordering','ordering']]) for (const source of item[field] || []) add(source.url, kind, item.restaurantId);
if (!release) for (const event of city.events || []) { add(event.ticketUrl, 'event_ticket', event.eventId || event.id); add(event.officialUrl || event.eventUrl || event.sourceUrl, 'event_source', event.eventId || event.id); }
const list = [...urls.values()].slice(0, limit > 0 ? limit : undefined), results = new Array(list.length);
let reusable = new Map();
if (process.env.LINK_HEALTH_REUSE_RECENT === '1') {
  const previous = await load('source-link-health-report', {});
  if (previous.sourceCommitSha === (process.env.SOURCE_COMMIT_SHA || process.env.GITHUB_SHA)) reusable = new Map((previous.results || []).filter(item => Date.now() - Date.parse(item.observedAt) < 3600000).map(item => [item.url, item]));
}
const domainTails = new Map();
let cursor = 0;
async function inspect(item) {
  const prior = reusable.get(item.url);
  if (prior) return {...prior, kinds:[...item.kinds], entityIds:[...item.entities], reusedObservation:true};
  const base = {url:item.url, kinds:[...item.kinds], entityIds:[...item.entities], observedAt:new Date().toISOString()};
  let last;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      last = await withSourceDeadline(async signal => {
        const response = await fetch(item.url, {method:'GET', headers:{'User-Agent':'HalifaxSourced/1.0 (+https://github.com/JeremyHennessy/HalifaxSourced)', Accept:'text/html,application/xhtml+xml,*/*;q=0.2'}, signal});
        const status = response.status;
        const state = response.ok ? 'ok' : [404,410].includes(status) ? 'broken' : [401,403].includes(status) ? 'restricted' : [408,425,429,500,502,503,504].includes(status) ? 'transient' : 'http_error';
        const lifecycle = [];
        if (response.ok && item.kinds.has('official_website') && /html/i.test(response.headers.get('content-type') || '')) {
          const reader = response.body?.getReader(); let bytes = 0, html = ''; const decoder = new TextDecoder();
          if (reader) { while (bytes < 512000) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.length; html += decoder.decode(chunk.value, {stream:true}); } await reader.cancel(); }
          const text = lifecycleText(html);
          const signals = classifyLifecycleLanguage(text);
          for (const [kind, phrases] of Object.entries(signals)) for (const phrase of phrases) { const offset = text.toLowerCase().indexOf(phrase); lifecycle.push({kind, phrase, excerpt:text.slice(Math.max(0,offset-180), offset+400), reviewState:'candidate_requires_location_review'}); }
        } else try { await response.body?.cancel(); } catch {}
        return {...base, status, state, finalUrl:response.url || item.url, attempt, lifecycle};
      }, timeoutMs);
      const state = last.state;
      // Confirm a hard 404/410 once; restrictions, rate limits and timeouts stay inconclusive.
      if (state !== 'broken' || attempt === 2) return {...last, confirmedBroken:state === 'broken' && attempt === 2};
    } catch (error) { return {...base, status:null, state:/quarantined/.test(error.message) ? 'quarantined' : 'transient', error:error.name === 'TimeoutError' ? 'timeout' : error.message, attempt, confirmedBroken:false, lifecycle:[]}; }
  }
  return last;
}
async function worker() {
  while (true) {
    const index = cursor++; if (index >= list.length) return;
    const item = list[index], host = new URL(item.url).hostname;
    const previous = domainTails.get(host) || Promise.resolve();
    const current = previous.then(() => inspect(item));
    domainTails.set(host, current.catch(() => {}));
    results[index] = await current;
  }
}
await Promise.all(Array.from({length:Math.min(concurrency,list.length || 1)}, worker));
const counts = {checked:results.length, ...Object.fromEntries(['ok','broken','restricted','transient','http_error','quarantined'].map(state => [state === 'http_error' ? 'httpError' : state, results.filter(item => item.state === state).length]))};
const payload = {version:2, generatedAt:new Date().toISOString(), sourceCommitSha:process.env.SOURCE_COMMIT_SHA || process.env.GITHUB_SHA || null, scope:release ? 'active_catalog_official_social_menu_actions' : 'all_sources', totalCatalogRecords:catalog.restaurants.length, activeCatalogRecords:activeIds.size, totalUniqueUrls:urls.size, limit, timeoutMs, complete:results.length === urls.size, counts, broken:results.filter(item => item.confirmedBroken), restricted:results.filter(item => item.state === 'restricted'), transient:results.filter(item => item.state === 'transient'), lifecycleCandidates:results.flatMap(item => item.lifecycle.map(candidate => ({...candidate, sourceUrl:item.url, observedAt:item.observedAt, restaurantIds:item.entityIds}))), results};
for (const directory of ['artifacts','data/build']) { await mkdir(new URL('../' + directory, import.meta.url), {recursive:true}); await writeFile(new URL('../' + directory + '/source-link-health-report.json', import.meta.url), JSON.stringify(payload,null,2)+'\n'); }
console.log(JSON.stringify({scope:payload.scope, complete:payload.complete, totalUniqueUrls:urls.size, lifecycleCandidates:payload.lifecycleCandidates.length, ...counts},null,2));
