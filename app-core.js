"use strict";

const curatedRestaurants = Array.isArray(window.HALIFAX_RESTAURANTS) ? window.HALIFAX_RESTAURANTS : [];
const osmRestaurants = Array.isArray(window.HALIFAX_OSM_RESTAURANTS) ? window.HALIFAX_OSM_RESTAURANTS : [];
const osmMeta = window.HALIFAX_OSM_META ?? null;
const officialPayload = window.HALIFAX_OFFICIAL_SITE_SIGNALS ?? null;
const officialSignals = Array.isArray(officialPayload?.results) ? officialPayload.results : [];
const inspectionPayload = window.HALIFAX_NS_FOOD_INSPECTIONS ?? null;
const inspectionRecords = Array.isArray(inspectionPayload?.records) ? inspectionPayload.records : [];
const structuredEventPayload = window.HALIFAX_STRUCTURED_EVENTS ?? null;
const structuredEvents = Array.isArray(structuredEventPayload?.events) ? structuredEventPayload.events : [];
const verifiedSourcePayload = window.HALIFAX_VERIFIED_SOURCE_PAGES ?? null;
const verifiedMenuSources = Array.isArray(verifiedSourcePayload?.menuSources) ? verifiedSourcePayload.menuSources : [];
const verifiedSpecialSources = Array.isArray(verifiedSourcePayload?.specialSources) ? verifiedSourcePayload.specialSources : [];
const reviewedPlaceResolutionPayload = window.HALIFAX_REVIEWED_PLACE_RESOLUTIONS ?? null;
const reviewedPlaceResolutions = Array.isArray(reviewedPlaceResolutionPayload?.records) ? reviewedPlaceResolutionPayload.records : [];
const reviewedPlaceResolutionById = new Map(reviewedPlaceResolutions.map((record) => [record.restaurantId, record]));

const appView = document.querySelector("#appView");
const globalSearch = document.querySelector("#globalSearch");
const searchForm = document.querySelector("#globalSearchForm");
const toastRegion = document.querySelector("#toastRegion");
const routeLinks = [...document.querySelectorAll("[data-route-link]")];

const STORAGE_KEY = "halifaxSourced.saved.v2";
const PAGE_SIZE = 12;
const MAP_DEFAULT = [44.6488, -63.5752];

const state = {
  query: "",
  cuisine: "all",
  neighbourhood: "all",
  feature: "all",
  page: 1,
  sort: "recommended",
  discoveryReturnHash: "#explore",
  saved: readSaved(),
  map: null,
  mapLayer: null,
  mapRenderer: null
};

function readSaved() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function persistSaved() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...state.saved]));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeUrl(value) {
  if (!value || !HalifaxDataIntegrity.safeSource(value)) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\bthe\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}


const officialById = new Map(officialSignals.map((signal) => [signal.restaurantId, signal]));
// Source recency must consider every original observation, not the single row
// chosen by legacy detail decorators. A later failure cannot hide old success.
function observationRowsById(records) {
  const grouped = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    if (!record?.restaurantId) continue;
    if (!grouped.has(record.restaurantId)) grouped.set(record.restaurantId, []);
    grouped.get(record.restaurantId).push(record);
  }
  return grouped;
}
const officialObservationRowsById = observationRowsById(officialSignals);
const firstPartyObservationRowsById = observationRowsById(window.HALIFAX_FIRST_PARTY_SOURCES?.records);
function officialSourceObservationStamp(restaurant) {
  const rows = officialObservationRowsById.get(restaurant?.id) || (restaurant?.signal ? [restaurant.signal] : []);
  return rows.filter(record => record.restaurantId === restaurant?.id)
    .map(record => HalifaxDataIntegrity.officialObservationStamp(record)).filter(Boolean).sort().at(-1) || "";
}
function restaurantSourceObservationStamp(restaurant) {
  return HalifaxDataIntegrity.restaurantObservationStamp(restaurant, {
    officialResults: officialObservationRowsById.get(restaurant?.id),
    firstPartyRecords: firstPartyObservationRowsById.get(restaurant?.id)
  });
}

