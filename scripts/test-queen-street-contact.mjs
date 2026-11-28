import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const QUEEN = 'osm-node-5161526522-sushi-nami-royale';
const BAYERS = 'osm-node-11552234300-sushi-nami-royale';
const PHONE = '902-422-1636';
const GENERIC = '+19024229020';
const LOCATION = 'https://sushinami.ca/downtown-halifax/';
const MENU = 'https://sushinami.ca/downtown-halifax/take-out/';
const OBSERVED = '2026-08-29';
const correctionsSource = await read('data/reviewed-restaurant-corrections.js');
const payloadContext = { window: {} };
vm.runInNewContext(correctionsSource, payloadContext);
const corrections = JSON.parse(JSON.stringify(payloadContext.window.HALIFAX_RESTAURANT_CORRECTIONS));
const retained = corrections.records.filter(record => record.restaurantId === QUEEN);
assert.equal(retained.length, 1, 'One composable Queen Street correction, not a replacement of other reviews');
const correction = retained[0];
assert.deepEqual(correction.fields, { phone: PHONE, website: LOCATION, menuUrl: MENU });
assert.equal(correction.sourceUrl, LOCATION);
assert.equal(correction.observedAt, OBSERVED);
assert.equal(correction.reviewBasis, 'preserve_accepted_location_evidence_and_current_branch_menu');
assert.equal(correction.fieldEvidence.phone.observedAt, OBSERVED);
assert.equal(correction.fieldEvidence.menuUrl.observedAt, '2026-11-15T18:18:56Z');
assert.match(correction.claim, /fills the missing branch-specific takeout menu link/);
assert(Date.parse(correction.reviewedAt) > Date.parse(OBSERVED));
const baselineCorrections = { ...corrections, records: corrections.records.filter(record => record.restaurantId !== QUEEN) };
const serialize = payload => `window.HALIFAX_RESTAURANT_CORRECTIONS = ${JSON.stringify(payload)};`;
const RealDate = Date;
class FixedDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : ['2026-10-25T18:00:00Z'])); }
  static now() { return RealDate.parse('2026-10-25T18:00:00Z'); }
}
const html = await read('index.html');
async function project(payload) {
  const context = vm.createContext({ window: {}, document: { querySelector: () => ({}), querySelectorAll: () => [] }, localStorage: { getItem: () => null, setItem: () => {} }, console, URL, Date: FixedDate, Intl, Set, Map });
  let rawBefore;
  for (const match of html.matchAll(/<script src="\.\/([^"?]+)[^"]*"><\/script>/g)) {
    const file = match[1];
    if (file.startsWith('vendor/')) continue;
    if (file === 'app-core.js') rawBefore = JSON.stringify(context.window.HALIFAX_STRUCTURED_PLACE_FACTS);
    vm.runInContext(file === 'data/reviewed-restaurant-corrections.js' ? serialize(payload) : await read(file), context, { filename: file, timeout: 60000 });
    if (file === 'app-lifecycle.js') break;
  }
  const result = () => JSON.parse(vm.runInContext('JSON.stringify(restaurants)', context));
  const first = result();
  vm.runInContext(await read('app-lifecycle.js'), context);
  assert.deepEqual(result(), first, 'Repeated final projection is stable');
  assert.equal(JSON.stringify(context.window.HALIFAX_STRUCTURED_PLACE_FACTS), rawBefore, 'All raw structured observations and clocks survive');
  const raw = Object.fromEntries(Object.entries(context.window).filter(([key]) => key.startsWith('HALIFAX_') && key !== 'HALIFAX_RESTAURANT_CORRECTIONS'));
  return { records: first, raw: JSON.parse(JSON.stringify(raw)) };
}
const before = await project(baselineCorrections), after = await project(corrections);
assert.deepEqual(after.raw, before.raw, 'Every other source payload and accepted resolution remains unchanged');
assert.deepEqual(after.records.map(record => record.id), before.records.map(record => record.id), 'No identity changes');
const prior = before.records.find(record => record.id === QUEEN);
const final = after.records.find(record => record.id === QUEEN);
assert.equal(prior.phone, GENERIC);
assert.equal(prior.previousPhone, PHONE);
assert.equal(final.phone, PHONE);
assert.equal(final.website, LOCATION);
assert.equal(final.menuUrl, MENU);
assert.equal(final.previousPhone, PHONE);
assert.equal(final.structuredPhone, GENERIC);
assert.deepEqual(final.structuredFacts, prior.structuredFacts);
assert.equal(final.structuredFacts.sourceUrl, 'https://sushinami.ca/');
assert.equal(final.structuredFacts.observedAt, prior.structuredFacts.observedAt);
assert.equal(final.structuredFacts.lastVerifiedAt, prior.structuredFacts.lastVerifiedAt);
assert.equal(final.reviewedPlaceResolution.phone, PHONE);
assert.equal(final.reviewedPlaceResolution.sourceUrl, LOCATION);
assert.equal(final.reviewedPlaceResolution.observedAt, OBSERVED);
assert(final.reviewedPlaceResolution.evidence.includes('official_location_contact'));
assert.deepEqual(final.reviewedCorrection, correction);
const addedEvidence = final.sources.filter(source => source.type === 'official_reviewed_correction' && source.url === LOCATION);
assert.equal(addedEvidence.length, 1);
assert.equal(addedEvidence[0].observedAt, OBSERVED);
assert.equal(addedEvidence[0].reviewedAt, correction.reviewedAt);
const stripped = { ...final, phone: prior.phone, website: prior.website, menuUrl: prior.menuUrl, sources: final.sources.filter(source => !addedEvidence.includes(source)) };
if (prior.menuUrl === undefined) delete stripped.menuUrl;
delete stripped.reviewedCorrection;
assert.deepEqual(stripped, prior, 'Only Queen phone, exact branch links and explicit review provenance change');
for (const record of before.records.filter(record => record.id !== QUEEN)) {
  assert.deepEqual(after.records.find(item => item.id === record.id), record, `Unrelated full projection changed: ${record.id}`);
}
const bayers = after.records.find(record => record.id === BAYERS);
assert.equal(bayers.phone, GENERIC, 'Do not reassign the generic number or change another branch in this review');
assert.equal(bayers.structuredFacts.observedAt, before.records.find(record => record.id === BAYERS).structuredFacts.observedAt);
assert.equal(bayers.hasOrdering, false, 'Preserve #217 action hold');
assert.equal(final.hasOrdering, true, 'Preserve Queen valid action');

