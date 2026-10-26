import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import integrity from '../source-integrity.js';
const fixtureNow = Date.parse('2026-10-26T00:00:00.000Z');
const corpusNow = Date.parse(process.env.FRESHNESS_AS_OF || new Date().toISOString());
assert(Number.isFinite(corpusNow), 'A finite current-corpus clock is required');
const old = '2026-01-01T12:00:00.000Z', recent = '2026-10-25T12:00:00.000Z';
const signal = { restaurantId: 'fixture', status: 200, observedAt: old };
const place = fields => ({ id: 'fixture', ...fields });
const stamp = record => integrity.restaurantObservationStamp(record, {}, fixtureNow);
assert.equal(stamp(place({ signal })), old);
for (const status of [200, '200', 204, 299]) assert.equal(integrity.officialObservationStamp({ ...signal, status }, fixtureNow), old);
for (const bad of [
  { status: 199 }, { status: 200.5 }, { status: [200] }, { status: 301 }, { status: 403 }, { status: 500 }, { status: null },
  { error: 'timeout' }, { error: 'not_html' }, { error: 'robots_disallow' },
  { attempted: false }, { attempted: 'true' }, { state: 'held' }, { state: 'failed' },
  { accessHold: {} }, { holdTarget: 'https://fixture.example/' }, { reusedObservation: true }, { reviewState: 'restricted' },
  { observedAt: null }, { observedAt: 'malformed' }, { observedAt: '2026-10-27T00:00:00Z' }
]) {
  const failed = { ...signal, observedAt: recent, ...bad };
  assert.equal(stamp(place({ signal: failed })), '', JSON.stringify(bad));
  assert.equal(stamp(place({ signal: failed, sourceObservedAt: old })), old, 'Independent evidence survives: ' + JSON.stringify(bad));
}
assert.equal(stamp(place({ signal: { ...signal, latestAssessment: { state: 'held', attempted: false, assessedAt: recent, error: 'access_hold' } } })), old, 'Separate failed refresh cannot restamp or erase genuine prior evidence');
assert.equal(stamp(place({ freshnessDate: recent, generatedAt: recent, lastVerifiedAt: recent, observedAt: recent, signal: { error: 'timeout', observedAt: recent } })), '', 'No import, rebuild, attempt, or generic root fallback');
assert.equal(stamp(place({ signal: { ...signal, restaurantId: 'other' } })), '', 'No other identity may lend freshness');
assert.equal(stamp(place({ firstPartySources: { restaurantId: 'other', reviewState: 'verified', observedAt: recent } })), '');
for (const fields of [
  { sourceObservedAt: recent }, { reviewedPlaceResolution: { observedAt: recent } },
  { operatingStatusEvidence: { observedAt: recent } }, { operatingStatusEvidence: { verifiedAt: recent } },
  { sources: [{ observedAt: recent }] },
  { firstPartySources: { restaurantId: 'fixture', reviewState: 'verified', observedAt: recent, lastVerifiedAt: '2026-10-28' } }
]) assert.equal(stamp(place({ signal, ...fields })), recent, 'Newest independent evidence wins');
assert.equal(stamp(place({ firstPartySources: { restaurantId: 'fixture', reviewState: 'verified', lastVerifiedAt: recent } })), '', 'First-party verification metadata is not an observation');
for (const fields of [{ reviewState: 'pending' }, { error: 'failed' }, { attempted: false }, { state: 'held' }]) assert.equal(stamp(place({ firstPartySources: { restaurantId: 'fixture', reviewState: 'verified', observedAt: recent, ...fields } })), '');
assert.equal(integrity.restaurantObservationStamp(place({}), { officialResults: [{ ...signal, observedAt: recent }, signal, { ...signal, observedAt: 'bad' }] }, fixtureNow), recent, 'Array order and invalid later receipts cannot hide a good observation');
assert.equal(stamp(place({ sourceObservedAt: '2026-10-25T09:00:00-03:00' })), recent, 'Offsets normalize before ordering');
assert.equal(stamp(place({ sources: [null], firstPartySources: null })), '');
for (const source of [{ status: ' 404' }, { status: [200] }, { status: {} }, { status: ' FAILED ' }, { status: 404 }, { status: '429' }, { status: 'failed' }, { status: 'restricted' }, { reviewState: 'rejected' }, { error: 'timeout' }, { attempted: false }, { restaurantId: 'other' }]) {
  assert.equal(stamp(place({ sources: [{ observedAt: recent, ...source }] })), '', 'No failed or unscoped nested receipt: ' + JSON.stringify(source));
  assert.equal(stamp(place({ sources: [{ observedAt: recent, ...source }, { observedAt: old, status: 'verified' }] })), old);
}


