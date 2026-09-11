import { mkdir, readFile, writeFile } from "node:fs/promises";

const additionsUrl = new URL("../data/build/city-event-additions.json", import.meta.url);
const buildUrl = new URL("../data/build/city-events.json", import.meta.url);
const jsUrl = new URL("../data/city-events.js", import.meta.url);
const reportUrl = new URL("../artifacts/city-event-additions-report.json", import.meta.url);

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

function validUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function validDate(value) {
  return Number.isFinite(Date.parse(String(value ?? "")));
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

function validateAdditions(additions) {
  const errors = [];
  const sourceIds = new Set((additions.sources || []).map((source) => source.sourceId).filter(Boolean));
  const eventIds = new Set();

  if (!Array.isArray(additions.sources) || !additions.sources.length) errors.push("city-event-additions must include source definitions.");
  for (const source of additions.sources || []) {
    if (!source.sourceId || !source.sourceName || !validUrl(source.sourceUrl) || !source.authority) {
      errors.push(`invalid source definition: ${source.sourceId || source.sourceName || "<missing>"}`);
    }
  }

  if (!Array.isArray(additions.events) || !additions.events.length) errors.push("city-event-additions must include at least one event.");
  for (const event of additions.events || []) {
    if (!event.id || eventIds.has(event.id)) errors.push(`duplicate or missing event id: ${event.id || "<missing>"}`);
    eventIds.add(event.id);
    if (!event.title || !validDate(event.startAt) || !validDate(event.endAt || event.startAt)) errors.push(`invalid dates/title for ${event.id || "<missing>"}`);
    if (!event.city || !/\b(halifax|dartmouth|bedford)\b/i.test(`${event.city} ${event.address || ""} ${event.venueName || ""}`)) errors.push(`missing Halifax-metro location evidence for ${event.id || event.title || "<missing>"}`);
    if (!event.sourceId || !event.sourceName || !event.sourceKind || !validUrl(event.sourceUrl) || !event.observedAt) errors.push(`invalid source fields for ${event.id || event.title || "<missing>"}`);
    if (!Array.isArray(event.categories) || !event.categories.length) errors.push(`missing categories for ${event.id || event.title || "<missing>"}`);
    if (Object.hasOwn(event, "description") || Object.hasOwn(event, "body") || Object.hasOwn(event, "rawHtml") || Object.hasOwn(event, "content")) errors.push(`raw body field retained for ${event.id || event.title || "<missing>"}`);
    if (!Array.isArray(event.sourceEvidence) || !event.sourceEvidence.some((source) => source.basis === "official_primary" && validUrl(source.sourceUrl))) errors.push(`missing official-primary source evidence for ${event.id || event.title || "<missing>"}`);
    for (const source of [...(event.alternateSources || []), ...(event.sourceEvidence || [])]) {
      if (!source.sourceId || !source.sourceName || !validUrl(source.sourceUrl)) errors.push(`invalid linked source on ${event.id || event.title || "<missing>"}`);
      if (source.sourceId && source.sourceId !== event.sourceId && !sourceIds.has(source.sourceId)) errors.push(`linked source ${source.sourceId} on ${event.id || event.title || "<missing>"} is not declared.`);
    }
  }

  return errors;
}

function applyAdditions(payload, additions) {
  const events = Array.isArray(payload.events) ? payload.events.slice() : [];
  const byId = new Map();
  const byKey = new Map();
  events.forEach((event, index) => {
    if (event?.id) byId.set(String(event.id), index);
    const key = eventKey(event);
    if (key) byKey.set(key, index);
  });

  const addedIds = [];
  const mergedIds = [];
  for (const addition of additions.events || []) {
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

  const sortedEvents = events.sort(sortEvents);
  const categoryCounts = sortedEvents.reduce((counts, event) => {
    for (const category of event.categories || []) counts[category] = (counts[category] || 0) + 1;
    return counts;
  }, {});

  const additionSourceIds = new Set((additions.events || []).map((event) => event.sourceId).filter(Boolean));
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

  return {
    payload: {
      ...payload,
      eventCount: sortedEvents.length,
      categoryCounts,
      sourceStats: [...existingStats, ...additionStats],
      manualAdditions: {
        ...(payload.manualAdditions || {}),
        appliedAt: new Date().toISOString(),
        source: "data/build/city-event-additions.json",
        eventCount: additions.events.length,
        addedIds,
        mergedIds
      },
      events: sortedEvents
    },
    addedIds,
    mergedIds
  };
}

const additions = JSON.parse(await readFile(additionsUrl, "utf8"));
const validationErrors = validateAdditions(additions);
if (validationErrors.length) {
  console.error(validationErrors.join("\n"));
  process.exit(1);
}

const payload = JSON.parse(await readFile(buildUrl, "utf8"));
const result = applyAdditions(payload, additions);
await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await mkdir(new URL("../artifacts", import.meta.url), { recursive: true });
await writeFile(buildUrl, JSON.stringify(result.payload, null, 2) + "\n");
await writeFile(jsUrl, `window.HALIFAX_CITY_EVENTS = ${JSON.stringify(result.payload, null, 2)};\n`);
await writeFile(reportUrl, JSON.stringify({
  generatedAt: new Date().toISOString(),
  additionsGeneratedAt: additions.generatedAt || null,
  inputEventCount: Array.isArray(payload.events) ? payload.events.length : 0,
  outputEventCount: result.payload.events.length,
  addedIds: result.addedIds,
  mergedIds: result.mergedIds,
  additionSourceCount: Array.isArray(additions.sources) ? additions.sources.length : 0,
  additionEventCount: Array.isArray(additions.events) ? additions.events.length : 0
}, null, 2) + "\n");
console.log(`Applied city-event additions: added=${result.addedIds.length}, merged=${result.mergedIds.length}, total=${result.payload.events.length}.`);
