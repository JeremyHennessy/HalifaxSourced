"use strict";

const CITY_EVENT_PAGE_SIZE = 24;
const CITY_EVENT_SAVED_KEY = "halifaxSourced.savedEvents.v1";
const DEFAULT_EVENT_FILTERS = Object.freeze({
  category: "All",
  windowDays: "all",
  city: "all",
  cost: "all",
  time: "all",
  source: "all",
  access: "all",
  query: "",
  sort: "soonest",
  savedOnly: false
});

Object.assign(cityEventState, {
  page: cityEventState.page || 1,
  category: cityEventState.category || DEFAULT_EVENT_FILTERS.category,
  windowDays: cityEventState.windowDays || DEFAULT_EVENT_FILTERS.windowDays,
  city: cityEventState.city || DEFAULT_EVENT_FILTERS.city,
  cost: cityEventState.cost || DEFAULT_EVENT_FILTERS.cost,
  time: cityEventState.time || DEFAULT_EVENT_FILTERS.time,
  source: cityEventState.source || DEFAULT_EVENT_FILTERS.source,
  access: cityEventState.access || DEFAULT_EVENT_FILTERS.access,
  query: cityEventState.query || DEFAULT_EVENT_FILTERS.query,
  sort: cityEventState.sort || DEFAULT_EVENT_FILTERS.sort,
  savedOnly: Boolean(cityEventState.savedOnly),
  lastFilterKey: ""
});

const savedCityEvents = readSavedCityEvents();

function readSavedCityEvents() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CITY_EVENT_SAVED_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function persistSavedCityEvents() {
  localStorage.setItem(CITY_EVENT_SAVED_KEY, JSON.stringify([...savedCityEvents]));
  window.__halifaxSavedEventCount = savedCityEvents.size;
}

window.__halifaxSavedEventCount = savedCityEvents.size;

