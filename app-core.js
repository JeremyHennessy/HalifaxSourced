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
  if (!value) return null;
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

function addressKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(street|st|avenue|ave|road|rd|drive|dr|boulevard|blvd|lane|ln|nova scotia|halifax|dartmouth|bedford)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

const officialById = new Map(officialSignals.map((signal) => [signal.restaurantId, signal]));
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
    if (!url) continue;
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
  const byName = new Map(merged.map((restaurant) => [normalize(restaurant.name), restaurant]));

  for (const osm of osmRestaurants) {
    const key = normalize(osm.name);
    const existing = byName.get(key);
    if (!existing) {
      merged.push({ ...osm, sourceLayer: "openstreetmap" });
      continue;
    }
    existing.category ||= osm.category;
    existing.cuisines = unique([...(existing.cuisines || []), ...(osm.cuisines || [])]);
    existing.vibe = unique([...(existing.vibe || []), ...(osm.vibe || [])]);
    existing.address ||= osm.address;
    existing.phone ||= osm.phone;
    existing.website ||= osm.website;
    existing.openingHours ||= osm.openingHours;
    existing.coordinates ||= osm.coordinates;
    existing.osm ||= osm.osm;
    existing.sources = mergeSources(existing.sources, osm.sources);
  }
  return merged.map((restaurant) => enrichRestaurant(applyReviewedPlaceResolution(restaurant)));
}

function applyReviewedPlaceResolution(restaurant) {
  const resolution = reviewedPlaceResolutionById.get(restaurant?.id);
  if (!resolution) return restaurant;
  const source = {
    label: "Reviewed neighbourhood resolution",
    type: "business_district_directory",
    url: resolution.sourceUrl,
    status: resolution.reviewState,
    observedAt: resolution.observedAt
  };
  restaurant.neighborhood = resolution.neighborhood || restaurant.neighborhood;
  restaurant.address ||= resolution.address;
  restaurant.coordinates ||= resolution.coordinates;
  restaurant.phone ||= resolution.phone;
  restaurant.openingHours ||= resolution.openingHours;
  restaurant.website ||= resolution.website;
  restaurant.socialProfiles = [...(restaurant.socialProfiles || []), ...(resolution.socialProfiles || [])];
  restaurant.operatingStatus = resolution.operatingStatus || restaurant.operatingStatus;
  restaurant.reviewedPlaceResolution = resolution;
  restaurant.sources = mergeSources(restaurant.sources, [
    source,
    ...(resolution.menuUrl ? [{ label: "Official menu", type: "menu", url: resolution.menuUrl, status: "verified", observedAt: resolution.observedAt }] : [])
  ]);
  return restaurant;
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
  if (!restaurant.name) return [];
  const name = normalize(restaurant.name);
  const address = addressKey(restaurant.address);
  const matches = [];
  for (const record of inspectionRecords) {
    const recordName = normalize(record.name);
    const recordAddress = addressKey(record.address);
    const nameMatch = recordName === name || (name.length > 8 && recordName.includes(name)) || (recordName.length > 8 && name.includes(recordName));
    const addressMatch = address && recordAddress && (recordAddress.includes(address.slice(0, 10)) || address.includes(recordAddress.slice(0, 10)));
    if (nameMatch || (addressMatch && recordName.slice(0, 6) === name.slice(0, 6))) matches.push(record);
    if (matches.length >= 3) break;
  }
  return matches;
}

function signalHas(signal, kind) {
  if (!signal) return false;
  if ((signal.signalMatches?.[kind]?.length || 0) > 0) return true;
  return (signal.candidateLinks || []).some((link) => (link.signalMatches?.[kind]?.length || 0) > 0);
}

function signalLinks(signal, kind) {
  if (!signal) return [];
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
  const website = safeUrl(restaurant.website) || safeUrl(signal?.website) || (restaurant.sources || []).map((s) => safeUrl(s.url)).find(Boolean) || null;
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
  return !["permanently_closed", "temporarily_closed", "moved"].includes(restaurant?.operatingStatus);
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

function filteredRestaurants(options = {}) {
  const query = (options.query ?? state.query).trim().toLowerCase();
  const cuisine = options.cuisine ?? state.cuisine;
  const neighbourhood = options.neighbourhood ?? state.neighbourhood;
  const feature = options.feature ?? state.feature;
  const sort = options.sort ?? state.sort;

  const filtered = activeRestaurants.filter((restaurant) => {
    if (query && !searchableText(restaurant).includes(query)) return false;
    if (cuisine !== "all" && !(restaurant.cuisines || []).some((item) => item.toLowerCase() === cuisine.toLowerCase())) return false;
    if (neighbourhood !== "all" && (restaurant.neighborhood || "Halifax").toLowerCase() !== neighbourhood.toLowerCase()) return false;
    if (feature === "menus" && !restaurant.hasMenu) return false;
    if (feature === "specials" && !restaurant.hasSpecial) return false;
    if (feature === "events" && !restaurant.hasEvent) return false;
    if (feature === "patio" && !restaurant.hasPatio) return false;
    if (feature === "opening" && !restaurant.hasOpening) return false;
    if (feature === "saved" && !state.saved.has(restaurant.id)) return false;
    return true;
  });

  return filtered.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "neighbourhood") return (a.neighborhood || "").localeCompare(b.neighborhood || "") || a.name.localeCompare(b.name);
    if (sort === "fresh") return String(b.signal?.observedAt || b.freshnessDate || "").localeCompare(String(a.signal?.observedAt || a.freshnessDate || ""));
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

function renderRoute() {
  destroyMap();
  const current = route();
  updateNav(current.name);
  if (current.params.has("q")) state.query = current.params.get("q") || "";
  globalSearch.value = state.query;

  switch (current.name) {
    case "explore": renderExplore(); break;
    case "events": renderEvents(); break;
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