// Load the actual browser data/model order at the current corpus clock, not
// the deliberately frozen hostile-fixture clock above.
const root = new URL('../', import.meta.url);
async function loadBrowserModel(inject = () => {}) {
  return loadBrowserModelAtClock(corpusNow, inject);
}
async function loadBrowserModelAtClock(modelNow, inject = () => {}) {
  class ModelDate extends Date { constructor(...args) { super(...(args.length ? args : [modelNow])); } static now() { return modelNow; } }
  const context = vm.createContext({ window: {}, document: { querySelector: () => ({}), querySelectorAll: () => [] }, localStorage: { getItem: () => null, setItem: () => {} }, console, URL, Date: ModelDate, Intl, Set, Map });
  const html = await readFile(new URL('index.html', root), 'utf8');
  for (const match of html.matchAll(/<script src="\.\/([^"?]+)[^\"]*"><\/script>/g)) {
    const file = match[1]; if (file.startsWith('vendor/')) continue;
    if (file === 'app-core.js') inject(context.window);
    vm.runInContext(await readFile(new URL(file, root), 'utf8'), context, { filename: file, timeout: 60000 });
    if (file === 'app-lifecycle.js') break;
  }
  return context;
}
function expected(record, { officialResults, firstPartyRecords } = {}, clock = corpusNow) {
  const eligible = row => row && (!Object.hasOwn(row, 'status') || ['number','string'].includes(typeof row.status)) && (!(typeof row.status === 'number' || typeof row.status === 'string' && /^[+-]?(?:\d|\.\d)/.test(row.status.trim())) || Number.isInteger(Number(row.status)) && Number(row.status) >= 200 && Number(row.status) < 300) && !row.error && (!Object.hasOwn(row, 'attempted') || row.attempted === true) && (!Object.hasOwn(row, 'state') || ['ok','observed'].includes(row.state)) && !Object.hasOwn(row, 'accessHold') && !Object.hasOwn(row, 'holdTarget') && row.reusedObservation !== true && !['failed','restricted','held','blocked','unattempted','not_attempted','rejected'].includes(typeof row.status === 'string' ? row.status.trim().toLowerCase() : row.status) && !['failed','restricted','held','blocked','rejected'].includes(row.reviewState);
  const nested = row => eligible(row) && (!Object.hasOwn(row, 'restaurantId') || row.restaurantId === record.id);
  const rowsFor = (rows, fallback) => {
    const associated = (rows || []).filter(row => row?.restaurantId === record.id);
    return associated.length ? associated : fallback ? [fallback] : [];
  };
  const dates = [record.sourceObservedAt,
    nested(record.reviewedPlaceResolution) ? record.reviewedPlaceResolution.observedAt : '',
    nested(record.operatingStatusEvidence) ? record.operatingStatusEvidence.observedAt || record.operatingStatusEvidence.verifiedAt : '',
    ...(record.sources || []).filter(nested).map(row => row.observedAt)];
  for (const row of rowsFor(officialResults, record.signal)) {
    if (row.restaurantId === record.id && eligible(row) && ['number','string'].includes(typeof row.status) && Number.isInteger(Number(row.status)) && Number(row.status) >= 200 && Number(row.status) < 300) dates.push(row.observedAt);
  }
  for (const row of rowsFor(firstPartyRecords, record.firstPartySources)) {
    if (row.restaurantId === record.id && eligible(row) && row.reviewState === 'verified') dates.push(row.observedAt);
  }
  const times = dates.filter(value => typeof value === 'string').map(Date.parse).filter(value => Number.isFinite(value) && value <= clock);
  return times.length ? new Date(Math.max(...times)).toISOString() : '';
}

// Frozen named examples protect causality without prescribing what these live
// businesses must show after legitimate future observations are accepted.
const frozenDharma = { id: 'frozen-dharma-sushi', name: 'Dharma Sushi retention fixture', sources: [], freshnessDate: recent,
  signal: { restaurantId: 'frozen-dharma-sushi', status: 503, error: 'robots_unavailable', observedAt: '2026-09-04T12:00:00.000Z' } };
