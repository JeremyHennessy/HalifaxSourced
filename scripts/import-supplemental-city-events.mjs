import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const payloadUrl = new URL("../data/build/city-events.json", import.meta.url);
const jsUrl = new URL("../data/city-events.js", import.meta.url);
const registry = JSON.parse(await readFile(new URL("../data/event-source-supplements.json", import.meta.url), "utf8"));
const payload = JSON.parse(await readFile(payloadUrl, "utf8"));
const sources = Array.isArray(registry.sources) ? registry.sources : [];
const timeoutMs = Number(process.env.SUPPLEMENTAL_EVENT_TIMEOUT_MS ?? 15000);
const libraryPageLimit = Math.max(1, Math.min(150, Number(process.env.LIBRARY_EVENT_PAGE_LIMIT ?? 120)));
const libraryDelayMs = Math.max(0, Number(process.env.LIBRARY_EVENT_DELAY_MS ?? 100));
const userAgent = "HalifaxSourced/0.6 (+https://github.com/JeremyHennessy/HalifaxSourced)";
const rangeStart = Date.parse(payload.range?.start || new Date().toISOString());
const rangeEnd = Date.parse(payload.range?.end || new Date(Date.now() + 400 * 86400000).toISOString());
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_ABBR = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function clean(value) {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h1|h2|h3|h4|article|section)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
function inline(value) { return clean(value).replace(/\s+/g, " ").trim(); }
function absoluteUrl(value, base) {
  try {
    const url = new URL(String(value ?? ""), base);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}
function normalized(value) { return inline(value).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, ""); }
function hashId(...parts) { return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16); }
function monthNumber(value) {
  const key = String(value || "").toLowerCase();
  const full = MONTHS.indexOf(key);
  if (full >= 0) return full + 1;
  return MONTH_ABBR[key.slice(0, 4)] || MONTH_ABBR[key.slice(0, 3)] || null;
}
function offsetMinutesForHalifax(year, month, day, hour = 12, minute = 0) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Halifax", timeZoneName: "shortOffset", hour: "2-digit" }).formatToParts(guess);
  const label = parts.find((part) => part.type === "timeZoneName")?.value || "GMT-3";
  const match = label.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/i);
  if (!match) return -180;
  const minutes = Number(match[2]) * 60 + Number(match[3] || 0);
  return (match[1] === "+" ? 1 : -1) * minutes;
}
function zonedIso(year, month, day, hour = 12, minute = 0) {
  const offset = offsetMinutesForHalifax(year, month, day, hour, minute);
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - offset * 60000).toISOString();
}
function timeParts(value, meridiem) {
  const [hourText, minuteText] = String(value).split(":");
  let hour = Number(hourText);
  const minute = Number(minuteText || 0);
  const mer = String(meridiem || "").toLowerCase();
  if (mer === "pm" && hour < 12) hour += 12;
  if (mer === "am" && hour === 12) hour = 0;
  return { hour, minute };
}
function inRange(startAt, endAt = startAt) {
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  return Number.isFinite(start) && Number.isFinite(end) && end >= rangeStart && start <= rangeEnd;
}
async function fetchHtml(url) {
  const response = await fetch(url, { headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`http_${response.status}`);
  const type = response.headers.get("content-type") || "";
  if (!/html|xhtml/i.test(type)) throw new Error("not_html");
  return { text: await response.text(), resolvedUrl: response.url || url };
}
function makeEvent(source, raw) {
  if (!raw.title || !raw.startAt || !inRange(raw.startAt, raw.endAt || raw.startAt)) return null;
  const eventUrl = absoluteUrl(raw.eventUrl || source.url, source.url) || source.url;
  const event = {
    id: `${source.id}-${hashId(raw.title, raw.startAt, raw.venueName || raw.address || "Halifax")}`,
    title: inline(raw.title).slice(0, 240),
    startAt: raw.startAt,
    endAt: raw.endAt || raw.startAt,
    allDay: Boolean(raw.allDay),
    venueName: inline(raw.venueName || source.venueName || "") || null,
    address: inline(raw.address || source.venueAddress || "") || null,
    city: raw.city || "Halifax",
    categories: Array.isArray(raw.categories) && raw.categories.length ? [...new Set(raw.categories)] : ["Other"],
    eventUrl,
    ticketUrl: absoluteUrl(raw.ticketUrl, source.url),
    price: raw.price || null,
    sourceId: source.id,
    sourceName: source.name,
    sourceKind: source.kind,
    sourceUrl: source.url,
    observedAt: new Date().toISOString(),
    reviewState: "source_observed"
  };
  if (Number.isFinite(Number(source.latitude)) && Number.isFinite(Number(source.longitude))) {
    event.latitude = Number(source.latitude);
    event.longitude = Number(source.longitude);
  }
  return event;
}

function simpleEventCategories(title) {
  const text = String(title || "").toLowerCase();
  if (/market/.test(text)) return ["Markets", "Community"];
  if (/movie|film|documentary|author|art|gallery|theatre|drama|craft|stitch|knit/.test(text)) return ["Arts", "Community"];
  if (/music|concert|sing|dance/.test(text)) return ["Music", "Arts"];
  if (/food|cook|tea|cafe/.test(text)) return ["Food & Drink", "Community"];
  return ["Community"];
}

function locationPageWhen(block) {
  const match = inline(block).match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{1,2})(?:st|nd|rd|th)?\s*\|\s*(\d{1,2}(?::\d{2})?)(am|pm)\s*[-–]\s*(\d{1,2}(?::\d{2})?)(am|pm)/i);
  if (!match) return null;
  const month = monthNumber(match[1]);
  const year = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Halifax", year: "numeric" }).format(new Date()));
  const start = timeParts(match[3], match[4]);
  const end = timeParts(match[5], match[6]);
  const startAt = zonedIso(year, month, Number(match[2]), start.hour, start.minute);
  let endAt = zonedIso(year, month, Number(match[2]), end.hour, end.minute);
  if (Date.parse(endAt) < Date.parse(startAt)) endAt = new Date(Date.parse(endAt) + 86400000).toISOString();
  return { startAt, endAt, allDay: false };
}

