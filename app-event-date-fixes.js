"use strict";

(function installEventDateFixes() {
  const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  const UTC_MIDNIGHT_RE = /T00:00(?::00(?:\.000)?)?Z$/;

  function parseDateOnlyParts(value) {
    const match = DATE_ONLY_RE.exec(String(value || ""));
    if (!match) return null;
    return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  }

  function utcDateParts(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
  }

  function formatPartsKey(parts) {
    if (!parts) return null;
    return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  }

  function dateForDisplayParts(parts) {
    return parts ? new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 15)) : null;
  }

  function eventBoundaryParts(event, field) {
    const value = event?.[field] || (field === "endAt" ? event?.startAt : null);
    const dateOnly = parseDateOnlyParts(value);
    if (dateOnly) return dateOnly;
    if (event?.allDay && UTC_MIDNIGHT_RE.test(String(value || ""))) return utcDateParts(value);
    return halifaxDateParts(value);
  }

  function eventBoundaryKey(event, field) {
    return formatPartsKey(eventBoundaryParts(event, field));
  }

  function instantFromParts(parts, hour = 12) {
    return parts ? new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hour)) : null;
  }

  function eventStartInstant(event) {
    const parts = eventBoundaryParts(event, "startAt");
    if (event?.allDay || parseDateOnlyParts(event?.startAt)) return instantFromParts(parts, 12);
    const date = new Date(event?.startAt);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function eventEndInstant(event) {
    const endValue = event?.endAt || event?.startAt;
    const parts = eventBoundaryParts(event, "endAt");
    if (event?.allDay || parseDateOnlyParts(endValue)) {
      return parts ? new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1, 8)) : null;
    }
    const date = new Date(endValue);
    return Number.isNaN(date.getTime()) ? eventStartInstant(event) : date;
  }

  function eventSortCompare(a, b) {
    const startA = eventStartInstant(a)?.getTime() ?? Number.POSITIVE_INFINITY;
    const startB = eventStartInstant(b)?.getTime() ?? Number.POSITIVE_INFINITY;
    return startA - startB || String(a.title || "").localeCompare(String(b.title || ""));
  }

  function eventDateWindowRange(windowValue, todayParts = halifaxDateParts(new Date())) {
    const value = String(windowValue || "all");
    if (value === "all") return null;
    if (!todayParts) return null;
    const todayKey = formatPartsKey(todayParts);

    if (value === "today") return { startKey: todayKey, endKey: todayKey };

    if (value === "weekend") {
      const localDate = new Date(Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day));
      const weekday = localDate.getUTCDay();
      const toFriday = weekday === 5 ? 0 : weekday === 6 ? -1 : weekday === 0 ? -2 : 5 - weekday;
      const friday = addDaysToHalifaxParts(todayParts, toFriday);
      const sunday = addDaysToHalifaxParts(friday, 2);
      return { startKey: formatPartsKey(friday), endKey: formatPartsKey(sunday) };
    }

    const days = Number(value);
    if (!Number.isFinite(days) || days < 1) return null;
    const end = addDaysToHalifaxParts(todayParts, days);
    return { startKey: todayKey, endKey: formatPartsKey(end) };
  }

  function durationDaysBetween(startParts, endParts) {
    if (!startParts || !endParts) return null;
    const days = Math.round((Date.UTC(endParts.year, endParts.month - 1, endParts.day) - Date.UTC(startParts.year, startParts.month - 1, startParts.day)) / 86400000) + 1;
    return Number.isFinite(days) ? Math.max(1, days) : null;
  }

  function eventInclusiveDurationDaysWithLocalDates(event) {
    const start = eventBoundaryParts(event, "startAt");
    const end = eventBoundaryParts(event, "endAt") || start;
    return durationDaysBetween(start, end);
  }

  function eventIsLongRunningWithLocalDates(event) {
    const days = eventInclusiveDurationDaysWithLocalDates(event);
    return Number.isFinite(days) && days > 7;
  }

  function eventDurationKindWithLocalDates(event) {
    return eventIsLongRunningWithLocalDates(event) ? "long" : "short";
  }

  function eventLooksLikeSportsSeasonWithLocalDates(event) {
    const title = String(event?.title || "");
    const categories = Array.isArray(event?.categories) ? event.categories : [];
    const sports = categories.includes("Sports") || /official_.*sports|sports_schedule/i.test(String(event?.sourceKind || ""));
    if (!sports || !/\bseason\b|season ticket|home schedule/i.test(title) || !eventIsLongRunningWithLocalDates(event)) return false;
    return !/\b(vs\.?|v\.?|versus)\b|\s(?:at|@)\s|\bhome opener\b|\bmatch(day)?\b|\bgame\s+\d+\b/i.test(` ${title} `);
  }

  function eventShortDateLabel(parts, options = {}) {
    const date = dateForDisplayParts(parts);
    if (!date) return "TBD";
    return date.toLocaleDateString("en-CA", {
      weekday: options.weekday ? "short" : undefined,
      month: "short",
      day: "numeric",
      timeZone: HALIFAX_EVENT_TIME_ZONE
    });
  }

  function eventIsOngoingToday(event) {
    const todayKey = formatPartsKey(halifaxDateParts(new Date()));
    const startKey = eventBoundaryKey(event, "startAt");
    const endKey = eventBoundaryKey(event, "endAt") || startKey;
    return Boolean(todayKey && startKey && endKey && startKey <= todayKey && endKey >= todayKey);
  }

  halifaxDateParts = function halifaxDatePartsWithDateOnly(value) {
    const dateOnly = parseDateOnlyParts(value);
    if (dateOnly) return dateOnly;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: HALIFAX_EVENT_TIME_ZONE, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(date);
    const get = (type) => Number(parts.find((part) => part.type === type)?.value);
    return { year: get("year"), month: get("month"), day: get("day") };
  };

  if (typeof halifaxDateKey === "function") {
    halifaxDateKey = function halifaxDateKeyWithDateOnly(value) {
      return formatPartsKey(halifaxDateParts(value));
    };
  }

  activeCityEvents = function activeCityEventsWithLocalDates() {
    const cutoff = Date.now() - 30 * 60 * 1000;
    return cityEvents
      .filter((event) => {
        const start = eventStartInstant(event);
        const end = eventEndInstant(event) || start;
        return Boolean(start) && Boolean(end) && end.getTime() >= cutoff;
      })
      .sort(eventSortCompare);
  };

  activeStructuredEvents = function activeStructuredEventsWithLocalDates() {
    const cutoff = Date.now() - 30 * 60 * 1000;
    return structuredEvents
      .filter((event) => {
        const start = eventStartInstant(event);
        const end = eventEndInstant(event) || start;
        return Boolean(start) && Boolean(end) && end.getTime() >= cutoff;
      })
      .sort(eventSortCompare);
  };

  if (typeof eventOverlapsDateRange === "function") {
    eventOverlapsDateRange = function eventOverlapsDateRangeWithLocalDates(event, startKey, endKey) {
      const start = eventBoundaryKey(event, "startAt");
      const end = eventBoundaryKey(event, "endAt") || start;
      if (!start || !end) return false;
      return end >= startKey && start <= endKey;
    };
  }

  if (typeof cityEventsForWindow === "function") {
    cityEventsForWindow = function cityEventsForWindowWithInclusiveFutureDates(items) {
      const range = eventDateWindowRange(cityEventState.windowDays);
      if (!range) return items;
      return items.filter((event) => eventOverlapsDateRange(event, range.startKey, range.endKey));
    };
  }

  eventInclusiveDurationDays = eventInclusiveDurationDaysWithLocalDates;
  eventIsLongRunning = eventIsLongRunningWithLocalDates;
  eventDurationKind = eventDurationKindWithLocalDates;
  eventLooksLikeSportsSeason = eventLooksLikeSportsSeasonWithLocalDates;
  isDiscoverableCityEvent = function isDiscoverableCityEventWithSportsGamePolicy(event) {
    return !eventLooksLikeSportsSeasonWithLocalDates(event);
  };

  if (typeof eventTimeKind === "function") {
    eventTimeKind = function eventTimeKindWithDateOnly(event) {
      if (event?.allDay || parseDateOnlyParts(event?.startAt)) return "all-day";
      const date = eventStartInstant(event);
      if (!date) return "unknown";
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
    };
  }

  structuredEventWhen = function structuredEventWhenWithLocalDates(event) {
    const start = eventStartInstant(event);
    if (!start) return "Date unavailable";
    const startParts = eventBoundaryParts(event, "startAt");
    const endParts = eventBoundaryParts(event, "endAt") || startParts;
    const startKey = formatPartsKey(startParts);
    const endKey = formatPartsKey(endParts);
    const isDateOnly = Boolean(event?.allDay || parseDateOnlyParts(event?.startAt));

    if (eventIsLongRunningWithLocalDates(event) && startKey && endKey) {
      const endLabel = eventShortDateLabel(endParts, { weekday: true });
      if (eventIsOngoingToday(event)) return `Ongoing through ${endLabel}`;
      return `Runs ${eventShortDateLabel(startParts, { weekday: true })} - ${endLabel}`;
    }

    const displayDate = isDateOnly ? dateForDisplayParts(startParts) : start;
    const date = displayDate.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: HALIFAX_EVENT_TIME_ZONE });
    if (isDateOnly) {
      if (!endKey || endKey === startKey) return date;
      const endLabel = eventShortDateLabel(endParts, { weekday: true });
      return `${date} - ${endLabel}`;
    }
    const time = start.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", timeZone: HALIFAX_EVENT_TIME_ZONE, timeZoneName: "short" });
    return `${date} - ${time}`;
  };

  eventDateBadge = function eventDateBadgeWithLocalDates(event) {
    const startParts = eventBoundaryParts(event, "startAt");
    const displayDate = dateForDisplayParts(startParts) || eventStartInstant(event);
    if (!displayDate) return { label: "DATE", primary: "TBD", className: "" };
    if (eventIsLongRunningWithLocalDates(event)) {
      const endParts = eventBoundaryParts(event, "endAt") || startParts;
      const startLabel = eventShortDateLabel(startParts);
      const endLabel = eventShortDateLabel(endParts);
      if (eventIsOngoingToday(event)) return { label: "ONGOING", primary: "Until", secondary: endLabel, className: "is-long-running" };
      return { label: "RUNS", primary: startLabel, secondary: `to ${endLabel}`, className: "is-long-running" };
    }
    return {
      label: displayDate.toLocaleDateString("en-CA", { month: "short", timeZone: HALIFAX_EVENT_TIME_ZONE }).toUpperCase(),
      primary: displayDate.toLocaleDateString("en-CA", { day: "numeric", timeZone: HALIFAX_EVENT_TIME_ZONE }),
      className: ""
    };
  };

  cityEventCard = function cityEventCardWithLocalDates(event) {
    const badge = eventDateBadge(event);
    const primaryCategory = event.categories?.[0] || "Event";
    const tags = [...new Set([primaryCategory, ...(event.categories || []).slice(1, 3), eventIsLongRunning(event) ? "Long-running" : null].filter(Boolean))];
    const source = safeUrl(event.eventUrl) || safeUrl(event.ticketUrl) || safeUrl(event.sourceUrl);
    const eventId = String(event.id || `${event.title}-${event.startAt}`);
    const saved = savedCityEvents.has(eventId);
    const priceLabel = event.price ? String(event.price) : "Price not listed";
    const city = eventCityName(event);
    return `<article class="event-card" data-event-id="${escapeHtml(eventId)}" data-event-categories="${escapeHtml((event.categories || []).join("|"))}" data-event-city="${escapeHtml(city)}" data-event-cost="${escapeHtml(eventCostKind(event))}" data-event-duration="${escapeHtml(eventDurationKind(event))}">
    <div class="event-date ${escapeHtml(badge.className || "")}"><span>${escapeHtml(badge.label)}</span><strong>${escapeHtml(badge.primary)}</strong>${badge.secondary ? `<em>${escapeHtml(badge.secondary)}</em>` : ""}</div>
    <div class="event-thumb media-dining"></div>
    <div class="event-copy"><div class="event-title-line"><h3>${escapeHtml(event.title)}</h3><span>${escapeHtml(primaryCategory)}</span></div><p>${escapeHtml(event.venueName || event.address || city)}</p><small>${escapeHtml(structuredEventWhen(event))} - ${escapeHtml(city)} - ${escapeHtml(priceLabel)}</small><div class="card-tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}<span>${escapeHtml(event.sourceName || "Source")}</span></div></div>
    <div class="event-card-actions">${source ? `<a class="button tertiary" href="${escapeHtml(source)}" target="_blank" rel="noreferrer">Source</a>` : ""}<button class="button tertiary ${saved ? "is-saved" : ""}" type="button" data-save-event-id="${escapeHtml(eventId)}" aria-pressed="${saved}" aria-label="${saved ? "Remove" : "Save"} ${escapeHtml(event.title)}">${saved ? "Saved" : "Save"}</button><button class="button tertiary" type="button" data-event-calendar="${escapeHtml(eventId)}">Calendar</button></div>
  </article>`;
  };

  structuredEventCard = function structuredEventCardWithLocalDates(event) {
    const restaurant = restaurants.find((item) => item.id === event.restaurantId);
    const badge = eventDateBadge(event);
    const source = safeUrl(event.eventUrl) || safeUrl(event.sourceUrl);
    return `<article class="event-card" data-event-duration="${escapeHtml(eventDurationKind(event))}"><div class="event-date ${escapeHtml(badge.className || "")}"><span>${escapeHtml(badge.label)}</span><strong>${escapeHtml(badge.primary)}</strong>${badge.secondary ? `<em>${escapeHtml(badge.secondary)}</em>` : ""}</div><div class="event-thumb media-${restaurant ? mediaTone(restaurant) : "dining"}${restaurant ? permittedImageClass(restaurant) : ""}">${restaurant ? mediaImageMarkup(restaurant) : ""}</div><div class="event-copy"><div class="event-title-line"><h3>${escapeHtml(event.title)}</h3><span>${escapeHtml(String(event.eventType || "Event").replace(/Event$/, "") || "Event")}</span></div><p>${escapeHtml(event.venueName || restaurant?.name || "Halifax")}</p><small>${escapeHtml(structuredEventWhen(event))}${restaurant?.neighborhood ? ` - ${escapeHtml(restaurant.neighborhood)}` : ""}</small><div class="card-tags"><span>Structured date</span><span>Official source</span>${eventIsLongRunning(event) ? "<span>Long-running</span>" : ""}</div></div>${source ? `<a class="button tertiary" href="${escapeHtml(source)}" target="_blank" rel="noreferrer">Source</a>` : restaurant ? `<a class="button tertiary" href="#restaurant/${encodeURIComponent(restaurant.id)}">View</a>` : ""}</article>`;
  };

  simpleCalendar = function simpleCalendarWithLocalDates(events = []) {
    const today = halifaxDateParts(new Date());
    const year = today?.year || new Date().getUTCFullYear();
    const month = today?.month || new Date().getUTCMonth() + 1;
    const day = today?.day || new Date().getUTCDate();
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthLabel = monthStart.toLocaleDateString("en-CA", { month: "long", year: "numeric", timeZone: "UTC" });
    const blanks = monthStart.getUTCDay();
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const eventDays = new Set(events.map((event) => eventBoundaryParts(event, "startAt")).filter((parts) => parts && parts.month === month && parts.year === year).map((parts) => parts.day));
    const cells = [...Array(blanks).fill(""), ...Array.from({ length: days }, (_, i) => String(i + 1))];
    return `<div class="calendar-heading"><span></span><h2>${escapeHtml(monthLabel)}</h2></div><div class="calendar-week"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div><div class="calendar-grid">${cells.map((cell) => `<span class="${Number(cell) === day ? "today" : ""}"${eventDays.has(Number(cell)) ? ' title="Event available"' : ""}>${eventDays.has(Number(cell)) ? "*" : ""}${cell}</span>`).join("")}</div><p>${events.length ? "Markers show event dates in the current month." : "No structured city event dates are loaded yet."}</p>`;
  };

  icsUtc = function icsUtcWithDateOnly(value) {
    const dateOnly = parseDateOnlyParts(value);
    const date = dateOnly ? instantFromParts(dateOnly, 12) : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  };

  if (typeof homeRichSections === "function") {
    homeRichSections = function homeRichSectionsWithLocalEventDates() {
      const now = new Date();
      const today = formatPartsKey(halifaxDateParts(now));
      const tomorrow = formatPartsKey(addDaysToHalifaxParts(halifaxDateParts(now), 1));
      const events = (window.HALIFAX_CITY_EVENTS?.events || [])
        .filter((event) => typeof isDiscoverableCityEvent !== "function" || isDiscoverableCityEvent(event))
        .map((event) => ({ event, start: eventStartInstant(event) }))
        .filter((item) => item.start && item.start >= new Date(now.getTime() - 6 * 3600000) && !(item.event?.allDay || parseDateOnlyParts(item.event?.startAt)) && !eventIsLongRunningWithLocalDates(item.event))
        .sort((a, b) => a.start - b.start);
      const tonight = events
        .filter(({ start }) => {
          const key = formatPartsKey(halifaxDateParts(start));
          const mins = halifaxMinutes(start);
          return (key === today && mins >= 17 * 60) || (key === tomorrow && mins < 3 * 60);
        })
        .slice(0, 3).map((item) => item.event);
      const openPlaces = activeRestaurants.filter((r) => r.currentHoursState?.state === "open").sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 3);
      const recentlySourced = activeRestaurants
        .filter((restaurant) => restaurant.firstPartySources || restaurant.signal || restaurant.officialUpdates?.length)
        .sort((a, b) => sourceFreshnessStamp(b).localeCompare(sourceFreshnessStamp(a)) || (b.score || 0) - (a.score || 0))
        .slice(0, 4);
      const specials = currentSpecialCards(4);
      const reviewedPosts = Array.isArray(window.HALIFAX_REVIEWED_SOCIAL_POSTS?.records) ? window.HALIFAX_REVIEWED_SOCIAL_POSTS.records : [];
      const sourceLeadPosts = Array.isArray(recentOfficialPosts) ? recentOfficialPosts : [];
      const posts = (reviewedPosts.length ? reviewedPosts : sourceLeadPosts)
        .slice()
        .sort((a, b) => String(b.publishedAt || b.observedAt || "").localeCompare(String(a.publishedAt || a.observedAt || "")))
        .slice(0, 4);
      const thumbnailRestaurants = approvedThumbnailRestaurants(4);
      const sections = [];
      if (tonight.length) sections.push(`<section class="page-shell section-block home-action-section"><div class="section-heading"><div><span class="eyebrow">Tonight in Halifax</span><h2>What's happening tonight</h2></div><a href="#events">All events</a></div><div class="event-grid">${tonight.map(richEventCard).join("")}</div></section>`);
      if (openPlaces.length) sections.push(`<section class="page-shell section-block home-action-section"><div class="section-heading"><div><span class="eyebrow">Eat tonight</span><h2>Open now with fresh official hours</h2></div><a href="#explore">Explore</a></div><div class="restaurant-grid">${openPlaces.map((r, i) => restaurantCard(r, { index: i })).join("")}</div></section>`);
      if (recentlySourced.length) sections.push(`<section class="page-shell section-block home-action-section"><div class="section-heading"><div><span class="eyebrow">Recently sourced</span><h2>New source coverage</h2><p>Freshly indexed official websites, menus, social profiles, reservations, ordering links, and local discovery leads.</p></div><a href="#explore?sort=fresh">Explore fresh data</a></div><div class="fresh-data-grid">${recentlySourced.map(freshSourceCard).join("")}</div></section>`);
      if (specials.length) sections.push(`<section class="page-shell section-block home-action-section"><div class="section-heading"><div><span class="eyebrow">New specials</span><h2>Current verified offers</h2><p>Structured specials and source-backed offer pages, kept separate from unreviewed social leads.</p></div><a href="#specials">All specials</a></div><div class="restaurant-grid">${specials.join("")}</div></section>`);
      if (posts.length) sections.push(`<section class="page-shell section-block home-action-section"><div class="section-heading"><div><span class="eyebrow">Recent posts</span><h2>${reviewedPosts.length ? "Reviewed official updates" : "Latest official updates"}</h2><p>${reviewedPosts.length ? "Admin-approved post intelligence from restaurant-owned sources." : "Restaurant-owned feeds and, once Meta secrets are configured, Facebook and Instagram API observations awaiting review."}</p></div><a href="#admin/social">Review posts</a></div><div class="recent-post-grid">${posts.map(recentPostCard).join("")}</div></section>`);
      if (thumbnailRestaurants.length) sections.push(`<section class="page-shell section-block home-action-section"><div class="section-heading"><div><span class="eyebrow">New thumbnails added</span><h2>Restaurants with approved images</h2><p>Owner-reviewed official-site thumbnails now appear on cards and detail pages with source attribution.</p></div><a href="#admin/thumbnails">Thumbnail admin</a></div><div class="restaurant-grid">${thumbnailRestaurants.map((restaurant, index) => restaurantCard(restaurant, { index })).join("")}</div></section>`);
      return sections.join("");
    };
  }

  window.__halifaxEventDateDebug = {
    eventBoundaryKey,
    eventOverlapsDateRange,
    eventStartInstant,
    eventEndInstant,
    eventDateWindowRange,
    parseDateOnlyParts,
    structuredEventWhen,
    eventInclusiveDurationDays: eventInclusiveDurationDaysWithLocalDates,
    eventIsLongRunning: eventIsLongRunningWithLocalDates,
    eventDurationKind: eventDurationKindWithLocalDates,
    eventLooksLikeSportsSeason: eventLooksLikeSportsSeasonWithLocalDates,
    eventDateBadge
  };
})();