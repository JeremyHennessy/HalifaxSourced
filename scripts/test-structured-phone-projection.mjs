import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const source = await readFile(new URL('app-place-facts-display.js', root), 'utf8');
const correctionsSource = await readFile(new URL('restaurant-corrections.js', root), 'utf8');
const lifecycleSource = await readFile(new URL('app-lifecycle.js', root), 'utf8');
const OBSERVED = '2026-09-04T13:24:16.568Z';
const acceptedPhone = '+1 902-444-0277';

function project(phone, priorPhone = acceptedPhone, reviewedPhone) {
  const facts = { restaurantId: 'fixture', phone, observedAt: OBSERVED, lastVerifiedAt: OBSERVED, sourceUrl: 'https://example.test/', hours: null };
  const before = JSON.stringify(facts);
  const restaurant = { id: 'fixture', name: 'Fixture Cafe', phone: priorPhone, structuredFacts: facts };
  const context = vm.createContext({
    restaurants: [restaurant], activeRestaurants: [], Intl, Date,
    reviewedRestaurantCorrections: { records: reviewedPhone === undefined ? [] : [{ restaurantId: 'fixture', fields: { phone: reviewedPhone }, sourceUrl: 'https://example.test/reviewed', observedAt: OBSERVED }] },
    HalifaxDataIntegrity: { pointerSafe: () => true }, inspectionMatches: () => [],
  });
  vm.runInContext(correctionsSource, context);
  vm.runInContext('const isRestaurantActive = restaurant => HalifaxRestaurantCorrections.isActive(restaurant);', context);
  vm.runInContext(source, context);
  vm.runInContext(lifecycleSource, context);
  assert.equal(JSON.stringify(facts), before, 'Projection must preserve raw source evidence and clocks');
  return restaurant;
}

const malformed = [
  null, undefined, '', '  ', 9024440277, ['9024440277'], { number: '9024440277' },
  '&#43;&#49;90&#50;4&#52;4&#48;&#50;77', '+&#49;9&#48;&#50;4&#48;5&#52;55&#52;',
  '&#x2b;19024440277', '&plus;19024440277', '//+1 (902) 425-4333',
  '%20+1(902)429-8806', '+1%20902-406-5050', 'tel:+19024440277',
  '<a href="tel:9024440277">call</a>', 'https://example.test/9024440277',
  '9024440277@example.test', '9024440277 / 9025550123', 'Call 9024440277',
  '902555', '+1234567890123456', '+1 902 555 0100 ext unknown',
  '+1 902 555 0100 ext 1234567', '++19024440277', '902+4440277',
  '(902 444-0277', '902) 444-0277', '((902)) 444-0277',
  '902\n4440277', '902\t4440277', '902\u200b4440277',
];
for (const phone of malformed) {
  const projected = project(phone);
  assert.equal(projected.phone, acceptedPhone, `Retain prior number for malformed evidence: ${JSON.stringify(phone)}`);
  assert(!Object.hasOwn(projected, 'previousPhone'), 'Do not imply rejected evidence was projected');
  assert.equal(project(phone, null).phone, null, 'An unknown prior number must remain unknown');
  const absent = project(phone, null);
  delete absent.phone;
  const context = vm.createContext({ restaurants: [absent], Date, Intl });
  vm.runInContext(source, context);
  assert(!Object.hasOwn(absent, 'phone'), 'Do not fabricate a phone field when both usable sources are absent');
}
for (const phone of [
  '9024440277', '+19024440277', '+1 (902) 444-0277', '(902) 444.0277',
  '444-0277', '1-800-555-0100', '+44 20 7946 0958', '+49 (0)30 123456',
  '+81 (3) 1234-5678', '0044 20 7946 0958', '+1\u202f902\u00a0444–0277',
  '+1 902 444-0277 ext 123', '+1 902 444-0277 ext. 123',
  '+1 902 444-0277 extension 123', '9024440277x123', '9024440277 #123',
]) {
  const projected = project(phone);
  assert.equal(projected.phone, phone, 'Retain readable source formatting without decoding or claiming verification');
  assert.equal(projected.previousPhone, acceptedPhone);
  assert.equal(project(phone, null).phone, phone, 'Readable structured number can fill a missing contact');
}
for (const reviewedPhone of ['902-555-0123', '+44 20 7946 0958 ext 12', null]) {
  for (const observation of ['%209024440277', '9024440277']) {
    assert.equal(project(observation, acceptedPhone, reviewedPhone).phone, reviewedPhone, 'Explicit reviewed contact changes/holds retain final precedence');
  }
}