// Run the real catalog exporter in an isolated copy, before/after and twice.
// It must use the same accepted contact without collecting or changing inputs.
const scratch = await mkdtemp(join(tmpdir(), 'halifax-queen-contact-'));
try {
  for (const folder of ['data', 'scripts/lib']) await cp(new URL(folder, root), join(scratch, folder), { recursive: true });
  for (const file of ['scripts/export-catalog.mjs', 'app-restaurant-identity.js', 'restaurant-corrections.js', 'app-inspection-matching.js', 'source-integrity.js']) {
    await mkdir(join(scratch, file, '..'), { recursive: true });
    await cp(new URL(file, root), join(scratch, file));
  }
  const runExport = async payload => {
    await writeFile(join(scratch, 'data/reviewed-restaurant-corrections.js'), serialize(payload));
    execFileSync(process.execPath, ['--import', fileURLToPath(new URL('scripts/lib/deny-source-network.mjs', root)), 'scripts/export-catalog.mjs'], { cwd: scratch, stdio: 'pipe', timeout: 60000 });
    return JSON.parse(await readFile(join(scratch, 'data/build/catalog.json'), 'utf8')).restaurants;
  };
  const catalogBefore = await runExport(baselineCorrections);
  const catalogAfter = await runExport(corrections);
  assert.deepEqual(await runExport(corrections), catalogAfter, 'Repeated real catalog export is stable');
  const catalogQueen = catalogAfter.find(record => record.id === QUEEN);
  assert.equal(catalogQueen.phone, final.phone, 'Runtime and export retain the same accepted contact');
  assert.equal(catalogQueen.reviewedPlaceResolution.observedAt, OBSERVED);
  assert(catalogQueen.menuLinks.some(link => link.url === MENU), 'Export publishes the reviewed exact menu link');
  assert(catalogQueen.sources.some(source => source.type === 'menu' && source.url === MENU), 'Export retains reviewed menu provenance');
  for (const record of catalogBefore) {
    const next = catalogAfter.find(item => item.id === record.id);
    if (record.id !== QUEEN) assert.deepEqual(next, record, `Unrelated catalog record changed: ${record.id}`);
    else {
      const original = { ...next, sources: next.sources.filter(source => (source.type !== 'official_reviewed_correction' || source.url !== LOCATION) && (source.type !== 'menu' || source.url !== MENU)) };
      original.phone = record.phone;
      original.website = record.website;
      original.menuUrl = record.menuUrl;
      original.menuLinks = record.menuLinks;
      original.hasMenu = record.hasMenu;
      if (record.menuUrl === undefined) delete original.menuUrl;
      if (record.menuLinks === undefined) delete original.menuLinks;
      if (record.hasMenu === undefined) delete original.hasMenu;
      delete original.reviewedCorrection;
      assert.deepEqual(original, record, 'Export changes only the accepted phone, exact branch links and review provenance');
    }
  }
} finally { await rm(scratch, { recursive: true, force: true }); }
const workflow = await read('.github/workflows/quality-gate.yml');
assert(workflow.includes('node scripts/test-queen-street-contact.mjs'));
assert(workflow.includes('node scripts/test-queen-street-contact-navigation.mjs'));
console.log(JSON.stringify({ restaurantId: QUEEN, before: GENERIC, after: PHONE, acceptedObservedAt: OBSERVED, rawObservedAt: final.structuredFacts.observedAt, unchangedRestaurants: after.records.length - 1 }));
console.log('Queen Street contact retention passed: exact field scope, raw/history preservation, other branches, repeated runtime and real export parity.');
