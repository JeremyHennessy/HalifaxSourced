import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const registry = JSON.parse(await readFile(new URL("../data/event-source-registry.json", import.meta.url), "utf8"));
const sources = Array.isArray(registry?.sources) ? registry.sources : [];
const scope = registry?.scope || {};
const futureDays = Number(scope.futureDays ?? 400);
const pastGraceHours = Number(scope.pastGraceHours ?? 6);
const now = Date.now();
const minStamp = now - pastGraceHours * 60 * 60 * 1000;
const maxStamp = now + futureDays * 24 * 60 * 60 * 1000;
const timeoutMs = Number(process.env.CITY_EVENT_TIMEOUT_MS ?? 15000);
const userAgent = "HalifaxSourced/0.6 (+https://github.com/JeremyHennessy/HalifaxSourced)";
const robotsCache = new Map();
const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";
const WEEKDAYS = "Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun";

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function safeUrl(value, base) {
  try {
    const url = new URL(String(value ?? ""), base);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}
function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—")
    .replace(/&bull;/gi, "•")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}
function cleanText(value) {
  return decodeEntities(String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h1|h2|h3|h4|h5|h6|article|section|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t\u00a0\u202f]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
function normalize(value) {
  return String(value ?? "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}
function hashId(value) { return createHash("sha256").update(String(value)).digest("hex").slice(0, 16); }
function validDate(value) { return Number.isFinite(Date.parse(String(value ?? ""))); }
function inWindow(value) {
  const stamp = Date.parse(String(value ?? ""));
  return Number.isFinite(stamp) && stamp >= minStamp && stamp <= maxStamp;
}
function dateOnly(value) {
  const stamp = Date.parse(String(value ?? ""));
  return Number.isFinite(stamp) ? new Date(stamp).toISOString().slice(0, 10) : "";
}

function parseRobots(text) {
  const groups = [];
  let current = null;
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const index = line.indexOf(":");
    if (index < 0) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    if (key === "user-agent") {
      if (!current || current.hasRules) {
        current = { agents: [], disallow: [], hasRules: false };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (!current) continue;
    current.hasRules = true;
    if (key === "disallow" && value) current.disallow.push(value);
  }
  const specific = groups.find((group) => group.agents.some((agent) => agent.includes("halifaxsourced")));
  const wildcard = groups.find((group) => group.agents.includes("*"));
  return (specific || wildcard)?.disallow || [];
}
async function robotsAllows(url) {
  const parsed = new URL(url);
  if (!robotsCache.has(parsed.origin)) {
    robotsCache.set(parsed.origin, (async () => {
      try {
        const response = await fetch(new URL("/robots.txt", parsed.origin), {
          headers: { "User-Agent": userAgent },
          redirect: "follow",
          signal: AbortSignal.timeout(Math.min(8000, timeoutMs))
        });
        if (response.status === 401 || response.status === 403) return ["/"];
        if (!response.ok) return [];
        return parseRobots(await response.text());
      } catch { return []; }
    })());
  }
  const disallow = await robotsCache.get(parsed.origin);
  return !disallow.some((prefix) => prefix === "/" || (prefix && parsed.pathname.startsWith(prefix)));
}
async function fetchText(url, accept = "text/html,application/xhtml+xml,text/calendar;q=0.9,*/*;q=0.5") {
  if (!(await robotsAllows(url))) throw new Error("robots_disallow");
  const response = await fetch(url, {
    headers: { "User-Agent": userAgent, Accept: accept },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`http_${response.status}`);
  return { text: await response.text(), resolvedUrl: response.url || url, contentType: response.headers.get("content-type") || "" };
}

function atlanticOffset(year, month, day) {
  const secondSundayMarch = (() => {
    const first = new Date(Date.UTC(year, 2, 1));
    return 1 + ((7 - first.getUTCDay()) % 7) + 7;
  })();
  const firstSundayNovember = (() => {
    const first = new Date(Date.UTC(year, 10, 1));
    return 1 + ((7 - first.getUTCDay()) % 7);
  })();
  const dst = month > 3 && month < 11 || (month === 3 && day >= secondSundayMarch) || (month === 11 && day < firstSundayNovember);
  return dst ? "-03:00" : "-04:00";
}
function parseClock(value) {
  const normalized = String(value ?? "").replace(/[\u00a0\u202f]/g, " ").trim();
  const match = normalized.match(/(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i);
  if (!match) return { hour: 12, minute: 0, hasTime: false };
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const suffix = String(match[3] || "").toLowerCase().replaceAll(".", "");
  if (suffix === "pm" && hour < 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  return { hour, minute, hasTime: true };
}
function datePartsFromHuman(value) {
  const stamp = Date.parse(String(value ?? ""));
  if (!Number.isFinite(stamp)) return null;
  const date = new Date(stamp);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}
function localIso(dateValue, timeValue, allDay = false) {
  const parts = typeof dateValue === "object" && dateValue?.year ? dateValue : datePartsFromHuman(dateValue);
  if (!parts) return null;
  const clock = allDay ? { hour: 12, minute: 0, hasTime: false } : parseClock(timeValue);
  const pad = (value) => String(value).padStart(2, "0");
  const raw = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(clock.hour)}:${pad(clock.minute)}:00${atlanticOffset(parts.year, parts.month, parts.day)}`;
  const stamp = Date.parse(raw);
  return Number.isFinite(stamp) ? new Date(stamp).toISOString() : null;
}
function parseHumanDateRange(value, yearHint = null) {
  const text = String(value ?? "").replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " ").trim();
  let match = text.match(new RegExp(`(${MONTHS})\\s+(\\d{1,2}),\\s*(20\\d{2})\\s*[-–—]\\s*(${MONTHS})\\s+(\\d{1,2}),\\s*(20\\d{2})`, "i"));
  if (match) return { start: `${match[1]} ${match[2]}, ${match[3]}`, end: `${match[4]} ${match[5]}, ${match[6]}` };
  match = text.match(new RegExp(`(${MONTHS})\\s+(\\d{1,2})\\s*[-–—]\\s*(${MONTHS})\\s+(\\d{1,2}),\\s*(20\\d{2})`, "i"));
  if (match) return { start: `${match[1]} ${match[2]}, ${match[5]}`, end: `${match[3]} ${match[4]}, ${match[5]}` };
  match = text.match(new RegExp(`(${MONTHS})\\s+(\\d{1,2})\\s*[-–—]\\s*(\\d{1,2}),\\s*(20\\d{2})`, "i"));
  if (match) return { start: `${match[1]} ${match[2]}, ${match[4]}`, end: `${match[1]} ${match[3]}, ${match[4]}` };
  match = text.match(new RegExp(`(${MONTHS})\\s+(\\d{1,2}),\\s*(20\\d{2})`, "i"));
  if (match) return { start: `${match[1]} ${match[2]}, ${match[3]}`, end: `${match[1]} ${match[2]}, ${match[3]}` };
  if (yearHint) {
    match = text.match(new RegExp(`(${MONTHS})\\s+(\\d{1,2})`, "i"));
    if (match) return { start: `${match[1]} ${match[2]}, ${yearHint}`, end: `${match[1]} ${match[2]}, ${yearHint}` };
  }
  return null;
}
function timeRange(value) {
  const text = String(value ?? "").replace(/[\u00a0\u202f]/g, " ");
  const match = text.match(/(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))\s*(?:[-–—]|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))/i);
  if (match) return { start: match[1], end: match[2] };
  const single = text.match(/(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))/i);
  return single ? { start: single[1], end: single[1] } : { start: null, end: null };
}

function categoriesFromText(...parts) {
  const text = parts.flat().filter(Boolean).join(" ").toLowerCase();
  const categories = [];
  const add = (name, regex) => { if (regex.test(text)) categories.push(name); };
  add("Sports", /sport|soccer|football|hockey|lacrosse|basketball|baseball|rugby|paddl|race|marathon|game\b|match\b|mooseheads|wanderers|thunderbirds|tides\b|\bvs\.?\b/);
  add("Music", /music|concert|band\b|singer|songwriter|orchestra|symphony|\bdj\b|album|jazz|rock\b|folk\b|country|hip hop|opera|tour\b/);
  add("Food & Drink", /food|drink|beer|wine|cocktail|tasting|dinner|brunch|culinary|brew|restaurant|chef|cider|spirits/);
  add("Festivals", /festival|fest\b|fringe|celebration|convention|expo|fair\b/);
  add("Markets", /market|vendor|craft fair|night market|farmers/);
  add("Arts", /art\b|arts|theatre|theater|dance|film|cinema|gallery|museum|performance|musical|play\b/);
  add("Comedy", /comedy|comedian|stand[ -]?up|improv|jimmy carr/);
  add("Outdoor", /outdoor|park\b|harbour|harbor|waterfront|trail|garden|beach/);
  add("Community", /community|family|parade|heritage|culture|cultural|pride/);
  return [...new Set(categories.length ? categories : ["Other"])];
}
function sourceEventId(source, event) {
  return `${source.id}-${hashId(`${event.eventUrl || event.sourceUrl || source.url}|${event.title}|${event.startAt}`)}`;
}
function normalizeEvent(source, raw) {
  const title = cleanText(raw.title || raw.name || "").replace(/\s+/g, " ").trim();
  const startStamp = Date.parse(String(raw.startAt ?? ""));
  const endStamp = Date.parse(String(raw.endAt || raw.startAt || ""));
  if (!title || !Number.isFinite(startStamp) || !Number.isFinite(endStamp)) return null;
  const startAt = new Date(startStamp).toISOString();
  const endAt = new Date(endStamp).toISOString();
  if (endStamp < minStamp || startStamp > maxStamp) return null;
  const eventUrl = safeUrl(raw.eventUrl || raw.url || raw.sourceUrl, source.url);
  const sourceUrl = safeUrl(raw.sourceUrl || eventUrl || source.url, source.url);
  if (!sourceUrl) return null;
  const venueName = cleanText(raw.venueName || source.venueName || "") || null;
  const address = cleanText(raw.address || source.venueAddress || "") || null;
  const city = cleanText(raw.city || "") || (address && /dartmouth/i.test(address) ? "Dartmouth" : address && /bedford/i.test(address) ? "Bedford" : "Halifax");
  const categories = [...new Set([...(raw.categories || []), ...categoriesFromText(raw.categories || [], title, venueName)])];
  return {
    id: raw.id || sourceEventId(source, { title, startAt, eventUrl, sourceUrl }),
    title,
    startAt,
    endAt,
    allDay: Boolean(raw.allDay),
    venueName,
    address,
    city,
    categories,
    price: cleanText(raw.price || raw.cost || "") || null,
    ticketUrl: safeUrl(raw.ticketUrl || raw.website, source.url),
    eventUrl,
    sourceUrl,
    sourceId: source.id,
    sourceName: source.name,
    sourceKind: source.kind,
    sourcePriority: Number(source.priority || 0),
    observedAt: new Date().toISOString(),
    reviewState: raw.reviewState || "source-observed"
  };
}

function flattenJsonLd(value, out = []) {
  if (!value) return out;
  if (Array.isArray(value)) { for (const item of value) flattenJsonLd(item, out); return out; }
  if (typeof value !== "object") return out;
  if (value["@graph"]) flattenJsonLd(value["@graph"], out);
  out.push(value);
  return out;
}
function addressText(location) {
  if (!location) return "";
  if (typeof location === "string") return location;
  if (Array.isArray(location)) return location.map(addressText).filter(Boolean).join(", ");
  const address = location.address || location;
  if (typeof address === "string") return address;
  return [address.streetAddress, address.addressLocality, address.addressRegion, address.postalCode, address.addressCountry].filter(Boolean).join(", ");
}
function locationName(location) {
  if (!location) return null;
  if (typeof location === "string") return cleanText(location);
  return cleanText(location.name || location.venue || location.title || "") || null;
}
function parseJsonLdEvents(html, source, pageUrl) {
  const events = [];
  for (const match of String(html).matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      for (const item of flattenJsonLd(parsed)) {
        const types = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
        if (!types.some((type) => /Event$/i.test(String(type || "")))) continue;
        const location = Array.isArray(item.location) ? item.location[0] : item.location;
        const normalized = normalizeEvent(source, {
          id: item["@id"] || null,
          title: item.name,
          startAt: item.startDate,
          endAt: item.endDate || item.startDate,
          allDay: !String(item.startDate || "").includes("T"),
          venueName: locationName(location),
          address: addressText(location),
          city: typeof location?.address === "object" ? location.address.addressLocality : null,
          categories: categoriesFromText(item.name, item.eventAttendanceMode, item.eventStatus),
          price: item.offers?.price || item.offers?.lowPrice || null,
          ticketUrl: item.offers?.url || null,
          eventUrl: item.url || item["@id"] || pageUrl,
          sourceUrl: pageUrl
        });
        if (normalized) events.push(normalized);
      }
    } catch {}
  }
  return events;
}
function anchorLinks(html, baseUrl, predicate = () => true) {
  const links = [];
  const seen = new Set();
  for (const match of String(html).matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = safeUrl(match[1], baseUrl);
    const label = cleanText(match[2]).replace(/\s+/g, " ").trim();
    if (!url || seen.has(url) || !predicate(url, label)) continue;
    seen.add(url);
    links.push({ url, label });
  }
  return links;
}
function linkByLabel(html, baseUrl, regex) {
  return anchorLinks(html, baseUrl, (_, label) => regex.test(label))[0]?.url || null;
}
function h1Title(html) {
  const match = String(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  return cleanText(match?.[1] || "");
}
function sectionLines(text, label, maxLines = 3) {
  const lines = String(text).split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const index = lines.findIndex((line) => normalize(line) === normalize(label));
  return index >= 0 ? lines.slice(index + 1, index + 1 + maxLines) : [];
}

function parseTourismDetail(html, source, pageUrl) {
  const jsonLd = parseJsonLdEvents(html, source, pageUrl);
  if (jsonLd.length) return jsonLd;
  const text = cleanText(html);
  if (!/Halifax Metro/i.test(text)) return [];
  const title = h1Title(html);
  if (!title) return [];
  const dateLine = sectionLines(text, "Date", 2)[0] || text.match(new RegExp(`(${MONTHS})\\s+\\d{1,2}(?:,\\s*20\\d{2})?\\s*[-–—]\\s*(?:${MONTHS}\\s+)?\\d{1,2},\\s*20\\d{2}`, "i"))?.[0] || text.match(new RegExp(`(${MONTHS})\\s+\\d{1,2},\\s*20\\d{2}`, "i"))?.[0];
  const range = parseHumanDateRange(dateLine);
  if (!range) return [];
  const timeLine = sectionLines(text, "Time", 2)[0] || "";
  const times = timeRange(timeLine);
  const location = sectionLines(text, "Location", 3);
  const venueName = location[0] || null;
  const address = location.find((line, index) => index > 0 && /Halifax|Dartmouth|Bedford|\bNS\b/i.test(line)) || null;
  const startAt = localIso(range.start, times.start, !times.start);
  const endAt = localIso(range.end, times.end || times.start, !times.start);
  const price = sectionLines(text, "Price", 1)[0] || null;
  const ticketUrl = linkByLabel(html, pageUrl, /book now|buy tickets?|tickets?|register/i);
  const normalized = normalizeEvent(source, {
    title,
    startAt,
    endAt,
    allDay: !times.start,
    venueName,
    address,
    city: /Dartmouth/i.test(text) ? "Dartmouth" : /Bedford/i.test(text) ? "Bedford" : "Halifax",
    categories: categoriesFromText(text.slice(0, 1800)),
    price,
    ticketUrl,
    eventUrl: pageUrl,
    sourceUrl: pageUrl
  });
  return normalized ? [normalized] : [];
}
function tourismEventLinks(html, baseUrl, source) {
  const host = source.detailHost || new URL(baseUrl).hostname.replace(/^www\./, "");
  const prefix = source.detailPathPrefix || "/event/";
  return anchorLinks(html, baseUrl, (url) => {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "") === host.replace(/^www\./, "") && parsed.pathname.startsWith(prefix) && parsed.pathname !== prefix;
  }).map((link) => link.url);
}
async function importTourismEventCrawl(source) {
  const seed = await fetchText(source.url);
  const queue = tourismEventLinks(seed.text, seed.resolvedUrl, source);
  const seen = new Set();
  const events = [];
  const maxPages = Number(source.maxDetailPages || 180);
  while (queue.length && seen.size < maxPages) {
    const batch = [];
    while (queue.length && batch.length < 10 && seen.size + batch.length < maxPages) {
      const url = queue.shift();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      batch.push(url);
    }
    const results = await Promise.all(batch.map(async (url) => {
      try {
        const page = await fetchText(url);
        return { events: parseTourismDetail(page.text, source, page.resolvedUrl), links: tourismEventLinks(page.text, page.resolvedUrl, source) };
      } catch { return { events: [], links: [] }; }
    }));
    for (const result of results) {
      events.push(...result.events);
      for (const link of result.links) if (!seen.has(link) && !queue.includes(link)) queue.push(link);
    }
    await sleep(75);
  }
  return events;
}

function unfoldIcs(text) {
  return String(text ?? "").replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
}
function icsUnescape(value) {
  return String(value ?? "").replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}
function icsProperty(lines, name) {
  const upper = name.toUpperCase();
  for (const line of lines) {
    const index = line.indexOf(":");
    if (index < 0) continue;
    const left = line.slice(0, index);
    const base = left.split(";")[0].toUpperCase();
    if (base !== upper) continue;
    return { meta: left.slice(base.length), value: line.slice(index + 1) };
  }
  return null;
}
function parseIcsDate(prop) {
  if (!prop?.value) return null;
  const value = prop.value.trim();
  const allDay = /VALUE=DATE/i.test(prop.meta) || /^\d{8}$/.test(value);
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
  if (!match) return null;
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (allDay) return { iso: localIso(parts, null, true), allDay: true };
  if (match[7]) {
    const raw = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] || "00"}Z`;
    return { iso: new Date(raw).toISOString(), allDay: false };
  }
  return { iso: localIso(parts, `${match[4] || "12"}:${match[5] || "00"}`, false), allDay: false };
}
function parseIcsEvents(text, source, calendarUrl) {
  const lines = unfoldIcs(text);
  const events = [];
  let current = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { current = []; continue; }
    if (line === "END:VEVENT") {
      if (!current) continue;
      const summary = icsProperty(current, "SUMMARY");
      const dtStart = parseIcsDate(icsProperty(current, "DTSTART"));
      const dtEnd = parseIcsDate(icsProperty(current, "DTEND")) || dtStart;
      const location = icsProperty(current, "LOCATION");
      const url = icsProperty(current, "URL");
      const categories = icsProperty(current, "CATEGORIES");
      const uid = icsProperty(current, "UID");
      const eventUrl = safeUrl(icsUnescape(url?.value), calendarUrl) || calendarUrl;
      const title = icsUnescape(summary?.value);
      const normalized = normalizeEvent(source, {
        id: uid?.value ? `${source.id}-${hashId(uid.value)}` : null,
        title,
        startAt: dtStart?.iso,
        endAt: dtEnd?.iso,
        allDay: Boolean(dtStart?.allDay),
        venueName: icsUnescape(location?.value),
        address: icsUnescape(location?.value),
        city: /Dartmouth/i.test(location?.value || "") ? "Dartmouth" : /Bedford/i.test(location?.value || "") ? "Bedford" : "Halifax",
        categories: categories?.value ? icsUnescape(categories.value).split(",").flatMap((item) => categoriesFromText(item)) : categoriesFromText(title),
        eventUrl,
        sourceUrl: eventUrl
      });
      if (normalized) events.push(normalized);
      current = null;
      continue;
    }
    if (current) current.push(line);
  }
  return events;
}
function tribeEventLinks(html, baseUrl, source) {
  const host = source.detailHost || new URL(baseUrl).hostname.replace(/^www\./, "");
  const prefix = source.detailPathPrefix || "/event/";
  return anchorLinks(html, baseUrl, (url) => {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "") === host.replace(/^www\./, "") && parsed.pathname.startsWith(prefix) && parsed.pathname !== prefix;
  }).map((link) => link.url);
}
function parseGenericEventDetail(html, source, pageUrl) {
  const jsonLd = parseJsonLdEvents(html, source, pageUrl);
  if (jsonLd.length) return jsonLd;
  const text = cleanText(html);
  const title = h1Title(html);
  if (!title) return [];
  const dateText = text.match(new RegExp(`(${MONTHS})\\s+\\d{1,2}(?:,\\s*20\\d{2})?(?:\\s*[-–—]\\s*(?:${MONTHS}\\s+)?\\d{1,2}(?:,\\s*20\\d{2})?)?`, "i"))?.[0];
  const year = text.match(/\b(20\d{2})\b/)?.[1] || new Date().getUTCFullYear();
  const range = parseHumanDateRange(dateText, year);
  if (!range) return [];
  const times = timeRange(text.slice(Math.max(0, text.indexOf(dateText || "")), Math.min(text.length, text.indexOf(dateText || "") + 500)));
  const locationMatch = text.match(/(?:Venue|Location)\s*\n?([^\n]{2,100})/i);
  const normalized = normalizeEvent(source, {
    title,
    startAt: localIso(range.start, times.start, !times.start),
    endAt: localIso(range.end, times.end || times.start, !times.start),
    allDay: !times.start,
    venueName: locationMatch?.[1] || source.venueName,
    address: source.venueAddress,
    city: /Dartmouth/i.test(text) ? "Dartmouth" : /Bedford/i.test(text) ? "Bedford" : "Halifax",
    categories: categoriesFromText(text.slice(0, 1500)),
    ticketUrl: linkByLabel(html, pageUrl, /tickets?|register|book/i),
    eventUrl: pageUrl,
    sourceUrl: pageUrl
  });
  return normalized ? [normalized] : [];
}
async function importTribeListCrawl(source) {
  if (source.icalUrl) {
    try {
      const calendar = await fetchText(source.icalUrl, "text/calendar,*/*;q=0.5");
      const events = parseIcsEvents(calendar.text, source, calendar.resolvedUrl);
      if (events.length) return events;
    } catch {}
  }
  const detailLinks = new Set();
  const maxPages = Number(source.maxPages || 25);
  for (let page = 1; page <= maxPages; page += 1) {
    const pageUrl = page === 1 ? source.url : new URL(`/events/list/page/${page}/`, source.url).href;
    try {
      const result = await fetchText(pageUrl);
      const links = tribeEventLinks(result.text, result.resolvedUrl, source);
      const before = detailLinks.size;
      links.forEach((link) => detailLinks.add(link));
      if (!links.length || (page > 1 && detailLinks.size === before)) break;
    } catch {
      if (page === 1) throw new Error("event_list_unavailable");
      break;
    }
  }
  const events = [];
  const links = [...detailLinks];
  for (let index = 0; index < links.length; index += 10) {
    const batch = links.slice(index, index + 10);
    const results = await Promise.all(batch.map(async (url) => {
      try {
        const page = await fetchText(url);
        return parseGenericEventDetail(page.text, source, page.resolvedUrl);
      } catch { return []; }
    }));
    events.push(...results.flat());
  }
  return events;
}

function htmlRows(html) {
  const rows = [];
  for (const rowMatch of String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = rowMatch[1];
    const cells = [...rowHtml.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => cleanText(match[1]));
    if (cells.length) rows.push({ cells, rowHtml });
  }
  return rows;
}
function parseCompactDate(value) {
  const text = String(value ?? "").trim();
  let match = text.match(/(\d{1,2})[-\s]([A-Za-z]{3,9})[-,\s]+(\d{2,4})/);
  if (match) {
    const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
    return `${match[2]} ${match[1]}, ${year}`;
  }
  match = text.match(new RegExp(`(${MONTHS})\\s+(\\d{1,2}),?\\s+(20\\d{2})`, "i"));
  return match ? `${match[1]} ${match[2]}, ${match[3]}` : null;
}
async function importScotiabankCalendar(source) {
  const page = await fetchText(source.url);
  const events = [];
  for (const row of htmlRows(page.text)) {
    if (row.cells.length < 4) continue;
    const date = parseCompactDate(row.cells[1]);
    const time = row.cells[2];
    const title = row.cells[3];
    if (!date || !title || /event/i.test(title) && /date/i.test(row.cells[1])) continue;
    let categories;
    if (/mooseheads|\bvs\.?\b/i.test(title)) categories = ["Sports"];
    else if (/comedy|jimmy carr/i.test(title)) categories = ["Comedy"];
    else if (/disney|price is right/i.test(title)) categories = ["Arts", "Community"];
    else categories = ["Music"];
    const eventUrl = anchorLinks(row.rowHtml, page.resolvedUrl)[0]?.url || source.url;
    const normalized = normalizeEvent(source, {
      title,
      startAt: localIso(date, time, false),
      endAt: localIso(date, time, false),
      venueName: source.venueName,
      address: source.venueAddress,
      city: "Halifax",
      categories,
      eventUrl,
      sourceUrl: source.url
    });
    if (normalized) events.push(normalized);
  }
  return events;
}
async function importMooseheadsHomeTable(source) {
  const page = await fetchText(source.url);
  const events = [];
  for (const row of htmlRows(page.text)) {
    if (row.cells.length < 4) continue;
    const date = parseCompactDate(row.cells[1]);
    const opponent = row.cells[2];
    const time = row.cells[3];
    if (!date || !opponent || /visiting team/i.test(opponent)) continue;
    const title = `Halifax Mooseheads vs ${opponent}`;
    const normalized = normalizeEvent(source, {
      title,
      startAt: localIso(date, time, false),
      endAt: localIso(date, time, false),
      venueName: source.venueName,
      address: source.venueAddress,
      city: "Halifax",
      categories: ["Sports"],
      eventUrl: source.url,
      sourceUrl: source.url
    });
    if (normalized) events.push(normalized);
  }
  return events;
}

async function importLighthouseIndex(source) {
  const page = await fetchText(source.url);
  const jsonLd = parseJsonLdEvents(page.text, source, page.resolvedUrl);
  if (jsonLd.length) return jsonLd;
  const eventLinks = anchorLinks(page.text, page.resolvedUrl, (url, label) => {
    const parsed = new URL(url);
    return parsed.hostname === new URL(page.resolvedUrl).hostname && parsed.pathname.startsWith(source.detailPathPrefix || "/events/") && parsed.pathname !== (source.detailPathPrefix || "/events/") && label.length > 2;
  });
  const events = [];
  for (let index = 0; index < eventLinks.length; index += 10) {
    const results = await Promise.all(eventLinks.slice(index, index + 10).map(async (link) => {
      try {
        const detail = await fetchText(link.url);
        return parseGenericEventDetail(detail.text, source, detail.resolvedUrl);
      } catch { return []; }
    }));
    events.push(...results.flat());
  }
  return events;
}

async function importHtmlCalendar(source) {
  const page = await fetchText(source.url);
  const jsonLd = parseJsonLdEvents(page.text, source, page.resolvedUrl);
  if (jsonLd.length) return jsonLd;
  const events = [];
  const headings = [...page.text.matchAll(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/gi)];
  for (let index = 0; index < headings.length; index += 1) {
    const title = cleanText(headings[index][1]);
    if (!title || title.length < 3 || title.length > 180 || /upcoming performances|archives/i.test(title)) continue;
    const start = headings[index].index + headings[index][0].length;
    const end = index + 1 < headings.length ? headings[index + 1].index : Math.min(page.text.length, start + 5000);
    const block = page.text.slice(start, end);
    const text = cleanText(block);
    const dateMatch = text.match(new RegExp(`(${MONTHS})\\s+(\\d{1,2}),\\s+(20\\d{2})`, "i"));
    if (!dateMatch) continue;
    const time = timeRange(text);
    const date = `${dateMatch[1]} ${dateMatch[2]}, ${dateMatch[3]}`;
    const eventUrl = anchorLinks(block, page.resolvedUrl)[0]?.url || page.resolvedUrl;
    const normalized = normalizeEvent(source, {
      title,
      startAt: localIso(date, time.start, !time.start),
      endAt: localIso(date, time.end || time.start, !time.start),
      allDay: !time.start,
      venueName: source.venueName,
      address: source.venueAddress,
      categories: categoriesFromText(title, text.slice(0, 500), "live music performance"),
      eventUrl,
      sourceUrl: eventUrl
    });
    if (normalized) events.push(normalized);
  }
  return events;
}

async function importNeptuneSeason(source) {
  const page = await fetchText(source.url);
  const events = [];
  const headings = [...page.text.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  for (let index = 0; index < headings.length; index += 1) {
    const title = cleanText(headings[index][1]);
    if (!title || /subscriber|dream season|subscriptions|season line up/i.test(title)) continue;
    const start = headings[index].index + headings[index][0].length;
    const end = index + 1 < headings.length ? headings[index + 1].index : Math.min(page.text.length, start + 2500);
    const blockText = cleanText(page.text.slice(start, end));
    const dateMatch = blockText.match(new RegExp(`(${MONTHS})\\s+\\d{1,2}(?:,\\s*20\\d{2})?\\s*[-–—]\\s*(?:${MONTHS}\\s+)?\\d{1,2},\\s*20\\d{2}`, "i"));
    const range = parseHumanDateRange(dateMatch?.[0]);
    if (!range) continue;
    const stage = blockText.split(/\n+/).find((line) => /Hall Stage|Studio Stage/i.test(line)) || source.venueName;
    const normalized = normalizeEvent(source, {
      title,
      startAt: localIso(range.start, null, true),
      endAt: localIso(range.end, null, true),
      allDay: true,
      venueName: stage,
      address: source.venueAddress,
      city: "Halifax",
      categories: ["Arts"],
      eventUrl: source.url,
      sourceUrl: source.url
    });
    if (normalized) events.push(normalized);
  }
  return events;
}

async function importSportsBulletSchedule(source) {
  const page = await fetchText(source.url);
  const text = cleanText(page.text);
  const year = Number(source.scheduleYear || new Date().getUTCFullYear());
  const events = [];
  const pattern = new RegExp(`(?:${WEEKDAYS})\\s*,?\\s*(${MONTHS})\\s+(\\d{1,2})\\s*[-–—]\\s*(\\d{1,2}(?::\\d{2})?\\s*(?:AM|PM))\\s*:\\s*([^\\n]+)`, "gi");
  for (const match of text.matchAll(pattern)) {
    const date = `${match[1]} ${match[2]}, ${year}`;
    const time = match[3];
    const title = cleanText(match[4]).replace(/\s+/g, " ").trim();
    if (!title || (source.teamToken && !normalize(title).includes(normalize(source.teamToken)))) continue;
    const normalized = normalizeEvent(source, {
      title,
      startAt: localIso(date, time, false),
      endAt: localIso(date, time, false),
      venueName: source.venueName,
      address: source.venueAddress,
      city: "Halifax",
      categories: ["Sports"],
      eventUrl: source.url,
      sourceUrl: source.url
    });
    if (normalized) events.push(normalized);
  }
  return events;
}

function jsonScripts(html) {
  const values = [];
  for (const match of String(html).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/application\/json|__NEXT_DATA__|ld\+json/i.test(match[1])) continue;
    try { values.push(JSON.parse(match[2].trim())); } catch {}
  }
  return values;
}
function objectTeamName(value) {
  if (!value) return null;
  if (typeof value === "string") return cleanText(value);
  return cleanText(value.name || value.shortName || value.fullName || value.displayName || value.teamName || value.nickname || "") || null;
}
function objectDate(obj) {
  for (const key of ["startDate", "start_date", "date", "datetime", "dateTime", "start", "startTime", "start_time", "scheduled", "scheduledAt", "utcStartTime", "gameDate", "matchDate", "timestamp"]) if (obj?.[key] && validDate(obj[key])) return obj[key];
  return null;
}
function objectUrl(obj, base) {
  for (const key of ["url", "href", "link", "permalink", "ticketUrl", "ticketsUrl"]) {
    const value = safeUrl(obj?.[key], base);
    if (value) return value;
  }
  return null;
}
function walkEmbedded(value, source, pageUrl, events, seen = new Set(), depth = 0) {
  if (!value || depth > 14) return;
  if (Array.isArray(value)) { for (const item of value) walkEmbedded(item, source, pageUrl, events, seen, depth + 1); return; }
  if (typeof value !== "object") return;
  const date = objectDate(value);
  if (date) {
    const home = objectTeamName(value.homeTeam || value.home || value.home_team || value.homeCompetitor);
    const away = objectTeamName(value.awayTeam || value.away || value.away_team || value.awayCompetitor);
    const title = cleanText(value.title || value.name || value.eventName || value.matchName || (home && away ? `${away} at ${home}` : ""));
    if (title) {
      const key = `${title}|${date}|${home || ""}|${away || ""}`;
      if (!seen.has(key)) {
        seen.add(key);
        const homeTokens = source.homeTeamTokens || [];
        const isHome = !homeTokens.length || homeTokens.some((token) => normalize(home).includes(normalize(token)));
        if (source.kind !== "official_sports_schedule" || isHome) {
          const location = value.venue || value.location || {};
          const normalized = normalizeEvent(source, {
            title,
            startAt: date,
            endAt: value.endDate || value.end || date,
            venueName: locationName(location) || source.venueName,
            address: addressText(location) || source.venueAddress,
            city: "Halifax",
            categories: source.kind === "official_sports_schedule" ? ["Sports"] : categoriesFromText(title),
            eventUrl: objectUrl(value, pageUrl) || pageUrl,
            sourceUrl: pageUrl
          });
          if (normalized) events.push(normalized);
        }
      }
    }
  }
  for (const child of Object.values(value)) if (child && typeof child === "object") walkEmbedded(child, source, pageUrl, events, seen, depth + 1);
}
async function importEmbeddedEventData(source) {
  const page = await fetchText(source.url);
  const events = parseJsonLdEvents(page.text, source, page.resolvedUrl);
  const seen = new Set();
  for (const payload of jsonScripts(page.text)) walkEmbedded(payload, source, page.resolvedUrl, events, seen);
  return events;
}

function dedupe(events) {
  const byKey = new Map();
  for (const event of events) {
    const key = `${normalize(event.title)}|${dateOnly(event.startAt)}|${normalize(event.venueName || event.address || "halifax")}`;
    const existing = byKey.get(key);
    if (!existing) { byKey.set(key, event); continue; }
    const winner = (event.sourcePriority || 0) > (existing.sourcePriority || 0) ? event : existing;
    const loser = winner === event ? existing : event;
    winner.categories = [...new Set([...(winner.categories || []), ...(loser.categories || [])])];
    winner.alternateSources = [...(winner.alternateSources || []), { sourceId: loser.sourceId, sourceName: loser.sourceName, sourceUrl: loser.sourceUrl }]
      .filter((item, index, all) => all.findIndex((other) => other.sourceId === item.sourceId && other.sourceUrl === item.sourceUrl) === index);
    winner.ticketUrl ||= loser.ticketUrl;
    winner.price ||= loser.price;
    winner.address ||= loser.address;
    winner.venueName ||= loser.venueName;
    byKey.set(key, winner);
  }
  return [...byKey.values()].sort((a, b) => a.startAt.localeCompare(b.startAt) || a.title.localeCompare(b.title));
}

const allEvents = [];
const failures = [];
const sourceStats = [];
for (const source of [...sources].sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))) {
  const started = Date.now();
  try {
    let events = [];
    if (source.mode === "tourism_event_crawl") events = await importTourismEventCrawl(source);
    else if (source.mode === "tribe_list_crawl") events = await importTribeListCrawl(source);
    else if (source.mode === "scotiabank_calendar") events = await importScotiabankCalendar(source);
    else if (source.mode === "mooseheads_home_table") events = await importMooseheadsHomeTable(source);
    else if (source.mode === "lighthouse_index") events = await importLighthouseIndex(source);
    else if (source.mode === "html_calendar") events = await importHtmlCalendar(source);
    else if (source.mode === "neptune_season") events = await importNeptuneSeason(source);
    else if (source.mode === "sports_bullet_schedule") events = await importSportsBulletSchedule(source);
    else if (source.mode === "embedded_event_data") events = await importEmbeddedEventData(source);
    else throw new Error(`unsupported_mode_${source.mode}`);
    allEvents.push(...events);
    sourceStats.push({ sourceId: source.id, sourceName: source.name, mode: source.mode, observedAt: new Date().toISOString(), eventCount: events.length, durationMs: Date.now() - started, status: "ok" });
    console.log(`${source.name}: ${events.length} Halifax events.`);
  } catch (error) {
    failures.push({ sourceId: source.id, sourceName: source.name, url: source.url, reason: error.message, observedAt: new Date().toISOString() });
    sourceStats.push({ sourceId: source.id, sourceName: source.name, mode: source.mode, observedAt: new Date().toISOString(), eventCount: 0, durationMs: Date.now() - started, status: "failed", reason: error.message });
    console.warn(`${source.name}: ${error.message}`);
  }
}

const events = dedupe(allEvents).map((event) => {
  const { sourcePriority, ...publicEvent } = event;
  return publicEvent;
});
const categoryCounts = {};
for (const event of events) for (const category of event.categories || []) categoryCounts[category] = (categoryCounts[category] || 0) + 1;
const payload = {
  version: 2,
  generatedAt: new Date().toISOString(),
  range: { start: new Date(minStamp).toISOString(), end: new Date(maxStamp).toISOString() },
  eventCount: events.length,
  categoryCounts,
  sourceStats,
  failures,
  events
};
await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(new URL("../data/build/city-events.json", import.meta.url), JSON.stringify(payload, null, 2));
await writeFile(new URL("../data/city-events.js", import.meta.url), `window.HALIFAX_CITY_EVENTS = ${JSON.stringify(payload, null, 2)};\n`);
console.log(`Halifax city event import complete: raw=${allEvents.length}, deduped=${events.length}, failures=${failures.length}.`);
console.log(`Categories: ${Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).map(([key, value]) => `${key}=${value}`).join(", ")}`);
