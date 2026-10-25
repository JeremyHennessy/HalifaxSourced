import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { unambiguousCivicNumber } from './lib/place-address-identity.mjs';

for (const [address, expected] of [
  ['49 Kings Wharf Place, Dartmouth', '49'], ['15b Main Street', '15B'],
  ['1741 Lower Water Street, Unit 160', '1741'], ['160-1741 Lower Water Street', ''],
  ['105-535 Portland Street', ''], ['902-455-5479 6420 Bayers Road', ''],
  ['902 455 5479 6420 Bayers Road', ''], ['Unit 3, 49 Kings Wharf Place', ''],
  ['49-51 Kings Wharf Place', ''], ['49 / 51 Kings Wharf Place', ''],
  ['49 to 51 Kings Wharf Place', ''], [null, '']
]) assert.equal(unambiguousCivicNumber(address), expected, address);

const root = await mkdtemp(join(tmpdir(), 'halifax-civic-conflicts-'));
const repository = new URL('../', import.meta.url);
try {
  for (const file of ['scripts/resolve-place-candidates.mjs', 'scripts/check-place-source-resolution.mjs',
    'scripts/lib/place-address-identity.mjs', 'scripts/lib/deny-source-network.mjs']) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await copyFile(new URL(file, repository), join(root, file));
  }
  await mkdir(join(root, 'data/build'), { recursive: true });
  const place = { id: 'fixture-location', name: 'Fixture Kitchen', address: '49 Kings Wharf Place, Dartmouth',
    website: 'https://fixture.invalid/', phone: '902-555-1234', coordinates: { lat: 44.67, lon: -63.56 } };
  const candidate = (id, address, extra = {}) => ({ ...place, id, address, sourceId: 'fixture', sourceUrl: 'https://directory.invalid/', ...extra });
  const candidates = [
    candidate('explicit-conflict', '42 Kings Wharf Place, Dartmouth'),
    candidate('same-address', '49 Kings Wharf Place, Dartmouth'),
    candidate('suffix-conflict', '49B Kings Wharf Place, Dartmouth'),
    candidate('unit-first-ambiguous', '103-49 Kings Wharf Place, Dartmouth'),
    candidate('phone-prefix', '902-555-1234 49 Kings Wharf Place, Dartmouth'),
    candidate('reviewed-relocation', '42 Kings Wharf Place, Dartmouth')
  ];
  const inputs = {
    'data/build/catalog.json': { restaurants: [place] },
    'data/build/directory-restaurant-leads.json': { generatedAt: '2026-10-20T12:00:00Z', records: candidates },
    'data/build/discovered-restaurants.json': { restaurants: [] },
    'data/place-source-registry.json': { sources: [{ id: 'fixture', name: 'Fixture', kind: 'directory',
      url: 'https://directory.invalid/', authorityClass: 'fixture', refreshFrequency: 'manual', parserMode: 'fixture',
      geographicScope: ['Dartmouth'], contentTypes: ['restaurants'] }] }
  };
  for (const [file, value] of Object.entries(inputs)) await writeFile(join(root, file), JSON.stringify(value));
  await writeFile(join(root, 'data/discovered-restaurants.js'), 'window.HALIFAX_DISCOVERED_RESTAURANTS = [];');
  await writeFile(join(root, 'data/reviewed-place-resolutions.js'), `window.HALIFAX_REVIEWED_PLACE_RESOLUTIONS = ${JSON.stringify({ records: [{
    candidateId: 'reviewed-relocation', restaurantId: place.id, directorySourceId: 'fixture',
    evidence: ['compatible_name', 'reviewed_owner_location'], resolutionState: 'resolved_high'
  }] })};`);
  const run = (script, expected = 0) => {
    const result = spawnSync(process.execPath, ['--import', './scripts/lib/deny-source-network.mjs', `scripts/${script}`],
      { cwd: root, encoding: 'utf8', timeout: 30_000, env: { ...process.env, NODE_OPTIONS: '' } });
    assert.equal(result.status, expected, `${script}: ${result.error || ''}\n${result.stdout}\n${result.stderr}`);
    return result;
  };
  run('resolve-place-candidates.mjs');
  run('check-place-source-resolution.mjs');
  const file = join(root, 'data/build/place-source-resolutions.json');
  const result = JSON.parse(await readFile(file, 'utf8'));
  const byId = new Map(result.resolutions.map(row => [row.candidateId, row]));
  for (const id of ['explicit-conflict', 'suffix-conflict']) {
    const row = byId.get(id);
    assert(!row.state.startsWith('resolved_'), `${id}: shared domain/phone and identical coordinates cannot override a civic conflict`);
    assert(row.conflicts.includes('street_number_conflict'));
    assert(result.reviewQueue.some(item => item.candidateId === id));
  }
  for (const id of ['same-address', 'unit-first-ambiguous', 'phone-prefix']) {
    assert(byId.get(id).state.startsWith('resolved_'), `${id}: preserve nonconflicting existing evidence`);
    assert.deepEqual(byId.get(id).conflicts, []);
  }
  assert(!byId.get('unit-first-ambiguous').evidence.includes('compatible_street_address'), 'A unit number is not civic evidence');
  const reviewed = byId.get('reviewed-relocation');
  assert.equal(reviewed.resolutionBasis, 'reviewed_candidate_override', 'Explicit source-reviewed identity decisions still supersede stale directory data');
  assert.equal(reviewed.matchedRestaurantId, place.id);
  assert.equal(result.directoryGeneratedAt, inputs['data/build/directory-restaurant-leads.json'].generatedAt);
  // Independently reject a fabricated resolved row even if its conflict flag was lost.
  Object.assign(byId.get('explicit-conflict'), { state: 'resolved_high', conflicts: [], matchedRestaurantId: place.id });
  await writeFile(file, JSON.stringify(result));
  const rejected = run('check-place-source-resolution.mjs', 1);
  assert.match(rejected.stdout, /resolved_with_civic_number_conflict:explicit-conflict/);
  byId.get('explicit-conflict').resolutionBasis = 'reviewed_candidate_override';
  await writeFile(file, JSON.stringify(result));
  assert.match(run('check-place-source-resolution.mjs', 1).stdout, /resolved_with_civic_number_conflict:explicit-conflict/,
    'A fabricated review flag is not an accepted candidate-scoped review');
  console.log('Directory civic identity regression passed: explicit conflicts held, reviewed decisions preserved, ambiguous numbers not invented, validator fails closed.');
} finally {
  await rm(root, { recursive: true, force: true });
}
