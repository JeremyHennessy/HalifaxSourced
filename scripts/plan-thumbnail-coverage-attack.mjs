import { mkdir, readFile, writeFile } from "node:fs/promises";
import vm from "node:vm";

const generatedAt = new Date().toISOString();
const directLimit = Math.max(1, Number(process.env.THUMBNAIL_PROMOTION_DIRECT_LIMIT ?? 50));
const sourceCheckLimit = Math.max(1, Number(process.env.THUMBNAIL_SOURCE_CHECK_LIMIT ?? 75));
const applyPromotion = String(process.env.THUMBNAIL_PROMOTION_APPLY ?? "0") === "1";
const outputRoot = new URL("../", import.meta.url);
const approvedRemoteRightsBasis = "App-owner-reviewed HTTPS image reference from the restaurant official website or official feed; remote thumbnail reference only, not rehosted.";

const directPromotionSourceKinds = new Set([
  "official_page_thumbnail_candidate",
  "official_feed_media",
  "approved_restaurant_media",
  "owner_submitted_image"
]);
const productionReadyConfidence = new Set([
  "same_host_official_page_image",
  "official_page_approved_cdn_image",
  "official_feed_media",
  "approved_exact_restaurant_id",
  "owner_submitted_permission_declared"
]);
const hardBlockFlags = new Set([
  "insecure_thumbnail_url",
  "icon_or_favicon",
  "placeholder_image",
  "logo_candidate",
  "generic_social_card",
  "generic_brand_or_stock_image",
  "social_profile_image",
  "thumbnail_is_page_url",
  "blocked_source_host",
  "blocked_image_host",
  "source_host_not_first_party",
  "non_image_response",
  "tiny_decoded_image",
  "awkward_thumbnail_aspect",
  "very_small_image_payload",
  "image_probe_failed"
]);
const sourceCheckOnlyFlags = new Set([
  "remote_image_host_needs_source_check",
  "reviewed_needs_source_check"
]);

async function loadJson(path, fallback) {
  try {
    return JSON.parse(await readFile(new URL(path, outputRoot), "utf8"));
  } catch {
    return fallback;
  }
}

async function loadWindowScript(path, globalName, fallback) {
  try {
    const source = await readFile(new URL(path, outputRoot), "utf8");
    const context = { window: {} };
    vm.createContext(context);
    vm.runInContext(source, context, { filename: path, timeout: 20_000 });
    return context.window[globalName] ?? fallback;
  } catch {
    return fallback;
  }
}

