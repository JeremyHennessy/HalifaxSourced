import { mkdir, readFile, writeFile } from "node:fs/promises";

async function json(path, fallback = {}) {
  try { return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8")); }
  catch { return fallback; }
}

const coverage = await json("data/build/content-coverage-report.json");
const placeResolution = await json("data/build/place-source-resolutions.json", { resolutions: [], reviewQueue: [] });
const facts = await json("data/build/structured-place-facts.json", { records: [], failures: [] });
const specials = await json("data/build/structured-specials.json", { records: [], orphanSources: [] });
const cityEvents = await json("data/build/city-events.json", { events: [] });
const eventResolution = await json("data/build/event-entity-resolution.json", {});
const firstParty = await json("data/build/first-party-sources.json", { records: [], failures: [] });
const discovery = await json("artifacts/restaurant-discovery-report.json", { failures: [], warnings: [] });
const expanded = await json("artifacts/expanded-source-integrity-report.json", { failures: [], warnings: [] });
const cityIntegrity = await json("artifacts/city-event-integrity-report.json", { failures: [], warnings: [] });
const linkHealth = await json("artifacts/source-link-health-report.json", null);
const eventCandidates = await json("data/event-source-candidates.json", { candidates: [] });

const now = Date.now();
function ageDays(value) {
  const stamp = Date.parse(String(value || ""));
  return Number.isFinite(stamp) ? Math.max(0, (now - stamp) / 86400000) : null;
}
function bucket(value) {
  const age = ageDays(value);
  if (age === null) return "unknown";
  if (age < 7) return "lt7";
  if (age < 30) return "d7_30";
  if (age < 90) return "d30_90";
  return "gt90";
}
function addBucket(target, value) { const key = bucket(value); target[key] = (target[key] || 0) + 1; }
function countBy(items, keyFn) {
  const out = {};
  for (const item of items || []) { const key = keyFn(item); if (key) out[key] = (out[key] || 0) + 1; }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

const freshness = {
  firstPartyRelationships: { lt7: 0, d7_30: 0, d30_90: 0, gt90: 0, unknown: 0 },
  structuredPlaceFacts: { lt7: 0, d7_30: 0, d30_90: 0, gt90: 0, unknown: 0 },
  specials: { lt7: 0, d7_30: 0, d30_90: 0, gt90: 0, unknown: 0 },
  events: { lt7: 0, d7_30: 0, d30_90: 0, gt90: 0, unknown: 0 }
};
for (const record of firstParty.records || []) {
  for (const item of [...(record.socialProfiles || []), ...(record.linkHubs || []), ...(record.relatedLinks || [])]) addBucket(freshness.firstPartyRelationships, item.lastVerifiedAt || item.observedAt || record.lastVerifiedAt || record.observedAt);
}
for (const record of facts.records || []) addBucket(freshness.structuredPlaceFacts, record.lastVerifiedAt || record.observedAt);
for (const record of specials.records || []) addBucket(freshness.specials, record.verifiedAt || record.observedAt);
for (const event of cityEvents.events || []) addBucket(freshness.events, event.lastVerifiedAt || event.observedAt || event.sourceUpdatedAt || cityEvents.generatedAt);

const conflictItems = (placeResolution.reviewQueue || []).filter((item) => String(item.state || "").includes("conflict") || (item.conflicts || []).length);
const nameOnlyItems = (placeResolution.reviewQueue || []).filter((item) => item.state === "name_only_review");
const unresolvedItems = (placeResolution.reviewQueue || []).filter((item) => item.state === "unresolved");
const orphanSpecialSources = Array.isArray(specials.orphanSources) ? specials.orphanSources : [];
const blockedEventSources = (eventCandidates.candidates || []).filter((item) => /blocked/i.test(String(item.status || "")));
const adapterReviewSources = (eventCandidates.candidates || []).filter((item) => /review/i.test(String(item.status || "")));
const sourceFailures = [
  ...(facts.failures || []).map((item) => ({ layer: "structured_place_facts", ...item })),
  ...(firstParty.failures || []).map((item) => ({ layer: "first_party", ...item })),
  ...(discovery.failures || []).map((item) => ({ layer: "restaurant_discovery", ...item })),
  ...(expanded.failures || []).map((item) => ({ layer: "expanded_sources", ...item })),
  ...(cityIntegrity.failures || []).map((item) => ({ layer: "city_events", ...item }))
];

const eventCategories = countBy(cityEvents.events || [], (event) => (event.categories || [event.category]).filter(Boolean)[0] || "Other");
const eventMunicipalities = countBy(cityEvents.events || [], (event) => event.city || "Unknown");
const specialStates = countBy(specials.records || [], (item) => item.status || "unknown");

const report = {
  version: 2,
  generatedAt: new Date().toISOString(),
  coverageReportGeneratedAt: coverage.generatedAt || null,
  summary: {
    canonicalPlaces: coverage.restaurantCoverage?.totalCanonicalPlaces ?? null,
    placesWithSocial: coverage.socialAudit?.placesWithSocial ?? coverage.restaurantCoverage?.withAtLeastOneSocialProfile ?? null,
    structuredPlaceFactRecords: facts.records?.length || 0,
    structuredHours: facts.counts?.hours || 0,
    structuredMenus: facts.counts?.menus || 0,
    structuredReservations: facts.counts?.reservations || 0,
    structuredOrdering: facts.counts?.ordering || 0,
    structuredSpecials: specials.records?.length || 0,
    verifiedCurrentSpecials: specials.verifiedCurrent || 0,
    orphanSpecialSources: orphanSpecialSources.length,
    cityEvents: cityEvents.events?.length || 0,
    venueResolvedEvents: eventResolution.venueResolved || cityEvents.entityResolution?.venueResolved || 0,
    organizerResolvedEvents: eventResolution.organizerResolved || cityEvents.entityResolution?.organizerResolved || 0,
    restaurantLinkedEvents: eventResolution.restaurantResolved || cityEvents.entityResolution?.restaurantResolved || 0,
    sourceFailures: sourceFailures.length,
    unresolvedPlaceCandidates: unresolvedItems.length,
    nameOnlyPlaceReviews: nameOnlyItems.length,
    placeSourceConflicts: conflictItems.length,
    blockedEventSources: blockedEventSources.length,
    eventSourcesInAdapterReview: adapterReviewSources.length,
    brokenUrls: linkHealth?.counts?.broken ?? null,
    restrictedUrls: linkHealth?.counts?.restricted ?? null,
    transientUrlFailures: linkHealth?.counts?.transient ?? null
  },
  freshness,
  reviewQueues: {
    placeConflicts: conflictItems.slice(0, 250),
    nameOnlyMatches: nameOnlyItems.slice(0, 250),
    unresolvedPlaces: unresolvedItems.slice(0, 250),
    orphanSpecialSources: orphanSpecialSources.slice(0, 250),
    blockedEventSources,
    eventSourceAdapterReview: adapterReviewSources
  },
  sourceHealth: {
    failuresByLayer: countBy(sourceFailures, (item) => item.layer),
    failures: sourceFailures.slice(0, 300),
    linkHealth: linkHealth ? {
      generatedAt: linkHealth.generatedAt,
      totalUniqueUrls: linkHealth.totalUniqueUrls,
      checked: linkHealth.counts?.checked || 0,
      ok: linkHealth.counts?.ok || 0,
      broken: linkHealth.counts?.broken || 0,
      restricted: linkHealth.counts?.restricted || 0,
      transient: linkHealth.counts?.transient || 0,
      httpError: linkHealth.counts?.httpError || 0,
      brokenRecords: (linkHealth.broken || []).slice(0, 100)
    } : null
  },
  contentBreakdown: { specialStates, eventCategories, eventMunicipalities },
  knownExternalConstraints: [
    "Facebook/Instagram post-level signals remain API-only and are unavailable when Meta credentials are not configured.",
    "Alderney Landing is documented as a blocked pending event adapter because both its official calendar and tested Tixr fallback return HTTP 403 to GitHub Actions; no bypass is used.",
    "Discover Halifax event/place ingestion requires permission/licensed access or another authorized reusable interface.",
    "Media coverage remains provenance-gated; missing approved rights are not treated as permission to copy images."
  ]
};

await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await mkdir(new URL("../docs", import.meta.url), { recursive: true });
await writeFile(new URL("../data/build/content-quality-report.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
const lines = [
  "# Halifax Sourced content quality report", "", `Generated: ${report.generatedAt}`, "",
  "## Summary", "",
  ...Object.entries(report.summary).map(([key, value]) => `- **${key}**: ${value === null ? "not measured in this run" : value}`), "",
  "## Freshness", "",
  ...Object.entries(freshness).map(([layer, counts]) => `- **${layer}**: <7d ${counts.lt7 || 0}; 7–30d ${counts.d7_30 || 0}; 30–90d ${counts.d30_90 || 0}; >90d ${counts.gt90 || 0}; unknown ${counts.unknown || 0}`), "",
  "## Review queues", "",
  `- Place source conflicts: ${conflictItems.length}`,
  `- Name-only place matches: ${nameOnlyItems.length}`,
  `- Unresolved place candidates: ${unresolvedItems.length}`,
  `- Orphan special-source relationships: ${orphanSpecialSources.length}`,
  `- Blocked event source adapters: ${blockedEventSources.length}`,
  `- Event source adapters under review: ${adapterReviewSources.length}`, "",
  "## External constraints", "", ...report.knownExternalConstraints.map((item) => `- ${item}`), ""
];
await writeFile(new URL("../docs/content-quality-report.md", import.meta.url), lines.join("\n"));
console.log(JSON.stringify(report.summary, null, 2));
