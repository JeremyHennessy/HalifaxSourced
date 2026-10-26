import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import integrity from '../source-integrity.js';
const now = Date.parse('2026-10-26T00:00:00.000Z');
const old = '2026-01-01T12:00:00.000Z', recent = '2026-10-25T12:00:00.000Z';
const signal = { restaurantId: 'fixture', status: 200, observedAt: old };
const place = fields => ({ id: 'fixture', ...fields });
const stamp = record => integrity.restaurantObservationStamp(record, {}, now);
assert.equal(stamp(place({ signal })), old);
for (const status of [200, '200', 204, 299]) assert.equal(integrity.officialObservationStamp({ ...signal, status }, now), old);
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
assert.equal(integrity.restaurantObservationStamp(place({}), { officialResults: [{ ...signal, observedAt: recent }, signal, { ...signal, observedAt: 'bad' }] }, now), recent, 'Array order and invalid later receipts cannot hide a good observation');
assert.equal(stamp(place({ sourceObservedAt: '2026-10-25T09:00:00-03:00' })), recent, 'Offsets normalize before ordering');
assert.equal(stamp(place({ sources: [null], firstPartySources: null })), '');
for (const source of [{ status: ' 404' }, { status: [200] }, { status: {} }, { status: ' FAILED ' }, { status: 404 }, { status: '429' }, { status: 'failed' }, { status: 'restricted' }, { reviewState: 'rejected' }, { error: 'timeout' }, { attempted: false }, { restaurantId: 'other' }]) {
  assert.equal(stamp(place({ sources: [{ observedAt: recent, ...source }] })), '', 'No failed or unscoped nested receipt: ' + JSON.stringify(source));
  assert.equal(stamp(place({ sources: [{ observedAt: recent, ...source }, { observedAt: old, status: 'verified' }] })), old);
}


