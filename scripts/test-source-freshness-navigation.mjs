import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { runInNewContext } from 'node:vm';
import { chromium } from 'playwright';
import { installOfflineResources } from './lib/offline-browser-resources.mjs';

function exploreAuditReady(expectedIdentities) {
  // Network idleness can occur between parser-blocking app decorators. Capture
  // only after the document lifecycle and the requested route render complete.
  const sameIds = (records, expected) => {
    const actual = records.map(record => record.id).sort();
    return actual.length === expected.length && actual.every((id, index) => id === expected[index]);
  };
  return document.readyState === 'complete' && location.hash === '#explore?sort=fresh' &&
    typeof state !== 'undefined' && state.sort === 'fresh' && state.page === 1 &&
    state.query === '' && state.cuisine === 'all' && state.neighbourhood === 'all' && state.feature === 'all' &&
    typeof restaurants !== 'undefined' && typeof activeRestaurants !== 'undefined' && typeof PAGE_SIZE !== 'undefined' &&
    sameIds(restaurants, expectedIdentities.canonical) && sameIds(activeRestaurants, expectedIdentities.active) &&
    document.querySelector('#appView #sortFilter')?.value === 'fresh' &&
    document.querySelector('#appView .results-toolbar strong')?.textContent.trim() === `${activeRestaurants.length.toLocaleString()} places found` &&
    document.querySelectorAll('#appView .results-area .restaurant-card h3 a').length === Math.min(PAGE_SIZE, activeRestaurants.length);
}

// Exercise the exact browser predicate without a browser. A partial lifecycle
// must not pass even when a plausible route DOM and populated model are present.
const readinessFixtures = [];
for (const fixture of [
  { name: 'parser-loading-with-rendered-route', readyState: 'loading', expected: false },
  { name: 'parser-interactive-with-rendered-route', readyState: 'interactive', expected: false },
  { name: 'complete-wrong-route', hash: '#home', expected: false },
  { name: 'complete-unrendered-state', state: undefined, expected: false },
  { name: 'complete-wrong-sort-state', state: { sort: 'recommended' }, expected: false },
  { name: 'complete-missing-route-controls', sort: null, expected: false },
  { name: 'complete-pre-decoration-identities', canonical: ['a', 'b'], expected: false },
  { name: 'complete-substituted-canonical-identity', canonical: ['a', 'b', 'other', 'closed'], expected: false },
  { name: 'complete-substituted-active-identity', active: ['a', 'b', 'closed'], expected: false },
  { name: 'complete-stale-route-count', toolbar: '1 places found', expected: false },
  { name: 'complete-partial-route-cards', cardCount: 1, expected: false },
  { name: 'complete-rendered-route', expected: true }
]) {
  const options = { readyState: 'complete', hash: '#explore?sort=fresh', state: { sort: 'fresh', page: 1, query: '', cuisine: 'all', neighbourhood: 'all', feature: 'all' }, canonical: ['a', 'b', 'c', 'closed'], active: ['a', 'b', 'c'], sort: { value: 'fresh' }, toolbar: '3 places found', cardCount: 3, ...fixture };
  const actual = runInNewContext(`(${exploreAuditReady.toString()})(expectedIdentities)`, {
    document: { readyState: options.readyState, querySelector: selector => selector.endsWith('#sortFilter') ? options.sort : { textContent: options.toolbar }, querySelectorAll: () => Array(options.cardCount).fill({}) },
    location: { hash: options.hash }, state: options.state, restaurants: options.canonical.map(id => ({ id })), activeRestaurants: options.active.map(id => ({ id })), PAGE_SIZE: 12,
    expectedIdentities: { canonical: ['a', 'b', 'c', 'closed'], active: ['a', 'b', 'c'] }
  });
  assert.equal(actual, fixture.expected, `Capture readiness: ${fixture.name}`);
  readinessFixtures.push({ name: fixture.name, actual, expected: fixture.expected });
}

