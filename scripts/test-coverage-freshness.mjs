import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

// Exercise the real offline report builder: an attempted fetch is not evidence
// that the restaurant was successfully observed, even when it has a new clock.
const root = await mkdtemp(join(tmpdir(), 'halifax-coverage-freshness-'));
const asOf = '2026-10-22T00:00:00.000Z';
const recent = '2026-10-21T12:00:00.000Z';
const stale = '2026-01-01T12:00:00.000Z';
try {
  for (const file of ['scripts/build-content-coverage-report.mjs', 'scripts/lib/coverage-values.mjs', 'scripts/lib/action-pointer-coverage.mjs', 'scripts/lib/media-rights-contract.mjs', 'source-integrity.js', 'app-media.js']) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await copyFile(new URL('../' + file, import.meta.url), join(root, file));
  }
  await mkdir(join(root, 'data/build'), { recursive: true });
  const save = (name, value) => writeFile(join(root, 'data/build', name + '.json'), JSON.stringify(value));
  async function check(label, { restaurant = {}, results = [], firstParty = [], bucket, failures = 0 }) {
    await save('catalog', { restaurants: [{ id: 'fixture', name: 'Fixture', website: 'https://fixture.example/', ...restaurant }] });
    await save('official-site-signals', { generatedAt: recent, results: results.map(row => ({ restaurantId: 'fixture', ...row })) });
    await save('first-party-sources', { records: firstParty });
    execFileSync(process.execPath, [join(root, 'scripts/build-content-coverage-report.mjs')], {
      cwd: root, env: { ...process.env, COVERAGE_AS_OF: asOf }, stdio: 'pipe'
    });
    const report = JSON.parse(await readFile(join(root, 'data/build/content-coverage-report.json'), 'utf8'));
    const expected = { lt7Days: 0, days7To30: 0, days30To90: 0, gt90Days: 0, unknown: 0, [bucket]: 1 };
    assert.deepEqual(report.restaurantCoverage.freshness, expected, label);
    assert.equal(report.restaurantCoverage.staleRestaurantRecords, bucket === 'gt90Days' ? 1 : 0, label + ': stale queue');
    assert.equal(report.unresolved.unknownFreshnessRestaurantRecords, bucket === 'unknown' ? 1 : 0, label + ': unknown queue');
    assert.equal(report.sourceFailures.officialWebsiteChecks, failures, label + ': failures remain visible');
  }

  await check('Old accepted evidence remains stale', { restaurant: { sourceObservedAt: stale }, bucket: 'gt90Days' });
  for (const failure of [
    { error: 'timeout' },
    { error: 'robots_disallow', reviewState: 'restricted' },
    { error: 'invalid_url' },
    { status: 200, error: 'not_html' },
    { status: 403, reviewState: 'needs-review' },
    { status: '500', reviewState: 'needs-review' }
  ]) {
    const label = failure.error || 'HTTP ' + failure.status;
    const results = [{ ...failure, observedAt: recent }];
    await check(label + ' cannot refresh older accepted evidence', {
      restaurant: { sourceObservedAt: stale }, results, bucket: 'gt90Days', failures: 1
    });
    await check(label + ' cannot invent an observation', { results, bucket: 'unknown', failures: 1 });
  }
  for (const status of [200, '200']) {
    await check('A successful dated observation refreshes coverage (' + status + ')', {
      restaurant: { sourceObservedAt: stale }, results: [{ status, observedAt: recent }], bucket: 'lt7Days'
    });
  }
  for (const result of [
    { observedAt: recent },
    { status: 200 },
    { status: 200, observedAt: 'not-a-date' },
    { status: 200, observedAt: '2026-10-23T00:00:00.000Z' }
  ]) {
    await check('Malformed or future success cannot invent freshness: ' + JSON.stringify(result), { results: [result], bucket: 'unknown' });
  }
  for (const result of [
    { status: 301, observedAt: recent }, { status: 200.5, observedAt: recent }, { status: [200], observedAt: recent },
    { status: 200, observedAt: recent, attempted: false },
    { status: 200, observedAt: recent, state: 'held' },
    { status: 200, observedAt: recent, accessHold: {} },
    { status: 200, observedAt: recent, reviewState: 'restricted' }
  ]) await check('Contradictory/non-content root cannot invent freshness: ' + JSON.stringify(result), { results: [result], bucket: 'unknown' });
  await check('A genuine prior observation remains stale after a separately held refresh', {
    results: [{ status: 200, observedAt: stale, latestAssessment: { state: 'held', attempted: false, assessedAt: recent, observedAt: null } }], bucket: 'gt90Days'
  });
  await check('Import and verification metadata are not source observations', {
    restaurant: { freshnessDate: recent, generatedAt: recent },
    firstParty: [{ restaurantId: 'fixture', reviewState: 'verified', lastVerifiedAt: recent }], bucket: 'unknown'
  });
  await check('A later failure cannot discard an older successful receipt', {
    results: [{ status: 200, observedAt: stale }, { error: 'timeout', observedAt: recent }], bucket: 'gt90Days', failures: 1
  });
  await check('An invalid or future receipt cannot mask a valid success', {
    results: [{ status: 200, observedAt: recent }, { status: 200, observedAt: 'not-a-date' }, { status: 200, observedAt: '2026-10-23T00:00:00.000Z' }], bucket: 'lt7Days'
  });
  await check('Successful receipts use newest evidence regardless of array order', {
    results: [{ status: 200, observedAt: recent }, { status: 200, observedAt: stale }], bucket: 'lt7Days'
  });
  await check('Failed or foreign nested source clocks cannot refresh a restaurant', {
    restaurant: { sources: [{ status: 'failed', observedAt: recent }, { status: 'restricted', observedAt: recent }, { restaurantId: 'another-place', observedAt: recent }, { status: 'verified', observedAt: stale }] }, bucket: 'gt90Days'
  });
  await check('A failed official check does not erase independent source evidence', {
    restaurant: { sources: [{ observedAt: recent }] }, results: [{ error: 'timeout', observedAt: recent }], bucket: 'lt7Days', failures: 1
  });
  await check('A failed official check does not erase successful discovery evidence', {
    results: [{ error: 'timeout', observedAt: recent }],
    firstParty: [{ restaurantId: 'fixture', reviewState: 'verified', website: 'https://fixture.example/', observedAt: recent }], bucket: 'lt7Days', failures: 1
  });
  console.log('Coverage freshness passed: failed attempts preserve stale/unknown evidence, successful clocks qualify, invalid/future clocks do not, and failures remain visible.');
} finally {
  await rm(root, { recursive: true, force: true });
}
