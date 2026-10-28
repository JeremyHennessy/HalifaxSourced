import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reconcileFutureEventLosses } from "./lib/event-refresh-safety.mjs";

const now = Date.parse("2026-10-20T15:00:00.000Z");
const event = {
  id: "accepted", title: "Accepted future concert",
  sourceId: "venue", sourceName: "Official venue",
  sourceUrl: "https://venue.example/events/", eventUrl: "https://venue.example/event/concert",
  venueName: "Halifax venue", city: "Halifax", categories: ["Music"],
  startAt: "2026-11-01T22:00:00.000Z", endAt: "2026-11-01T23:00:00.000Z",
  observedAt: "2026-09-01T12:00:00.000Z",
  sourceEvidence: [{ sourceUrl: "https://venue.example/event/concert", observedAt: "2026-09-01T12:00:00.000Z", basis: "official_primary" }]
};
const previous = { generatedAt: "2026-09-01T12:00:00.000Z", events: [event] };
const failed = { generatedAt: "2026-10-20T15:00:00.000Z", events: [], sourceStats: [{ sourceId: "venue", status: "failed", eventCount: 0, reason: "http_403", observedAt: "2026-10-20T14:59:59.000Z" }], failures: [{ sourceId: "venue", reason: "http_403" }] };
const options = { now };
const before = JSON.stringify(previous);
const retained = reconcileFutureEventLosses(failed, previous, options);
assert.equal(retained.blocked, false);
assert.equal(retained.retained.length, 1, "Small sources and old accepted snapshots are protected, too");
assert.equal(retained.payload.events[0].observedAt, event.observedAt);
assert.deepEqual(retained.payload.events[0].sourceEvidence, event.sourceEvidence);
assert.equal(retained.payload.events[0].refreshState, "retained_after_source_failure");
assert.equal(retained.payload.sourceStats[0].status, "failed");
assert.equal(retained.payload.sourceStats[0].eventCount, 0, "Retained records do not count as fresh yield");
assert.equal(retained.payload.sourceStats[0].retainedEventCount, 1);
assert.equal(JSON.stringify(previous), before, "Input and accepted evidence are immutable");
const again = reconcileFutureEventLosses(failed, retained.payload, { now: now + 86400000 });
assert.equal(again.retained[0].observedAt, event.observedAt);
assert.equal(again.retained[0].retainedAt, retained.retained[0].retainedAt);
const failureWithoutTimestamp = { ...failed, sourceStats: [{ sourceId: "venue", status: "failed", eventCount: 0 }], failures: [{ sourceId: "venue", reason: "timeout" }] };
assert.equal(reconcileFutureEventLosses(failureWithoutTimestamp, previous, options).retained[0].sourceFailure.attemptedAt, null, "Snapshot and reconciliation clocks must not invent a source-attempt timestamp");
const failureWithTimestamp = { ...failureWithoutTimestamp, failures: [{ sourceId: "venue", reason: "timeout", observedAt: "2026-10-20T14:45:00.000Z" }] };
assert.equal(reconcileFutureEventLosses(failureWithTimestamp, previous, options).retained[0].sourceFailure.attemptedAt, "2026-10-20T14:45:00.000Z");

