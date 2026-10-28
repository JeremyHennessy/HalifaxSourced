import assert from 'node:assert/strict';
import {copyFile,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
const root=await mkdtemp(join(tmpdir(),'halifax-event-refresh-'));
try {
  await mkdir(join(root,'scripts','lib'),{recursive:true});await mkdir(join(root,'data','build'),{recursive:true});
  await mkdir(join(root,'data','quarantine'),{recursive:true});
  for(const file of ['scripts/sanitize-city-events.mjs','scripts/resolve-city-event-entities.mjs','scripts/lib/canonical-event-dedupe.mjs','scripts/lib/reviewed-event-quarantine.mjs','data/quarantine/library-store-navigation-20261027.json','data/quarantine/city-event-lifecycle-20261028.json','scripts/lib/reviewed-event-locations.mjs','data/reviewed-event-locations.json'])await copyFile(new URL('../'+file,import.meta.url),join(root,file));
  const venue={venueId:'scotiabank-centre-halifax',name:'Scotiabank Centre',address:'1800 Argyle Street, Halifax',city:'Halifax',sourceIds:['team','venue']};
  await writeFile(join(root,'data','venue-registry.json'),JSON.stringify({venues:[venue]}));
  await writeFile(join(root,'data','organizer-registry.json'),JSON.stringify({organizers:[]}));
  await writeFile(join(root,'data','build','catalog.json'),JSON.stringify({restaurants:[]}));
  await writeFile(join(root,'data','event-source-registry.json'),JSON.stringify({sources:['team','venue'].map(id=>({id,kind:'official_sports_schedule',venueName:venue.name,venueAddress:venue.address}))}));
  // A retained resolved team event and a newly fetched unresolved venue event.
  const game={id:'retained',sourceId:'team',title:'Halifax Mooseheads vs Rouyn-Noranda',startAt:'2026-10-08T22:00:00.000Z',venueId:venue.venueId,venueName:venue.name,city:'Halifax',eventUrl:'https://team.example/game'};
  const fresh={...game,id:'fresh',sourceId:'venue',venueId:undefined,title:'Halifax Mooseheads vs Rouyn-Noranda Huskies',eventUrl:'https://venue.example/game'};
  const records=[game,fresh,{...game,id:'other-opponent',title:'Halifax Mooseheads vs Drummondville'},{...game,id:'later-game',startAt:'2026-10-08T23:00:00.000Z'}];
  await writeFile(join(root,'data','build','city-events.json'),JSON.stringify({events:records}));
  const run=script=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(root,'scripts',script)],{cwd:root,stdio:['ignore','pipe','pipe']});let error='';child.stderr.on('data',chunk=>error+=chunk);child.stdout.resume();child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(`${script}: ${error}`)));});
  await run('sanitize-city-events.mjs');await run('resolve-city-event-entities.mjs');
  const output=JSON.parse(await readFile(join(root,'data','build','city-events.json'),'utf8'));
  assert.equal(output.events.length,3,'Refresh must merge resolved/unresolved representations before venue resolution.');
  const retained=output.events.find(event=>event.id==='retained');
  assert.deepEqual(retained.sourceUrls.sort(),['https://team.example/game','https://venue.example/game']);
  assert.equal(retained.venueId,venue.venueId);
  assert(output.events.some(event=>event.id==='other-opponent'));assert(output.events.some(event=>event.id==='later-game'));
  await run('sanitize-city-events.mjs');await run('resolve-city-event-entities.mjs');
  assert.equal(JSON.parse(await readFile(join(root,'data','build','city-events.json'),'utf8')).events.length,3);
  console.log('Refresh pipeline passed: resolved/unresolved venue aliases merge; provenance and distinct same-day games survive.');
} finally {await rm(root,{recursive:true,force:true});}

