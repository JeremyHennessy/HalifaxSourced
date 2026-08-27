const curatedRestaurants = window.HALIFAX_RESTAURANTS ?? [];
const osmRestaurants = window.HALIFAX_OSM_RESTAURANTS ?? [];
const osmMeta = window.HALIFAX_OSM_META ?? null;
const nsFoodInspectionPayload = window.HALIFAX_NS_FOOD_INSPECTIONS ?? null;
const nsFoodInspectionRecords = nsFoodInspectionPayload?.records ?? [];
let leafletMap = null;
let leafletMarkerLayer = null;

const state = {
  query: "",
  filter: "all",
  sort: "quality",
  view: "public",
  selectedId: null
};

const elements = {
  search: document.querySelector("#search"),
  sort: document.querySelector("#sort"),
  chips: [...document.querySelectorAll(".filter-chip")],
  viewButtons: [...document.querySelectorAll(".view-button")],
  publicView: document.querySelector("#publicView"),
  adminView: document.querySelector("#adminView"),
  grid: document.querySelector("#restaurantGrid"),
  mapPlot: document.querySelector("#mapPlot"),
  adminQueue: document.querySelector("#adminQueue"),
  resultCount: document.querySelector("#resultCount"),
  reviewCount: document.querySelector("#reviewCount"),
  statRestaurants: document.querySelector("#statRestaurants"),
  statSpecials: document.querySelector("#statSpecials"),
  statEvents: document.querySelector("#statEvents"),
  statEvidence: document.querySelector("#statEvidence"),
  sourceScope: document.querySelector("#sourceScope"),
  sourceUpdated: document.querySelector("#sourceUpdated"),
  emptyDetail: document.querySelector("#emptyDetail"),
  detail: document.querySelector("#restaurantDetail"),
  template: document.querySelector("#restaurantCardTemplate")
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function keyForName(name) {
  return String(name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function mergeSources(a = [], b = []) {
  const seen = new Set();
  return [...a, ...b].filter((source) => {
    const key = `${source.type}|${source.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeLookup(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\bthe\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function addressLookup(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(street|st|avenue|ave|road|rd|drive|dr|boulevard|blvd|lane|ln|nova scotia|halifax|dartmouth|bedford)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

const nsInspectionByName = new Map();
for (const record of nsFoodInspectionRecords) {
  const key = normalizeLookup(record.name);
  if (!key) continue;
  if (!nsInspectionByName.has(key)) nsInspectionByName.set(key, []);
  nsInspectionByName.get(key).push(record);
}

function findInspectionMatches(restaurant) {
  const nameKey = normalizeLookup(restaurant.name);
  const addressKey = addressLookup(restaurant.address);
  const candidates = nsFoodInspectionRecords.filter((record) => {
    const recordName = normalizeLookup(record.name);
    const recordAddress = addressLookup(record.address);
    const nameMatch = recordName === nameKey || (nameKey.length > 8 && recordName.includes(nameKey)) || (recordName.length > 8 && nameKey.includes(recordName));
    const addressMatch = addressKey && recordAddress && (recordAddress.includes(addressKey.slice(0, 12)) || addressKey.includes(recordAddress.slice(0, 12)));
    return nameMatch || (addressMatch && recordName.slice(0, 6) === nameKey.slice(0, 6));
  });

  const exact = nsInspectionByName.get(nameKey) ?? [];
  return [...exact, ...candidates]
    .filter((record, index, all) => all.findIndex((item) => item.id === record.id) === index)
    .slice(0, 5);
}

function attachInspectionEvidence(restaurant) {
  const inspectionRecords = findInspectionMatches(restaurant);
  if (!inspectionRecords.length) return { ...restaurant, inspectionRecords: [] };

  const inspectionSources = inspectionRecords.map((record) => ({
    label: `NS inspection: ${record.name}`,
    type: "ns_food_inspection",
    url: record.detailUrl,
    status: "verified"
  }));

  return {
    ...restaurant,
    inspectionRecords,
    sources: mergeSources(restaurant.sources, inspectionSources)
  };
}
function mergeRestaurantLayers(curated, osm) {
  const byName = new Map();
  const merged = curated.map((restaurant) => ({ ...restaurant, sourceLayer: "curated" }));

  merged.forEach((restaurant) => byName.set(keyForName(restaurant.name), restaurant));

  for (const osmRestaurant of osm) {
    const match = byName.get(keyForName(osmRestaurant.name));
    if (!match) {
      merged.push({ ...osmRestaurant, sourceLayer: "openstreetmap" });
      continue;
    }

    match.category ??= osmRestaurant.category;
    match.address ??= osmRestaurant.address;
    match.phone ??= osmRestaurant.phone;
    match.website ??= osmRestaurant.website;
    match.openingHours ??= osmRestaurant.openingHours;
    match.coordinates ??= osmRestaurant.coordinates;
    match.sources = mergeSources(match.sources, osmRestaurant.sources);
    match.osm ??= osmRestaurant.osm;
  }

  return merged;
}

const restaurants = mergeRestaurantLayers(curatedRestaurants, osmRestaurants).map(attachInspectionEvidence);
state.selectedId = restaurants[0]?.id ?? null;

function daysSince(dateValue) {
  const date = new Date(`${dateValue}T00:00:00`);
  const now = new Date();
  return Math.max(0, Math.floor((now - date) / 86400000));
}

function freshnessLabel(dateValue) {
  const days = daysSince(dateValue);
  if (days <= 7) return { text: "fresh", className: "is-fresh" };
  if (days <= 30) return { text: `${days}d old`, className: "" };
  return { text: "stale", className: "is-stale" };
}

function categoryKey(restaurant) {
  const amenity = restaurant.osm?.amenity;
  if (["bar", "pub"].includes(amenity)) return "bar";
  if (amenity === "cafe") return "cafe";
  if (["fast_food", "food_court", "ice_cream"].includes(amenity)) return "quick";
  if ((restaurant.category ?? "").toLowerCase().includes("cafe")) return "cafe";
  if ((restaurant.category ?? "").toLowerCase().match(/bar|pub/)) return "bar";
  if ((restaurant.category ?? "").toLowerCase().match(/quick|dessert|food court/)) return "quick";
  return "restaurant";
}

function normalizedText(restaurant) {
  return [
    restaurant.name,
    restaurant.neighborhood,
    restaurant.category,
    restaurant.summary,
    restaurant.address,
    restaurant.openingHours,
    ...restaurant.cuisines,
    ...restaurant.vibe
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesFilter(restaurant) {
  if (state.filter === "all") return true;
  if (["restaurant", "cafe", "bar", "quick"].includes(state.filter)) return categoryKey(restaurant) === state.filter;
  if (state.filter === "happy-hour") return restaurant.specials.some((special) => /happy hour/i.test(special.title));
  if (state.filter === "specials") return restaurant.specials.length > 0;
  if (state.filter === "events") return restaurant.events.length > 0;
  if (state.filter === "needs-review") return reviewReasons(restaurant).length > 0;
  return true;
}

function getFilteredRestaurants() {
  const query = state.query.trim().toLowerCase();
  return restaurants
    .filter((restaurant) => !query || normalizedText(restaurant).includes(query))
    .filter(matchesFilter)
    .sort((a, b) => {
      if (state.sort === "name") return a.name.localeCompare(b.name);
      if (state.sort === "neighborhood") return a.neighborhood.localeCompare(b.neighborhood) || a.name.localeCompare(b.name);
      if (state.sort === "freshness") return daysSince(a.freshnessDate) - daysSince(b.freshnessDate);
      return b.qualityScore - a.qualityScore;
    });
}

function statusText(status) {
  return String(status ?? "unknown").replaceAll("-", " ");
}

function reviewReasons(restaurant) {
  const reasons = [];
  if (restaurant.evidenceStatus !== "verified") reasons.push(statusText(restaurant.evidenceStatus));
  if (restaurant.sourceLayer === "openstreetmap") reasons.push("OSM-only directory record");
  if (!restaurant.website) reasons.push("missing official website");
  if (!restaurant.address) reasons.push("missing address");
  if (restaurant.specials.length === 0) reasons.push("no captured specials");
  if (restaurant.events.length === 0) reasons.push("no captured events");
  if (daysSince(restaurant.freshnessDate) > 30) reasons.push("stale check date");
  return [...new Set(reasons)];
}

function renderStats() {
  const specials = restaurants.reduce((count, item) => count + item.specials.length, 0);
  const events = restaurants.reduce((count, item) => count + item.events.length, 0);
  const reviewNeeded = restaurants.filter((item) => reviewReasons(item).length > 0).length;

  elements.statRestaurants.textContent = restaurants.length;
  elements.statSpecials.textContent = specials;
  elements.statEvents.textContent = events;
  elements.statEvidence.textContent = reviewNeeded;

  if (osmMeta) {
    const generated = osmMeta.generatedAt ? new Date(osmMeta.generatedAt).toLocaleString() : "not generated";
    elements.sourceScope.textContent = osmMeta.scope;
    const nsPart = nsFoodInspectionPayload ? ` · ${nsFoodInspectionPayload.count} NS inspection records indexed` : "";
    elements.sourceUpdated.textContent = `${osmMeta.count} OSM places imported · updated ${generated}${nsPart}`;
  }
}

function renderCards() {
  const visible = getFilteredRestaurants();
  elements.grid.innerHTML = "";
  elements.resultCount.textContent = `Showing ${visible.length} ${visible.length === 1 ? "place" : "places"}`;

  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "empty-results";
    empty.textContent = "No restaurants match those filters yet.";
    elements.grid.append(empty);
    renderDetail(null);
    renderMap([]);
    return;
  }

  if (!visible.some((restaurant) => restaurant.id === state.selectedId)) state.selectedId = visible[0].id;

  for (const restaurant of visible) {
    const fragment = elements.template.content.cloneNode(true);
    const button = fragment.querySelector(".card-button");
    const freshness = freshnessLabel(restaurant.freshnessDate);

    button.dataset.id = restaurant.id;
    button.classList.toggle("is-selected", restaurant.id === state.selectedId);
    fragment.querySelector(".neighborhood").textContent = restaurant.neighborhood;
    fragment.querySelector(".freshness").textContent = freshness.text;
    if (freshness.className) fragment.querySelector(".freshness").classList.add(freshness.className);
    fragment.querySelector("h3").textContent = restaurant.name;
    fragment.querySelector(".meta").textContent = restaurant.summary;
    fragment.querySelector(".score").textContent = `${restaurant.qualityScore}`;
    fragment.querySelector(".evidence-badge").textContent = restaurant.sourceLayer === "openstreetmap" ? "directory" : statusText(restaurant.evidenceStatus);
    fragment.querySelector(".evidence-badge").classList.add(restaurant.evidenceStatus);

    const tags = fragment.querySelector(".tags");
    [restaurant.category, ...restaurant.cuisines.slice(0, 2), ...restaurant.vibe.slice(0, 2)].filter(Boolean).forEach((tag) => {
      const tagElement = document.createElement("span");
      tagElement.className = "tag";
      tagElement.textContent = tag;
      tags.append(tagElement);
    });

    button.addEventListener("click", () => {
      state.selectedId = restaurant.id;
      render();
    });

    elements.grid.append(fragment);
  }

  renderMap(visible);
  renderDetail(restaurants.find((restaurant) => restaurant.id === state.selectedId));
}

function markerColor(restaurant) {
  const key = categoryKey(restaurant);
  if (key === "cafe") return "#9a6a1f";
  if (key === "bar") return "#2f5f89";
  if (key === "quick") return "#a6473e";
  return "#2f6f54";
}

function initLeafletMap() {
  if (leafletMap || !window.L) return Boolean(leafletMap);

  leafletMap = L.map(elements.mapPlot, {
    scrollWheelZoom: false,
    preferCanvas: true
  }).setView([44.6488, -63.5752], 13);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(leafletMap);

  leafletMarkerLayer = L.layerGroup().addTo(leafletMap);
  setTimeout(() => leafletMap.invalidateSize(), 0);
  return true;
}

function renderMap(visible) {
  const plotted = visible.filter((restaurant) => restaurant.coordinates).slice(0, 700);
  if (!initLeafletMap()) {
    elements.mapPlot.innerHTML = '<div class="map-fallback">Interactive map could not load. The list view is still available.</div>';
    return;
  }

  leafletMarkerLayer.clearLayers();
  window.__halifaxMapMarkerCount = 0;
  const bounds = [];

  for (const restaurant of plotted) {
    const { lat, lon } = restaurant.coordinates;
    const selected = restaurant.id === state.selectedId;
    const marker = L.circleMarker([lat, lon], {
      radius: selected ? 8 : 5,
      color: "#ffffff",
      weight: selected ? 3 : 2,
      fillColor: markerColor(restaurant),
      fillOpacity: selected ? 1 : 0.82,
      className: `map-pin ${categoryKey(restaurant)}${selected ? " is-selected" : ""}`
    });

    marker.bindPopup(`<strong>${escapeHtml(restaurant.name)}</strong><br>${escapeHtml(restaurant.neighborhood)}<br>${escapeHtml(restaurant.category ?? "Food and drink")}`);
    marker.on("click", () => {
      state.selectedId = restaurant.id;
      render();
      marker.openPopup();
    });
    marker.addTo(leafletMarkerLayer);
    window.__halifaxMapMarkerCount += 1;
    bounds.push([lat, lon]);
  }

  if (bounds.length && !leafletMap._halifaxInitialFit) {
    leafletMap.fitBounds(bounds, { padding: [24, 24], maxZoom: 14 });
    leafletMap._halifaxInitialFit = true;
  }
}
function detailFact(label, value, href = null) {
  if (!value) return "";
  const content = href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(value)}</a>` : `<strong>${escapeHtml(value)}</strong>`;
  return `<div class="fact"><span>${escapeHtml(label)}</span>${content}</div>`;
}

function renderDetail(restaurant) {
  elements.emptyDetail.hidden = Boolean(restaurant);
  elements.detail.hidden = !restaurant;
  if (!restaurant) return;

  const website = safeUrl(restaurant.website);
  const mapUrl = restaurant.coordinates
    ? `https://www.openstreetmap.org/?mlat=${restaurant.coordinates.lat}&mlon=${restaurant.coordinates.lon}#map=18/${restaurant.coordinates.lat}/${restaurant.coordinates.lon}`
    : null;

  const specialsMarkup = restaurant.specials.length
    ? restaurant.specials.map((special) => `<li><strong>${escapeHtml(special.title)}</strong><small>${escapeHtml(special.cadence)} · ${escapeHtml(statusText(special.sourceStatus))}</small></li>`).join("")
    : "<li>No current special captured yet.<small>Ready for official menu, owner submission, or permitted social/API source.</small></li>";

  const eventsMarkup = restaurant.events.length
    ? restaurant.events.map((event) => `<li><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.timing)} · ${escapeHtml(statusText(event.sourceStatus))}</small></li>`).join("")
    : "<li>No upcoming event captured yet.<small>Ready for calendar, ticketing, or restaurant-owned channel.</small></li>";


  const inspectionMarkup = restaurant.inspectionRecords?.length
    ? restaurant.inspectionRecords.map((record) => `<li><strong><a href="${escapeHtml(record.detailUrl)}" target="_blank" rel="noreferrer">${escapeHtml(record.name)}</a></strong><small>${escapeHtml(record.address)} · current as of ${escapeHtml(record.currentAsOf || "source search")}</small></li>`).join("")
    : "<li>No inspection registry match captured yet.<small>Ready for name/address review against Government of Nova Scotia records.</small></li>";
  const sourceMarkup = restaurant.sources.map((source) => {
    const url = safeUrl(source.url);
    const link = url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(source.label)}</a>` : `<strong>${escapeHtml(source.label)}</strong>`;
    return `<div class="source-item">${link}<span class="source-state ${escapeHtml(source.status)}">${escapeHtml(statusText(source.status))}</span></div>`;
  }).join("");

  elements.detail.innerHTML = `
    <h2 class="detail-title">${escapeHtml(restaurant.name)}</h2>
    <p class="detail-subtitle">${escapeHtml(restaurant.neighborhood)} · ${escapeHtml([restaurant.category, ...restaurant.cuisines].filter(Boolean).join(", "))}</p>
    <p class="detail-subtitle">${escapeHtml(restaurant.summary)}</p>

    <div class="fact-grid">
      ${detailFact("Address", restaurant.address, mapUrl)}
      ${detailFact("Hours", restaurant.openingHours)}
      ${detailFact("Phone", restaurant.phone)}
      ${detailFact("Website", website ? "Official site" : null, website)}
    </div>

    <div class="quality-meter" aria-label="Quality score ${restaurant.qualityScore} out of 100">
      <div class="meter-bar"><div class="meter-fill" style="width: ${restaurant.qualityScore}%"></div></div>
      <strong>${restaurant.qualityScore}/100</strong>
    </div>

    <section class="detail-section"><h3>Specials</h3><ul class="detail-list">${specialsMarkup}</ul></section>
    <section class="detail-section"><h3>Events</h3><ul class="detail-list">${eventsMarkup}</ul></section>
    <section class="detail-section"><h3>Inspection Registry</h3><ul class="detail-list">${inspectionMarkup}</ul></section>
    <section class="detail-section"><h3>Best for</h3><div class="tags">${restaurant.vibe.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div></section>
    <section class="detail-section"><h3>Review Needs</h3><div class="tags">${reviewReasons(restaurant).slice(0, 8).map((reason) => `<span class="tag alert">${escapeHtml(reason)}</span>`).join("")}</div></section>
    <section class="detail-section"><h3>Source Evidence</h3><div class="source-list">${sourceMarkup}</div></section>
  `;
}

function renderAdmin() {
  const reviewItems = getFilteredRestaurants().filter((restaurant) => reviewReasons(restaurant).length > 0);
  elements.reviewCount.textContent = `${reviewItems.length} ${reviewItems.length === 1 ? "record" : "records"} need review`;
  elements.adminQueue.innerHTML = "";

  for (const restaurant of reviewItems.slice(0, 200)) {
    const item = document.createElement("article");
    item.className = "admin-card";
    item.innerHTML = `
      <div>
        <p class="eyebrow">${escapeHtml(restaurant.neighborhood)} · ${escapeHtml(restaurant.sourceLayer)}</p>
        <h3>${escapeHtml(restaurant.name)}</h3>
        <p>${escapeHtml(restaurant.address ?? restaurant.summary)}</p>
      </div>
      <div class="tags">${reviewReasons(restaurant).slice(0, 5).map((reason) => `<span class="tag alert">${escapeHtml(reason)}</span>`).join("")}</div>
    `;
    elements.adminQueue.append(item);
  }
}

function renderView() {
  const showAdmin = state.view === "admin";
  elements.publicView.hidden = showAdmin;
  elements.adminView.hidden = !showAdmin;
  elements.viewButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.view === state.view));
}

function render() {
  elements.chips.forEach((chip) => chip.classList.toggle("is-active", chip.dataset.filter === state.filter));
  renderView();
  renderStats();
  renderCards();
  renderAdmin();
}

elements.search.addEventListener("input", (event) => {
  state.query = event.target.value;
  render();
});

elements.sort.addEventListener("change", (event) => {
  state.sort = event.target.value;
  render();
});

elements.chips.forEach((chip) => {
  chip.addEventListener("click", () => {
    state.filter = chip.dataset.filter;
    render();
  });
});

elements.viewButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.view = button.dataset.view;
    render();
  });
});

render();