function halifaxDateKey(value) {
  const parts = halifaxDateParts(value);
  if (!parts) return null;
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function addDaysToHalifaxParts(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function dateKeyFromParts(parts) {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function eventOverlapsDateRange(event, startKey, endKey) {
  const start = halifaxDateKey(event.startAt);
  const end = halifaxDateKey(event.endAt || event.startAt) || start;
  if (!start || !end) return false;
  return end >= startKey && start <= endKey;
}

function cityEventsForWindow(items) {
  const windowValue = String(cityEventState.windowDays || "all");
  if (windowValue === "all") return items;

  const today = halifaxDateParts(new Date());
  if (!today) return items;
  const todayKey = dateKeyFromParts(today);

  if (windowValue === "today") return items.filter((event) => eventOverlapsDateRange(event, todayKey, todayKey));

  if (windowValue === "weekend") {
    const localDate = new Date(Date.UTC(today.year, today.month - 1, today.day));
    const weekday = localDate.getUTCDay();
    const toFriday = weekday === 5 ? 0 : weekday === 6 ? -1 : weekday === 0 ? -2 : 5 - weekday;
    const friday = addDaysToHalifaxParts(today, toFriday);
    const sunday = addDaysToHalifaxParts(friday, 2);
    return items.filter((event) => eventOverlapsDateRange(event, dateKeyFromParts(friday), dateKeyFromParts(sunday)));
  }

  const days = Number(windowValue);
  if (!Number.isFinite(days) || days < 1) return items;
  const end = addDaysToHalifaxParts(today, days - 1);
  return items.filter((event) => eventOverlapsDateRange(event, todayKey, dateKeyFromParts(end)));
}

function eventCityName(event) {
  const address = String(event.address || "").toLowerCase();
  const city = String(event.city || "").trim();
  const haystack = `${city} ${address}`.toLowerCase();
  if (haystack.includes("dartmouth")) return "Dartmouth";
  if (haystack.includes("bedford")) return "Bedford";
  if (haystack.includes("halifax")) return "Halifax";
  return city || "Halifax";
}

function eventCostKind(event) {
  const raw = String(event.price || "").trim();
  if (!raw) return "unknown";
  if (/\bfree\b|no charge|complimentary/i.test(raw)) return "free";
  const values = raw.match(/\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) || [];
  if (values.length && values.every((value) => value === 0)) return "free";
  if (values.some((value) => value > 0) || /\$|cad|ticket|admission/i.test(raw)) return "paid";
  return "unknown";
}

function eventTimeKind(event) {
  if (event.allDay) return "all-day";
  const date = new Date(event.startAt);
  if (Number.isNaN(date.getTime())) return "unknown";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: HALIFAX_EVENT_TIME_ZONE,
    hour: "numeric",
    hourCycle: "h23"
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  if (!Number.isFinite(hour)) return "unknown";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

function eventSearchText(event) {
  return [
    event.title,
    event.venueName,
    event.address,
    event.city,
    event.sourceName,
    event.price,
    ...(event.categories || [])
  ].filter(Boolean).join(" ").toLowerCase();
}

function cityEventCategories(items) {
  const preferred = ["Music", "Sports", "Food & Drink", "Festivals", "Markets", "Arts", "Comedy", "Outdoor", "Community", "Family", "Theatre", "Business", "Education", "Other"];
  const counts = new Map();
  for (const event of items) {
    for (const category of event.categories || []) {
      if (!category) continue;
      counts.set(category, (counts.get(category) || 0) + 1);
    }
  }
  const ordered = [];
  for (const category of preferred) if (counts.has(category)) ordered.push([category, counts.get(category)]);
  for (const category of [...counts.keys()].filter((category) => !preferred.includes(category)).sort((a, b) => a.localeCompare(b))) {
    ordered.push([category, counts.get(category)]);
  }
  return ordered;
}

function cityEventCities(items) {
  const counts = new Map();
  for (const event of items) {
    const city = eventCityName(event);
    counts.set(city, (counts.get(city) || 0) + 1);
  }
  const priority = ["Halifax", "Dartmouth", "Bedford"];
  return [...counts.entries()].sort((a, b) => {
    const ai = priority.indexOf(a[0]);
    const bi = priority.indexOf(b[0]);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    return b[1] - a[1] || a[0].localeCompare(b[0]);
  });
}

function cityEventSources(items) {
  const counts = new Map();
  for (const event of items) {
    const source = event.sourceName || "Other source";
    counts.set(source, (counts.get(source) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function filteredCityEvents(allItems) {
  const query = String(cityEventState.query || "").trim().toLowerCase();
  let items = allItems.filter((event) => {
    if (cityEventState.category !== "All" && !(event.categories || []).includes(cityEventState.category)) return false;
    if (cityEventState.city !== "all" && eventCityName(event) !== cityEventState.city) return false;
    if (cityEventState.cost !== "all" && eventCostKind(event) !== cityEventState.cost) return false;
    if (cityEventState.time !== "all" && eventTimeKind(event) !== cityEventState.time) return false;
    if (cityEventState.source !== "all" && (event.sourceName || "Other source") !== cityEventState.source) return false;
    if (cityEventState.access === "tickets" && !safeUrl(event.ticketUrl)) return false;
    if (cityEventState.access === "source" && safeUrl(event.ticketUrl)) return false;
    if (cityEventState.savedOnly && !savedCityEvents.has(String(event.id))) return false;
    if (query && !eventSearchText(event).includes(query)) return false;
    return true;
  });

  items = cityEventsForWindow(items);

  return items.sort((a, b) => {
    if (cityEventState.sort === "latest") return String(b.startAt || "").localeCompare(String(a.startAt || "")) || String(a.title || "").localeCompare(String(b.title || ""));
    if (cityEventState.sort === "title") return String(a.title || "").localeCompare(String(b.title || ""));
    if (cityEventState.sort === "venue") return String(a.venueName || "").localeCompare(String(b.venueName || "")) || String(a.title || "").localeCompare(String(b.title || ""));
    return String(a.startAt || "").localeCompare(String(b.startAt || "")) || String(a.title || "").localeCompare(String(b.title || ""));
  });
}

function eventFilterKey() {
  return JSON.stringify({
    category: cityEventState.category,
    windowDays: cityEventState.windowDays,
    city: cityEventState.city,
    cost: cityEventState.cost,
    time: cityEventState.time,
    source: cityEventState.source,
    access: cityEventState.access,
    query: cityEventState.query,
    sort: cityEventState.sort,
    savedOnly: cityEventState.savedOnly
  });
}

function syncCityEventStateFromRoute() {
  const current = route();
  if (current.name !== "events") return;
  const params = current.params;
  cityEventState.category = params.get("category") || DEFAULT_EVENT_FILTERS.category;
  cityEventState.windowDays = params.get("when") || DEFAULT_EVENT_FILTERS.windowDays;
  cityEventState.city = params.get("where") || DEFAULT_EVENT_FILTERS.city;
  cityEventState.cost = params.get("cost") || DEFAULT_EVENT_FILTERS.cost;
  cityEventState.time = params.get("time") || DEFAULT_EVENT_FILTERS.time;
  cityEventState.source = params.get("source") || DEFAULT_EVENT_FILTERS.source;
  cityEventState.access = params.get("access") || DEFAULT_EVENT_FILTERS.access;
  cityEventState.query = params.get("event") || DEFAULT_EVENT_FILTERS.query;
  cityEventState.sort = params.get("sort") || DEFAULT_EVENT_FILTERS.sort;
  cityEventState.savedOnly = params.get("saved") === "1";
  const key = eventFilterKey();
  if (cityEventState.lastFilterKey && cityEventState.lastFilterKey !== key) cityEventState.page = 1;
  cityEventState.lastFilterKey = key;
}

function eventFilterHash() {
  const params = new URLSearchParams();
  if (cityEventState.category !== DEFAULT_EVENT_FILTERS.category) params.set("category", cityEventState.category);
  if (cityEventState.windowDays !== DEFAULT_EVENT_FILTERS.windowDays) params.set("when", cityEventState.windowDays);
  if (cityEventState.city !== DEFAULT_EVENT_FILTERS.city) params.set("where", cityEventState.city);
  if (cityEventState.cost !== DEFAULT_EVENT_FILTERS.cost) params.set("cost", cityEventState.cost);
  if (cityEventState.time !== DEFAULT_EVENT_FILTERS.time) params.set("time", cityEventState.time);
  if (cityEventState.source !== DEFAULT_EVENT_FILTERS.source) params.set("source", cityEventState.source);
  if (cityEventState.access !== DEFAULT_EVENT_FILTERS.access) params.set("access", cityEventState.access);
  if (cityEventState.query) params.set("event", cityEventState.query);
  if (cityEventState.sort !== DEFAULT_EVENT_FILTERS.sort) params.set("sort", cityEventState.sort);
  if (cityEventState.savedOnly) params.set("saved", "1");
  const query = params.toString();
  return `#events${query ? `?${query}` : ""}`;
}

function replaceEventHash() {
  const next = eventFilterHash();
  if (location.hash !== next) history.replaceState(null, "", next);
  cityEventState.lastFilterKey = eventFilterKey();
}

function resetCityEventFilters() {
  Object.assign(cityEventState, DEFAULT_EVENT_FILTERS, { page: 1, lastFilterKey: "" });
  replaceEventHash();
}

function eventWindowLabel(value) {
  return ({ today: "Today", weekend: "This weekend", "7": "Next 7 days", "30": "Next 30 days", "90": "Next 90 days", all: "All upcoming" })[String(value)] || "All upcoming";
}

function eventActiveFilterLabels() {
  const labels = [];
  if (cityEventState.query) labels.push(`Search: ${cityEventState.query}`);
  if (cityEventState.category !== "All") labels.push(cityEventState.category);
  if (cityEventState.windowDays !== "all") labels.push(eventWindowLabel(cityEventState.windowDays));
  if (cityEventState.city !== "all") labels.push(cityEventState.city);
  if (cityEventState.cost !== "all") labels.push(cityEventState.cost === "unknown" ? "Price not listed" : cityEventState.cost === "free" ? "Free" : "Paid");
  if (cityEventState.time !== "all") labels.push(({ "all-day": "All day", morning: "Morning", afternoon: "Afternoon", evening: "Evening" })[cityEventState.time] || cityEventState.time);
  if (cityEventState.source !== "all") labels.push(cityEventState.source);
  if (cityEventState.access === "tickets") labels.push("Tickets / registration");
  if (cityEventState.access === "source") labels.push("Source page only");
  if (cityEventState.savedOnly) labels.push("Saved events");
  return labels;
}

function eventFilterSelect(label, id, selected, options) {
  return `<label class="event-filter-control"><span>${escapeHtml(label)}</span><select id="${id}">${options.map(([value, text]) => `<option value="${escapeHtml(value)}" ${String(selected) === String(value) ? "selected" : ""}>${escapeHtml(text)}</option>`).join("")}</select></label>`;
}

renderCityEvents = function renderCityEventsWithCapabilities(allItems) {
  syncCityEventStateFromRoute();
  const categories = cityEventCategories(allItems);
  const cities = cityEventCities(allItems);
  const sources = cityEventSources(allItems);
  const items = filteredCityEvents(allItems);
  const visibleItems = items.slice(0, cityEventState.page * CITY_EVENT_PAGE_SIZE);
  const featured = visibleItems[0] || allItems[0];
  const sourceCount = new Set(allItems.map((event) => event.sourceId).filter(Boolean)).size;
  const failedSourceCount = Array.isArray(cityEventPayload?.failures) ? cityEventPayload.failures.length : 0;
  const scopeRemoved = cityEventPayload?.scopeAudit?.removedOutOfScope ?? 0;
  const activeLabels = eventActiveFilterLabels();

  window.__halifaxEventFilterState = {
    category: cityEventState.category,
    windowDays: cityEventState.windowDays,
    city: cityEventState.city,
    cost: cityEventState.cost,
    time: cityEventState.time,
    source: cityEventState.source,
    access: cityEventState.access,
    query: cityEventState.query,
    sort: cityEventState.sort,
    savedOnly: cityEventState.savedOnly,
    matched: items.length,
    visible: visibleItems.length
  };

  if (globalSearch) {
    globalSearch.value = cityEventState.query;
    globalSearch.placeholder = "Search events, venues, categories, or organizers…";
  }

  appView.innerHTML = `
    <section class="editorial-hero events-hero">
      <div class="page-shell editorial-hero-inner">
        <div><span class="eyebrow">What's happening</span><h1>Events in Halifax</h1><p>Find sports, music, food, festivals, arts, comedy, community events and more — then narrow by date, city, price, time, source and ticket availability.</p></div>
        ${featured ? `<div class="featured-event"><span>UPCOMING EVENT</span><h2>${escapeHtml(featured.title)}</h2><p>${escapeHtml(structuredEventWhen(featured))}${featured.venueName ? ` · ${escapeHtml(featured.venueName)}` : ""}</p>${eventSourceButton(featured, "View source ↗", "button light")}</div>` : ""}
      </div>
    </section>
    <section class="page-shell two-column-page event-discovery-layout">
      <div>
        <section class="event-filter-panel" aria-label="Event filters">
          <div class="event-filter-heading"><div><span class="eyebrow">Filter events</span><h2>Find exactly what's on</h2></div><button class="text-link" type="button" data-event-clear>Clear all</button></div>
          <form class="event-filter-search" data-event-search-form role="search">
            <label class="sr-only" for="eventSearchInput">Search events</label>
            <input id="eventSearchInput" type="search" value="${escapeHtml(cityEventState.query)}" placeholder="Search event, venue, category, address or organizer" autocomplete="off" />
            <button class="button primary" type="submit">Search</button>
          </form>
          <div class="chip-row city-event-window-filters" aria-label="Event date range">
            ${[["today", "Today"], ["weekend", "This weekend"], ["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["all", "All upcoming"]].map(([value, label]) => `<button class="chip ${String(cityEventState.windowDays) === value ? "is-active" : ""}" type="button" data-event-window="${value}" aria-pressed="${String(cityEventState.windowDays) === value}">${label}</button>`).join("")}
          </div>
          <div class="chip-row city-event-filters" aria-label="Event categories">
            <button class="chip ${cityEventState.category === "All" ? "is-active" : ""}" type="button" data-event-category="All" aria-pressed="${cityEventState.category === "All"}">All categories <small>${allItems.length}</small></button>
            ${categories.map(([category, count]) => `<button class="chip ${cityEventState.category === category ? "is-active" : ""}" type="button" data-event-category="${escapeHtml(category)}" aria-pressed="${cityEventState.category === category}">${escapeHtml(category)} <small>${count}</small></button>`).join("")}
          </div>
          <div class="event-filter-grid">
            ${eventFilterSelect("Area", "eventCityFilter", cityEventState.city, [["all", "All areas"], ...cities.map(([name, count]) => [name, `${name} (${count})`])])}
            ${eventFilterSelect("Price", "eventCostFilter", cityEventState.cost, [["all", "Any price"], ["free", "Free"], ["paid", "Paid"], ["unknown", "Price not listed"]])}
            ${eventFilterSelect("Time", "eventTimeFilter", cityEventState.time, [["all", "Any time"], ["all-day", "All day"], ["morning", "Morning"], ["afternoon", "Afternoon"], ["evening", "Evening"]])}
            ${eventFilterSelect("Access", "eventAccessFilter", cityEventState.access, [["all", "Any access"], ["tickets", "Tickets / registration"], ["source", "Source page only"]])}
            ${eventFilterSelect("Source", "eventSourceFilter", cityEventState.source, [["all", "All sources"], ...sources.map(([name, count]) => [name, `${name} (${count})`])])}
            ${eventFilterSelect("Sort", "eventSortFilter", cityEventState.sort, [["soonest", "Soonest first"], ["latest", "Latest first"], ["title", "Event name"], ["venue", "Venue"]])}
            <label class="event-filter-toggle"><input type="checkbox" id="eventSavedFilter" ${cityEventState.savedOnly ? "checked" : ""}/><span>Saved events only <small>${savedCityEvents.size}</small></span></label>
          </div>
          ${activeLabels.length ? `<div class="event-active-filters"><strong>${activeLabels.length} active</strong>${activeLabels.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}</div>` : ""}
        </section>

        <div class="section-heading no-top event-results-heading"><div><h2>${cityEventState.category === "All" ? "Upcoming events" : `${escapeHtml(cityEventState.category)} events`}</h2><p>Every listing keeps its source. Confirm last-minute schedule, ticket, price and availability changes with the linked organizer or venue.</p></div><span class="editorial-count" data-event-result-count>Showing ${visibleItems.length} of ${items.length} matching events</span></div>
        <div class="event-list">${visibleItems.length ? visibleItems.map(cityEventCard).join("") : emptyPageState("No upcoming events match these filters. Try clearing one or two filters.")}</div>
        ${items.length > visibleItems.length ? `<div class="editorial-more"><button class="button secondary" type="button" data-event-load-more>Load ${Math.min(CITY_EVENT_PAGE_SIZE, items.length - visibleItems.length)} more events</button><p>${items.length - visibleItems.length} more events remain in the current filter.</p></div>` : ""}
      </div>
      <aside class="events-sidebar">
        <div class="calendar-card">${simpleCalendar(items)}</div>
        <div class="source-card"><h2>Event coverage</h2><p>${allItems.length.toLocaleString()} upcoming Halifax-metro events from ${sourceCount.toLocaleString()} source feeds.</p><p>${categories.length.toLocaleString()} source categories, ${cities.length.toLocaleString()} areas and ${sources.length.toLocaleString()} source calendars are available as filters.</p>${scopeRemoved ? `<p>${scopeRemoved.toLocaleString()} province-wide records were excluded in the latest scope audit because their locations were outside the Halifax-metro publication scope.</p>` : ""}${failedSourceCount ? `<p>${failedSourceCount} source${failedSourceCount === 1 ? "" : "s"} reported a refresh warning.</p>` : ""}</div>
        <div class="source-card event-capability-card"><h2>Plan from the listing</h2><p>Save events on this device or create an .ics calendar file directly from any event card. No account is required.</p></div>
      </aside>
    </section>`;

  bindExpandedCityEventActions();
  bindCommonActions();
};

cityEventCard = function cityEventCardWithActions(event) {
  const date = new Date(event.startAt);
  const month = date.toLocaleDateString("en-CA", { month: "short", timeZone: HALIFAX_EVENT_TIME_ZONE }).toUpperCase();
  const day = date.toLocaleDateString("en-CA", { day: "numeric", timeZone: HALIFAX_EVENT_TIME_ZONE });
  const primaryCategory = event.categories?.[0] || "Event";
  const tags = [...new Set([primaryCategory, ...(event.categories || []).slice(1, 3)])];
  const source = safeUrl(event.eventUrl) || safeUrl(event.ticketUrl) || safeUrl(event.sourceUrl);
  const eventId = String(event.id || `${event.title}-${event.startAt}`);
  const saved = savedCityEvents.has(eventId);
  const priceLabel = event.price ? String(event.price) : "Price not listed";
  const city = eventCityName(event);
  return `<article class="event-card" data-event-id="${escapeHtml(eventId)}" data-event-categories="${escapeHtml((event.categories || []).join("|"))}" data-event-city="${escapeHtml(city)}" data-event-cost="${escapeHtml(eventCostKind(event))}">
    <div class="event-date"><span>${escapeHtml(month)}</span><strong>${escapeHtml(day)}</strong></div>
    <div class="event-thumb media-dining"></div>
    <div class="event-copy"><div class="event-title-line"><h3>${escapeHtml(event.title)}</h3><span>${escapeHtml(primaryCategory)}</span></div><p>${escapeHtml(event.venueName || event.address || city)}</p><small>${escapeHtml(structuredEventWhen(event))} · ${escapeHtml(city)} · ${escapeHtml(priceLabel)}</small><div class="card-tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}<span>${escapeHtml(event.sourceName || "Source")}</span></div></div>
    <div class="event-card-actions">${source ? `<a class="button tertiary" href="${escapeHtml(source)}" target="_blank" rel="noreferrer">Source ↗</a>` : ""}<button class="button tertiary ${saved ? "is-saved" : ""}" type="button" data-save-event-id="${escapeHtml(eventId)}" aria-pressed="${saved}" aria-label="${saved ? "Remove" : "Save"} ${escapeHtml(event.title)}">${saved ? "♥ Saved" : "♡ Save"}</button><button class="button tertiary" type="button" data-event-calendar="${escapeHtml(eventId)}">+ Calendar</button></div>
  </article>`;
};

function bindExpandedCityEventActions() {
  for (const button of document.querySelectorAll("[data-event-category]")) {
    button.addEventListener("click", () => {
      cityEventState.category = button.dataset.eventCategory || "All";
      cityEventState.page = 1;
      replaceEventHash();
      renderEvents();
    });
  }

  for (const button of document.querySelectorAll("[data-event-window]")) {
    button.addEventListener("click", () => {
      cityEventState.windowDays = button.dataset.eventWindow || "all";
      cityEventState.page = 1;
      replaceEventHash();
      renderEvents();
    });
  }

  const selectBindings = [
    ["#eventCityFilter", "city"],
    ["#eventCostFilter", "cost"],
    ["#eventTimeFilter", "time"],
    ["#eventAccessFilter", "access"],
    ["#eventSourceFilter", "source"],
    ["#eventSortFilter", "sort"]
  ];
  for (const [selector, key] of selectBindings) {
    document.querySelector(selector)?.addEventListener("change", (event) => {
      cityEventState[key] = event.target.value || DEFAULT_EVENT_FILTERS[key];
      cityEventState.page = 1;
      replaceEventHash();
      renderEvents();
    });
  }

  document.querySelector("#eventSavedFilter")?.addEventListener("change", (event) => {
    cityEventState.savedOnly = Boolean(event.target.checked);
    cityEventState.page = 1;
    replaceEventHash();
    renderEvents();
  });

  document.querySelector("[data-event-search-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    cityEventState.query = event.currentTarget.querySelector("input")?.value.trim() || "";
    cityEventState.page = 1;
    replaceEventHash();
    renderEvents();
  });

  document.querySelector("[data-event-clear]")?.addEventListener("click", () => {
    resetCityEventFilters();
    renderEvents();
  });

  document.querySelector("[data-event-load-more]")?.addEventListener("click", () => {
    cityEventState.page += 1;
    renderEvents();
  });

  for (const button of document.querySelectorAll("[data-save-event-id]")) {
    button.addEventListener("click", () => {
      const id = String(button.dataset.saveEventId || "");
      if (!id) return;
      if (savedCityEvents.has(id)) savedCityEvents.delete(id); else savedCityEvents.add(id);
      persistSavedCityEvents();
      if (cityEventState.savedOnly && !savedCityEvents.has(id)) {
        renderEvents();
        return;
      }
      const saved = savedCityEvents.has(id);
      button.classList.toggle("is-saved", saved);
      button.setAttribute("aria-pressed", String(saved));
      button.textContent = saved ? "♥ Saved" : "♡ Save";
      toast(saved ? "Event saved on this device" : "Event removed from saved");
    });
  }

  for (const button of document.querySelectorAll("[data-event-calendar]")) {
    button.addEventListener("click", () => {
      const id = String(button.dataset.eventCalendar || "");
      const event = cityEvents.find((item) => String(item.id || `${item.title}-${item.startAt}`) === id);
      if (!event) return;
      downloadEventCalendar(event);
      toast("Calendar file created");
    });
  }
}

function icsEscape(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function icsUtc(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function downloadEventCalendar(event) {
  const start = icsUtc(event.startAt);
  if (!start) return;
  const end = icsUtc(event.endAt || event.startAt) || start;
  const source = safeUrl(event.eventUrl) || safeUrl(event.ticketUrl) || safeUrl(event.sourceUrl) || "";
  const uid = `${String(event.id || event.title || "event").replace(/[^a-z0-9-]+/gi, "-")}@halifaxsourced`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Halifax Sourced//Events//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${icsEscape(uid)}`,
    `DTSTAMP:${icsUtc(new Date())}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${icsEscape(event.title)}`,
    `LOCATION:${icsEscape(event.venueName || event.address || eventCityName(event))}`,
    `DESCRIPTION:${icsEscape(`Source: ${event.sourceName || "Halifax Sourced"}${source ? ` - ${source}` : ""}`)}`,
    source ? `URL:${icsEscape(source)}` : null,
    "END:VEVENT",
    "END:VCALENDAR"
  ].filter(Boolean);
  const blob = new Blob([`${lines.join("\r\n")}\r\n`], { type: "text/calendar;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = `${String(event.title || "halifax-event").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 70) || "halifax-event"}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
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

function syncGlobalSearchContext() {
  if (!globalSearch) return;
  if (route().name === "events") {
    globalSearch.placeholder = "Search events, venues, categories, or organizers…";
    globalSearch.value = cityEventState.query || "";
  } else {
    globalSearch.placeholder = "Search restaurants, cuisines, events, or neighbourhoods…";
  }
}

searchForm?.addEventListener("submit", (event) => {
  if (route().name !== "events") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  cityEventState.query = globalSearch?.value.trim() || "";
  cityEventState.page = 1;
  replaceEventHash();
  renderEvents();
}, true);

window.addEventListener("hashchange", () => setTimeout(syncGlobalSearchContext, 0));
syncGlobalSearchContext();
