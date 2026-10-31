import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parsePier21Records } from "./research/pier21-parser-prototype.mjs";

// Factual sample is limited to fields supplied in the authorized offline task context.
// Remaining records use synthetic titles and values; they are not scraped page fixtures.
const records = [
  {
    title: "My Food Journey: Chef Pamela A. Leonforde",
    dateText: "November 15, 2026",
    timeText: "6:00 PM",
    statusText: "Rescheduled",
    locationNames: [],
    sourceUrl: "https://pier21.ca/events-programs/my-food-journey-chef-pamela-a-leonforde"
  },
  {
    title: "Synthetic Film Fixture",
    dateText: "November 8, 2026",
    timeText: "11:00 AM – 8:00 PM",
    locationNames: ["Pier 21"],
    addressExplicit: true,
    address: "1055 Marginal Road, Halifax, NS",
    cost: "$12",
    sourceUrl: "https://pier21.ca/events"
  },
  {
    title: "Synthetic Trivia Fixture",
    dateText: "November 12, 2026",
    timeText: "7:00 PM – 9:00 PM",
    locationNames: ["Pier 21", "Garrison"],
    addressExplicit: false,
    address: "1055 Marginal Road, Halifax, NS",
    sourceUrl: "https://pier21.ca/events"
  },
  {
    title: "Synthetic Cancelled Fundraiser Fixture",
    dateText: "November 20, 2026",
    timeText: "6:00 PM – 8:00 PM",
    statusText: "Cancelled",
    locationNames: [],
    sourceUrl: "https://pier21.ca/events"
  },
  {
    title: "Synthetic recurrence-only workshop",
    dateText: "",
    timeText: "2:00 PM – 3:00 PM",
    recurrenceText: "Twice monthly, year-round",
    sourceUrl: "https://pier21.ca/events"
  },
  {
    title: "Synthetic ambiguous date fixture",
    dateText: "11/08/2026",
    timeText: "11:00 AM – 1:00 PM",
    sourceUrl: "https://pier21.ca/events"
  },
  {
    title: "Synthetic Film Fixture",
    dateText: "2026-11-08",
    timeText: "11:00 AM – 8:00 PM",
    locationNames: ["Pier 21"],
    addressExplicit: true,
    address: "1055 Marginal Road, Halifax, NS",
    cost: "$12",
    sourceUrl: "https://pier21.ca/events"
  }
];

globalThis.fetch = () => { throw new Error("offline parser must never fetch"); };
const result = parsePier21Records(records);
assert.equal(result.events.length, 4, "dated unique records survive; recurrence and ambiguous date do not");
assert.equal(result.rejected.find(item => item.reason === "undated_recurrence")?.sourceUrl, "https://pier21.ca/events");
assert.equal(result.rejected.find(item => item.reason === "ambiguous_or_unsupported_date")?.sourceUrl, "https://pier21.ca/events");
assert.equal(result.rejected.find(item => item.reason === "duplicate_identity")?.sourceUrl, "https://pier21.ca/events");

const rescheduled = result.events.find(event => event.title === "My Food Journey: Chef Pamela A. Leonforde");
assert.equal(rescheduled.startAt, "2026-11-15T22:00:00.000Z", "Halifax uses UTC-4 after fall DST transition");
assert.equal(rescheduled.endAt, null, "an absent end time remains unknown");
assert.equal(rescheduled.status, "rescheduled");
assert.equal(rescheduled.sourceUrl, "https://pier21.ca/events-programs/my-food-journey-chef-pamela-a-leonforde");
assert.deepEqual(rescheduled.provenance.observedFields, ["title", "dateText", "timeText", "sourceUrl", "statusText"]);

const film = result.events.find(event => event.title === "Synthetic Film Fixture");
assert.equal(film.startAt, "2026-11-08T15:00:00.000Z");
assert.equal(film.endAt, "2026-11-09T00:00:00.000Z", "explicit end is retained without inventing an end for other events");
assert.equal(film.address, "1055 Marginal Road, Halifax, NS", "address is retained only when the fixture marks it explicit");

