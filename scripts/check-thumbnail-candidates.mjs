import { mkdir, readFile, writeFile } from "node:fs/promises";
import vm from "node:vm";

async function loadWindowScript(path, globalName, fallback) {
  try {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    const context = { window: {} };
    vm.createContext(context);
    vm.runInContext(source, context, { filename: path, timeout: 20_000 });
    return context.window[globalName] ?? fallback;
  } catch {
    return fallback;
  }
}

const catalog = JSON.parse(await readFile(new URL("../data/build/catalog.json", import.meta.url), "utf8").catch(() => "{\"restaurants\":[]}"));
const thumbnailPayload = await loadWindowScript("data/thumbnail-candidates.js", "HALIFAX_THUMBNAIL_CANDIDATES", { candidates: [], missingApproved: [], missingAnyCandidate: [] });
const restaurants = Array.isArray(catalog.restaurants) ? catalog.restaurants : [];
const restaurantIds = new Set(restaurants.map((restaurant) => restaurant.id));
const candidates = Array.isArray(thumbnailPayload.candidates) ? thumbnailPayload.candidates : [];
const failures = [];
const warnings = [];
const allowedSourceKinds = new Set(["approved_restaurant_media", "official_feed_media", "meta_social_media", "official_page_thumbnail_candidate", "public_campaign_menu_image", "public_special_source_image"]);
const allowedReviewStates = new Set(["approved", "candidate_review", "rejected"]);
const allowedRightsStates = new Set(["production_approved", "requires_rights_review", "rejected"]);

function publicHttpUrl(url) {
  const hostname = url.hostname.toLowerCase();
  return !(
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".local") ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(?:1[6-9]|2\d|3[0-1])\./.test(hostname)
  );
}

function validUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return (["http:", "https:"].includes(url.protocol) && publicHttpUrl(url)) || /^(?:\.\/)?assets\/[a-zA-Z0-9._/-]+$/.test(String(value ?? ""));
  } catch {
    return /^(?:\.\/)?assets\/[a-zA-Z0-9._/-]+$/.test(String(value ?? ""));
  }
}
function validHttpUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return ["http:", "https:"].includes(url.protocol) && publicHttpUrl(url);
  } catch { return false; }
}
function duplicateValues(items, getter) {
  const counts = new Map();
  for (const item of items) {
    const key = getter(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1);
}

const duplicateIds = duplicateValues(candidates, (candidate) => candidate.id);
if (duplicateIds.length) failures.push({ type: "duplicate_thumbnail_candidate_ids", values: duplicateIds.slice(0, 30) });
const duplicateImages = duplicateValues(candidates, (candidate) => `${candidate.restaurantId}|${candidate.thumbnailUrl}|${candidate.sourceKind}`);
if (duplicateImages.length) failures.push({ type: "duplicate_thumbnail_candidates", values: duplicateImages.slice(0, 30) });

for (const candidate of candidates) {
  if (!candidate.id || !restaurantIds.has(candidate.restaurantId) || !validUrl(candidate.thumbnailUrl) || !validHttpUrl(candidate.sourceUrl) || !allowedSourceKinds.has(candidate.sourceKind) || !allowedReviewStates.has(candidate.reviewState) || !allowedRightsStates.has(candidate.rightsStatus) || !String(candidate.alt || "").trim() || !String(candidate.confidence || "").trim()) {
    failures.push({ type: "invalid_thumbnail_candidate", id: candidate.id, restaurantId: candidate.restaurantId, thumbnailUrl: candidate.thumbnailUrl, sourceKind: candidate.sourceKind });
  }
  if (candidate.eligibleForProduction && (candidate.reviewState !== "approved" || candidate.rightsStatus !== "production_approved" || !candidate.rightsBasis || !candidate.permission)) {
    failures.push({ type: "thumbnail_production_candidate_missing_rights", id: candidate.id, restaurantId: candidate.restaurantId });
  }
  if (!candidate.eligibleForProduction && candidate.reviewState === "approved") {
    failures.push({ type: "approved_thumbnail_not_production_eligible", id: candidate.id, restaurantId: candidate.restaurantId });
  }
}

const approvedRestaurants = new Set(candidates.filter((candidate) => candidate.eligibleForProduction).map((candidate) => candidate.restaurantId));
const anyCandidateRestaurants = new Set(candidates.map((candidate) => candidate.restaurantId));
const missingApproved = restaurants.length - approvedRestaurants.size;
const missingAny = restaurants.length - anyCandidateRestaurants.size;
if (missingApproved > 0) warnings.push({ type: "restaurants_missing_approved_thumbnail", count: missingApproved });
if (missingAny > 0) warnings.push({ type: "restaurants_missing_any_thumbnail_candidate", count: missingAny });

const report = {
  generatedAt: new Date().toISOString(),
  counts: {
    restaurants: restaurants.length,
    candidates: candidates.length,
    restaurantsWithApprovedThumbnail: approvedRestaurants.size,
    restaurantsWithAnyCandidate: anyCandidateRestaurants.size,
    restaurantsMissingApprovedThumbnail: missingApproved,
    restaurantsMissingAnyCandidate: missingAny
  },
  failures,
  warnings
};

await mkdir(new URL("../artifacts", import.meta.url), { recursive: true });
await writeFile(new URL("../artifacts/thumbnail-candidates-report.json", import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.counts, null, 2));
if (warnings.length) console.warn(`Thumbnail warnings: ${warnings.map((warning) => `${warning.type}=${warning.count}`).join(", ")}`);
if (failures.length) {
  console.error(JSON.stringify(failures.slice(0, 30), null, 2));
  process.exit(1);
}
console.log("Thumbnail candidate integrity checks passed.");
