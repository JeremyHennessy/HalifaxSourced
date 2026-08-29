"use strict";
function bindExploreActions() {
  const drawer = document.querySelector("[data-filter-drawer]");
  const backdrop = document.querySelector("[data-filter-backdrop]");
  const toggle = document.querySelector("[data-open-filters]");
  const closeButton = document.querySelector("[data-close-filters]");

  const closeFilters = () => {
    drawer?.classList.remove("is-open");
    backdrop?.classList.remove("is-open");
    document.body.classList.remove("filter-drawer-open");
    toggle?.setAttribute("aria-expanded", "false");
  };
  const openFilters = () => {
    drawer?.classList.add("is-open");
    backdrop?.classList.add("is-open");
    document.body.classList.add("filter-drawer-open");
    toggle?.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => drawer?.querySelector("select,button")?.focus());
  };

  toggle?.addEventListener("click", openFilters);
  closeButton?.addEventListener("click", closeFilters);
  backdrop?.addEventListener("click", closeFilters);
  drawer?.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); closeFilters(); toggle?.focus(); } });

  const apply = () => {
    state.cuisine = document.querySelector("#cuisineFilter")?.value || "all";
    state.neighbourhood = document.querySelector("#neighbourhoodFilter")?.value || "all";
    state.feature = document.querySelector("#featureFilter")?.value || "all";
    state.sort = document.querySelector("#sortFilter")?.value || state.sort;
    state.page = 1;
    closeFilters();
    renderExplore();
  };
  document.querySelector("[data-filter-apply]")?.addEventListener("click", apply);
  document.querySelector("#sortFilter")?.addEventListener("change", (event) => { state.sort = event.target.value; state.page = 1; renderExplore(); });
  document.querySelectorAll("[data-page]").forEach((button) => button.addEventListener("click", () => { state.page = Number(button.dataset.page) || 1; renderExplore(); }));
  document.querySelectorAll("[data-clear-filters]").forEach((button) => button.addEventListener("click", () => { state.cuisine = "all"; state.neighbourhood = "all"; state.feature = "all"; state.query = ""; state.page = 1; globalSearch.value = ""; closeFilters(); renderExplore(); }));
}

function bindCommonActions() {
  document.querySelectorAll("[data-save-id]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const id = button.dataset.saveId;
      if (state.saved.has(id)) state.saved.delete(id); else state.saved.add(id);
      persistSaved();
      button.classList.toggle("is-saved", state.saved.has(id));
      button.textContent = button.classList.contains("save-detail") ? (state.saved.has(id) ? "♥ Saved" : "♡ Save") : (state.saved.has(id) ? "♥" : "♡");
      toast(state.saved.has(id) ? "Saved for later" : "Removed from saved");
    });
  });
  document.querySelectorAll("[data-cuisine]").forEach((button) => button.addEventListener("click", () => { state.cuisine = button.dataset.cuisine; state.page = 1; navigate("#explore"); }));
  document.querySelectorAll("[data-neighbourhood]").forEach((button) => button.addEventListener("click", () => { state.neighbourhood = button.dataset.neighbourhood; state.page = 1; navigate("#explore"); }));
  document.querySelectorAll("[data-map-result-id]").forEach((row) => row.addEventListener("click", (event) => {
    if (event.target.closest("a,button")) return;
    focusMapResult(row.dataset.mapResultId);
  }));
  document.querySelector("[data-action='all-cuisines']")?.addEventListener("click", () => navigate("#explore"));
}

function initMiniMap(items, element = document.querySelector("#exploreMiniMap")) {
  if (!element || !window.L) return;
  const map = L.map(element, { attributionControl: false, zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, tap: false, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false }).setView(MAP_DEFAULT, 12, { animate: false });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
  items.filter((r) => r.coordinates).slice(0, 80).forEach((restaurant) => L.circleMarker([restaurant.coordinates.lat, restaurant.coordinates.lon], { radius: 5, color: "#0b3a67", weight: 2, fillColor: "#45aaa5", fillOpacity: 0.9 }).addTo(map));
  state.map = map;
}

function initMainMap(items) {
  const element = document.querySelector("#mainMap");
  if (!element || !window.L) return;
  const map = L.map(element, { preferCanvas: true, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false }).setView(MAP_DEFAULT, 12, { animate: false });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
  const renderer = L.canvas({ padding: 0.5 });
  const layer = L.layerGroup().addTo(map);
  state.mapMarkers = new Map();
  let count = 0;
  for (const restaurant of items) {
    if (!restaurant.coordinates) continue;
    const marker = L.circleMarker([restaurant.coordinates.lat, restaurant.coordinates.lon], { radius: 6, color: "#ffffff", weight: 2, fillColor: categoryColor(restaurant), fillOpacity: 0.95, renderer });
    marker.bindTooltip(escapeHtml(restaurant.name), { direction: "top" });
    marker.on("click", () => highlightMapResult(restaurant.id));
    marker.addTo(layer);
    state.mapMarkers.set(restaurant.id, marker);
    count += 1;
  }
  window.__halifaxMapMarkerCount = count;
  state.map = map;
  state.mapLayer = layer;
  state.mapRenderer = renderer;
}

