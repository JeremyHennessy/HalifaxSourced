"use strict";
const STRUCTURED_HOURS_MAX_AGE_DAYS = 14;
function structuredFactFresh(value, maxDays = STRUCTURED_HOURS_MAX_AGE_DAYS) {
  const stamp = Date.parse(String(value || ""));
  if (!Number.isFinite(stamp)) return false;
  const age = Date.now() - stamp;
  return age >= -24 * 60 * 60 * 1000 && age <= maxDays * 24 * 60 * 60 * 1000;
}
function todaysStructuredHours(weekly, date = new Date()) {
  if (!weekly) return [];
  const day = halifaxClockParts(date).day;
  return Array.isArray(weekly[day]) ? weekly[day] : [];
}
function formatStructuredHours(restaurant, date = new Date()) {
  const facts = restaurant.structuredFacts;
  if (!facts?.hours) return null;
  const intervals = todaysStructuredHours(facts.hours, date);
  const schedule = intervals.length ? intervals.map((item) => `${item.open}–${item.close}${item.overnight ? " next day" : ""}`).join(", ") : Array.isArray(facts.hours[halifaxClockParts(date).day]) ? "Closed today" : "Today’s hours not confirmed";
  if (!structuredFactFresh(facts.hoursVerifiedAt || facts.lastVerifiedAt || facts.observedAt)) return `${schedule} · check current hours`;
  const state = restaurantHoursState(facts.hours, date);
  if (state.state === "open") return `Open now · closes ${state.closesAt} · ${schedule}`;
  if (state.state === "closed" && state.opensLaterToday) return `Closed now · opens ${state.opensAt} · ${schedule}`;
  if (state.state === "closed") return schedule;
  return `${schedule} · check current hours`;
}
// A structured observation can contain only a locality or malformed contact
// text. Keep that raw evidence, but do not replace a public civic address with
// it. This is a completeness guard, not a geocode or a new location approval.
function usableStructuredCivicAddress(value) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().replace(/\s*[\r\n]+\s*/g, ", ");
  const firstLine = normalized.split(",")[0].trim();
  const civic = firstLine.match(/^\d{1,5}[a-z]?\s+(.+)$/i);
  if (!civic) return false;
  const street = civic[1].trim();
  // Numeric contact tails and unlabelled unit-first forms are not streets.
  if (!/^(?:[\p{L}][\p{L}'’.-]*(?:\s|$)|\d+(?:st|nd|rd|th)\s+[\p{L}])/iu.test(street)) return false;
  if (/^(?:to|through|and)\s+\d/i.test(street)) return false;
  if (/^(?:unit|suite|phone|tel|telephone|fax|ext|extension)\b/i.test(street)) return false;
  if (/^(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\b/i.test(street)) return false;
  const parsed = HalifaxRestaurantIdentity.address(normalized);
  return Boolean(parsed && !parsed.inconsistent);
}
for (const restaurant of restaurants) {
  const facts = restaurant.structuredFacts;
  if (!facts) continue;
  if (facts.phone) { restaurant.previousPhone = restaurant.phone || null; restaurant.phone = facts.phone; }
  if (usableStructuredCivicAddress(facts.address)) { restaurant.previousAddress = restaurant.address || null; restaurant.address = facts.address; }
  if (facts.hours) {
    restaurant.previousOpeningHours = restaurant.openingHours || null;
    restaurant.openingHours = formatStructuredHours(restaurant);
    restaurant.currentHoursState = structuredFactFresh(facts.hoursVerifiedAt || facts.lastVerifiedAt || facts.observedAt) ? restaurantHoursState(facts.hours, new Date()) : { state: "unknown", reason: "structured_hours_stale" };
  }
}
