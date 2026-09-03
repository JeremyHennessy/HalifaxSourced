"use strict";

const THUMBNAIL_REVIEW_STORAGE_KEY = "halifaxSourced.thumbnailReview.v1";
const SOCIAL_REVIEW_STORAGE_KEY = "halifaxSourced.socialPostReview.v1";
const PLACE_REVIEW_STORAGE_KEY = "halifaxSourced.placeReview.v1";
const thumbnailAdminState = { queue: "promotion", sourceKind: "all", reviewState: "all", decisionState: "undecided" };
const DIRECT_PROMOTION_SOURCE_KINDS = new Set(["official_page_thumbnail_candidate", "official_feed_media", "approved_restaurant_media"]);
const APPROVED_REMOTE_THUMBNAIL_RIGHTS_BASIS = "App-owner-reviewed HTTPS image reference from the restaurant official website or official feed; remote thumbnail reference only, not rehosted.";

function readThumbnailReviewDecisions() {
  try {
    const parsed = JSON.parse(localStorage.getItem(THUMBNAIL_REVIEW_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function thumbnailReviewDecisionValue(record) {
  if (!record) return null;
  return typeof record === "string" ? record : record.decision || null;
}

function sourceHost(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function candidateById(id) {
  const candidates = thumbnailCandidatesPayload().candidates || [];
  return candidates.find((candidate) => candidate.id === id) || null;
}

function isDirectPromotionCandidate(candidate) {
  if (!candidate) return false;
  const imageUrl = thumbnailAssetUrl(candidate.thumbnailUrl);
  if (!imageUrl || !imageUrl.startsWith("https://")) return false;
  if (candidate.sourceKind === "owner_submitted_image") {
    const permission = String(candidate.permission || "").toLowerCase();
    return candidate.permissionConfirmed === true && permission === "permitted" && Boolean(candidate.rightsBasis) && Boolean(candidate.attribution);
  }
  return DIRECT_PROMOTION_SOURCE_KINDS.has(String(candidate.sourceKind || ""));
}

function thumbnailDecisionPayload(candidate, decision, reason = "") {
  const imageUrl = thumbnailAssetUrl(candidate?.thumbnailUrl);
  const sourceUrl = safeUrl(candidate?.sourceUrl || candidate?.pageUrl || candidate?.postUrl);
  const directPromotion = decision === "approve_thumbnail" && isDirectPromotionCandidate(candidate);
  return {
    decision,
    decidedAt: new Date().toISOString(),
    rejectReason: reason || null,
    restaurantId: candidate?.restaurantId || null,
    restaurantName: candidate?.restaurantName || null,
    thumbnailUrl: imageUrl || candidate?.thumbnailUrl || null,
    sourceUrl: sourceUrl || null,
    sourceKind: candidate?.sourceKind || null,
    extractionMethod: candidate?.extractionMethod || null,
    title: candidate?.title || null,
    alt: candidate?.alt || candidate?.restaurantName || null,
    confidence: candidate?.confidence || null,
    observedAt: candidate?.observedAt || null,
    reviewPriority: thumbnailReviewPriority(candidate),
    visualReviewState: directPromotion ? "ready_for_media_manifest" : decision === "approve_thumbnail" ? "visual_fit_needs_rights_review" : decision,
    permission: directPromotion ? "permitted" : null,
    permissionConfirmed: directPromotion,
    rightsBasis: directPromotion ? APPROVED_REMOTE_THUMBNAIL_RIGHTS_BASIS : null,
    attribution: directPromotion ? `${candidate?.restaurantName || "Restaurant"}, official website` : null
  };
}

function writeThumbnailReviewDecision(id, decision, candidate = null, reason = "") {
  if (!id) return;
  const decisions = readThumbnailReviewDecisions();
  decisions[id] = thumbnailDecisionPayload(candidate || candidateById(id), decision, reason);
  localStorage.setItem(THUMBNAIL_REVIEW_STORAGE_KEY, JSON.stringify(decisions));
}

function thumbnailAssetUrl(value) {
  const raw = String(value || "").trim();
  if (/^(?:\.\/)?assets\/[a-zA-Z0-9._/-]+$/.test(raw)) return raw.startsWith("./") ? raw : `./${raw}`;
  if (raw.startsWith("http://")) return safeUrl(`https://${raw.slice(7)}`) || safeUrl(raw);
  return safeUrl(raw);
}

function thumbnailReviewPriority(candidate) {
  if (Number.isFinite(Number(candidate?.reviewPriority))) return Number(candidate.reviewPriority);
  if (candidate?.eligibleForProduction) return 100;
  const url = String(candidate?.thumbnailUrl || "").toLowerCase();
  let score = 50;
  if (!url.startsWith("https://")) score -= 4;
  const pathname = (() => { try { return new URL(candidate?.thumbnailUrl || "").pathname.toLowerCase(); } catch { return url; } })();
  const filename = pathname.split("/").pop() || pathname;
  if (/favicon|apple-touch-icon|touch-icon|site-icon|placeholder|blank|logo|logos|public\/logos?|pwa-icon|pwa-app|logo-default|sitelogo|32x32|57x57|60x60|72x72|114x114|120x120|144x144|180x180|192x192|225x225|(?:^|[?&/,_-])w[_=](?:1?\d{1,2}|2[0-4]\d)(?!\d)|(?:^|[?&/,_-])h[_=](?:1?\d{1,2}|2[0-4]\d)(?!\d)|facebook\.com|fbcdn\.net|scontent-|stock|franchis|brand-refresh|summary_square|artboard|fit=100%2c50|fit=100,50|h1_shape|web\+logo|web-logo/.test(url) || /(?:^|[/\-_.+])(icon|apple|logo)(?:[/\-_.+0-9]|$)/.test(filename)) score -= 35;
  if (/social-sharing|socialshare|socialpreview|twitter-card|ogimage|og-image|(?:^|[-_.])social(?:[-_.]|$)/.test(filename)) score -= 8;
  return Math.max(0, score);
}

function thumbnailIsPromotionCandidate(candidate) {
  return !candidate?.eligibleForProduction && thumbnailReviewPriority(candidate) >= 45 && !(candidate?.qualityFlags || []).length;
}
function thumbnailIsSourceCheckCandidate(candidate) {
  return !candidate?.eligibleForProduction && (candidate?.reviewState === "source_check" || candidate?.promotionReviewState === "source_check" || (candidate?.qualityFlags || []).some((flag) => String(flag).includes("source")));
}

function thumbnailCandidatesPayload() {
  return window.HALIFAX_THUMBNAIL_CANDIDATES || { counts: {}, candidates: [], missingApproved: [], missingAnyCandidate: [], failures: [] };
}

function normalizeThumbnailDecision(decision) {
  if (decision === "approve_candidate") return "approve_thumbnail";
  if (decision === "reject_candidate") return "reject_thumbnail";
  return decision || null;
}

function thumbnailReviewDecisionCounts(decisions) {
  const counts = { total: 0, approved: 0, rejected: 0, sourceCheck: 0, readyForManifest: 0, visualFitNeedsRights: 0 };
  for (const record of Object.values(decisions || {})) {
    const decision = normalizeThumbnailDecision(thumbnailReviewDecisionValue(record));
    if (!decision) continue;
    counts.total += 1;
    if (decision === "approve_thumbnail") counts.approved += 1;
    if (decision === "reject_thumbnail") counts.rejected += 1;
    if (decision === "needs_source_check") counts.sourceCheck += 1;
    if (record?.permissionConfirmed && record?.thumbnailUrl) counts.readyForManifest += 1;
    if (record?.visualReviewState === "visual_fit_needs_rights_review") counts.visualFitNeedsRights += 1;
  }
  return counts;
}

function thumbnailMatchesDecisionState(candidate, decisions) {
  const decision = normalizeThumbnailDecision(thumbnailReviewDecisionValue(decisions?.[candidate?.id]));
  if (thumbnailAdminState.decisionState === "all") return true;
  if (thumbnailAdminState.decisionState === "undecided") return !decision;
  if (thumbnailAdminState.decisionState === "approved") return decision === "approve_thumbnail";
  if (thumbnailAdminState.decisionState === "rejected") return decision === "reject_thumbnail";
  if (thumbnailAdminState.decisionState === "source_check") return decision === "needs_source_check";
  return true;
}

function thumbnailCandidateMatchesFilters(candidate, decisions) {
  if (thumbnailAdminState.sourceKind !== "all" && candidate.sourceKind !== thumbnailAdminState.sourceKind) return false;
  if (thumbnailAdminState.reviewState !== "all" && candidate.reviewState !== thumbnailAdminState.reviewState) return false;
  return thumbnailMatchesDecisionState(candidate, decisions);
}

function approvedThumbnailMediaRecords(decisions) {
  const records = [];
  for (const [id, storedRecord] of Object.entries(decisions || {})) {
    const decision = normalizeThumbnailDecision(thumbnailReviewDecisionValue(storedRecord));
    if (decision !== "approve_thumbnail") continue;
    const candidate = candidateById(id);
    const reviewRecord = { ...thumbnailDecisionPayload(candidate, "approve_thumbnail"), ...(typeof storedRecord === "object" ? storedRecord : {}) };
    if (!reviewRecord.permissionConfirmed || !reviewRecord.thumbnailUrl || !reviewRecord.restaurantId) continue;
    records.push({
      restaurantId: reviewRecord.restaurantId,
      url: reviewRecord.thumbnailUrl,
      alt: reviewRecord.alt || `${reviewRecord.restaurantName || "Restaurant"} official website image`,
      sourceUrl: reviewRecord.sourceUrl,
      sourceType: "official_site_permitted",
      creator: reviewRecord.restaurantName || "Restaurant",
      license: "First-party official site media",
      rightsBasis: reviewRecord.rightsBasis || APPROVED_REMOTE_THUMBNAIL_RIGHTS_BASIS,
      permission: "permitted",
      permissionConfirmed: true,
      attribution: reviewRecord.attribution || `${reviewRecord.restaurantName || "Restaurant"}, official website`,
      reviewState: "approved",
      reviewedAt: reviewRecord.decidedAt,
      reviewCandidateId: id
    });
  }
  return records.sort((a, b) => String(a.restaurantId).localeCompare(String(b.restaurantId)) || String(a.url).localeCompare(String(b.url)));
}

function exportApprovedThumbnailMediaRecords() {
  const decisions = readThumbnailReviewDecisions();
  const records = approvedThumbnailMediaRecords(decisions);
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    targetFile: "data/restaurant-media.js",
    policy: APPROVED_REMOTE_THUMBNAIL_RIGHTS_BASIS,
    records
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `halifax-sourced-approved-thumbnail-media-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  const url = link.href;
  link.remove();
  URL.revokeObjectURL(url);
  toast(records.length ? `Exported ${records.length} approved media records` : "No direct-promotion approvals to export yet");
}

function renderThumbnailAdmin() {
  const payload = thumbnailCandidatesPayload();
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const decisions = readThumbnailReviewDecisions();
  const decisionCounts = thumbnailReviewDecisionCounts(decisions);
  const byRestaurant = new Map();
  for (const candidate of candidates) {
    if (!candidate?.restaurantId) continue;
    const list = byRestaurant.get(candidate.restaurantId) || [];
    list.push(candidate);
    byRestaurant.set(candidate.restaurantId, list);
  }
  for (const list of byRestaurant.values()) {
    list.sort((a, b) => Number(b.eligibleForProduction) - Number(a.eligibleForProduction) || thumbnailReviewPriority(b) - thumbnailReviewPriority(a) || String(a.sourceKind || "").localeCompare(String(b.sourceKind || "")));
  }

  const missingApproved = Array.isArray(payload.missingApproved) ? payload.missingApproved : [];
  const missingAny = Array.isArray(payload.missingAnyCandidate) ? payload.missingAnyCandidate : [];
  const allPromotionQueue = missingApproved
    .map((item) => ({ ...item, candidates: (byRestaurant.get(item.restaurantId) || []).filter(thumbnailIsPromotionCandidate) }))
    .filter((item) => item.candidates.length)
    .sort((a, b) => b.candidates.length - a.candidates.length || String(a.name || "").localeCompare(String(b.name || "")));
  const promotionQueue = allPromotionQueue
    .map((item) => ({ ...item, candidates: item.candidates.filter((candidate) => thumbnailCandidateMatchesFilters(candidate, decisions)) }))
    .filter((item) => item.candidates.length);
  const sourceKinds = [...new Set(candidates.map((candidate) => candidate.sourceKind).filter(Boolean))].sort();
  const reviewStates = [...new Set(candidates.map((candidate) => candidate.reviewState).filter(Boolean))].sort();
  const filteredCandidates = candidates.filter((candidate) => {
    if (!thumbnailCandidateMatchesFilters(candidate, decisions)) return false;
    if (thumbnailAdminState.queue === "approved") return candidate.eligibleForProduction;
    if (thumbnailAdminState.queue === "review") return !candidate.eligibleForProduction;
    return true;
  });
  const promotionCandidateCount = allPromotionQueue.reduce((sum, item) => sum + item.candidates.length, 0);
  const sourceCheckCandidates = candidates.filter(thumbnailIsSourceCheckCandidate).filter((candidate) => thumbnailCandidateMatchesFilters(candidate, decisions));

  appView.innerHTML = `
    <section class="page-shell page-intro compact-intro admin-intro">
      <div><span class="eyebrow">Admin review</span><h1>Thumbnail candidates</h1><p>Review real image previews beside source context, approve only visually relevant official-site thumbnails, and reject blurry, logo-only, or unrelated candidates before promoting another batch.</p></div>
      <a class="button secondary" href="#explore">Back to app</a>
    </section>
    <section class="page-shell admin-metrics" aria-label="Thumbnail coverage metrics">
      ${adminMetric("Restaurants", payload.counts?.restaurants ?? 0)}
      ${adminMetric("Approved thumbnails", payload.counts?.restaurantsWithApprovedThumbnail ?? 0)}
      ${adminMetric("Promotion groups", allPromotionQueue.length)}
      ${adminMetric("Candidate images", promotionCandidateCount)}
      ${adminMetric("Ready export", decisionCounts.readyForManifest)}
      ${adminMetric("Needs rights", decisionCounts.visualFitNeedsRights)}
      ${adminMetric("Rejected", decisionCounts.rejected)}
      ${adminMetric("No candidate", payload.counts?.restaurantsMissingAnyCandidate ?? missingAny.length)}
    </section>
    <section class="page-shell admin-review-shell">
      <aside class="admin-review-controls" aria-label="Thumbnail review filters">
        <h2>Queue</h2>
        <button type="button" data-admin-queue="promotion" class="${thumbnailAdminState.queue === "promotion" ? "is-active" : ""}">Promotion queue <span>${allPromotionQueue.length}</span></button>
        <button type="button" data-admin-queue="review" class="${thumbnailAdminState.queue === "review" ? "is-active" : ""}">Needs review <span>${candidates.filter((candidate) => !candidate.eligibleForProduction).length}</span></button>
        <button type="button" data-admin-queue="source_check" class="${thumbnailAdminState.queue === "source_check" ? "is-active" : ""}">Source check <span>${candidates.filter(thumbnailIsSourceCheckCandidate).length}</span></button>
        <button type="button" data-admin-queue="approved" class="${thumbnailAdminState.queue === "approved" ? "is-active" : ""}">Approved <span>${candidates.filter((candidate) => candidate.eligibleForProduction).length}</span></button>
        <button type="button" data-admin-queue="discovery" class="${thumbnailAdminState.queue === "discovery" ? "is-active" : ""}">No candidate <span>${missingAny.length}</span></button>
        <label><span>Source kind</span><select id="adminThumbnailSource"><option value="all">All sources</option>${sourceKinds.map((kind) => `<option value="${escapeHtml(kind)}" ${thumbnailAdminState.sourceKind === kind ? "selected" : ""}>${escapeHtml(kind.replace(/_/g, " "))}</option>`).join("")}</select></label>
        <label><span>Review state</span><select id="adminThumbnailReview"><option value="all">All states</option>${reviewStates.map((state) => `<option value="${escapeHtml(state)}" ${thumbnailAdminState.reviewState === state ? "selected" : ""}>${escapeHtml(state.replace(/_/g, " "))}</option>`).join("")}</select></label>
        <label><span>Local decision</span><select id="adminThumbnailDecision"><option value="all" ${thumbnailAdminState.decisionState === "all" ? "selected" : ""}>All decisions</option><option value="undecided" ${thumbnailAdminState.decisionState === "undecided" ? "selected" : ""}>Undecided</option><option value="approved" ${thumbnailAdminState.decisionState === "approved" ? "selected" : ""}>Approved locally</option><option value="rejected" ${thumbnailAdminState.decisionState === "rejected" ? "selected" : ""}>Rejected locally</option><option value="source_check" ${thumbnailAdminState.decisionState === "source_check" ? "selected" : ""}>Needs source check</option></select></label>
        <button type="button" class="admin-secondary-action" data-thumb-export-approved>Export approved media <span>${decisionCounts.readyForManifest}</span></button>
        <div class="admin-export-links" aria-label="Thumbnail queue exports">
          <a class="admin-secondary-action" href="data/build/thumbnail-source-check-queue.csv" download>Source-check CSV <span>${sourceCheckCandidates.length}</span></a>
          <a class="admin-secondary-action" href="data/build/owner-media-outreach.csv" download>Owner outreach CSV <span>${missingAny.length}</span></a>
        </div>
        <p>Default view shows undecided promotion candidates. Approvals from official restaurant pages or feeds export as permission-confirmed remote references; other visually good images stay flagged for rights review.</p>
      </aside>
      <div class="admin-review-results">
        ${thumbnailAdminState.queue === "promotion" ? renderPromotionQueue(promotionQueue, decisions, allPromotionQueue) : ""}
        ${thumbnailAdminState.queue === "source_check" ? renderSourceCheckQueue(sourceCheckCandidates, decisions) : ""}
        ${thumbnailAdminState.queue === "discovery" ? renderDiscoveryQueue(missingAny) : ""}
        ${["review", "approved"].includes(thumbnailAdminState.queue) ? renderCandidateGrid(filteredCandidates, decisions) : ""}
      </div>
    </section>`;
  bindThumbnailAdminActions();
}

function adminMetric(label, value) {
  return `<div><strong>${Number(value || 0).toLocaleString()}</strong><span>${escapeHtml(label)}</span></div>`;
}

function renderPromotionQueue(queue, decisions, allQueue = queue) {
  if (!queue.length) return `<div class="info-message">No restaurants currently match these thumbnail review filters. Switch local decision to all decisions to see already-reviewed candidates.</div>`;
  const visibleCandidateCount = queue.reduce((sum, item) => sum + item.candidates.length, 0);
  const totalCandidateCount = allQueue.reduce((sum, item) => sum + item.candidates.length, 0);
  return `<div class="admin-section-heading"><div><h2>Promotion queue</h2><p>${queue.length.toLocaleString()} restaurant groups and ${visibleCandidateCount.toLocaleString()} visible candidate images. Full queue has ${allQueue.length.toLocaleString()} groups and ${totalCandidateCount.toLocaleString()} candidates.</p></div></div><div class="admin-promotion-list">${queue.map((item) => renderPromotionReviewGroup(item, decisions)).join("")}</div>`;
}

function renderSourceCheckQueue(candidates, decisions) {
  if (!candidates.length) return `<div class="info-message">No source-check thumbnail candidates match these filters.</div>`;
  return `<div class="admin-section-heading"><div><h2>Source-check queue</h2><p>${candidates.length.toLocaleString()} candidates need source-host, provenance, or first-party image validation before promotion.</p></div></div>${renderCandidateGrid(candidates, decisions)}`;
}

function renderPromotionReviewGroup(item, decisions) {
  const restaurantId = item.restaurantId ? String(item.restaurantId) : "";
  const restaurantName = item.name || item.restaurantName || item.candidates?.[0]?.restaurantName || "Unknown restaurant";
  const website = safeUrl(item.website || item.sourceUrl || item.candidates?.[0]?.sourceUrl);
  const directCount = item.candidates.filter(isDirectPromotionCandidate).length;
  return `<section class="admin-promotion-group" aria-label="Thumbnail candidates for ${escapeHtml(restaurantName)}">
    <div class="admin-promotion-group-header">
      <div>
        <div class="title-badges"><span>${escapeHtml(item.neighborhood || item.neighbourhood || "Neighbourhood unknown")}</span><span>${item.candidates.length} candidates</span><span>${directCount} direct-ready</span></div>
        <h2>${escapeHtml(restaurantName)}</h2>
        <p>Compare each real preview against the restaurant and source before approving. Use reject reasons to keep the next queue clean.</p>
      </div>
      <div class="admin-promotion-group-actions">
        ${restaurantId ? `<a class="button tertiary" href="#restaurant/${encodeURIComponent(restaurantId)}">Restaurant</a>` : ""}
        ${website ? `<a class="button tertiary" href="${escapeHtml(website)}" target="_blank" rel="noreferrer">Website</a>` : ""}
      </div>
    </div>
    <div class="admin-visual-candidate-grid">${item.candidates.map((candidate) => adminCandidateCard(candidate, decisions, { showRestaurant: false })).join("")}</div>
  </section>`;
}

function renderDiscoveryQueue(queue) {
  if (!queue.length) return `<div class="info-message">Every restaurant has at least one thumbnail candidate.</div>`;
  return `<div class="admin-section-heading"><div><h2>No thumbnail candidate yet</h2><p>Prioritize these places for official-page metadata, owner media, or approved public media discovery.</p></div></div><div class="admin-gap-list">${queue.slice(0, 300).map((item) => {
    const website = safeUrl(item.website);
    const restaurantId = item.restaurantId ? String(item.restaurantId) : "";
    const restaurantLink = restaurantId ? `<a href="#restaurant/${encodeURIComponent(restaurantId)}">Restaurant</a>` : "";
    return `<article><div><strong>${escapeHtml(item.name || item.restaurantName || "Unknown restaurant")}</strong><span>${escapeHtml(item.neighborhood || "Neighbourhood unknown")}</span></div>${website ? `<a href="${escapeHtml(website)}" target="_blank" rel="noreferrer">Website</a>` : ""}${restaurantLink}</article>`;
  }).join("")}</div>`;
}

function renderCandidateGrid(candidates, decisions) {
  if (!candidates.length) return `<div class="info-message">No thumbnail candidates match the selected filters.</div>`;
  const title = thumbnailAdminState.queue === "approved" ? "Approved thumbnails" : "Candidates needing review";
  return `<div class="admin-section-heading"><div><h2>${title}</h2><p>${candidates.length.toLocaleString()} records match the current filters.</p></div></div><div class="admin-candidate-grid">${candidates.slice(0, 300).map((candidate) => adminCandidateCard(candidate, decisions)).join("")}</div>`;
}

function adminCandidateCard(candidate, decisions, options = {}) {
  const normalizedOptions = typeof options === "number" ? { restaurantCandidateCount: options } : options || {};
  const sourceKind = String(candidate.sourceKind || "unknown_source");
  const reviewState = String(candidate.reviewState || "unreviewed");
  const rightsStatus = String(candidate.rightsStatus || "unknown");
  const imageUrl = thumbnailAssetUrl(candidate.thumbnailUrl);
  const sourceUrl = safeUrl(candidate.sourceUrl || candidate.pageUrl || candidate.postUrl);
  const localDecision = normalizeThumbnailDecision(thumbnailReviewDecisionValue(decisions[candidate.id]));
  const directPromotion = isDirectPromotionCandidate(candidate);
  const promoted = candidate.eligibleForProduction ? "Production approved" : directPromotion ? "Direct promotion ready" : "Visual fit only";
  const restaurantId = candidate.restaurantId ? String(candidate.restaurantId) : "";
  const dimensions = Number(candidate.width) && Number(candidate.height) ? `${candidate.width} x ${candidate.height}` : "Unknown";
  const imageHost = sourceHost(imageUrl);
  const evidenceHost = sourceHost(sourceUrl);
  const decisionClass = localDecision ? `is-local-${localDecision.replace(/_/g, "-")}` : "";
  const candidateTitle = candidate.title || candidate.alt || "Thumbnail candidate";
  return `<article class="admin-candidate-card ${candidate.eligibleForProduction ? "is-approved" : "is-review"} ${decisionClass}">
    <div class="admin-candidate-image">${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(candidate.alt || candidate.restaurantName || "Thumbnail candidate")}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.closest('.admin-candidate-image').classList.add('is-broken');this.remove()" />` : `<span>No preview</span>`}</div>
    <div class="admin-candidate-body">
      <div class="title-badges"><span>${escapeHtml(sourceKind.replace(/_/g, " "))}</span><span>${escapeHtml(promoted)}</span>${localDecision ? `<span>${escapeHtml(localDecision.replace(/_/g, " "))}</span>` : ""}</div>
      ${normalizedOptions.showRestaurant === false ? "" : `<h2>${escapeHtml(candidate.restaurantName || "Unknown restaurant")}</h2>`}
      <p>${escapeHtml(candidateTitle)}</p>
      ${candidate.qualityFlags?.length ? `<p class="admin-quality-flags">${candidate.qualityFlags.map((flag) => escapeHtml(String(flag).replace(/_/g, " "))).join(" · ")}</p>` : ""}
      <dl><div><dt>Image host</dt><dd>${escapeHtml(imageHost || "local asset")}</dd></div><div><dt>Source host</dt><dd>${escapeHtml(evidenceHost || "unknown")}</dd></div><div><dt>Review</dt><dd>${escapeHtml(reviewState)}</dd></div><div><dt>Rights</dt><dd>${escapeHtml(rightsStatus)}</dd></div><div><dt>Priority</dt><dd>${thumbnailReviewPriority(candidate)}</dd></div><div><dt>Confidence</dt><dd>${escapeHtml(candidate.confidence || "unknown")}</dd></div><div><dt>Size</dt><dd>${escapeHtml(dimensions)}</dd></div><div><dt>Method</dt><dd>${escapeHtml(candidate.extractionMethod || "unknown")}</dd></div>${normalizedOptions.restaurantCandidateCount ? `<div><dt>Candidates</dt><dd>${normalizedOptions.restaurantCandidateCount}</dd></div>` : ""}</dl>
      <div class="admin-candidate-actions admin-candidate-links">
        ${restaurantId && normalizedOptions.showRestaurant !== false ? `<a class="button tertiary" href="#restaurant/${encodeURIComponent(restaurantId)}">Restaurant</a>` : ""}
        ${sourceUrl ? `<a class="button tertiary" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">Source</a>` : ""}
        ${imageUrl ? `<a class="button tertiary" href="${escapeHtml(imageUrl)}" target="_blank" rel="noreferrer">Image</a>` : ""}
      </div>
      <div class="admin-candidate-actions admin-decision-actions" aria-label="Thumbnail review decisions">
        <button type="button" data-thumb-decision="approve_thumbnail" data-thumb-id="${escapeHtml(candidate.id || "")}">Approve</button>
        <button type="button" data-thumb-decision="reject_thumbnail" data-thumb-reason="blurry_low_quality" data-thumb-id="${escapeHtml(candidate.id || "")}">Blurry</button>
        <button type="button" data-thumb-decision="reject_thumbnail" data-thumb-reason="logo_or_placeholder" data-thumb-id="${escapeHtml(candidate.id || "")}">Logo</button>
        <button type="button" data-thumb-decision="reject_thumbnail" data-thumb-reason="unrelated_or_wrong_place" data-thumb-id="${escapeHtml(candidate.id || "")}">Unrelated</button>
        <button type="button" data-thumb-decision="needs_source_check" data-thumb-reason="needs_source_review" data-thumb-id="${escapeHtml(candidate.id || "")}">Source check</button>
      </div>
    </div>
  </article>`;
}

function bindThumbnailAdminActions() {
  document.querySelectorAll("[data-admin-queue]").forEach((button) => button.addEventListener("click", () => {
    thumbnailAdminState.queue = button.dataset.adminQueue || "promotion";
    renderThumbnailAdmin();
  }));
  document.querySelector("#adminThumbnailSource")?.addEventListener("change", (event) => {
    thumbnailAdminState.sourceKind = event.target.value || "all";
    renderThumbnailAdmin();
  });
  document.querySelector("#adminThumbnailReview")?.addEventListener("change", (event) => {
    thumbnailAdminState.reviewState = event.target.value || "all";
    renderThumbnailAdmin();
  });
  document.querySelector("#adminThumbnailDecision")?.addEventListener("change", (event) => {
    thumbnailAdminState.decisionState = event.target.value || "all";
    renderThumbnailAdmin();
  });
  document.querySelector("[data-thumb-export-approved]")?.addEventListener("click", exportApprovedThumbnailMediaRecords);
  document.querySelectorAll("[data-thumb-decision]").forEach((button) => button.addEventListener("click", () => {
    const candidate = candidateById(button.dataset.thumbId);
    const decision = button.dataset.thumbDecision;
    writeThumbnailReviewDecision(button.dataset.thumbId, decision, candidate, button.dataset.thumbReason || "");
    const directReady = decision === "approve_thumbnail" && isDirectPromotionCandidate(candidate);
    const label = decision === "approve_thumbnail" ? directReady ? "Candidate approved for media export" : "Candidate marked visually good, rights review needed" : decision === "needs_source_check" ? "Candidate marked for source check" : "Candidate rejected";
    toast(label);
    renderThumbnailAdmin();
  }));
}

function readLocalReviewDecisions(storageKey) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalReviewDecision(storageKey, id, decision) {
  if (!id) return;
  const decisions = readLocalReviewDecisions(storageKey);
  decisions[id] = { decision, decidedAt: new Date().toISOString() };
  localStorage.setItem(storageKey, JSON.stringify(decisions));
}

function socialReviewPayload() {
  return window.HALIFAX_RECENT_SOCIAL_POSTS || { counts: {}, sourceState: {}, records: [] };
}

function socialReviewCategoryOptions(posts) {
  return [...new Set(posts.flatMap((post) => [post.primaryCategory, ...(post.categories || []).map((category) => category.id)].filter(Boolean)))].sort();
}

function renderSocialPostAdmin() {
  const payload = socialReviewPayload();
  const posts = Array.isArray(payload.records) ? payload.records : [];
  const decisions = readLocalReviewDecisions(SOCIAL_REVIEW_STORAGE_KEY);
  const categories = socialReviewCategoryOptions(posts);
  const credentialState = payload.sourceState?.metaCredentialState || {};
  const reviewStates = [...new Set(posts.map((post) => post.reviewState || "source_signal"))].sort();
  const filtered = posts.filter((post) => {
    const selectedState = thumbnailAdminState.reviewState;
    const selectedKind = thumbnailAdminState.sourceKind;
    if (selectedState !== "all" && (post.reviewState || "source_signal") !== selectedState) return false;
    if (selectedKind !== "all" && post.primaryCategory !== selectedKind && !(post.categories || []).some((category) => category.id === selectedKind)) return false;
    return true;
  });
  appView.innerHTML = `
    <section class="page-shell page-intro compact-intro admin-intro">
      <div><span class="eyebrow">Admin review</span><h1>Social and post intelligence</h1><p>Review recent restaurant-owned feed items and Meta API post observations for specials, events, openings, patios, brunch, and menu updates. Local decisions prepare promotion but do not publish until source data is regenerated and committed.</p></div>
      <a class="button secondary" href="#home">Back to home</a>
    </section>
    <section class="page-shell admin-metrics" aria-label="Recent post metrics">
      ${adminMetric("Recent posts", payload.counts?.records ?? posts.length)}
      ${adminMetric("Restaurants", payload.counts?.restaurantsWithRecentPosts ?? 0)}
      ${adminMetric("Website feed posts", payload.inputCounts?.websiteFeedPosts ?? 0)}
      ${adminMetric("Social API posts", payload.inputCounts?.socialApiPosts ?? 0)}
      ${adminMetric("Local decisions", Object.keys(decisions).length)}
      ${adminMetric("Meta profiles", payload.sourceState?.metaProfilesAttempted ?? 0)}
    </section>
    <section class="page-shell admin-review-shell">
      <aside class="admin-review-controls" aria-label="Social post review filters">
        <h2>Post queue</h2>
        <button type="button" class="is-active">Posts <span>${posts.length}</span></button>
        <label><span>Category</span><select id="adminSocialCategory"><option value="all">All categories</option>${categories.map((category) => `<option value="${escapeHtml(category)}" ${thumbnailAdminState.sourceKind === category ? "selected" : ""}>${escapeHtml(category.replace(/_/g, " "))}</option>`).join("")}</select></label>
        <label><span>Review state</span><select id="adminSocialReview"><option value="all">All states</option>${reviewStates.map((state) => `<option value="${escapeHtml(state)}" ${thumbnailAdminState.reviewState === state ? "selected" : ""}>${escapeHtml(state.replace(/_/g, " "))}</option>`).join("")}</select></label>
        <p>Meta state: Facebook ${escapeHtml(credentialState.facebook || "missing")}; Instagram ${escapeHtml(credentialState.instagram || "missing")}. Add repo secrets, rerun Source Expansion Preview, then this queue will include API-observed posts.</p>
      </aside>
      <div class="admin-review-results">
        <div class="admin-section-heading"><div><h2>Recent post queue</h2><p>${filtered.length.toLocaleString()} posts match the selected filters.</p></div></div>
        ${filtered.length ? `<div class="admin-social-grid">${filtered.map((post) => socialPostReviewCard(post, decisions)).join("")}</div>` : `<div class="info-message">No recent posts match the selected filters. Add Meta secrets and rerun Source Expansion Preview for Facebook and Instagram API observations.</div>`}
      </div>
    </section>`;
  bindSocialAdminActions();
}

function socialPostReviewCard(post, decisions) {
  const id = post.id || post.postUrl || `${post.restaurantId}-${post.publishedAt}`;
  const sourceUrl = safeUrl(post.postUrl || post.profileUrl || post.feedUrl);
  const mediaUrl = safeUrl(post.mediaUrl || post.thumbnailUrl);
  const decision = decisions[id]?.decision || null;
  const categories = (post.categories || []).slice(0, 4);
  return `<article class="admin-candidate-card social-post-review-card">
    <div class="admin-candidate-image">${mediaUrl ? `<img src="${escapeHtml(mediaUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.closest('.admin-candidate-image').classList.add('is-broken');this.remove()" />` : `<span>No image</span>`}</div>
    <div class="admin-candidate-body">
      <div class="title-badges"><span>${escapeHtml(post.platform || "website_feed")}</span><span>${escapeHtml(post.primaryCategoryLabel || "Update")}</span>${decision ? `<span>${escapeHtml(decision.replace(/_/g, " "))}</span>` : ""}</div>
      <h2>${escapeHtml(post.title || `${post.restaurantName || "Restaurant"} update`)}</h2>
      <p><strong>${escapeHtml(post.restaurantName || "Unknown restaurant")}</strong> - ${escapeHtml(post.publishedAt || post.observedAt || "Date unknown")}</p>
      ${post.summary ? `<p>${escapeHtml(post.summary)}</p>` : ""}
      ${categories.length ? `<div class="card-tags">${categories.map((category) => `<span>${escapeHtml(category.label || category.id)}</span>`).join("")}</div>` : ""}
      <dl><div><dt>Confidence</dt><dd>${escapeHtml(post.confidence || "unknown")}</dd></div><div><dt>Review</dt><dd>${escapeHtml(post.reviewState || "source_signal")}</dd></div><div><dt>Age</dt><dd>${Number.isFinite(post.ageDays) ? `${post.ageDays} days` : "unknown"}</dd></div><div><dt>Source</dt><dd>${escapeHtml(post.sourceLabel || post.sourceKind || "source")}</dd></div></dl>
      <div class="admin-candidate-actions">
        ${post.restaurantId ? `<a class="button tertiary" href="#restaurant/${encodeURIComponent(post.restaurantId)}">Restaurant</a>` : ""}
        ${sourceUrl ? `<a class="button tertiary" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">Source</a>` : ""}
        <button type="button" data-social-decision="approve_post" data-social-id="${escapeHtml(id)}">Approve</button>
        <button type="button" data-social-decision="needs_edit" data-social-id="${escapeHtml(id)}">Needs edit</button>
        <button type="button" data-social-decision="reject_post" data-social-id="${escapeHtml(id)}">Reject</button>
      </div>
    </div>
  </article>`;
}

function bindSocialAdminActions() {
  document.querySelector("#adminSocialCategory")?.addEventListener("change", (event) => {
    thumbnailAdminState.sourceKind = event.target.value || "all";
    renderSocialPostAdmin();
  });
  document.querySelector("#adminSocialReview")?.addEventListener("change", (event) => {
    thumbnailAdminState.reviewState = event.target.value || "all";
    renderSocialPostAdmin();
  });
  document.querySelectorAll("[data-social-decision]").forEach((button) => button.addEventListener("click", () => {
    writeLocalReviewDecision(SOCIAL_REVIEW_STORAGE_KEY, button.dataset.socialId, button.dataset.socialDecision);
    toast("Post review decision saved locally");
    renderSocialPostAdmin();
  }));
}

function contentQualityPayload() {
  return window.HALIFAX_CONTENT_QUALITY_REPORT || { summary: {}, reviewQueues: {}, sourceHealth: {} };
}

function renderPlaceQueueAdmin() {
  const payload = contentQualityPayload();
  const queueName = thumbnailAdminState.queue === "promotion" ? "conflicts" : thumbnailAdminState.queue;
  const queues = payload.reviewQueues || {};
  const queueMap = {
    conflicts: queues.placeConflicts || [],
    name_only: queues.nameOnlyMatches || [],
    unresolved: queues.unresolvedPlaces || [],
    failures: payload.sourceHealth?.failures || []
  };
  const selected = queueMap[queueName] || [];
  const decisions = readLocalReviewDecisions(PLACE_REVIEW_STORAGE_KEY);
  appView.innerHTML = `
    <section class="page-shell page-intro compact-intro admin-intro">
      <div><span class="eyebrow">Admin review</span><h1>Place resolution queues</h1><p>Work down unresolved restaurant candidates, source conflicts, name-only matches, and source failures so more records can be promoted into the public app.</p></div>
      <a class="button secondary" href="#explore">Back to explore</a>
    </section>
    <section class="page-shell admin-metrics" aria-label="Place queue metrics">
      ${adminMetric("Conflicts", payload.summary?.placeSourceConflicts ?? 0)}
      ${adminMetric("Name-only", payload.summary?.nameOnlyPlaceReviews ?? 0)}
      ${adminMetric("Unresolved", payload.summary?.unresolvedPlaceCandidates ?? 0)}
      ${adminMetric("Failures", payload.summary?.sourceFailures ?? 0)}
      ${adminMetric("Specials", payload.summary?.structuredSpecials ?? 0)}
      ${adminMetric("Events", payload.summary?.cityEvents ?? 0)}
    </section>
    <section class="page-shell admin-review-shell">
      <aside class="admin-review-controls" aria-label="Place queue filters">
        <h2>Queue</h2>
        <button type="button" data-place-queue="conflicts" class="${queueName === "conflicts" ? "is-active" : ""}">Conflicts <span>${queueMap.conflicts.length}</span></button>
        <button type="button" data-place-queue="name_only" class="${queueName === "name_only" ? "is-active" : ""}">Name-only <span>${queueMap.name_only.length}</span></button>
        <button type="button" data-place-queue="unresolved" class="${queueName === "unresolved" ? "is-active" : ""}">Unresolved <span>${queueMap.unresolved.length}</span></button>
        <button type="button" data-place-queue="failures" class="${queueName === "failures" ? "is-active" : ""}">Source failures <span>${queueMap.failures.length}</span></button>
        <p>Decisions are saved locally as review notes. Production promotion should be encoded as reviewed resolution records or source overrides.</p>
      </aside>
      <div class="admin-review-results">
        <div class="admin-section-heading"><div><h2>${escapeHtml(queueName.replace(/_/g, " "))}</h2><p>${selected.length.toLocaleString()} records in this queue.</p></div></div>
        ${selected.length ? `<div class="admin-gap-list place-review-list">${selected.slice(0, 300).map((item) => placeQueueCard(item, decisions)).join("")}</div>` : `<div class="info-message">No records in this place review queue.</div>`}
      </div>
    </section>`;
  bindPlaceAdminActions();
}

function placeQueueCard(item, decisions) {
  const id = item.candidateId || item.restaurantId || item.url || `${item.layer}-${item.reason}`;
  const sourceUrl = safeUrl(item.sourceUrl || item.url || item.website || item.pageUrl);
  const restaurantId = item.matchedRestaurantId || item.restaurantId;
  const decision = decisions[id]?.decision || null;
  const detail = [item.candidateAddress, item.matchedRestaurantName, item.reason, item.layer].filter(Boolean).join(" - ");
  const evidence = [...(item.evidence || []), ...(item.conflicts || [])].slice(0, 5);
  return `<article>
    <div><strong>${escapeHtml(item.candidateName || item.name || item.restaurantName || item.url || "Review item")}</strong><span>${escapeHtml(detail || item.state || "Needs review")}</span>${decision ? `<small>${escapeHtml(decision.replace(/_/g, " "))}</small>` : ""}${evidence.length ? `<small>${evidence.map((value) => escapeHtml(String(value).replace(/_/g, " "))).join(" - ")}</small>` : ""}</div>
    ${restaurantId ? `<a href="#restaurant/${encodeURIComponent(restaurantId)}">Match</a>` : ""}
    ${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">Source</a>` : ""}
    <button type="button" data-place-decision="approve_match" data-place-id="${escapeHtml(id)}">Approve</button>
    <button type="button" data-place-decision="needs_research" data-place-id="${escapeHtml(id)}">Research</button>
    <button type="button" data-place-decision="reject_match" data-place-id="${escapeHtml(id)}">Reject</button>
  </article>`;
}

function bindPlaceAdminActions() {
  document.querySelectorAll("[data-place-queue]").forEach((button) => button.addEventListener("click", () => {
    thumbnailAdminState.queue = button.dataset.placeQueue || "conflicts";
    renderPlaceQueueAdmin();
  }));
  document.querySelectorAll("[data-place-decision]").forEach((button) => button.addEventListener("click", () => {
    writeLocalReviewDecision(PLACE_REVIEW_STORAGE_KEY, button.dataset.placeId, button.dataset.placeDecision);
    toast("Place review decision saved locally");
    renderPlaceQueueAdmin();
  }));
}

const halifaxBaseRenderRoute = window.renderRoute;
if (typeof halifaxBaseRenderRoute === "function") {
  window.renderRoute = function renderRouteWithAdmin() {
    const current = route();
    if (current.name === "admin" && ["thumbnails", "social", "places"].includes(current.id)) {
      destroyMap();
      updateNav("admin");
      if (globalSearch) globalSearch.value = state.query;
      if (current.id === "social") renderSocialPostAdmin();
      else if (current.id === "places") renderPlaceQueueAdmin();
      else renderThumbnailAdmin();
      document.querySelector("#mainContent")?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
    halifaxBaseRenderRoute();
  };
}