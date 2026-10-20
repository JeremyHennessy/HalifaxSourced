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
  const decision = window.HalifaxRestaurantIdentity.find(restaurants, discovered, window.HALIFAX_RESTAURANT_CORRECTIONS?.aliases || []);
  if (decision.state === "review") {
    window.__halifaxIdentityReviewQueue.push({ sourceId: discovered.id, name: discovered.name, reason: decision.reason, candidateIds: decision.candidateIds || [] });
    continue;
  }
  if (decision.state === "match") {
    const existing = decision.record;
    window.HalifaxRestaurantIdentity.merge(existing, discovered, decision);
    Object.assign(existing, enrichRestaurant(applyReviewedPlaceResolution(existing)));
    applyDiscoveryFlags(existing, discovered);
    continue;
  }

  const enriched = enrichRestaurant(applyReviewedPlaceResolution({
    ...discovered,
    sourceLayer: discovered.sourceLayer || "local_discovery"
  }));
  applyDiscoveryFlags(enriched, discovered);
  restaurants.push(enriched);
}

restaurants.sort((a, b) => (b.score || 0) - (a.score || 0) || a.name.localeCompare(b.name));
activeRestaurants.splice(0, activeRestaurants.length, ...restaurants.filter(isRestaurantActive));
window.__halifaxDiscoveredRestaurantCount = discoveredRestaurantPayload.length;
window.__halifaxRestaurantCount = restaurants.length;