function token(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function safeUrl(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function host(value) {
  try {
    return new URL(String(value ?? "")).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function flags(value) {
  if (Array.isArray(value)) return value.map(token).filter(Boolean);
  return String(value ?? "").split(/[;|,]/).map(token).filter(Boolean);
}

function hasHardBlock(candidate) {
  return flags(candidate?.qualityFlags).some((flag) => hardBlockFlags.has(flag) || flag.startsWith("reviewed_rejected"));
}

function priority(candidate) {
  const score = Number(candidate?.reviewPriority);
  return Number.isFinite(score) ? score : candidate?.eligibleForProduction ? 100 : 0;
}

function sameHostOrApprovedCdn(candidate) {
  const state = token(candidate?.sourceHostValidation);
  if (["first_party_image_host", "approved_cdn_image_host"].includes(state)) return true;
  if (!state && productionReadyConfidence.has(String(candidate?.confidence || ""))) return true;
  return productionReadyConfidence.has(String(candidate?.confidence || ""));
}

function canDirectPromote(candidate) {
  if (!candidate || candidate.eligibleForProduction === true) return false;
  if (token(candidate.reviewState) !== "candidate_review") return false;
  if (token(candidate.rightsStatus) !== "requires_rights_review") return false;
  if (token(candidate.promotionReviewState) === "source_check") return false;
  if (!directPromotionSourceKinds.has(String(candidate.sourceKind || ""))) return false;
  if (String(candidate.sourceKind || "") === "owner_submitted_image") {
    return candidate.permissionConfirmed === true && Boolean(candidate.rightsBasis) && Boolean(candidate.attribution) && !hasHardBlock(candidate);
  }
  if (!safeUrl(candidate.thumbnailUrl) || !safeUrl(candidate.sourceUrl)) return false;
  if (!String(candidate.thumbnailUrl).startsWith("https://")) return false;
  if (!sameHostOrApprovedCdn(candidate)) return false;
  return priority(candidate) >= 45 && !hasHardBlock(candidate);
}

function directScore(candidate) {
  let score = priority(candidate);
  const confidence = String(candidate?.confidence || "");
  if (confidence === "same_host_official_page_image") score += 22;
  if (confidence === "official_page_approved_cdn_image") score += 20;
  if (confidence === "official_feed_media") score += 14;
  if (candidate?.sourceKind === "owner_submitted_image") score += 18;
  if (["html_img_content", "jsonld_image"].includes(candidate?.extractionMethod)) score += 3;
  if (["html_meta_image", "html_link_image", "css_background_image"].includes(candidate?.extractionMethod)) score -= 2;
  const width = Number(candidate?.width);
  const height = Number(candidate?.height);
  if (Number.isFinite(width) && Number.isFinite(height)) {
    if (width >= 900 && height >= 480) score += 6;
    else if (width >= 600 && height >= 320) score += 3;
  }
  const name = String(candidate?.restaurantName || "").toLowerCase();
  if (/\b(subway|pizza pizza|papa john|mcdonald|burger king|kfc|a&w|tim hortons)\b/.test(name)) score -= 6;
  return score;
}

function candidateExport(candidate, rank, action) {
  return {
    rank,
    recommended_action: action,
    restaurant_id: candidate.restaurantId,
    restaurant_name: candidate.restaurantName,
    neighborhood: candidate.neighborhood || candidate.neighbourhood || "",
    candidate_id: candidate.id,
    thumbnail_url: candidate.thumbnailUrl,
    source_url: candidate.sourceUrl,
    source_kind: candidate.sourceKind,
    extraction_method: candidate.extractionMethod || "",
    confidence: candidate.confidence || "",
    source_host_validation: candidate.sourceHostValidation || "",
    image_host: candidate.imageHost || host(candidate.thumbnailUrl),
    source_host: candidate.sourceHost || host(candidate.sourceUrl),
    width: candidate.width || "",
    height: candidate.height || "",
    review_priority: priority(candidate),
    direct_score: Math.round(directScore(candidate) * 10) / 10,
    quality_flags: flags(candidate.qualityFlags).join(";"),
    rights_status: candidate.rightsStatus || "",
    review_state: candidate.reviewState || ""
  };
}

function cleanSourceCheck(row) {
  const rowFlags = flags(row.quality_flags || row.qualityFlags);
  if (!rowFlags.length) return true;
  return rowFlags.every((flag) => sourceCheckOnlyFlags.has(flag));
}

function sourceCheckScore(row) {
  const rowFlags = flags(row.quality_flags || row.qualityFlags);
  let score = 50;
  if (cleanSourceCheck(row)) score += 20;
  if (token(row.source_host_validation) === "remote_image_host_needs_source_check") score += 8;
  if (String(row.thumbnail_url || row.thumbnailUrl || "").startsWith("https://")) score += 4;
  for (const flag of rowFlags) {
    if (hardBlockFlags.has(flag)) score -= 30;
  }
  return score;
}

function sourceCheckExport(row, rank) {
  const rowFlags = flags(row.quality_flags || row.qualityFlags);
  return {
    rank,
    recommended_action: cleanSourceCheck(row) ? "verify remote image host is first-party-controlled, then move to visual promotion review" : "reject or keep held until quality/source issues are resolved",
    restaurant_id: row.restaurant_id || row.restaurantId,
    restaurant_name: row.restaurant_name || row.restaurantName,
    neighborhood: row.neighborhood || "",
    website: row.website || "",
    candidate_id: row.candidate_id || row.candidateId,
    thumbnail_url: row.thumbnail_url || row.thumbnailUrl,
    source_url: row.source_url || row.sourceUrl,
    source_kind: row.source_kind || row.sourceKind,
    source_host: row.source_host || row.sourceHost || host(row.source_url || row.sourceUrl),
    image_host: row.image_host || row.imageHost || host(row.thumbnail_url || row.thumbnailUrl),
    source_host_validation: row.source_host_validation || row.sourceHostValidation || "",
    quality_flags: rowFlags.join(";"),
    source_check_score: sourceCheckScore(row)
  };
}

function outreachScore(row) {
  let score = 0;
  if (safeUrl(row.source_url || row.sourceUrl)) score += 30;
  if (String(row.neighborhood || "").trim()) score += 5;
  return score;
}

function outreachExport(row, rank) {
  const hasWebsite = Boolean(safeUrl(row.source_url || row.sourceUrl));
  return {
    outreach_rank: rank,
    outreach_priority: hasWebsite ? "website_first" : "manual_contact_lookup",
    recommended_action: hasWebsite ? "use official site/contact page for owner media permission request" : "find verified owner contact before requesting media",
    restaurant_id: row.restaurant_id || row.restaurantId,
    name: row.name || row.restaurant_name || row.restaurantName,
    neighborhood: row.neighborhood || "",
    cuisines: row.cuisines || "",
    vibe: row.vibe || "",
    special_title: row.special_title || "",
    special_cadence: row.special_cadence || "",
    event_title: row.event_title || "",
    event_timing: row.event_timing || "",
    source_url: row.source_url || row.sourceUrl || "",
    contact_email: row.contact_email || "",
    image_url: row.image_url || "",
    image_alt: row.image_alt || `${row.name || row.restaurant_name || "Restaurant"} restaurant photo`,
    image_source_url: row.image_source_url || "",
    image_source_type: row.image_source_type || "owner_submission",
    image_rights_basis: row.image_rights_basis || "owner_attestation",
    image_permission_confirmed: row.image_permission_confirmed || "",
    image_attribution: row.image_attribution || row.name || "",
    image_review_state: row.image_review_state || "needs_review"
  };
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, """")}"` : text;
}

function csvRows(headers, rows) {
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n") + "\n";
}

function upsertByRestaurant(existing, additions) {
  const byRestaurant = new Map();
  for (const record of existing) byRestaurant.set(record.restaurantId, record);
  for (const record of additions) {
    if (!byRestaurant.has(record.restaurantId)) byRestaurant.set(record.restaurantId, record);
  }
  return [...byRestaurant.values()].sort((a, b) => String(a.restaurantId).localeCompare(String(b.restaurantId)));
}

function mediaRecordFromCandidate(row) {
  return {
    restaurantId: row.restaurant_id,
    url: row.thumbnail_url,
    alt: `${row.restaurant_name} official website image`,
    sourceUrl: row.source_url,
    sourceType: "official_site_permitted",
    creator: row.restaurant_name,
    license: "First-party official site media",
    rightsBasis: approvedRemoteRightsBasis,
    permission: "permitted",
    permissionConfirmed: true,
    attribution: `${row.restaurant_name}, official website`,
    reviewState: "approved",
    reviewedAt: generatedAt,
    reviewCandidateId: row.candidate_id
  };
}

function decisionRecordFromCandidate(row) {
  return {
    id: row.candidate_id,
    restaurantId: row.restaurant_id,
    restaurantName: row.restaurant_name,
    thumbnailUrl: row.thumbnail_url,
    sourceUrl: row.source_url,
    decision: "approve_thumbnail",
    decidedAt: generatedAt,
    decidedBy: "Halifax Sourced governed thumbnail promotion planner",
    note: "Clean direct-promotion candidate selected from source-backed thumbnail queue.",
    sourceKind: row.source_kind,
    extractionMethod: row.extraction_method,
    confidence: row.confidence,
    reviewPriority: row.review_priority,
    visualReviewState: "ready_for_media_manifest",
    permission: "permitted",
    permissionConfirmed: true,
    rightsBasis: approvedRemoteRightsBasis,
    attribution: `${row.restaurant_name}, official website`
  };
}

async function applyDirectPromotions(rows) {
  const decisions = await loadJson("data/reviewed-thumbnail-decisions.json", { version: 1, records: [] });
  const media = await loadWindowScript("data/restaurant-media.js", "HALIFAX_RESTAURANT_MEDIA", { version: 1, records: [] });
  const priority = await loadJson("data/restaurant-media-priority.json", { version: 1, records: [] });
  const existingDecisionKeys = new Set((decisions.records || []).map((record) => record.id || `${record.restaurantId}|${record.thumbnailUrl}`));
  const newDecisionRecords = rows
    .map(decisionRecordFromCandidate)
    .filter((record) => !existingDecisionKeys.has(record.id) && !existingDecisionKeys.has(`${record.restaurantId}|${record.thumbnailUrl}`));
  const mediaRecords = rows.map(mediaRecordFromCandidate);
  const mergedMedia = upsertByRestaurant(media.records || [], mediaRecords);
  const priorityByRestaurant = new Map((priority.records || []).map((record) => [record.restaurantId, record]));
  for (const row of rows) {
    priorityByRestaurant.set(row.restaurant_id, { restaurantId: row.restaurant_id, name: row.restaurant_name, status: "approved" });
  }
  const priorityRecords = [...priorityByRestaurant.values()].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")) || String(a.restaurantId).localeCompare(String(b.restaurantId)));
  const updatedDecisions = {
    ...decisions,
    generatedAt,
    counts: {
      approved: (decisions.records || []).filter((record) => token(record.decision) === "approve_thumbnail").length + newDecisionRecords.length,
      rejected: (decisions.records || []).filter((record) => ["reject_thumbnail", "reject_candidate"].includes(token(record.decision))).length,
      needsSourceCheck: (decisions.records || []).filter((record) => token(record.decision) === "needs_source_check").length,
      total: (decisions.records || []).length + newDecisionRecords.length
    },
    records: [...(decisions.records || []), ...newDecisionRecords]
  };
  const updatedMedia = {
    ...media,
    version: Number(media.version || 0) + 1,
    generatedAt,
    records: mergedMedia
  };
  const updatedPriority = {
    ...priority,
    generatedAt,
    targetCount: priorityRecords.length,
    records: priorityRecords
  };
  await writeFile(new URL("data/reviewed-thumbnail-decisions.json", outputRoot), JSON.stringify(updatedDecisions, null, 2) + "\n");
  await writeFile(new URL("data/restaurant-media.js", outputRoot), `window.HALIFAX_RESTAURANT_MEDIA = ${JSON.stringify(updatedMedia, null, 2)};\n`);
  await writeFile(new URL("data/restaurant-media-priority.json", outputRoot), JSON.stringify(updatedPriority, null, 2) + "\n");
  return { decisionsAdded: newDecisionRecords.length, mediaRecords: mergedMedia.length, priorityRecords: priorityRecords.length };
}

const catalog = await loadJson("data/build/catalog.json", { restaurants: [] });
const thumbnailPayload = await loadJson("data/build/thumbnail-candidates.json", { candidates: [], missingAnyCandidate: [], counts: {} });
const coverageReport = await loadJson("data/build/thumbnail-coverage-report.json", { counts: {}, queues: {} });
const sourceCheckPayload = await loadJson("data/build/thumbnail-source-check-queue.json", { records: [] });
const ownerOutreachPayload = await loadJson("data/build/owner-media-outreach.json", { records: [] });
const candidates = Array.isArray(thumbnailPayload.candidates) ? thumbnailPayload.candidates : [];
const restaurants = Array.isArray(catalog.restaurants) ? catalog.restaurants : [];
const restaurantsById = new Map(restaurants.map((restaurant) => [restaurant.id, restaurant]));
const approvedRestaurantIds = new Set(candidates.filter((candidate) => candidate.eligibleForProduction).map((candidate) => candidate.restaurantId));

const directEligible = candidates
  .filter((candidate) => canDirectPromote(candidate) && !approvedRestaurantIds.has(candidate.restaurantId))
  .map((candidate) => ({ ...candidate, ...(restaurantsById.get(candidate.restaurantId) || {}) }))
  .sort((a, b) => directScore(b) - directScore(a) || String(a.restaurantName || a.name || "").localeCompare(String(b.restaurantName || b.name || "")));
const bestByRestaurant = [];
const seenRestaurants = new Set();
for (const candidate of directEligible) {
  if (seenRestaurants.has(candidate.restaurantId)) continue;
  seenRestaurants.add(candidate.restaurantId);
  bestByRestaurant.push(candidate);
}
const directPromotionRows = bestByRestaurant.map((candidate, index) => candidateExport(candidate, index + 1, index < directLimit ? "promote_to_restaurant_media_first" : "keep_in_direct_promotion_backlog"));
const directPromotionBatch = directPromotionRows.slice(0, directLimit);
const directPromotionBacklog = directPromotionRows.slice(directLimit);

const sourceCheckRows = (sourceCheckPayload.records || [])
  .filter((row) => !approvedRestaurantIds.has(row.restaurant_id || row.restaurantId))
  .sort((a, b) => sourceCheckScore(b) - sourceCheckScore(a) || String(a.restaurant_name || "").localeCompare(String(b.restaurant_name || "")))
  .map((row, index) => sourceCheckExport(row, index + 1));
const cleanSourceCheckRows = sourceCheckRows.filter((row) => !flags(row.quality_flags).some((flag) => hardBlockFlags.has(flag)));
const sourceCheckFirst = cleanSourceCheckRows.slice(0, sourceCheckLimit);

const ownerOutreachRows = (ownerOutreachPayload.records || [])
  .sort((a, b) => outreachScore(b) - outreachScore(a) || String(a.name || a.restaurant_name || "").localeCompare(String(b.name || b.restaurant_name || "")))
  .map((row, index) => outreachExport(row, index + 1));

let applyResult = null;
if (applyPromotion) {
  applyResult = await applyDirectPromotions(directPromotionBatch);
}

const plan = {
  version: 1,
  generatedAt,
  mode: applyPromotion ? "applied_direct_promotions" : "plan_only",
  sourceCommitSha: process.env.SOURCE_COMMIT_SHA || process.env.GITHUB_SHA || null,
  policy: {
    directPromotion: "Only exact-ID official-page/feed/owner candidates with HTTPS images, no hard quality flags, and first-party or approved-CDN provenance enter the direct promotion batch.",
    sourceCheck: "Remote image hosts and reviewed source-check rows stay held until first-party control, image content, and rights fit are manually confirmed.",
    ownerOutreach: "Restaurants with no candidate remain an owner-submission queue and require explicit owner attestation before production media."
  },
  inputs: {
    restaurants: restaurants.length,
    thumbnailCandidatesGeneratedAt: thumbnailPayload.generatedAt || null,
    thumbnailCoverageGeneratedAt: coverageReport.generatedAt || null,
    ownerOutreachGeneratedAt: ownerOutreachPayload.generatedAt || null,
    sourceCheckGeneratedAt: sourceCheckPayload.generatedAt || null
  },
  counts: {
    restaurants: restaurants.length,
    candidates: candidates.length,
    restaurantsWithApprovedThumbnail: coverageReport.counts?.restaurantsWithApprovedThumbnail ?? approvedRestaurantIds.size,
    restaurantsMissingApprovedThumbnail: coverageReport.counts?.restaurantsMissingApprovedThumbnail ?? null,
    restaurantsMissingAnyCandidate: coverageReport.counts?.restaurantsMissingAnyCandidate ?? ownerOutreachRows.length,
    promotionQueueRestaurants: coverageReport.counts?.promotionQueue ?? null,
    sourceCheckQueueRestaurants: coverageReport.counts?.sourceCheckQueue ?? null,
    directPromotionEligibleRestaurants: directPromotionRows.length,
    directPromotionBatch: directPromotionBatch.length,
    directPromotionBacklog: directPromotionBacklog.length,
    cleanSourceCheckCandidates: cleanSourceCheckRows.length,
    sourceCheckFirst: sourceCheckFirst.length,
    ownerOutreachRows: ownerOutreachRows.length
  },
  applyResult,
  queues: {
    directPromotionBatch,
    directPromotionBacklog,
    sourceCheckFirst,
    ownerOutreachPriority: ownerOutreachRows
  }
};

function countBy(rows, getter) {
  const counts = {};
  for (const row of rows) {
    const key = getter(row) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

plan.mix = {
  directPromotionByConfidence: countBy(directPromotionRows, (row) => row.confidence),
  directPromotionBySourceKind: countBy(directPromotionRows, (row) => row.source_kind),
  ownerOutreachByPriority: countBy(ownerOutreachRows, (row) => row.outreach_priority)
};

const promotionHeaders = ["rank", "recommended_action", "restaurant_id", "restaurant_name", "neighborhood", "candidate_id", "thumbnail_url", "source_url", "source_kind", "extraction_method", "confidence", "source_host_validation", "image_host", "source_host", "width", "height", "review_priority", "direct_score", "quality_flags", "rights_status", "review_state"];
const sourceCheckHeaders = ["rank", "recommended_action", "restaurant_id", "restaurant_name", "neighborhood", "website", "candidate_id", "thumbnail_url", "source_url", "source_kind", "source_host", "image_host", "source_host_validation", "quality_flags", "source_check_score"];
const outreachHeaders = ["outreach_rank", "outreach_priority", "recommended_action", "restaurant_id", "name", "neighborhood", "cuisines", "vibe", "special_title", "special_cadence", "event_title", "event_timing", "source_url", "contact_email", "image_url", "image_alt", "image_source_url", "image_source_type", "image_rights_basis", "image_permission_confirmed", "image_attribution", "image_review_state"];

const markdown = `# Thumbnail coverage attack plan\n\nGenerated: ${generatedAt}\n\nThis plan works thumbnail coverage in three governed batches: direct-promotion candidates first, source-check holds second, and owner outreach for restaurants that still have no candidate.\n\n## Counts\n\n| Metric | Count |\n| --- | ---: |\n| Restaurants | ${plan.counts.restaurants.toLocaleString()} |\n| Thumbnail candidates | ${plan.counts.candidates.toLocaleString()} |\n| Restaurants with approved thumbnail | ${Number(plan.counts.restaurantsWithApprovedThumbnail || 0).toLocaleString()} |\n| Restaurants missing approved thumbnail | ${Number(plan.counts.restaurantsMissingApprovedThumbnail || 0).toLocaleString()} |\n| Restaurants missing any candidate | ${Number(plan.counts.restaurantsMissingAnyCandidate || 0).toLocaleString()} |\n| Direct-promotion eligible restaurants | ${plan.counts.directPromotionEligibleRestaurants.toLocaleString()} |\n| Direct-promotion first batch | ${plan.counts.directPromotionBatch.toLocaleString()} |\n| Clean source-check candidates | ${plan.counts.cleanSourceCheckCandidates.toLocaleString()} |\n| Owner outreach rows | ${plan.counts.ownerOutreachRows.toLocaleString()} |\n\n## First batch\n\nThe first batch is written to \`data/build/thumbnail-promotion-plan.csv\`. Apply mode is intentionally opt-in with \`THUMBNAIL_PROMOTION_APPLY=1\`; normal Quality Gate runs only emit the plan.\n\n## Source-check pass\n\nThe source-check shortlist is written to \`data/build/thumbnail-source-check-priority.csv\`. These records are not production-ready until the remote image host and first-party provenance have been checked.\n\n## Owner outreach\n\nThe no-candidate outreach list is written to \`data/build/thumbnail-owner-outreach-priority.csv\` with all ${plan.counts.ownerOutreachRows.toLocaleString()} current owner-submission rows.\n`;

await mkdir(new URL("data/build", outputRoot), { recursive: true });
await mkdir(new URL("artifacts", outputRoot), { recursive: true });
await mkdir(new URL("docs", outputRoot), { recursive: true });
await writeFile(new URL("data/build/thumbnail-promotion-plan.json", outputRoot), JSON.stringify(plan, null, 2) + "\n");
await writeFile(new URL("artifacts/thumbnail-promotion-plan.json", outputRoot), JSON.stringify(plan, null, 2) + "\n");
await writeFile(new URL("data/build/thumbnail-promotion-plan.csv", outputRoot), csvRows(promotionHeaders, directPromotionRows));
await writeFile(new URL("data/build/thumbnail-source-check-priority.csv", outputRoot), csvRows(sourceCheckHeaders, sourceCheckRows));
await writeFile(new URL("data/build/thumbnail-owner-outreach-priority.json", outputRoot), JSON.stringify({ generatedAt, count: ownerOutreachRows.length, records: ownerOutreachRows }, null, 2) + "\n");
await writeFile(new URL("data/build/thumbnail-owner-outreach-priority.csv", outputRoot), csvRows(outreachHeaders, ownerOutreachRows));
await writeFile(new URL("docs/thumbnail-coverage-attack-plan.md", outputRoot), markdown);

console.log(JSON.stringify({ counts: plan.counts, mode: plan.mode, applyResult }, null, 2));
console.log("Thumbnail coverage attack plan written to data/build, artifacts, and docs.");
