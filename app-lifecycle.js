"use strict";

// Run after all source/fact decorators so a later enrichment layer cannot make a
// closed or moved record look current again. Historical source and social links
// remain available on the direct detail route as evidence.
// Reapply reviewed fields after enrichment so stale facts cannot reopen a venue.
HalifaxRestaurantCorrections.apply(restaurants, reviewedRestaurantCorrections);
for (const restaurant of restaurants) {
  // Automatic inspection matches were computed before reviewed identity fields.
  // Rebind only corrected names/addresses to the final location, as the catalog
  // exporter does. Keep independently reviewed source/inspection evidence intact.
  const identityFields = restaurant.reviewedCorrection?.fields;
  if (identityFields && ['name', 'address'].some(field => Object.prototype.hasOwnProperty.call(identityFields, field))) {
    restaurant.inspections = inspectionMatches(restaurant);
  }
  // Apply last: candidate/fact layers must not resurrect a rejected destination.
  restaurant.relatedLinks = (restaurant.relatedLinks || []).filter(link => HalifaxDataIntegrity.pointerSafe(restaurant.id, link.kind, link.url));
  restaurant.menuLinks = (restaurant.menuLinks || []).filter(link => HalifaxDataIntegrity.pointerSafe(restaurant.id, 'menu', link.url));
  restaurant.specialLinks = (restaurant.specialLinks || []).filter(link => HalifaxDataIntegrity.pointerSafe(restaurant.id, 'special', link.url));
  restaurant.structuredSpecials = (restaurant.structuredSpecials || []).filter(item => HalifaxDataIntegrity.pointerSafe(restaurant.id, 'special', item.sourceUrl));
  restaurant.currentVerifiedSpecials = (restaurant.currentVerifiedSpecials || []).filter(item => HalifaxDataIntegrity.pointerSafe(restaurant.id, 'special', item.sourceUrl));
  for (const [kind, field, flag] of [['ordering', 'orderingLinks', 'hasOrdering'], ['reservations', 'reservationLinks', 'hasReservation']]) {
    const links = restaurant[field] || [];
    // Match the primary CTA without promoting a runner-up; unrelated
    // keyword-only reservation capability remains a separate existing signal.
    restaurant[flag] = HalifaxDataIntegrity.actionAvailable(restaurant.id, kind, links, restaurant[flag]);
  }
  restaurant.hasMenu = restaurant.menuLinks.length > 0;
  restaurant.hasSpecial = Boolean(restaurant.specialLinks.length || restaurant.structuredSpecials.length || restaurant.specials?.length);
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
  restaurant.openingHours = null;
}
activeRestaurants.splice(0, activeRestaurants.length, ...restaurants.filter(isRestaurantActive));
