const reviewedExclusions = Object.freeze([
  Object.freeze({
    sourceName: "Halifax ReTales",
    sourceUrl: "https://halifax.retales.ca/2026/10/krave-closes-spring-garden-location/",
    name: "Lee Valley",
    decision: "reviewed_non_restaurant",
    observedAt: "2026-10-27T16:08:48.501Z",
    evidenceUrl: "https://www.leevalley.com/",
    evidence: "The source describes a Lee Valley Christmas pop-up. Lee Valley's official site identifies the business as a tools retailer, not a restaurant."
  })
]);

function normalized(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function openingWatchReviewDecision(lead) {
  return reviewedExclusions.find((record) =>
    normalized(record.sourceName) === normalized(lead?.sourceName) &&
    record.sourceUrl === lead?.sourceUrl &&
    normalized(record.name) === normalized(lead?.name)
  ) ?? null;
}

export function openingWatchReviewedExclusions() {
  return reviewedExclusions.map((record) => ({ ...record }));
}
