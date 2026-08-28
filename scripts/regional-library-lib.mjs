import { createHash } from "node:crypto";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export function cleanLibraryText(value) {
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
export function inlineLibraryText(value) { return cleanLibraryText(value).replace(/\s+/g, " ").trim(); }
export function normalizedLibraryText(value) { return inlineLibraryText(value).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, ""); }
export function absoluteLibraryUrl(value, base) {
  try {
    const url = new URL(String(value ?? ""), base);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}
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

export function parseLibraryWhen(block) {
  const timed = String(block).match(/\bon\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2}),\s+(\d{1,2}:\d{2})(am|pm)(?:\s*[-–]\s*(\d{1,2}:\d{2})(am|pm))?/i);
  if (timed) {
    const month = monthNumber(timed[1]);
    const startTime = timeParts(timed[4], timed[5]);
    const endTime = timed[6] ? timeParts(timed[6], timed[7]) : startTime;
    const startAt = zonedIso(Number(timed[3]), month, Number(timed[2]), startTime.hour, startTime.minute);
    let endAt = zonedIso(Number(timed[3]), month, Number(timed[2]), endTime.hour, endTime.minute);
    if (Date.parse(endAt) < Date.parse(startAt)) endAt = new Date(Date.parse(endAt) + 86400000).toISOString();
    return { startAt, endAt, allDay: false };
  }
  const range = String(block).match(/from\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2})\s+to\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2})/i);
  if (range) return { startAt: zonedIso(Number(range[3]), monthNumber(range[1]), Number(range[2]), 12, 0), endAt: zonedIso(Number(range[6]), monthNumber(range[4]), Number(range[5]), 12, 0), allDay: true };
  return null;
}

export function libraryCategories(block, title) {
  const text = `${title} ${block}`.toLowerCase();
  const categories = [];
  if (/food & cooking|cooking|baking|food|culinary/.test(text)) categories.push("Food & Drink");
  if (/music & performances|music|concert|dance party/.test(text)) categories.push("Music");
  if (/arts & crafts|authors & writing|movies|film|art exhibit|creative/.test(text)) categories.push("Arts");
  if (/outdoor|nature walk|science & environment/.test(text)) categories.push("Outdoor");
  if (/celebrations & commemorations|culture & communities|socials & clubs|lectures & discussions|health & wellness|drop in|drop-in|workshop|games & gaming|digital & library skills|early childhood/.test(text)) categories.push("Community");
  return categories.length ? [...new Set(categories)] : ["Community"];
}

export function parseRegionalLibraryPage({ html, resolvedUrl, filter, source, rangeStart, rangeEnd, observedAt = new Date().toISOString() }) {
  const aliases = [filter.name, ...(filter.aliases || [])];
  const headings = [...String(html).matchAll(/<h3\b[^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/gi)];
  const events = [];
  for (let index = 0; index < headings.length; index += 1) {
    const current = headings[index];
    const nextIndex = headings[index + 1]?.index ?? String(html).length;
    const block = cleanLibraryText(String(html).slice(current.index, nextIndex));
    if (/\bcancelled\b/i.test(block)) continue;
    if (!aliases.some((name) => block.includes(name))) continue;
    const title = inlineLibraryText(current[2]).replace(/^Featured Event\.\s*/i, "");
    const when = parseLibraryWhen(block);
    if (!title || !when) continue;
    const start = Date.parse(when.startAt);
    const end = Date.parse(when.endAt || when.startAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < rangeStart || start > rangeEnd) continue;
    const eventUrl = absoluteLibraryUrl(current[1], resolvedUrl) || source.url;
    const isFree = /\bfree\b/i.test(block);
    events.push({
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
      ticketUrl: null,
      price: isFree ? "Free" : null,
      free: isFree,
      sourceId: source.id,
      sourceName: source.name,
      sourceKind: source.kind,
      sourceUrl: source.url,
      observedAt,
      reviewState: "source_observed",
      associationBasis: `bibliocommons_location_filter:${filter.code}`
    });
  }
  return events;
}

export function dedupeLibraryEvents(items) {
  const map = new Map();
  for (const event of items) {
    const key = `${normalizedLibraryText(event.title)}|${String(event.startAt).slice(0, 10)}|${normalizedLibraryText(event.venueName || event.address || event.city)}`;
    if (!map.has(key)) map.set(key, event);
  }
  return [...map.values()].sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)) || String(a.title).localeCompare(String(b.title)));
}
