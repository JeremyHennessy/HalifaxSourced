import { mkdir, readFile, writeFile } from "node:fs/promises";

const venues = JSON.parse(await readFile(new URL("../data/venue-registry.json", import.meta.url), "utf8"));
const organizers = JSON.parse(await readFile(new URL("../data/organizer-registry.json", import.meta.url), "utf8"));
const catalog = JSON.parse(await readFile(new URL("../data/build/catalog.json", import.meta.url), "utf8"));
const city = JSON.parse(await readFile(new URL("../data/build/city-events.json", import.meta.url), "utf8"));
const resolution = JSON.parse(await readFile(new URL("../data/build/event-entity-resolution.json", import.meta.url), "utf8"));
const venueIds = new Set((venues.venues || []).map((item) => item.venueId));
const organizerIds = new Set((organizers.organizers || []).map((item) => item.organizerId));
const restaurantIds = new Set((catalog.restaurants || []).map((item) => item.id));
const errors = [];
const warnings = [];

for (const event of city.events || []) {
  if (event.venueId && !venueIds.has(event.venueId)) errors.push(`unknown_venue:${event.eventId || event.id}:${event.venueId}`);
  if (event.organizerId && !organizerIds.has(event.organizerId)) errors.push(`unknown_organizer:${event.eventId || event.id}:${event.organizerId}`);
  if (event.restaurantId && !restaurantIds.has(event.restaurantId)) errors.push(`unknown_restaurant:${event.eventId || event.id}:${event.restaurantId}`);
}
if ((resolution.eventCount || 0) !== (city.events || []).length) errors.push(`resolution_event_count_mismatch:${resolution.eventCount}:${(city.events || []).length}`);
if ((resolution.venueResolved || 0) < 1) warnings.push("zero_venue_resolution");
if ((resolution.organizerResolved || 0) < 1) warnings.push("zero_organizer_resolution");

const venueDuplicateNames = new Map();
for (const venue of venues.venues || []) {
  const key = String(venue.name || "").toLowerCase();
  venueDuplicateNames.set(key, (venueDuplicateNames.get(key) || 0) + 1);
}
for (const [name, count] of venueDuplicateNames) if (name && count > 1) errors.push(`duplicate_venue_name:${name}:${count}`);
const report = {
  generatedAt: new Date().toISOString(),
  eventCount: (city.events || []).length,
  venueCount: venueIds.size,
  organizerCount: organizerIds.size,
  venueResolved: resolution.venueResolved || 0,
  organizerResolved: resolution.organizerResolved || 0,
  restaurantResolved: resolution.restaurantResolved || 0,
  errors,
  warnings
};
await mkdir(new URL("../artifacts", import.meta.url), { recursive: true });
await writeFile(new URL("../artifacts/event-entity-resolution-report.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exit(1);