const trivia = result.events.find(event => event.title === "Synthetic Trivia Fixture");
assert.deepEqual(trivia.locationNames, ["Garrison", "Pier 21"], "all explicit venues remain available in normalized-key order");
assert.equal(trivia.venueName, null, "multiple venues are not silently collapsed");
assert.equal(trivia.address, null, "venue address is not borrowed for an ambiguous venue");

const cancelled = result.events.find(event => event.title === "Synthetic Cancelled Fundraiser Fixture");
assert.equal(cancelled.status, "cancelled");

const unknown = parsePier21Records([{
  title: "Synthetic postponed fixture", dateText: "November 21, 2026", timeText: "1:00 PM",
  statusText: "Postponed / TBC", sourceUrl: "https://pier21.ca/events"
}]).events[0];
assert.equal(unknown.status, "unknown", "unrecognized status must not be inferred as scheduled");
assert.equal(unknown.statusLabel, "Postponed / TBC", "retain bounded source status text for review");

const daylight = parsePier21Records([{
  title: "Synthetic summer time fixture", dateText: "August 10, 2026", timeText: "6:00 PM",
  sourceUrl: "https://pier21.ca/events"
}]);
assert.equal(daylight.events[0].startAt, "2026-08-10T21:00:00.000Z", "Halifax uses UTC-3 during daylight time");

const fold = parsePier21Records([{
  title: "Synthetic fall-back fold fixture", dateText: "November 1, 2026", timeText: "1:30 AM",
  sourceUrl: "https://pier21.ca/events"
}]);
assert.equal(fold.events.length, 0, "the repeated Halifax fall-back wall time is ambiguous");
assert.equal(fold.rejected[0].reason, "ambiguous_local_time");

const gap = parsePier21Records([{
  title: "Synthetic spring-forward gap fixture", dateText: "March 8, 2026", timeText: "2:30 AM",
  sourceUrl: "https://pier21.ca/events"
}]);
assert.equal(gap.events.length, 0, "the skipped Halifax spring-forward wall time does not exist");
assert.equal(gap.rejected[0].reason, "nonexistent_local_time");

const same = parsePier21Records([records[1], { ...records[1], sourceUrl: "https://pier21.ca/events?view=alternate" }]);
assert.equal(same.events.length, 2, "a meaningful query can identify a distinct source page");
const trackingDuplicates = parsePier21Records([
  { ...records[1], sourceUrl: "https://pier21.ca/events?utm_source=mail#film" },
  { ...records[1], sourceUrl: "https://pier21.ca/events#another-fragment" }
]);
assert.equal(trackingDuplicates.events.length, 1);
assert.equal(trackingDuplicates.rejected[0].reason, "duplicate_identity", "known tracking and fragments do not change source identity");
assert.deepEqual(trackingDuplicates.events[0].sourceUrls, ["https://pier21.ca/events"]);

assert.equal(parsePier21Records([{ ...records[1], sourceUrl: "https://pier21.ca:8443/events" }]).events.length, 0, "nondefault HTTPS ports are not official source URLs");

const locationsA = parsePier21Records([{
  title: "Synthetic normalized venue fixture", dateText: "November 23, 2026", timeText: "1:00 PM",
  locationNames: ["  Píer  21 ", "Pier21", "!!!", "GARRISON"], sourceUrl: "https://pier21.ca/events"
}]);
const locationsB = parsePier21Records([{
  title: "Synthetic normalized venue fixture", dateText: "November 23, 2026", timeText: "1:00 PM",
  locationNames: ["garrison", "pier 21"], sourceUrl: "https://pier21.ca/events"
}]);
assert.equal(locationsA.events[0].id, locationsB.events[0].id, "venue case, accents, whitespace, ordering, and empty-normalized labels do not change identity");
assert.equal(locationsA.events[0].venueName, null, "two normalized venues remain ambiguous");
assert.equal(locationsA.events[0].locationNames.length, 2, "duplicate venue keys collapse while retaining display names");
const emptyLocation = parsePier21Records([{
  title: "Synthetic empty venue fixture", dateText: "November 23, 2026", timeText: "1:00 PM",
  locationNames: ["!!!", "   "], sourceUrl: "https://pier21.ca/events"
}]);
assert.deepEqual(emptyLocation.events[0].locationNames, []);

