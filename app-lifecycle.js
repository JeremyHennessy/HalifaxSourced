"use strict";

// Run after all source/fact decorators so a later enrichment layer cannot make a
// closed or moved record look current again. Historical source and social links
// remain available on the direct detail route as evidence.
for (const restaurant of restaurants) {
  if (isRestaurantActive(restaurant)) continue;
  restaurant.menuLinks = [];
  restaurant.reservationLinks = [];
  restaurant.orderingLinks = [];
  restaurant.specialLinks = [];
  restaurant.eventLinks = [];
  restaurant.relatedLinks = [];
  restaurant.structuredSpecials = [];
  restaurant.currentVerifiedSpecials = [];
  restaurant.structuredEvents = [];
  restaurant.officialUpdates = [];
  restaurant.specials = [];
  restaurant.events = [];
  restaurant.hasMenu = false;
  restaurant.hasSpecial = false;
  restaurant.hasEvent = false;
  restaurant.hasOpening = false;
  restaurant.hasReservation = false;
  restaurant.hasOrdering = false;
  restaurant.currentHoursState = { state: "closed", reason: restaurant.operatingStatus };
}
