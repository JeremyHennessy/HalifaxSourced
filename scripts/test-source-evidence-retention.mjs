import assert from "node:assert/strict";
import { retainFailedSourceRecords, retainOpeningLeadsWithinLookback } from "./lib/source-evidence-retention.mjs";

const priorDirectory = [
  { id: "held-a", sourceId: "held", observedAt: "2026-09-01T00:00:00.000Z" },
  { id: "held-b", sourceId: "held", observedAt: "2026-09-02T00:00:00.000Z" },
  { id: "healthy-old", sourceId: "healthy", observedAt: "2026-09-03T00:00:00.000Z" }
];
const directory = retainFailedSourceRecords({
  previousRecords: priorDirectory,
  currentRecords: [{ id: "held-a", sourceId: "held", observedAt: "2026-10-24T00:00:00.000Z" }, { id: "healthy-new", sourceId: "healthy" }],
  failures: [{ sourceId: "held", reason: "source_access_hold" }],
  protectedRecordIds: ["healthy-old"]
});
assert.deepEqual(directory.records.map((row) => row.id), ["held-a", "healthy-new", "held-b", "healthy-old"]);
assert.deepEqual(directory.retentions, [{
  sourceId: "held", retainedCount: 1, latestRetainedObservation: "2026-09-02T00:00:00.000Z", reasons: ["source_access_hold"]
}]);
assert.equal(directory.retainedReviewedCount, 1);

const unprotected = retainFailedSourceRecords({ previousRecords: priorDirectory, currentRecords: [], failures: [] });
assert.deepEqual(unprotected.records, [], "Successful sources may retire records that are not referenced by reviewed evidence");

const cutoff = Date.parse("2026-07-01T00:00:00.000Z");
const openings = retainOpeningLeadsWithinLookback({
  previousLeads: [
    { id: "still-current", publishedAt: "2026-08-01T00:00:00.000Z" },
    { id: "expired", publishedAt: "2026-06-01T00:00:00.000Z" },
    { id: "refreshed", publishedAt: "2026-08-02T00:00:00.000Z", observedAt: "old" }
  ],
  currentLeads: [{ id: "new", publishedAt: "2026-10-01T00:00:00.000Z" }, { id: "refreshed", publishedAt: "2026-08-02T00:00:00.000Z", observedAt: "fresh" }],
  cutoff
});
assert.deepEqual(openings.leads.map((row) => row.id), ["new", "refreshed", "still-current"]);
assert.equal(openings.leads.find((row) => row.id === "refreshed").observedAt, "fresh");
assert.deepEqual(openings.retained.map((row) => row.id), ["still-current"]);

assert.throws(() => retainOpeningLeadsWithinLookback({ cutoff: Number.NaN }), /finite cutoff/);
console.log("Source evidence retention tests passed: failed directory sources and within-lookback opening leads retain prior successful evidence.");
