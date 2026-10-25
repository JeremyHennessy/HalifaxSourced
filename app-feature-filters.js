"use strict";

const baseSearchableTextForExpandedSources = searchableText;
searchableText = function searchableTextWithExpandedSources(restaurant) {
  return [
    baseSearchableTextForExpandedSources(restaurant),
    ...(restaurant.socialProfiles || []).flatMap((profile) => [profile.platform, profile.handle, profile.label]),
    ...(restaurant.relatedLinks || []).filter((link) => !['ordering', 'reservations'].includes(link.kind) || HalifaxDataIntegrity.primaryActionUrl(restaurant.id, link.kind, link.kind === 'ordering' ? restaurant.orderingLinks : restaurant.reservationLinks)).flatMap((link) => [link.kind, link.label]),
    ...HalifaxDataIntegrity.actionLinks(restaurant.id, 'ordering', restaurant.orderingLinks).map((link) => link.label)
  ].filter(Boolean).join(" ").toLowerCase();
};

const baseFilteredRestaurantsForExpandedSources = filteredRestaurants;
filteredRestaurants = function filteredRestaurantsWithExpandedSources(options = {}) {
  const feature = options.feature ?? state.feature;
  if (!["social", "reservations", "ordering"].includes(feature)) return baseFilteredRestaurantsForExpandedSources(options);

  const base = baseFilteredRestaurantsForExpandedSources({ ...options, feature: "all" });
  if (feature === "social") return base.filter((restaurant) => (restaurant.socialProfiles || []).length > 0);
  if (feature === "reservations") return base.filter((restaurant) => HalifaxDataIntegrity.actionAvailable(restaurant.id, 'reservations', restaurant.reservationLinks, restaurant.hasReservation));
  if (feature === "ordering") return base.filter((restaurant) => HalifaxDataIntegrity.actionAvailable(restaurant.id, 'ordering', restaurant.orderingLinks, restaurant.hasOrdering));
  return base;
};

window.__halifaxSocialLinkedRestaurantCount = restaurants.filter((restaurant) => (restaurant.socialProfiles || []).length > 0).length;
window.__halifaxReservationLinkedRestaurantCount = restaurants.filter((restaurant) => HalifaxDataIntegrity.actionAvailable(restaurant.id, 'reservations', restaurant.reservationLinks, restaurant.hasReservation)).length;
window.__halifaxOrderingLinkedRestaurantCount = restaurants.filter((restaurant) => HalifaxDataIntegrity.actionAvailable(restaurant.id, 'ordering', restaurant.orderingLinks, restaurant.hasOrdering)).length;
