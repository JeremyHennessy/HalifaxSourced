"use strict";
const baseRenderHome = renderHome;
function halifaxDateKey(date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Halifax", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const v = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${v.year}-${v.month}-${v.day}`;
}
function halifaxWeekday(date) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Halifax", weekday: "long" }).format(date).toLowerCase();
}
function halifaxMinutes(date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Halifax", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const v = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(v.hour || 0) * 60 + Number(v.minute || 0);
}
function addDays(date, days) { return new Date(date.getTime() + days * 86400000); }
function eventStart(event) { const d = new Date(event.startAt); return Number.isNaN(d.getTime()) ? null : d; }
function richEventCard(event) {
  const start = eventStart(event); if (!start) return "";
  const link = safeUrl(event.ticketUrl) || safeUrl(event.officialUrl) || safeUrl(event.sourceUrl) || safeUrl(event.eventUrl);
  const when = start.toLocaleString("en-CA", { timeZone: "America/Halifax", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const venue = event.venueName || event.city || "Halifax";
  const inner = `<div class="event-card-body"><span class="eyebrow">${escapeHtml((event.categories || [event.category]).filter(Boolean)[0] || "Event")}</span><h3>${escapeHtml(event.title)}</h3><p>${escapeHtml(when)} · ${escapeHtml(venue)}</p>${event.free === true ? '<span class="card-tag">Free</span>' : ""}</div>`;
  return link ? `<a class="event-card" href="${escapeHtml(link)}" target="_blank" rel="noreferrer">${inner}</a>` : `<div class="event-card">${inner}</div>`;
}
function richSpecialCard(restaurant, special) {
  return `<article class="restaurant-card compact-card"><div class="restaurant-card-body"><span class="eyebrow">Verified special</span><h3><a href="#restaurant/${encodeURIComponent(restaurant.id)}">${escapeHtml(restaurant.name)}</a></h3><p><strong>${escapeHtml(special.title)}</strong></p><p>${escapeHtml(special.recurrence || "Check current details")}</p></div></article>`;
}
function homeRichSections() {
  const now = new Date();
  const today = halifaxDateKey(now);
  const tomorrow = halifaxDateKey(addDays(now, 1));
  const events = (window.HALIFAX_CITY_EVENTS?.events || [])
    .map((event) => ({ event, start: eventStart(event) }))
    .filter((item) => item.start && item.start >= new Date(now.getTime() - 6 * 3600000))
    .sort((a, b) => a.start - b.start);
  const tonight = events
    .filter(({ start }) => { const key = halifaxDateKey(start), mins = halifaxMinutes(start); return (key === today && mins >= 17 * 60) || (key === tomorrow && mins < 3 * 60); })
    .slice(0, 4).map((item) => item.event);
  const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const index = weekdays.indexOf(halifaxWeekday(now));
  const daysToFriday = index === 5 ? 0 : index === 6 ? -1 : index === 0 ? -2 : 5 - index;
  const friday = addDays(now, daysToFriday);
  const weekendKeys = new Set([0, 1, 2].map((offset) => halifaxDateKey(addDays(friday, offset))));
  const weekend = events.filter(({ start }) => weekendKeys.has(halifaxDateKey(start))).slice(0, 4).map((item) => item.event);
  const openPlaces = restaurants.filter((r) => r.currentHoursState?.state === "open").sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 4);
  const day = halifaxWeekday(now);
  const specials = [];
  for (const restaurant of restaurants) {
    for (const special of restaurant.currentVerifiedSpecials || []) {
      if (Array.isArray(special.dayOfWeek) && special.dayOfWeek.includes(day)) specials.push({ restaurant, special });
    }
  }
  specials.splice(4);
  const sections = [];
  if (tonight.length) sections.push(`<section class="page-shell section-block"><div class="section-heading"><div><span class="eyebrow">Tonight in Halifax</span><h2>What’s happening tonight</h2></div><a href="#events">All events →</a></div><div class="event-grid">${tonight.map(richEventCard).join("")}</div></section>`);
  if (openPlaces.length) sections.push(`<section class="page-shell section-block"><div class="section-heading"><div><span class="eyebrow">Eat tonight</span><h2>Open now with fresh official hours</h2></div><a href="#explore">Explore →</a></div><div class="restaurant-grid">${openPlaces.map((r, i) => restaurantCard(r, { index: i })).join("")}</div></section>`);
  if (specials.length) sections.push(`<section class="page-shell section-block"><div class="section-heading"><div><span class="eyebrow">Specials tonight</span><h2>Verified recurring offers</h2></div><a href="#specials">All specials →</a></div><div class="restaurant-grid">${specials.map(({ restaurant, special }) => richSpecialCard(restaurant, special)).join("")}</div></section>`);
  if (weekend.length) sections.push(`<section class="page-shell section-block"><div class="section-heading"><div><span class="eyebrow">This weekend</span><h2>Plan the weekend</h2></div><a href="#events">All events →</a></div><div class="event-grid">${weekend.map(richEventCard).join("")}</div></section>`);
  return sections.join("");
}
renderHome = function renderHomeWithStructuredDiscovery() {
  baseRenderHome();
  const rich = homeRichSections();
  if (rich) {
    const newsletter = appView.querySelector(".newsletter");
    if (newsletter) newsletter.insertAdjacentHTML("beforebegin", rich);
    else appView.insertAdjacentHTML("beforeend", rich);
  }
  bindCommonActions();
};
