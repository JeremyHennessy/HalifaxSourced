"use strict";

const ADMIN_STATUS_REPORT_FILES = {
  deployment: "data/build/deployment-metadata.json",
  preview: "data/build/preview-promotion-metadata.json",
  contentQuality: "data/build/content-quality-report.json",
  cityEvents: "data/build/city-events.json",
  thumbnails: "data/build/thumbnail-candidates.json",
  recentPosts: "data/build/recent-social-posts.json",
  publicSpecials: "data/build/public-special-source-leads.json"
};

let adminStatusReportsPromise = null;

function statusEscape(value) {
  if (typeof escapeHtml === "function") return escapeHtml(value);
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function statusSafeUrl(value) {
  if (typeof safeUrl === "function") return safeUrl(value);
  try {
    const url = new URL(String(value || ""), window.location.href);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function statusNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function statusFirstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function statusPayloadValue(getter, fallback = null) {
  try {
    const value = getter();
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

async function fetchAdminStatusJson(path) {
  try {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } catch (error) {
    return { __loadError: error?.message || "Unable to load report", __path: path };
  }
}

function loadAdminStatusReports() {
  if (adminStatusReportsPromise) return adminStatusReportsPromise;
  adminStatusReportsPromise = Promise.all([
    fetchAdminStatusJson(ADMIN_STATUS_REPORT_FILES.deployment),
    fetchAdminStatusJson(ADMIN_STATUS_REPORT_FILES.preview)
  ]).then(([deployment, preview]) => ({
    deployment,
    preview,
    quality: statusPayloadValue(() => contentQualityPayload(), window.HALIFAX_CONTENT_QUALITY_REPORT || {}),
    cityEvents: window.HALIFAX_CITY_EVENTS || {},
    thumbnails: statusPayloadValue(() => thumbnailCandidatesPayload(), window.HALIFAX_THUMBNAIL_CANDIDATES || {}),
    recentPosts: statusPayloadValue(() => socialReviewPayload(), window.HALIFAX_RECENT_SOCIAL_POSTS || {}),
    publicSpecials: window.HALIFAX_PUBLIC_SPECIAL_SOURCE_LEADS || {}
  }));
  return adminStatusReportsPromise;
}

function statusDateMeta(value) {
  const raw = String(value || "").trim();
  const parsed = raw ? Date.parse(raw) : NaN;
  if (!Number.isFinite(parsed)) return { valid: false, iso: null, days: null, hours: null, label: "Unknown", formatted: "Unknown", status: "unknown" };
  const elapsedMs = Math.max(0, Date.now() - parsed);
  const hours = elapsedMs / 36e5;
  const days = elapsedMs / 864e5;
  let label = "Less than 1 hour";
  if (hours >= 48) label = `${Math.floor(days).toLocaleString()} days`;
  else if (hours >= 1) label = `${Math.floor(hours).toLocaleString()} hours`;
  const status = days > 7 ? "stale" : days > 2 ? "warn" : "fresh";
  return {
    valid: true,
    iso: new Date(parsed).toISOString(),
    days,
    hours,
    label,
    formatted: formatStatusDate(parsed),
    status
  };
}

function formatStatusDate(value) {
  try {
    return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Halifax" }).format(new Date(value));
  } catch {
    return new Date(value).toISOString();
  }
}

function statusPill(status, label = status) {
  return `<span class="admin-status-pill is-${statusEscape(status || "unknown")}">${statusEscape(label || "unknown")}</span>`;
}

function statusMetricCard({ key, label, value, detail, status = "fresh", href = "" }) {
  const link = href ? `<a href="${statusEscape(href)}" class="button tertiary">Open</a>` : "";
  return `<article class="admin-status-card is-${statusEscape(status)}" data-admin-status-metric="${statusEscape(key || label)}">
    <div>${statusPill(status)}${link}</div>
    <strong>${statusEscape(value)}</strong>
    <span>${statusEscape(label)}</span>
    ${detail ? `<p>${statusEscape(detail)}</p>` : ""}
  </article>`;
}

function buildReviewQueueRows(reports) {
  const quality = reports.quality || {};
  const summary = quality.summary || {};
  const queues = quality.reviewQueues || {};
  const thumbnails = reports.thumbnails || {};
  const thumbnailCandidates = Array.isArray(thumbnails.candidates) ? thumbnails.candidates : [];
  const thumbnailSourceCheck = thumbnailCandidates.filter((candidate) => {
    if (typeof thumbnailIsSourceCheckCandidate === "function") return thumbnailIsSourceCheckCandidate(candidate);
    return candidate?.reviewState === "source_check" || candidate?.promotionReviewState === "source_check" || (candidate?.qualityFlags || []).some((flag) => String(flag).includes("source"));
  }).length;
  const missingAny = Array.isArray(thumbnails.missingAnyCandidate) ? thumbnails.missingAnyCandidate.length : 0;
  const recentCounts = reports.recentPosts?.counts?.reviewStateCounts || {};
  const socialNeedsReview = Object.entries(recentCounts).reduce((sum, [stateName, count]) => stateName === "source_signal" ? sum : sum + statusNumber(count), 0);
  return [
    { label: "Place conflicts", value: statusFirstNumber(summary.placeSourceConflicts, queues.placeConflicts?.length), href: "#admin/places" },
    { label: "Name-only place reviews", value: statusFirstNumber(summary.nameOnlyPlaceReviews, queues.nameOnlyMatches?.length), href: "#admin/places" },
    { label: "Unresolved place candidates", value: statusFirstNumber(summary.unresolvedPlaceCandidates, queues.unresolvedPlaces?.length), href: "#admin/places" },
    { label: "Patio facts needing review", value: statusNumber(summary.patioDirectoryNeedsReview), href: "#admin/places" },
    { label: "Public special leads needing review", value: statusNumber(summary.publicSpecialSourceLeadsNeedsReview), href: "#admin/places" },
    { label: "Orphan special sources", value: statusNumber(summary.orphanSpecialSources), href: "#admin/places" },
    { label: "Thumbnail source check", value: statusFirstNumber(thumbnailSourceCheck, thumbnails.counts?.sourceCheckCandidates), href: "#admin/thumbnails" },
    { label: "Missing thumbnail candidates", value: statusFirstNumber(thumbnails.counts?.restaurantsMissingAnyCandidate, missingAny), href: "#admin/thumbnails" },
    { label: "Recent posts needing review", value: socialNeedsReview, href: "#admin/social" },
    { label: "Event adapters in review", value: statusNumber(summary.eventSourcesInAdapterReview), href: "#events" }
  ];
}

function buildSourceRows(reports) {
  const quality = reports.quality || {};
  const summary = quality.summary || {};
  const cityStats = Array.isArray(reports.cityEvents?.sourceStats) ? reports.cityEvents.sourceStats : [];
  const cityIssues = cityStats.filter((source) => String(source.status || "ok") !== "ok").length;
  const thumbnailFailures = Array.isArray(reports.thumbnails?.failures) ? reports.thumbnails.failures.length : 0;
  const metaCredentialState = reports.recentPosts?.sourceState?.metaCredentialState || {};
  const missingMeta = [metaCredentialState.facebook, metaCredentialState.instagram].filter((value) => String(value || "missing") === "missing").length;
  return [
    { label: "Total source failures", value: statusNumber(summary.sourceFailures), detail: "Content quality report" },
    { label: "Broken URLs", value: statusNumber(summary.brokenUrls), detail: "Needs source replacement or redirect review" },
    { label: "Restricted URLs", value: statusNumber(summary.restrictedUrls), detail: "Robots, auth, or host restrictions" },
    { label: "Transient URL failures", value: statusNumber(summary.transientUrlFailures), detail: "Retryable fetch or timeout failures" },
    { label: "Blocked event sources", value: statusNumber(summary.blockedEventSources), detail: "City-event source registry" },
    { label: "City event source issues", value: cityIssues, detail: `${cityStats.length.toLocaleString()} event sources observed` },
    { label: "Thumbnail pipeline failures", value: thumbnailFailures, detail: "Candidate generation" },
    { label: "Meta credentials missing", value: missingMeta, detail: "Facebook and Instagram API coverage" }
  ];
}

function buildDataProductRows(reports) {
  const deployment = reports.deployment || {};
  const preview = reports.preview || {};
  return [
    { label: "Deployment metadata", at: deployment.generatedAt, count: deployment.counts?.canonicalPlaces, countLabel: "places", href: ADMIN_STATUS_REPORT_FILES.deployment },
    { label: "Local policy exclusions", at: deployment.catalogGeneratedAt || deployment.generatedAt, count: deployment.counts?.localPolicyExcluded, countLabel: "excluded", href: ADMIN_STATUS_REPORT_FILES.deployment },
    { label: "Latest preview artifact", at: preview.generatedAt, count: preview.promotedFileCount, countLabel: "files", href: ADMIN_STATUS_REPORT_FILES.preview },
    { label: "City events", at: reports.cityEvents?.generatedAt, count: reports.cityEvents?.eventCount, countLabel: "events", href: ADMIN_STATUS_REPORT_FILES.cityEvents },
    { label: "Content quality", at: reports.quality?.generatedAt, count: reports.quality?.summary?.canonicalPlaces, countLabel: "places", href: ADMIN_STATUS_REPORT_FILES.contentQuality },
    { label: "Recent post intelligence", at: reports.recentPosts?.generatedAt, count: reports.recentPosts?.counts?.records, countLabel: "posts", href: ADMIN_STATUS_REPORT_FILES.recentPosts },
    { label: "Thumbnail candidates", at: reports.thumbnails?.generatedAt, count: reports.thumbnails?.counts?.candidates ?? reports.thumbnails?.candidates?.length, countLabel: "candidates", href: ADMIN_STATUS_REPORT_FILES.thumbnails },
    { label: "Public special leads", at: reports.publicSpecials?.generatedAt, count: reports.publicSpecials?.counts?.total, countLabel: "leads", href: ADMIN_STATUS_REPORT_FILES.publicSpecials }
  ];
}

function adminStatusMetrics(reports) {
  const deployedAge = statusDateMeta(reports.deployment?.generatedAt);
  const previewAge = statusDateMeta(reports.preview?.generatedAt);
  const sourceRows = buildSourceRows(reports);
  const reviewRows = buildReviewQueueRows(reports);
  const sourceFailures = statusNumber(sourceRows.find((row) => row.label === "Total source failures")?.value);
  const reviewQueueCount = reviewRows.reduce((sum, row) => sum + statusNumber(row.value), 0);
  return {
    deployedAge,
    previewAge,
    sourceRows,
    reviewRows,
    sourceFailures,
    reviewQueueCount,
    deployedDataAgeDays: deployedAge.days,
    latestPreviewArtifactAgeDays: previewAge.days
  };
}

function renderDataProductRow(row) {
  const age = statusDateMeta(row.at);
  const count = Number.isFinite(Number(row.count)) ? `${Number(row.count).toLocaleString()} ${row.countLabel || "records"}` : "No count";
  return `<article class="admin-status-row" data-admin-data-row>
    <div>${statusPill(age.status)}<strong>${statusEscape(row.label)}</strong><span>${statusEscape(age.formatted)}</span></div>
    <div><strong>${statusEscape(age.label)}</strong><span>${statusEscape(count)}</span></div>
    <a href="${statusEscape(row.href)}" data-admin-report-link>Report</a>
  </article>`;
}

function renderReviewQueueRow(row) {
  return `<article class="admin-status-row" data-admin-review-row>
    <div><strong>${statusEscape(row.label)}</strong><span>${statusEscape(row.href.replace(/^#/, ""))}</span></div>
    <div><strong>${statusNumber(row.value).toLocaleString()}</strong><span>records</span></div>
    <a href="${statusEscape(row.href)}">Open</a>
  </article>`;
}

function renderSourceRow(row) {
  const status = statusNumber(row.value) > 0 ? "warn" : "fresh";
  return `<article class="admin-status-row" data-admin-source-row>
    <div>${statusPill(status)}<strong>${statusEscape(row.label)}</strong><span>${statusEscape(row.detail || "Source health")}</span></div>
    <div><strong>${statusNumber(row.value).toLocaleString()}</strong><span>count</span></div>
  </article>`;
}

function renderFailureExamples(reports) {
  const failures = Array.isArray(reports.quality?.sourceHealth?.failures) ? reports.quality.sourceHealth.failures.slice(0, 8) : [];
  if (!failures.length) return `<div class="info-message">No detailed source failure examples are present in the loaded content-quality report.</div>`;
  return `<div class="admin-status-examples">${failures.map((failure) => {
    const label = failure.sourceName || failure.sourceId || failure.name || failure.url || failure.sourceUrl || failure.type || "Source failure";
    const url = statusSafeUrl(failure.sourceUrl || failure.url || failure.website);
    const detail = [failure.reason, failure.error, failure.status, failure.layer, failure.kind].filter(Boolean).join(" - ");
    return `<article><div><strong>${statusEscape(label)}</strong><span>${statusEscape(detail || "Needs source review")}</span></div>${url ? `<a href="${statusEscape(url)}" target="_blank" rel="noreferrer">Source</a>` : ""}</article>`;
  }).join("")}</div>`;
}

function renderAdminStatusMarkup(reports) {
  const metrics = adminStatusMetrics(reports);
  const deployment = reports.deployment || {};
  const preview = reports.preview || {};
  const sourceSha = String(deployment.sourceCommitSha || "");
  const qualityRunId = deployment.qualityWorkflowRunId || null;
  const deployRunId = deployment.deploymentWorkflowRunId || null;
  const previewRunUrl = statusSafeUrl(preview.sourceWorkflowRunUrl);
  const productRows = buildDataProductRows(reports);
  window.__halifaxAdminStatus = {
    loaded: true,
    renderedAt: new Date().toISOString(),
    metrics: {
      deployedDataAgeDays: metrics.deployedDataAgeDays,
      latestPreviewArtifactAgeDays: metrics.latestPreviewArtifactAgeDays,
      sourceFailures: metrics.sourceFailures,
      reviewQueueCount: metrics.reviewQueueCount,
      sourceRowCount: metrics.sourceRows.length,
      reviewRowCount: metrics.reviewRows.length
    },
    reports: {
      deploymentGeneratedAt: deployment.generatedAt || null,
      previewGeneratedAt: preview.generatedAt || null,
      sourceCommitSha: sourceSha || null,
      previewArtifactRunId: preview.artifactRunId || null
    }
  };
  return `
    <section class="page-shell page-intro compact-intro admin-intro admin-status-intro">
      <div><span class="eyebrow">Admin status</span><h1>Freshness and source status</h1><p>Deployed report ages, preview promotion state, source failures, and review queues from the same data products that feed the public app.</p></div>
      <a class="button secondary" href="#home">Back to home</a>
    </section>
    <section class="page-shell admin-status-panel" data-admin-status-panel>
      <div class="admin-status-summary" aria-label="Freshness status metrics">
        ${statusMetricCard({ key: "deployed-data-age", label: "Deployed data age", value: metrics.deployedAge.label, detail: deployment.generatedAt ? `Generated ${metrics.deployedAge.formatted}` : "Deployment metadata missing", status: metrics.deployedAge.status, href: ADMIN_STATUS_REPORT_FILES.deployment })}
        ${statusMetricCard({ key: "latest-preview-artifact-age", label: "Latest preview artifact age", value: metrics.previewAge.label, detail: preview.artifactRunId ? `${preview.artifactName || "preview"} run ${preview.artifactRunId}` : "No promoted preview metadata", status: metrics.previewAge.status, href: ADMIN_STATUS_REPORT_FILES.preview })}
        ${statusMetricCard({ key: "source-failures", label: "Source failures", value: metrics.sourceFailures.toLocaleString(), detail: "Broken, restricted, transient, and adapter failures", status: metrics.sourceFailures ? "warn" : "fresh", href: "#admin/places" })}
        ${statusMetricCard({ key: "review-queue-count", label: "Review queue records", value: metrics.reviewQueueCount.toLocaleString(), detail: `${metrics.reviewRows.length.toLocaleString()} queue families`, status: metrics.reviewQueueCount ? "warn" : "fresh", href: "#admin/places" })}
      </div>
      <section class="admin-status-release-card">
        <div>
          <span class="eyebrow">Release evidence</span>
          <h2>Published artifact lineage</h2>
          <p>Source SHA ${sourceSha ? statusEscape(sourceSha.slice(0, 12)) : "unknown"}${qualityRunId ? `, Quality Gate ${statusEscape(qualityRunId)}` : ""}${deployRunId ? `, deploy ${statusEscape(deployRunId)}` : ""}.</p>
        </div>
        <div class="admin-status-actions">
          ${previewRunUrl ? `<a class="button tertiary" href="${statusEscape(previewRunUrl)}" target="_blank" rel="noreferrer">Preview run</a>` : ""}
          <a class="button tertiary" href="${ADMIN_STATUS_REPORT_FILES.contentQuality}" data-admin-report-link>Quality report</a>
          <a class="button tertiary" href="${ADMIN_STATUS_REPORT_FILES.cityEvents}" data-admin-report-link>City events</a>
        </div>
      </section>
      <div class="admin-status-grid">
        <section class="admin-status-block" aria-label="Data product freshness">
          <div class="admin-section-heading"><div><h2>Data product ages</h2><p>${productRows.length.toLocaleString()} generated data products with report links.</p></div></div>
          <div class="admin-status-list">${productRows.map(renderDataProductRow).join("")}</div>
        </section>
        <section class="admin-status-block" aria-label="Review queue counts">
          <div class="admin-section-heading"><div><h2>Review queues</h2><p>${metrics.reviewQueueCount.toLocaleString()} records across place, thumbnail, post, special, patio, and event queues.</p></div></div>
          <div class="admin-status-list">${metrics.reviewRows.map(renderReviewQueueRow).join("")}</div>
        </section>
      </div>
      <div class="admin-status-grid">
        <section class="admin-status-block" aria-label="Source failure counts">
          <div class="admin-section-heading"><div><h2>Source failures</h2><p>Current failure categories from content-quality and loaded source payloads.</p></div></div>
          <div class="admin-status-list">${metrics.sourceRows.map(renderSourceRow).join("")}</div>
        </section>
        <section class="admin-status-block" aria-label="Source failure examples">
          <div class="admin-section-heading"><div><h2>Failure examples</h2><p>First detailed source-health records when the report includes examples.</p></div></div>
          ${renderFailureExamples(reports)}
        </section>
      </div>
    </section>`;
}

function renderFreshnessStatusAdmin() {
  destroyMap();
  updateNav("admin");
  if (globalSearch) globalSearch.value = state.query;
  window.__halifaxAdminStatus = { loaded: false };
  appView.innerHTML = `
    <section class="page-shell page-intro compact-intro admin-intro admin-status-intro">
      <div><span class="eyebrow">Admin status</span><h1>Freshness and source status</h1><p>Loading deployed data age, preview artifact age, source failures, and review queues.</p></div>
      <a class="button secondary" href="#home">Back to home</a>
    </section>
    <section class="page-shell admin-status-panel" data-admin-status-panel><div class="info-message">Loading status reports...</div></section>`;
  loadAdminStatusReports().then((reports) => {
    const current = route();
    if (current.name !== "admin" || current.id !== "status") return;
    appView.innerHTML = renderAdminStatusMarkup(reports);
    document.querySelector("#mainContent")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  });
}

const halifaxAdminStatusBaseRenderRoute = window.renderRoute;
if (typeof halifaxAdminStatusBaseRenderRoute === "function") {
  window.renderRoute = function renderRouteWithAdminStatus() {
    const current = route();
    if (current.name === "admin" && current.id === "status") {
      renderFreshnessStatusAdmin();
      return;
    }
    halifaxAdminStatusBaseRenderRoute();
  };
}