async function importOfficialLocationEvents(source) {
  const page = await fetchHtml(source.url);
  const headings = [...page.text.matchAll(/<h3\b[^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/gi)];
  const events = [];
  for (let index = 0; index < headings.length; index += 1) {
    const current = headings[index];
    const nextIndex = headings[index + 1]?.index ?? page.text.length;
    const block = page.text.slice(current.index, nextIndex);
    if (/\bcancelled\b/i.test(inline(block))) continue;
    const when = locationPageWhen(block);
    const title = inline(current[2]).replace(/, part of a series.*$/i, "");
    if (!when || !title) continue;
    const event = makeEvent(source, { ...when, title, venueName: source.venueName, address: source.venueAddress, city: source.city, categories: simpleEventCategories(title), eventUrl: absoluteUrl(current[1], page.resolvedUrl) });
    if (event) events.push(event);
  }
  return events;
}

function normalizedEventonDate(value, allDay) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (allDay || /^\d{4}-\d{1,2}-\d{1,2}$/.test(text)) {
    const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    return match ? zonedIso(Number(match[1]), Number(match[2]), Number(match[3]), 12, 0) : null;
  }
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})T(\d{1,2}):(\d{2})(?::(\d{2}))?([+-])(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const iso = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}T${match[4].padStart(2, "0")}:${match[5]}:${match[6] || "00"}${match[7]}${match[8].padStart(2, "0")}:${match[9]}`;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

async function importEventonCalendar(source) {
  const page = await fetchHtml(source.url);
  const events = [];
  for (const match of page.text.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let item;
    // EventON emits literal line breaks inside JSON string values. They are
    // invalid JSON controls but carry no semantic value for the fields used.
    try { item = JSON.parse(match[1].replace(/[\u0000-\u001f]+/g, " ")); } catch { continue; }
    if (item?.["@type"] !== "Event" || !item.name || !item.startDate) continue;
    const allDay = /^\d{4}-\d{1,2}-\d{1,2}$/.test(String(item.startDate));
    const startAt = normalizedEventonDate(item.startDate, allDay);
    const endAt = normalizedEventonDate(item.endDate || item.startDate, allDay);
    if (!startAt || !endAt) continue;
    const event = makeEvent(source, { title: item.name, startAt, endAt, allDay, venueName: source.venueName, address: source.venueAddress, city: source.city, categories: simpleEventCategories(item.name), eventUrl: item.url });
    if (event) events.push(event);
  }
  return events;
}

function parseConventionDate(label, defaultYear) {
  const pattern = /^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:\s*[-–]\s*(?:(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+)?(\d{1,2}))?\s+(.+)$/i;
  const match = inline(label).match(pattern);
  if (!match) return null;
  const startMonth = monthNumber(match[1]);
  const startDay = Number(match[2]);
  const endMonth = match[3] ? monthNumber(match[3]) : startMonth;
  const endDay = match[4] ? Number(match[4]) : startDay;
  if (!startMonth || !endMonth) return null;
  let endYear = defaultYear;
  if (endMonth < startMonth) endYear += 1;
  return {
    title: match[5],
    startAt: zonedIso(defaultYear, startMonth, startDay, 12, 0),
    endAt: zonedIso(endYear, endMonth, endDay, 12, 0),
    allDay: true
  };
}

async function importConvention(source) {
  const page = await fetchHtml(source.url);
  const text = clean(page.text);
  const monthHeading = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i);
  const defaultYear = Number(monthHeading?.[2] || new Date().getFullYear());
  const events = [];
  for (const match of page.text.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = inline(match[2]);
    const parsed = parseConventionDate(label, defaultYear);
    if (!parsed || /private event/i.test(parsed.title)) continue;
    const event = makeEvent(source, { ...parsed, eventUrl: absoluteUrl(match[1], page.resolvedUrl), venueName: source.venueName, address: source.venueAddress, city: "Halifax", categories: [/conference|summit|convention|expo|fair/i.test(parsed.title) ? "Community" : "Other"] });
    if (event) events.push(event);
  }
  return events;
}

function allowedSymphonyVenue(block) {
  const venues = [
    ["Rebecca Cohn", "Halifax"],
    ["Halifax United Church", "Halifax"],
    ["Paul O'Regan Hall", "Halifax"],
    ["Canadian Museum of Immigration at Pier 21", "Halifax"],
    ["The Music Room", "Halifax"]
  ];
  return venues.find(([name]) => block.includes(name)) || null;
}

async function importSymphony(source) {
  const page = await fetchHtml(source.url);
  const headingMatches = [...page.text.matchAll(/<h3\b[^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/gi)];
  const events = [];
  for (let index = 0; index < headingMatches.length; index += 1) {
    const current = headingMatches[index];
    const nextIndex = headingMatches[index + 1]?.index ?? page.text.length;
    const block = clean(page.text.slice(current.index, nextIndex));
    const title = inline(current[2]);
    const venue = allowedSymphonyVenue(block);
    if (!title || !venue) continue;
    const regex = /(\d{1,2}:\d{2})\s*(am|pm)\s*[•·]\s*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2})/gi;
    for (const dateMatch of block.matchAll(regex)) {
      const month = monthNumber(dateMatch[3]);
      const { hour, minute } = timeParts(dateMatch[1], dateMatch[2]);
      const startAt = zonedIso(Number(dateMatch[5]), month, Number(dateMatch[4]), hour, minute);
      const event = makeEvent(source, { title, startAt, endAt: startAt, venueName: venue[0], city: venue[1], categories: ["Music", "Arts"], eventUrl: absoluteUrl(current[1], page.resolvedUrl) });
      if (event) events.push(event);
    }
  }
  return events;
}

function libraryWhen(block) {
  const timed = block.match(/\bon\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2}),\s+(\d{1,2}:\d{2})(am|pm)(?:\s*[-–]\s*(\d{1,2}:\d{2})(am|pm))?/i);
  if (timed) {
    const month = monthNumber(timed[1]);
    const startTime = timeParts(timed[4], timed[5]);
    const endTime = timed[6] ? timeParts(timed[6], timed[7]) : startTime;
    const startAt = zonedIso(Number(timed[3]), month, Number(timed[2]), startTime.hour, startTime.minute);
    let endAt = zonedIso(Number(timed[3]), month, Number(timed[2]), endTime.hour, endTime.minute);
    if (Date.parse(endAt) < Date.parse(startAt)) endAt = new Date(Date.parse(endAt) + 86400000).toISOString();
    return { startAt, endAt, allDay: false };
  }
  const range = block.match(/from\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2})\s+to\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2})/i);
  if (range) return { startAt: zonedIso(Number(range[3]), monthNumber(range[1]), Number(range[2]), 12, 0), endAt: zonedIso(Number(range[6]), monthNumber(range[4]), Number(range[5]), 12, 0), allDay: true };
  return null;
}

function libraryCategories(block, title) {
  const text = `${title} ${block}`.toLowerCase();
  const categories = [];
  if (/food & cooking|cooking|baking|food|culinary/.test(text)) categories.push("Food & Drink");
  if (/music & performances|music|concert|dance party/.test(text)) categories.push("Music");
  if (/arts & crafts|authors & writing|movies|film|art exhibit|creative/.test(text)) categories.push("Arts");
  if (/outdoor|nature walk|science & environment/.test(text)) categories.push("Outdoor");
  if (/celebrations & commemorations|culture & communities|socials & clubs|lectures & discussions|health & wellness/.test(text)) categories.push("Community");
  return categories.length ? [...new Set(categories)] : ["Community"];
}

async function importLibraries(source) {
  const allowedLocations = source.allowedLocations || {};
  const events = [];
  let expectedPages = libraryPageLimit;
  for (let pageNumber = 1; pageNumber <= Math.min(libraryPageLimit, expectedPages); pageNumber += 1) {
    const url = `${source.url}${source.url.includes("?") ? "&" : "?"}page=${pageNumber}`;
    const page = await fetchHtml(url);
    const plain = clean(page.text);
    const totalMatch = plain.match(/\b\d+\s+to\s+\d+\s+of\s+([\d,]+)\s+items\b/i);
    if (totalMatch) expectedPages = Math.min(libraryPageLimit, Math.ceil(Number(totalMatch[1].replace(/,/g, "")) / 20));
    const headings = [...page.text.matchAll(/<h3\b[^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/gi)];
    if (!headings.length) break;
    for (let index = 0; index < headings.length; index += 1) {
      const current = headings[index];
      const nextIndex = headings[index + 1]?.index ?? page.text.length;
      const block = clean(page.text.slice(current.index, nextIndex));
      if (/\bcancelled\b/i.test(block)) continue;
      const title = inline(current[2]).replace(/^Featured Event\.\s*/i, "");
      const location = Object.entries(allowedLocations).find(([name]) => block.includes(name));
      if (!title || !location) continue;
      const when = libraryWhen(block);
      if (!when) continue;
      const event = makeEvent(source, { ...when, title, venueName: location[0], city: location[1], categories: libraryCategories(block, title), eventUrl: absoluteUrl(current[1], page.resolvedUrl) });
      if (event) events.push(event);
    }
    if (libraryDelayMs) await sleep(libraryDelayMs);
  }
  return events;
}

function dedupe(items) {
  const map = new Map();
  for (const event of items) {
    const key = `${normalized(event.title)}|${String(event.startAt).slice(0, 10)}|${normalized(event.venueName || event.address || event.city)}`;
    const existing = map.get(key);
    if (!existing) { map.set(key, event); continue; }
    if ((event.sourceKind || "").startsWith("official") && !(existing.sourceKind || "").startsWith("official")) map.set(key, event);
  }
  return [...map.values()].sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)) || String(a.title).localeCompare(String(b.title)));
}

const supplemental = [];
const sourceStats = [];
const failures = [];
for (const source of sources) {
  const started = Date.now();
  try {
    let events = [];
    if (source.mode === "convention_calendar") events = await importConvention(source);
    else if (source.mode === "symphony_concerts") events = await importSymphony(source);
    else if (source.mode === "bibliocommons_events") events = await importLibraries(source);
    else if (source.mode === "official_location_events") events = await importOfficialLocationEvents(source);
    else if (source.mode === "eventon_jsonld_calendar") events = await importEventonCalendar(source);
    else throw new Error(`unsupported_mode_${source.mode}`);
    supplemental.push(...events);
    sourceStats.push({ sourceId: source.id, sourceName: source.name, status: "ok", eventCount: events.length, observedAt: new Date().toISOString(), durationMs: Date.now() - started });
    console.log(`${source.name}: ${events.length} supplemental Halifax events.`);
  } catch (error) {
    failures.push({ sourceId: source.id, sourceName: source.name, url: source.url, reason: error.message, observedAt: new Date().toISOString() });
    sourceStats.push({ sourceId: source.id, sourceName: source.name, status: "failed", eventCount: 0, reason: error.message, observedAt: new Date().toISOString(), durationMs: Date.now() - started });
    console.warn(`${source.name}: ${error.message}`);
  }
}

// Refresh these adapters atomically so reruns cannot preserve stale events,
// stale failures, or a previously sanitized municipality assignment.
const supplementalSourceIds = new Set(sources.map((source) => source.id));
const baseEvents = (payload.events || []).filter((event) => !supplementalSourceIds.has(event.sourceId));
const events = dedupe([...baseEvents, ...supplemental]);
const categoryCounts = {};
for (const event of events) for (const category of event.categories || []) categoryCounts[category] = (categoryCounts[category] || 0) + 1;
const output = {
  ...payload,
  version: Math.max(4, Number(payload.version || 0)),
  supplementalAt: new Date().toISOString(),
  eventCount: events.length,
  categoryCounts,
  sourceStats: [...(payload.sourceStats || []).filter((stat) => !supplementalSourceIds.has(stat.sourceId)), ...sourceStats],
  failures: [...(payload.failures || []).filter((failure) => !supplementalSourceIds.has(failure.sourceId)), ...failures],
  supplementalAudit: { addedBeforeDedupe: supplemental.length, sourceStats, failures },
  events
};
await writeFile(payloadUrl, JSON.stringify(output, null, 2));
await writeFile(jsUrl, `window.HALIFAX_CITY_EVENTS = ${JSON.stringify(output, null, 2)};\n`);
console.log(`Supplemental city events: collected=${supplemental.length}, merged-total=${events.length}, failures=${failures.length}.`);
