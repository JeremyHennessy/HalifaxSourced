import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyReviewedEventQuarantines, eventRecordSha256, validateReviewedEventQuarantine } from './lib/reviewed-event-quarantine.mjs';
import { preservePublishedEventIds } from './lib/canonical-event-dedupe.mjs';
import { reconcileFutureEventLosses } from './lib/event-refresh-safety.mjs';

const archive = JSON.parse(await readFile(new URL('../data/quarantine/city-event-lifecycle-20261028.json', import.meta.url), 'utf8'));
const current = JSON.parse(await readFile(new URL('../data/build/city-events.json', import.meta.url), 'utf8'));
const reviewed = archive.records.map(entry => entry.rawAcceptedRecord);
assert.equal(validateReviewedEventQuarantine(archive).size, 5);
assert.equal(reviewed.length, 5);
for (const entry of archive.records) assert.equal(eventRecordSha256(entry.rawAcceptedRecord), entry.expectedRawRecordCanonicalSha256);

const projection = applyReviewedEventQuarantines(reviewed, [archive]);
assert.equal(projection.blocked, false);
assert.equal(projection.events.length, 0);
assert.equal(projection.receipt.quarantinedCount, 5);
assert.deepEqual(projection.receipt.quarantinedBySource, {
  'halifax-public-libraries': 2,
  'bedford-library-events': 3
});
const changed = { ...reviewed[0], title: reviewed[0].title + ' changed' };
const mismatch = applyReviewedEventQuarantines([changed], [archive]);
assert.equal(mismatch.blocked, true);
assert.deepEqual(mismatch.events, [changed]);
assert.equal(mismatch.receipt.mismatchCount, 1);

const previousCarleton = current.events.find(event => event.id === 'the-carleton-2d6665b8890674d0');
assert(previousCarleton);
const freshCarleton = {
  ...previousCarleton,
  id: 'the-carleton-b0bd3f0b147abd21',
  title: 'SOLD OUT: AfterWords Literary Festival – Dodge City: In Conversation',
  observedAt: '2026-10-28T13:05:13.909Z',
  duplicateEventIds: []
};
const migrated = preservePublishedEventIds([freshCarleton], [previousCarleton]);
assert.equal(migrated[0].id, previousCarleton.id);
assert.equal(migrated[0].title, freshCarleton.title);
assert.equal(migrated[0].observedAt, freshCarleton.observedAt);
assert(migrated[0].duplicateEventIds.includes(freshCarleton.id));
for (const distinct of [
  { ...freshCarleton, sourceId: 'different-source' },
  { ...freshCarleton, startAt: '2026-11-01T21:00:00.000Z' },
  { ...freshCarleton, eventUrl: 'https://www.thecarleton.ca/events/different/' }
]) assert.equal(preservePublishedEventIds([distinct], [previousCarleton])[0].id, distinct.id);

const refreshed = reconcileFutureEventLosses({
  events: [freshCarleton],
  sourceStats: [
    { sourceId: 'the-carleton', status: 'ok', eventCount: 10 },
    { sourceId: 'halifax-public-libraries', status: 'ok', eventCount: 1197 },
    { sourceId: 'bedford-library-events', status: 'ok', eventCount: 89 }
  ]
}, { events: [...reviewed, previousCarleton] }, {
  now: Date.parse('2026-10-28T13:07:03.862Z'),
  reviewedQuarantine: [archive]
});
assert.equal(refreshed.blocked, false);
assert.equal(refreshed.heldRemovals.length, 0);
assert.equal(refreshed.payload.events.length, 1);
assert.equal(refreshed.payload.events[0].id, previousCarleton.id);
assert.equal(refreshed.reviewedQuarantine.previous.quarantinedCount, 5);

const unexpected = { ...reviewed[1], id: 'unreviewed-future-omission' };
const held = reconcileFutureEventLosses({ events: [], sourceStats: [{ sourceId: unexpected.sourceId, status: 'ok', eventCount: 1 }] }, { events: [unexpected] }, {
  now: Date.parse('2026-10-28T13:07:03.862Z'),
  reviewedQuarantine: [archive]
});
assert.equal(held.blocked, true);
assert.equal(held.heldRemovals[0].eventId, unexpected.id);

console.log('Reviewed event lifecycle passed: five exact lifecycle exclusions, immutable raw evidence, one-to-one Carleton title-status identity migration, and unrelated omissions still fail closed.');
