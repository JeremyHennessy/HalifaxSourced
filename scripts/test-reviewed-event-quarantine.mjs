import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { applyReviewedEventQuarantine, eventRecordSha256, REVIEWED_EVENT_QUARANTINE_PATH, REVIEWED_EVENT_QUARANTINE_PATHS, validateReviewedEventQuarantine } from './lib/reviewed-event-quarantine.mjs';
import { reconcileFutureEventLosses } from './lib/event-refresh-safety.mjs';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const archiveBytes = await read(REVIEWED_EVENT_QUARANTINE_PATH);
const archive = JSON.parse(archiveBytes);
const fixture = JSON.parse(await read('scripts/fixtures/library-navigation-drift-20261027.json'));
for (const publishedEvidence of [archiveBytes, JSON.stringify(fixture)]) {
  assert(!/\/tmp\/|\/workspace\/|turn\d+(?:view|search)|[?&](?:sig|X-Amz-Signature)=/i.test(publishedEvidence), 'Published evidence must use project/public provenance, not private working paths or signed links');
}
assert.equal(archive.provenance.acceptedSnapshot.path, 'data/build/city-events.json');
assert.equal(archive.provenance.scheduledRun.id, 40594011703);
const raw = archive.records.map(entry => entry.rawAcceptedRecord);
const rawBefore = JSON.stringify(raw);
assert.equal(raw.length, 89);
assert.equal(archive.activeQuarantineIds.length, 89);
assert.equal(validateReviewedEventQuarantine(archive).size, 89);
assert.equal(new Set(raw.map(event => event.id)).size, 89);
assert.deepEqual(Object.fromEntries(['halifax-public-libraries', 'bedford-library-events'].map(id => [id, raw.filter(event => event.sourceId === id).length])), {
  'halifax-public-libraries': 85, 'bedford-library-events': 4
});
for (const entry of archive.records) {
  assert.equal(entry.expectedRawRecordCanonicalSha256, eventRecordSha256(entry.rawAcceptedRecord));
  assert.equal(entry.expectedRawRecordCanonicalSha256, eventRecordSha256(JSON.parse(JSON.stringify(entry.rawAcceptedRecord))));
  assert.equal(entry.expectedRawRecordCanonicalSha256, eventRecordSha256(Object.fromEntries(Object.entries(entry.rawAcceptedRecord).reverse())));
  assert.equal(entry.rawAcceptedRecord.title, 'Library Store');
  assert.equal(entry.rawAcceptedRecord.eventUrl, 'https://www2.halifaxpubliclibraries.ca/store/');
}
const details = fixture.previousEvents.filter(event => fixture.expectedHeldIds.includes(event.id));
assert.equal(details.length, 6);
assert.deepEqual(archive.protectedDetailIds, fixture.expectedHeldIds);
const projection = applyReviewedEventQuarantine([...raw, ...details], archive);
assert.equal(projection.blocked, false);
assert.equal(projection.receipt.quarantinedCount, 89);
assert.deepEqual(projection.receipt.quarantinedBySource, { 'halifax-public-libraries': 85, 'bedford-library-events': 4 });
assert.deepEqual(projection.events, details, 'All six genuine detail records survive unchanged');
assert.deepEqual(applyReviewedEventQuarantine(projection.events, archive).events, details, 'Repeated application preserves exactly the same active records');
assert.equal(applyReviewedEventQuarantine(projection.events, archive).receipt.quarantinedCount, 0, 'Receipt counts this invocation, not invented removals');
assert.equal(JSON.stringify(raw), rawBefore, 'Archive originals and observation clocks are immutable');
assert.deepEqual(applyReviewedEventQuarantine(raw).events, raw, 'No implicit title, URL or ID exclusion without reviewed decisions');