// These known historical/candidate identities reproduce an offline code hazard;
// this fixture does not claim that both rows were collected in any one run.
const vm = await import('node:vm');
const { canonicalEventKey, dedupeCanonicalEvents, preservePublishedEventIds, assertUniqueEventIds } = await import('./lib/canonical-event-dedupe.mjs');
const { buildCatalog } = await import('./build-source-catalog.mjs');
const { reconcileFutureEventLosses } = await import('./lib/event-refresh-safety.mjs');
const importer = await readFile(new URL('./import-supplemental-city-events.mjs', import.meta.url), 'utf8');
const helpers = vm.createContext({ canonicalEventKey, dedupeCanonicalEvents });
vm.runInContext(importer.slice(importer.indexOf('function collectedEventKey('), importer.indexOf('const supplemental = [];')), helpers);
const matinee = {
  id: 'halifax-public-libraries-b10cb2ddf0640ec7', title: 'Movie: The Odyssey',
  sourceId: 'halifax-public-libraries', sourceKind: 'public_library_calendar',
  venueName: 'Woodlawn Public Library', city: 'Dartmouth',
  eventUrl: 'https://halifax.bibliocommons.com/v2/events/6acfb380de300e00451a65b7',
  sourceUrl: 'https://halifax.bibliocommons.com/v2/events',
  startAt: '2026-11-25T17:30:00.000Z', endAt: '2026-11-25T20:30:00.000Z',
  observedAt: '2026-10-24T11:11:59.343Z', duplicateEventIds: ['older-matinee-alias']
};
const evening = {
  ...matinee, id: 'halifax-public-libraries-9b88dcd85932e41d', duplicateEventIds: [],
  eventUrl: 'https://halifax.bibliocommons.com/v2/events/6acfb35efee2d21deb233665',
  startAt: '2026-11-25T21:30:00.000Z', endAt: '2026-11-26T00:30:00.000Z'
};
const routeAlias = { ...matinee, id: 'route-alias', sourceId: 'location-calendar',
  sourceKind: 'official_library_location_calendar', address: '31 Eisener Boulevard, Dartmouth',
  eventUrl: matinee.eventUrl.replace('/v2/', '/') };
const otherDetail = { ...matinee, id: 'same-time-other-detail', duplicateEventIds: [], eventUrl: evening.eventUrl };
const laterOnSharedUrl = { ...matinee, id: 'later-shared-detail', duplicateEventIds: [], startAt: evening.startAt, endAt: evening.endAt };
function permutations(items) {
  return items.length ? items.flatMap((item, index) => permutations(items.filter((_, other) => other !== index)).map(tail => [item, ...tail])) : [[]];
}
const records = [matinee, evening, routeAlias, otherDetail, laterOnSharedUrl];
const beforeRecords = structuredClone(records);
for (const permutation of permutations(records)) {
  const result = helpers.dedupe([...permutation, structuredClone(permutation[0])]);
  assert.equal(result.length, 4, 'Exact occurrences, not title/day/venue, define duplicates in all 120 orders');
  assert.equal(new Set(result.map(canonicalEventKey)).size, 4);
  const restored = preservePublishedEventIds(result, [matinee, evening]);
  assert(restored.some(event => event.id === matinee.id));
  assert(restored.some(event => event.id === evening.id));
  const keptMatinee = restored.find(event => event.id === matinee.id);
  assert.equal(keptMatinee.sourceId, routeAlias.sourceId, 'Official source ownership survives all source orders');
  assert.equal(keptMatinee.address, routeAlias.address, 'Official location metadata is not replaced by a summary');
  assert(keptMatinee.duplicateEventIds.includes('route-alias'));
  assert(keptMatinee.duplicateEventIds.includes('older-matinee-alias'));
  assert(!keptMatinee.duplicateEventIds.includes(matinee.id), 'Repeated pages cannot make an ID its own alias');
  assert(keptMatinee.sourceUrls.includes(routeAlias.eventUrl));
  assert(keptMatinee.sourceUrls.includes(matinee.eventUrl));
  assertUniqueEventIds(restored);
  assert.deepEqual(dedupeCanonicalEvents(restored), restored, 'Downstream canonical sanitation is idempotent');
  assert.equal(reconcileFutureEventLosses({ events: restored, sourceStats: [] }, { events: [matinee, evening] },
    { now: Date.parse('2026-10-27T22:00:00Z') }).blocked, false);
}
assert.deepEqual(records, beforeRecords, 'Dedupe never edits accepted input evidence');
assert.throws(() => assertUniqueEventIds(helpers.dedupe([matinee, { ...otherDetail, id: matinee.id }])),
  /Conflicting event identity/, 'Different library detail URLs with the same legacy ID remain held, not silently merged or renamed');
