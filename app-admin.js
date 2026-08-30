"use strict";

const THUMBNAIL_REVIEW_STORAGE_KEY = "halifaxSourced.thumbnailReview.v1";
const SOCIAL_REVIEW_STORAGE_KEY = "halifaxSourced.socialPostReview.v1";
const PLACE_REVIEW_STORAGE_KEY = "halifaxSourced.placeReview.v1";
const thumbnailAdminState = { queue: "promotion", sourceKind: "all", reviewState: "all" };

function readThumbnailReviewDecisions() {
  try {
    const parsed = JSON.parse(localStorage.getItem(THUMBNAIL_REVIEW_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeThumbnailReviewDecision(id, decision) {
  if (!id) return;
  const decisions = readThumbnailReviewDecisions();
  decisions[id] = { decision, decidedAt: new Date().toISOString() };
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

function thumbnailCandidatesPayload() {
  return window.HALIFAX_THUMBNAIL_CANDIDATES || { counts: {}, candidates: [], missingApproved: [], missingAnyCandidate: [], failures: [] };
}

function renderThumbnailAdmin() {
  const payload = thumbnailCandidatesPayload();
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const decisions = readThumbnailReviewDecisions();
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
  const promotionQueue = missingApproved
    .map((item) => ({ ...item, candidates: (byRestaurant.get(item.restaurantId) || []).filter(thumbnailIsPromotionCandidate) }))
    .filter((item) => item.candidates.length)
    .sort((a, b) => b.candidates.length - a.candidates.length || String(a.name || "").localeCompare(String(b.name || "")));
  const sourceKinds = [...new Set(candidates.map((candidate) => candidate.sourceKind).filter(Boolean))].sort();
  const reviewStates = [...new Set(candidates.map((candidate) => candidate.reviewState).filter(Boolean))].sort();
  const filteredCandidates = candidates.filter((candidate) => {
    if (thumbnailAdminState.sourceKind !== "all" && candidate.sourceKind !== thumbnailAdminState.sourceKind) return false;
    if (thumbnailAdminState.reviewState !== "all" && candidate.reviewState !== thumbnailAdminState.reviewState) return false;
    if (thumbnailAdminState.queue === "approved") return candidate.eligibleForProduction;
    if (thumbnailAdminState.queue === "review") return !candidate.eligibleForProduction;
    return true;
  });
  const reviewedLocalCount = Object.keys(decisions).length;

  appView.innerHTML = `
    <section class="page-shell page-intro compact-intro admin-intro">
      <div><span class="eyebrow">Admin review</span><h1>Thumbnail candidates</h1><p>Review source-backed image leads, identify restaurants missing thumbnails, and prepare approved media promotions. Local decisions here do not publish images until records are promoted into the approved media manifest.</p></div>
      <a class="button secondary" href="#explore">Back to app</a>
    </section>
    <section class="page-shell admin-metrics" aria-label="Thumbnail coverage metrics">
      ${adminMetric("Restaurants", payload.counts?.restaurants ?? 0)}
      ${adminMetric("Approved thumbnails", payload.counts?.restaurantsWithApprovedThumbnail ?? 0)}
      ${adminMetric("Any candidate", payload.counts?.restaurantsWithAnyCandidate ?? 0)}
      ${adminMetric("Missing approved", payload.counts?.restaurantsMissingApprovedThumbnail ?? missingApproved.length)}
      ${adminMetric("No candidate", payload.counts?.restaurantsMissingAnyCandidate ?? missingAny.length)}
      ${adminMetric("Local decisions", reviewedLocalCount)}
    </section>
    <section class="page-shell admin-review-shell">
      <aside class="admin-review-controls" aria-label="Thumbnail review filters">
        <h2>Queue</h2>
        <button type="button" data-admin-queue="promotion" class="${thumbnailAdminState.queue === "promotion" ? "is-active" : ""}">Promotion queue <span>${promotionQueue.length}</span></button>
        <button type="button" data-admin-queue="review" class="${thumbnailAdminState.queue === "review" ? "is-active" : ""}">Needs review <span>${candidates.filter((candidate) => !candidate.eligibleForProduction).length}</span></button>
        <button type="button" data-admin-queue="approved" class="${thumbnailAdminState.queue === "approved" ? "is-active" : ""}">Approved <span>${candidates.filter((candidate) => candidate.eligibleForProduction).length}</span></button>
        <button type="button" data-admin-queue="discovery" class="${thumbnailAdminState.queue === "discovery" ? "is-active" : ""}">No candidate <span>${missingAny.length}</span></button>
        <label><span>Source kind</span><select id="adminThumbnailSource"><option value="all">All sources</option>${sourceKinds.map((kind) => `<option value="${escapeHtml(kind)}" ${thumbnailAdminState.sourceKind === kind ? "selected" : ""}>${escapeHtml(kind.replace(/_/g, " "))}</option>`).join("")}</select></label>
        <label><span>Review state</span><select id="adminThumbnailReview"><option value="all">All states</option>${reviewStates.map((state) => `<option value="${escapeHtml(state)}" ${thumbnailAdminState.reviewState === state ? "selected" : ""}>${escapeHtml(state.replace(/_/g, " "))}</option>`).join("")}</select></label>
        <p>Use this screen to triage candidates. Publishing still requires an approved data/restaurant-media.js record with rights basis, creator/licence, source URL, and permission confirmation.</p>
      </aside>
      <div class="admin-review-results">
        ${thumbnailAdminState.queue === "promotion" ? renderPromotionQueue(promotionQueue, decisions) : ""}
        ${thumbnailAdminState.queue === "discovery" ? renderDiscoveryQueue(missingAny) : ""}
        ${["review", "approved"].includes(thumbnailAdminState.queue) ? renderCandidateGrid(filteredCandidates, decisions) : ""}
      </div>
    </section>`;
  bindThumbnailAdminActions();
}

function adminMetric(label, value) {
  return `<div><strong>${Number(value || 0).toLocaleString()}</strong><span>${escapeHtml(label)}</span></div>`;
}

function renderPromotionQueue(queue, decisions) {
  if (!queue.length) return `<div class="info-message">No restaurants currently have reviewable candidates while missing an approved thumbnail.</div>`;
  return `<div class="admin-section-heading"><div><h2>Promotion queue</h2><p>Restaurants missing an approved thumbnail but already having candidate images.</p></div></div><div class="admin-candidate-grid">${queue.map((item) => adminCandidateCard(item.candidates[0], decisions, item.candidates.length)).join("")}</div>`;
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

function adminCandidateCard(candidate, decisions, restaurantCandidateCount = null) {
  const sourceKind = String(candidate.sourceKind || "unknown_source");
  const reviewState = String(candidate.reviewState || "unreviewed");
  const rightsStatus = String(candidate.rightsStatus || "unknown");
  const imageUrl = thumbnailAssetUrl(candidate.thumbnailUrl);
  const sourceUrl = safeUrl(candidate.sourceUrl);
  const localDecision = decisions[candidate.id]?.decision || null;
  const promoted = candidate.eligibleForProduction ? "Production approved" : "Needs rights review";
  const restaurantId = candidate.restaurantId ? String(candidate.restaurantId) : "";
  return `<article class="admin-candidate-card ${candidate.eligibleForProduction ? "is-approved" : "is-review"}">
    <div class="admin-candidate-image">${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(candidate.alt || candidate.restaurantName || "Thumbnail candidate")}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.closest('.admin-candidate-image').classList.add('is-broken');this.remove()" />` : `<span>No preview</span>`}</div>
    <div class="admin-candidate-body">
      <div class="title-badges"><span>${escapeHtml(sourceKind.replace(/_/g, " "))}</span><span>${escapeHtml(promoted)}</span>${localDecision ? `<span>${escapeHtml(localDecision.replace(/_/g, " "))}</span>` : ""}</div>
      <h2>${escapeHtml(candidate.restaurantName || "Unknown restaurant")}</h2>
      <p>${escapeHtml(candidate.title || candidate.alt || "Thumbnail candidate")}</p>
      ${candidate.qualityFlags?.length ? `<p class="admin-quality-flags">${candidate.qualityFlags.map((flag) => escapeHtml(String(flag).replace(/_/g, " "))).join(" · ")}</p>` : ""}
      <dl><div><dt>Review</dt><dd>${escapeHtml(reviewState)}</dd></div><div><dt>Rights</dt><dd>${escapeHtml(rightsStatus)}</dd></div><div><dt>Priority</dt><dd>${thumbnailReviewPriority(candidate)}</dd></div><div><dt>Confidence</dt><dd>${escapeHtml(candidate.confidence || "unknown")}</dd></div>${restaurantCandidateCount ? `<div><dt>Candidates</dt><dd>${restaurantCandidateCount}</dd></div>` : ""}</dl>
      <div class="admin-candidate-actions">
        ${restaurantId ? `<a class="button tertiary" href="#restaurant/${encodeURIComponent(restaurantId)}">Restaurant</a>` : ""}
        ${sourceUrl ? `<a class="button tertiary" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">Source</a>` : ""}
        <button type="button" data-thumb-decision="approve_candidate" data-thumb-id="${escapeHtml(candidate.id || "")}">Mark approve</button>
        <button type="button" data-thumb-decision="reject_candidate" data-thumb-id="${escapeHtml(candidate.id || "")}">Reject</button>
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
  document.querySelectorAll("[data-thumb-decision]").forEach((button) => button.addEventListener("click", () => {
    writeThumbnailReviewDecision(button.dataset.thumbId, button.dataset.thumbDecision);
    toast(button.dataset.thumbDecision === "approve_candidate" ? "Candidate marked for promotion" : "Candidate marked rejected");
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