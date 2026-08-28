"use strict";
const EVENT_EDITORIAL_LIMIT = 8;
const HALIFAX_EVENT_TIME_ZONE = "America/Halifax";

function activeStructuredEvents() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  return structuredEvents
    .filter((event) => Number.isFinite(Date.parse(event.startAt)) && Date.parse(event.endAt || event.startAt) >= cutoff)
    .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.title.localeCompare(b.title));
}

function renderEvents() {
  const structured = activeStructuredEvents();
  if (structured.length) {
    renderStructuredEvents(structured);
    return;
  }
  renderEventLeads();
}

function renderStructuredEvents(items) {
  const featured = items[0];
  const visibleItems = items.slice(0, EVENT_EDITORIAL_LIMIT);
  const featuredRestaurant = restaurants.find((restaurant) => restaurant.id === featured.restaurantId);
  appView.innerHTML = `
    <section class="editorial-hero events-hero">
      <div class="page-shell editorial-hero-inner">
        <div><span class="eyebrow">What's happening</span><h1>Events in Halifax</h1><p>Upcoming events with structured dates extracted from restaurant-owned source pages.</p></div>
        <div class="featured-event"><span>UPCOMING EVENT</span><h2>${escapeHtml(featured.title)}</h2><p>${escapeHtml(structuredEventWhen(featured))}${featuredRestaurant ? ` · ${escapeHtml(featuredRestaurant.name)}` : ""}</p><a class="button light" href="${escapeHtml(safeUrl(featured.eventUrl) || safeUrl(featured.sourceUrl))}" target="_blank" rel="noreferrer">Official source ↗</a></div>
      </div>
    </section>
    <section class="page-shell two-column-page">
      <div>
        <div class="chip-row"><span class="chip is-active">Upcoming</span><span class="chip">Structured dates</span><span class="chip">Official sources</span></div>
        <div class="section-heading no-top"><div><h2>Upcoming events</h2><p>Dates come from structured Event data on restaurant-owned pages. Times are shown in Halifax time. Source links remain available for final confirmation.</p></div><span class="editorial-count">Showing ${visibleItems.length} of ${items.length} upcoming events</span></div>
        <div class="event-list">${visibleItems.map(structuredEventCard).join("")}</div>
        ${items.length > visibleItems.length ? `<div class="editorial-more"><a class="button secondary" href="#explore?feature=events">Explore event-ready places</a><p>More structured events are available through restaurant discovery.</p></div>` : ""}
      </div>
      <aside class="events-sidebar">
        <div class="calendar-card">${simpleCalendar(items)}</div>
        <div class="source-card"><h2>Source standard</h2><p>These listings require a valid future date, exact restaurant ID, official source URL, and structured JSON-LD Event record. Cancelled or expired events are excluded.</p></div>
      </aside>
    </section>`;
  bindCommonActions();
}

function renderEventLeads() {
  const items = eventLeadItems();
  const featured = items[0];
  const visibleItems = items.slice(0, EVENT_EDITORIAL_LIMIT);
  appView.innerHTML = `
    <section class="editorial-hero events-hero">
      <div class="page-shell editorial-hero-inner">
        <div><span class="eyebrow">What's happening</span><h1>Events in Halifax</h1><p>Food, music, community, market, and venue event leads gathered from restaurant and venue source pages.</p></div>
        ${featured ? `<div class="featured-event"><span>FEATURED SOURCE LEAD</span><h2>${escapeHtml(featured.restaurant.name)}</h2><p>${escapeHtml(displayEventLabel(featured.credibleLinks[0]?.label, featured.curatedEvents[0]?.title || "Event information available from official channels"))}</p><a class="button light" href="#restaurant/${encodeURIComponent(featured.restaurant.id)}">View details</a></div>` : ""}
      </div>
    </section>
    <section class="page-shell two-column-page">
      <div>
        <div class="chip-row"><span class="chip is-active">Source leads</span><span class="chip">Needs date confirmation</span></div>
        <div class="section-heading no-top"><div><h2>Event leads</h2><p>Only concise event-labelled links, event-specific URLs, or curated event records are promoted here. Follow the official source before making plans.</p></div><span class="editorial-count">Showing ${visibleItems.length} of ${items.length} strongest leads</span></div>
        <div class="event-list">${visibleItems.length ? visibleItems.map(eventSourceCard).join("") : emptyPageState("No explicit event links are loaded yet.")}</div>
        ${items.length > visibleItems.length ? `<div class="editorial-more"><a class="button secondary" href="#explore">Explore all places</a><p>Additional source signals remain searchable through restaurant discovery.</p></div>` : ""}
      </div>
      <aside class="events-sidebar">
        <div class="calendar-card">${simpleCalendar([])}</div>
        <div class="source-card"><h2>How to read this page</h2><p>These are discovery leads from explicit official event links or curated event records, not a claim that an event occurs today. Open the source to confirm date, time, tickets, and availability.</p></div>
      </aside>
    </section>`;
  bindCommonActions();
}

