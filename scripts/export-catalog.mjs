import { readFile, writeFile, mkdir } from "node:fs/promises";
import { Script, createContext } from "node:vm";
import { filterLocalRestaurantRecords, localRestaurantPolicy } from "./lib/local-restaurant-policy.mjs";

const context = createContext({ window: {} });
for (const file of ["../data/restaurants.js", "../data/osm-restaurants.js", "../data/ns-food-inspections.js"]) {
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
  return String(name ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "").trim();
}

function normalizeLookup(value) {
  return String(value ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\bthe\b/g, "").replace(/[^a-z0-9]+/g, "").trim();
}

function addressLookup(value) {
  return String(value ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\b(street|st|avenue|ave|road|rd|drive|dr|boulevard|blvd|lane|ln|nova scotia|halifax|dartmouth|bedford)\b/g, "").replace(/[^a-z0-9]+/g, "").trim();
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

const nsByName = new Map();
for (const record of nsRecords) {
  const key = normalizeLookup(record.name);
  if (!key) continue;
  if (!nsByName.has(key)) nsByName.set(key, []);
  nsByName.get(key).push(record);
}

function inspectionMatches(restaurant) {
  const nameKey = normalizeLookup(restaurant.name);
  const addressKey = addressLookup(restaurant.address);
  const exact = nsByName.get(nameKey) ?? [];
  const candidates = nsRecords.filter((record) => {
    const recordName = normalizeLookup(record.name);
    const recordAddress = addressLookup(record.address);
    const nameMatch = recordName === nameKey || (nameKey.length > 8 && recordName.includes(nameKey)) || (recordName.length > 8 && nameKey.includes(recordName));
    const addressMatch = addressKey && recordAddress && (recordAddress.includes(addressKey.slice(0, 12)) || addressKey.includes(recordAddress.slice(0, 12)));
    return nameMatch || (addressMatch && recordName.slice(0, 6) === nameKey.slice(0, 6));
  });
  return [...exact, ...candidates].filter((record, index, all) => all.findIndex((item) => item.id === record.id) === index).slice(0, 5);
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

const byName = new Map();
const restaurants = curated.map((restaurant) => ({ ...restaurant, sourceLayer: "curated" }));
restaurants.forEach((restaurant) => byName.set(keyForName(restaurant.name), restaurant));

for (const restaurant of osm) {
  const match = byName.get(keyForName(restaurant.name));
  if (!match) {
    restaurants.push({ ...restaurant, sourceLayer: "openstreetmap" });
    continue;
  }
  match.category ??= restaurant.category;
  match.address ??= restaurant.address;
  match.phone ??= restaurant.phone;
  match.website ??= restaurant.website;
  match.openingHours ??= restaurant.openingHours;
  match.coordinates ??= restaurant.coordinates;
  match.sources = mergeSources(match.sources, restaurant.sources);
  match.osm ??= restaurant.osm;
}

const localPolicyExcluded = {
  curated: curatedPolicy.excluded.length,
  openStreetMap: osmPolicy.excluded.length,
  total: curatedPolicy.excluded.length + osmPolicy.excluded.length
};
const enrichedRestaurants = restaurants.map(withInspectionEvidence);
const catalog = {
  generatedAt: new Date().toISOString(),
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
