"use strict";

const discoveredRestaurantPayload = Array.isArray(window.HALIFAX_DISCOVERED_RESTAURANTS)
  ? window.HALIFAX_DISCOVERED_RESTAURANTS
  : [];

function applyDiscoveryFlags(restaurant, discovered) {
  restaurant.discoveryRecord = discovered;
  restaurant.discoveryEvidenceStatus = discovered.evidenceStatus || restaurant.discoveryEvidenceStatus || null;
  restaurant.openingStatus = discovered.openingStatus || restaurant.openingStatus || null;
  if (["open", "opening", "coming_soon", "returning"].includes(String(discovered.openingStatus || "").toLowerCase())) restaurant.hasOpening = true;
}

for (const discovered of discoveredRestaurantPayload) {
  if (!discovered?.id || !discovered?.name) continue;
  const nameKey = normalize(discovered.name);
  const existing = restaurants.find((restaurant) => normalize(restaurant.name) === nameKey);

  if (existing) {
    existing.category ||= discovered.category;
    existing.cuisines = unique([...(existing.cuisines || []), ...(discovered.cuisines || [])]);
    existing.vibe = unique([...(existing.vibe || []), ...(discovered.vibe || [])]);
    existing.address ||= discovered.address;
    existing.phone ||= discovered.phone;
    existing.website ||= discovered.website;
    existing.openingHours ||= discovered.openingHours;
    existing.coordinates ||= discovered.coordinates;
    existing.specials = [...(existing.specials || []), ...(discovered.specials || [])].filter((item, index, all) => all.findIndex((other) => `${other.title}|${other.cadence || ""}` === `${item.title}|${item.cadence || ""}`) === index);
    existing.sources = mergeSources(existing.sources, discovered.sources);
    existing.freshnessDate = [existing.freshnessDate, discovered.freshnessDate].filter(Boolean).sort().at(-1) || null;
    applyDiscoveryFlags(existing, discovered);
    continue;
  }

  const enriched = enrichRestaurant({
    ...discovered,
    sourceLayer: discovered.sourceLayer || "local_discovery"
  });
  applyDiscoveryFlags(enriched, discovered);
  restaurants.push(enriched);
}

restaurants.sort((a, b) => (b.score || 0) - (a.score || 0) || a.name.localeCompare(b.name));
window.__halifaxDiscoveredRestaurantCount = discoveredRestaurantPayload.length;
window.__halifaxRestaurantCount = restaurants.length;
