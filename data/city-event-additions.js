"use strict";

window.HALIFAX_CITY_EVENT_ADDITIONS = {
  "version": 1,
  "generatedAt": "2026-09-11T15:00:00.000Z",
  "policy": "Curated city-event additions are source-backed records used when current official or local calendars have not yet been promoted into the primary city-events build.",
  "sources": [
    {
      "sourceId": "taste-asia-official",
      "sourceName": "Taste Asia",
      "sourceUrl": "https://tasteasia.ca/",
      "authority": "official_primary"
    },
    {
      "sourceId": "discover-halifax-taste-asia-2026",
      "sourceName": "Discover Halifax",
      "sourceUrl": "https://discoverhalifaxns.com/event/taste-asia-2026/",
      "authority": "local_tourism_directory"
    },
    {
      "sourceId": "downtown-halifax-taste-asia-2026",
      "sourceName": "Downtown Halifax Business Commission",
      "sourceUrl": "https://downtownhalifax.ca/event/taste-asia-festival-2026",
      "authority": "local_business_district_directory"
    },
    {
      "sourceId": "eventbrite-taste-asia-2026",
      "sourceName": "Eventbrite",
      "sourceUrl": "https://www.eventbrite.com/e/taste-asia-2026-4-days-food-culture-music-celebrationsep-10-13-tickets-1999327820331",
      "authority": "ticketing_directory"
    }
  ],
  "events": [
    {
      "id": "taste-asia-2026-food-culture-festival",
      "title": "Taste Asia 2026",
      "startAt": "2026-09-10",
      "endAt": "2026-09-13",
      "allDay": true,
      "venueName": "Waterfront Salter Lot",
      "address": "1521 Lower Water Street, Halifax, NS B3J 1R9",
      "city": "Halifax",
      "categories": [
        "Food & Drink",
        "Festivals",
        "Arts",
        "Music",
        "Community",
        "Outdoor",
        "Family"
      ],
      "price": "Free general admission; selected programs may require tickets",
      "ticketUrl": "https://www.eventbrite.com/e/taste-asia-2026-4-days-food-culture-music-celebrationsep-10-13-tickets-1999327820331",
      "eventUrl": "https://tasteasia.ca/",
      "sourceUrl": "https://tasteasia.ca/",
      "sourceId": "taste-asia-2026",
      "sourceName": "Taste Asia 2026",
      "sourceKind": "official_festival_page",
      "observedAt": "2026-09-11T15:00:00.000Z",
      "reviewState": "source_observed",
      "venueId": "waterfront-salter-lot-halifax",
      "neighbourhood": "Waterfront",
      "organizerId": "taste-asia-fest",
      "organizerName": "Taste Asia Fest",
      "alternateSources": [
        {
          "sourceId": "discover-halifax-taste-asia-2026",
          "sourceName": "Discover Halifax",
          "sourceUrl": "https://discoverhalifaxns.com/event/taste-asia-2026/"
        },
        {
          "sourceId": "downtown-halifax-taste-asia-2026",
          "sourceName": "Downtown Halifax Business Commission",
          "sourceUrl": "https://downtownhalifax.ca/event/taste-asia-festival-2026"
        },
        {
          "sourceId": "eventbrite-taste-asia-2026",
          "sourceName": "Eventbrite",
          "sourceUrl": "https://www.eventbrite.com/e/taste-asia-2026-4-days-food-culture-music-celebrationsep-10-13-tickets-1999327820331"
        }
      ],
      "sourceEvidence": [
        {
          "sourceId": "taste-asia-official",
          "sourceName": "Taste Asia",
          "sourceUrl": "https://tasteasia.ca/",
          "basis": "official_primary",
          "observedFacts": [
            "Dates: September 10-13, 2026",
            "Venue: Waterfront Salter Lot, 1521 Lower Water St, Halifax",
            "Admission: free general admission"
          ]
        },
        {
          "sourceId": "discover-halifax-taste-asia-2026",
          "sourceName": "Discover Halifax",
          "sourceUrl": "https://discoverhalifaxns.com/event/taste-asia-2026/",
          "basis": "tourism_directory_corroboration",
          "observedFacts": [
            "Dates: September 10-13, 2026",
            "Venue: Waterfront Salter Lot",
            "Categories include Food & Drink, Free, Music and Signature Major Events"
          ]
        },
        {
          "sourceId": "downtown-halifax-taste-asia-2026",
          "sourceName": "Downtown Halifax Business Commission",
          "sourceUrl": "https://downtownhalifax.ca/event/taste-asia-festival-2026",
          "basis": "district_directory_corroboration",
          "observedFacts": [
            "Dates: September 10-13, 2026",
            "Location: Salter Lot, Halifax Waterfront"
          ]
        },
        {
          "sourceId": "eventbrite-taste-asia-2026",
          "sourceName": "Eventbrite",
          "sourceUrl": "https://www.eventbrite.com/e/taste-asia-2026-4-days-food-culture-music-celebrationsep-10-13-tickets-1999327820331",
          "basis": "ticketing_corroboration",
          "observedFacts": [
            "Dates: September 10-13, 2026",
            "Location: Salter Lot, 1521 Lower Water Street, Halifax"
          ]
        }
      ]
    }
  ]
};

