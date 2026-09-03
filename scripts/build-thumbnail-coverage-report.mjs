import { mkdir, readFile, writeFile } from "node:fs/promises";

async function loadJson(path, fallback) {
  try {
    return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
  } catch {
    return fallback;
  }
}

function increment(target, key, amount = 1) {
  const normalized = String(key || "unknown");
  target[normalized] = (target[normalized] || 0) + amount;
}

function pct(count, total) {
  return total ? Number(((count / total) * 100).toFixed(1)) : 0;
}

function byName(a, b) {
  return String(a.name || a.restaurantName || "").localeCompare(String(b.name || b.restaurantName || ""));
}
function thumbnailReviewPriority(candidate) {
  if (Number.isFinite(Number(candidate?.reviewPriority))) return Number(candidate.reviewPriority);
  if (candidate?.eligibleForProduction) return 100;
  return 0;
}
function promotionCandidates(candidates = []) {
  return candidates.filter((candidate) => candidate.eligibleForProduction !== true && thumbnailReviewPriority(candidate) >= 45 && !(candidate.qualityFlags || []).length);
}
function sourceCheckCandidates(candidates = []) {
  return candidates.filter((candidate) => candidate.eligibleForProduction !== true && (candidate.reviewState === "source_check" || candidate.promotionReviewState === "source_check" || (candidate.qualityFlags || []).some((flag) => String(flag).includes("source"))));
}

function restaurantSummary(restaurant, candidates = []) {
  const sourceKinds = {};
  const reviewStates = {};
  for (const candidate of candidates) {
    increment(sourceKinds, candidate.sourceKind);
    increment(reviewStates, candidate.reviewState);
  }
  return {
    restaurantId: restaurant.restaurantId || restaurant.id,
    name: restaurant.name || restaurant.restaurantName || "Unknown restaurant",
    neighborhood: restaurant.neighborhood || restaurant.neighbourhood || null,
    website: restaurant.website || null,
    candidateCount: candidates.length,
    sourceKinds,
    reviewStates,
    bestCandidate: candidates[0] ? {
      id: candidates[0].id,
      thumbnailUrl: candidates[0].thumbnailUrl,
      sourceUrl: candidates[0].sourceUrl,
      sourceKind: candidates[0].sourceKind,
      reviewState: candidates[0].reviewState,
      rightsStatus: candidates[0].rightsStatus,
      confidence: candidates[0].confidence || null
    } : null
  };
}

const generatedAt = new Date().toISOString();
const catalog = await loadJson("data/build/catalog.json", { restaurants: [] });
const thumbnailPayload = await loadJson("data/build/thumbnail-candidates.json", { candidates: [], missingApproved: [], missingAnyCandidate: [], failures: [], counts: {} });
const restaurants = Array.isArray(catalog.restaurants) ? catalog.restaurants : [];
const candidates = Array.isArray(thumbnailPayload.candidates) ? thumbnailPayload.candidates : [];

const restaurantsById = new Map(restaurants.map((restaurant) => [restaurant.id, restaurant]));
const candidatesByRestaurant = new Map();
for (const candidate of candidates) {
  const list = candidatesByRestaurant.get(candidate.restaurantId) || [];
  list.push(candidate);
  candidatesByRestaurant.set(candidate.restaurantId, list);
}
for (const list of candidatesByRestaurant.values()) {
  list.sort((a, b) => Number(b.eligibleForProduction) - Number(a.eligibleForProduction) || String(a.sourceKind).localeCompare(String(b.sourceKind)) || String(a.thumbnailUrl).localeCompare(String(b.thumbnailUrl)));
}

const approvedCandidates = candidates.filter((candidate) => candidate.eligibleForProduction === true && candidate.reviewState === "approved" && candidate.rightsStatus === "production_approved");
const reviewCandidates = candidates.filter((candidate) => candidate.eligibleForProduction !== true);
const approvedRestaurantIds = new Set(approvedCandidates.map((candidate) => candidate.restaurantId));
const anyCandidateRestaurantIds = new Set(candidates.map((candidate) => candidate.restaurantId));

const sourceKindCounts = {};
const reviewStateCounts = {};
const rightsStatusCounts = {};
const extractionMethodCounts = {};
const platformCounts = {};
for (const candidate of candidates) {
  increment(sourceKindCounts, candidate.sourceKind);
  increment(reviewStateCounts, candidate.reviewState);
  increment(rightsStatusCounts, candidate.rightsStatus);
  increment(extractionMethodCounts, candidate.extractionMethod);
  if (candidate.platform) increment(platformCounts, candidate.platform);
}

