"use strict";
function bindExploreActions() {
  const apply = () => {
    state.cuisine = document.querySelector("#cuisineFilter")?.value || "all";
    state.neighbourhood = document.querySelector("#neighbourhoodFilter")?.value || "all";
    state.feature = document.querySelector("#featureFilter")?.value || "all";
    state.sort = document.querySelector("#sortFilter")?.value || state.sort;
    state.page = 1;
    renderExplore();
  };
  document.querySelector("[data-filter-apply]")?.addEventListener("click", apply);
  document.querySelector("#sortFilter")?.addEventListener("change", (event) => { state.sort = event.target.value; state.page = 1; renderExplore(); });
  document.querySelectorAll("[data-page]").forEach((button) => button.addEventListener("click", () => { state.page = Number(button.dataset.page) || 1; renderExplore(); }));
  document.querySelectorAll("[data-clear-filters]").forEach((button) => button.addEventListener("click", () => { state.cuisine = "all"; state.neighbourhood = "all"; state.feature = "all"; state.query = ""; state.page = 1; globalSearch.value = ""; renderExplore(); }));
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
  document.querySelector("[data-action='all-cuisines']")?.addEventListener("click", () => navigate("#explore"));
  document.querySelector("[data-newsletter-form]")?.addEventListener("submit", (event) => { event.preventDefault(); toast("Newsletter service is not connected yet."); });
}

function initMiniMap(items) {
  const element = document.querySelector("#exploreMiniMap");
  if (!element || !window.L) return;
  const map = L.map(element, { attributionControl: false, zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, tap: false }).setView(MAP_DEFAULT, 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
  const renderer = L.canvas();
  items.filter((r) => r.coordinates).slice(0, 80).forEach((restaurant) => L.circleMarker([restaurant.coordinates.lat, restaurant.coordinates.lon], { radius: 5, color: "#0b3a67", weight: 2, fillColor: "#45aaa5", fillOpacity: 0.9, renderer }).addTo(map));
  state.map = map;
}

function initMainMap(items) {
  const element = document.querySelector("#mainMap");
  if (!element || !window.L) return;
  const map = L.map(element, { preferCanvas: true }).setView(MAP_DEFAULT, 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
  const renderer = L.canvas({ padding: 0.5 });
  const layer = L.layerGroup().addTo(map);
  let count = 0;
  for (const restaurant of items) {
    if (!restaurant.coordinates) continue;
    const marker = L.circleMarker([restaurant.coordinates.lat, restaurant.coordinates.lon], { radius: 6, color: "#ffffff", weight: 2, fillColor: categoryColor(restaurant), fillOpacity: 0.95, renderer });
    marker.bindTooltip(escapeHtml(restaurant.name), { direction: "top" });
    marker.on("click", () => navigate(`#restaurant/${encodeURIComponent(restaurant.id)}`));
    marker.addTo(layer);
    count += 1;
  }
  window.__halifaxMapMarkerCount = count;
  state.map = map;
  state.mapLayer = layer;
  state.mapRenderer = renderer;
}

function initDetailMap(restaurant) {
  const element = document.querySelector("#detailMap");
  if (!element || !window.L || !restaurant.coordinates) return;
  const center = [restaurant.coordinates.lat, restaurant.coordinates.lon];
  const map = L.map(element, { attributionControl: false, zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false }).setView(center, 15);
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
  if (state.map) {
    try { state.map.remove(); } catch { /* no-op */ }
    state.map = null;
    state.mapLayer = null;
    state.mapRenderer = null;
  }
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
document.querySelector("#mobileSaved")?.addEventListener("click", () => navigate("#saved"));
document.querySelector("#profileButton")?.addEventListener("click", () => toast("Profiles are not connected yet."));
document.querySelector("#mobileProfile")?.addEventListener("click", () => toast("Profiles are not connected yet."));

document.querySelectorAll("[data-neighbourhood-link]").forEach((button) => button.addEventListener("click", () => { state.neighbourhood = button.dataset.neighbourhoodLink; navigate("#explore"); }));

window.addEventListener("hashchange", renderRoute);
renderRoute();