// Load the actual browser data/model order; calculate evidence independently.
class FixtureDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
const root = new URL('../', import.meta.url);
async function loadBrowserModel(inject = () => {}) {
  const context = vm.createContext({ window: {}, document: { querySelector: () => ({}), querySelectorAll: () => [] }, localStorage: { getItem: () => null, setItem: () => {} }, console, URL, Date: FixtureDate, Intl, Set, Map });
  const html = await readFile(new URL('index.html', root), 'utf8');
  for (const match of html.matchAll(/<script src="\.\/([^"?]+)[^\"]*"><\/script>/g)) {
    const file = match[1]; if (file.startsWith('vendor/')) continue;
    if (file === 'app-core.js') inject(context.window);
    vm.runInContext(await readFile(new URL(file, root), 'utf8'), context, { filename: file, timeout: 60000 });
    if (file === 'app-lifecycle.js') break;
  }
  return context;
}
const context = await loadBrowserModel();
const before = vm.runInContext('JSON.stringify(restaurants)', context);
const model = JSON.parse(before);
function expected(record) {
  const eligible = row => row && (!Object.hasOwn(row, 'status') || ['number','string'].includes(typeof row.status)) && (!(typeof row.status === 'number' || typeof row.status === 'string' && /^[+-]?(?:\d|\.\d)/.test(row.status.trim())) || Number.isInteger(Number(row.status)) && Number(row.status) >= 200 && Number(row.status) < 300) && !row.error && (!Object.hasOwn(row, 'attempted') || row.attempted === true) && (!Object.hasOwn(row, 'state') || ['ok','observed'].includes(row.state)) && !Object.hasOwn(row, 'accessHold') && !Object.hasOwn(row, 'holdTarget') && row.reusedObservation !== true && !['failed','restricted','held','blocked','unattempted','not_attempted','rejected'].includes(typeof row.status === 'string' ? row.status.trim().toLowerCase() : row.status) && !['failed','restricted','held','blocked','rejected'].includes(row.reviewState);
  const official = record.signal;
  const fp = record.firstPartySources;
  const dates = [record.sourceObservedAt, record.reviewedPlaceResolution?.observedAt, record.operatingStatusEvidence?.observedAt || record.operatingStatusEvidence?.verifiedAt, ...(record.sources || []).filter(row => eligible(row) && (!Object.hasOwn(row, 'restaurantId') || row.restaurantId === record.id)).map(row => row.observedAt)];
  if (official?.restaurantId === record.id && eligible(official) && Number(official.status) >= 200 && Number(official.status) < 300) dates.push(official.observedAt);
  if (fp?.restaurantId === record.id && eligible(fp) && fp.reviewState === 'verified') dates.push(fp.observedAt);
  const times = dates.filter(value => typeof value === 'string').map(Date.parse).filter(value => Number.isFinite(value) && value <= now);
  return times.length ? new Date(Math.max(...times)).toISOString() : '';
}
for (const record of model) assert.equal(stamp(record), expected(record), record.id);
const activeIds = new Set(JSON.parse(vm.runInContext('JSON.stringify(activeRestaurants.map(row => row.id))', context)));
const active = model.filter(row => activeIds.has(row.id));
const expectedOrder = active.slice().sort((a,b) => expected(b).localeCompare(expected(a))).map(row => row.id);
assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(filteredRestaurants({sort:"fresh"}).map(row => row.id))', context)), expectedOrder);
const dharma = model.find(row => row.id === 'osm-node-5863968654-dharma-sushi');
assert(dharma, 'Known failing-source fixture must exist');
assert.equal(stamp(dharma), '', 'Failed Dharma check stays undated');
const queen = model.find(row => row.id === 'osm-node-5161526522-sushi-nami-royale');
assert(queen);
assert.equal(queen.reviewedCorrection.observedAt, '2026-08-29');
assert.equal(stamp(queen), '2026-09-04T13:33:35.848Z', 'Offline Queen Street reviewedAt cannot create an October source observation');
assert.equal(vm.runInContext('JSON.stringify(restaurants)', context), before, 'Source selection/sorting cannot mutate records or clocks');
// Real browser-model ingestion: preserve the legacy detail row selection but
// derive freshness from all raw observations, in either source-array order.
for (const reverse of [false, true]) {
  const id = dharma.id;
  const officialRows = [{ restaurantId: id, status: 200, observedAt: old }, { restaurantId: id, error: 'timeout', observedAt: recent }];
  const fpRows = [{ restaurantId: id, reviewState: 'verified', observedAt: old }, { restaurantId: id, reviewState: 'verified', observedAt: recent }];
  if (reverse) { officialRows.reverse(); fpRows.reverse(); }
  const duplicate = await loadBrowserModel(window => {
    window.HALIFAX_OFFICIAL_SITE_SIGNALS.results = [...window.HALIFAX_OFFICIAL_SITE_SIGNALS.results.filter(row => row.restaurantId !== id), ...officialRows];
    window.HALIFAX_FIRST_PARTY_SOURCES.records = window.HALIFAX_FIRST_PARTY_SOURCES.records.filter(row => row.restaurantId !== id);
  });
  const get = expression => JSON.parse(vm.runInContext(`JSON.stringify(${expression})`, duplicate));
  const target = `restaurants.find(row => row.id === '${id}')`;
  const raw = get('{restaurants, official:window.HALIFAX_OFFICIAL_SITE_SIGNALS, firstParty:window.HALIFAX_FIRST_PARTY_SOURCES}');
  assert.equal(get(`officialSourceObservationStamp(${target})`), old, 'A later failed detail row cannot erase old successful source evidence');
  assert.equal(get(`restaurantSourceObservationStamp(${target})`), old);
  assert.deepEqual(get(`${target}.signal`), officialRows.at(-1), 'Legacy detail selection and raw failure remain unchanged');
  assert.deepEqual(get('{restaurants, official:window.HALIFAX_OFFICIAL_SITE_SIGNALS, firstParty:window.HALIFAX_FIRST_PARTY_SOURCES}'), raw);
  const firstPartyDuplicate = await loadBrowserModel(window => {
    window.HALIFAX_OFFICIAL_SITE_SIGNALS.results = window.HALIFAX_OFFICIAL_SITE_SIGNALS.results.filter(row => row.restaurantId !== id);
    window.HALIFAX_FIRST_PARTY_SOURCES.records = [...window.HALIFAX_FIRST_PARTY_SOURCES.records.filter(row => row.restaurantId !== id), ...fpRows];
  });
  assert.equal(vm.runInContext(`restaurantSourceObservationStamp(${target})`, firstPartyDuplicate), recent, 'Multiple first-party observations use newest original date regardless of decorator order');
  assert.equal(vm.runInContext(`${target}.firstPartySources.observedAt`, firstPartyDuplicate), fpRows[0].observedAt, 'Legacy first-party detail projection remains intact');
}
const failures = active.filter(row => row.signal && (row.signal.error || Number(row.signal.status) >= 400));
console.log(`Source freshness passed: ${model.length} exact identities, ${active.length} active, ${failures.length} active failed official attempts excluded, ${model.filter(row => !stamp(row)).length} unknown; raw records/clocks unchanged.`);