const missingApproved = (Array.isArray(thumbnailPayload.missingApproved) && thumbnailPayload.missingApproved.length
  ? thumbnailPayload.missingApproved
  : restaurants.filter((restaurant) => !approvedRestaurantIds.has(restaurant.id)))
  .map((restaurant) => restaurantSummary(restaurant, candidatesByRestaurant.get(restaurant.restaurantId || restaurant.id) || []))
  .sort(byName);
const missingAnyCandidate = (Array.isArray(thumbnailPayload.missingAnyCandidate) && thumbnailPayload.missingAnyCandidate.length
  ? thumbnailPayload.missingAnyCandidate
  : restaurants.filter((restaurant) => !anyCandidateRestaurantIds.has(restaurant.id)))
  .map((restaurant) => restaurantSummary(restaurant, []))
  .sort(byName);
const promotionQueue = missingApproved
  .map((restaurant) => {
    const candidates = promotionCandidates(candidatesByRestaurant.get(restaurant.restaurantId) || []);
    return restaurantSummary(restaurant, candidates);
  })
  .filter((restaurant) => restaurant.candidateCount > 0)
  .sort((a, b) => b.candidateCount - a.candidateCount || byName(a, b));
const discoveryQueue = missingAnyCandidate;
const sourceCheckQueue = missingApproved
  .map((restaurant) => {
    const candidates = sourceCheckCandidates(candidatesByRestaurant.get(restaurant.restaurantId) || []);
    return restaurantSummary(restaurant, candidates);
  })
  .filter((restaurant) => restaurant.candidateCount > 0)
  .sort((a, b) => b.candidateCount - a.candidateCount || byName(a, b));

const report = {
  version: 1,
  generatedAt,
  sourceCommitSha: process.env.SOURCE_COMMIT_SHA || process.env.GITHUB_SHA || null,
  definitions: {
    approvedThumbnail: "A thumbnail candidate tied to an exact restaurant ID with approved review state and production-approved rights status.",
    anyThumbnailCandidate: "Any source-backed thumbnail lead for a restaurant, including official feed, Meta API, official page metadata, or already approved media.",
    promotionQueue: "Restaurants missing an approved thumbnail but having one or more quality-screened candidate images that can be visually reviewed for rights and fit.",
    discoveryQueue: "Restaurants with no current thumbnail candidate in the generated source-backed candidate set."
  },
  counts: {
    restaurants: restaurants.length,
    candidates: candidates.length,
    approvedCandidates: approvedCandidates.length,
    reviewCandidates: reviewCandidates.length,
    restaurantsWithApprovedThumbnail: approvedRestaurantIds.size,
    restaurantsWithAnyCandidate: anyCandidateRestaurantIds.size,
    restaurantsMissingApprovedThumbnail: Math.max(0, restaurants.length - approvedRestaurantIds.size),
    restaurantsMissingAnyCandidate: Math.max(0, restaurants.length - anyCandidateRestaurantIds.size),
    promotionQueue: promotionQueue.length,
    sourceCheckQueue: sourceCheckQueue.length,
    discoveryQueue: discoveryQueue.length,
    fetchFailures: Array.isArray(thumbnailPayload.failures) ? thumbnailPayload.failures.length : 0
  },
  coveragePercent: {
    approvedThumbnail: pct(approvedRestaurantIds.size, restaurants.length),
    anyThumbnailCandidate: pct(anyCandidateRestaurantIds.size, restaurants.length),
    missingApprovedThumbnail: pct(Math.max(0, restaurants.length - approvedRestaurantIds.size), restaurants.length),
    missingAnyThumbnailCandidate: pct(Math.max(0, restaurants.length - anyCandidateRestaurantIds.size), restaurants.length)
  },
  candidateMix: {
    bySourceKind: sourceKindCounts,
    byReviewState: reviewStateCounts,
    byRightsStatus: rightsStatusCounts,
    byExtractionMethod: extractionMethodCounts,
    byPlatform: platformCounts
  },
  queues: {
    promotionQueue: promotionQueue.slice(0, 300),
    sourceCheckQueue: sourceCheckQueue.slice(0, 300),
    discoveryQueue: discoveryQueue.slice(0, 300),
    reviewCandidates: reviewCandidates.slice(0, 300).map((candidate) => ({
      id: candidate.id,
      restaurantId: candidate.restaurantId,
      restaurantName: candidate.restaurantName,
      thumbnailUrl: candidate.thumbnailUrl,
      sourceUrl: candidate.sourceUrl,
      sourceKind: candidate.sourceKind,
      reviewState: candidate.reviewState,
      rightsStatus: candidate.rightsStatus,
      confidence: candidate.confidence || null,
      observedAt: candidate.observedAt || null,
      publishedAt: candidate.publishedAt || null
    }))
  },
  failures: Array.isArray(thumbnailPayload.failures) ? thumbnailPayload.failures.slice(0, 200) : []
};