const generic = { ...matinee, id: 'noncanonical', sourceKind: 'official_venue_calendar', sourceId: 'venue',
  eventUrl: 'https://venue.example/events/show', duplicateEventIds: [] };
assert.equal(helpers.dedupe([generic, { ...generic }]).length, 1, 'Other adapters still collapse exact repeated rows');
for (const distinct of [
  { ...generic, id: 'another-id' },
  { ...generic, startAt: evening.startAt },
  { ...generic, eventUrl: 'https://venue.example/events/other' },
  { ...generic, sourceId: 'another-source' }
]) assert.equal(helpers.dedupe([generic, distinct]).length, 2, 'No inferred cross-source or same-day identity');
assert.throws(() => assertUniqueEventIds(helpers.dedupe([generic, { ...generic, eventUrl: 'https://venue.example/events/other' }])),
  /Conflicting event identity/, 'A legacy ID collision stays held rather than silently discarding or renaming an occurrence');
assert.equal(reconcileFutureEventLosses({ events: [evening], sourceStats: [{ sourceId: matinee.sourceId, status: 'ok' }] },
  { events: [matinee, evening] }, { now: Date.parse('2026-10-27T22:00:00Z') }).blocked, true,
  'A genuine missing matinee remains held; this fix never invents a recovered event');
console.log('Supplemental occurrence dedupe passed: 120 orders, same-day times/detail IDs, repeated pages, durable aliases, downstream identity and strict omission holds.');

// Exercise both actual addition entrypoints: collection receipts stay byte-for-
// byte equivalent, while curated evidence is accounted for separately.
const additionsSource = await readFile(new URL('../data/city-event-additions.js', import.meta.url), 'utf8');
const runtimeApply = additionsSource.slice(additionsSource.indexOf('(function applyCityEventAdditions()'));
const sourceIds = ['bedford-library-events', 'the-carleton', 'failed', 'held', 'zero', 'curated-only'];
const additions = { generatedAt: '2026-10-27T22:00:00Z',
  sources: sourceIds.map(sourceId => ({ sourceId, sourceName: sourceId, sourceUrl: `https://example.org/${sourceId}`, authority: 'official_primary' })),
  events: sourceIds.flatMap(sourceId => Array.from({ length: sourceId === 'the-carleton' ? 3 : 1 }, (_, index) => ({
    id: `${sourceId}-${index}`, title: `Reviewed event ${sourceId}-${index}`,
    startAt: `2026-11-${String(index + 1).padStart(2, '0')}T17:00:00Z`, endAt: `2026-11-${String(index + 1).padStart(2, '0')}T18:00:00Z`,
    city: 'Halifax', venueName: 'Fixture venue', categories: ['Arts'], alternateSources: [], supersedesEventIds: [],
    sourceId, sourceName: sourceId, sourceKind: 'official_venue_calendar',
    sourceUrl: `https://example.org/${sourceId}`, eventUrl: `https://example.org/${sourceId}/${index}`,
    observedAt: index ? '2026-10-24T12:00:00Z' : '2026-10-23T05:16:48.006Z',
    sourceEvidence: [{ sourceId, sourceName: sourceId, sourceUrl: `https://example.org/${sourceId}/${index}`, basis: 'official_primary' }]
  }))) };
