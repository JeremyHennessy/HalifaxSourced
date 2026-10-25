"use strict";
const baseSearchableText = searchableText;
const linkedEventsByRestaurant = new Map();
for (const event of window.HALIFAX_CITY_EVENTS?.events || []) {
  if (!event?.restaurantId) continue;
  if (!linkedEventsByRestaurant.has(event.restaurantId)) linkedEventsByRestaurant.set(event.restaurantId, []);
  linkedEventsByRestaurant.get(event.restaurantId).push(event);
}
searchableText = function searchableTextWithStructuredContent(restaurant) {
  const base = baseSearchableText(restaurant);
  const facts = restaurant.structuredFacts;
  const structured = [
    ...(restaurant.structuredFeatures || []).map((item) => item.feature?.replaceAll("_", " ")),
    ...(restaurant.structuredSpecials || []).flatMap((item) => [item.title, item.specialType?.replaceAll("_", " "), item.recurrence]),
    ...(HalifaxDataIntegrity.primaryActionUrl(restaurant.id, 'reservations', restaurant.reservationLinks) ? (facts?.reservations || []).filter(item => HalifaxDataIntegrity.pointerSafe(restaurant.id, 'reservations', item.url)) : []).map((item) => item.provider?.replaceAll("_", " ")),
    ...(HalifaxDataIntegrity.primaryActionUrl(restaurant.id, 'ordering', restaurant.orderingLinks) ? (facts?.ordering || []).filter(item => HalifaxDataIntegrity.pointerSafe(restaurant.id, 'ordering', item.url)) : []).map((item) => item.provider?.replaceAll("_", " ")),
    ...(restaurant.socialProfiles || []).map((item) => `${item.platform} ${item.handle || ""}`),
    ...(linkedEventsByRestaurant.get(restaurant.id) || []).flatMap((event) => [event.title, event.venueName, event.organizerName, ...(event.categories || [])])
  ].filter(Boolean).join(" ").toLowerCase();
  return `${base} ${structured}`.trim();
};
