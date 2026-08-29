import { mkdir, readFile, writeFile } from "node:fs/promises";
import vm from "node:vm";

async function json(path, fallback = {}) {
  try { return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8")); }
  catch { return fallback; }
}
async function windowData(path) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: path, timeout: 20_000 });
  return context.window;
}
function validUrl(value) { try { return ["http:", "https:"].includes(new URL(String(value ?? "")).protocol); } catch { return false; } }
function hasCoordinates(value) { return Number.isFinite(Number(value?.lat)) && Number.isFinite(Number(value?.lon ?? value?.lng)); }

const catalog = await json("data/build/catalog.json", { restaurants: [] });
const discovered = await json("data/build/discovered-restaurants.json", { restaurants: [] });
const resolutions = await json("data/build/place-source-resolutions.json", { resolutions: [] });
const firstParty = await json("data/build/first-party-sources.json", { records: [] });
const facts = await json("data/build/structured-place-facts.json", { records: [] });
const verifiedPages = await json("data/build/verified-source-pages.json", { menuSources: [] });
const curatedWindow = await windowData("data/restaurants.js");
const reviewedWindow = await windowData("data/reviewed-place-resolutions.js");
const curated = curatedWindow.HALIFAX_RESTAURANTS || [];
const reviewed = reviewedWindow.HALIFAX_REVIEWED_PLACE_RESOLUTIONS?.records || [];
const resolutionByCandidateId = new Map((resolutions.resolutions || []).map((record) => [record.candidateId, record]));
const places = new Map([...(catalog.restaurants || []), ...(discovered.restaurants || []), ...curated].map((place) => [place.id, place]));
const firstPartyById = new Map((firstParty.records || []).map((record) => [record.restaurantId, record]));
const factsById = new Map((facts.records || []).map((record) => [record.restaurantId, record]));
const menuIds = new Set((verifiedPages.menuSources || []).map((record) => record.restaurantId));
for (const record of firstParty.records || []) if ((record.relatedLinks || []).some((link) => link.kind === "menu")) menuIds.add(record.restaurantId);
for (const record of facts.records || []) if ((record.menus || []).length) menuIds.add(record.restaurantId);
for (const record of reviewed) if (validUrl(record.menuUrl)) menuIds.add(record.restaurantId);

const failures = [];
const records = reviewed.map((resolution) => {
  const place = places.get(resolution.restaurantId);
  if (!place) failures.push({ restaurantId: resolution.restaurantId, problem: "canonical_place_missing" });
  if (resolution.reviewState !== "resolved-by-evidence" || !validUrl(resolution.sourceUrl) || !resolution.evidence?.length) failures.push({ restaurantId: resolution.restaurantId, problem: "resolution_evidence_contract_failed" });
  if (resolution.directorySourceId) {
    const candidate = resolutionByCandidateId.get(resolution.candidateId);
    const manualLocationEvidence = resolution.resolutionState === "resolved_high"
      && resolution.evidence?.includes("compatible_street_address")
      && resolution.evidence?.some((item) => item === "exact_official_domain" || item.startsWith("official_location_"));
    if (!candidate || candidate.sourceId !== resolution.directorySourceId || (candidate.matchedRestaurantId && candidate.matchedRestaurantId !== resolution.restaurantId) || (!candidate.matchedRestaurantId && !manualLocationEvidence)) failures.push({ restaurantId: resolution.restaurantId, problem: "directory_candidate_provenance_failed" });
  }
  const source = firstPartyById.get(resolution.restaurantId) || {};
  const fact = factsById.get(resolution.restaurantId) || {};
  const merged = { ...(place || {}), ...Object.fromEntries(Object.entries(resolution).filter(([, value]) => value !== undefined)) };
  return {
    restaurantId: resolution.restaurantId,
    name: resolution.name,
    resolutionState: resolution.resolutionState,
    evidence: resolution.evidence,
    completeness: {
      identity: Boolean(place),
      address: Boolean(merged.address),
      coordinates: hasCoordinates(merged.coordinates),
      currentStatus: Boolean(resolution.operatingStatus),
      officialWebsite: validUrl(merged.website),
      menu: menuIds.has(resolution.restaurantId),
      hours: Boolean(merged.openingHours || fact.hours),
      phone: Boolean(merged.phone || fact.phone),
      socialProfiles: new Set([...(source.socialProfiles || []).map((profile) => profile.url), ...(resolution.socialProfiles || []).map((profile) => profile.url)]).size > 0,
      duplicateConflictCleared: resolution.resolutionState === "reviewed_high" || resolution.resolutionState === "resolved_high" || resolution.resolutionState === "resolved_probable"
    }
  };
});

function sourceQueue(sourceId) {
  const items = (resolutions.resolutions || []).filter((item) => item.sourceId === sourceId);
  const publishedCount = reviewed.filter((record) => {
    if (record.directorySourceId) return record.directorySourceId === sourceId;
    return sourceId === "downtown-dartmouth-food-drink" && record.neighborhood === "Downtown Dartmouth";
  }).length;
  return {
    candidates: items.length,
    algorithmResolved: items.filter((item) => item.state.startsWith("resolved_")).length,
    publishedReviewed: publishedCount,
    heldForReview: Math.max(0, items.length - publishedCount),
    counts: items.reduce((counts, item) => ({ ...counts, [item.state]: (counts[item.state] || 0) + 1 }), {})
  };
}

const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  policy: reviewedWindow.HALIFAX_REVIEWED_PLACE_RESOLUTIONS?.policy || null,
  downtownDartmouth: sourceQueue("downtown-dartmouth-food-drink"),
  springGarden: { ...sourceQueue("spring-garden-eat-drink"), publicationDecision: "partial_publication_location_specific_evidence_only" },
  publishedRecords: records,
  practicalGapCounts: Object.fromEntries(["identity", "address", "coordinates", "currentStatus", "officialWebsite", "menu", "hours", "phone", "socialProfiles", "duplicateConflictCleared"].map((key) => [key, records.filter((record) => !record.completeness[key]).length])),
  failures
};

await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(new URL("../data/build/neighbourhood-resolution-report.json", import.meta.url), JSON.stringify(report, null, 2));
if (failures.length) { console.error(JSON.stringify(failures, null, 2)); process.exit(1); }
console.log(JSON.stringify({ downtownDartmouth: report.downtownDartmouth, springGarden: report.springGarden, practicalGapCounts: report.practicalGapCounts }, null, 2));
