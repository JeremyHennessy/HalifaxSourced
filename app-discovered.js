"use strict";

const discoveredRestaurantPayload = Array.isArray(window.HALIFAX_DISCOVERED_RESTAURANTS)
  ? window.HALIFAX_DISCOVERED_RESTAURANTS
  : [];

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
    existing.sources = mergeSources(existing.sources, discovered.sources);
    existing.freshnessDate = [existing.freshnessDate, discovered.freshnessDate].filter(Boolean).sort().at(-1) || null;
    existing.discoveryEvidenceStatus = discovered.evidenceStatus || existing.discoveryEvidenceStatus || null;
    continue;
  }

  restaurants.push(enrichRestaurant({
    ...discovered,
    sourceLayer: discovered.sourceLayer || "local_discovery"
  }));
}

restaurants.sort((a, b) => (b.score || 0) - (a.score || 0) || a.name.localeCompare(b.name));
window.__halifaxDiscoveredRestaurantCount = discoveredRestaurantPayload.length;
window.__halifaxRestaurantCount = restaurants.length;
