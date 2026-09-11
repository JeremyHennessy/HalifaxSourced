"use strict";

(function installEventLocalSortFixes() {
  const dateDebug = window.__halifaxEventDateDebug || {};
  if (typeof dateDebug.eventStartInstant !== "function" || typeof dateDebug.eventBoundaryKey !== "function") return;

  function partsFromKey(key) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""));
    if (!match) return null;
    return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  }

  function keyFromParts(parts) {
    if (!parts) return null;
    return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  }

  function keyFromDate(value) {
    const parts = halifaxDateParts(value);
    return keyFromParts(parts);
  }

  function instantFromParts(parts, hour = 12) {
    return parts ? new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hour)) : null;
  }

  function compareTitle(a, b) {
    return String(a.title || "").localeCompare(String(b.title || ""));
  }

  function compareVenue(a, b) {
    return String(a.venueName || a.address || "").localeCompare(String(b.venueName || b.address || "")) || compareTitle(a, b);
  }

  function eventEffectiveSortInstant(event) {
    const start = dateDebug.eventStartInstant(event);
    const end = typeof dateDebug.eventEndInstant === "function" ? dateDebug.eventEndInstant(event) || start : start;
    const todayKey = keyFromDate(new Date());
    const startKey = dateDebug.eventBoundaryKey(event, "startAt");
    const endKey = dateDebug.eventBoundaryKey(event, "endAt") || startKey;

    if (todayKey && startKey && endKey && startKey < todayKey && endKey >= todayKey) {
      if (start && end && start.getTime() <= Date.now() && end.getTime() >= Date.now()) return new Date();
      return instantFromParts(partsFromKey(todayKey), event?.allDay ? 12 : 0);
    }

    return start;
  }

  function compareSoonest(a, b) {
    const timeA = eventEffectiveSortInstant(a)?.getTime() ?? Number.POSITIVE_INFINITY;
    const timeB = eventEffectiveSortInstant(b)?.getTime() ?? Number.POSITIVE_INFINITY;
    return timeA - timeB || compareTitle(a, b);
  }

  function compareLatest(a, b) {
    const timeA = dateDebug.eventStartInstant(a)?.getTime() ?? Number.NEGATIVE_INFINITY;
    const timeB = dateDebug.eventStartInstant(b)?.getTime() ?? Number.NEGATIVE_INFINITY;
    return timeB - timeA || compareTitle(a, b);
  }

  function compareForCurrentSort(a, b) {
    if (cityEventState.sort === "latest") return compareLatest(a, b);
    if (cityEventState.sort === "title") return compareTitle(a, b);
    if (cityEventState.sort === "venue") return compareVenue(a, b);
    return compareSoonest(a, b);
  }

  const baseActiveCityEvents = typeof activeCityEvents === "function" ? activeCityEvents : null;
  if (baseActiveCityEvents) {
    activeCityEvents = function activeCityEventsWithEffectiveLocalSort() {
      return baseActiveCityEvents().slice().sort(compareSoonest);
    };
  }

  const baseActiveStructuredEvents = typeof activeStructuredEvents === "function" ? activeStructuredEvents : null;
  if (baseActiveStructuredEvents) {
    activeStructuredEvents = function activeStructuredEventsWithEffectiveLocalSort() {
      return baseActiveStructuredEvents().slice().sort(compareSoonest);
    };
  }

  const baseFilteredCityEvents = typeof filteredCityEvents === "function" ? filteredCityEvents : null;
  if (baseFilteredCityEvents) {
    filteredCityEvents = function filteredCityEventsWithEffectiveLocalSort(allItems) {
      return baseFilteredCityEvents(allItems).slice().sort(compareForCurrentSort);
    };
  }

  function compareParts(a, b) {
    return Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day);
  }

  function addDays(parts, days) {
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
  }

  function eventCalendarDayKeys(event) {
    const startKey = dateDebug.eventBoundaryKey(event, "startAt");
    const endKey = dateDebug.eventBoundaryKey(event, "endAt") || startKey;
    const start = partsFromKey(startKey);
    let end = partsFromKey(endKey) || start;
    if (!start) return [];
    if (!end || compareParts(end, start) < 0) end = start;

    const keys = [];
    let cursor = start;
    for (let dayOffset = 0; dayOffset < 370 && compareParts(cursor, end) <= 0; dayOffset += 1) {
      keys.push(keyFromParts(cursor));
      cursor = addDays(cursor, 1);
    }
    return keys;
  }

  simpleCalendar = function simpleCalendarWithDateRanges(events = []) {
    const today = halifaxDateParts(new Date());
    const year = today?.year || new Date().getUTCFullYear();
    const month = today?.month || new Date().getUTCMonth() + 1;
    const day = today?.day || new Date().getUTCDate();
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthLabel = monthStart.toLocaleDateString("en-CA", { month: "long", year: "numeric", timeZone: "UTC" });
    const blanks = monthStart.getUTCDay();
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const eventDays = new Set();
    for (const event of events) {
      for (const key of eventCalendarDayKeys(event)) {
        const parts = partsFromKey(key);
        if (parts && parts.year === year && parts.month === month) eventDays.add(parts.day);
      }
    }
    const cells = [...Array(blanks).fill(""), ...Array.from({ length: days }, (_, i) => String(i + 1))];
    return `<div class="calendar-heading"><span></span><h2>${escapeHtml(monthLabel)}</h2></div><div class="calendar-week"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div><div class="calendar-grid">${cells.map((cell) => `<span class="${Number(cell) === day ? "today" : ""}"${eventDays.has(Number(cell)) ? ' title="Event available"' : ""}>${eventDays.has(Number(cell)) ? "*" : ""}${cell}</span>`).join("")}</div><p>${events.length ? "Markers show event dates in the current month." : "No structured city event dates are loaded yet."}</p>`;
  };

  window.__halifaxEventDateDebug = {
    ...dateDebug,
    eventEffectiveSortInstant,
    eventLocalSortKey(event) {
      return keyFromDate(eventEffectiveSortInstant(event));
    },
    eventCalendarDayKeys
  };
})();