function highlightMapResult(id, scroll = true) {
  document.querySelectorAll("[data-map-result-id].is-highlighted").forEach((row) => row.classList.remove("is-highlighted"));
  const row = document.querySelector(`[data-map-result-id="${CSS.escape(String(id))}"]`);
  if (!row) return;
  row.classList.add("is-highlighted");
  if (scroll) row.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function focusMapResult(id) {
  const marker = state.mapMarkers?.get(id);
  const map = state.map;
  if (!marker || !map || !map.getContainer()?.isConnected) return;
  try {
    map.stop();
    map.setView(marker.getLatLng(), Math.max(map.getZoom(), 15), { animate: false, reset: true });
    if (map.getContainer()?.isConnected && state.map === map) marker.openTooltip();
    highlightMapResult(id, false);
  } catch {
    // Route transitions can invalidate a marker between input and render. Ignore stale interactions.
  }
}

function initDetailMap(restaurant) {
  const element = document.querySelector("#detailMap");
  if (!element || !window.L || !restaurant.coordinates) return;
  const center = [restaurant.coordinates.lat, restaurant.coordinates.lon];
  const map = L.map(element, { attributionControl: false, zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false }).setView(center, 15, { animate: false });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
  L.circleMarker(center, { radius: 8, color: "#ffffff", weight: 3, fillColor: "#0b3a67", fillOpacity: 1 }).addTo(map);
  state.map = map;
}

function categoryColor(restaurant) {
  const kind = categoryKind(restaurant);
  if (kind === "bar") return "#f2b34b";
  if (kind === "cafe") return "#65bdb6";
  if (kind === "quick") return "#ef8c76";
  return "#0b3a67";
}

function destroyMap() {
  const map = state.map;
  // Clear app references first so delayed input/animation callbacks cannot reuse a map
  // that is being torn down during a hash-route transition.
  state.map = null;
  state.mapLayer = null;
  state.mapRenderer = null;
  state.mapMarkers = null;
  if (!map) return;
  try { map.stop?.(); } catch { /* no-op */ }
  try { map.closeTooltip?.(); } catch { /* no-op */ }
  try { map.closePopup?.(); } catch { /* no-op */ }
  try { map.eachLayer?.((layer) => layer.closeTooltip?.()); } catch { /* no-op */ }
  try { map.off?.(); } catch { /* no-op */ }
  try { map.remove(); } catch { /* stale Leaflet container; route teardown continues */ }
}

function toast(message) {
  if (!toastRegion) return;
  const item = document.createElement("div");
  item.className = "toast";
  item.textContent = message;
  toastRegion.appendChild(item);
  setTimeout(() => item.remove(), 2600);
}

searchForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  state.query = globalSearch.value.trim();
  state.page = 1;
  navigate(`#explore${state.query ? `?q=${encodeURIComponent(state.query)}` : ""}`);
});

globalSearch?.addEventListener("search", () => {
  if (!globalSearch.value && route().name === "explore") {
    state.query = "";
    state.page = 1;
    renderExplore();
  }
});

document.querySelector("#savedButton")?.addEventListener("click", () => navigate("#saved"));

const mobileMoreButton = document.querySelector("#mobileMore");
const mobileMoreSheet = document.querySelector("[data-mobile-more-sheet]");
const mobileMoreBackdrop = document.querySelector("[data-mobile-more-backdrop]");
function closeMobileMore() {
  mobileMoreSheet?.classList.remove("is-open");
  mobileMoreBackdrop?.classList.remove("is-open");
  mobileMoreSheet?.setAttribute("aria-hidden", "true");
  mobileMoreButton?.setAttribute("aria-expanded", "false");
  document.body.classList.remove("mobile-more-open");
}
function openMobileMore() {
  mobileMoreSheet?.classList.add("is-open");
  mobileMoreBackdrop?.classList.add("is-open");
  mobileMoreSheet?.setAttribute("aria-hidden", "false");
  mobileMoreButton?.setAttribute("aria-expanded", "true");
  document.body.classList.add("mobile-more-open");
  requestAnimationFrame(() => mobileMoreSheet?.querySelector("a")?.focus());
}
mobileMoreButton?.addEventListener("click", () => mobileMoreButton.getAttribute("aria-expanded") === "true" ? closeMobileMore() : openMobileMore());
mobileMoreBackdrop?.addEventListener("click", closeMobileMore);
document.querySelector("[data-mobile-more-close]")?.addEventListener("click", closeMobileMore);
mobileMoreSheet?.addEventListener("click", (event) => { if (event.target.closest("a")) closeMobileMore(); });
mobileMoreSheet?.addEventListener("keydown", (event) => { if (event.key === "Escape") { closeMobileMore(); mobileMoreButton?.focus(); } });

document.querySelectorAll("[data-neighbourhood-link]").forEach((button) => button.addEventListener("click", () => { state.neighbourhood = button.dataset.neighbourhoodLink; navigate("#explore"); }));

window.addEventListener("hashchange", renderRoute);
renderRoute();
