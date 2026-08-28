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
  const schedule = intervals.length ? intervals.map((item) => `${item.open}–${item.close}${item.overnight ? " next day" : ""}`).join(", ") : "Closed today";
  if (!structuredFactFresh(facts.lastVerifiedAt || facts.observedAt)) return `${schedule} · check current hours`;
  const state = restaurantHoursState(facts.hours, date);
  if (state.state === "open") return `Open now · closes ${state.closesAt} · ${schedule}`;
  if (state.state === "closed" && state.opensLaterToday) return `Closed now · opens ${state.opensAt} · ${schedule}`;
  if (state.state === "closed") return schedule;
  return `${schedule} · check current hours`;
}
for (const restaurant of restaurants) {
  const facts = restaurant.structuredFacts;
  if (!facts) continue;
  if (facts.phone) { restaurant.previousPhone = restaurant.phone || null; restaurant.phone = facts.phone; }
  if (facts.address) { restaurant.previousAddress = restaurant.address || null; restaurant.address = facts.address; }
  if (facts.hours) {
    restaurant.previousOpeningHours = restaurant.openingHours || null;
    restaurant.openingHours = formatStructuredHours(restaurant);
    restaurant.currentHoursState = structuredFactFresh(facts.lastVerifiedAt || facts.observedAt) ? restaurantHoursState(facts.hours, new Date()) : { state: "unknown", reason: "structured_hours_stale" };
  }
}
