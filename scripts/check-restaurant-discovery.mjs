import { readFile, writeFile, mkdir } from "node:fs/promises";
import vm from "node:vm";

async function loadWindow(path) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: path, timeout: 20000 });
  return context.window;
}

const catalog = JSON.parse(await readFile(new URL("../data/build/catalog.json", import.meta.url), "utf8"));
const directoryWindow = await loadWindow("data/directory-restaurant-leads.js");
const openingWindow = await loadWindow("data/opening-watch-leads.js");
const discoveredWindow = await loadWindow("data/discovered-restaurants.js");

const directory = directoryWindow.HALIFAX_DIRECTORY_RESTAURANT_LEADS || { records: [] };
const opening = openingWindow.HALIFAX_OPENING_WATCH_LEADS || { leads: [] };
const discovered = Array.isArray(discoveredWindow.HALIFAX_DISCOVERED_RESTAURANTS) ? discoveredWindow.HALIFAX_DISCOVERED_RESTAURANTS : [];
const knownIds = new Set((catalog.restaurants || []).map((restaurant) => restaurant.id));
const failures = [];
const warnings = [];
const allowedDirectoryKinds = new Set([
  "nova_scotia_tourism_directory",
  "downtown_halifax_directory",
  "business_improvement_district_directory",
  "business_improvement_district_feature_directory",
  "shopping_centre_directory",
  "restaurant_association_directory",
  "culinary_tourism_member_directory"
]);

function validUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return ["http:", "https:"].includes(url.protocol);
  } catch { return false; }
}
function normalize(value) {
  return String(value ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "").trim();
}
function duplicates(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1);
}

const directoryRecords = Array.isArray(directory.records) ? directory.records : [];
for (const record of directoryRecords) {
  if (!record.name || !record.sourceKind || !validUrl(record.sourceUrl) || !record.observedAt) {
    failures.push({ type: "invalid_directory_record", id: record.id, name: record.name });
  }
  if (!allowedDirectoryKinds.has(record.sourceKind)) {
    failures.push({ type: "unexpected_directory_source_kind", id: record.id, sourceKind: record.sourceKind });
  }
}

const openingLeads = Array.isArray(opening.leads) ? opening.leads : [];
for (const lead of openingLeads) {
  if (!lead.name || !lead.status || !validUrl(lead.sourceUrl) || lead.reviewState !== "needs-cross-check") {
    failures.push({ type: "invalid_opening_watch_lead", id: lead.id, name: lead.name });
  }
  if (Object.hasOwn(lead, "articleBody") || Object.hasOwn(lead, "content") || Object.hasOwn(lead, "rawText")) {
    failures.push({ type: "opening_watch_raw_article_text_retained", id: lead.id });
  }
}

for (const restaurant of discovered) {
  if (!restaurant.id || !restaurant.name || restaurant.sourceLayer !== "local_discovery" || !Array.isArray(restaurant.sources) || !restaurant.sources.length) {
    failures.push({ type: "invalid_discovered_restaurant", id: restaurant.id, name: restaurant.name });
    continue;
  }
  for (const source of restaurant.sources) {
    if (!validUrl(source.url) || !source.type || !source.status) failures.push({ type: "invalid_discovered_source", id: restaurant.id, source });
  }
}

const duplicateDiscoveryIds = duplicates(discovered, (restaurant) => restaurant.id);
if (duplicateDiscoveryIds.length) failures.push({ type: "duplicate_discovered_ids", values: duplicateDiscoveryIds });

const duplicateDiscoveryNames = duplicates(discovered, (restaurant) => normalize(restaurant.name));
if (duplicateDiscoveryNames.length) failures.push({ type: "duplicate_discovered_names", values: duplicateDiscoveryNames });

for (const restaurant of discovered) {
  if (knownIds.has(restaurant.id)) warnings.push({ type: "discovered_id_already_in_catalog", id: restaurant.id, name: restaurant.name });
}

if (!discovered.some((restaurant) => normalize(restaurant.name) === "sakaba")) {
  failures.push({ type: "sakaba_missing_from_discovered_restaurants" });
}
if (!openingLeads.some((lead) => normalize(lead.name) === "sakaba")) {
  warnings.push({ type: "sakaba_not_extracted_from_opening_watch_current_run" });
}

const report = {
  generatedAt: new Date().toISOString(),
  counts: {
    directoryRecords: directoryRecords.length,
    directoryNewToCatalog: directoryRecords.filter((record) => !record.alreadyInCatalog).length,
    openingWatchLeads: openingLeads.length,
    discoveredRestaurants: discovered.length
  },
  failures,
  warnings
};

await mkdir(new URL("../artifacts", import.meta.url), { recursive: true });
await writeFile(new URL("../artifacts/restaurant-discovery-report.json", import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.counts, null, 2));
if (warnings.length) console.warn(`Discovery warnings: ${warnings.map((item) => item.type).join(", ")}`);
if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}
console.log("Restaurant discovery integrity checks passed.");

