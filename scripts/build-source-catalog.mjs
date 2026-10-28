// Offline, allowlisted source inventory. Never fetches sources or infers a successful
// collection from a release timestamp, link verification, or retained content.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { iso, latest, freshness, snapshotValue } from './lib/update-consistency.mjs';
import { sourceRunHealth } from './lib/source-run-health.mjs';
import { validateOnboardingBacklog } from './lib/source-onboarding-backlog.mjs';
const root = new URL('../', import.meta.url);
const rows = value => Array.isArray(value) ? value.filter(x => x && typeof x === 'object' && !Array.isArray(x)) : [];
const label = value => typeof value === 'string' ? value.replace(/[\x00-\x1f]/g, '').slice(0, 200) : null;
export function publicUrl(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (!['region','locations','ical','page'].includes(key)) url.searchParams.delete(key);
    return url.href;
  } catch { return null; }
}
const keyUrl = value => (publicUrl(value) || '').replace(/\/$/, '').toLowerCase();
const blocked = row => row.enabled === false || /held|restricted|blocked|no_access|quarantined|reviewed_exclusion/.test(String(row.state || row.status || row.reviewState || '')) || /robots_disallow|http_40[13]|http_429|api_http_401|missing_credentials|(?:TOKEN|USER_ID).*missing|quarantined/.test(String(row.reason || row.disabledReason || ''));
const failed = row => ['failed','failure','error','broken'].includes(row.status || row.state) || (typeof row.status === 'number' && row.status >= 400) || Boolean(row.error);
// Success requires an explicit collection outcome, never just the absence of
// an error. Registry holds can coexist with historical success, but a blocked,
// anomalous, unknown, or unattempted receipt cannot advance that success clock.
function successfulReceipt(row) {
  if (row.attempted === false || row.error || row.reason) return false;
  const outcomes = [row.status, row.state].filter(value => value !== undefined && value !== null && value !== '');
  return outcomes.length > 0 && outcomes.every(value => typeof value === 'number'
    ? value >= 200 && value < 300
    : ['ok', 'success', 'changed', 'unchanged', 'refreshed'].includes(value));
}
export function buildCatalog(inputs) {
  const policy = inputs['data/update-policy.json'] || {};
  const lanes = new Map(rows(policy.lanes).map(x => [x.id, x]));
  const entries = new Map();
  const holdRows = rows(inputs['data/source-link-access-holds.json']?.observations);
  const holds = new Set(holdRows.map(x => keyUrl(x.url)));
  const holdClocks = new Map();
  for (const row of holdRows) { const key = keyUrl(row.url); holdClocks.set(key, latest([holdClocks.get(key), row.observedAt])); }
  const excluded = new Set();
  for (const [path,key] of [['data/feed-review-overrides.json','feedUrls'],['data/social-profile-review-overrides.json','profileUrls']]) for (const row of rows(inputs[path]?.records)) for (const url of Array.isArray(row[key]) ? row[key] : []) excluded.add(`${row.restaurantId}:${keyUrl(url)}`);
  for (const row of rows(inputs['data/source-quarantine.json']?.records)) {
    const record = row.record || {};
    for (const url of [record.website,record.url,record.resolvedUrl]) if (url) excluded.add(`${record.restaurantId}:${keyUrl(url)}`);
  }
  const placePayload = inputs['data/build/catalog.json'];
  const places = new Map(rows(Array.isArray(placePayload) ? placePayload : placePayload?.restaurants).map(x => [x.id, x]));
  function add(family, record, path, laneId, options = {}) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return;
    const url = publicUrl(record.url || record.sourceUrl || record.website || record.feedUrl || record.profileUrl || record.postUrl || record.homeUrl || record.pageUrl);
    if (!url && !options.allowNoUrl) return;
    const sourceId = label(options.sourceId || record.sourceId || record.restaurantId || record.id || record.platform);
    const identity = options.registry ? `${family}:${sourceId}` : `${family}:${sourceId || ''}:${url || ''}`;
    if (options.registry && !sourceId) return;
    const id = `${family}:${createHash('sha256').update(identity).digest('hex').slice(0, 20)}`;
    const existing = entries.get(id);
    if (existing && options.registry && existing.url !== url) throw new Error(`Conflicting registered source ID: ${family}:${sourceId}`);
    const lane = lanes.get(laneId) || {};
    const place = places.get(record.restaurantId) || {};
    const held = blocked(record) || holds.has(keyUrl(url)) || excluded.has(`${record.restaurantId}:${keyUrl(url)}`) || options.held === true;
    const successful = options.receipt === true && !options.failure && successfulReceipt(record);
    const attemptedAt = record.attempted === false ? null : iso(record.lastAttemptAt || record.checkedAt || (options.receipt ? record.observedAt : null) || record.accessReview?.lastAttemptAt);
    const row = existing || {id, sourceId, family, name: label(record.name || record.sourceName || record.restaurantName || place.name) || sourceId || new URL(url).hostname,
      url, category: label(record.kind || record.sourceKind || record.sourceType || record.source_type || record.platform), geography: label(record.city || place.city || place.neighborhood || record.venueAddress || (Array.isArray(record.geographicScope) ? record.geographicScope.join(', ') : null)),
      enabled: typeof record.enabled === 'boolean' ? record.enabled : options.defaultEnabled ? true : null, held: false, failing: false,
      lastAttemptAt: null, lastSuccessAt: null, contentAt: null,
      targetHours: Number.isFinite(lane.targetHours) && lane.targetHours > 0 ? lane.targetHours : null,
      workflowUrl: /^[a-z0-9-]+\.yml$/.test(lane.workflow || options.workflow || '') ? `https://github.com/JeremyHennessy/HalifaxSourced/actions/workflows/${lane.workflow || options.workflow}` : null,
      reviewUrl: 'https://github.com/JeremyHennessy/HalifaxSourced/pulls', parser: label(record.mode || record.parserMode), provenance: []};
    if (record.enabled === false) row.enabled = false;
    row.held ||= held;
    row.failing ||= options.failure === true || failed(record);
    row.lastAttemptAt = latest([row.lastAttemptAt, attemptedAt, holdClocks.get(keyUrl(url))]);
    row.lastSuccessAt = latest([row.lastSuccessAt, successful ? record.observedAt || record.checkedAt : null, record.lastSuccessAt]);
    const observed = iso(record.observedAt || record.checkedAt);
    const content = latest([record.publishedAt, record.contentChangedAt]);
    // Parsed feed dates can be corrupt or scheduled; they cannot move the
    // observation clock into the future or claim already-published content.
    row.contentAt = latest([row.contentAt, content && (!observed || Date.parse(content) <= Date.parse(observed) + 864e5) ? content : null]);
    if (!row.provenance.includes(path)) row.provenance.push(path);
    entries.set(id, row);
    return row;
  }
  const city = inputs['data/build/city-events.json'] || {};
  for (const path of ['data/event-source-registry.json','data/event-source-supplements.json']) for (const record of rows(inputs[path]?.sources)) {
    add('city-events', record, path, 'city-events', {registry:true, defaultEnabled:true});
    for (const stat of rows(city.sourceStats).filter(s => s.sourceId === record.id)) add('city-events', {...record, ...stat}, 'data/build/city-events.json', 'city-events', {registry:true, defaultEnabled:true, sourceId:record.id, receipt:true});
  }
  for (const [path,family,workflow] of [['data/place-source-registry.json','discovery-directories','restaurant-discovery-preview.yml'],['data/news-source-registry.json','news','news-preview.yml']]) for (const record of rows(inputs[path]?.sources)) add(family,record,path,family === 'news' ? 'regional-news' : null,{registry:true, workflow});
  // A recorded source receipt is evidence, not an active collection schedule.
  const weatherPath = 'data/weather-source-registry.json', weatherSnapshotPath = 'data/build/halifax-weather.json';
  const weatherSnapshot = inputs[weatherSnapshotPath];
  for (const source of rows(inputs[weatherPath]?.sources)) {
    const row = add('weather',source,weatherPath,null,{registry:true,...(source.enabled ? {workflow:'weather-preview.yml'} : {})});
    if (source.id !== 'eccc-halifax-citypage' || !row) continue;
    const accepted = weatherSnapshot?.version === 1 ? weatherSnapshot.lastKnownGood : null;
    if (accepted?.sourceUrl !== source.endpoint) continue;
    row.provenance.push(weatherSnapshotPath);
    row.lastAttemptAt = iso(weatherSnapshot.lastAttempt?.attemptedAt);
    row.lastSuccessAt = iso(accepted.retrievedAt);
    row.contentAt = iso(accepted.forecast?.issuedAt);
    row.failing = !['success',undefined].includes(weatherSnapshot.lastAttempt?.status);
    row.weather = {collection:source.enabled ? (source.refreshPolicy?.scheduleEnabled ? 'Guarded hourly review; publication separately reviewed' : 'Guarded manual review; automatic schedule disabled') : 'Disabled — recorded manual snapshot; no schedule',
      forecastIssuedAt:iso(accepted.forecast?.issuedAt), retrievedAt:iso(accepted.retrievedAt),
      observationTimes:rows(accepted.observations).map(x=>({station:label(x.stationName),observedAt:iso(x.observedAt)})),
      warningCheckedAt:iso(accepted.warnings?.checkedAt), coverage:label(accepted.warnings?.coverage)};
  }
  // This is the importer's exact static input, not an inferred news admission.
  // Opening leads and snapshot generatedAt are not per-feed collection receipts.
  const openingPath = 'data/opening-watch-source-registry.json';
  const openingSnapshotPath = 'data/build/opening-watch-leads.json';
  const openingSnapshot = inputs[openingSnapshotPath] || {};
  for (const source of rows(inputs[openingPath]?.sources)) {
    const record = {...source, kind:source.type};
    const options = {workflow:'restaurant-discovery-preview.yml'};
    add('opening-watch', record, openingPath, null, options);
    if (rows(openingSnapshot.sources).some(row => publicUrl(row.url) === publicUrl(source.url)))
      add('opening-watch', record, openingSnapshotPath, null, options);
    for (const failure of rows(openingSnapshot.failures).filter(row => publicUrl(row.sourceUrl || row.url) === publicUrl(source.url)))
      add('opening-watch', {...record, ...failure, url:source.url}, openingSnapshotPath, null, {...options, receipt:true, failure:true});
  }
  for (const record of rows(inputs['data/event-source-candidates.json']?.candidates)) add('event-candidates',record,'data/event-source-candidates.json',null,{registry:true, held:/review|restricted|blocked|denied/.test(record.status || '')});
  const adapters = [
    ['official-sites','official-site-signals','official-sources',['results'],true],
    ['place-facts','structured-place-facts','restaurant-facts',['records'],true],
    ['specials','structured-specials','specials',['records','orphanSources'],false],
    ['website-feeds','website-feed-signals','official-sources',['posts'],true],
    ['website-pages','website-page-intelligence','official-sources',['records'],true],
    ['verified-pages','verified-source-pages','official-sources',['menuSources','specialSources'],false],
    ['restaurant-events','structured-events','city-events',['events'],false],
    ['social-posts','social-signals','social-sources',['posts'],true],
    ['public-special-directories','public-special-source-leads','specials',['sources'],false],
    ['discovery-directories','directory-restaurant-leads',null,['sources'],false],
    ['patio-directories','patio-directory-facts',null,['sources'],false]
  ];
  for (const [family, stem, lane, keys, receipt] of adapters) {
    const path = `data/build/${stem}.json`, payload = inputs[path] || {};
    if (payload.source && typeof payload.source === 'object') add(family,payload.source,path,lane);
    for (const key of keys) for (const record of rows(payload[key])) add(family, record, path, lane, {receipt, registry:family === 'discovery-directories', workflow: family === 'discovery-directories' ? 'restaurant-discovery-preview.yml' : null});
    for (const record of rows(payload.failures)) {
      const registered = rows(payload.sources).find(s => s.id === record.sourceId);
      add(family, {...registered, ...record}, path, lane, {receipt:true, failure:true, registry:family === 'discovery-directories'});
    }
  }
  const firstPath = 'data/build/first-party-sources.json';
  for (const record of rows(inputs[firstPath]?.records)) {
    add('first-party', record, firstPath, 'official-sources');
    for (const [key,family] of [['socialProfiles','social-profiles'],['feeds','website-feeds'],['linkHubs','link-hubs'],['relatedLinks','related-links'],['sitemaps','sitemaps']]) {
      for (const child of Array.isArray(record[key]) ? record[key] : []) add(family, {...(typeof child === 'string' ? {url:child} : child), restaurantId:record.restaurantId, name:record.name}, firstPath, family === 'social-profiles' ? 'social-sources' : 'official-sources');
    }
  }
  for (const record of rows(inputs[firstPath]?.failures)) add('first-party', record, firstPath, 'official-sources', {failure:true, receipt:true});
  const social = inputs['data/build/social-signals.json'] || {};
  for (const platform of rows(inputs['data/social-platform-registry.json']?.platforms)) {
    const health = sourceRunHealth({...social, failures:rows(social.failures).filter(x => x.platform === platform.id)});
    add('social-platforms', {...platform, name:platform.label, state:health.state}, 'data/social-platform-registry.json', 'social-sources', {registry:true, allowNoUrl:true});
  }
  const inspectionPath = 'data/build/ns-food-inspections.json', inspection = inputs[inspectionPath];
  if (inspection) add('public-registry', {id:'ns-food-inspections', name:inspection.source, sourceUrl:inspection.sourceUrl}, inspectionPath, null, {registry:true});
  // Catalog source references cover discovery, public map, editorial, owner, and
  // other families without claiming that an attached link was collected recently.
  for (const place of rows(Array.isArray(placePayload) ? placePayload : placePayload?.restaurants)) for (const source of rows(place.sources)) add('catalog-references', {...source, restaurantId:place.id, name:place.name, kind:source.type, city:place.neighborhood}, 'data/build/catalog.json', null);
  // Manual onboarding observations are not collection receipts or link-QA
  // provenance. Never merge these holds into existing operational row state.
  const onboardingPath = 'data/source-onboarding-backlog.json';
  if (inputs[onboardingPath]) {
    const backlog = validateOnboardingBacklog(inputs[onboardingPath]);
    for (const candidate of backlog.candidates) {
      const row = add('source-onboarding', {id:candidate.id, name:candidate.name, url:candidate.url, enabled:false,
        kind:candidate.categories.join(', '), city:candidate.geography}, onboardingPath, null, {registry:true, held:true});
      row.lastAttemptAt = null; // Do not inherit a link-QA clock for this URL.
      row.review = {kind:'candidate', status:'disabled_review_required', priority:candidate.priority, rank:candidate.rank,
        interface:candidate.interface, format:{...candidate.format}, distinction:candidate.distinction,
        existingRepresentation:candidate.existingRepresentation, accessLimitations:candidate.accessLimitations,
        rightsLimitations:candidate.rightsLimitations, nextSafeAction:candidate.nextSafeAction,
        evidence:candidate.evidence.map(item => ({url:publicUrl(item.url), observation:item.observation}))};
    }
    for (const hold of backlog.holds) {
      const row = add('source-onboarding', {id:hold.id, name:hold.name, url:hold.url, enabled:false,
        kind:'Manual onboarding hold'}, onboardingPath, null, {registry:true, held:true, allowNoUrl:true});
      row.lastAttemptAt = null;
      row.review = {kind:'hold', status:'mandatory_hold', holdReason:hold.holdReason,
        evidence:[{url:publicUrl(hold.url), observation:hold.evidence}], nextSafeAction:hold.nextSafeAction};
    }
  }
  const sources = [...entries.values()].sort((a,b) => a.id.localeCompare(b.id));
  const snapshotAt = latest(sources.flatMap(row => [row.lastAttemptAt,row.lastSuccessAt]));
  for (const row of sources) {
    row.provenance.sort();
    if (row.contentAt && snapshotAt && Date.parse(row.contentAt) > Date.parse(snapshotAt) + 864e5) row.contentAt = null;
    row.freshness = freshness(row.lastSuccessAt, snapshotAt, row.targetHours);
    row.state = row.held ? 'held' : row.failing ? 'failing' : row.freshness === 'stale' ? 'stale' : row.enabled === true ? 'enabled' : 'unknown';
  }
  const urls = new Set(sources.map(row => row.url).filter(Boolean));
  // Count endpoint hosts, not publishers or registrable domains. Ignore the
  // conventional www alias and DNS trailing dot, while retaining subdomains.
  const hosts = new Set([...urls].map(url => new URL(url).hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '')));
  return {version:1, snapshotAt, scope:'Offline inventory of committed registries, source relationships, and published evidence. Not live operations. Counts total and state totals are catalogue rows, including evidence/relationships; distinctUrls counts sanitized URLs; distinctHosts counts lowercase hostnames without leading www or a trailing DNS dot. Neither distinct count measures publishers. Target cadence is policy, not proof of an active schedule. Unknown clocks remain unknown; contentAt is publication/change time, not event date. Held overrides failure. Link discovery is not successful collection. Source-onboarding rows are disabled review candidates/manual holds, not ingested content or operational source admissions. Freshness is evaluated at the latest recorded evidence clock; the admin view also evaluates age at viewing time.', counts:{total:sources.length, distinctUrls:urls.size, distinctHosts:hosts.size, ...Object.fromEntries(['enabled','held','failing','stale','unknown'].map(state => [state,sources.filter(x => x.state === state).length]))}, sources};
}
export async function buildFromDisk() {
  const paths = ['data/weather-source-registry.json','data/build/halifax-weather.json','data/update-policy.json','data/place-source-registry.json','data/news-source-registry.json','data/opening-watch-source-registry.json','data/source-onboarding-backlog.json','data/event-source-candidates.json','data/feed-review-overrides.json','data/social-profile-review-overrides.json','data/source-quarantine.json','data/event-source-registry.json','data/event-source-supplements.json','data/social-platform-registry.json','data/source-link-access-holds.json', ...['catalog','city-events','opening-watch-leads','first-party-sources','official-site-signals','structured-place-facts','structured-specials','website-feed-signals','website-page-intelligence','verified-source-pages','structured-events','social-signals','public-special-source-leads','directory-restaurant-leads','patio-directory-facts','ns-food-inspections'].map(x => `data/build/${x}.json`)];
  const inputs = {};
  for (const path of paths) {
    try { inputs[path] = JSON.parse(await readFile(new URL(path,root),'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; const fallback = path.replace('data/build/','data/').replace(/\.json$/,'.js'); if (fallback !== path) { try { inputs[path] = snapshotValue(await readFile(new URL(fallback,root),'utf8')); } catch (fallbackError) { if (fallbackError.code !== 'ENOENT') throw fallbackError; } } }
  }
  const output = JSON.stringify(buildCatalog(inputs),null,2)+'\n';
  const target = new URL('data/build/source-catalog.json', root);
  let previous; try { previous = await readFile(target,'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous !== output) { await mkdir(new URL('data/build/',root),{recursive:true}); await writeFile(target,output); }
  console.log(`Source catalogue: ${JSON.parse(output).counts.total} rows; ${previous === output ? 'unchanged' : 'written'}; no network requests.`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await buildFromDisk();