const frozenQueen = { id: 'frozen-queen-street-sushi', name: 'Queen Street Sushi retention fixture', sources: [],
  reviewedCorrection: { observedAt: '2026-08-29', reviewedAt: '2026-10-25T22:35:00.000Z' },
  firstPartySources: { restaurantId: 'frozen-queen-street-sushi', reviewState: 'verified', observedAt: '2026-09-04T13:33:35.848Z', lastVerifiedAt: '2026-10-25T22:35:00.000Z' } };
for (const [record, original] of [[frozenDharma, ''], [frozenQueen, '2026-09-04T13:33:35.848Z']]) {
  const before = JSON.stringify(record);
  assert.equal(stamp(record), original, 'Attempt/retention review clocks alone cannot create a source observation');
  for (const observedAt of ['2026-10-25T22:35:00.000Z', '2026-10-25T23:00:00.000Z']) {
    const successful = { ...record, signal: { restaurantId: record.id, status: 200, observedAt } };
    assert.equal(stamp(successful), observedAt, 'A genuine success may be newer or exactly equal to the retention-review timestamp');
    assert.equal(stamp(successful), expected(successful, {}, fixtureNow));
  }
  assert.equal(JSON.stringify(record), before);
}
for (const field of ['reviewedPlaceResolution', 'operatingStatusEvidence']) {
  for (const bad of [{ status: 'failed' }, { reviewState: 'rejected' }, { state: 'held' }, { restaurantId: 'foreign' }, { status: [200] }]) {
    const record = place({ sourceObservedAt: old, [field]: { observedAt: recent, ...bad } });
    assert.equal(expected(record, {}, fixtureNow), old, 'Independent oracle rejects unqualified nested evidence');
    assert.equal(stamp(record), old);
  }
}
const rawSnapshot = context => vm.runInContext("JSON.stringify(Object.fromEntries(Object.entries(window).filter(([key]) => key.startsWith('HALIFAX_'))))", context);
const evidenceFrom = context => ({ officialResults: context.window.HALIFAX_OFFICIAL_SITE_SIGNALS.results, firstPartyRecords: context.window.HALIFAX_FIRST_PARTY_SOURCES.records });
const context = await loadBrowserModel();
const before = vm.runInContext('JSON.stringify(restaurants)', context), rawBefore = rawSnapshot(context);
const model = JSON.parse(before), corpusEvidence = evidenceFrom(context);
const runtimeStamps = JSON.parse(vm.runInContext('JSON.stringify(restaurants.map(row => restaurantSourceObservationStamp(row)))', context));
for (const [index, record] of model.entries()) assert.equal(runtimeStamps[index], expected(record, corpusEvidence), record.id);
const activeIds = new Set(JSON.parse(vm.runInContext('JSON.stringify(activeRestaurants.map(row => row.id))', context)));
const active = model.filter(row => activeIds.has(row.id));
const expectedOrder = active.slice().sort((a,b) => expected(b, corpusEvidence).localeCompare(expected(a, corpusEvidence))).map(row => row.id);
assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(filteredRestaurants({sort:"fresh"}).map(row => row.id))', context)), expectedOrder);
assert.equal(vm.runInContext('JSON.stringify(restaurants)', context), before, 'Source selection/sorting cannot mutate records or clocks');
assert.equal(rawSnapshot(context), rawBefore, 'Source selection/sorting cannot mutate any raw source payload');

