const curatedRestaurants = window.HALIFAX_RESTAURANTS ?? [];
const osmRestaurants = window.HALIFAX_OSM_RESTAURANTS ?? [];
const osmMeta = window.HALIFAX_OSM_META ?? null;
const nsFoodInspectionPayload = window.HALIFAX_NS_FOOD_INSPECTIONS ?? null;
const nsFoodInspectionRecords = nsFoodInspectionPayload?.records ?? [];
const officialSiteSignalPayload = window.HALIFAX_OFFICIAL_SITE_SIGNALS ?? null;
const officialSiteSignals = officialSiteSignalPayload?.results ?? [];
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
  navFilters: [...document.querySelectorAll("[data-nav-filter]")],
  viewButtons: [...document.querySelectorAll(".view-button")],
  publicView: document.querySelector("#publicView"),
  adminView: document.querySelector("#adminView"),
  grid: document.querySelector("#restaurantGrid"),
  mapPlot: document.querySelector("#mapPlot"),
  adminQueue: document.querySelector("#adminQueue"),
  specialLeadList: document.querySelector("#specialLeadList"),
  eventLeadList: document.querySelector("#eventLeadList"),
  tonightList: document.querySelector("#tonightList"),
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

const officialSignalsByRestaurant = new Map(officialSiteSignals.map((signal) => [signal.restaurantId, signal]));
const nsInspectionByName = new Map();
for (const record of nsFoodInspectionRecords) {
  const key = normalizeLookup(record.name);
  if (!key) continue;
  if (!nsInspectionByName.has(key)) nsInspectionByName.set(key, []);
  nsInspectionByName.get(key).push(record);
}

function rawTags(restaurant) {
  return restaurant.osm?.rawTags ?? {};
}

function officialSignalFor(restaurant) {
  return officialSignalsByRestaurant.get(restaurant.id) ?? null;
}

function officialSignalHas(restaurant, kind) {
  const signal = officialSignalFor(restaurant);
  if (!signal) return false;
  return (signal.signalMatches?.[kind]?.length ?? 0) > 0 || signal.candidateLinks?.some((link) => (link.signalMatches?.[kind]?.length ?? 0) > 0);
}

function officialLinksFor(restaurant, kind, limit = 6) {
  const signal = officialSignalFor(restaurant);
  if (!signal) return [];
  return (signal.candidateLinks ?? [])
    .filter((link) => !kind || (link.signalMatches?.[kind]?.length ?? 0) > 0)
    .slice(0, limit);
}

function hasPatioSignal(restaurant) {
  const tags = rawTags(restaurant);
  const text = JSON.stringify(tags).toLowerCase();
  return tags.outdoor_seating === "yes" || /patio|terrace|rooftop|beer garden|outdoor seating/.test(text) || officialSignalHas(restaurant, "patio");
}

function hasOpeningSignal(restaurant) {
  const tags = rawTags(restaurant);
  const text = JSON.stringify(tags).toLowerCase();
  return Boolean(tags.start_date || tags.operational_status) || /now open|opening soon|grand opening|soft opening|new location|coming soon|newly opened/.test(text) || officialSignalHas(restaurant, "openings");
}

function hasSpecialSignal(restaurant) {
  return restaurant.specials.length > 0 || officialSignalHas(restaurant, "specials");
}

function hasEventSignal(restaurant) {
  return restaurant.events.length > 0 || officialSignalHas(restaurant, "events");
}

function hasMenuSignal(restaurant) {
  return Boolean(restaurant.website || rawTags(restaurant)["website:menu"] || officialSignalHas(restaurant, "menu"));
}

