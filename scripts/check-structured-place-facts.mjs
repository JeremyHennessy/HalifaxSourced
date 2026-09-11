import { mkdir, readFile, writeFile } from "node:fs/promises";
import vm from "node:vm";
import { localRestaurantPolicyDecision } from "./lib/local-restaurant-policy.mjs";

const facts = JSON.parse(await readFile(new URL("../data/build/structured-place-facts.json", import.meta.url), "utf8"));
const catalog = JSON.parse(await readFile(new URL("../data/build/catalog.json", import.meta.url), "utf8"));
const ids = new Set((catalog.restaurants || []).map((restaurant) => restaurant.id));
const errors = [];
const warnings = [];
const seen = new Set();
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

async function loadWindowData(path) {
  try {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    const context = { window: {} };
    vm.createContext(context);
    vm.runInContext(source, context, { filename: path, timeout: 20_000 });
    return context.window;
  } catch {
    return {};
  }
}

function validUrl(value) {
  try {
    return ["http:", "https:"].includes(new URL(String(value || "")).protocol);
  } catch {
    return false;
  }
}

function validDate(value) {
  return Number.isFinite(Date.parse(String(value || "")));
}

function validTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
}

function policyRecord(record) {
  return {
    id: record?.restaurantId,
    name: record?.name,
    restaurantName: record?.restaurantName,
    venueName: record?.venueName,
    candidateName: record?.candidateName,
    sourceName: record?.sourceName,
    website: record?.website,
    url: record?.url,
    sourceUrl: record?.sourceUrl,
    sourcePageUrl: record?.sourcePageUrl,
    sourceImageUrl: record?.sourceImageUrl,
    thumbnailUrl: record?.thumbnailUrl
  };
}

function excludedByLocalPolicy(record, localPolicyExcludedIds) {
  return localPolicyExcludedIds.has(record?.restaurantId) || localRestaurantPolicyDecision(policyRecord(record)).excluded;
}

const osmWindow = await loadWindowData("data/osm-restaurants.js");
const rawOsmRestaurants = Array.isArray(osmWindow.HALIFAX_OSM_RESTAURANTS) ? osmWindow.HALIFAX_OSM_RESTAURANTS : [];
const localPolicyExcludedIds = new Set(
  rawOsmRestaurants
    .filter((restaurant) => localRestaurantPolicyDecision(restaurant).excluded)
    .map((restaurant) => restaurant.id)
    .filter(Boolean)
);

const allRecords = Array.isArray(facts.records) ? facts.records : [];
const publicRecords = allRecords.filter((record) => !excludedByLocalPolicy(record, localPolicyExcludedIds));
const localPolicyExcludedRecords = allRecords.length - publicRecords.length;

for (const record of publicRecords) {
  if (!record.restaurantId || !ids.has(record.restaurantId)) errors.push(`unknown_restaurant:${record.restaurantId}`);
  if (seen.has(record.restaurantId)) errors.push(`duplicate_record:${record.restaurantId}`);
  seen.add(record.restaurantId);
  if (!validUrl(record.sourceUrl) || !validDate(record.observedAt) || !validDate(record.lastVerifiedAt) || record.sourceKind !== "official_website_structured_facts") errors.push(`invalid_record_provenance:${record.restaurantId}`);

  if (record.hours) {
    for (const day of DAYS) {
      if (!Array.isArray(record.hours[day])) errors.push(`invalid_hours_day:${record.restaurantId}:${day}`);
      for (const interval of record.hours[day] || []) {
        if (!validTime(interval.open) || !validTime(interval.close) || typeof interval.overnight !== "boolean") errors.push(`invalid_hours_interval:${record.restaurantId}:${day}`);
      }
    }
  }

  for (const feature of record.features || []) {
    if (!feature.feature || !feature.evidencePhrase || !validUrl(feature.sourceUrl) || !validDate(feature.observedAt)) errors.push(`invalid_feature:${record.restaurantId}:${feature.feature}`);
  }

  for (const menu of record.menus || []) {
    if (!menu.menuType || !validUrl(menu.url) || !["html", "pdf"].includes(menu.format) || !validDate(menu.verifiedAt)) errors.push(`invalid_menu:${record.restaurantId}`);
  }

  for (const action of [...(record.reservations || []), ...(record.ordering || [])]) {
    if (!action.provider || !validUrl(action.url) || !validDate(action.verifiedAt)) errors.push(`invalid_action:${record.restaurantId}`);
  }
}

const publicFailures = (facts.failures || []).filter((failure) => !excludedByLocalPolicy(failure, localPolicyExcludedIds));
if (publicFailures.length) warnings.push(...publicFailures.slice(0, 30).map((failure) => `source_failure:${failure.restaurantId}:${failure.reason}`));

const counts = {
  ...(facts.counts || {}),
  records: publicRecords.length,
  hours: publicRecords.filter((record) => record.hours).length,
  phone: publicRecords.filter((record) => record.phone).length,
  email: publicRecords.filter((record) => record.email).length,
  address: publicRecords.filter((record) => record.address).length,
  features: publicRecords.filter((record) => Array.isArray(record.features) && record.features.length).length,
  menus: publicRecords.filter((record) => Array.isArray(record.menus) && record.menus.length).length,
  reservations: publicRecords.filter((record) => Array.isArray(record.reservations) && record.reservations.length).length,
  ordering: publicRecords.filter((record) => Array.isArray(record.ordering) && record.ordering.length).length
};

const report = {
  generatedAt: new Date().toISOString(),
  checkedPlaces: facts.checkedPlaces || 0,
  records: publicRecords.length,
  localPolicyExcludedRecords,
  counts,
  sourceFailures: publicFailures.length,
  localPolicyExcludedFailures: (facts.failures || []).length - publicFailures.length,
  errors,
  warnings
};

await mkdir(new URL("../artifacts", import.meta.url), { recursive: true });
await writeFile(new URL("../artifacts/structured-place-facts-report.json", import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exit(1);
