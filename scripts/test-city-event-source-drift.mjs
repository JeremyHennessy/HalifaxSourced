import { reconcileEventSourceDrift } from "./event-source-drift-lib.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }
const now = Date.parse("2026-08-28T18:00:00Z");
const priorEvents = Array.from({ length: 25 }, (_, index) => ({
  id: `tourism-${index}`,
  sourceId: "tourism-ns-events",
  sourceName: "Tourism Nova Scotia Events",
  title: `Tourism Event ${index}`,
  startAt: new Date(now + (index + 1) * 86400000).toISOString(),
  endAt: new Date(now + (index + 1) * 86400000 + 3600000).toISOString(),
  city: "Halifax"
}));
const previous = {
  generatedAt: new Date(now - 6 * 3600000).toISOString(),
  sourceStats: [
    { sourceId: "tourism-ns-events", sourceName: "Tourism Nova Scotia Events", eventCount: 25, status: "ok" },
    { sourceId: "small-seasonal", sourceName: "Small Seasonal", eventCount: 4, status: "ok" }
  ],
  events: [...priorEvents, { id: "small-1", sourceId: "small-seasonal", title: "Old seasonal", startAt: new Date(now + 86400000).toISOString(), endAt: new Date(now + 90000000).toISOString() }]
};
const current = {
  generatedAt: new Date(now).toISOString(),
  sourceStats: [
    { sourceId: "tourism-ns-events", sourceName: "Tourism Nova Scotia Events", eventCount: 0, status: "ok" },
    { sourceId: "small-seasonal", sourceName: "Small Seasonal", eventCount: 0, status: "ok" }
  ],
  events: []
};
const result = reconcileEventSourceDrift(current, previous, { now, minimumPriorCount: 20, maxSnapshotAgeDays: 3, maxCarryDays: 7, futureDays: 400 });
assert(result.anomalies.length === 1, `Expected 1 high-yield anomaly, got ${result.anomalies.length}`);
assert(result.anomalies[0].sourceId === "tourism-ns-events", "Expected Tourism NS anomaly");
assert(result.carried.length === 25, `Expected 25 current/future Tourism events carried, got ${result.carried.length}`);
assert(result.carried.every((event) => event.refreshState === "carried_forward_source_yield_anomaly"), "Carried events must be explicitly labeled");
assert(!result.payload.events.some((event) => event.sourceId === "small-seasonal"), "Small seasonal zero-yield source must not trigger carry-forward");
const stalePrevious = { ...previous, generatedAt: new Date(now - 10 * 86400000).toISOString() };
const stale = reconcileEventSourceDrift(current, stalePrevious, { now, minimumPriorCount: 20, maxSnapshotAgeDays: 3, maxCarryDays: 7 });
assert(stale.carried.length === 0 && stale.skippedReason === "previous_snapshot_outside_grace_window", "Old snapshots must not be carried forward");
const recoveredCurrent = { ...current, sourceStats: [{ sourceId: "tourism-ns-events", sourceName: "Tourism Nova Scotia Events", eventCount: 3, status: "ok" }], events: priorEvents.slice(0, 3) };
const recovered = reconcileEventSourceDrift(recoveredCurrent, previous, { now, minimumPriorCount: 20 });
assert(recovered.anomalies.length === 0 && recovered.carried.length === 0, "Non-zero source yield must not trigger anomaly carry-forward");
console.log("City-event source drift regression passed: high-yield zero drops are bounded and labeled; small/old/non-zero cases are not carried.");
