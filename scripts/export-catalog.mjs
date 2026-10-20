import { readFile, writeFile, mkdir } from "node:fs/promises";
import { Script, createContext } from "node:vm";
import { applyReviewedCorrections, reviewedCorrections, reviewedPlaceResolutions } from "./lib/reviewed-corrections.mjs";
import { filterLocalRestaurantRecords, localRestaurantPolicy } from "./lib/local-restaurant-policy.mjs";

import identity from "../app-restaurant-identity.js";

const context = createContext({ window: {} });
for (const file of ["../app-inspection-matching.js", "../data/restaurants.js", "../data/osm-restaurants.js", "../data/ns-food-inspections.js", "../data/discovered-restaurants.js", "../data/discovery-source-supplements.js"]) {
  const source = await readFile(new URL(file, import.meta.url), "utf8");
  new Script(source, { filename: file }).runInContext(context);
}

const curatedInput = context.window.HALIFAX_RESTAURANTS ?? [];
const osmInput = context.window.HALIFAX_OSM_RESTAURANTS ?? [];
const curatedPolicy = filterLocalRestaurantRecords(curatedInput);
const osmPolicy = filterLocalRestaurantRecords(osmInput);
const curated = curatedPolicy.included;
const osm = osmPolicy.included;
const osmMeta = context.window.HALIFAX_OSM_META ?? null;
const nsFoodInspections = context.window.HALIFAX_NS_FOOD_INSPECTIONS ?? null;
const nsRecords = nsFoodInspections?.records ?? [];
let officialSiteSignals = null;
try {
  officialSiteSignals = JSON.parse(await readFile(new URL("../data/build/official-site-signals.json", import.meta.url), "utf8"));
} catch {}

function keyForName(name) {
  return String(name ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\bthe\b/g, "").replace(/[^a-z0-9]+/g, "").trim();
}

function mergeSources(a = [], b = []) {
  const seen = new Set();
  return [...a, ...b].filter((source) => {
    const key = `${source.type}|${source.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function excludedRecordsSummary(result, sourceLayer) {
  return result.excluded.slice(0, 75).map(({ record, decision }) => ({
    sourceLayer,
    id: record?.id ?? null,
    name: record?.name ?? null,
    reason: decision.reason,
    field: decision.field,
    matchedToken: decision.matchedToken,
    matchedValue: decision.matchedValue
  }));
}

function inspectionMatches(restaurant) {
  return context.window.HalifaxInspectionMatching.matches(restaurant, nsRecords);
}

function withInspectionEvidence(restaurant) {
  const inspectionRecords = inspectionMatches(restaurant);
  const inspectionSources = inspectionRecords.map((record) => ({
    label: `NS inspection: ${record.name}`,
    type: "ns_food_inspection",
    url: record.detailUrl,
    status: "verified"
  }));
  return { ...restaurant, inspectionRecords, sources: mergeSources(restaurant.sources, inspectionSources) };
}

const restaurants = curated.map((restaurant) => ({ ...restaurant, sourceLayer: "curated" }));
const curatedTargets = [...restaurants];
const identityReviewQueue = [];
for (const restaurant of osm) {
  const decision = identity.find(curatedTargets, restaurant, reviewedCorrections.aliases || []);
  if (decision.state === "review") {
    identityReviewQueue.push({ sourceId: restaurant.id, name: restaurant.name, reason: decision.reason, candidateIds: decision.candidateIds || [] });
    continue;
  }
  if (decision.state === "match") identity.merge(decision.record, restaurant, decision);
  else restaurants.push({ ...restaurant, sourceLayer: "openstreetmap" });
}

const localPolicyExcluded = {
  curated: curatedPolicy.excluded.length,
  openStreetMap: osmPolicy.excluded.length,
  total: curatedPolicy.excluded.length + osmPolicy.excluded.length
};
for (const restaurant of restaurants) identity.applyResolution(restaurant, reviewedPlaceResolutions);
for (const discovered of context.window.HALIFAX_DISCOVERED_RESTAURANTS || []) {
  if (filterLocalRestaurantRecords([discovered]).excluded.length) continue;
  const decision = identity.find(restaurants, discovered, reviewedCorrections.aliases || []);
  if (decision.state === "review") identityReviewQueue.push({ sourceId: discovered.id, name: discovered.name, reason: decision.reason, candidateIds: decision.candidateIds || [] });
  else if (decision.state === "match") identity.merge(decision.record, discovered, decision);
  else restaurants.push({ ...discovered, sourceLayer: "local_discovery" });
}
const enrichedRestaurants = applyReviewedCorrections(restaurants.map(record => identity.applyResolution(record, reviewedPlaceResolutions))).map(withInspectionEvidence);
const catalog = {
  generatedAt: new Date().toISOString(),
  identityReviewQueue,
  sourceMeta: {
    openStreetMap: osmMeta,
    novaScotiaFoodInspections: nsFoodInspections,
    officialSiteSignals,
    localRestaurantPolicy: {
      version: localRestaurantPolicy.version,
      excluded: localPolicyExcluded,
      excludedRecords: [
        ...excludedRecordsSummary(curatedPolicy, "curated"),
        ...excludedRecordsSummary(osmPolicy, "openstreetmap")
      ]
    }
  },
  counts: {
    curatedInput: curatedInput.length,
    openStreetMapInput: osmInput.length,
    curated: curated.length,
    openStreetMap: osm.length,
    localPolicyExcluded,
    novaScotiaFoodInspections: nsRecords.length,
    officialSiteSignals: officialSiteSignals?.count ?? 0,
    merged: enrichedRestaurants.length,
    withInspectionMatches: enrichedRestaurants.filter((restaurant) => restaurant.inspectionRecords.length > 0).length
  },
  restaurants: enrichedRestaurants
};

await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(new URL("../data/build/catalog.json", import.meta.url), JSON.stringify(catalog, null, 2));
console.log(`Exported ${enrichedRestaurants.length} local-eligible merged records to data/build/catalog.json.`);
console.log(`Local restaurant policy excluded ${localPolicyExcluded.total} non-local chain/franchise records (${localPolicyExcluded.curated} curated, ${localPolicyExcluded.openStreetMap} OpenStreetMap).`);
console.log(`Inspection matches: ${catalog.counts.withInspectionMatches}/${enrichedRestaurants.length}.`);
