import { mkdir, readFile, writeFile } from "node:fs/promises";

const cityPath = new URL("../data/build/city-events.json", import.meta.url);
const cityJsPath = new URL("../data/city-events.js", import.meta.url);
const venues = JSON.parse(await readFile(new URL("../data/venue-registry.json", import.meta.url), "utf8"));
const organizers = JSON.parse(await readFile(new URL("../data/organizer-registry.json", import.meta.url), "utf8"));
const catalog = JSON.parse(await readFile(new URL("../data/build/catalog.json", import.meta.url), "utf8"));
const payload = JSON.parse(await readFile(cityPath, "utf8"));
const events = Array.isArray(payload.events) ? payload.events : [];

function normalize(value) {
  return String(value ?? "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(the|centre|center|auditorium|theatre|theater|venue|events?)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ").trim();
}
function normalizeAddress(value) {
  return String(value ?? "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(street|st\.?|road|rd\.?|avenue|ave\.?|drive|dr\.?|place|pl\.?|nova scotia|ns|canada)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function sourceId(event) { return String(event.sourceId || event.source?.id || "").trim(); }
function sourceName(event) { return String(event.sourceName || event.source?.name || "").trim(); }
function venueText(event) { return String(event.venueName || event.venue || "").trim(); }

const venueBySource = new Map();
const venueByName = new Map();
for (const venue of venues.venues || []) {
  for (const id of venue.sourceIds || []) venueBySource.set(id, venue);
  for (const name of [venue.name, ...(venue.alternateNames || [])]) {
    const key = normalize(name);
    if (key) venueByName.set(key, venue);
  }
}
const organizerBySource = new Map();
for (const organizer of organizers.organizers || []) for (const id of organizer.sourceIds || []) organizerBySource.set(id, organizer);

const catalogByName = new Map();
const catalogByAddress = new Map();
for (const place of catalog.restaurants || []) {
  const name = normalize(place.name);
  if (name && !catalogByName.has(name)) catalogByName.set(name, []);
  if (name) catalogByName.get(name).push(place);
  const address = normalizeAddress(place.address);
  if (address && !catalogByAddress.has(address)) catalogByAddress.set(address, []);
  if (address) catalogByAddress.get(address).push(place);
}

function resolveVenue(event) {
  const direct = venueBySource.get(sourceId(event));
  if (direct) return { venue: direct, basis: "source_id" };
  const key = normalize(venueText(event));
  if (key && venueByName.has(key)) return { venue: venueByName.get(key), basis: "exact_normalized_venue_name" };
  return { venue: null, basis: null };
}
function resolveOrganizer(event) {
  const direct = organizerBySource.get(sourceId(event));
  if (direct) return { organizer: direct, basis: "source_id" };
  const haystack = `${sourceName(event)} ${event.organizerName || ""}`.toLowerCase();
  const candidates = (organizers.organizers || []).filter((organizer) => (organizer.sourceNameTokens || []).some((token) => haystack.includes(String(token).toLowerCase())));
  return candidates.length === 1 ? { organizer: candidates[0], basis: "source_name_token" } : { organizer: null, basis: null };
}
function resolveRestaurant(venue) {
  if (!venue) return { place: null, basis: null };
  const names = [venue.name, ...(venue.alternateNames || [])].map(normalize).filter(Boolean);
  const nameMatches = names.flatMap((name) => catalogByName.get(name) || []);
  const uniqueName = [...new Map(nameMatches.map((place) => [place.id, place])).values()];
  if (uniqueName.length === 1) return { place: uniqueName[0], basis: "exact_venue_place_name" };
  const address = normalizeAddress(venue.address);
  const addressMatches = address ? (catalogByAddress.get(address) || []) : [];
  if (addressMatches.length === 1 && names.includes(normalize(addressMatches[0].name))) return { place: addressMatches[0], basis: "exact_venue_name_and_address" };
  return { place: null, basis: null };
}

const resolutions = [];
let venueResolved = 0;
let organizerResolved = 0;
let restaurantResolved = 0;
for (const event of events) {
  const venueResult = resolveVenue(event);
  const organizerResult = resolveOrganizer(event);
  const restaurantResult = resolveRestaurant(venueResult.venue);
  if (venueResult.venue) {
    venueResolved += 1;
    event.venueId = venueResult.venue.venueId;
    event.venueName = event.venueName || venueResult.venue.name;
    event.address = event.address || venueResult.venue.address || null;
    event.city = event.city || venueResult.venue.city || null;
    event.neighbourhood = event.neighbourhood || venueResult.venue.neighbourhood || null;
  }
  if (organizerResult.organizer) {
    organizerResolved += 1;
    event.organizerId = organizerResult.organizer.organizerId;
    event.organizerName = event.organizerName || organizerResult.organizer.name;
  }
  if (restaurantResult.place) {
    restaurantResolved += 1;
    event.restaurantId = restaurantResult.place.id;
  }
  resolutions.push({
    eventId: event.eventId || event.id || null,
    title: event.title,
    sourceId: sourceId(event) || null,
    venueId: venueResult.venue?.venueId || null,
    venueBasis: venueResult.basis,
    organizerId: organizerResult.organizer?.organizerId || null,
    organizerBasis: organizerResult.basis,
    restaurantId: restaurantResult.place?.id || null,
    restaurantBasis: restaurantResult.basis
  });
}

payload.entityResolution = {
  appliedAt: new Date().toISOString(),
  venueRegistryVersion: venues.version,
  organizerRegistryVersion: organizers.version,
  venueResolved,
  organizerResolved,
  restaurantResolved,
  eventCount: events.length
};
payload.events = events;
await writeFile(cityPath, JSON.stringify(payload, null, 2) + "\n");
await writeFile(cityJsPath, `window.HALIFAX_CITY_EVENTS = ${JSON.stringify(payload, null, 2)};\n`);
const report = {
  generatedAt: new Date().toISOString(),
  eventCount: events.length,
  venueResolved,
  organizerResolved,
  restaurantResolved,
  unresolvedVenue: events.length - venueResolved,
  unresolvedOrganizer: events.length - organizerResolved,
  resolutions
};
await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(new URL("../data/build/event-entity-resolution.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ eventCount: events.length, venueResolved, organizerResolved, restaurantResolved, unresolvedVenue: events.length - venueResolved, unresolvedOrganizer: events.length - organizerResolved }, null, 2));
