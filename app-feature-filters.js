"use strict";

const baseSearchableTextForExpandedSources = searchableText;
searchableText = function searchableTextWithExpandedSources(restaurant) {
  return [
    baseSearchableTextForExpandedSources(restaurant),
    ...(restaurant.socialProfiles || []).flatMap((profile) => [profile.platform, profile.handle, profile.label]),
    ...(restaurant.relatedLinks || []).flatMap((link) => [link.kind, link.label]),
    ...(restaurant.orderingLinks || []).map((link) => link.label)
  ].filter(Boolean).join(" ").toLowerCase();
};

const baseFilteredRestaurantsForExpandedSources = filteredRestaurants;
filteredRestaurants = function filteredRestaurantsWithExpandedSources(options = {}) {
  const feature = options.feature ?? state.feature;
  if (!["social", "reservations", "ordering"].includes(feature)) return baseFilteredRestaurantsForExpandedSources(options);

  const base = baseFilteredRestaurantsForExpandedSources({ ...options, feature: "all" });
  if (feature === "social") return base.filter((restaurant) => (restaurant.socialProfiles || []).length > 0);
  if (feature === "reservations") return base.filter((restaurant) => restaurant.hasReservation || (restaurant.reservationLinks || []).length > 0);
  if (feature === "ordering") return base.filter((restaurant) => restaurant.hasOrdering || (restaurant.orderingLinks || []).length > 0);
  return base;
};

window.__halifaxSocialLinkedRestaurantCount = restaurants.filter((restaurant) => (restaurant.socialProfiles || []).length > 0).length;
window.__halifaxReservationLinkedRestaurantCount = restaurants.filter((restaurant) => restaurant.hasReservation || (restaurant.reservationLinks || []).length > 0).length;
window.__halifaxOrderingLinkedRestaurantCount = restaurants.filter((restaurant) => restaurant.hasOrdering || (restaurant.orderingLinks || []).length > 0).length;