const partial = { ...failed, failures: [], events: [{ ...event, id: "other", title: "Another event", eventUrl: "https://venue.example/event/another" }], sourceStats: [{ sourceId: "venue", status: "ok", eventCount: 1 }] };
const held = reconcileFutureEventLosses(partial, previous, options);
assert.equal(held.blocked, true);
assert.equal(held.retained.length, 0, "Success must not silently relabel omitted events as retained");
assert.equal(held.heldRemovals[0].reason, "successful_source_omitted_future_event");
assert.equal(reconcileFutureEventLosses({ events: [] }, previous, options).heldRemovals[0].reason, "missing_or_uncertain_source_status");
assert.equal(reconcileFutureEventLosses({ ...partial, events: [event] }, previous, options).blocked, false);
assert.equal(reconcileFutureEventLosses({ ...partial, events: [{ ...event, id: "replacement", duplicateEventIds: [event.id] }] }, previous, options).blocked, false);
assert.equal(reconcileFutureEventLosses({ ...partial, events: [{ ...event, id: "replacement", title: "Corrected title", supersedesEventIds: [event.id] }] }, previous, options).blocked, false);
assert.equal(reconcileFutureEventLosses({ ...partial, events: [{ ...event, status: "cancelled" }] }, previous, options).retained.length, 0);
const retimed = { ...event, id: "retimed", startAt: "2026-11-01T23:30:00.000Z", endAt: "2026-11-02T01:00:00.000Z" };
assert.equal(reconcileFutureEventLosses({ ...partial, events: [retimed] }, previous, options).blocked, true, "Disjoint same-day times need explicit replacement evidence");
const overlapping = { ...event, id: "corrected", startAt: "2026-11-01T22:30:00.000Z", endAt: "2026-11-01T23:30:00.000Z" };
assert.equal(reconcileFutureEventLosses({ ...partial, events: [overlapping] }, previous, options).blocked, false);
const recurrence = { ...event, id: "next-week", startAt: "2026-11-08T22:00:00.000Z", endAt: "2026-11-08T23:00:00.000Z" };
assert.equal(reconcileFutureEventLosses({ ...partial, events: [recurrence] }, previous, options).blocked, true, "Another occurrence on a shared URL must not hide a lost event");
assert.equal(reconcileFutureEventLosses({ ...partial, events: [{ ...retimed, venueName: "Different venue" }] }, previous, options).blocked, true);
assert.equal(reconcileFutureEventLosses({ ...partial, events: [{ ...overlapping, eventUrl: "bad-current-url" }] }, { ...previous, events: [{ ...event, eventUrl: "bad-previous-url" }] }, options).blocked, true, "Invalid URLs must not establish replacement identity");
assert.equal(reconcileFutureEventLosses({ ...partial, failures: failed.failures }, previous, options).blocked, true, "A stale failure must not override an explicit successful source status");
const matinee = { ...event, id: "matinee", startAt: "2026-11-01T18:00:00.000Z", endAt: "2026-11-01T20:00:00.000Z" };
const evening = { ...event, id: "evening", startAt: "2026-11-01T23:00:00.000Z", endAt: "2026-11-02T01:00:00.000Z" };
const missingMatinee = reconcileFutureEventLosses({ ...partial, events: [evening] }, { ...previous, events: [matinee, evening] }, options);
assert.equal(missingMatinee.blocked, true);
assert.equal(missingMatinee.heldRemovals[0].eventId, "matinee");
const broadReplacement = { ...event, id: "broad", startAt: matinee.startAt, endAt: evening.endAt };
assert.equal(reconcileFutureEventLosses({ ...partial, events: [broadReplacement] }, { ...previous, events: [matinee, evening] }, options).heldRemovals.length, 2, "One broad listing cannot silently cover multiple accepted occurrences");

const game = { ...event, title: "Halifax Mooseheads vs Chicoutimi", venueId: "scotiabank-centre-halifax" };
assert.equal(reconcileFutureEventLosses({ ...partial, events: [{ ...game, id: "alias", title: "Halifax Mooseheads vs Chicoutimi Sagueneens" }] }, { ...previous, events: [game] }, options).blocked, false);
const ignored = [
  { ...event, id: "expired", startAt: "2026-10-01T12:00:00.000Z", endAt: "2026-10-01T13:00:00.000Z" },
  { ...event, id: "cancelled", eventStatus: "https://schema.org/EventCancelled" },
  { ...event, id: "superseded", reviewState: "superseded" },
  { ...event, id: "scheduled-but-superseded", eventStatus: "https://schema.org/EventScheduled", reviewState: "superseded" },
  { ...event, id: "scheduled-but-withdrawn", eventStatus: "https://schema.org/EventScheduled", status: "withdrawn" },
  { ...event, id: "scheduled-but-cancelled", eventStatus: "https://schema.org/EventScheduled", status: "scheduled", cancelled: true },
  { ...event, id: "backwards", endAt: "2026-10-31T12:00:00.000Z" },
  { ...event, id: "invalid-day", startAt: "2026-02-30T12:00:00.000Z" },
  { ...event, id: "future-observation", observedAt: "2027-10-20T15:00:00.000Z" },
  { ...event, id: "outside-horizon", startAt: "2028-11-01T22:00:00.000Z", endAt: "2028-11-01T23:00:00.000Z" }
];
const skipped = reconcileFutureEventLosses(failed, { ...previous, events: ignored }, options);
assert.equal(skipped.retained.length, 0);
assert.equal(skipped.blocked, false);
assert.equal(skipped.ignoredPrevious.length, ignored.length);
const ongoing = reconcileFutureEventLosses(failed, { ...previous, events: [{ ...event, startAt: "2026-09-11T12:00:00.000Z", endAt: "2026-12-09T12:00:00.000Z" }] }, options);
assert.equal(ongoing.retained.length, 0, "Do not revive possibly malformed stretched date ranges");
assert.equal(ongoing.heldRemovals[0].reason, "missing_ongoing_event_requires_review");