function structuredEventCard(event) {
  const restaurant = restaurants.find((item) => item.id === event.restaurantId);
  const date = new Date(event.startAt);
  const month = date.toLocaleDateString("en-CA", { month: "short", timeZone: HALIFAX_EVENT_TIME_ZONE }).toUpperCase();
  const day = date.toLocaleDateString("en-CA", { day: "numeric", timeZone: HALIFAX_EVENT_TIME_ZONE });
  const source = safeUrl(event.eventUrl) || safeUrl(event.sourceUrl);
  return `<article class="event-card"><div class="event-date"><span>${escapeHtml(month)}</span><strong>${escapeHtml(day)}</strong></div><div class="event-thumb media-${restaurant ? mediaTone(restaurant) : "dining"}${restaurant ? permittedImageClass(restaurant) : ""}">${restaurant ? mediaImageMarkup(restaurant) : ""}</div><div class="event-copy"><div class="event-title-line"><h3>${escapeHtml(event.title)}</h3><span>${escapeHtml(String(event.eventType || "Event").replace(/Event$/, "") || "Event")}</span></div><p>${escapeHtml(event.venueName || restaurant?.name || "Halifax")}</p><small>${escapeHtml(structuredEventWhen(event))}${restaurant?.neighborhood ? ` · ${escapeHtml(restaurant.neighborhood)}` : ""}</small><div class="card-tags"><span>Structured date</span><span>Official source</span></div></div>${source ? `<a class="button tertiary" href="${escapeHtml(source)}" target="_blank" rel="noreferrer">Source ↗</a>` : restaurant ? `<a class="button tertiary" href="#restaurant/${encodeURIComponent(restaurant.id)}">View</a>` : ""}</article>`;
}

function structuredEventWhen(event) {
  const start = new Date(event.startAt);
  if (Number.isNaN(start.getTime())) return "Date unavailable";
  const date = start.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: HALIFAX_EVENT_TIME_ZONE });
  const hasTime = /T\d{2}:\d{2}/.test(String(event.startAt || ""));
  if (!hasTime) return date;
  const time = start.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", timeZone: HALIFAX_EVENT_TIME_ZONE, timeZoneName: "short" });
  return `${date} · ${time}`;
}

function eventSourceCard(item) {
  const restaurant = item.restaurant;
  const link = item.credibleLinks[0];
  const observed = restaurant.signal?.observedAt ? new Date(restaurant.signal.observedAt).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: HALIFAX_EVENT_TIME_ZONE }) : "SOURCE";
  const label = displayEventLabel(link?.label, item.curatedEvents[0]?.title || "Official channel contains event-related information");
  return `<article class="event-card"><div class="event-date"><span>CHECKED</span><strong>${escapeHtml(observed)}</strong></div><div class="event-thumb media-${mediaTone(restaurant)}${permittedImageClass(restaurant)}">${mediaImageMarkup(restaurant)}</div><div class="event-copy"><div class="event-title-line"><h3>${escapeHtml(restaurant.name)}</h3><span>Event lead</span></div><p>${escapeHtml(label)}</p><small>${escapeHtml(restaurant.neighborhood || "Halifax")} · Confirm current details</small><div class="card-tags"><span>Official source</span>${restaurant.hasPatio ? "<span>Patio</span>" : ""}</div></div><a class="button tertiary" href="#restaurant/${encodeURIComponent(restaurant.id)}">View</a></article>`;
}

function halifaxDateParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: HALIFAX_EVENT_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }).formatToParts(date);
  const get = (type) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function simpleCalendar(events = []) {
  const today = halifaxDateParts(new Date());
  const year = today?.year || new Date().getUTCFullYear();
  const month = today?.month || new Date().getUTCMonth() + 1;
  const day = today?.day || new Date().getUTCDate();
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthLabel = monthStart.toLocaleDateString("en-CA", { month: "long", year: "numeric", timeZone: "UTC" });
  const blanks = monthStart.getUTCDay();
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const eventDays = new Set(events.map((event) => halifaxDateParts(event.startAt)).filter((parts) => parts && parts.month === month && parts.year === year).map((parts) => parts.day));
  const cells = [...Array(blanks).fill(""), ...Array.from({ length: days }, (_, i) => String(i + 1))];
  return `<div class="calendar-heading"><span>▣</span><h2>${escapeHtml(monthLabel)}</h2></div><div class="calendar-week"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div><div class="calendar-grid">${cells.map((cell) => `<span class="${Number(cell) === day ? "today" : ""}"${eventDays.has(Number(cell)) ? ' title="Structured event available"' : ""}>${eventDays.has(Number(cell)) ? "•" : ""}${cell}</span>`).join("")}</div><p>${events.length ? "Dots mark structured event dates in the current month." : "Calendar dates are illustrative until structured event dates are collected."}</p>`;
}