(function applyCityEventAdditions() {
  const additions = window.HALIFAX_CITY_EVENT_ADDITIONS;
  const payload = window.HALIFAX_CITY_EVENTS;
  if (!payload || !Array.isArray(payload.events) || !Array.isArray(additions?.events)) return;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalize(value) {
    return String(value ?? "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function eventDateKey(value) {
    const text = String(value ?? "").trim();
    const dateOnly = /^(\d{4}-\d{2}-\d{2})$/.exec(text);
    if (dateOnly) return dateOnly[1];
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
  }

  function eventKey(event) {
    return [
      normalize(event?.title),
      eventDateKey(event?.startAt),
      normalize(event?.venueName || event?.address || event?.city || "halifax")
    ].join("|");
  }

  function uniqueBy(items, keyFn) {
    const seen = new Set();
    const unique = [];
    for (const item of items || []) {
      const key = keyFn(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }
    return unique;
  }

  function mergeEvents(existing, addition) {
    const merged = { ...clone(addition), ...existing };
    merged.categories = uniqueBy([...(addition.categories || []), ...(existing.categories || [])], (value) => String(value || ""));
    merged.alternateSources = uniqueBy([...(existing.alternateSources || []), ...(addition.alternateSources || [])], (source) => `${source?.sourceId || ""}|${source?.sourceUrl || ""}`);
    merged.sourceEvidence = uniqueBy([...(existing.sourceEvidence || []), ...(addition.sourceEvidence || [])], (source) => `${source?.sourceId || ""}|${source?.basis || ""}|${source?.sourceUrl || ""}`);
    return merged;
  }

  function sortEvents(a, b) {
    const startA = Date.parse(String(a.startAt || ""));
    const startB = Date.parse(String(b.startAt || ""));
    const timeA = Number.isFinite(startA) ? startA : Number.POSITIVE_INFINITY;
    const timeB = Number.isFinite(startB) ? startB : Number.POSITIVE_INFINITY;
    return timeA - timeB || String(a.title || "").localeCompare(String(b.title || ""));
  }

  const events = payload.events.slice();
  const byId = new Map();
  const byKey = new Map();
  events.forEach((event, index) => {
    if (event?.id) byId.set(String(event.id), index);
    const key = eventKey(event);
    if (key) byKey.set(key, index);
  });

  const addedIds = [];
  const mergedIds = [];
  for (const addition of additions.events) {
    const id = addition?.id ? String(addition.id) : "";
    const key = eventKey(addition);
    const index = byId.has(id) ? byId.get(id) : byKey.get(key);
    if (Number.isInteger(index)) {
      events[index] = mergeEvents(events[index], addition);
      mergedIds.push(events[index].id || id || key);
      continue;
    }
    const next = clone(addition);
    const nextIndex = events.push(next) - 1;
    if (id) byId.set(id, nextIndex);
    if (key) byKey.set(key, nextIndex);
    addedIds.push(id || key);
  }

  const sorted = events.sort(sortEvents);
  payload.events.splice(0, payload.events.length, ...sorted);
  payload.eventCount = payload.events.length;
  payload.categoryCounts = payload.events.reduce((counts, event) => {
    for (const category of event.categories || []) counts[category] = (counts[category] || 0) + 1;
    return counts;
  }, {});

  const additionSourceIds = new Set(additions.events.map((event) => event.sourceId).filter(Boolean));
  const existingStats = Array.isArray(payload.sourceStats) ? payload.sourceStats.filter((stat) => !additionSourceIds.has(stat.sourceId)) : [];
  const additionStats = [...additionSourceIds].map((sourceId) => {
    const sourceEvents = additions.events.filter((event) => event.sourceId === sourceId);
    const sample = sourceEvents[0] || {};
    return {
      sourceId,
      sourceName: sample.sourceName || sourceId,
      mode: sample.sourceKind || "curated_city_event_addition",
      observedAt: sample.observedAt || additions.generatedAt,
      eventCount: sourceEvents.length,
      durationMs: 0,
      status: "ok"
    };
  });
  payload.sourceStats = [...existingStats, ...additionStats];
  payload.manualAdditions = {
    ...(payload.manualAdditions || {}),
    appliedAt: new Date().toISOString(),
    source: "data/city-event-additions.js",
    eventCount: additions.events.length,
    addedIds,
    mergedIds
  };
})();