// CI regression: library events ending earlier today must not become held
// future losses merely because the dataset retains a six-hour past grace.
const ciNow = Date.parse("2026-10-20T15:41:29.000Z");
const recentlyEnded = [
  { ...event, id: "ended-one-hour-ago", startAt: "2026-10-20T13:41:29.000Z", endAt: "2026-10-20T14:41:29.000Z" },
  { ...event, id: "babys-first-books", startAt: "2026-10-20T13:30:00.000Z", endAt: "2026-10-20T14:30:00.000Z" },
  { ...event, id: "shake-rattle-read", startAt: "2026-10-20T13:15:00.000Z", endAt: "2026-10-20T14:15:00.000Z" }
];
for (const source of [failed, { ...partial, events: [] }]) {
  const expired = reconcileFutureEventLosses(source, { ...previous, events: recentlyEnded }, { now: ciNow });
  assert.equal(expired.blocked, false);
  assert.equal(expired.retained.length, 0, "Already-ended events must not return after source failure");
  assert.equal(expired.ignoredPrevious.length, recentlyEnded.length);
  assert.ok(expired.ignoredPrevious.every(item => item.reason === "expired_previous_event"));
  const stillRunning = { ...event, id: "ongoing-today", startAt: "2026-10-20T08:00:00.000Z", endAt: "2026-10-20T16:00:00.000Z" };
  const protectedOngoing = reconcileFutureEventLosses(source, { ...previous, events: [stillRunning] }, { now: ciNow });
  assert.equal(protectedOngoing.blocked, true, "True ongoing omissions must still require review");
  assert.equal(protectedOngoing.heldRemovals[0].reason, "missing_ongoing_event_requires_review");
}
assert.equal(reconcileFutureEventLosses({ ...partial, events: [] }, previous, { now: ciNow }).blocked, true, "True future omissions remain held");
assert.equal(reconcileFutureEventLosses(failed, previous, { now: ciNow }).retained.length, 1, "Failed-source future retention remains intact");
const endingNow = { ...event, startAt: "2026-10-20T15:00:00.000Z", endAt: "2026-10-20T15:41:29.000Z" };
assert.equal(reconcileFutureEventLosses({ ...partial, events: [] }, { ...previous, events: [endingNow] }, { now: ciNow }).blocked, true, "Expiry is strictly before the guard clock");
const dateOnly = { ...event, startAt: "2026-10-20", endAt: "2026-10-20" };
assert.equal(reconcileFutureEventLosses({ ...partial, events: [] }, { ...previous, events: [dateOnly] }, { now: Date.parse("2026-10-21T02:59:00.000Z") }).blocked, true, "Date-only events remain protected until their Halifax day ends");
assert.equal(reconcileFutureEventLosses({ ...partial, events: [] }, { ...previous, events: [dateOnly] }, { now: Date.parse("2026-10-21T03:00:00.000Z") }).ignoredPrevious[0].reason, "expired_previous_event");

// Integration: failed closed means a review receipt is written but neither
// generated candidate file is overwritten by the reconciliation step.
const root = await mkdtemp(join(tmpdir(), "halifax-event-safety-"));
try {
  await mkdir(join(root, "scripts", "lib"), { recursive: true });
  await mkdir(join(root, "data", "build"), { recursive: true });
  await mkdir(join(root, "data", "quarantine"), { recursive: true });
  for (const path of ["scripts/reconcile-city-event-source-drift.mjs", "scripts/lib/event-refresh-safety.mjs", "scripts/lib/canonical-event-dedupe.mjs", "scripts/lib/reviewed-event-quarantine.mjs", "data/quarantine/library-store-navigation-20261027.json"]) {
    await copyFile(new URL("../" + path, import.meta.url), join(root, path));
  }
  const actualNow = Date.now();
  const future = { ...event, startAt: new Date(actualNow + 86400000).toISOString(), endAt: new Date(actualNow + 90000000).toISOString(), observedAt: new Date(actualNow - 86400000).toISOString() };
  const previousPath = join(root, "previous.json");
  await writeFile(previousPath, JSON.stringify({ ...previous, events: [future] }));
  const currentPath = join(root, "data", "build", "city-events.json");
  const jsPath = join(root, "data", "city-events.js");
  const currentBytes = JSON.stringify({ ...partial, events: [] });
  await writeFile(currentPath, currentBytes);
  await writeFile(jsPath, "// candidate unchanged");
  const run = () => spawnSync(process.execPath, [join(root, "scripts", "reconcile-city-event-source-drift.mjs"), previousPath], { encoding: "utf8" });
  const blocked = run();
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /held for removal review/);
  assert.equal(await readFile(currentPath, "utf8"), currentBytes);
  assert.equal(await readFile(jsPath, "utf8"), "// candidate unchanged");
  const report = JSON.parse(await readFile(join(root, "artifacts", "city-event-source-drift-report.json"), "utf8"));
  assert.equal(report.blocked, true);
  assert.equal(report.heldRemovalCount, 1);
  await writeFile(currentPath, JSON.stringify(failed));
  const allowed = run();
  assert.equal(allowed.status, 0, allowed.stderr);
  const result = JSON.parse(await readFile(currentPath, "utf8"));
  assert.equal(result.events[0].id, future.id);
  assert.equal(result.events[0].observedAt, future.observedAt);
  assert.equal(result.sourceStats[0].status, "failed");
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log("Event refresh safety passed: failed-source retention preserves evidence; partial-success removals fail closed with receipts; cancelled/expired/invalid/superseded records do not return.");
