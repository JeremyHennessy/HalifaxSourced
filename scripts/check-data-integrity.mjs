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

function token(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function parseUrl(value) {
  if (!value) return null;
  try { return new URL(String(value).replaceAll("&amp;", "&")); } catch { return null; }
}

function validHttpUrl(value) {
  const url = parseUrl(value);
  return Boolean(url && (url.protocol === "http:" || url.protocol === "https:"));
}

function validMediaUrl(value) {
  return validHttpUrl(value) || /^(?:\.\/)?assets\/[a-zA-Z0-9._/-]+$/.test(String(value ?? ""));
}

function distanceMeters(a, b) {
  const lat1 = Number(a?.lat);
  const lon1 = Number(a?.lon);
  const lat2 = Number(b?.lat);
  const lon2 = Number(b?.lon);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Infinity;
  const toRad = (value) => value * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

const curatedWindow = await loadWindowScript(resolve("data", "restaurants.js"));
const osmWindow = await loadWindowScript(resolve("data", "osm-restaurants.js"));
const officialWindow = await loadWindowScript(resolve("data", "official-site-signals.js"));
const mediaWindow = await loadWindowScript(resolve("data", "restaurant-media.js"));
const ownerPayload = JSON.parse(await readFile(resolve("data", "build", "owner-submissions.normalized.json"), "utf8").catch(() => "{\"submissions\":[]}"));

const curated = Array.isArray(curatedWindow.HALIFAX_RESTAURANTS) ? curatedWindow.HALIFAX_RESTAURANTS : [];
const osm = Array.isArray(osmWindow.HALIFAX_OSM_RESTAURANTS) ? osmWindow.HALIFAX_OSM_RESTAURANTS : [];
const osmMeta = osmWindow.HALIFAX_OSM_META ?? null;
const officialPayload = officialWindow.HALIFAX_OFFICIAL_SITE_SIGNALS ?? null;
const official = Array.isArray(officialPayload?.results) ? officialPayload.results : [];
const mediaPayload = mediaWindow.HALIFAX_RESTAURANT_MEDIA ?? null;
const mediaRecords = Array.isArray(mediaPayload?.records) ? mediaPayload.records : [];
const ownerSubmissions = Array.isArray(ownerPayload?.submissions) ? ownerPayload.submissions : [];

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
  .map(([key, items]) => ({ key, name: items[0]?.name, count: items.length, locations: items.slice(0, 12).map((item) => ({ id: item.id, neighborhood: item.neighborhood, address: item.address, coordinates: item.coordinates })) }))
  .sort((a, b) => b.count - a.count);

const nearDuplicatePairs = [];
for (const [, items] of byNormalizedName) {
  if (items.length < 2) continue;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const meters = distanceMeters(items[i].coordinates, items[j].coordinates);
      if (meters <= 35) nearDuplicatePairs.push({ name: items[i].name, distanceMeters: Math.round(meters * 10) / 10, a: { id: items[i].id, address: items[i].address, neighborhood: items[i].neighborhood, coordinates: items[i].coordinates }, b: { id: items[j].id, address: items[j].address, neighborhood: items[j].neighborhood, coordinates: items[j].coordinates } });
    }
  }
}
if (nearDuplicatePairs.length) warnings.push({ type: "near_duplicate_same_name_osm_objects", count: nearDuplicatePairs.length, examples: nearDuplicatePairs.slice(0, 25) });

const curatedMatches = curated.map((item) => {
  const matches = byNormalizedName.get(normalize(item.name)) ?? [];
  return { curatedId: item.id, name: item.name, matchCount: matches.length, matches: matches.map((match) => ({ id: match.id, neighborhood: match.neighborhood, address: match.address, coordinates: match.coordinates, website: match.website })) };
});
const ambiguousCuratedMatches = curatedMatches.filter((item) => item.matchCount > 1);
if (ambiguousCuratedMatches.length) warnings.push({ type: "ambiguous_curated_name_matches", count: ambiguousCuratedMatches.length, examples: ambiguousCuratedMatches });
const curatedWithoutOsmMatch = curatedMatches.filter((item) => item.matchCount === 0);
if (curatedWithoutOsmMatch.length) warnings.push({ type: "curated_without_osm_name_match", count: curatedWithoutOsmMatch.length, examples: curatedWithoutOsmMatch });

