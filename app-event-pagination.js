"use strict";

const CITY_EVENT_PAGE_SIZE = 24;
cityEventState.page = cityEventState.page || 1;
cityEventState.windowDays = cityEventState.windowDays || "all";

function cityEventsForWindow(items) {
  if (cityEventState.windowDays === "all") return items;
  const days = Number(cityEventState.windowDays);
  if (!Number.isFinite(days)) return items;
  const end = Date.now() + days * 24 * 60 * 60 * 1000;
  return items.filter((event) => Date.parse(event.startAt) <= end);
}

renderCityEvents = function renderCityEventsWithPagination(allItems) {
  const categories = cityEventCategories(allItems);
  const categoryItems = cityEventState.category === "All"
    ? allItems
    : allItems.filter((event) => (event.categories || []).includes(cityEventState.category));
  const items = cityEventsForWindow(categoryItems);
  const visibleItems = items.slice(0, cityEventState.page * CITY_EVENT_PAGE_SIZE);
  const featured = visibleItems[0] || allItems[0];
  const sourceCount = new Set(allItems.map((event) => event.sourceId).filter(Boolean)).size;
  const failedSourceCount = Array.isArray(cityEventPayload?.failures) ? cityEventPayload.failures.length : 0;
  const scopeRemoved = cityEventPayload?.scopeAudit?.removedOutOfScope ?? 0;

  appView.innerHTML = `
    <section class="editorial-hero events-hero">
      <div class="page-shell editorial-hero-inner">
        <div><span class="eyebrow">What's happening</span><h1>Events in Halifax</h1><p>Sports, music, food, festivals, markets, arts, comedy and community events collected from Halifax-area calendars, venues, teams and public institutions.</p></div>
        ${featured ? `<div class="featured-event"><span>UPCOMING EVENT</span><h2>${escapeHtml(featured.title)}</h2><p>${escapeHtml(structuredEventWhen(featured))}${featured.venueName ? ` · ${escapeHtml(featured.venueName)}` : ""}</p>${eventSourceButton(featured, "View source ↗", "button light")}</div>` : ""}
      </div>
    </section>
    <section class="page-shell two-column-page">
      <div>
        <div class="chip-row city-event-filters" aria-label="Event categories">
          <button class="chip ${cityEventState.category === "All" ? "is-active" : ""}" type="button" data-event-category="All">All <small>${allItems.length}</small></button>
          ${categories.map(([category, count]) => `<button class="chip ${cityEventState.category === category ? "is-active" : ""}" type="button" data-event-category="${escapeHtml(category)}">${escapeHtml(category)} <small>${count}</small></button>`).join("")}
        </div>
        <div class="chip-row city-event-window-filters" aria-label="Event date range">
          ${[["7", "Next 7 days"], ["30", "Next 30 days"], ["90", "Next 90 days"], ["all", "All upcoming"]].map(([value, label]) => `<button class="chip ${String(cityEventState.windowDays) === value ? "is-active" : ""}" type="button" data-event-window="${value}">${label}</button>`).join("")}
        </div>
        <div class="section-heading no-top"><div><h2>${cityEventState.category === "All" ? "Upcoming events" : `${escapeHtml(cityEventState.category)} events`}</h2><p>Every listing keeps its original source. Confirm last-minute schedule, ticket and availability changes at the linked organizer or venue.</p></div><span class="editorial-count">Showing ${visibleItems.length} of ${items.length} matching events</span></div>
        <div class="event-list">${visibleItems.length ? visibleItems.map(cityEventCard).join("") : emptyPageState("No upcoming events match these filters.")}</div>
        ${items.length > visibleItems.length ? `<div class="editorial-more"><button class="button secondary" type="button" data-event-load-more>Load ${Math.min(CITY_EVENT_PAGE_SIZE, items.length - visibleItems.length)} more events</button><p>${items.length - visibleItems.length} more events remain in the current filter.</p></div>` : ""}
      </div>
      <aside class="events-sidebar">
        <div class="calendar-card">${simpleCalendar(items)}</div>
        <div class="source-card"><h2>Event coverage</h2><p>${allItems.length.toLocaleString()} upcoming Halifax-metro events from ${sourceCount.toLocaleString()} source feeds.</p><p>Coverage combines tourism, Halifax venues, sports schedules, Symphony Nova Scotia, Halifax Convention Centre and selected Halifax/Dartmouth/Bedford public-library branches.</p>${scopeRemoved ? `<p>${scopeRemoved.toLocaleString()} province-wide records were excluded in the latest scope audit because their locations were outside Halifax, Dartmouth or Bedford.</p>` : ""}${failedSourceCount ? `<p>${failedSourceCount} source${failedSourceCount === 1 ? "" : "s"} reported a refresh warning.</p>` : ""}</div>
      </aside>
    </section>`;

  bindExpandedCityEventActions();
  bindCommonActions();
};

function bindExpandedCityEventActions() {
  for (const button of document.querySelectorAll("[data-event-category]")) {
    button.addEventListener("click", () => {
      cityEventState.category = button.dataset.eventCategory || "All";
      cityEventState.page = 1;
      renderEvents();
    });
  }
  for (const button of document.querySelectorAll("[data-event-window]")) {
    button.addEventListener("click", () => {
      cityEventState.windowDays = button.dataset.eventWindow || "all";
      cityEventState.page = 1;
      renderEvents();
    });
  }
  document.querySelector("[data-event-load-more]")?.addEventListener("click", () => {
    cityEventState.page += 1;
    renderEvents();
  });
}

const baseStructuredEventWhenForAllDay = structuredEventWhen;
structuredEventWhen = function structuredEventWhenWithAllDay(event) {
  if (event?.allDay) {
    const start = new Date(event.startAt);
    if (Number.isNaN(start.getTime())) return "Date unavailable";
    const startLabel = start.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: HALIFAX_EVENT_TIME_ZONE });
    const end = new Date(event.endAt || event.startAt);
    if (Number.isNaN(end.getTime()) || start.toLocaleDateString("en-CA", { timeZone: HALIFAX_EVENT_TIME_ZONE }) === end.toLocaleDateString("en-CA", { timeZone: HALIFAX_EVENT_TIME_ZONE })) return startLabel;
    const endLabel = end.toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: HALIFAX_EVENT_TIME_ZONE });
    return `${startLabel} – ${endLabel}`;
  }
  return baseStructuredEventWhenForAllDay(event);
};