const structuredEventsByRestaurant = new Map();
for (const event of structuredEvents) {
  if (!event?.restaurantId) continue;
  if (!structuredEventsByRestaurant.has(event.restaurantId)) structuredEventsByRestaurant.set(event.restaurantId, []);
  structuredEventsByRestaurant.get(event.restaurantId).push(event);
}
for (const events of structuredEventsByRestaurant.values()) events.sort((a, b) => String(a.startAt || "").localeCompare(String(b.startAt || "")));

function groupVerifiedSources(records) {
  const grouped = new Map();
  for (const record of records) {
    if (!record?.restaurantId || !record?.url || record.reviewState !== "verified") continue;
    const url = safeUrl(record.url);
    if (!url || !HalifaxDataIntegrity.pointerSafe(record.restaurantId, record.kind, url)) continue;
    if (!grouped.has(record.restaurantId)) grouped.set(record.restaurantId, []);
    grouped.get(record.restaurantId).push({
      label: record.label || (record.kind === "menu" ? "Menu" : "Specials"),
      url,
      verified: true,
      verifiedAt: record.verifiedAt || null,
      sourceKind: record.sourceKind || "official_page"
    });
  }
  return grouped;
}

const verifiedMenuSourcesByRestaurant = groupVerifiedSources(verifiedMenuSources);
const verifiedSpecialSourcesByRestaurant = groupVerifiedSources(verifiedSpecialSources);

function mergeRestaurantLayers() {
  const merged = curatedRestaurants.map((restaurant) => ({ ...restaurant, sourceLayer: "curated" }));
  const curatedTargets = [...merged];
  window.__halifaxIdentityReviewQueue = [];
  for (const osm of osmRestaurants) {
    const decision = window.HalifaxRestaurantIdentity.find(curatedTargets, osm, window.HALIFAX_RESTAURANT_CORRECTIONS?.aliases || []);
    if (decision.state === "review") {
      window.__halifaxIdentityReviewQueue.push({ sourceId: osm.id, name: osm.name, reason: decision.reason, candidateIds: decision.candidateIds || [] });
      continue;
    }
    if (decision.state === "match") window.HalifaxRestaurantIdentity.merge(decision.record, osm, decision);
    else merged.push({ ...osm, sourceLayer: "openstreetmap" });
  }
  return merged.map((restaurant) => enrichRestaurant(applyReviewedPlaceResolution(restaurant)));
}