let negativeGuards = 0;
for (const event of raw) {
  const wrongId = { ...event, id: event.id + '-unreviewed' };
  assert.deepEqual(applyReviewedEventQuarantine([wrongId], archive).events, [wrongId], 'A new ID with matching content is never covered');
  for (const change of [
    { sourceId: 'unreviewed-source' }, { title: 'Genuine event title' }, { eventUrl: 'https://halifax.bibliocommons.com/v2/events/abcdef' },
    { startAt: '2027-10-28T17:00:00.000Z' }, { endAt: '2027-10-28T19:00:00.000Z' }, { observedAt: '2026-10-27T22:00:00.000Z' },
    { sourceKind: 'official_venue_calendar' }, { sourceUrl: 'https://different.example/events' },
    { allDay: !event.allDay }, { duplicateEventIds: ['unreviewed-saved-id'] }, { categories: ['Changed category'] }
  ]) {
    const changed = { ...event, ...change }, before = JSON.stringify(changed);
    const result = applyReviewedEventQuarantine([changed], archive);
    assert.equal(result.blocked, true);
    assert.equal(result.receipt.quarantinedCount, 0);
    assert.equal(result.receipt.mismatchCount, 1);
    assert.deepEqual(result.events, [changed], 'Changed reviewed IDs remain intact and block, never silently disappear');
    assert.equal(JSON.stringify(changed), before);
    negativeGuards++;
  }
}
const restored = { ...archive, activeQuarantineIds: archive.activeQuarantineIds.slice(1) };
assert.deepEqual(applyReviewedEventQuarantine(raw, restored).events, [raw[0]], 'Removing one active decision restores its complete record while retaining all archived originals');
assert.equal(restored.records.length, 89);
for (const corrupt of [
  { ...archive, activeQuarantineIds: [...archive.activeQuarantineIds, archive.activeQuarantineIds[0]] },
  { ...archive, activeQuarantineIds: [...archive.activeQuarantineIds, 'unknown'] },
  { ...archive, protectedDetailIds: [...archive.protectedDetailIds, raw[0].id] },
  { ...archive, rawArchiveRecordCount: 88 },
  { ...archive, records: archive.records.map((entry, index) => index ? entry : { ...entry, rawAcceptedRecord: { ...entry.rawAcceptedRecord, observedAt: archive.decisionReviewedAt } }) }
]) assert.throws(() => applyReviewedEventQuarantine(raw, corrupt), /Invalid/);

const previous = { generatedAt: fixture.previousGeneratedAt, events: [...raw, ...fixture.previousEvents] };
const current = fixture.current;
const now = Date.parse(fixture.now);
const without = reconcileFutureEventLosses(current, previous, { now });
assert.equal(without.heldRemovals.length, 95, 'Audited reduced fixture reproduces all 95 pre-review omissions');
assert.equal(without.retained.length, 24);
const result = reconcileFutureEventLosses(current, previous, { now, reviewedQuarantine: archive });
assert.equal(result.blocked, true, 'Six unresolved genuine omissions still block publication');
assert.equal(result.reviewedQuarantine.previous.quarantinedCount, 89);
assert.deepEqual(result.heldRemovals.map(event => event.eventId), fixture.expectedHeldIds);
assert.deepEqual(result.retained.map(event => event.id), fixture.expectedRetainedIds);
assert.equal(result.retained.length, 24, 'Failed-source protections are unchanged');
for (const event of result.retained) {
  const original = previous.events.find(item => item.id === event.id);
  for (const [key, value] of Object.entries(original).filter(([key]) => key !== 'sourceFailure')) assert.deepEqual(event[key], value, `${event.id}: original ${key} survives failure retention`);
}
assert.deepEqual(result.retained, without.retained, 'Reviewed quarantine does not change any failed-source evidence/retention');
assert.deepEqual(result.heldRemovals, without.heldRemovals.filter(event => !archive.activeQuarantineIds.includes(event.eventId)));
assert.deepEqual(reconcileFutureEventLosses(current, previous, { now, reviewedQuarantine: archive }), result);
const unknown = { ...details[0], id: 'unreviewed-omission' };
assert.equal(reconcileFutureEventLosses(current, { ...previous, events: [...previous.events, unknown] }, { now, reviewedQuarantine: archive }).heldRemovals.length, 7);
const changed = { ...raw[0], title: 'Changed ongoing real event' };
const mismatched = reconcileFutureEventLosses({ events: [changed] }, { events: [changed] }, { now, reviewedQuarantine: archive });
assert(mismatched.blocked, 'A represented but changed reviewed ID also fails closed');
assert.deepEqual(mismatched.payload.events, [changed]);
assert.equal(mismatched.heldRemovals.length, 0);
assert.equal(mismatched.reviewedQuarantine.current.mismatchCount, 1);

