"use strict";
const structuredPlaceFactsPayload = window.HALIFAX_STRUCTURED_PLACE_FACTS ?? null;
const structuredPlaceFactRecords = HalifaxRestaurantCorrections.applyFactFieldRejections(
  (Array.isArray(structuredPlaceFactsPayload?.records) ? structuredPlaceFactsPayload.records : []).map(record => {
    if (!record.sourceUrl || safeUrl(record.sourceUrl)) return record;
    // Retain the observation, but never derive current service claims from a quarantined source.
    return { ...record, hours: null, phone: null, address: null, email: null, features: [], menus: [], reservations: [], ordering: [] };
  }),
  reviewedRestaurantCorrections
);
const structuredFactsByRestaurant = new Map(structuredPlaceFactRecords.map((record) => [record.restaurantId, record]));

function mergeActionLinks(existing = [], additions = [], labelFn = (item) => item.title || item.provider || "Official action") {
  const output = [...(existing || [])];
  const seen = new Set(output.map((item) => safeUrl(item?.url)).filter(Boolean));
  for (const item of additions || []) {
    const url = safeUrl(item?.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    output.push({ ...item, url, label: labelFn(item), verifiedLink: true, sourceKind: item.source || "official_website_structured_fact" });
  }
  return output;
}

function reservationFactLabel(item) {
  const reviewedLabel = typeof item?.label === "string" ? item.label.trim() : "";
  if (reviewedLabel === "Reservation inquiry" && item?.status === "verified_link" && item?.locationSpecific === true) return reviewedLabel;
  return `Book with ${String(item?.provider || "restaurant").replaceAll("_", " ")}`;
}

for (const restaurant of restaurants) {
  const facts = structuredFactsByRestaurant.get(restaurant.id) || null;
  restaurant.structuredFacts = facts;
  restaurant.structuredHours = facts?.hours || null;
  restaurant.hasStructuredHours = Boolean(facts?.hours);
  restaurant.currentHoursState = !isRestaurantActive(restaurant) ? { state: "closed", reason: `lifecycle_${restaurant.operatingStatus || "inactive"}` } : facts?.hours && typeof restaurantHoursState === "function" ? restaurantHoursState(facts.hours, new Date()) : { state: "unknown", reason: "structured_hours_unavailable" };
  restaurant.structuredFeatures = Array.isArray(facts?.features) ? facts.features : [];
  restaurant.structuredPhone = facts?.phone || null;
  restaurant.structuredAddress = facts?.address || null;
  restaurant.structuredEmail = facts?.email || null;
  restaurant.menuLinks = mergeActionLinks(restaurant.menuLinks, facts?.menus, (item) => item.title || `${String(item.menuType || "menu").replaceAll("_", " ")} menu`);
  restaurant.reservationLinks = mergeActionLinks(restaurant.reservationLinks, facts?.reservations, reservationFactLabel);
  restaurant.orderingLinks = mergeActionLinks(restaurant.orderingLinks, facts?.ordering, (item) => `Order via ${String(item.provider || "restaurant").replaceAll("_", " ")}`);
  restaurant.hasMenu = Boolean(restaurant.hasMenu || facts?.menus?.length);
  restaurant.hasReservation = Boolean(restaurant.hasReservation || facts?.reservations?.length);
  restaurant.hasOrdering = Boolean(restaurant.hasOrdering || facts?.ordering?.length);
  const featureNames = new Set((facts?.features || []).map((item) => item.feature));
  restaurant.hasPatio = Boolean(restaurant.hasPatio || ["patio", "rooftop", "outdoor_seating"].some((feature) => featureNames.has(feature)));
  restaurant.hasAccessibilityEvidence = ["wheelchair_entrance", "accessible_seating", "accessible_washroom", "step_free", "elevator"].some((feature) => featureNames.has(feature));
}

window.__halifaxStructuredPlaceFactCount = structuredPlaceFactRecords.length;
window.__halifaxStructuredHoursCount = structuredPlaceFactRecords.filter((record) => record.hours).length;
