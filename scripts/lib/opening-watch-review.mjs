const reviewedExclusions = Object.freeze([
  Object.freeze({
    sourceName: "Halifax ReTales",
    sourceUrl: "https://halifax.retales.ca/2026/10/krave-closes-spring-garden-location/",
    name: "Lee Valley",
    decision: "reviewed_non_restaurant",
    observedAt: "2026-10-27T16:08:48.501Z",
    evidenceUrl: "https://www.leevalley.com/",
    evidence: "The source describes a Lee Valley Christmas pop-up. Lee Valley's official site identifies the business as a tools retailer, not a restaurant."
  }),
  Object.freeze({
    sourceName: "Halifax ReTales",
    sourceUrl: "https://halifax.retales.ca/2026/11/ins/",
    name: "Anejo",
    decision: "reviewed_non_local_chain",
    observedAt: "2026-11-20T13:21:08Z",
    evidenceUrl: "https://www.anejo.ca/en/faq.html",
    evidence: "Anejo's official FAQ identifies the brand as part of the Recipe Unlimited family and lists seven existing locations outside Nova Scotia. The proposed Halifax outlet is therefore outside the local-independent catalog policy."
  }),
  Object.freeze({
    sourceName: "Halifax ReTales",
    sourceUrl: "https://halifax.retales.ca/2026/11/10033/",
    name: "Domino’s",
    decision: "reviewed_non_local_chain",
    observedAt: "2026-11-20T13:21:08Z",
    evidenceUrl: "https://pizza.dominos.ca/wfpm/",
    evidence: "Domino's official Canadian site identifies the business as a national franchise network with more than 650 Canadian stores and more than 22,000 stores globally. The proposed Sackville outlet is outside the local-independent catalog policy."
  }),
  Object.freeze({
    sourceName: "Halifax ReTales",
    sourceUrl: "https://halifax.retales.ca/2026/11/10033/",
    name: "The soon to open Sackville SPCA",
    decision: "reviewed_non_restaurant",
    observedAt: "2026-11-20T13:21:08Z",
    evidenceUrl: "https://www.novascotiaspca.ca/careers/spca-thrift-store-manager-lower-sackville/",
    evidence: "The Nova Scotia SPCA's official posting identifies the soon-to-open Sackville operation as an SPCA thrift store, not a restaurant."
  }),
  Object.freeze({
    sourceName: "Halifax ReTales",
    sourceUrl: "https://halifax.retales.ca/2026/11/10043/",
    name: "Tartan Coffee",
    decision: "reviewed_existing_catalog_identity",
    observedAt: "2026-11-20T18:59:17.235Z",
    evidenceUrl: "https://www.instagram.com/p/DfBSfUVgoiP/",
    evidence: "The exact 1565 South Park Street venue is already published as the active canonical tartan-coffee-south-park record with the owner's opening announcement and the dated local opening report retained as verified sources. This lead is the same venue, not a new restaurant."
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
