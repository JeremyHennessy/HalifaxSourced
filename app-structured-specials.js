"use strict";
const structuredSpecialPayload = window.HALIFAX_STRUCTURED_SPECIALS ?? null;
const structuredSpecialRecords = Array.isArray(structuredSpecialPayload?.records) ? structuredSpecialPayload.records : [];
const structuredSpecialsByRestaurant = new Map();
for (const special of structuredSpecialRecords) {
  if (!structuredSpecialsByRestaurant.has(special.restaurantId)) structuredSpecialsByRestaurant.set(special.restaurantId, []);
  structuredSpecialsByRestaurant.get(special.restaurantId).push(special);
}
for (const restaurant of restaurants) {
  restaurant.structuredSpecials = structuredSpecialsByRestaurant.get(restaurant.id) || [];
  restaurant.currentVerifiedSpecials = restaurant.structuredSpecials.filter((special) => special.status === "verified_current");
  restaurant.hasSpecial = Boolean(restaurant.hasSpecial || restaurant.structuredSpecials.length);
}
window.__halifaxStructuredSpecialCount = structuredSpecialRecords.length;
window.__halifaxVerifiedCurrentSpecialCount = structuredSpecialRecords.filter((special) => special.status === "verified_current").length;