const stats = [
  { sourceId: sourceIds[0], status: 'ok', eventCount: 89, observedAt: '2026-10-27T22:22:15.630Z', durationMs: 435,
    lastAttemptAt: '2026-10-27T22:21:00Z', lastSuccessAt: '2026-10-27T22:22:15.630Z', lastFailureAt: '2026-10-20T12:00:00Z', receipt: { untouched: true } },
  { sourceId: sourceIds[1], status: 'ok', eventCount: 10, observedAt: '2026-10-27T22:22:00Z' },
  { sourceId: 'failed', status: 'failed', attempted: true, eventCount: 0, reason: 'http_503', observedAt: '2026-10-27T22:21:00Z', lastSuccessAt: '2026-10-20T12:00:00Z' },
  { sourceId: 'held', status: 'blocked', attempted: false, eventCount: 2, reason: 'robots_disallow', lastAttemptAt: '2026-10-20T12:00:00Z', resumeWhen: 'Explicit review only' },
  { sourceId: 'zero', status: 'ok', eventCount: 0, observedAt: '2026-10-27T22:22:00Z' }
];
const original = { generatedAt: '2026-10-27T22:22:16Z', sourceStats: stats,
  failures: [{ sourceId: 'failed', reason: 'http_503', observedAt: '2026-10-27T22:21:00Z' }],
  supplementalAudit: { sourceStats: structuredClone(stats) },
  events: [{ ...additions.events[0], observedAt: '2026-10-27T22:22:15.630Z', price: '$5' }] };
