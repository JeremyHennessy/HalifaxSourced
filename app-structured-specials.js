"use strict";
const structuredSpecialPayload = window.HALIFAX_STRUCTURED_SPECIALS ?? null;
const structuredSpecialRecords = Array.isArray(structuredSpecialPayload?.records) ? structuredSpecialPayload.records : [];
function currentStructuredSpecial(special) { return HalifaxDataIntegrity.currentOffer(special, Date.now(), Number(structuredSpecialPayload?.currentVerificationMaxAgeDays || 30)); }
const structuredSpecialsByRestaurant = new Map();
for (const special of structuredSpecialRecords) {
  if (!structuredSpecialsByRestaurant.has(special.restaurantId)) structuredSpecialsByRestaurant.set(special.restaurantId, []);
  structuredSpecialsByRestaurant.get(special.restaurantId).push(special);
}
for (const restaurant of restaurants) {
  restaurant.structuredSpecials = structuredSpecialsByRestaurant.get(restaurant.id) || [];
  restaurant.currentVerifiedSpecials = restaurant.structuredSpecials.filter((special) => currentStructuredSpecial(special));
  restaurant.hasSpecial = Boolean(restaurant.hasSpecial || restaurant.structuredSpecials.length);
}
window.__halifaxStructuredSpecialCount = structuredSpecialRecords.length;
window.__halifaxVerifiedCurrentSpecialCount = structuredSpecialRecords.filter(currentStructuredSpecial).length;
