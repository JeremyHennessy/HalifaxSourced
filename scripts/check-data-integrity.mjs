import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";

async function loadWindowScript(path) {
  const source = await readFile(path, "utf8");
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: path, timeout: 20_000 });
  return context.window;
}

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\bthe\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function validHttpUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(String(value).replaceAll("&amp;", "&"));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const curatedWindow = await loadWindowScript(resolve("data", "restaurants.js"));
const osmWindow = await loadWindowScript(resolve("data", "osm-restaurants.js"));
const officialWindow = await loadWindowScript(resolve("data", "official-site-signals.js"));

const curated = Array.isArray(curatedWindow.HALIFAX_RESTAURANTS) ? curatedWindow.HALIFAX_RESTAURANTS : [];
const osm = Array.isArray(osmWindow.HALIFAX_OSM_RESTAURANTS) ? osmWindow.HALIFAX_OSM_RESTAURANTS : [];
const osmMeta = osmWindow.HALIFAX_OSM_META ?? null;
const officialPayload = officialWindow.HALIFAX_OFFICIAL_SITE_SIGNALS ?? null;
const official = Array.isArray(officialPayload?.results) ? officialPayload.results : [];

const failures = [];
const warnings = [];

function duplicateValues(items, getter) {
  const counts = new Map();
  for (const item of items) {
    const value = getter(item);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).sort((a, b) => b[1] - a[1]);
}

const duplicateCuratedIds = duplicateValues(curated, (item) => item.id);
const duplicateOsmIds = duplicateValues(osm, (item) => item.id);
if (duplicateCuratedIds.length) failures.push({ type: "duplicate_curated_ids", values: duplicateCuratedIds });
if (duplicateOsmIds.length) failures.push({ type: "duplicate_osm_ids", values: duplicateOsmIds.slice(0, 25) });

const missingOsmCore = osm.filter((item) => !item.id || !item.name || !item.neighborhood || !item.coordinates);
if (missingOsmCore.length) failures.push({ type: "osm_missing_core_fields", count: missingOsmCore.length, examples: missingOsmCore.slice(0, 10).map(({ id, name, neighborhood, coordinates }) => ({ id, name, neighborhood, coordinates })) });

const bbox = osmMeta?.bbox ?? { south: 44.575, west: -63.69, north: 44.705, east: -63.505 };
const invalidCoordinates = osm.filter((item) => {
  const lat = Number(item.coordinates?.lat);
  const lon = Number(item.coordinates?.lon);
  return !Number.isFinite(lat) || !Number.isFinite(lon) || lat < bbox.south || lat > bbox.north || lon < bbox.west || lon > bbox.east;
});
if (invalidCoordinates.length) failures.push({ type: "osm_invalid_coordinates", count: invalidCoordinates.length, examples: invalidCoordinates.slice(0, 10).map(({ id, name, coordinates }) => ({ id, name, coordinates })) });

const byNormalizedName = new Map();
for (const item of osm) {
  const key = normalize(item.name);
  if (!key) continue;
  if (!byNormalizedName.has(key)) byNormalizedName.set(key, []);
  byNormalizedName.get(key).push(item);
}
const multiLocationGroups = [...byNormalizedName.entries()]
  .filter(([, items]) => items.length > 1)
  .map(([key, items]) => ({
    key,
    name: items[0]?.name,
    count: items.length,
    locations: items.slice(0, 12).map((item) => ({ id: item.id, neighborhood: item.neighborhood, address: item.address, coordinates: item.coordinates }))
  }))
  .sort((a, b) => b.count - a.count);

const curatedMatches = curated.map((item) => {
  const matches = byNormalizedName.get(normalize(item.name)) ?? [];
  return {
    curatedId: item.id,
    name: item.name,
    matchCount: matches.length,
    matches: matches.map((match) => ({ id: match.id, neighborhood: match.neighborhood, address: match.address, coordinates: match.coordinates, website: match.website }))
  };
});
const ambiguousCuratedMatches = curatedMatches.filter((item) => item.matchCount > 1);
if (ambiguousCuratedMatches.length) warnings.push({ type: "ambiguous_curated_name_matches", count: ambiguousCuratedMatches.length, examples: ambiguousCuratedMatches });
const curatedWithoutOsmMatch = curatedMatches.filter((item) => item.matchCount === 0);
if (curatedWithoutOsmMatch.length) warnings.push({ type: "curated_without_osm_name_match", count: curatedWithoutOsmMatch.length, examples: curatedWithoutOsmMatch });

const rawIds = new Set([...curated.map((item) => item.id), ...osm.map((item) => item.id)]);
const orphanSignals = official.filter((signal) => signal.restaurantId && !rawIds.has(signal.restaurantId));
if (orphanSignals.length) warnings.push({ type: "official_signal_orphans", count: orphanSignals.length, examples: orphanSignals.slice(0, 20).map(({ restaurantId, name, website }) => ({ restaurantId, name, website })) });

const malformedOfficialUrls = [];
for (const signal of official) {
  if (signal.website && !validHttpUrl(signal.website)) malformedOfficialUrls.push({ restaurantId: signal.restaurantId, field: "website", value: signal.website });
  for (const link of signal.candidateLinks ?? []) {
    if (link.href && !validHttpUrl(link.href)) malformedOfficialUrls.push({ restaurantId: signal.restaurantId, field: "candidateLink", value: link.href });
  }
}
if (malformedOfficialUrls.length) failures.push({ type: "malformed_official_urls", count: malformedOfficialUrls.length, examples: malformedOfficialUrls.slice(0, 25) });

const neighbourhoodCounts = [...new Map(osm.map((item) => [item.neighborhood, 0])).keys()].filter(Boolean).sort().map((name) => [name, osm.filter((item) => item.neighborhood === name).length]);
const officialWithValidSite = official.filter((signal) => validHttpUrl(signal.website)).length;
const officialCandidateLinks = official.reduce((sum, signal) => sum + (signal.candidateLinks?.filter((link) => validHttpUrl(link.href)).length ?? 0), 0);

const report = {
  generatedAt: new Date().toISOString(),
  counts: {
    curated: curated.length,
    osm: osm.length,
    officialSignals: official.length,
    officialWithValidSite,
    officialCandidateLinks,
    multiLocationNameGroups: multiLocationGroups.length,
    ambiguousCuratedMatches: ambiguousCuratedMatches.length,
    curatedWithoutOsmMatch: curatedWithoutOsmMatch.length,
    orphanSignals: orphanSignals.length
  },
  scope: osmMeta?.scope ?? null,
  bbox,
  neighbourhoodCounts,
  multiLocationGroups: multiLocationGroups.slice(0, 40),
  curatedMatches,
  failures,
  warnings
};

await mkdir(resolve("artifacts"), { recursive: true });
await writeFile(resolve("artifacts", "data-integrity-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.counts, null, 2));
console.log(`Multi-location examples: ${multiLocationGroups.slice(0, 10).map((group) => `${group.name} (${group.count})`).join(", ") || "none"}`);
if (warnings.length) console.warn(`Integrity warnings: ${warnings.map((warning) => `${warning.type}=${warning.count ?? warning.examples?.length ?? 1}`).join(", ")}`);
if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}
console.log("Data integrity hard checks passed.");