function sourceSignalSummary(restaurant) {
  const signals = [];
  if (hasSpecialSignal(restaurant)) signals.push("offers");
  if (hasEventSignal(restaurant)) signals.push("events");
  if (hasPatioSignal(restaurant)) signals.push("patio");
  if (hasOpeningSignal(restaurant)) signals.push("opening");
  if (!signals.length) signals.push(restaurant.sourceLayer === "openstreetmap" ? "directory" : "sources");
  return signals.slice(0, 2).join(" + ");
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
    label: `NS public registry: ${record.name}`,
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
window.__halifaxRestaurantCount = restaurants.length;
window.__halifaxOfficialSignalCount = officialSiteSignals.length;

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

function photoClass(restaurant) {
  const text = [restaurant.category, ...restaurant.cuisines, restaurant.name].join(" ").toLowerCase();
  if (/seafood|oyster|fish|lobster|sushi/.test(text)) return "seafood";
  if (/ramen|noodle|asian|thai|japanese|korean|chinese/.test(text)) return "noodles";
  if (/burger|pub|bar|beer|fast|pizza/.test(text)) return "pub";
  if (/cafe|coffee|bakery|dessert|ice cream/.test(text)) return "cafe";
  return "plates";
}

function normalizedText(restaurant) {
  const signal = officialSignalFor(restaurant);
  return [
    restaurant.name,
    restaurant.neighborhood,
    restaurant.category,
    restaurant.summary,
    restaurant.address,
    restaurant.openingHours,
    hasPatioSignal(restaurant) ? "patio outdoor rooftop terrace" : "",
    hasOpeningSignal(restaurant) ? "opening new coming soon now open" : "",
    ...(signal?.keywordHits ?? []),
    ...(signal?.candidateLinks ?? []).flatMap((link) => [link.text, link.href]),
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
  if (state.filter === "happy-hour") return /happy hour/i.test(JSON.stringify([restaurant.specials, officialSignalFor(restaurant)]));
  if (state.filter === "specials") return hasSpecialSignal(restaurant);
  if (state.filter === "events") return hasEventSignal(restaurant);
  if (state.filter === "patio") return hasPatioSignal(restaurant);
  if (state.filter === "openings") return hasOpeningSignal(restaurant);
  if (state.filter === "needs-review") return crossCheckReasons(restaurant).length > 0;
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

function crossCheckReasons(restaurant) {
  const reasons = [];
  if (!restaurant.website) reasons.push("missing direct website");
  if (!restaurant.address) reasons.push("missing address");
  if (!hasMenuSignal(restaurant)) reasons.push("missing menu link");
  if (!hasSpecialSignal(restaurant)) reasons.push("no special or happy-hour lead");
  if (!hasEventSignal(restaurant)) reasons.push("no event or live-music lead");
  if (!hasPatioSignal(restaurant)) reasons.push("patio unknown");
  if (restaurant.sourceLayer === "openstreetmap") reasons.push("directory-only source");
  if (daysSince(restaurant.freshnessDate) > 30) reasons.push("stale source check");
  return [...new Set(reasons)];
}

function renderStats() {
  const specialLeads = restaurants.filter(hasSpecialSignal).length;
  const eventLeads = restaurants.filter(hasEventSignal).length;
  const patioLeads = restaurants.filter(hasPatioSignal).length;

  elements.statRestaurants.textContent = restaurants.length;
  elements.statSpecials.textContent = specialLeads;
  elements.statEvents.textContent = eventLeads;
  elements.statEvidence.textContent = patioLeads;

  if (osmMeta) {
    const generated = osmMeta.generatedAt ? new Date(osmMeta.generatedAt).toLocaleString() : "not generated";
    elements.sourceScope.textContent = osmMeta.scope;
    const officialPart = officialSiteSignalPayload ? ` · ${officialSiteSignalPayload.count} official sites scanned` : "";
    const nsPart = nsFoodInspectionPayload ? ` · ${nsFoodInspectionPayload.count} NS public registry records indexed` : "";
    elements.sourceUpdated.textContent = `${osmMeta.count} OSM places imported · updated ${generated}${officialPart}${nsPart}`;
  }
}

function renderCards() {
  const visible = getFilteredRestaurants();
  elements.grid.innerHTML = "";
  elements.resultCount.textContent = `Showing ${visible.length} ${visible.length === 1 ? "place" : "places"}`;

  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "empty-results";
    empty.textContent = "No places match those filters yet.";
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
    const photo = fragment.querySelector(".card-photo");
    photo.classList.add(photoClass(restaurant));
    photo.dataset.label = restaurant.cuisines[0] ?? restaurant.category ?? "Halifax";

    button.dataset.id = restaurant.id;
    button.classList.toggle("is-selected", restaurant.id === state.selectedId);
    fragment.querySelector(".neighborhood").textContent = restaurant.neighborhood;
    fragment.querySelector(".freshness").textContent = freshness.text;
    if (freshness.className) fragment.querySelector(".freshness").classList.add(freshness.className);
    fragment.querySelector("h3").textContent = restaurant.name;
    fragment.querySelector(".meta").textContent = restaurant.summary;
    fragment.querySelector(".score").textContent = `${restaurant.qualityScore}`;
    fragment.querySelector(".evidence-badge").textContent = sourceSignalSummary(restaurant);
    fragment.querySelector(".evidence-badge").classList.add(restaurant.evidenceStatus);

    const tags = fragment.querySelector(".tags");
    [restaurant.category, ...restaurant.cuisines.slice(0, 2), ...restaurant.vibe.slice(0, 2), hasPatioSignal(restaurant) ? "patio lead" : null, hasOpeningSignal(restaurant) ? "opening lead" : null]
      .filter(Boolean)
      .forEach((tag) => {
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

function leadTitle(restaurant, kind) {
  const direct = kind === "specials" ? restaurant.specials[0]?.title : restaurant.events[0]?.title;
  if (direct) return direct;
  const link = officialLinksFor(restaurant, kind, 1)[0];
  return link?.text && link.text.length < 80 ? link.text : kind === "specials" ? "Special or happy-hour lead" : "Event or live-music lead";
}

function renderLeadList(target, rows, kind) {
  if (!target) return;
  target.innerHTML = "";
  for (const restaurant of rows.slice(0, 4)) {
    const link = officialLinksFor(restaurant, kind, 1)[0];
    const href = safeUrl(link?.href ?? restaurant.website);
    const item = document.createElement(href ? "a" : "div");
    item.className = "lead-row";
    if (href) {
      item.href = href;
      item.target = "_blank";
      item.rel = "noreferrer";
    }
    item.innerHTML = `<span class="lead-thumb ${photoClass(restaurant)}"></span><span><strong>${escapeHtml(leadTitle(restaurant, kind))}</strong><small>${escapeHtml(restaurant.name)} · ${escapeHtml(restaurant.neighborhood)}</small></span><b>${escapeHtml(kind === "specials" ? sourceSignalSummary(restaurant) : "event lead")}</b>`;
    target.append(item);
  }
}

function renderTonightPanel() {
  if (!elements.tonightList) return;
  elements.tonightList.innerHTML = "";
  const rows = restaurants.filter((restaurant) => hasEventSignal(restaurant) || hasSpecialSignal(restaurant) || hasPatioSignal(restaurant)).slice(0, 3);
  for (const restaurant of rows) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "tonight-row";
    item.innerHTML = `<span class="lead-thumb ${photoClass(restaurant)}"></span><span><strong>${escapeHtml(restaurant.name)}</strong><small>${escapeHtml(restaurant.neighborhood)} · ${escapeHtml(sourceSignalSummary(restaurant))}</small></span><i>›</i>`;
    item.addEventListener("click", () => {
      state.selectedId = restaurant.id;
      state.view = "public";
      render();
    });
    elements.tonightList.append(item);
  }
}
function renderLeadPanels() {
  renderLeadList(elements.specialLeadList, restaurants.filter(hasSpecialSignal), "specials");
  renderLeadList(elements.eventLeadList, restaurants.filter(hasEventSignal), "events");
  renderTonightPanel();
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

    marker.bindPopup(`<strong>${escapeHtml(restaurant.name)}</strong><br>${escapeHtml(restaurant.neighborhood)}<br>${escapeHtml(sourceSignalSummary(restaurant))}`);
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

function signalListMarkup(restaurant, kind, fallback) {
  const links = officialLinksFor(restaurant, kind);
  if (!links.length) return fallback;
  return links.map((link) => `<li><strong><a href="${escapeHtml(link.href)}" target="_blank" rel="noreferrer">${escapeHtml(link.text)}</a></strong><small>Official website signal</small></li>`).join("");
}

function patioOpeningMarkup(restaurant) {
  const tags = rawTags(restaurant);
  const rows = [];
  if (tags.outdoor_seating) rows.push(`<li><strong>Outdoor seating: ${escapeHtml(tags.outdoor_seating)}</strong><small>OpenStreetMap practical tag</small></li>`);
  if (tags.start_date) rows.push(`<li><strong>Opening/start date: ${escapeHtml(tags.start_date)}</strong><small>OpenStreetMap practical tag</small></li>`);
  if (tags.operational_status) rows.push(`<li><strong>Status: ${escapeHtml(tags.operational_status)}</strong><small>OpenStreetMap practical tag</small></li>`);
  for (const link of [...officialLinksFor(restaurant, "patio", 4), ...officialLinksFor(restaurant, "openings", 4)]) {
    rows.push(`<li><strong><a href="${escapeHtml(link.href)}" target="_blank" rel="noreferrer">${escapeHtml(link.text)}</a></strong><small>Official website signal</small></li>`);
  }
  if (!rows.length) return "<li>No patio or opening signal captured yet.<small>Ready for public source cross-reference.</small></li>";
  return rows.join("");
}

function renderDetail(restaurant) {
  elements.emptyDetail.hidden = Boolean(restaurant);
  elements.detail.hidden = !restaurant;
  if (!restaurant) return;

  const website = safeUrl(restaurant.website);
  const menuUrl = safeUrl(rawTags(restaurant)["website:menu"]);
  const mapUrl = restaurant.coordinates
    ? `https://www.openstreetmap.org/?mlat=${restaurant.coordinates.lat}&mlon=${restaurant.coordinates.lon}#map=18/${restaurant.coordinates.lat}/${restaurant.coordinates.lon}`
    : null;

  const specialsMarkup = restaurant.specials.length
    ? restaurant.specials.map((special) => `<li><strong>${escapeHtml(special.title)}</strong><small>${escapeHtml(special.cadence)} · ${escapeHtml(statusText(special.sourceStatus))}</small></li>`).join("")
    : signalListMarkup(restaurant, "specials", "<li>No happy-hour or special lead captured yet.<small>Ready for official menus, public calendars, and permitted social/API sources.</small></li>");

  const eventsMarkup = restaurant.events.length
    ? restaurant.events.map((event) => `<li><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.timing)} · ${escapeHtml(statusText(event.sourceStatus))}</small></li>`).join("")
    : signalListMarkup(restaurant, "events", "<li>No event lead captured yet.<small>Ready for calendars, ticketing pages, venue pages, and permitted social/API sources.</small></li>");

  const inspectionMarkup = restaurant.inspectionRecords?.length
    ? restaurant.inspectionRecords.map((record) => `<li><strong><a href="${escapeHtml(record.detailUrl)}" target="_blank" rel="noreferrer">${escapeHtml(record.name)}</a></strong><small>${escapeHtml(record.address)} · current as of ${escapeHtml(record.currentAsOf || "source search")}</small></li>`).join("")
    : "<li>No public registry cross-reference captured yet.<small>Useful for matching active establishments, not for ranking.</small></li>";

  const sourceMarkup = restaurant.sources.map((source) => {
    const url = safeUrl(source.url);
    const link = url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(source.label)}</a>` : `<strong>${escapeHtml(source.label)}</strong>`;
    return `<div class="source-item">${link}<span class="source-state ${escapeHtml(source.status)}">${escapeHtml(statusText(source.status))}</span></div>`;
  }).join("");

  elements.detail.innerHTML = `
    <div class="detail-hero ${photoClass(restaurant)}" aria-hidden="true"></div>
    <h2 class="detail-title">${escapeHtml(restaurant.name)}</h2>
    <p class="detail-subtitle">${escapeHtml(restaurant.neighborhood)} · ${escapeHtml([restaurant.category, ...restaurant.cuisines].filter(Boolean).join(", "))}</p>
    <p class="detail-subtitle">${escapeHtml(restaurant.summary)}</p>

    <div class="detail-actions"><a href="${escapeHtml(menuUrl || website || mapUrl || "#")}" target="_blank" rel="noreferrer">View Menu</a><a class="book" href="${escapeHtml(website || mapUrl || "#")}" target="_blank" rel="noreferrer">Book / Info</a></div>
    <div class="detail-tabs" aria-hidden="true"><span>Menu</span><span>Specials</span><span>Events</span><span>Info</span></div>

    <div class="fact-grid">
      ${detailFact("Address", restaurant.address, mapUrl)}
      ${detailFact("Hours", restaurant.openingHours)}
      ${detailFact("Phone", restaurant.phone)}
      ${detailFact("Website", website ? "Official site" : null, website)}
      ${detailFact("Menu", menuUrl ? "Menu link" : null, menuUrl)}
    </div>

    <div class="quality-meter" aria-label="Source coverage score ${restaurant.qualityScore} out of 100">
      <div class="meter-bar"><div class="meter-fill" style="width: ${restaurant.qualityScore}%"></div></div>
      <strong>${restaurant.qualityScore}/100 source coverage</strong>
    </div>

    <section class="detail-section"><h3>Offer Leads</h3><ul class="detail-list">${specialsMarkup}</ul></section>
    <section class="detail-section"><h3>Event Leads</h3><ul class="detail-list">${eventsMarkup}</ul></section>
    <section class="detail-section"><h3>Patio and Opening Signals</h3><ul class="detail-list">${patioOpeningMarkup(restaurant)}</ul></section>
    <section class="detail-section"><h3>Best for</h3><div class="tags">${restaurant.vibe.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div></section>
    <section class="detail-section"><h3>Source Gaps</h3><div class="tags">${crossCheckReasons(restaurant).slice(0, 8).map((reason) => `<span class="tag alert">${escapeHtml(reason)}</span>`).join("")}</div></section>
    <section class="detail-section"><h3>Public Cross-References</h3><ul class="detail-list">${inspectionMarkup}</ul></section>
    <section class="detail-section"><h3>Sources</h3><div class="source-list">${sourceMarkup}</div></section>
  `;
}

function renderAdmin() {
  const reviewItems = getFilteredRestaurants().filter((restaurant) => crossCheckReasons(restaurant).length > 0);
  elements.reviewCount.textContent = `${reviewItems.length} ${reviewItems.length === 1 ? "record" : "records"} to cross-check`;
  elements.adminQueue.innerHTML = "";

  for (const restaurant of reviewItems.slice(0, 200)) {
    const item = document.createElement("article");
    item.className = "admin-card";
    item.innerHTML = `
      <div>
        <p class="eyebrow">${escapeHtml(restaurant.neighborhood)} · ${escapeHtml(sourceSignalSummary(restaurant))}</p>
        <h3>${escapeHtml(restaurant.name)}</h3>
        <p>${escapeHtml(restaurant.address ?? restaurant.summary)}</p>
      </div>
      <div class="tags">${crossCheckReasons(restaurant).slice(0, 5).map((reason) => `<span class="tag alert">${escapeHtml(reason)}</span>`).join("")}</div>
    `;
    elements.adminQueue.append(item);
  }
}

function renderView() {
  const showSources = state.view === "sources";
  elements.publicView.hidden = showSources;
  elements.adminView.hidden = !showSources;
  elements.viewButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.view === state.view));
}

function render() {
  elements.chips.forEach((chip) => chip.classList.toggle("is-active", chip.dataset.filter === state.filter));
  elements.navFilters.forEach((button) => button.classList.toggle("is-active", button.dataset.navFilter === state.filter || (state.filter === "all" && button.dataset.navFilter === "all")));
  renderView();
  renderStats();
  renderLeadPanels();
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
    state.view = "public";
    render();
  });
});

elements.navFilters.forEach((button) => {
  button.addEventListener("click", () => {
    state.filter = button.dataset.navFilter;
    state.view = "public";
    render();
    const target = button.dataset.scrollTarget ? document.querySelector(`#${button.dataset.scrollTarget}`) : null;
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

elements.viewButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.view = button.dataset.view;
    render();
  });
});

render();