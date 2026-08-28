"use strict";

const curatedRestaurants = Array.isArray(window.HALIFAX_RESTAURANTS) ? window.HALIFAX_RESTAURANTS : [];
const osmRestaurants = Array.isArray(window.HALIFAX_OSM_RESTAURANTS) ? window.HALIFAX_OSM_RESTAURANTS : [];
const osmMeta = window.HALIFAX_OSM_META ?? null;
const officialPayload = window.HALIFAX_OFFICIAL_SITE_SIGNALS ?? null;
const officialSignals = Array.isArray(officialPayload?.results) ? officialPayload.results : [];
const inspectionPayload = window.HALIFAX_NS_FOOD_INSPECTIONS ?? null;
const inspectionRecords = Array.isArray(inspectionPayload?.records) ? inspectionPayload.records : [];

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
    const url = new URL(String(value).replaceAll("&amp;", "&"));
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
  return merged.map(enrichRestaurant);
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

function cleanLinkLabel(value, fallback) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  return text.length > 100 ? `${text.slice(0, 97).trim()}…` : text;
}

function credibleEventCandidate(link) {
  const href = safeUrl(link?.href);
  if (!href) return false;
  const rawText = String(link?.text ?? "").replace(/\s+/g, " ").trim();
  const text = rawText.toLowerCase();
  let url;
  try { url = new URL(href); } catch { return false; }
  const path = `${url.pathname} ${url.search}`.toLowerCase();
  const eventTerms = /\b(event|events|calendar|live music|music|trivia|karaoke|ticket|tickets|show|shows|concert|festival|market|workshop)\b/;
  const pathLooksEventSpecific = eventTerms.test(path.replace(/[\/_-]+/g, " "));
  const shortEventLabel = rawText.length > 0 && rawText.length <= 80 && eventTerms.test(text);
  return pathLooksEventSpecific || shortEventLabel;
}

function signalLinks(signal, kind) {
  if (!signal) return [];
  const links = (signal.candidateLinks || [])
    .filter((link) => !kind || (link.signalMatches?.[kind]?.length || 0) > 0)
    .filter((link) => kind !== "events" || credibleEventCandidate(link))
    .map((link) => ({ label: cleanLinkLabel(link.text, kind || "Official link"), url: safeUrl(link.href) }))
    .filter((link) => link.url);
  return links.filter((link, index, all) => all.findIndex((item) => item.url === link.url) === index);
}

function rawTags(restaurant) {
  return restaurant.osm?.rawTags || {};
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
  const menuLinks = signalLinks(signal, "menu");
  const specialLinks = signalLinks(signal, "specials");
  const eventLinks = signalLinks(signal, "events");
  const reservationLinks = signalLinks(signal, "reservations");
  const website = safeUrl(restaurant.website) || safeUrl(signal?.website) || (restaurant.sources || []).map((s) => safeUrl(s.url)).find(Boolean) || null;
  const score = Number.isFinite(restaurant.qualityScore) ? restaurant.qualityScore : sourceCoverageScore(restaurant, signal, inspections);
  return {
    ...restaurant,
    cuisines: unique(restaurant.cuisines || [restaurant.category]),
    vibe: unique(restaurant.vibe || []),
    specials: Array.isArray(restaurant.specials) ? restaurant.specials : [],
    events: Array.isArray(restaurant.events) ? restaurant.events : [],
    sources: Array.isArray(restaurant.sources) ? restaurant.sources : [],
    signal,
    inspections,
    menuLinks,
    specialLinks,
    eventLinks,
    reservationLinks,
    website,
    hasMenu: menuLinks.length > 0 || Boolean(website),
    hasSpecial: specialLinks.length > 0 || (restaurant.specials || []).length > 0 || signalHas(signal, "specials"),
    hasEvent: eventLinks.length > 0 || (restaurant.events || []).length > 0,
    hasPatio: hasPatio(restaurant, signal),
    hasOpening: hasOpening(restaurant, signal),
    hasReservation: reservationLinks.length > 0 || signalHas(signal, "reservations"),
    score
  };
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
window.__halifaxRestaurantCount = restaurants.length;
window.__halifaxOfficialSignalCount = officialSignals.length;

const cuisines = countValues(restaurants.flatMap((restaurant) => restaurant.cuisines || []));
const neighbourhoods = countValues(restaurants.map((restaurant) => restaurant.neighborhood || "Halifax"));

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
    ...(restaurant.signal?.keywordHits || [])
  ].filter(Boolean).join(" ").toLowerCase();
}

function filteredRestaurants(options = {}) {
  const query = (options.query ?? state.query).trim().toLowerCase();
  const cuisine = options.cuisine ?? state.cuisine;
  const neighbourhood = options.neighbourhood ?? state.neighbourhood;
  const feature = options.feature ?? state.feature;
  const sort = options.sort ?? state.sort;
  return restaurants
    .filter((restaurant) => !query || searchableText(restaurant).includes(query))
    .filter((restaurant) => cuisine === "all" || (restaurant.cuisines || []).some((item) => item.toLowerCase() === cuisine.toLowerCase()))
    .filter((restaurant) => neighbourhood === "all" || (restaurant.neighborhood || "").toLowerCase() === neighbourhood.toLowerCase())
    .filter((restaurant) => {
      if (feature === "all") return true;
      if (feature === "menus") return restaurant.hasMenu;
      if (feature === "specials") return restaurant.hasSpecial;
      if (feature === "events") return restaurant.hasEvent;
      if (feature === "patio") return restaurant.hasPatio;
      if (feature === "opening") return restaurant.hasOpening;
      return true;
    })
    .sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "neighbourhood") return (a.neighborhood || "").localeCompare(b.neighborhood || "") || a.name.localeCompare(b.name);
      if (sort === "fresh") return String(b.signal?.observedAt || b.freshnessDate || "").localeCompare(String(a.signal?.observedAt || a.freshnessDate || ""));
      return (b.score || 0) - (a.score || 0) || a.name.localeCompare(b.name);
    });
}
