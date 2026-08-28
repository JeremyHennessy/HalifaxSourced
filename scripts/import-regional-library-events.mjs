import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const payloadUrl = new URL("../data/build/city-events.json", import.meta.url);
const jsUrl = new URL("../data/city-events.js", import.meta.url);
const registry = JSON.parse(await readFile(new URL("../data/event-source-supplements.json", import.meta.url), "utf8"));
const payload = JSON.parse(await readFile(payloadUrl, "utf8"));
const source = (registry.sources || []).find((item) => item.id === "halifax-public-libraries");
if (!source) throw new Error("halifax_public_libraries_source_missing");

const filters = Array.isArray(source.regionalLocationFilters) ? source.regionalLocationFilters : [];
const pageLimit = Math.max(1, Math.min(20, Number(process.env.LIBRARY_REGIONAL_PAGE_LIMIT ?? 12)));
const delayMs = Math.max(0, Number(process.env.LIBRARY_REGIONAL_DELAY_MS ?? 100));
const timeoutMs = Number(process.env.SUPPLEMENTAL_EVENT_TIMEOUT_MS ?? 15000);
const userAgent = "HalifaxSourced/0.7 (+https://github.com/JeremyHennessy/HalifaxSourced)";
const rangeStart = Date.parse(payload.range?.start || new Date().toISOString());
const rangeEnd = Date.parse(payload.range?.end || new Date(Date.now() + 400 * 86400000).toISOString());
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

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
function monthNumber(value) { const index = MONTHS.indexOf(String(value || "").toLowerCase()); return index >= 0 ? index + 1 : null; }
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
  if (/celebrations & commemorations|culture & communities|socials & clubs|lectures & discussions|health & wellness|drop in|drop-in|workshop|games & gaming|digital & library skills|early childhood/.test(text)) categories.push("Community");
  return categories.length ? [...new Set(categories)] : ["Community"];
}
async function fetchHtml(url) {
  const response = await fetch(url, { headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`http_${response.status}`);
  const type = response.headers.get("content-type") || "";
  if (!/html|xhtml/i.test(type)) throw new Error("not_html");
  return { text: await response.text(), resolvedUrl: response.url || url };
}
function dedupe(items) {
  const map = new Map();
  for (const event of items) {
    const key = `${normalized(event.title)}|${String(event.startAt).slice(0, 10)}|${normalized(event.venueName || event.address || event.city)}`;
    if (!map.has(key)) map.set(key, event);
  }
  return [...map.values()].sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)) || String(a.title).localeCompare(String(b.title)));
}
function parsePage(page, filter) {
  const aliases = [filter.name, ...(filter.aliases || [])];
  const headings = [...page.text.matchAll(/<h3\b[^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/gi)];
  const events = [];
  for (let index = 0; index < headings.length; index += 1) {
    const current = headings[index];
    const nextIndex = headings[index + 1]?.index ?? page.text.length;
    const block = clean(page.text.slice(current.index, nextIndex));
    if (/\bcancelled\b/i.test(block)) continue;
    if (!aliases.some((name) => block.includes(name))) continue;
    const title = inline(current[2]).replace(/^Featured Event\.\s*/i, "");
    const when = libraryWhen(block);
    if (!title || !when || !inRange(when.startAt, when.endAt)) continue;
    const eventUrl = absoluteUrl(current[1], page.resolvedUrl) || source.url;
    const event = {
      id: `${source.id}-${hashId(title, when.startAt, filter.name)}`,
      title: title.slice(0, 240),
      startAt: when.startAt,
      endAt: when.endAt || when.startAt,
      allDay: Boolean(when.allDay),
      venueName: filter.name,
      address: null,
      city: filter.city,
      categories: libraryCategories(block, title),
      eventUrl,
      ticketUrl: source.url,
      price: /\bfree\b/i.test(block) ? "Free" : null,
      free: /\bfree\b/i.test(block),
      sourceId: source.id,
      sourceName: source.name,
      sourceKind: source.kind,
      sourceUrl: source.url,
      observedAt: new Date().toISOString(),
      reviewState: "source_observed",
      associationBasis: `bibliocommons_location_filter:${filter.code}`
    };
    events.push(event);
  }
  return events;
}

const regional = [];
const locationStats = [];
const failures = [];
for (const filter of filters) {
  let expectedPages = pageLimit;
  let collected = 0;
  const started = Date.now();
  try {
    for (let pageNumber = 1; pageNumber <= Math.min(pageLimit, expectedPages); pageNumber += 1) {
      const url = `${source.url}?locations=${encodeURIComponent(filter.code)}&page=${pageNumber}`;
      const page = await fetchHtml(url);
      const plain = clean(page.text);
      const totalMatch = plain.match(/\b\d+\s+to\s+\d+\s+of\s+([\d,]+)\s+items\b/i);
      if (totalMatch) expectedPages = Math.min(pageLimit, Math.ceil(Number(totalMatch[1].replace(/,/g, "")) / 20));
      const events = parsePage(page, filter);
      regional.push(...events);
      collected += events.length;
      if (libraryDelayMs) await sleep(delayMs);
    }
    locationStats.push({ code: filter.code, name: filter.name, city: filter.city, status: "ok", eventCount: collected, durationMs: Date.now() - started });
    console.log(`${filter.name}: ${collected} regional library events.`);
  } catch (error) {
    failures.push({ code: filter.code, name: filter.name, city: filter.city, reason: error.message });
    locationStats.push({ code: filter.code, name: filter.name, city: filter.city, status: "failed", eventCount: collected, reason: error.message, durationMs: Date.now() - started });
  }
}

const events = dedupe([...(payload.events || []), ...regional]);
const categoryCounts = {};
for (const event of events) for (const category of event.categories || []) categoryCounts[category] = (categoryCounts[category] || 0) + 1;
const output = {
  ...payload,
  eventCount: events.length,
  categoryCounts,
  sourceStats: [...(payload.sourceStats || []), { sourceId: source.id, sourceName: source.name, mode: "bibliocommons_regional_filters", status: failures.length ? "partial" : "ok", eventCount: regional.length, observedAt: new Date().toISOString(), regionalLocationCounts: Object.fromEntries(locationStats.map((item) => [item.name, item.eventCount])) }],
  failures: [...(payload.failures || []), ...failures.map((item) => ({ sourceId: source.id, sourceName: source.name, url: source.url, reason: `regional_${item.code}_${item.reason}`, observedAt: new Date().toISOString() }))],
  regionalLibraryAudit: { generatedAt: new Date().toISOString(), locationStats, collectedBeforeDedupe: regional.length, failures },
  events
};
await writeFile(payloadUrl, JSON.stringify(output, null, 2) + "\n");
await writeFile(jsUrl, `window.HALIFAX_CITY_EVENTS = ${JSON.stringify(output, null, 2)};\n`);
console.log(`Regional library events: collected=${regional.length}, merged-total=${events.length}, failures=${failures.length}.`);