const samePageMultiDate = parsePier21Records([
  { title: "Synthetic series fixture", dateText: "November 24, 2026", timeText: "1:00 PM", statusText: "Scheduled", sourceUrl: "https://pier21.ca/events?series=1" },
  { title: "Synthetic series fixture", dateText: "November 25, 2026", timeText: "1:00 PM", statusText: "Rescheduled", sourceUrl: "https://pier21.ca/events?series=1" }
]);
assert.equal(samePageMultiDate.events.length, 2, "same-page dated occurrences stay separate");
assert.equal(samePageMultiDate.events.find(event => event.status === "scheduled")?.status, "scheduled");
assert.equal(samePageMultiDate.events.find(event => event.status === "rescheduled")?.status, "rescheduled");
assert.equal(samePageMultiDate.warnings[0].reason, "same_source_occurrence_relationship_unresolved", "changed date does not imply replacement; emit review warning and retain both");
const sameSourceVenueChange = parsePier21Records([
  { title: "Synthetic venue relationship fixture", dateText: "November 24, 2026", timeText: "1:00 PM", locationNames: ["Pier 21"], sourceUrl: "https://pier21.ca/events?one=1" },
  { title: "Synthetic venue relationship fixture", dateText: "November 24, 2026", timeText: "1:00 PM", locationNames: ["Garrison"], sourceUrl: "https://pier21.ca/events?one=1" }
]);
assert.equal(sameSourceVenueChange.events.length, 2, "venue changes retain distinct candidates");
assert.equal(sameSourceVenueChange.warnings.length, 1, "venue changes on the same source page are flagged for review");
const distinctDetailPages = parsePier21Records([
  { title: "Synthetic detail-page identity fixture", dateText: "November 28, 2026", timeText: "1:00 PM", locationNames: ["Pier 21"], sourceUrl: "https://pier21.ca/events-programs/one" },
  { title: "Synthetic detail-page identity fixture", dateText: "November 28, 2026", timeText: "1:00 PM", locationNames: ["Pier 21"], sourceUrl: "https://pier21.ca/events-programs/two" }
]);
assert.equal(distinctDetailPages.events.length, 2, "distinct official detail pages do not silently collapse");
const hostVariants = parsePier21Records([
  { ...records[1], sourceUrl: "https://pier21.ca/events" },
  { ...records[1], sourceUrl: "https://www.pier21.ca/events" }
]);
assert.equal(hostVariants.events.length, 2, "bare and www hosts remain distinct without verified alias equivalence");

const scheduled = {
  title: "Synthetic conflicting status fixture", dateText: "November 22, 2026", timeText: "1:00 PM",
  statusText: "Scheduled", sourceUrl: "https://pier21.ca/events-programs/synthetic-conflict"
};
const cancelledConflict = { ...scheduled, statusText: "Cancelled" };
const rescheduledConflict = { ...scheduled, statusText: "Rescheduled" };
for (const conflict of [cancelledConflict, rescheduledConflict]) {
  for (const input of [[scheduled, conflict], [conflict, scheduled]]) {
    const quarantined = parsePier21Records(input);
    assert.equal(quarantined.events.length, 0, "conflicting statuses quarantine every record, regardless of input order");
    assert.deepEqual(quarantined.rejected.map(item => item.reason), ["conflicting_duplicate_identity", "conflicting_duplicate_identity"]);
  }
}
for (const input of [[cancelledConflict, rescheduledConflict], [rescheduledConflict, cancelledConflict]]) {
  const quarantined = parsePier21Records(input);
  assert.equal(quarantined.events.length, 0, "cancellation/reschedule conflicts quarantine both records in either order");
  assert.deepEqual(quarantined.rejected.map(item => item.reason), ["conflicting_duplicate_identity", "conflicting_duplicate_identity"]);
}