// Self-contained named evolution seeds can receive genuine success after the
// hostile-fixture clock; no live identity is required to survive future merges.
for (const [id, name] of [['freshness-dharma-evolution-fixture', 'Dharma Sushi evolution fixture'], ['freshness-queen-evolution-fixture', 'Queen Street Sushi evolution fixture']]) {
  const observedAt = new Date(corpusNow - 60000).toISOString();
  const updated = await loadBrowserModel(window => {
    window.HALIFAX_RESTAURANTS.push({ id, name, cuisines: [], sources: [] });
    window.HALIFAX_OFFICIAL_SITE_SIGNALS.results.push({ restaurantId: id, status: 200, observedAt });
  });
  const frozenBefore = vm.runInContext('JSON.stringify(restaurants)', updated), rawUpdated = rawSnapshot(updated);
  const record = JSON.parse(vm.runInContext(`JSON.stringify(restaurants.find(row => row.id === '${id}'))`, updated));
  assert(record, 'Synthetic evolution seed was assembled');
  const actual = vm.runInContext(`restaurantSourceObservationStamp(restaurants.find(row => row.id === '${id}'))`, updated);
  assert.equal(actual, expected(record, evidenceFrom(updated)));
  assert(actual >= observedAt, 'Legitimate newly observed success is not rejected by a frozen regression date');
  assert.equal(vm.runInContext('JSON.stringify(restaurants)', updated), frozenBefore);
  assert.equal(rawSnapshot(updated), rawUpdated);
}
// Real browser-model ingestion: preserve the legacy detail row selection but
// derive freshness from all raw observations, in either source-array order.
for (const reverse of [false, true]) {
  const id = 'source-freshness-ingestion-fixture';
  const addFixture = window => window.HALIFAX_RESTAURANTS.push({ id, name: 'Observation ingestion fixture', cuisines: [], sources: [] });
  const officialRows = [{ restaurantId: id, status: 200, observedAt: old }, { restaurantId: id, error: 'timeout', observedAt: recent }];
  const fpRows = [{ restaurantId: id, reviewState: 'verified', observedAt: old }, { restaurantId: id, reviewState: 'verified', observedAt: recent }];
  if (reverse) { officialRows.reverse(); fpRows.reverse(); }
  const duplicate = await loadBrowserModelAtClock(fixtureNow, window => {
    addFixture(window);
    window.HALIFAX_OFFICIAL_SITE_SIGNALS.results = [...window.HALIFAX_OFFICIAL_SITE_SIGNALS.results.filter(row => row.restaurantId !== id), ...officialRows];
    window.HALIFAX_FIRST_PARTY_SOURCES.records = window.HALIFAX_FIRST_PARTY_SOURCES.records.filter(row => row.restaurantId !== id);
  });
  const get = expression => JSON.parse(vm.runInContext(`JSON.stringify(${expression})`, duplicate));
  const target = `restaurants.find(row => row.id === '${id}')`;
  const raw = get('{restaurants, official:window.HALIFAX_OFFICIAL_SITE_SIGNALS, firstParty:window.HALIFAX_FIRST_PARTY_SOURCES}');
  assert.equal(get(`officialSourceObservationStamp(${target})`), old, 'A later failed detail row cannot erase old successful source evidence');
  assert.equal(get(`restaurantSourceObservationStamp(${target})`), old);
  assert.equal(expected(get(target), evidenceFrom(duplicate), fixtureNow), old, 'Independent oracle reads all raw official rows');
  assert.deepEqual(get(`${target}.signal`), officialRows.at(-1), 'Legacy detail selection and raw failure remain unchanged');
  assert.deepEqual(get('{restaurants, official:window.HALIFAX_OFFICIAL_SITE_SIGNALS, firstParty:window.HALIFAX_FIRST_PARTY_SOURCES}'), raw);
  const firstPartyDuplicate = await loadBrowserModelAtClock(fixtureNow, window => {
    addFixture(window);
    window.HALIFAX_OFFICIAL_SITE_SIGNALS.results = window.HALIFAX_OFFICIAL_SITE_SIGNALS.results.filter(row => row.restaurantId !== id);
    window.HALIFAX_FIRST_PARTY_SOURCES.records = [...window.HALIFAX_FIRST_PARTY_SOURCES.records.filter(row => row.restaurantId !== id), ...fpRows];
  });
  const fpModelBefore = vm.runInContext('JSON.stringify(restaurants)', firstPartyDuplicate), fpRawBefore = rawSnapshot(firstPartyDuplicate);
  assert.equal(expected(JSON.parse(vm.runInContext(`JSON.stringify(${target})`, firstPartyDuplicate)), evidenceFrom(firstPartyDuplicate), fixtureNow), recent, 'Independent oracle reads all raw first-party rows');
  assert.equal(vm.runInContext(`restaurantSourceObservationStamp(${target})`, firstPartyDuplicate), recent, 'Multiple first-party observations use newest original date regardless of decorator order');
  assert.equal(vm.runInContext(`${target}.firstPartySources.observedAt`, firstPartyDuplicate), fpRows[0].observedAt, 'Legacy first-party detail projection remains intact');
  assert.equal(vm.runInContext('JSON.stringify(restaurants)', firstPartyDuplicate), fpModelBefore);
  assert.equal(rawSnapshot(firstPartyDuplicate), fpRawBefore);
}
const failures = active.filter(row => row.signal && (row.signal.error || Number(row.signal.status) >= 400));
console.log(`Source freshness passed: ${model.length} exact identities, ${active.length} active, ${failures.length} active failed official attempts excluded, ${model.filter(row => !expected(row, corpusEvidence)).length} unknown; raw records/clocks unchanged.`);
