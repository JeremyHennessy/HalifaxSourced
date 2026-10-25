import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const source = await readFile(new URL('app-place-facts-display.js', root), 'utf8');
const identitySource = await readFile(new URL('app-restaurant-identity.js', root), 'utf8');
const correctionsSource = await readFile(new URL('restaurant-corrections.js', root), 'utf8');
const lifecycleSource = await readFile(new URL('app-lifecycle.js', root), 'utf8');
const OBSERVED = '2026-09-04T13:24:30.783Z';
const acceptedAddress = '5659 Almon Street, Halifax, Nova Scotia';

function project(address, priorAddress = acceptedAddress, reviewedAddress) {
  const facts = { restaurantId: 'fixture', address, observedAt: OBSERVED, lastVerifiedAt: OBSERVED, sourceUrl: 'https://example.test/', hours: null };
  const before = JSON.stringify(facts);
  const restaurant = { id: 'fixture', name: 'Fixture Cafe', address: priorAddress, structuredFacts: facts };
  const context = vm.createContext({
    restaurants: [restaurant], activeRestaurants: [], Intl, Date,
    reviewedRestaurantCorrections: { records: reviewedAddress === undefined ? [] : [{ restaurantId: 'fixture', fields: { address: reviewedAddress }, sourceUrl: 'https://example.test/reviewed', observedAt: OBSERVED }] },
    HalifaxDataIntegrity: { pointerSafe: () => true }, inspectionMatches: () => [],
  });
  vm.runInContext(identitySource, context);
  vm.runInContext(correctionsSource, context);
  vm.runInContext('const isRestaurantActive = restaurant => HalifaxRestaurantCorrections.isActive(restaurant);', context);
  vm.runInContext(source, context);
  vm.runInContext(lifecycleSource, context);
  assert.equal(JSON.stringify(facts), before, 'Projection must preserve raw source evidence and clocks');
  return restaurant;
}

const held = [
  null, undefined, '', '  ', 'Halifax, NS, \nCanada', 'Halifax, Nova Scotia', 'Canada', 'B3K 3X2',
  '902-555-0100', '902 555 0100', '+1 902 555 0100', '(902) 555-0100', '902 555 0100 ext 12',
  '12 to 14 Almon Street, Halifax', '12 through 14 Almon Street', '12 and 14 Almon Street',
  '12–14 Almon Street', '12 — 14 Almon Street', '12/14 Almon Street',
  '160-1741 Lower Water Street, Halifax', 'Unit 160, 1741 Lower Water Street, Halifax', '160 1741 Lower Water Street',
  '2026 October 25', '123 phone number', '123 Suite 4', { streetAddress: '123 Main Street' }, ['123 Main Street'],
];
for (const address of held) {
  const projected = project(address);
  assert.equal(projected.address, acceptedAddress, `Retain civic address for incomplete/ambiguous observation: ${JSON.stringify(address)}`);
  assert(!Object.hasOwn(projected, 'previousAddress'), 'Do not imply rejected evidence was projected');
  assert.equal(project(address, null).address, null, 'An unknown prior location must remain unknown');
}
for (const address of [
  '5659 Almon', '5659 Almon Street', '5659 Almon Street, Halifax, NS B3K 3X2',
  '5659 Almon Street\nHalifax, NS, B3K 3X2\nCanada', '123A Main Street, Halifax',
  '1741 Lower Water Street, Unit 160, Halifax', '123 4th Street', '123 Highway 2',
  "123 St. Margaret's Bay Road", "11 O'Connor Street", '123 Église Street',
]) {
  const projected = project(address);
  assert.equal(projected.address, address, 'Keep source formatting for a usable civic address');
  assert.equal(projected.previousAddress, acceptedAddress);
  assert.equal(project(address, null).address, address, 'Usable civic evidence can fill an unknown location');
}
for (const reviewedAddress of ['102 New Street, Halifax', '160-1741 Lower Water Street, Halifax', null]) {
  for (const observation of ['Halifax, NS', '101 Old Street, Halifax']) {
    assert.equal(project(observation, '101 Old Street, Halifax', reviewedAddress).address, reviewedAddress, 'Final explicit reviewed moves/holds take precedence over automatic projection');
  }
}

// Exercise the actual script ordering and accepted inputs without collection.
const context = vm.createContext({ window: {}, document: { querySelector: () => ({}), querySelectorAll: () => [] }, localStorage: { getItem: () => null, setItem: () => {} }, console, URL, Date, Intl, Set, Map });
const html = await readFile(new URL('index.html', root), 'utf8');
let beforeProjection;
let rawBefore;
for (const match of html.matchAll(/<script src="\.\/([^"?]+)[^"]*"><\/script>/g)) {
  const file = match[1];
  if (file.startsWith('vendor/')) continue;
  if (file === 'app-place-facts-display.js') {
    beforeProjection = JSON.parse(vm.runInContext('JSON.stringify(restaurants)', context));
    rawBefore = vm.runInContext('JSON.stringify(window.HALIFAX_STRUCTURED_PLACE_FACTS)', context);
  }
  vm.runInContext(await readFile(new URL(file, root), 'utf8'), context, { filename: file, timeout: 60000 });
  if (file === 'app-lifecycle.js') break;
}
const after = JSON.parse(vm.runInContext('JSON.stringify(restaurants)', context));
assert.equal(vm.runInContext('JSON.stringify(window.HALIFAX_STRUCTURED_PLACE_FACTS)', context), rawBefore, 'All raw structured payload bytes survive the consumer projection');
const almonakId = 'osm-node-8158663930-almonak';
const almonak = after.find(record => record.id === almonakId);
const catalog = JSON.parse(await readFile(new URL('data/build/catalog.json', root), 'utf8'));
assert.equal(almonak.address, acceptedAddress, 'Do not erase Almonak street address with municipality-only JSON-LD');
assert.equal(almonak.address, catalog.restaurants.find(record => record.id === almonakId).address, 'Retained Almonak address must agree with the canonical export');
assert.equal(almonak.structuredFacts.address, 'Halifax, NS, \nCanada', 'Retain rejected raw text as evidence');
assert.equal(almonak.structuredFacts.observedAt, OBSERVED);
assert.equal(almonak.structuredFacts.lastVerifiedAt, OBSERVED);
assert.equal(almonak.structuredAddress, almonak.structuredFacts.address, 'Do not rewrite the source metadata field');
let unchangedStructuredAddresses = 0;
for (const prior of beforeProjection) {
  if (prior.id === almonakId) continue;
  const final = after.find(record => record.id === prior.id);
  const hasReviewedAddress = Object.hasOwn(prior.reviewedCorrection?.fields || {}, 'address');
  const expectedAddress = hasReviewedAddress ? prior.reviewedCorrection.fields.address : prior.structuredFacts?.address || prior.address;
  assert.equal(final.address, expectedAddress, `Keep all unrelated address projections unchanged: ${prior.id}`);
  if (prior.structuredFacts?.address) unchangedStructuredAddresses++;
}
assert.equal(unchangedStructuredAddresses, 22, 'All other current structured-address projections are unchanged');
const workflow = await readFile(new URL('.github/workflows/quality-gate.yml', root), 'utf8');
assert(workflow.includes('node scripts/test-structured-address-projection.mjs'), 'Run this regression in the release Quality Gate');
console.log(`Structured-address projection passed: Almonak civic address retained; ${unchangedStructuredAddresses} other address projections unchanged; malformed inputs held; explicit reviews and all raw clocks preserved.`);
