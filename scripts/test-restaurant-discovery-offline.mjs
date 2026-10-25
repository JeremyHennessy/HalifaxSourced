import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// Run real decoders and projections, never a directory/review/opening collector.
// Copy an explicit dependency closure, not the checked-in stale build outputs.
const repository = fileURLToPath(new URL('../', import.meta.url));
const runtimeFiles = [
  'scripts/test-dartmouth-directory-names.mjs', 'scripts/refine-dartmouth-directory.mjs',
  'scripts/test-taste-ns-member-api.mjs', 'scripts/lib/taste-ns-member-api.mjs',
  'scripts/build-discovered-restaurants.mjs', 'scripts/export-catalog.mjs',
  'scripts/resolve-place-candidates.mjs', 'scripts/check-place-source-resolution.mjs',
  'scripts/lib/place-address-identity.mjs',
  'scripts/check-restaurant-discovery.mjs', 'scripts/lib/deny-source-network.mjs',
  'scripts/lib/reviewed-corrections.mjs', 'scripts/lib/local-restaurant-policy.mjs',
  'restaurant-corrections.js', 'app-restaurant-identity.js', 'app-inspection-matching.js'
];
const inputFiles = [
  'data/discovery-overrides.json', 'data/place-source-registry.json',
  'data/directory-restaurant-leads.js', 'data/build/directory-restaurant-leads.json',
  'data/opening-watch-leads.js', 'data/build/opening-watch-leads.json',
  'data/restaurants.js', 'data/osm-restaurants.js', 'data/ns-food-inspections.js',
  'data/discovery-source-supplements.js', 'data/reviewed-restaurant-corrections.js',
  'data/reviewed-place-resolutions.js', 'data/build/official-site-signals.json'
];
const commands = [
  'test-dartmouth-directory-names.mjs', 'test-taste-ns-member-api.mjs',
  'build-discovered-restaurants.mjs', 'export-catalog.mjs',
  'resolve-place-candidates.mjs', 'check-place-source-resolution.mjs',
  'check-restaurant-discovery.mjs'
];
const outputFiles = [
  'data/discovered-restaurants.js', 'data/build/discovered-restaurants.json',
  'data/build/catalog.json', 'data/build/place-source-resolutions.json',
  'artifacts/place-source-resolution-report.json', 'artifacts/restaurant-discovery-report.json'
];
const clock = '2026-10-22T12:00:00.000Z'; // Test clock only; never a production expiry override.
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
async function manifest(directory, files) {
  return Object.fromEntries(await Promise.all(files.map(async file => [file, digest(await readFile(join(directory, file)))])));
}
async function json(directory, file) { return JSON.parse(await readFile(join(directory, file), 'utf8')); }
async function windowValue(directory, file, key) {
  const context = { window: {} };
  vm.runInNewContext(await readFile(join(directory, file), 'utf8'), context, { timeout: 20_000 });
  return plain(context.window[key]);
}
const root = await mkdtemp(join(tmpdir(), 'halifax-restaurant-offline-'));
try {
  const fixtureGuard = join(root, 'fixture-guard.mjs');
  await writeFile(fixtureGuard, `
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [${JSON.stringify(clock)}])); }
  static now() { return RealDate.parse(${JSON.stringify(clock)}); }
};
let attempts = 0;
function deny() { attempts++; throw new Error('Subprocesses are forbidden inside offline discovery commands'); }
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[name] = deny;
syncBuiltinESMExports();
process.on('exit', () => { if (attempts) { console.error('Blocked subprocess attempts: ' + attempts); process.exitCode = 1; } });
`);
  const run = (directory, args, expected = 0) => {
    const result = spawnSync(process.execPath, [
      '--import', join(directory, 'scripts/lib/deny-source-network.mjs'), '--import', fixtureGuard, ...args
    ], { cwd: directory, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, NODE_OPTIONS: '', TZ: 'UTC', GITHUB_EVENT_NAME: 'pull_request' } });
    assert.equal(result.status, expected, `${args.join(' ')}: ${result.error || ''}\n${result.stdout}\n${result.stderr}`);
    return result;
  };
  const sourceBefore = await manifest(repository, [...runtimeFiles, ...inputFiles, 'data/discovered-restaurants.js', 'data/build/discovered-restaurants.json']);
  const approved = (await json(repository, 'data/discovery-overrides.json')).approved;
  const directoryInput = await json(repository, 'data/build/directory-restaurant-leads.json');
  const openingInput = await json(repository, 'data/build/opening-watch-leads.json');
  assert.deepEqual(await windowValue(repository, 'data/directory-restaurant-leads.js', 'HALIFAX_DIRECTORY_RESTAURANT_LEADS'), directoryInput,
    'Accepted directory JS/JSON pair must agree; offline validation must not fetch a replacement');
  assert.deepEqual(await windowValue(repository, 'data/opening-watch-leads.js', 'HALIFAX_OPENING_WATCH_LEADS'), openingInput,
    'Accepted opening-watch JS/JSON pair must agree');
  assert.deepEqual(await windowValue(repository, 'data/discovered-restaurants.js', 'HALIFAX_DISCOVERED_RESTAURANTS'),
    (await json(repository, 'data/build/discovered-restaurants.json')).restaurants, 'Accepted discovery JS/JSON pair must agree');
  const outputs = [];
  for (const attempt of [1, 2]) {
    const directory = join(root, 'run-' + attempt);
    for (const file of [...runtimeFiles, ...inputFiles]) {
      await mkdir(dirname(join(directory, file)), { recursive: true });
      await copyFile(join(repository, file), join(directory, file));
    }
    const before = await manifest(directory, [...runtimeFiles, ...inputFiles]);
    // Demonstrate the actual prerequisite failure, rather than silently using a
    // stale committed catalog or treating a swallowed missing input as success.
    const missing = run(directory, ['scripts/resolve-place-candidates.mjs'], 1);
    assert.match(missing.stderr, /ENOENT.*catalog\.json/s);
    for (const command of commands) run(directory, ['scripts/' + command]);
    const discovery = await json(directory, 'data/build/discovered-restaurants.json');
    const resolutions = await json(directory, 'data/build/place-source-resolutions.json');
    const catalog = await json(directory, 'data/build/catalog.json');
    const resolutionReport = await json(directory, 'artifacts/place-source-resolution-report.json');
    const discoveryReport = await json(directory, 'artifacts/restaurant-discovery-report.json');
    assert.deepEqual(discovery.restaurants.map(row => row.id), approved.map(row => row.id), 'Only explicit approved overrides become discovery listings');
    assert.equal(discovery.count, approved.length);
    assert.equal(resolutions.candidateCount, directoryInput.records.length);
    assert.deepEqual(resolutions.resolutions.map(row => row.candidateId), directoryInput.records.map(row => row.id));
    assert.equal(resolutions.directoryGeneratedAt, directoryInput.generatedAt, 'Resolution cannot refresh source observation time');
    const reviewedCandidates = (await windowValue(directory, 'data/reviewed-place-resolutions.js', 'HALIFAX_REVIEWED_PLACE_RESOLUTIONS')).records
      .filter(row => row.candidateId && row.restaurantId
        && directoryInput.records.some(candidate => candidate.id === row.candidateId)
        && catalog.restaurants.some(restaurant => restaurant.id === row.restaurantId));
    assert(reviewedCandidates.length > 0, 'Accepted inputs must exercise candidate-scoped reviewed resolutions');
    for (const reviewed of reviewedCandidates) {
      const resolved = resolutions.resolutions.find(row => row.candidateId === reviewed.candidateId);
      assert.equal(resolved?.matchedRestaurantId, reviewed.restaurantId, `Reviewed candidate must resolve to ${reviewed.restaurantId}`);
      assert.equal(resolved?.resolutionBasis, 'reviewed_candidate_override');
      assert.equal(resolved?.reviewState, 'resolved-by-reviewed-candidate');
      assert.deepEqual(resolved?.conflicts, [], 'A completed reviewed resolution supersedes stale directory conflicts');
      assert(resolved?.state.startsWith('resolved_'));
      assert(!resolutions.reviewQueue.some(row => row.candidateId === reviewed.candidateId), 'Reviewed candidate must leave the review queue');
    }
    assert.equal(resolutionReport.directoryCandidates, directoryInput.records.length);
    assert.deepEqual(resolutionReport.errors, []);
    assert.deepEqual(discoveryReport.failures, []);
    assert.equal(discoveryReport.counts.directoryRecords, directoryInput.records.length);
    assert.equal(discoveryReport.counts.openingWatchLeads, openingInput.leads.length);
    assert.equal(discoveryReport.counts.discoveredRestaurants, approved.length);
    assert.deepEqual(await windowValue(directory, 'data/discovered-restaurants.js', 'HALIFAX_DISCOVERED_RESTAURANTS'), discovery.restaurants);
    assert.deepEqual(await manifest(directory, [...runtimeFiles, ...inputFiles]), before, 'Projections must preserve every accepted input byte');
    outputs.push(await manifest(directory, outputFiles));
    // Negative controls prove that even caught transport/subprocess attempts
    // fail the very same runner used for each accepted-input command above.
    for (const expression of [
      "await fetch('https://fixture.invalid/')",
      "(await import('node:http')).get('http://fixture.invalid/')",
      "(await import('node:https')).request('https://fixture.invalid/')",
      "(await import('node:net')).connect(443, 'fixture.invalid')",
      "(await import('node:child_process')).spawnSync('curl', ['https://fixture.invalid/'])"
    ]) {
      const result = run(directory, ['--input-type=module', '-e', `try { ${expression}; } catch {}`], 1);
      assert.match(result.stderr, /blocked 1 network attempt|Blocked subprocess attempts: 1/);
    }
  }
  assert.deepEqual(outputs[0], outputs[1], 'Same-clock offline projections must produce identical output bytes');
  assert.deepEqual(await manifest(repository, Object.keys(sourceBefore)), sourceBefore, 'Never rebuild in the source checkout');
  console.log(`Restaurant offline discovery passed: ${commands.length} commands twice; ${directoryInput.records.length} directory candidates, ${openingInput.leads.length} opening leads, ${approved.length} approved listings; exact accepted inputs preserved, deterministic output, no transport or subprocess attempts in production commands.`);
} finally {
  await rm(root, { recursive: true, force: true });
}