function browserApply(payload) {
  const context = vm.createContext({ window: { HALIFAX_CITY_EVENTS: structuredClone(payload), HALIFAX_CITY_EVENT_ADDITIONS: structuredClone(additions) } });
  vm.runInContext(runtimeApply, context);
  return JSON.parse(JSON.stringify(context.window.HALIFAX_CITY_EVENTS));
}
function catalog(payload) {
  return buildCatalog({
    'data/event-source-registry.json': { sources: additions.sources.map(source => ({ id: source.sourceId, name: source.sourceName, url: source.sourceUrl })) },
    'data/build/city-events.json': payload
  });
}
function verifyAccounting(result, input) {
  for (const field of ['sourceStats', 'failures', 'supplementalAudit', 'generatedAt']) {
    assert.deepEqual(result[field], input[field], `${field} remains untouched by curated additions`);
  }
  assert.deepEqual(catalog(result), catalog(input), 'Catalogue receipt/attempt/success/failure/held state cannot change from curated evidence');
  assert.equal(result.events.length, additions.events.length);
  assert.deepEqual(result.events.find(event => event.id === original.events[0].id).observedAt, original.events[0].observedAt);
  assert.equal(result.events.find(event => event.id === original.events[0].id).price, '$5');
  for (const contribution of result.manualAdditions.sourceContributions) {
    const expected = additions.events.filter(event => event.sourceId === contribution.sourceId);
    assert.deepEqual(contribution.eventIds, expected.map(event => event.id));
    assert.equal(contribution.curatedEventCount, expected.length);
    assert.deepEqual(contribution.evidenceObservedAt, [...new Set(expected.map(event => event.observedAt))]);
    for (const field of ['status', 'observedAt', 'lastAttemptAt', 'lastSuccessAt', 'lastFailureAt', 'durationMs']) assert(!Object.hasOwn(contribution, field));
  }
  assert(!result.sourceStats?.some(stat => stat.sourceId === 'curated-only'), 'No fabricated collection receipt for curated-only sources');
}
const accountingRoot = await mkdtemp(join(tmpdir(), 'halifax-event-accounting-'));
try {
  await mkdir(join(accountingRoot, 'scripts'), { recursive: true });
  await mkdir(join(accountingRoot, 'data/build'), { recursive: true });
  await copyFile(new URL('./apply-city-event-additions.mjs', import.meta.url), join(accountingRoot, 'scripts/apply-city-event-additions.mjs'));
  await writeFile(join(accountingRoot, 'data/build/city-event-additions.json'), JSON.stringify(additions));
  const { spawnSync } = await import('node:child_process');
  async function buildApply(payload) {
    await writeFile(join(accountingRoot, 'data/build/city-events.json'), JSON.stringify(payload));
    const run = spawnSync(process.execPath, [join(accountingRoot, 'scripts/apply-city-event-additions.mjs')], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    return JSON.parse(await readFile(join(accountingRoot, 'data/build/city-events.json'), 'utf8'));
  }
  for (const input of [original, { ...original, sourceStats: [] }, (() => { const copy = structuredClone(original); delete copy.sourceStats; return copy; })()]) {
    const before = structuredClone(input);
    const built = await buildApply(input);
    const runtime = browserApply(input);
    verifyAccounting(built, input); verifyAccounting(runtime, input);
    assert.deepEqual(built.events, runtime.events, 'Build/browser content and IDs agree');
    assert.deepEqual(built.manualAdditions.sourceContributions, runtime.manualAdditions.sourceContributions);
    const repeatedBuild = await buildApply(built), repeatedRuntime = browserApply(runtime);
    verifyAccounting(repeatedBuild, input); verifyAccounting(repeatedRuntime, input);
    assert.deepEqual(repeatedBuild.events, built.events);
    assert.deepEqual(repeatedRuntime.events, runtime.events);
    assert.deepEqual(repeatedBuild.manualAdditions.sourceContributions, built.manualAdditions.sourceContributions);
    assert.deepEqual(input, before, 'Source input fixtures are immutable');
  }
} finally { await rm(accountingRoot, { recursive: true, force: true }); }
console.log('Curated accounting passed: build/browser parity, Bedford 89 vs 1 and Carleton 10 vs 3, failure/hold/zero receipts, absent receipts, catalogue clocks and repeated application.');

// Real supplemental CLI, fixture transport only: both daily performances are
// emitted by the parser, repeated pages remain duplicates, and detail-seeded
// IDs remain deterministic across refreshes.
const importRoot = await mkdtemp(join(tmpdir(), 'halifax-supplemental-occurrences-'));
try {
  await mkdir(join(importRoot, 'scripts/lib'), { recursive: true });
  await mkdir(join(importRoot, 'data/build'), { recursive: true });
  for (const file of ['scripts/import-supplemental-city-events.mjs', 'scripts/lib/canonical-event-dedupe.mjs']) {
    await copyFile(new URL('../' + file, import.meta.url), join(importRoot, file));
  }
  const html = '<p>1 to 20 of 40 items</p>' + [
    [matinee, '1:30pm – 4:30pm'], [evening, '5:30pm – 8:30pm']
  ].map(([event, time]) => `<li class="cp-events-search-result"><h3><a href="${event.eventUrl}">Movie: The Odyssey</a></h3><p>on November 25, 2026, ${time}</p><div>Woodlawn Public Library</div></li>`).join('');
  await writeFile(join(importRoot, 'scripts/lib/fetch-public-source.mjs'), `
    export async function fetchGuardedSource(url) {
      if (![${JSON.stringify(matinee.sourceUrl + '?page=1')}, ${JSON.stringify(matinee.sourceUrl + '?page=2')}].includes(url)) throw Error('Unexpected fixture request');
      return new Response(${JSON.stringify(html)}, { headers: { 'content-type': 'text/html' } });
    }
  `);
  await writeFile(join(importRoot, 'data/event-source-supplements.json'), JSON.stringify({ sources: [{
    id: matinee.sourceId, name: 'Halifax Public Libraries', kind: matinee.sourceKind,
    mode: 'bibliocommons_events', url: matinee.sourceUrl, allowedLocations: { 'Woodlawn Public Library': 'Dartmouth' }
  }] }));
  await writeFile(join(importRoot, 'data/build/city-events.json'), JSON.stringify({ events: [], range: { start: '2026-11-01', end: '2026-12-01' } }));
  const { spawnSync } = await import('node:child_process');
  let generatedIds;
  for (let attempt = 0; attempt < 2; attempt++) {
    const run = spawnSync(process.execPath, [join(importRoot, 'scripts/import-supplemental-city-events.mjs')], {
      encoding: 'utf8', env: { ...process.env, LIBRARY_EVENT_DELAY_MS: '0' }
    });
    assert.equal(run.status, 0, run.stderr);
    const output = JSON.parse(await readFile(join(importRoot, 'data/build/city-events.json'), 'utf8'));
    const ids = output.events.map(event => event.id);
    assert.equal(new Set(ids).size, 2, 'Distinct library detail records receive distinct IDs');
    assert.notDeepEqual(ids, [matinee.id, evening.id], 'New library IDs include the official detail identity');
    if (generatedIds) assert.deepEqual(ids, generatedIds, 'Library detail IDs are deterministic across refreshes');
    generatedIds = ids;
    assert.deepEqual(output.events.map(event => event.eventUrl), [matinee.eventUrl, evening.eventUrl]);
    assert.equal(output.sourceStats[0].eventCount, 4, 'Collector yield still counts emitted rows before dedupe');
    assert.equal(output.supplementalAudit.addedBeforeDedupe, 4);
    assert(output.events.every(event => !event.duplicateEventIds.includes(event.id)));
    assertUniqueEventIds(output.events);
  }
  // A successful regional source may completely overlap the HPL summary. Its
  // official owner/metadata must survive so the unchanged regional gate passes.
  for (const file of ['scripts/check-city-events.mjs', 'scripts/lib/reviewed-event-locations.mjs']) {
    await copyFile(new URL('../' + file, import.meta.url), join(importRoot, file));
  }
  await writeFile(join(importRoot, 'data/reviewed-event-locations.json'), JSON.stringify({ corrections: [] }));
  const publicRow = { ...matinee, sourceName: 'Halifax Public Libraries', categories: ['Arts'] };
  const officialRow = { ...publicRow, ...routeAlias, sourceId: 'woodlawn-library-events', sourceName: 'Woodlawn Library',
    latitude: 44.667, longitude: -63.524 };
  const overlapping = { events: helpers.dedupe([publicRow, officialRow]), sourceStats: [
    { sourceId: matinee.sourceId, status: 'ok', eventCount: 1 },
    { sourceId: officialRow.sourceId, status: 'ok', eventCount: 1 }
  ] };
  assert.equal(overlapping.events[0].sourceId, officialRow.sourceId);
  assert.equal(overlapping.events[0].address, officialRow.address);
  assert(overlapping.events[0].duplicateEventIds.includes(matinee.id));
  await writeFile(join(importRoot, 'data/city-events.js'), `window.HALIFAX_CITY_EVENTS = ${JSON.stringify(overlapping)};`);
  const regionalCheck = spawnSync(process.execPath, [join(importRoot, 'scripts/check-city-events.mjs')], { encoding: 'utf8' });
  assert.equal(regionalCheck.status, 0, regionalCheck.stderr);
  overlapping.events[0].sourceId = matinee.sourceId;
  await writeFile(join(importRoot, 'data/city-events.js'), `window.HALIFAX_CITY_EVENTS = ${JSON.stringify(overlapping)};`);
  const missingRegionalOwner = spawnSync(process.execPath, [join(importRoot, 'scripts/check-city-events.mjs')], { encoding: 'utf8' });
  assert.notEqual(missingRegionalOwner.status, 0, 'Provenance aliases alone must not bypass the regional owner gate');
  assert.match(missingRegionalOwner.stderr, /regional_source_events_missing_after_sanitize/);
} finally { await rm(importRoot, { recursive: true, force: true }); }
  console.log('Supplemental CLI passed: mocked same-day performances keep deterministic detail-seeded IDs across repeated pages and repeated runs; raw collector counts stay honest.');
