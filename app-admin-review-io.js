"use strict";

const REVIEW_IO_CONFIG = {
  social: {
    storageKey: "halifaxSourced.socialPostReview.v1",
    fileStem: "reviewed-social-post-decisions",
    label: "post decisions",
    policy: "Approved social/post decisions can be copied into data/reviewed-social-post-decisions.json and rebuilt with scripts/build-reviewed-social-posts.mjs."
  },
  places: {
    storageKey: "halifaxSourced.placeReview.v1",
    fileStem: "reviewed-place-queue-decisions",
    label: "place decisions",
    policy: "Approved place decisions are review notes until converted into data/reviewed-place-resolutions.js records."
  },
  thumbnails: {
    storageKey: "halifaxSourced.thumbnailReview.v1",
    fileStem: "reviewed-thumbnail-decisions",
    label: "thumbnail decisions",
    policy: "Approved thumbnail decisions are review notes until converted into data/restaurant-media.js records with rights and attribution fields."
  }
};

function reviewIoRouteName() {
  const raw = String(window.location.hash || "#home").replace(/^#/, "");
  const [path] = raw.split("?");
  const parts = path.split("/").filter(Boolean);
  return parts[0] === "admin" ? parts[1] : null;
}

function reviewIoRead(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function reviewIoWrite(key, value) {
  localStorage.setItem(key, JSON.stringify(value || {}));
}

function reviewIoRecordPayload(config) {
  const decisions = reviewIoRead(config.storageKey);
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    policy: config.policy,
    source: "Halifax Sourced admin localStorage export",
    records: Object.entries(decisions).map(([id, record]) => ({
      id,
      ...(typeof record === "string" ? { decision: record } : record)
    }))
  };
}

function reviewIoDownload(config) {
  const payload = reviewIoRecordPayload(config);
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${config.fileStem}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  if (typeof toast === "function") toast(`Exported ${payload.records.length} ${config.label}`);
}

function reviewIoNormalizeImport(payload) {
  if (payload?.decisions && typeof payload.decisions === "object") return payload.decisions;
  const rows = Array.isArray(payload?.records) ? payload.records : [];
  return Object.fromEntries(rows
    .filter((row) => row && (row.id || row.postUrl || row.candidateId || row.restaurantId))
    .map((row) => {
      const id = String(row.id || row.postUrl || row.candidateId || row.restaurantId);
      const { id: _id, ...rest } = row;
      return [id, rest];
    }));
}

function reviewIoImport(config, file) {
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const imported = reviewIoNormalizeImport(JSON.parse(String(reader.result || "{}")));
      const merged = { ...reviewIoRead(config.storageKey), ...imported };
      reviewIoWrite(config.storageKey, merged);
      if (typeof toast === "function") toast(`Imported ${Object.keys(imported).length} ${config.label}`);
      if (typeof window.renderRoute === "function") window.renderRoute();
    } catch {
      if (typeof toast === "function") toast("Could not import review JSON");
    }
  });
  reader.readAsText(file);
}

function injectReviewIoControls() {
  const routeName = reviewIoRouteName();
  const config = REVIEW_IO_CONFIG[routeName];
  if (!config || document.querySelector("[data-review-io-panel]")) return;
  const controls = document.querySelector(".admin-review-controls");
  if (!controls) return;
  const count = Object.keys(reviewIoRead(config.storageKey)).length;
  const panel = document.createElement("div");
  panel.className = "admin-review-io";
  panel.dataset.reviewIoPanel = routeName;
  panel.innerHTML = `
    <h2>Persist review</h2>
    <p>${escapeHtml(config.policy)} Current local decisions: ${count.toLocaleString()}.</p>
    <div class="admin-review-io-actions">
      <button type="button" data-review-export="${routeName}">Export JSON</button>
      <label class="button tertiary" for="reviewImport-${routeName}">Import JSON</label>
      <input id="reviewImport-${routeName}" type="file" accept="application/json" data-review-import="${routeName}" />
    </div>`;
  controls.append(panel);
  panel.querySelector("[data-review-export]")?.addEventListener("click", () => reviewIoDownload(config));
  panel.querySelector("[data-review-import]")?.addEventListener("change", (event) => reviewIoImport(config, event.target.files?.[0]));
}

const reviewIoBaseRenderRoute = window.renderRoute;
if (typeof reviewIoBaseRenderRoute === "function") {
  window.renderRoute = function renderRouteWithReviewIo() {
    reviewIoBaseRenderRoute();
    injectReviewIoControls();
  };
}

window.addEventListener("hashchange", () => setTimeout(injectReviewIoControls, 0));
window.addEventListener("DOMContentLoaded", () => setTimeout(injectReviewIoControls, 0));