// Run both production entry points under transport denial, in a disposable copy.
const root = await mkdtemp(join(tmpdir(), 'halifax-reviewed-quarantine-'));
try {
  for (const path of [
    'scripts/sanitize-city-events.mjs', 'scripts/reconcile-city-event-source-drift.mjs',
    'scripts/lib/reviewed-event-quarantine.mjs', 'scripts/lib/event-refresh-safety.mjs',
    'scripts/lib/canonical-event-dedupe.mjs', 'scripts/lib/deny-source-network.mjs',
    'data/event-source-registry.json', ...REVIEWED_EVENT_QUARANTINE_PATHS
  ]) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await copyFile(new URL('../' + path, import.meta.url), join(root, path));
  }
  await mkdir(join(root, 'data/build'), { recursive: true });
  const buildPath = join(root, 'data/build/city-events.json'), jsPath = join(root, 'data/city-events.js');
  const stamp = JSON.stringify({ generatedAt: fixture.previousGeneratedAt, eventCount: 95, events: [...raw, ...details] });
  const run = (name, args = []) => spawnSync(process.execPath, ['--import', join(root, 'scripts/lib/deny-source-network.mjs'), join(root, 'scripts', name), ...args], { encoding: 'utf8' });
  await writeFile(buildPath, stamp);
  let runResult = run('sanitize-city-events.mjs');
  assert.equal(runResult.status, 0, runResult.stderr);
  const sanitized = JSON.parse(await readFile(buildPath, 'utf8'));
  assert.equal(sanitized.events.length, 1);
  assert.equal(sanitized.scopeAudit.reviewedQuarantine.quarantinedCount, 94);
  for (const event of sanitized.events) {
    const original = details.find(item => item.id === event.id);
    assert(original);
    for (const key of ['id', 'startAt', 'endAt', 'observedAt', 'eventUrl']) assert.equal(event[key], original[key]);
  }
  runResult = run('sanitize-city-events.mjs');
  assert.equal(runResult.status, 0, runResult.stderr);
  assert.deepEqual(JSON.parse(await readFile(buildPath, 'utf8')).events, sanitized.events);
  const context = vm.createContext({ window: {} });
  vm.runInContext(await readFile(jsPath, 'utf8'), context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.window.HALIFAX_CITY_EVENTS.events)), sanitized.events);
  const changedBytes = JSON.stringify({ events: [changed] });
  await writeFile(buildPath, changedBytes);
  await writeFile(jsPath, '// untouched candidate');
  runResult = run('sanitize-city-events.mjs');
  assert.notEqual(runResult.status, 0);
  assert.match(runResult.stderr, /requires re-review/);
  assert.equal(await readFile(buildPath, 'utf8'), changedBytes);
  assert.equal(await readFile(jsPath, 'utf8'), '// untouched candidate');
  assert.equal(JSON.parse(await readFile(join(root, 'artifacts/city-event-quarantine-report.json'), 'utf8')).mismatchCount, 1);
  // Production reconciliation uses real Date.now; a fixed clock preload replays
  // the original audit time without introducing a runtime bypass parameter.
  const clockPath = join(root, 'audit-clock.mjs');
  await writeFile(clockPath, `const NativeDate = Date; globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [${now}])); } static now() { return ${now}; } };`);
  const previousPath = join(root, 'previous.json');
  await writeFile(previousPath, JSON.stringify(previous));
  const currentBytes = JSON.stringify(current);
  await writeFile(buildPath, currentBytes);
  runResult = spawnSync(process.execPath, ['--import', clockPath, '--import', join(root, 'scripts/lib/deny-source-network.mjs'), join(root, 'scripts/reconcile-city-event-source-drift.mjs'), previousPath], { encoding: 'utf8' });
  assert.notEqual(runResult.status, 0);
  assert.match(runResult.stderr, /1 accepted unexpired events disappeared/);
  const report = JSON.parse(await readFile(join(root, 'artifacts/city-event-source-drift-report.json'), 'utf8'));
  assert.equal(report.blocked, true);
  assert.equal(report.heldRemovalCount, 1);
  assert.equal(report.retainedAfterFailureCount, 24);
  assert.equal(report.reviewedQuarantine.previous.quarantinedCount, 94);
  assert.equal(await readFile(buildPath, 'utf8'), currentBytes, 'Blocked diagnostics must not overwrite or promote the candidate');
  assert.equal(await readFile(jsPath, 'utf8'), '// untouched candidate');
  assert.equal(await readFile(join(root, REVIEWED_EVENT_QUARANTINE_PATH), 'utf8'), archiveBytes);
} finally { await rm(root, { recursive: true, force: true }); }
assert.equal(await read(REVIEWED_EVENT_QUARANTINE_PATH), archiveBytes);
console.log(`Reviewed event quarantine passed: 89 exact archived rows, ${negativeGuards} changed-record guards, six genuine records retained, raw round-trip/clocks/restore/idempotence, 95 → 6 held omissions, 24 unchanged failed-source retentions; both offline entry points fail closed with receipts.`);