const rawIds = new Set([...curated.map((item) => item.id), ...osm.map((item) => item.id)]);
const orphanSignals = official.filter((signal) => signal.restaurantId && !rawIds.has(signal.restaurantId));
if (orphanSignals.length) warnings.push({ type: "official_signal_orphans", count: orphanSignals.length, examples: orphanSignals.slice(0, 20).map(({ restaurantId, name, website }) => ({ restaurantId, name, website })) });

const malformedOfficialWebsites = official.filter((signal) => signal.website && !validHttpUrl(signal.website)).map(({ restaurantId, name, website }) => ({ restaurantId, name, website }));
if (malformedOfficialWebsites.length) warnings.push({ type: "malformed_official_website_values", count: malformedOfficialWebsites.length, examples: malformedOfficialWebsites.slice(0, 20) });

const ignoredCandidateLinks = [];
for (const signal of official) {
  for (const link of signal.candidateLinks ?? []) {
    if (!link.href || validHttpUrl(link.href)) continue;
    const parsed = parseUrl(link.href);
    ignoredCandidateLinks.push({ restaurantId: signal.restaurantId, protocol: parsed?.protocol ?? "invalid", value: link.href });
  }
}
if (ignoredCandidateLinks.length) warnings.push({ type: "non_http_candidate_links_ignored_by_ui", count: ignoredCandidateLinks.length, examples: ignoredCandidateLinks.slice(0, 25) });

const allowedMediaSources = new Set(["owner", "owner_submission", "restaurant_owner", "first_party", "official_site_permitted", "licensed"]);
const allowedMediaPermissions = new Set(["permitted", "owner_approved", "written_permission", "licensed"]);
const duplicateMedia = duplicateValues(mediaRecords, (record) => record.restaurantId && record.url ? `${record.restaurantId}|${record.url}` : null);
if (duplicateMedia.length) failures.push({ type: "duplicate_media_records", values: duplicateMedia.slice(0, 25) });

const invalidApprovedMedia = mediaRecords.filter((record) => {
  return token(record.reviewState) !== "approved" ||
    !rawIds.has(record.restaurantId) ||
    !validMediaUrl(record.url) ||
    !validHttpUrl(record.sourceUrl) ||
    !allowedMediaSources.has(token(record.sourceType)) ||
    !allowedMediaPermissions.has(token(record.permission)) ||
    record.permissionConfirmed !== true ||
    !String(record.rightsBasis ?? "").trim();
});
if (invalidApprovedMedia.length) failures.push({ type: "production_media_missing_provenance", count: invalidApprovedMedia.length, examples: invalidApprovedMedia.slice(0, 20) });

const pendingOwnerMedia = ownerSubmissions.flatMap((submission) => (submission.images ?? []).map((image) => ({ restaurantId: submission.restaurantId, name: submission.name, ...image }))).filter((image) => token(image.reviewState) !== "approved");
if (pendingOwnerMedia.length) warnings.push({ type: "owner_media_pending_review", count: pendingOwnerMedia.length, examples: pendingOwnerMedia.slice(0, 20).map(({ restaurantId, name, url, sourceType, reviewState }) => ({ restaurantId, name, url, sourceType, reviewState })) });

const halifaxTaggedAsDartmouth = osm.filter((item) => /halifax/i.test(item.osm?.rawTags?.["addr:city"] ?? "") && item.neighborhood === "Dartmouth");
if (halifaxTaggedAsDartmouth.length) warnings.push({ type: "halifax_city_tagged_as_dartmouth", count: halifaxTaggedAsDartmouth.length, examples: halifaxTaggedAsDartmouth.slice(0, 25).map(({ id, name, neighborhood, address, coordinates }) => ({ id, name, neighborhood, address, coordinates })) });

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
    productionMedia: mediaRecords.length,
    ownerSubmissions: ownerSubmissions.length,
    ownerMediaPendingReview: pendingOwnerMedia.length,
    multiLocationNameGroups: multiLocationGroups.length,
    nearDuplicatePairs: nearDuplicatePairs.length,
    ambiguousCuratedMatches: ambiguousCuratedMatches.length,
    curatedWithoutOsmMatch: curatedWithoutOsmMatch.length,
    orphanSignals: orphanSignals.length,
    halifaxTaggedAsDartmouth: halifaxTaggedAsDartmouth.length
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
console.log("Data integrity hard checks passed; unapproved media remains excluded from production rendering.");