const base = (process.env.APP_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
const asOf = process.env.FRESHNESS_AS_OF || new Date().toISOString();
assert(Number.isFinite(Date.parse(asOf)), 'A finite test clock is required');
// Quality UI verifies the immutable release and copies its data before running
// this test. Read its independent catalog, not the browser model under test.
const catalogBytes = await readFile(new URL('../data/build/catalog.json', import.meta.url));
const catalog = JSON.parse(catalogBytes);
const releaseManifest = JSON.parse(await readFile(new URL('../data/build/release-manifest.json', import.meta.url), 'utf8'));
const deploymentMetadata = JSON.parse(await readFile(new URL('../data/build/deployment-metadata.json', import.meta.url), 'utf8'));
const catalogSha256 = createHash('sha256').update(catalogBytes).digest('hex');
assert.equal(catalogSha256, releaseManifest.files['data/build/catalog.json'], 'Identity fixture is the exact validated release catalog');
assert.equal(releaseManifest.sourceCommitSha, deploymentMetadata.sourceCommitSha);
assert.equal(String(releaseManifest.qualityWorkflowRunId), String(deploymentMetadata.qualityWorkflowRunId));
assert.equal(catalog.generatedAt, deploymentMetadata.catalogGeneratedAt);
const inactiveStatuses = new Set(['permanently_closed', 'temporarily_closed', 'seasonally_closed', 'moved', 'replaced']);
const dateParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Halifax', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(asOf)).map(part => [part.type, part.value]));
const today = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
const artifactActive = record => {
  if (inactiveStatuses.has(record.operatingStatus)) return false;
  const end = record.lifecycleSchedule?.seasonEndsOn;
  return !(typeof end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(end) && today > end);
};
const expectedIdentities = { canonical: catalog.restaurants.map(record => record.id).sort(), active: catalog.restaurants.filter(artifactActive).map(record => record.id).sort() };
assert.equal(new Set(expectedIdentities.canonical).size, expectedIdentities.canonical.length, 'Artifact canonical identities are unique');
assert.equal(expectedIdentities.canonical.length, deploymentMetadata.counts.canonicalPlaces);
const identityFixture = { sourceCommitSha: releaseManifest.sourceCommitSha, qualityWorkflowRunId: releaseManifest.qualityWorkflowRunId, catalogSha256, canonicalCount: expectedIdentities.canonical.length, activeCount: expectedIdentities.active.length };
const browser = await chromium.launch({ headless: true });
const receipts = [];

try {
  for (const width of [390, 900, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const resources = await installOfflineResources(context, base);
    await context.addInitScript(asOf => {
      const RealDate = Date;
      window.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [asOf])); }
        static now() { return RealDate.parse(asOf); }
      };
    }, asOf);
    const page = await context.newPage();

    async function saveStage(result) {
      const receipt = { width, ...result };
      receipts.push(receipt);
      await mkdir('artifacts', { recursive: true });
      // Save before assertions: a failed stage must retain its exact delta.
      await writeFile('artifacts/source-freshness-navigation.json', JSON.stringify({ asOf, identityFixture, readinessFixtures, receipts }, null, 2));
      const changed = value => value && typeof value === 'object' &&
        (value.equal === false || value.modelUnchanged === false || value.sourcesUnchanged === false || Object.values(value).some(changed));
      if (changed(result)) {
        const snapshots = await page.evaluate(() => window.__sourceFreshnessAudit.fullSnapshots());
        const path = `artifacts/source-freshness-mutation-${width}-${result.stage}.json.gz`;
        await writeFile(path, gzipSync(JSON.stringify(snapshots)));
        receipt.fullSnapshotArtifact = path;
        await writeFile('artifacts/source-freshness-navigation.json', JSON.stringify({ asOf, identityFixture, readinessFixtures, receipts }, null, 2));
      }
    }

    async function prepareAudit() {
      await page.waitForLoadState('load');
      await page.waitForFunction(exploreAuditReady, expectedIdentities);
      const capture = await page.evaluate(() => {
        // Independently reproduce the report's evidence families, not the
        // implementation helper being tested. Build/import clocks are absent.
        const clock = value => {
          const stamp = typeof value === 'string' ? Date.parse(value) : NaN;
          return Number.isFinite(stamp) && stamp <= Date.now() ? stamp : null;
        };
        const eligible = record => {
          if (!record || record.error || record.reusedObservation === true) return false;
          if (Object.hasOwn(record, 'status') && !['number', 'string'].includes(typeof record.status)) return false;
          const normalizedStatus = typeof record.status === 'string' ? record.status.trim().toLowerCase() : record.status;
          if (typeof record.status === 'number' || typeof normalizedStatus === 'string' && /^[+-]?(?:\d|\.\d)/.test(normalizedStatus)) {
            if (!Number.isInteger(Number(record.status)) || Number(record.status) < 200 || Number(record.status) >= 300) return false;
          }
          if (Object.hasOwn(record, 'attempted') && record.attempted !== true) return false;
          if (Object.hasOwn(record, 'state') && !['ok', 'observed'].includes(record.state)) return false;
          if (Object.hasOwn(record, 'accessHold') || Object.hasOwn(record, 'holdTarget')) return false;
          if (['failed', 'restricted', 'held', 'blocked', 'unattempted', 'not_attempted', 'rejected'].includes(normalizedStatus)) return false;
          return !['failed', 'restricted', 'held', 'blocked', 'rejected'].includes(record.reviewState);
        };
        const official = signal => {
          if (!eligible(signal) || !['number', 'string'].includes(typeof signal.status) || !Number.isInteger(Number(signal.status)) || Number(signal.status) < 200 || Number(signal.status) >= 300) return null;
          return clock(signal.observedAt);
        };
        const rowsFor = (restaurant, rows, fallback) => {
          const associated = (rows || []).filter(row => row.restaurantId === restaurant.id);
          return associated.length ? associated : (fallback ? [fallback] : []);
        };
        const officialForRestaurant = restaurant => {
          const stamps = rowsFor(restaurant, window.HALIFAX_OFFICIAL_SITE_SIGNALS?.results, restaurant.signal)
            .filter(row => row.restaurantId === restaurant.id).map(official).filter(stamp => stamp !== null);
          return stamps.length ? Math.max(...stamps) : null;
        };
        const expected = restaurant => {
          const nested = record => eligible(record) && (!Object.hasOwn(record, 'restaurantId') || record.restaurantId === restaurant.id);
          const values = [
            restaurant.sourceObservedAt,
            nested(restaurant.reviewedPlaceResolution) ? restaurant.reviewedPlaceResolution.observedAt : '',
            nested(restaurant.operatingStatusEvidence) ? restaurant.operatingStatusEvidence.observedAt || restaurant.operatingStatusEvidence.verifiedAt : '',
            ...(restaurant.sources || []).filter(nested).map(source => source.observedAt)
          ].map(clock).filter(value => value !== null);
          for (const firstParty of rowsFor(restaurant, window.HALIFAX_FIRST_PARTY_SOURCES?.records, restaurant.firstPartySources)) {
            if (firstParty.restaurantId === restaurant.id && firstParty.reviewState === 'verified' && eligible(firstParty)) {
              const stamp = clock(firstParty.observedAt);
              if (stamp !== null) values.push(stamp);
            }
          }
          const observation = officialForRestaurant(restaurant);
          if (observation !== null) values.push(observation);
          return values.length ? new Date(Math.max(...values)).toISOString() : '';
        };
        const label = value => value ? new Date(value).toLocaleDateString('en-CA', { timeZone: 'America/Halifax', month: 'short', day: 'numeric' }) : null;
        const raw = () => JSON.stringify(Object.fromEntries(Object.entries(window).filter(([key]) => key.startsWith('HALIFAX_'))));
        const difference = (before, after) => {
          if (before === after) return { equal: true, beforeLength: before.length, afterLength: after.length, changes: [], changeCount: 0 };
          let firstDifferingOffset = 0;
          while (firstDifferingOffset < Math.min(before?.length || 0, after?.length || 0) && before[firstDifferingOffset] === after[firstDifferingOffset]) firstDifferingOffset++;
          const result = { equal: false, beforeType: typeof before, afterType: typeof after, beforeLength: before?.length, afterLength: after?.length, firstDifferingOffset, beforeContext: String(before).slice(Math.max(0, firstDifferingOffset - 80), firstDifferingOffset + 160), afterContext: String(after).slice(Math.max(0, firstDifferingOffset - 80), firstDifferingOffset + 160), changes: [], changeCount: 0 };
          const summarize = value => {
            if (value === undefined) return { type: 'missing' };
            if (value === null || typeof value !== 'object') return typeof value === 'string' && value.length > 500 ? { value: value.slice(0, 500), originalLength: value.length } : value;
            return { type: Array.isArray(value) ? 'array' : 'object', keys: Object.keys(value).slice(0, 20), size: Object.keys(value).length };
          };
          const walk = (left, right, path) => {
            if (Object.is(left, right)) return;
            if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object' && Array.isArray(left) === Array.isArray(right)) {
              for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) walk(left[key], right[key], path + '/' + key.replaceAll('~', '~0').replaceAll('/', '~1'));
              return;
            }
            result.changeCount++;
            if (result.changes.length < 50) result.changes.push({ path, before: summarize(left), after: summarize(right) });
          };
          try { walk(JSON.parse(before), JSON.parse(after), ''); }
          catch (error) { result.parseError = error.message; }
          result.changesTruncated = result.changeCount > result.changes.length;
          return result;
        };
        const modelBefore = JSON.stringify(restaurants);
        const sourcesBefore = raw();
        let capturedSnapshots = null;
        let sampleIndex = 0;
        const snapshotDiagnostics = () => {
          capturedSnapshots = { sampleIndex: ++sampleIndex, modelBefore, modelAfter: JSON.stringify(restaurants), sourcesBefore, sourcesAfter: raw(), storedModelBefore: window.__sourceFreshnessAudit?.modelBefore, storedSourcesBefore: window.__sourceFreshnessAudit?.sourcesBefore };
          return { sampleIndex, model: difference(modelBefore, capturedSnapshots.modelAfter), sources: difference(sourcesBefore, capturedSnapshots.sourcesAfter) };
        };
        // Return the same bytes sampled by the stage, not a later live read
        // after a filesystem await could allow browser activity to advance.
        const fullSnapshots = () => capturedSnapshots;
        const captureMetadata = { href: location.href, readyState: document.readyState, routeSort: document.querySelector('#appView #sortFilter')?.value, renderedCards: document.querySelectorAll('#appView .results-area .restaurant-card h3 a').length, restaurantCount: restaurants.length, activeCount: activeRestaurants.length, capturedAt: new Date().toISOString() };
        window.__sourceFreshnessAudit = { expected, official, officialForRestaurant, label, raw, modelBefore, sourcesBefore, snapshotDiagnostics, fullSnapshots, captureMetadata };
        return { stage: 'capture', ...captureMetadata, diagnostics: snapshotDiagnostics() };
      });
      await saveStage(capture);
      assert.equal(capture.diagnostics.model.equal, true, 'Initial model capture is stable across raw-source enumeration');
      assert.equal(capture.diagnostics.sources.equal, true, 'Initial raw-source capture is stable');
    }

    async function inspectExplore(stage) {
      await page.waitForFunction(() => document.querySelector('#sortFilter')?.value === 'fresh' && location.hash.startsWith('#explore'));
      const result = await page.evaluate(stage => {
        const audit = window.__sourceFreshnessAudit;
        const beforeConsumers = audit.snapshotDiagnostics();
        const expected = activeRestaurants.slice().sort((a, b) => audit.expected(b).localeCompare(audit.expected(a)));
        const afterOracle = audit.snapshotDiagnostics();
        const actual = filteredRestaurants({ query: '', cuisine: 'all', neighbourhood: 'all', feature: 'all', sort: 'fresh' });
        const afterActualSort = audit.snapshotDiagnostics();
        return {
          stage,
          expectedIds: expected.map(record => record.id),
          actualIds: actual.map(record => record.id),
          visibleIds: [...document.querySelectorAll('.results-area .restaurant-card h3 a')].map(link => decodeURIComponent(link.hash.replace('#restaurant/', ''))),
          expectedVisible: expected.slice(0, PAGE_SIZE).map(record => record.id),
          clockDifferences: restaurants.filter(record => restaurantSourceObservationStamp(record) !== audit.expected(record)).map(record => record.id),
          unknown: restaurants.filter(record => !audit.expected(record)).length,
          diagnostics: { capture: audit.captureMetadata, beforeConsumers, afterOracle, afterActualSort, final: audit.snapshotDiagnostics() },
          modelUnchanged: JSON.stringify(restaurants) === audit.modelBefore,
          sourcesUnchanged: audit.raw() === audit.sourcesBefore,
          overflow: document.documentElement.scrollWidth > innerWidth + 1
        };
      }, stage);
      await saveStage(result);
      assert.deepEqual(result.actualIds, result.expectedIds, 'Fresh sort uses the independently qualified latest source clock, with unknown dates last');
      assert.deepEqual(result.visibleIds, result.expectedVisible, 'Rendered Explore cards follow the qualified ordering');
      assert.deepEqual(result.clockDifferences, [], 'Every assembled restaurant follows the same evidence selector');
      assert.equal(result.modelUnchanged, true, 'Ordering never rewrites restaurant objects');
      assert.equal(result.sourcesUnchanged, true, 'Ordering never rewrites raw source clocks');
      assert.equal(result.overflow, false);
    }

    async function inspectHome(stage) {
      await page.waitForFunction(() => location.hash === '#home' && document.querySelector('.home-hero'));
      const result = await page.evaluate(stage => {
        const audit = window.__sourceFreshnessAudit;
        const sourceCandidates = activeRestaurants.filter(record => record.firstPartySources || record.signal || record.officialUpdates?.length);
        const expected = sourceCandidates.sort((a, b) => audit.expected(b).localeCompare(audit.expected(a)) || (b.score || 0) - (a.score || 0)).slice(0, 4);
        const cards = [...document.querySelectorAll('.fresh-data-card')].map(node => ({
          id: decodeURIComponent(node.querySelector('h3 a').hash.replace('#restaurant/', '')),
          label: node.querySelector('.eyebrow').textContent.trim()
        }));
        // Opening/discovery ranking is a separate existing contract, not a
        // source-freshness claim. Qualify only its optional official fallback.
        const openingRank = record => {
          const stamp = audit.officialForRestaurant(record);
          return String(record.freshnessDate || (stamp === null ? '' : new Date(stamp).toISOString()));
        };
        return {
          stage, cards,
          expectedCards: expected.map(record => ({ id: record.id, label: audit.label(audit.expected(record)) || 'Date unavailable' })),
          openingIds: homeOpeningLeads().map(record => record.id),
          expectedOpenings: activeRestaurants.filter(record => record.hasOpening === true).sort((a, b) => openingRank(b).localeCompare(openingRank(a))).slice(0, 4).map(record => record.id),
          diagnostics: audit.snapshotDiagnostics(),
          modelUnchanged: JSON.stringify(restaurants) === audit.modelBefore,
          sourcesUnchanged: audit.raw() === audit.sourcesBefore,
          overflow: document.documentElement.scrollWidth > innerWidth + 1
        };
      }, stage);
      await saveStage(result);
      assert.deepEqual(result.cards, result.expectedCards, 'Home dates/order use actual observations, not failure/import clocks');
      assert.deepEqual(result.openingIds, result.expectedOpenings, 'Preserve opening discovery ranking/eligibility while qualifying its optional official fallback');
      assert.equal(result.modelUnchanged, true);
      assert.equal(result.sourcesUnchanged, true);
      assert.equal(result.overflow, false);
    }

    await page.goto(`${base}/#explore?sort=fresh`, { waitUntil: 'networkidle' });
    await prepareAudit();
    await inspectExplore('initial');
    await page.evaluate(() => { location.hash = '#home'; });
    await inspectHome('home');
    await page.goBack();
    await inspectExplore('back');
    await page.goForward();
    await inspectHome('forward');
    await page.evaluate(() => { location.hash = '#explore?sort=fresh'; });
    await inspectExplore('return');
    await page.reload({ waitUntil: 'networkidle' });
    await prepareAudit();
    await inspectExplore('reload');

    const fixtureResults = await page.evaluate(() => {
      const CorpusDate = Date;
      const fixtureAsOf = '2026-10-26T00:00:00.000Z';
      window.Date = class extends CorpusDate {
        constructor(...args) { super(...(args.length ? args : [fixtureAsOf])); }
        static now() { return CorpusDate.parse(fixtureAsOf); }
      };
      try {
        const audit = window.__sourceFreshnessAudit;
        const recent = new Date(Date.now() - 86400000).toISOString();
        const old = new Date(Date.now() - 180 * 86400000).toISOString();
        const future = new Date(Date.now() + 86400000).toISOString();
        const root = { id: 'freshness-fixture', name: 'Freshness fixture', website: 'https://fixture.example/', sources: [], freshnessDate: recent, relatedLinks: [], socialProfiles: [], officialUpdates: [] };
        const signal = { restaurantId: root.id, website: root.website, sourceKind: 'official_website', status: 200, observedAt: old };
        if (restaurants.some(record => record.id === root.id) || officialObservationRowsById.has(root.id) || firstPartyObservationRowsById.has(root.id)) throw new Error('Synthetic hostile identity collides with published observations');
        const reviewStamp = '2026-10-25T22:35:00.000Z', newerSuccess = '2026-10-25T23:00:00.000Z';
        const retainedQueenStamp = '2026-09-04T13:33:35.848Z';
        const dharma = { ...root, name: 'Dharma Sushi frozen fixture', signal: { ...signal, status: 503, error: 'robots_unavailable', observedAt: recent } };
        const queen = { ...root, name: 'Queen Street Sushi frozen fixture', reviewedCorrection: { observedAt: '2026-08-29', reviewedAt: reviewStamp }, firstPartySources: { restaurantId: root.id, reviewState: 'verified', observedAt: retainedQueenStamp, lastVerifiedAt: reviewStamp } };
        const fixtures = [
          { name: 'frozen-dharma-failure-undated', record: dharma, expected: '' },
          { name: 'frozen-dharma-new-success', record: { ...dharma, signal: { ...signal, observedAt: newerSuccess } }, expected: newerSuccess },
          { name: 'frozen-queen-review-does-not-restamp', record: queen, expected: retainedQueenStamp },
          { name: 'frozen-queen-genuine-success-at-review-instant', record: { ...queen, signal: { ...signal, observedAt: reviewStamp } }, expected: reviewStamp },
          { name: 'frozen-queen-newer-success', record: { ...queen, signal: { ...signal, observedAt: newerSuccess } }, expected: newerSuccess },
          { name: 'failed-only', record: { ...root, signal: { ...signal, error: 'timeout', observedAt: recent } }, expected: '' },
          { name: 'held-root', record: { ...root, signal: { ...signal, attempted: false, state: 'held', observedAt: recent } }, expected: '' },
          { name: 'future-only', record: { ...root, signal: { ...signal, observedAt: future } }, expected: '' },
          { name: 'redirect-not-content', record: { ...root, signal: { ...signal, status: 301, observedAt: recent } }, expected: '' },
          { name: 'fractional-status', record: { ...root, signal: { ...signal, status: 200.5, observedAt: recent } }, expected: '' },
          { name: 'array-status', record: { ...root, signal: { ...signal, status: [200], observedAt: recent } }, expected: '' },
          { name: 'malformed-only', record: { ...root, signal: { ...signal, observedAt: 'not-a-date' } }, expected: '' },
          { name: 'missing-only', record: { ...root, signal: { ...signal, observedAt: null } }, expected: '' },
          { name: 'import-only', record: { ...root }, expected: '' },
          { name: 'failed-preserves-independent', record: { ...root, sourceObservedAt: old, signal: { ...signal, error: 'timeout', observedAt: recent } }, expected: old },
          { name: 'successful-prior-latest-held', record: { ...root, signal: { ...signal, latestAssessment: { attempted: false, state: 'held', error: 'source_access_hold', assessedAt: recent, observedAt: null } } }, expected: old },
          { name: 'failed-nested-source', record: { ...root, sources: [{ status: 'verified', observedAt: old }, { status: 'failed', observedAt: recent }] }, expected: old },
          { name: 'restricted-nested-source', record: { ...root, sources: [{ status: 'verified', observedAt: old }, { reviewState: 'restricted', observedAt: recent }] }, expected: old },
          { name: 'spaced-http-failure-source', record: { ...root, sources: [{ status: 'verified', observedAt: old }, { status: ' 404', observedAt: recent }] }, expected: old },
          { name: 'spaced-named-failure-source', record: { ...root, sources: [{ status: 'verified', observedAt: old }, { status: ' FAILED ', observedAt: recent }] }, expected: old },
          { name: 'array-status-source', record: { ...root, sources: [{ status: 'verified', observedAt: old }, { status: [200], observedAt: recent }] }, expected: old },
          { name: 'object-status-source', record: { ...root, sources: [{ status: 'verified', observedAt: old }, { status: {}, observedAt: recent }] }, expected: old },
          { name: 'foreign-nested-source', record: { ...root, sources: [{ status: 'verified', observedAt: old }, { restaurantId: 'another-place', status: 'verified', observedAt: recent }] }, expected: old },
          { name: 'foreign-nested-resolution', record: { ...root, sources: [{ status: 'verified', observedAt: old }], reviewedPlaceResolution: { restaurantId: 'another-place', observedAt: recent } }, expected: old },
          { name: 'foreign-nested-lifecycle', record: { ...root, sources: [{ status: 'verified', observedAt: old }], operatingStatusEvidence: { restaurantId: 'another-place', verifiedAt: recent } }, expected: old },
          { name: 'rejected-nested-resolution', record: { ...root, sources: [{ status: 'verified', observedAt: old }], reviewedPlaceResolution: { restaurantId: root.id, reviewState: 'rejected', observedAt: recent } }, expected: old },
          { name: 'held-nested-lifecycle', record: { ...root, sources: [{ status: 'verified', observedAt: old }], operatingStatusEvidence: { restaurantId: root.id, status: 'held', observedAt: recent } }, expected: old },
          { name: 'newer-accepted-source', record: { ...root, sources: [{ observedAt: recent }], signal }, expected: recent },
          { name: 'first-party-original-clock', record: { ...root, firstPartySources: { restaurantId: root.id, reviewState: 'verified', observedAt: old, lastVerifiedAt: recent } }, expected: old }
        ];
        const before = JSON.stringify(fixtures);
        const results = fixtures.map(({ name, record, expected }) => {
          const card = document.createElement('div');
          card.innerHTML = freshSourceCard(record);
          const event = document.createElement('div');
          event.innerHTML = eventSourceCard({ restaurant: record, credibleLinks: [{ label: 'Official event information', url: root.website }], curatedEvents: [] });
          const officialStamp = audit.officialForRestaurant(record);
          return {
            name, expected, oracle: audit.expected(record),
            actual: restaurantSourceObservationStamp(record),
            repeated: restaurantSourceObservationStamp(record),
            homeStamp: sourceFreshnessStamp(record),
            homeLabel: card.querySelector('.eyebrow').textContent.trim(),
            expectedHomeLabel: audit.label(expected),
            eventDate: event.querySelector('.event-date strong').textContent.trim(),
            eventLabel: event.querySelector('.event-date span').textContent.trim(),
            expectedEventDate: officialStamp === null ? 'SOURCE' : audit.label(new Date(officialStamp).toISOString())
          };
        });
        return { fixtureAsOf, results, diagnostics: audit.snapshotDiagnostics(), fixturesUnchanged: JSON.stringify(fixtures) === before, modelUnchanged: JSON.stringify(restaurants) === audit.modelBefore, sourcesUnchanged: audit.raw() === audit.sourcesBefore };
      } finally { window.Date = CorpusDate; }
    });
    assert.equal(await page.evaluate(() => Date.now()), Date.parse(asOf), 'Frozen hostile clock is restored before returning to the live corpus');
    await saveStage({ stage: 'hostile-clock-fixtures', ...fixtureResults });
    for (const result of fixtureResults.results) {
      assert.equal(result.actual, result.expected, result.name);
      assert.equal(result.oracle, result.expected, result.name + ': independent qualified-evidence oracle');
      assert.equal(result.repeated, result.expected, result.name + ': repeated selector');
      assert.equal(result.homeStamp, result.expected, result.name + ': Home uses same clock');
      if (result.expectedHomeLabel) assert.equal(result.homeLabel, result.expectedHomeLabel, result.name + ': original date preserved');
      else assert(/unknown|undated|unavailable|source/i.test(result.homeLabel) && !/recent|\b(?:Jan|Dec)\b/i.test(result.homeLabel), result.name + ': missing dates are neutral, never recent/epoch');
      assert.equal(result.eventDate, result.expectedEventDate, result.name + ': event date is the qualifying official observation, not another evidence family');
      assert.equal(result.eventLabel, result.expectedEventDate === 'SOURCE' ? 'UNDATED' : 'OBSERVED', result.name + ': a failed attempt is not a checked source');
    }
    assert.equal(fixtureResults.fixturesUnchanged, true);
    assert.equal(fixtureResults.modelUnchanged, true);
    assert.equal(fixtureResults.sourcesUnchanged, true);

    const duplicateResults = await page.evaluate(() => {
      const CorpusDate = Date;
      const fixtureAsOf = '2026-10-26T00:00:00.000Z';
      window.Date = class extends CorpusDate {
        constructor(...args) { super(...(args.length ? args : [fixtureAsOf])); }
        static now() { return CorpusDate.parse(fixtureAsOf); }
      };
      try {
        const audit = window.__sourceFreshnessAudit;
        const id = 'source-freshness-duplicate-fixture';
        const controlId = 'source-freshness-order-control';
        if (restaurants.some(record => [id, controlId].includes(record.id))) throw new Error('Synthetic freshness identity collides with published data');
        const stamp = days => new Date(Date.now() - days * 86400000).toISOString();
        const old = stamp(120), successful = stamp(60), independent = stamp(30), attempted = stamp(1);
        const baseRecord = { id, name: 'Duplicate observations fixture', website: 'https://fixture.example/', sources: [], relatedLinks: [], socialProfiles: [], officialUpdates: [] };
        const success = { restaurantId: id, website: baseRecord.website, sourceKind: 'official_website', status: 200, observedAt: successful };
        const failure = { restaurantId: id, website: baseRecord.website, error: 'timeout', observedAt: attempted };
        const earlierFirstParty = { restaurantId: id, reviewState: 'verified', observedAt: old };
        const laterFirstParty = { restaurantId: id, reviewState: 'verified', observedAt: independent };
        const control = { ...baseRecord, id: controlId, name: 'Older independent source fixture', sourceObservedAt: stamp(90), signal: { ...success, restaurantId: controlId, observedAt: stamp(90) } };
        const originalActive = activeRestaurants.slice();
        const officialHad = officialObservationRowsById.has(id), officialBefore = officialObservationRowsById.get(id);
        const firstPartyHad = firstPartyObservationRowsById.has(id), firstPartyBefore = firstPartyObservationRowsById.get(id);
        const mapsBefore = JSON.stringify([[...officialObservationRowsById], [...firstPartyObservationRowsById]]);
        const results = [];
        try {
          for (const reverse of [false, true]) {
            for (const withFirstParty of [false, true]) {
              const officialRows = reverse ? [failure, success] : [success, failure];
              const firstPartyRows = reverse ? [laterFirstParty, earlierFirstParty] : [earlierFirstParty, laterFirstParty];
              officialObservationRowsById.set(id, officialRows);
              if (withFirstParty) firstPartyObservationRowsById.set(id, firstPartyRows);
              else firstPartyObservationRowsById.delete(id);
              // Match the legacy model's lossy last-official/first-discovery
              // projections. Consumers must still retain every eligible receipt.
              const record = { ...baseRecord, signal: officialRows.at(-1), firstPartySources: withFirstParty ? firstPartyRows[0] : null };
              const inputBefore = JSON.stringify({ record, officialRows, firstPartyRows, control });
              activeRestaurants.splice(0, activeRestaurants.length, control, record);
              const expected = withFirstParty ? independent : successful;
              const card = document.createElement('div');
              card.innerHTML = freshSourceCard(record);
              const event = document.createElement('div');
              event.innerHTML = eventSourceCard({ restaurant: record, credibleLinks: [{ label: 'Official events', url: record.website }], curatedEvents: [] });
              const home = document.createElement('div');
              home.innerHTML = homeRichSections();
              results.push({
                reverse, withFirstParty, expected, expectedOfficial: successful,
                actual: restaurantSourceObservationStamp(record),
                official: officialSourceObservationStamp(record),
                homeStamp: sourceFreshnessStamp(record),
                homeLabel: card.querySelector('.eyebrow').textContent.trim(),
                expectedHomeLabel: audit.label(expected),
                eventDate: event.querySelector('.event-date strong').textContent.trim(),
                eventLabel: event.querySelector('.event-date span').textContent.trim(),
                expectedEventDate: audit.label(successful),
                sortedIds: filteredRestaurants({ query: '', cuisine: 'all', neighbourhood: 'all', feature: 'all', sort: 'fresh' }).map(item => item.id),
                homeIds: [...home.querySelectorAll('.fresh-data-card h3 a')].map(link => decodeURIComponent(link.hash.replace('#restaurant/', ''))),
                expectedIds: [id, controlId],
                inputsUnchanged: JSON.stringify({ record, officialRows, firstPartyRows, control }) === inputBefore
              });
            }
          }
        } finally {
          activeRestaurants.splice(0, activeRestaurants.length, ...originalActive);
          if (officialHad) officialObservationRowsById.set(id, officialBefore); else officialObservationRowsById.delete(id);
          if (firstPartyHad) firstPartyObservationRowsById.set(id, firstPartyBefore); else firstPartyObservationRowsById.delete(id);
        }
        return {
          fixtureAsOf, results,
          diagnostics: audit.snapshotDiagnostics(),
          mapsUnchanged: JSON.stringify([[...officialObservationRowsById], [...firstPartyObservationRowsById]]) === mapsBefore,
          activeUnchanged: activeRestaurants.length === originalActive.length && activeRestaurants.every((record, index) => record === originalActive[index]),
          modelUnchanged: JSON.stringify(restaurants) === audit.modelBefore,
          sourcesUnchanged: audit.raw() === audit.sourcesBefore
        };
      } finally { window.Date = CorpusDate; }
    });
    assert.equal(await page.evaluate(() => Date.now()), Date.parse(asOf), 'Frozen duplicate clock is restored before returning to the live corpus');
    await saveStage({ stage: 'duplicate-observation-consumers', ...duplicateResults });
    for (const result of duplicateResults.results) {
      assert.equal(result.actual, result.expected, 'All duplicate rows contribute independently of raw model selection/order');
      assert.equal(result.official, result.expectedOfficial, 'Later failed attempt does not erase genuine official success');
      assert.equal(result.homeStamp, result.expected);
      assert.equal(result.homeLabel, result.expectedHomeLabel);
      assert.equal(result.eventDate, result.expectedEventDate, 'Event label retains its own source observation, not the newer discovery receipt');
      assert.equal(result.eventLabel, 'OBSERVED');
      assert.deepEqual(result.sortedIds, result.expectedIds, 'Actual Explore consumer uses grouped observations');
      assert.deepEqual(result.homeIds, result.expectedIds, 'Actual Home source cards use grouped observations');
      assert.equal(result.inputsUnchanged, true);
    }
    for (const key of ['mapsUnchanged', 'activeUnchanged', 'modelUnchanged', 'sourcesUnchanged']) assert.equal(duplicateResults[key], true, key);
    resources.assertClean();
    await mkdir('artifacts', { recursive: true });
    await page.screenshot({ path: `artifacts/source-freshness-${width}.png`, fullPage: true });
    await context.close();
  }
} finally { await browser.close(); }

await writeFile('artifacts/source-freshness-navigation.json', JSON.stringify({ asOf, identityFixture, readinessFixtures, receipts }, null, 2));
console.log(`Source freshness passed ${receipts.length} responsive/history/reload/fixture checks; raw data unchanged and external sources not contacted.`);