// Compare the actual complete consumer order with the pre-guard projection.
// A fixed clock prevents unrelated freshness/hour drift between the two runs.
const RealDate = Date;
class FixedDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : ['2026-10-25T18:00:00.000Z'])); }
  static now() { return RealDate.parse('2026-10-25T18:00:00.000Z'); }
}
const html = await readFile(new URL('index.html', root), 'utf8');
const oldSource = source.replace('if (usableStructuredPhone(facts.phone))', 'if (facts.phone)');
assert.notEqual(oldSource, source, 'The baseline must reproduce the previous unconditional phone projection');
async function actualProjection(displaySource) {
  const context = vm.createContext({ window: {}, document: { querySelector: () => ({}), querySelectorAll: () => [] }, localStorage: { getItem: () => null, setItem: () => {} }, console, URL, Date: FixedDate, Intl, Set, Map });
  let rawBefore;
  for (const match of html.matchAll(/<script src="\.\/([^"?]+)[^"]*"><\/script>/g)) {
    const file = match[1];
    if (file.startsWith('vendor/')) continue;
    if (file === 'app-place-facts-display.js') rawBefore = vm.runInContext('JSON.stringify(window.HALIFAX_STRUCTURED_PLACE_FACTS)', context);
    vm.runInContext(file === 'app-place-facts-display.js' ? displaySource : await readFile(new URL(file, root), 'utf8'), context, { filename: file, timeout: 60000 });
    if (file === 'app-lifecycle.js') break;
  }
  assert.equal(vm.runInContext('JSON.stringify(window.HALIFAX_STRUCTURED_PLACE_FACTS)', context), rawBefore, 'Preserve every raw structured fact and observation clock');
  return JSON.parse(vm.runInContext('JSON.stringify(restaurants)', context));
}
const before = await actualProjection(oldSource);
const after = await actualProjection(source);
const expected = new Map([
  ['osm-node-11701979069-sketti-and-ball', acceptedPhone],
  ['osm-node-2611287045-gingerbread-haus-bakery', '+1-902-425-4333'],
  ['osm-node-4411880103-the-bg', '+1-902-405-4554'],
  ['osm-node-7674255992-pg-cafe-and-grill', '+1-902-429-8806'],
  ['osm-node-9165619005-mother-s-pizza', '+19024065050'],
]);
assert.deepEqual(before.map(record => record.id), after.map(record => record.id), 'No identity changes');
const deltas = [];
for (let index = 0; index < before.length; index++) {
  const prior = before[index], final = after[index];
  if (!expected.has(prior.id)) {
    assert.deepEqual(final, prior, `Unrelated restaurant projection changed: ${prior.id}`);
    continue;
  }
  assert.equal(final.phone, expected.get(prior.id));
  assert.equal(final.phone, prior.previousPhone, 'Retain the existing accepted number, not a decoded substitute');
  assert.equal(prior.phone, final.structuredFacts.phone, 'Malformed observation remains raw source evidence');
  assert.equal(final.structuredPhone, prior.structuredPhone);
  assert(!Object.hasOwn(final, 'previousPhone'));
  assert.deepEqual({ ...final, phone: prior.phone, previousPhone: prior.previousPhone }, prior, 'Only phone projection bookkeeping may change');
  deltas.push({ id: final.id, from: prior.phone, to: final.phone });
}
assert.equal(deltas.length, expected.size, 'Exactly five malformed phone projections are held');
const workflow = await readFile(new URL('.github/workflows/quality-gate.yml', root), 'utf8');
assert(workflow.includes('node scripts/test-structured-phone-projection.mjs'), 'Run the regression in Quality Gate');
console.log(JSON.stringify({ changedPhones: deltas, unchangedRestaurantProjections: before.length - deltas.length }, null, 2));
console.log('Structured-phone projection passed: prior contacts retained, valid formats/extensions preserved, malformed/missing inputs held, explicit reviews and raw clocks unchanged.');