for (const [field, firstValue, secondValue] of [
  ["cost", "$10", "$1.0"],
  ["address", "10-12 Main Street", "1012 Main Street"]
]) {
  const common = {
    title: `Synthetic punctuation conflict ${field}`, dateText: "November 22, 2026", timeText: "1:00 PM",
    locationNames: ["Pier 21"], addressExplicit: true, sourceUrl: "https://pier21.ca/events-programs/synthetic-punctuation-conflict"
  };
  const left = { ...common, [field]: firstValue };
  const right = { ...common, [field]: secondValue };
  for (const input of [[left, right], [right, left]]) {
    const quarantined = parsePier21Records(input);
    assert.equal(quarantined.events.length, 0, `${field} punctuation differences quarantine conflicting records`);
    assert.deepEqual(quarantined.rejected.map(item => item.reason), ["conflicting_duplicate_identity", "conflicting_duplicate_identity"]);
  }
}

assert.equal(parsePier21Records([{
  title: "Synthetic negated status fixture", dateText: "November 26, 2026", timeText: "1:00 PM",
  statusText: "Not scheduled", sourceUrl: "https://pier21.ca/events"
}]).events[0].status, "unknown", "negated prose does not become scheduled status");

const invalidRecords = parsePier21Records([
  { ...records[1], title: { toString: () => "coerced title" } },
  { ...records[1], title: "!!! / ???" },
  { ...records[1], dateText: 20261108 },
  { ...records[1], locationNames: ["Pier 21", ...Array(8).fill("Other")] },
  Object.assign(Object.create({ title: "inherited" }), records[1])
]);
assert.deepEqual(invalidRecords.rejected.map(item => item.reason), ["invalid_title", "empty_normalized_title", "invalid_dateText", "invalid_location_names", "invalid_record"]);
let coercedSourceUrl = false;
const invalidSourceUrl = parsePier21Records([{
  ...records[1], sourceUrl: { toString() { coercedSourceUrl = true; return "https://pier21.ca/events"; } }
}]);
assert.equal(invalidSourceUrl.rejected[0].reason, "invalid_sourceUrl");
assert.equal(coercedSourceUrl, false, "object source URLs are rejected without coercion");
const oversizedSourceUrl = parsePier21Records([{
  ...records[1], sourceUrl: `https://pier21.ca/${"x".repeat(100_000)}`
}]);
assert.equal(oversizedSourceUrl.rejected[0].reason, "invalid_sourceUrl");
assert.equal(oversizedSourceUrl.rejected[0].sourceUrl, null, "an overlength URL is rejected before parse or diagnostic echo");
assert.throws(() => parsePier21Records(Array(251).fill(records[1])), /at most 250/);

const punctuatedClock = parsePier21Records([{
  title: "Synthetic punctuated clock fixture", dateText: "November 27, 2026",
  timeText: "11:00 a.m. – 8:00 p.m.", sourceUrl: "https://pier21.ca/events"
}]);
assert.equal(punctuatedClock.events.length, 1, "single and range clocks share punctuated meridiem grammar");

const prototype = await readFile(new URL("./research/pier21-parser-prototype.mjs", import.meta.url), "utf8");
assert(!/\bfetch\s*\(|node:fs|event-source-registry|workflow/i.test(prototype), "prototype must remain pure and unregistered");
console.log("Pier 21 offline prototype: bounded fields, status, unknown end, ambiguity, recurrence, DST/timezone, identity and no-fetch boundaries passed.");