function applyReviewedPlaceResolution(restaurant) {
  return window.HalifaxRestaurantIdentity.applyResolution(restaurant, reviewedPlaceResolutions);
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function mergeSources(a = [], b = []) {
  const map = new Map();
  for (const source of [...(a || []), ...(b || [])]) {
    const key = `${source?.type || "source"}|${source?.url || source?.label || ""}`;
    if (!map.has(key)) map.set(key, source);
  }
  return [...map.values()];
}

function inspectionMatches(restaurant) {
  return window.HalifaxInspectionMatching.matches(restaurant, inspectionRecords);
}

function signalHas(signal, kind) {
  if (!signal || (signal.website && !safeUrl(signal.website))) return false;
  if ((signal.signalMatches?.[kind]?.length || 0) > 0) return true;
  return (signal.candidateLinks || []).some((link) => (link.signalMatches?.[kind]?.length || 0) > 0);
}

function signalLinks(signal, kind) {
  if (!signal || (signal.website && !safeUrl(signal.website))) return [];
  const links = (signal.candidateLinks || [])
    .filter((link) => !kind || (link.signalMatches?.[kind]?.length || 0) > 0)
    .map((link) => ({ label: link.text || kind || "Official link", url: safeUrl(link.href) }))
    .filter((link) => link.url);
  return links.filter((link, index, all) => all.findIndex((item) => item.url === link.url) === index);
}

function preferredSourceLinks(verifiedMap, restaurantId, fallback) {
  const verified = verifiedMap.get(restaurantId) || [];
  return verified.length ? verified : fallback;
}

function rawTags(restaurant) {
  return restaurant.osm?.rawTags || {};
}

function socialUrl(platform, value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const direct = safeUrl(raw);
  if (direct) return direct;
  const handle = raw.replace(/^@/, "").replace(/^\/+|\/+$/g, "");
  const bases = { facebook: "https://www.facebook.com/", instagram: "https://www.instagram.com/", x: "https://x.com/", tiktok: "https://www.tiktok.com/@" };
  return bases[platform] && handle ? `${bases[platform]}${handle}` : null;
}

function osmSocialProfiles(restaurant) {
  const tags = rawTags(restaurant);
  return [
    ["facebook", tags["contact:facebook"] || tags.facebook],
    ["instagram", tags["contact:instagram"] || tags.instagram],
    ["x", tags["contact:twitter"] || tags.twitter],
    ["tiktok", tags["contact:tiktok"] || tags.tiktok]
  ].map(([platform, value]) => {
    const url = socialUrl(platform, value);
    if (!url) return null;
    let handle = String(value || "").replace(/^@/, "");
    try { handle = new URL(url).pathname.replace(/^\/+|\/+$/g, "").replace(/^@/, ""); } catch {}
    return { platform, url, handle, associationBasis: "openstreetmap_contact_tag", reviewState: "source_observed" };
  }).filter(Boolean);
}

function hasPatio(restaurant, signal) {
  const tags = rawTags(restaurant);
  const text = JSON.stringify(tags).toLowerCase();
  return tags.outdoor_seating === "yes" || /patio|terrace|rooftop|beer garden|outdoor seating/.test(text) || signalHas(signal, "patio");
}

function hasOpening(restaurant, signal) {
  const tags = rawTags(restaurant);
  const text = JSON.stringify(tags).toLowerCase();
  return Boolean(tags.start_date || tags.operational_status) || /now open|opening soon|grand opening|soft opening|new location|coming soon|newly opened/.test(text) || signalHas(signal, "openings");
}

function enrichRestaurant(restaurant) {
  const signal = officialById.get(restaurant.id) || null;
  const inspections = inspectionMatches(restaurant);
  const reviewedMenuLinks = (restaurant.sources || [])
    .filter((source) => source.type === "menu" && safeUrl(source.url))
    .map((source) => ({ label: source.label || "Official menu", url: safeUrl(source.url), verified: source.status === "verified", sourceKind: "reviewed_neighbourhood_resolution" }));
  const candidateMenuLinks = [...reviewedMenuLinks, ...signalLinks(signal, "menu")]
    .filter((link, index, all) => all.findIndex((item) => item.url === link.url) === index);
  const candidateSpecialLinks = signalLinks(signal, "specials");
  const menuLinks = preferredSourceLinks(verifiedMenuSourcesByRestaurant, restaurant.id, candidateMenuLinks);
  const specialLinks = preferredSourceLinks(verifiedSpecialSourcesByRestaurant, restaurant.id, candidateSpecialLinks);
  const eventLinks = signalLinks(signal, "events");
  const reservationLinks = signalLinks(signal, "reservations");
  const structuredRestaurantEvents = structuredEventsByRestaurant.get(restaurant.id) || [];
  // Evidence sources (maps, directories, news) are not automatically an official business website.
  const website = safeUrl(restaurant.website) || safeUrl(signal?.website) || null;
  const score = Number.isFinite(restaurant.qualityScore) ? restaurant.qualityScore : sourceCoverageScore(restaurant, signal, inspections);
  const active = isRestaurantActive(restaurant);
  return {
    ...restaurant,
    cuisines: unique(restaurant.cuisines || [restaurant.category]),
    vibe: unique(restaurant.vibe || []),
    specials: active && Array.isArray(restaurant.specials) ? restaurant.specials : [],
    events: active && Array.isArray(restaurant.events) ? restaurant.events : [],
    structuredEvents: active ? structuredRestaurantEvents : [],
    sources: Array.isArray(restaurant.sources) ? restaurant.sources : [],
    signal,
    inspections,
    menuLinks: active ? menuLinks : [],
    specialLinks: active ? specialLinks : [],
    eventLinks: active ? eventLinks : [],
    reservationLinks: active ? reservationLinks : [],
    socialProfiles: [...(restaurant.socialProfiles || []), ...osmSocialProfiles(restaurant)],
    website,
    hasMenu: active && menuLinks.length > 0,
    hasSpecial: active && (specialLinks.length > 0 || (restaurant.specials || []).length > 0),
    hasEvent: active && (structuredRestaurantEvents.length > 0 || eventLinks.length > 0 || (restaurant.events || []).length > 0 || signalHas(signal, "events")),
    hasPatio: hasPatio(restaurant, signal),
    hasOpening: active && hasOpening(restaurant, signal),
    hasReservation: active && (reservationLinks.length > 0 || signalHas(signal, "reservations")),
    score
  };
}

function isRestaurantActive(restaurant) {
  return HalifaxRestaurantCorrections.isActive(restaurant);
}

function sourceCoverageScore(restaurant, signal, inspections) {
  let score = 45;
  if (restaurant.website || signal?.website) score += 12;
  if (restaurant.address) score += 8;
  if (restaurant.phone) score += 5;
  if ((restaurant.cuisines || []).length) score += 5;
  if (restaurant.openingHours) score += 5;
  if (signal) score += 10;
  if (inspections.length) score += 5;
  return Math.min(95, score);
}

const restaurants = mergeRestaurantLayers();
const activeRestaurants = restaurants.filter(isRestaurantActive);
window.__halifaxRestaurantCount = restaurants.length;
window.__halifaxOfficialSignalCount = officialSignals.length;
window.__halifaxStructuredEventCount = structuredEvents.length;
window.__halifaxVerifiedMenuSourceCount = verifiedMenuSources.length;
window.__halifaxVerifiedSpecialSourceCount = verifiedSpecialSources.length;

const cuisines = countValues(activeRestaurants.flatMap((restaurant) => restaurant.cuisines || []));
const neighbourhoods = countValues(activeRestaurants.map((restaurant) => restaurant.neighborhood || "Halifax"));

function countValues(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function categoryKind(restaurant) {
  const amenity = restaurant.osm?.amenity;
  if (["bar", "pub"].includes(amenity)) return "bar";
  if (amenity === "cafe") return "cafe";
  if (["fast_food", "food_court", "ice_cream"].includes(amenity)) return "quick";
  const haystack = `${restaurant.category || ""} ${(restaurant.cuisines || []).join(" ")}`.toLowerCase();
  if (/cafe|coffee|bakery/.test(haystack)) return "cafe";
  if (/bar|pub|brew/.test(haystack)) return "bar";
  if (/fast|quick|food court|ice cream|dessert/.test(haystack)) return "quick";
  return "restaurant";
}

function searchableText(restaurant) {
  return [
    restaurant.name,
    restaurant.neighborhood,
    restaurant.category,
    restaurant.summary,
    restaurant.address,
    ...(restaurant.cuisines || []),
    ...(restaurant.vibe || []),
    ...(restaurant.signal?.keywordHits || []),
    ...(restaurant.menuLinks || []).map((link) => link.label),
    ...(restaurant.specialLinks || []).map((link) => link.label),
    ...(restaurant.structuredEvents || []).map((event) => event.title)
  ].filter(Boolean).join(" ").toLowerCase();
}
function matchesRestaurantSearch(restaurant, query) {
  const rawQuery = String(query ?? "").trim().toLowerCase();
  if (!rawQuery) return true;
  const text = searchableText(restaurant);
  if (text.includes(rawQuery)) return true;
  const compactQuery = normalize(rawQuery);
  return compactQuery ? normalize(text).includes(compactQuery) : false;
}
function filteredRestaurants(options = {}) {
  const query = (options.query ?? state.query).trim().toLowerCase();
  const cuisine = options.cuisine ?? state.cuisine;
  const neighbourhood = options.neighbourhood ?? state.neighbourhood;
  const feature = options.feature ?? state.feature;
  const sort = options.sort ?? state.sort;

  const filtered = activeRestaurants.filter((restaurant) => {
    if (!matchesRestaurantSearch(restaurant, query)) return false;
    if (cuisine !== "all" && !(restaurant.cuisines || []).some((item) => item.toLowerCase() === cuisine.toLowerCase())) return false;
    if (neighbourhood !== "all" && (restaurant.neighborhood || "Halifax").toLowerCase() !== neighbourhood.toLowerCase()) return false;
    if (feature === "menus" && !restaurant.hasMenu) return false;
    if (feature === "specials" && !restaurant.hasSpecial) return false;
    if (feature === "events" && !restaurant.hasEvent) return false;
    if (feature === "patio" && !restaurant.hasPatio) return false;
    if (feature === "opening" && !restaurant.hasOpening) return false;
    if (feature === "social" && !restaurant.hasSocial) return false;
    if (feature === "reservations" && !restaurant.hasReservation) return false;
    if (feature === "ordering" && !restaurant.hasOrdering) return false;
    if (feature === "images" && !restaurantDisplayImageFor(restaurant)) return false;
    if (feature === "saved" && !state.saved.has(restaurant.id)) return false;
    return true;
  });

  return filtered.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "neighbourhood") return (a.neighborhood || "").localeCompare(b.neighborhood || "") || a.name.localeCompare(b.name);
    if (sort === "fresh") return restaurantSourceObservationStamp(b).localeCompare(restaurantSourceObservationStamp(a));
    return (b.score || 0) - (a.score || 0) || a.name.localeCompare(b.name);
  });
}