function metricRow(label, count, coverageBase = restaurants.length) {
  return `| ${label} | ${Number(count).toLocaleString()} | ${coverageBase ? `${pct(count, coverageBase)}%` : "n/a"} |`;
}
function countRows(values) {
  const entries = Object.entries(values || {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries.length ? entries.map(([key, value]) => `| ${key} | ${value.toLocaleString()} |`).join("\n") : "| None | 0 |";
}
function queueRows(items) {
  return items.length ? items.slice(0, 40).map((item) => `| ${item.name} | ${item.neighborhood || "Unknown"} | ${item.candidateCount} | ${item.bestCandidate?.sourceKind || "None"} | ${item.website || ""} |`).join("\n") : "| None | n/a | 0 | None | |";
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? "\"" + text.replace(/"/g, "\"\"") + "\"" : text;
}

function csvRows(headers, rows) {
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n") + "\n";
}

function sourceCheckExportRows(queue) {
  return queue.flatMap((item) => (candidatesByRestaurant.get(item.restaurantId) || [])
    .filter((candidate) => sourceCheckCandidates([candidate]).length)
    .map((candidate) => ({
      restaurant_id: item.restaurantId,
      restaurant_name: item.name,
      neighborhood: item.neighborhood || "",
      website: item.website || "",
      candidate_id: candidate.id,
      thumbnail_url: candidate.thumbnailUrl,
      source_url: candidate.sourceUrl,
      source_kind: candidate.sourceKind,
      source_host: candidate.sourceHost || "",
      image_host: candidate.imageHost || "",
      source_host_validation: candidate.sourceHostValidation || "",
      review_state: candidate.reviewState || "",
      promotion_review_state: candidate.promotionReviewState || "",
      rights_status: candidate.rightsStatus || "",
      quality_flags: (candidate.qualityFlags || []).join(";"),
      recommended_action: candidate.sourceKind === "official_page_thumbnail_candidate" ? "confirm first-party page/image provenance, then visually review" : "confirm source rights/provenance before promotion"
    })));
}

function ownerOutreachRows(queue) {
  return queue.map((item) => ({
    restaurant_id: item.restaurantId,
    name: item.name,
    neighborhood: item.neighborhood || "",
    cuisines: "",
    vibe: "",
    special_title: "",
    special_cadence: "",
    event_title: "",
    event_timing: "",
    source_url: item.website || "",
    contact_email: "",
    image_url: "",
    image_alt: item.name ? item.name + " restaurant photo" : "Restaurant photo",
    image_source_url: "",
    image_source_type: "owner_submission",
    image_rights_basis: "owner_attestation",
    image_permission_confirmed: "",
    image_attribution: item.name || "",
    image_review_state: "needs_review"
  }));
}

const sourceCheckRows = sourceCheckExportRows(sourceCheckQueue);
const ownerRows = ownerOutreachRows(discoveryQueue);
report.exports = {
  sourceCheckQueueJson: "data/build/thumbnail-source-check-queue.json",
  sourceCheckQueueCsv: "data/build/thumbnail-source-check-queue.csv",
  sourceCheckRows: sourceCheckRows.length,
  ownerMediaOutreachJson: "data/build/owner-media-outreach.json",
  ownerMediaOutreachCsv: "data/build/owner-media-outreach.csv",
  ownerMediaOutreachRows: ownerRows.length
};

const markdown = `# Halifax Sourced thumbnail coverage report\n\nGenerated: ${report.generatedAt}\n\nThis report tracks source-backed image leads for restaurant thumbnails. It separates production-approved media from candidates that still need review, attribution, or permission before they can become default restaurant card imagery.\n\n## Coverage\n\n| Metric | Count | Coverage |\n| --- | ---: | ---: |\n${metricRow("Catalog restaurants", report.counts.restaurants, report.counts.restaurants)}\n${metricRow("Restaurants with approved thumbnail", report.counts.restaurantsWithApprovedThumbnail)}\n${metricRow("Restaurants with any thumbnail candidate", report.counts.restaurantsWithAnyCandidate)}\n${metricRow("Restaurants missing approved thumbnail", report.counts.restaurantsMissingApprovedThumbnail)}\n${metricRow("Restaurants missing any candidate", report.counts.restaurantsMissingAnyCandidate)}\n${metricRow("Promotion queue", report.counts.promotionQueue)}\n${metricRow("Source-check queue", report.counts.sourceCheckQueue)}\n${metricRow("Discovery queue", report.counts.discoveryQueue)}\n\nTotal thumbnail candidates: **${report.counts.candidates}**. Review-needed candidates: **${report.counts.reviewCandidates}**. Fetch failures in the latest run: **${report.counts.fetchFailures}**.\n\n## Candidate source mix\n\n| Source kind | Candidates |\n| --- | ---: |\n${countRows(report.candidateMix.bySourceKind)}\n\n## Review and rights state\n\n| Review state | Candidates |\n| --- | ---: |\n${countRows(report.candidateMix.byReviewState)}\n\n| Rights state | Candidates |\n| --- | ---: |\n${countRows(report.candidateMix.byRightsStatus)}\n\n## Promotion queue\n\nRestaurants below are missing approved thumbnails but have source-backed candidates that passed the metadata quality screen and are ready for visual review.\n\n| Restaurant | Neighbourhood | Candidates | Best source | Website |\n| --- | --- | ---: | --- | --- |\n${queueRows(promotionQueue)}\n\n## Source-check queue

Restaurants below have thumbnail candidates held for source-host, provenance, or first-party validation review before promotion.

| Restaurant | Neighbourhood | Candidates | Best source | Website |
| --- | --- | ---: | --- | --- |
${queueRows(sourceCheckQueue)}

## Discovery queue\n\nRestaurants below have no thumbnail candidate yet and should be prioritized for official-site metadata, owner-submitted media, or approved public media discovery.\n\n| Restaurant | Neighbourhood | Candidates | Best source | Website |\n| --- | --- | ---: | --- | --- |\n${queueRows(discoveryQueue)}\n\nMachine-readable queues are in \`data/build/thumbnail-coverage-report.json\`. CSV handoff files are generated at \`data/build/thumbnail-source-check-queue.csv\` and \`data/build/owner-media-outreach.csv\`.\n`;

await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await mkdir(new URL("../artifacts", import.meta.url), { recursive: true });
await mkdir(new URL("../docs", import.meta.url), { recursive: true });
const json = JSON.stringify(report, null, 2);
await writeFile(new URL("../data/build/thumbnail-source-check-queue.json", import.meta.url), JSON.stringify({ generatedAt, count: sourceCheckRows.length, records: sourceCheckRows }, null, 2) + "\n");
await writeFile(new URL("../data/build/thumbnail-source-check-queue.csv", import.meta.url), csvRows(["restaurant_id", "restaurant_name", "neighborhood", "website", "candidate_id", "thumbnail_url", "source_url", "source_kind", "source_host", "image_host", "source_host_validation", "review_state", "promotion_review_state", "rights_status", "quality_flags", "recommended_action"], sourceCheckRows));
await writeFile(new URL("../data/build/owner-media-outreach.json", import.meta.url), JSON.stringify({ generatedAt, count: ownerRows.length, records: ownerRows }, null, 2) + "\n");
await writeFile(new URL("../data/build/owner-media-outreach.csv", import.meta.url), csvRows(["restaurant_id", "name", "neighborhood", "cuisines", "vibe", "special_title", "special_cadence", "event_title", "event_timing", "source_url", "contact_email", "image_url", "image_alt", "image_source_url", "image_source_type", "image_rights_basis", "image_permission_confirmed", "image_attribution", "image_review_state"], ownerRows));
await writeFile(new URL("../data/build/thumbnail-coverage-report.json", import.meta.url), json);
await writeFile(new URL("../artifacts/thumbnail-coverage-report.json", import.meta.url), json);
await writeFile(new URL("../docs/thumbnail-coverage-report.md", import.meta.url), markdown);
console.log(JSON.stringify({ counts: report.counts, coveragePercent: report.coveragePercent, candidateMix: report.candidateMix }, null, 2));
console.log("Thumbnail coverage report written to data/build/thumbnail-coverage-report.json, artifacts/thumbnail-coverage-report.json, and docs/thumbnail-coverage-report.md.");
