import { mkdir, readFile, writeFile } from "node:fs/promises";
import vm from "node:vm";

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.now();
const SOCIAL_PLATFORMS = new Set(["instagram", "facebook", "tiktok", "threads", "x", "youtube", "linkedin", "bluesky", "pinterest", "snapchat"]);
const LINK_HUB_PLATFORMS = new Set(["linktree", "beacons", "linkinbio", "campsite", "bento"]);

async function loadJson(path, fallback = null) {
  try { return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8")); }
  catch { return fallback; }
}

async function loadWindow(path, fallback = {}) {
  try {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    const context = { window: {} };
    vm.createContext(context);
    vm.runInContext(source, context, { filename: path, timeout: 20_000 });
    return context.window;
  } catch { return fallback; }
}

function normalize(value) {
  return String(value ?? "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(the|restaurant|bar|cafe|café|pub)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function validUrl(value) {
  try { return ["http:", "https:"].includes(new URL(String(value ?? "")).protocol); }
  catch { return false; }
}

function validCoordinates(value) {
  const lat = Number(value?.lat ?? value?.latitude);
  const lon = Number(value?.lon ?? value?.lng ?? value?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

function dateStamp(value) {
  const stamp = Date.parse(String(value ?? ""));
  return Number.isFinite(stamp) ? stamp : null;
}

function isUpcoming(startAt, endAt = startAt) {
  const end = dateStamp(endAt);
  return end !== null && end >= now - 30 * 60 * 1000;
}

function isFresh(value, days) {
  const stamp = dateStamp(value);
  return stamp !== null && stamp <= now + DAY_MS && now - stamp <= days * DAY_MS;
}

function freshnessBucket(value) {
  const stamp = dateStamp(value);
  if (stamp === null || stamp > now + DAY_MS) return "unknown";
  const ageDays = (now - stamp) / DAY_MS;
  if (ageDays < 7) return "lt7Days";
  if (ageDays < 30) return "days7To30";
  if (ageDays < 90) return "days30To90";
  return "gt90Days";
}

function increment(target, key, amount = 1) {
  if (!key) return;
  target[key] = (target[key] || 0) + amount;
}

function uniqueIds(items) { return new Set(items.filter(Boolean)); }
function pct(count, total) { return total ? Number(((count / total) * 100).toFixed(1)) : 0; }
function hasHits(value, kind) { return Array.isArray(value?.signalMatches?.[kind]) && value.signalMatches[kind].length > 0; }

const curatedWindow = await loadWindow("data/restaurants.js");
const osmWindow = await loadWindow("data/osm-restaurants.js");
const discoveredWindow = await loadWindow("data/discovered-restaurants.js");
const mediaWindow = await loadWindow("data/restaurant-media.js");
const openingWindow = await loadWindow("data/opening-watch-leads.js");
const directoryWindow = await loadWindow("data/directory-restaurant-leads.js");
const cityWindow = await loadWindow("data/city-events.js");

const catalog = await loadJson("data/build/catalog.json", { restaurants: [], counts: {} });
const official = await loadJson("data/build/official-site-signals.json", { results: [] });
const verifiedPages = await loadJson("data/build/verified-source-pages.json", { menuSources: [], specialSources: [], failures: [] });
const structured = await loadJson("data/build/structured-events.json", { events: [], failures: [] });
const firstParty = await loadJson("data/build/first-party-sources.json", { records: [], failures: [] });
const websiteFeeds = await loadJson("data/build/website-feed-signals.json", { signals: [], failures: [] });
const socialSignals = await loadJson("data/build/social-signals.json", { signals: [], failures: [] });

const curated = Array.isArray(curatedWindow.HALIFAX_RESTAURANTS) ? curatedWindow.HALIFAX_RESTAURANTS : [];
const osm = Array.isArray(osmWindow.HALIFAX_OSM_RESTAURANTS) ? osmWindow.HALIFAX_OSM_RESTAURANTS : [];
const discovered = Array.isArray(discoveredWindow.HALIFAX_DISCOVERED_RESTAURANTS) ? discoveredWindow.HALIFAX_DISCOVERED_RESTAURANTS : [];
const media = Array.isArray(mediaWindow.HALIFAX_RESTAURANT_MEDIA?.records) ? mediaWindow.HALIFAX_RESTAURANT_MEDIA.records : [];
const cityPayload = cityWindow.HALIFAX_CITY_EVENTS || { events: [] };
const cityEvents = Array.isArray(cityPayload.events) ? cityPayload.events : [];
const openingPayload = openingWindow.HALIFAX_OPENING_WATCH_LEADS || { leads: [], failures: [] };
const directoryPayload = directoryWindow.HALIFAX_DIRECTORY_RESTAURANT_LEADS || { records: [], failures: [] };

const canonical = (catalog.restaurants || []).map((restaurant) => ({ ...restaurant }));
const curatedLifecycleById = new Map(curated.map((restaurant) => [restaurant.id, restaurant.operatingStatus || "unknown"]));
const curatedLifecycleByName = new Map(curated.map((restaurant) => [normalize(restaurant.name), restaurant.operatingStatus || "unknown"]));
for (const restaurant of canonical) restaurant.operatingStatus = curatedLifecycleById.get(restaurant.id) || curatedLifecycleByName.get(normalize(restaurant.name)) || restaurant.operatingStatus || "unknown";
const canonicalById = new Map(canonical.map((restaurant) => [restaurant.id, restaurant]));
const canonicalByName = new Map(canonical.map((restaurant) => [normalize(restaurant.name), restaurant]));
let discoveryNameOnlyMerges = 0;
for (const item of discovered) {
  const byId = canonicalById.get(item.id);
  const byName = canonicalByName.get(normalize(item.name));
  const existing = byId || byName;
  if (existing) {
    if (!byId && byName) discoveryNameOnlyMerges += 1;
    for (const field of ["address", "phone", "website", "openingHours", "coordinates", "neighborhood", "category", "freshnessDate", "evidenceStatus", "openingStatus"]) existing[field] ||= item[field];
    existing.cuisines = [...new Set([...(existing.cuisines || []), ...(item.cuisines || [])])];
    existing.vibe = [...new Set([...(existing.vibe || []), ...(item.vibe || [])])];
    existing.specials = [...(existing.specials || []), ...(item.specials || [])];
    existing.sources = [...(existing.sources || []), ...(item.sources || [])];
    existing.discoveryRecord = item;
    continue;
  }
  const added = { ...item, sourceLayer: item.sourceLayer || "local_discovery", discoveryRecord: item };
  canonical.push(added);
  canonicalById.set(added.id, added);
  canonicalByName.set(normalize(added.name), added);
}

const canonicalIds = new Set(canonical.map((restaurant) => restaurant.id));
const officialResults = Array.isArray(official.results) ? official.results : [];
const officialById = new Map(officialResults.map((result) => [result.restaurantId, result]));
const firstPartyRecords = Array.isArray(firstParty.records) ? firstParty.records : [];
const firstPartyById = new Map(firstPartyRecords.map((record) => [record.restaurantId, record]));
const feedSignals = Array.isArray(websiteFeeds.signals) ? websiteFeeds.signals : [];
const apiSignals = Array.isArray(socialSignals.signals) ? socialSignals.signals : [];

const verifiedWebsiteIds = uniqueIds([
  ...officialResults.filter((result) => Number(result.status) >= 200 && Number(result.status) < 400 && !result.error).map((result) => result.restaurantId),
  ...firstPartyRecords.filter((record) => record.reviewState === "verified" && validUrl(record.resolvedUrl || record.website)).map((record) => record.restaurantId)
]);
const websiteIds = uniqueIds(canonical.filter((restaurant) => validUrl(restaurant.website)).map((restaurant) => restaurant.id));
const inspectionIds = uniqueIds(canonical.filter((restaurant) => (restaurant.inspectionRecords || []).length > 0).map((restaurant) => restaurant.id));

const verifiedMenuIds = uniqueIds((verifiedPages.menuSources || []).map((source) => source.restaurantId));
const verifiedSpecialIds = uniqueIds((verifiedPages.specialSources || []).map((source) => source.restaurantId));
const menuIds = new Set(verifiedMenuIds);
const specialIds = new Set(verifiedSpecialIds);
const reservationIds = new Set();
const orderingIds = new Set();
const directEventIds = new Set();
const socialPlaceIds = new Set();
const socialOrHubPlaceIds = new Set();
const linkHubIds = new Set();
const socialPlatformPlaceIds = Object.fromEntries([...SOCIAL_PLATFORMS, ...LINK_HUB_PLATFORMS].map((platform) => [platform, new Set()]));
const profileAssociationCounts = new Map();
const profileAssociations = [];

for (const record of firstPartyRecords) {
  for (const link of record.relatedLinks || []) {
    if (link.kind === "menu") menuIds.add(record.restaurantId);
    if (link.kind === "reservations") reservationIds.add(record.restaurantId);
    if (link.kind === "ordering") orderingIds.add(record.restaurantId);
    if (["events", "tickets"].includes(link.kind)) directEventIds.add(record.restaurantId);
    if (/special|happy hour|feature|deal|promo/i.test(`${link.label || ""} ${link.url || ""}`)) specialIds.add(record.restaurantId);
  }
  for (const profile of record.socialProfiles || []) {
    const platform = String(profile.platform || "").toLowerCase();
    const handle = String(profile.handle || "").toLowerCase().replace(/^@/, "");
    if (!platform || !handle) continue;
    const key = `${platform}|${handle}`;
    profileAssociationCounts.set(key, (profileAssociationCounts.get(key) || 0) + 1);
    profileAssociations.push({ restaurantId: record.restaurantId, platform, handle, key, profile, observedAt: record.observedAt });
    socialOrHubPlaceIds.add(record.restaurantId);
    socialPlatformPlaceIds[platform] ||= new Set();
    socialPlatformPlaceIds[platform].add(record.restaurantId);
    if (SOCIAL_PLATFORMS.has(platform)) socialPlaceIds.add(record.restaurantId);
    if (LINK_HUB_PLATFORMS.has(platform)) linkHubIds.add(record.restaurantId);
  }
}

for (const result of officialResults) {
  for (const link of result.candidateLinks || []) {
    if (hasHits(link, "menu")) menuIds.add(result.restaurantId);
    if (hasHits(link, "specials")) specialIds.add(result.restaurantId);
    if (hasHits(link, "events")) directEventIds.add(result.restaurantId);
    if (hasHits(link, "reservations")) reservationIds.add(result.restaurantId);
    if (hasHits(link, "takeout")) orderingIds.add(result.restaurantId);
  }
}

for (const restaurant of canonical) if ((restaurant.specials || []).length) specialIds.add(restaurant.id);

const structuredEvents = Array.isArray(structured.events) ? structured.events : [];
const structuredUpcoming = structuredEvents.filter((event) => isUpcoming(event.startAt, event.endAt));
const structuredEventRestaurantIds = uniqueIds(structuredEvents.map((event) => event.restaurantId));
const structuredUpcomingRestaurantIds = uniqueIds(structuredUpcoming.map((event) => event.restaurantId));
for (const id of structuredEventRestaurantIds) directEventIds.add(id);

const currentSignalIds = new Set();
for (const signal of [...feedSignals, ...apiSignals]) {
  if (!isFresh(signal.publishedAt, 60)) continue;
  if (hasHits(signal, "events")) { directEventIds.add(signal.restaurantId); currentSignalIds.add(signal.restaurantId); }
  if (hasHits(signal, "specials")) specialIds.add(signal.restaurantId);
}

const phoneIds = uniqueIds(canonical.filter((restaurant) => String(restaurant.phone || "").trim()).map((restaurant) => restaurant.id));
const hoursIds = uniqueIds(canonical.filter((restaurant) => String(restaurant.openingHours || "").trim()).map((restaurant) => restaurant.id));
const coordinateIds = uniqueIds(canonical.filter((restaurant) => validCoordinates(restaurant.coordinates)).map((restaurant) => restaurant.id));
const neighbourhoodIds = uniqueIds(canonical.filter((restaurant) => String(restaurant.neighborhood || "").trim()).map((restaurant) => restaurant.id));
const cuisineIds = uniqueIds(canonical.filter((restaurant) => Array.isArray(restaurant.cuisines) && restaurant.cuisines.some(Boolean)).map((restaurant) => restaurant.id));
const mediaIds = uniqueIds(media.filter((record) => record.reviewState === "approved" && (validUrl(record.url) || /^\.?\/?assets\//.test(String(record.url || "")))).map((record) => record.restaurantId));

const patioIds = new Set();
const accessibilityIds = new Set();
for (const restaurant of canonical) {
  const tags = restaurant.osm?.rawTags || {};
  const tagText = JSON.stringify(tags).toLowerCase();
  if (tags.outdoor_seating === "yes" || /patio|terrace|rooftop|beer garden|outdoor seating/.test(tagText)) patioIds.add(restaurant.id);
  if (restaurant.accessibility || Object.keys(tags).some((key) => /wheelchair|accessible|step_free|toilets:wheelchair/.test(key)) || /wheelchair|accessible/.test(tagText)) accessibilityIds.add(restaurant.id);
  const signal = officialById.get(restaurant.id);
  if (hasHits(signal, "patio") || (signal?.candidateLinks || []).some((link) => hasHits(link, "patio"))) patioIds.add(restaurant.id);
}

const sharedProfileKeys = new Set([...profileAssociationCounts].filter(([, count]) => count > 1).map(([key]) => key));
const sharedOnlyIds = new Set();
for (const restaurantId of socialOrHubPlaceIds) {
  const associations = profileAssociations.filter((item) => item.restaurantId === restaurantId);
  if (associations.length && associations.every((item) => sharedProfileKeys.has(item.key))) sharedOnlyIds.add(restaurantId);
}
const socialCandidateIds = uniqueIds(profileAssociations.filter((item) => !["verified_link", "verified"].includes(item.profile.reviewState)).map((item) => item.restaurantId));
const staleSocialIds = uniqueIds(firstPartyRecords.filter((record) => !isFresh(record.observedAt, 90) && dateStamp(record.observedAt) !== null).map((record) => record.restaurantId));

const currentCityEvents = cityEvents.filter((event) => isUpcoming(event.startAt, event.endAt));
const cityBySource = {};
const cityByCategory = {};
const cityByMunicipality = {};
let eventsWithCoordinates = 0;
let eventsWithTicketLinks = 0;
let eventsWithPrices = 0;
let freeEvents = 0;
let venueRestaurantMatches = 0;
const duplicateEventKeys = new Map();
const canonicalNames = new Set(canonical.map((restaurant) => normalize(restaurant.name)).filter(Boolean));
for (const event of currentCityEvents) {
  increment(cityBySource, event.sourceName || event.sourceId || "Unknown source");
  for (const category of event.categories || ["Other"]) increment(cityByCategory, category);
  increment(cityByMunicipality, event.city || "Unknown");
  if (validCoordinates(event.coordinates) || (Number.isFinite(Number(event.lat)) && Number.isFinite(Number(event.lon)))) eventsWithCoordinates += 1;
  if (validUrl(event.ticketUrl)) eventsWithTicketLinks += 1;
  if (String(event.price || "").trim() || Number.isFinite(Number(event.priceMin)) || Number.isFinite(Number(event.priceMax))) eventsWithPrices += 1;
  if (event.free === true || /^\s*free\b/i.test(String(event.price || ""))) freeEvents += 1;
  if (canonicalNames.has(normalize(event.venueName))) venueRestaurantMatches += 1;
  const key = `${normalize(event.title)}|${String(event.startAt).slice(0, 10)}|${normalize(event.venueName || event.address || event.city)}`;
  duplicateEventKeys.set(key, (duplicateEventKeys.get(key) || 0) + 1);
}
const duplicateEventCount = [...duplicateEventKeys.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);

const freshness = { lt7Days: 0, days7To30: 0, days30To90: 0, gt90Days: 0, unknown: 0 };
const staleRestaurantIds = new Set();
for (const restaurant of canonical) {
  const observed = [
    restaurant.freshnessDate,
    firstPartyById.get(restaurant.id)?.observedAt,
    officialById.get(restaurant.id)?.observedAt
  ].map(dateStamp).filter((stamp) => stamp !== null).sort((a, b) => b - a)[0];
  const bucket = freshnessBucket(observed === undefined ? null : new Date(observed).toISOString());
  freshness[bucket] += 1;
  if (bucket === "gt90Days") staleRestaurantIds.add(restaurant.id);
}

const officialFailures = officialResults.filter((result) => result.error || (Number(result.status) && Number(result.status) >= 400)).length;
const sourceFailures = {
  officialWebsiteChecks: officialFailures,
  firstPartyWebsiteDiscovery: Array.isArray(firstParty.failures) ? firstParty.failures.length : 0,
  verifiedSourcePages: Array.isArray(verifiedPages.failures) ? verifiedPages.failures.length : 0,
  structuredRestaurantEvents: Array.isArray(structured.failures) ? structured.failures.length : 0,
  websiteFeeds: Array.isArray(websiteFeeds.failures) ? websiteFeeds.failures.length : 0,
  socialApis: Array.isArray(socialSignals.failures) ? socialSignals.failures.length : 0,
  cityEventSources: Array.isArray(cityPayload.failures) ? cityPayload.failures.length : 0,
  openingWatchSources: Array.isArray(openingPayload.failures) ? openingPayload.failures.length : 0,
  restaurantDirectorySources: Array.isArray(directoryPayload.failures) ? directoryPayload.failures.length : 0
};

const socialCoverage = {};
for (const platform of [...SOCIAL_PLATFORMS, ...LINK_HUB_PLATFORMS]) socialCoverage[platform] = socialPlatformPlaceIds[platform]?.size || 0;

const total = canonical.length;
const lifecycle = { active: 0, temporarily_closed: 0, permanently_closed: 0, moved: 0, coming_soon: 0, unknown: 0 };
for (const restaurant of canonical) increment(lifecycle, restaurant.operatingStatus || "unknown");
const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  baselineCommitHint: process.env.GITHUB_SHA || null,
  definitions: {
    canonicalPlaces: "Current user-facing merge of catalog restaurants plus reviewed discovery records, matching the app's existing name-based discovery merge behavior.",
    verifiedOfficialWebsite: "Official-site fetch returned a successful HTTP status or the first-party discovery layer successfully fetched the restaurant-owned site.",
    menuLink: "Verified menu source, first-party menu action, or official-site menu candidate link. Verified menu is reported separately.",
    specials: "Curated special, verified specials page, first-party specials-related action, or official-site specials signal. Exact terms are not assumed current unless separately structured.",
    socialCoverage: "Count of canonical places associated with at least one supported profile; link hubs are reported separately from social networks.",
    staleRestaurant: "Latest available restaurant freshness/official-site/first-party observation is more than 90 days old. Unknown dates are reported separately.",
    eventVenueMatch: "Conservative exact normalized venue-name match to a canonical place; no canonical venue entity exists yet.",
    duplicateEventCount: "Additional current event records sharing normalized title, local date, and normalized venue/address key."
  },
  restaurantCoverage: {
    totalCanonicalPlaces: total,
    curatedRestaurants: curated.length,
    osmRestaurants: osm.length,
    locallyDiscoveredRestaurants: discovered.length,
    catalogMergedRestaurants: (catalog.restaurants || []).length,
    withOfficialWebsite: websiteIds.size,
    withVerifiedOfficialWebsite: verifiedWebsiteIds.size,
    withInspectionMatch: inspectionIds.size,
    withMenuLink: menuIds.size,
    withVerifiedMenuLink: verifiedMenuIds.size,
    withSpecials: specialIds.size,
    withVerifiedSpecials: verifiedSpecialIds.size,
    withReservationLink: reservationIds.size,
    withOnlineOrderingLink: orderingIds.size,
    withEventEvidence: directEventIds.size,
    withStructuredUpcomingEvents: structuredUpcomingRestaurantIds.size,
    withAtLeastOneSocialProfile: socialPlaceIds.size,
    withAnySocialOrLinkHub: socialOrHubPlaceIds.size,
    socialByPlatform: socialCoverage,
    withLinkHub: linkHubIds.size,
    withPhone: phoneIds.size,
    withStructuredOrSourceHours: hoursIds.size,
    withCoordinates: coordinateIds.size,
    withNeighbourhood: neighbourhoodIds.size,
    withCuisineClassification: cuisineIds.size,
    withAccessibilityInformation: accessibilityIds.size,
    withPatioInformation: patioIds.size,
    withUsableMedia: mediaIds.size,
    lifecycle,
    activeCanonicalPlaces: total - lifecycle.temporarily_closed - lifecycle.permanently_closed - lifecycle.moved,
    freshness,
    staleRestaurantRecords: staleRestaurantIds.size,
    currentResolutionRisks: { discoveryNameOnlyMerges }
  },
  restaurantCoveragePercent: Object.fromEntries(Object.entries({
    officialWebsite: websiteIds.size,
    verifiedOfficialWebsite: verifiedWebsiteIds.size,
    inspection: inspectionIds.size,
    menu: menuIds.size,
    verifiedMenu: verifiedMenuIds.size,
    specials: specialIds.size,
    verifiedSpecials: verifiedSpecialIds.size,
    reservations: reservationIds.size,
    ordering: orderingIds.size,
    events: directEventIds.size,
    structuredUpcomingEvents: structuredUpcomingRestaurantIds.size,
    social: socialPlaceIds.size,
    phone: phoneIds.size,
    hours: hoursIds.size,
    coordinates: coordinateIds.size,
    neighbourhood: neighbourhoodIds.size,
    cuisine: cuisineIds.size,
    accessibility: accessibilityIds.size,
    patio: patioIds.size,
    media: mediaIds.size
  }).map(([key, count]) => [key, pct(count, total)])),
  socialAudit: {
    placesWithSocial: socialPlaceIds.size,
    placesWithLinkHub: linkHubIds.size,
    platformPlaceCounts: socialCoverage,
    profileAssociations: profileAssociations.length,
    sharedProfileKeys: sharedProfileKeys.size,
    sharedBrandOnlyPlaces: sharedOnlyIds.size,
    candidatePlacesAwaitingVerification: socialCandidateIds.size,
    staleSocialVerificationPlaces: staleSocialIds.size,
    noWebsitePlaces: total - websiteIds.size,
    websiteButNoSocialPlaces: [...websiteIds].filter((id) => !socialPlaceIds.has(id)).length,
    priorityGapQueue: {
      websiteButNoSocial: canonical.filter((restaurant) => websiteIds.has(restaurant.id) && !socialPlaceIds.has(restaurant.id)).slice(0, 100).map((restaurant) => ({ id: restaurant.id, name: restaurant.name, website: restaurant.website })),
      noWebsite: canonical.filter((restaurant) => !websiteIds.has(restaurant.id)).slice(0, 100).map((restaurant) => ({ id: restaurant.id, name: restaurant.name, neighborhood: restaurant.neighborhood || null }))
    }
  },
  eventCoverage: {
    currentCityEvents: currentCityEvents.length,
    allStoredCityEvents: cityEvents.length,
    cityEventSources: Object.keys(cityBySource).length,
    bySource: cityBySource,
    byCategory: cityByCategory,
    byMunicipality: cityByMunicipality,
    withVenueRestaurantNameMatch: venueRestaurantMatches,
    withCoordinates: eventsWithCoordinates,
    withTicketLink: eventsWithTicketLinks,
    withPrice: eventsWithPrices,
    freeEvents,
    duplicateEventCount,
    structuredRestaurantEvents: structuredEvents.length,
    structuredUpcomingRestaurantEvents: structuredUpcoming.length,
    expiredStructuredRestaurantEvents: structuredEvents.length - structuredUpcoming.length,
    next7Days: currentCityEvents.filter((event) => { const start = dateStamp(event.startAt); return start !== null && start >= now && start <= now + 7 * DAY_MS; }).length,
    next30Days: currentCityEvents.filter((event) => { const start = dateStamp(event.startAt); return start !== null && start >= now && start <= now + 30 * DAY_MS; }).length
  },
  discoveryCoverage: {
    directoryRecords: directoryPayload.count ?? directoryPayload.records?.length ?? 0,
    directoryNewToCatalog: directoryPayload.newToCatalogCount ?? directoryPayload.newToCatalog?.length ?? 0,
    openingWatchLeads: openingPayload.count ?? openingPayload.leads?.length ?? 0,
    reviewedDiscoveredRestaurants: discovered.length
  },
  sourceFailures,
  credentials: socialSignals.credentialState || null,
  unresolved: {
    sharedSocialAssociations: sharedProfileKeys.size,
    possibleDuplicateCurrentEvents: duplicateEventCount,
    staleRestaurantRecords: staleRestaurantIds.size,
    unknownFreshnessRestaurantRecords: freshness.unknown
  }
};

function metricRow(label, count, base = total) {
  return `| ${label} | ${count.toLocaleString()} | ${base ? `${pct(count, base)}%` : "—"} |`;
}

const rc = report.restaurantCoverage;
const ea = report.eventCoverage;
const sa = report.socialAudit;
const markdown = `# Halifax Sourced content coverage baseline\n\nGenerated: ${report.generatedAt}\n\nThis report measures the currently committed production data layers. It is a content-completeness baseline, **not a restaurant quality or popularity rating**. Unknown data remains unknown; source leads are not converted into fabricated facts.\n\n## Restaurant coverage\n\n| Metric | Places | Coverage |\n| --- | ---: | ---: |\n${metricRow("Canonical places", total, total)}\n${metricRow("Official website", rc.withOfficialWebsite)}\n${metricRow("Verified/reachable official website", rc.withVerifiedOfficialWebsite)}\n${metricRow("Public inspection match", rc.withInspectionMatch)}\n${metricRow("Menu link", rc.withMenuLink)}\n${metricRow("Verified menu link", rc.withVerifiedMenuLink)}\n${metricRow("Special evidence", rc.withSpecials)}\n${metricRow("Verified specials source", rc.withVerifiedSpecials)}\n${metricRow("Reservation link", rc.withReservationLink)}\n${metricRow("Online ordering link", rc.withOnlineOrderingLink)}\n${metricRow("Event evidence", rc.withEventEvidence)}\n${metricRow("Structured upcoming restaurant events", rc.withStructuredUpcomingEvents)}\n${metricRow("At least one social network profile", rc.withAtLeastOneSocialProfile)}\n${metricRow("Phone", rc.withPhone)}\n${metricRow("Hours", rc.withStructuredOrSourceHours)}\n${metricRow("Coordinates", rc.withCoordinates)}\n${metricRow("Neighbourhood", rc.withNeighbourhood)}\n${metricRow("Cuisine classification", rc.withCuisineClassification)}\n${metricRow("Accessibility information", rc.withAccessibilityInformation)}\n${metricRow("Patio information", rc.withPatioInformation)}\n${metricRow("Usable rights-approved media", rc.withUsableMedia)}\n\nRaw layers: ${rc.curatedRestaurants} curated, ${rc.osmRestaurants} OpenStreetMap, ${rc.locallyDiscoveredRestaurants} reviewed local-discovery records, ${rc.catalogMergedRestaurants} pre-discovery catalog records.\n\n## Social coverage\n\n| Platform | Places | Coverage |\n| --- | ---: | ---: |\n${Object.entries(sa.platformPlaceCounts).map(([platform, count]) => metricRow(platform, count)).join("\n")}\n\n- Website but no social network found: **${sa.websiteButNoSocialPlaces}**\n- No official website in the canonical record: **${sa.noWebsitePlaces}**\n- Shared-profile keys: **${sa.sharedProfileKeys}**; places with shared-brand profiles only: **${sa.sharedBrandOnlyPlaces}**\n- Candidate social associations awaiting verification: **${sa.candidatePlacesAwaitingVerification}**\n- Social source observations older than 90 days: **${sa.staleSocialVerificationPlaces}**\n\n## City events\n\n- Current/upcoming events: **${ea.currentCityEvents}**\n- Sources represented: **${ea.cityEventSources}**\n- Next 7 days: **${ea.next7Days}**; next 30 days: **${ea.next30Days}**\n- Ticket links: **${ea.withTicketLink}**; price information: **${ea.withPrice}**; explicitly free: **${ea.freeEvents}**\n- Coordinates: **${ea.withCoordinates}**\n- Conservative exact venue-name → restaurant matches: **${ea.withVenueRestaurantNameMatch}**\n- Possible duplicate current event records: **${ea.duplicateEventCount}**\n\n### Events by municipality\n\n${Object.entries(ea.byMunicipality).map(([key, value]) => `- ${key}: ${value}`).join("\n")}\n\n### Events by category\n\n${Object.entries(ea.byCategory).sort((a, b) => b[1] - a[1]).map(([key, value]) => `- ${key}: ${value}`).join("\n")}\n\n### Events by source\n\n${Object.entries(ea.bySource).sort((a, b) => b[1] - a[1]).map(([key, value]) => `- ${key}: ${value}`).join("\n")}\n\n## Freshness\n\n- < 7 days: ${rc.freshness.lt7Days}\n- 7–30 days: ${rc.freshness.days7To30}\n- 30–90 days: ${rc.freshness.days30To90}\n- > 90 days: ${rc.freshness.gt90Days}\n- Unknown: ${rc.freshness.unknown}\n\n## Source failures visible in the current data\n\n${Object.entries(report.sourceFailures).map(([key, value]) => `- ${key}: ${value}`).join("\n")}\n\n## Known model gaps exposed by this baseline\n\n- Reviewed discovery still follows the app's existing name-based merge behavior; name-only merges observed: **${rc.currentResolutionRisks.discoveryNameOnlyMerges}**.\n- City events do not yet have canonical venue/organizer entities; the venue relationship number above is only a conservative name match.\n- Accessibility and patio coverage are only counted when explicit fields/OSM tags/official-site evidence exist; absence is not treated as “no.”\n- Social link hubs are measured separately from social networks.\n\nMachine-readable details, gap queues, definitions, and failure counts are in \`data/build/content-coverage-report.json\`.\n`;

await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await mkdir(new URL("../docs", import.meta.url), { recursive: true });
await writeFile(new URL("../data/build/content-coverage-report.json", import.meta.url), JSON.stringify(report, null, 2));
await writeFile(new URL("../docs/content-coverage-report.md", import.meta.url), markdown);
console.log(JSON.stringify({ restaurantCoverage: report.restaurantCoverage, socialAudit: { ...report.socialAudit, priorityGapQueue: undefined }, eventCoverage: report.eventCoverage, sourceFailures: report.sourceFailures }, null, 2));
console.log("Content coverage report written to data/build/content-coverage-report.json and docs/content-coverage-report.md.");