function route() {
  const raw = location.hash.replace(/^#/, "") || "home";
  const [path, queryString = ""] = raw.split("?");
  const params = new URLSearchParams(queryString);
  const segments = path.split("/").filter(Boolean);
  return { name: segments[0] || "home", id: segments[1] || null, params };
}

function navigate(hash) {
  if (location.hash === hash) renderRoute();
  else location.hash = hash;
}

// The URL is the complete discovery state: missing parameters never inherit old filters.
function discoveryStateFromParams(params) {
  const page = Number(params.get("page"));
  return { query: params.get("q") || "", cuisine: params.get("cuisine") || "all",
    neighbourhood: params.get("neighbourhood") || "all", feature: params.get("feature") || "all",
    sort: ["recommended", "fresh", "name", "neighbourhood"].includes(params.get("sort")) ? params.get("sort") : "recommended",
    page: Number.isSafeInteger(page) && page > 0 ? page : 1 };
}
function discoveryHash(name = "explore", values = state) {
  const params = new URLSearchParams();
  for (const [key, field, fallback] of [["q", "query", ""], ["cuisine", "cuisine", "all"], ["neighbourhood", "neighbourhood", "all"], ["feature", "feature", "all"], ["sort", "sort", "recommended"], ["page", "page", 1]]) {
    if (values[field] != null && values[field] !== fallback && values[field] !== "") params.set(key, values[field]);
  }
  return `#${name}${params.size ? `?${params}` : ""}`;
}
function navigateDiscovery(values = {}, name = "explore", reset = false) {
  navigate(discoveryHash(name, { ...(reset ? discoveryStateFromParams(new URLSearchParams()) : state), ...values }));
}
function renderRoute() {
  if (typeof clearWeatherViewRefresh === "function") clearWeatherViewRefresh();
  destroyMap();
  const current = route();
  updateNav(current.name);
  // News and Weather must not overwrite restaurant discovery state.
  if (!["news", "weather"].includes(current.name)) Object.assign(state, discoveryStateFromParams(current.params));
  globalSearch.value = state.query;
  if (["explore", "map"].includes(current.name)) state.discoveryReturnHash = discoveryHash(current.name);
  const titles = { home: "Local news, events & food", explore: "Restaurants", events: "Events", news: "Local news & notices", weather: "Halifax weather", specials: "Specials", menus: "Menus", map: "Restaurant map", saved: "Saved places" };
  const restaurantTitle = current.name === "restaurant" ? restaurants.find(item => item.id === current.id)?.name : null;
  document.title = `${restaurantTitle || titles[current.name] || "Discover local"} | Halifax Sourced`;

  switch (current.name) {
    case "explore": renderExplore(); break;
    case "events": renderEvents(); break;
    case "news": renderNews(); break;
    case "weather": renderWeather(); break;
    case "specials": renderSpecials(); break;
    case "menus": renderMenus(); break;
    case "map": renderMapPage(); break;
    case "restaurant": renderRestaurantDetail(current.id); break;
    case "saved": renderSaved(); break;
    case "home":
    default: renderHome(); break;
  }
  document.querySelector("#mainContent")?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "instant" });
}

function updateNav(active) {
  for (const link of routeLinks) link.classList.toggle("is-active", link.dataset.routeLink === active || (active === "restaurant" && link.dataset.routeLink === "explore"));
}
