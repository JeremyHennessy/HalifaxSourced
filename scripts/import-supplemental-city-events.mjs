import { fetchGuardedSource as fetch } from "./lib/fetch-public-source.mjs";
import { createHash } from "node:crypto";
import { canonicalEventKey, dedupeCanonicalEvents } from "./lib/canonical-event-dedupe.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";

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
function collapseExactRepeatedWords(value) {
  const title = inline(value);
  const words = title.split(/\s+/);
  if (words.length >= 4 && words.length % 2 === 0) {
    const half = words.length / 2;
    if (words.slice(0, half).join(" ") === words.slice(half).join(" ")) return words.slice(0, half).join(" ");
  }
  return title;
}
function libraryDisplayTitle(value) {
  const title = inline(value);
  const featured = title.match(/^(.+?)\s+Featured Event\.\s+(.+)$/i);
  if (featured && featured[1] === featured[2] && featured[1].split(/\s+/).length >= 2) return featured[1];
  return collapseExactRepeatedWords(title).replace(/^Featured Event\.\s*/i, "");
}
function absoluteUrl(value, base) {
  // An absent ticket URL is not a link to the source calendar.
  if (value == null || !String(value).trim()) return null;
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
function descendingPageNumbers(totalPages, pageLimit) {
  const count = Math.max(1, Math.min(Number(totalPages) || 1, Number(pageLimit) || 1));
  return Array.from({ length: count }, (_, index) => count - index);
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
    // An explicitly unknown end is evidence, not a zero-duration performance.
    endAt: Object.hasOwn(raw, "endAt") ? raw.endAt : raw.startAt,
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
  if (/\bmarkets?\b/.test(text)) return ["Markets", "Community"];
  if (/\b(?:movies?|films?|documentary|authors?|writing|arts?|gallery|theatre|drama|craft(?:s|ers|ing)?|stitch(?:ing)?|knit(?:ting)?)\b/.test(text)) return ["Arts", "Community"];
  if (/\b(?:music|concerts?|sing(?:s|ing|ers?|along)?|songs?|dance|dancing)\b/.test(text)) return ["Music", "Arts"];
  if (/\b(?:food|cook(?:ing)?|tea|cafe)\b/.test(text)) return ["Food & Drink", "Community"];
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
  // Bound each heading before looking for a link. A non-linked filter heading
  // must not consume a season link and the first concert's heading.
  const headingMatches = [...page.text.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)];
  const events = [];
  for (let index = 0; index < headingMatches.length; index += 1) {
    const current = headingMatches[index];
    const link = current[1].match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const nextIndex = headingMatches[index + 1]?.index ?? page.text.length;
    const block = clean(page.text.slice(current.index, nextIndex));
    const title = inline(link[2]);
    const venue = allowedSymphonyVenue(block);
    if (!title || !venue) continue;
    const regex = /(\d{1,2}:\d{2})\s*(am|pm)\s*[•·]\s*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2})/gi;
    for (const dateMatch of block.matchAll(regex)) {
      const month = monthNumber(dateMatch[3]);
      const { hour, minute } = timeParts(dateMatch[1], dateMatch[2]);
      const startAt = zonedIso(Number(dateMatch[5]), month, Number(dateMatch[4]), hour, minute);
      // The index lists performance starts only; it supplies no running time.
      const event = makeEvent(source, { title, startAt, endAt: null, venueName: venue[0], city: venue[1], categories: ["Music", "Arts"], eventUrl: absoluteUrl(link[1], page.resolvedUrl) });
      if (event) events.push(event);
    }
  }
  return events;
}

function libraryWhen(block) {
  const timed = block.match(/\bon\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2})\s*,\s+(\d{1,2}:\d{2})(am|pm)(?:\s*[-–]\s*(\d{1,2}:\d{2})(am|pm))?/i);
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

// Parse only closed publisher result cards. A heading-to-heading slice can
// borrow dates from the next card (whose metadata may precede its heading).
// This deliberately fails closed on unknown markup; diagnostics contain counts,
// never scraped HTML or description bodies.
function libraryEventCards(html, pageUrl) {
  const text = String(html);
  const root = { tag: "root", children: [], start: 0, end: text.length };
  const stack = [root];
  const nodes = [];
  const token = /<!--[\s\S]*?-->|<(?:[^>"']|"[^"]*"|'[^']*')+>/g;
  const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  for (const match of text.matchAll(token)) {
    const raw = match[0];
    if (/^<!/.test(raw)) continue;
    const parsed = raw.match(/^<\s*(\/?)\s*([a-z][\w:-]*)/i);
    if (!parsed) continue;
    const tag = parsed[2].toLowerCase();
    if (["script", "style"].includes(stack.at(-1).tag) && !(parsed[1] && tag === stack.at(-1).tag)) continue;
    if (parsed[1]) {
      const index = stack.findLastIndex(node => node.tag === tag);
      if (index > 0) {
        // Mismatched/unclosed descendants are not usable card evidence.
        const node = stack[index];
        node.end = match.index + raw.length;
        node.innerEnd = match.index;
        stack.length = index;
      }
      continue;
    }
    const attrs = {};
    for (const attr of raw.slice(parsed[0].length).matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs[attr[1].toLowerCase()] = attr[2] ?? attr[3] ?? attr[4];
    const parent = stack.at(-1);
    const node = { tag, attrs, parent, children: [], start: match.index, innerStart: match.index + raw.length };
    parent.children.push(node);
    nodes.push(node);
    if (!voidTags.has(tag) && !/\/\s*>$/.test(raw)) stack.push(node);
  }
  const descendants = (node, tag) => nodes.filter(other => {
    if (other.tag !== tag || other.end == null) return false;
    for (let parent = other.parent; parent; parent = parent.parent) if (parent === node) return true;
    return false;
  });
  const counts = { headings: 0, nonDetailLinks: 0, unboundedCards: 0, ambiguousCards: 0 };
  const cards = [];
  for (const heading of nodes.filter(node => node.tag === "h3" && node.end != null)) {
    counts.headings++;
    const links = descendants(heading, "a").map(link => {
      const url = absoluteUrl(clean(link.attrs.href || ""), pageUrl);
      if (!url) return null;
      const parsed = new URL(url);
      const publisher = new URL(pageUrl);
      if (parsed.origin !== publisher.origin || !publisher.hostname.endsWith(".bibliocommons.com") || parsed.username || parsed.password || !/^\/(?:v2\/)?events\/[a-f0-9]{24}\/?$/i.test(parsed.pathname)) return null;
      return { url, titleHtml: text.slice(link.innerStart, link.innerEnd) };
    }).filter(Boolean);
    if (links.length !== 1) { counts.nonDetailLinks++; continue; }
    let card = heading.parent;
    while (card !== root && !(card.tag === "li" || card.tag === "article" || /(?:^|\s)(?:cp-)?(?:events?-search-result|event-card|event-item|event-row)(?:\s|$)/i.test(card.attrs.class || ""))) card = card.parent;
    if (card === root || card.end == null) { counts.unboundedCards++; continue; }
    if (descendants(card, "h3").length !== 1) { counts.ambiguousCards++; continue; }
    cards.push({ ...links[0], html: text.slice(card.innerStart, card.innerEnd) });
  }
  return { cards, counts };
}

const libraryParserDiagnostics = [];

async function importLibraries(source) {
  const allowedLocations = source.allowedLocations || {};
  const events = [];
  const firstUrl = `${source.url}${source.url.includes("?") ? "&" : "?"}page=1`;
  const firstPage = await fetchHtml(firstUrl);
  const firstPlain = clean(firstPage.text);
  const totalMatch = firstPlain.match(/\b\d+\s+to\s+\d+\s+of\s+([\d,]+)\s+items\b/i);
  const expectedPages = totalMatch
    ? Math.ceil(Number(totalMatch[1].replace(/,/g, "")) / 20)
    : 1;
  // BiblioCommons removes ended events from the front of the live result set.
  // Walking upward then skips records as every later offset shifts left. Start
  // at the last page and walk backward so those shifts only create duplicates,
  // which the established event dedupe removes.
  for (const pageNumber of descendingPageNumbers(expectedPages, libraryPageLimit)) {
    const url = `${source.url}${source.url.includes("?") ? "&" : "?"}page=${pageNumber}`;
    const page = pageNumber === 1 ? firstPage : await fetchHtml(url);
    const parsed = libraryEventCards(page.text, page.resolvedUrl);
    const diagnostic = { sourceId: source.id, pageNumber, ...parsed.counts, cards: parsed.cards.length, missingOccurrence: 0, missingLocation: 0, emitted: 0 };
    libraryParserDiagnostics.push(diagnostic);
    for (const current of parsed.cards) {
      const block = clean(current.html);
      if (/\bcancelled\b/i.test(block)) continue;
      // The legacy parsed title is part of makeEvent's durable ID seed. Repair
      // presentation separately so this badge fix cannot rename saved events.
      const identityTitle = collapseExactRepeatedWords(current.titleHtml).replace(/^Featured Event\.\s*/i, "");
      const title = libraryDisplayTitle(current.titleHtml);
      const location = Object.entries(allowedLocations).find(([name]) => block.includes(name));
      if (!title || !location) { diagnostic.missingLocation++; continue; }
      const when = libraryWhen(block);
      if (!when) { diagnostic.missingOccurrence++; continue; }
      const event = makeEvent(source, { ...when, title: identityTitle, venueName: location[0], city: location[1], categories: libraryCategories(block, title), eventUrl: current.url });
      if (event) { event.title = title.slice(0, 240); events.push(event); diagnostic.emitted++; }
    }
    if (libraryDelayMs) await sleep(libraryDelayMs);
  }
  return events;
}

function collectedEventKey(event) {
  const canonical = canonicalEventKey(event);
  if (canonical) return canonical;
  // Other adapters may repeat a row across pages. Require the same durable ID,
  // source, exact occurrence and event URL; a title/day/venue is not identity.
  const stamp = Date.parse(event.startAt);
  return event.id && event.sourceId && event.eventUrl && Number.isFinite(stamp)
    ? JSON.stringify([event.id, event.sourceId, event.eventUrl, stamp])
    : null;
}

function dedupe(items) {
  // Keep the established official-source preference, but only merge rows that
  // share a strict occurrence identity. Stable sorting preserves source order
  // among equally authoritative rows and never mutates the collected input.
  const preferred = items.slice().sort((a, b) =>
    Number((b.sourceKind || "").startsWith("official")) - Number((a.sourceKind || "").startsWith("official")));
  return dedupeCanonicalEvents(preferred, collectedEventKey)
    .sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)) || String(a.title).localeCompare(String(b.title)));
}

const supplemental = [];
const sourceStats = [];
const failures = [];
for (const source of sources) {
  if (source.enabled === false) {
    // A known access restriction is not permission to retry on every schedule.
    // Carry accepted evidence unchanged, including its original clocks.
    const retained = (payload.events || []).filter(event => event.sourceId === source.id);
    const previous = (payload.sourceStats || []).find(stat => stat.sourceId === source.id);
    const lastAttemptAt = source.accessReview?.lastAttemptAt || previous?.lastAttemptAt || previous?.observedAt || null;
    const reason = source.disabledReason || "source_disabled";
    supplemental.push(...retained);
    sourceStats.push({sourceId: source.id, sourceName: source.name, status: "blocked", attempted: false, reason, eventCount: retained.length, observedAt: previous?.observedAt || null, lastAttemptAt, resumeWhen: source.accessReview?.resumeWhen || "Explicit source review required"});
    failures.push({sourceId: source.id, sourceName: source.name, url: source.url, status: "blocked", attempted: false, reason, observedAt: lastAttemptAt});
    console.log(`${source.name}: blocked (${reason}); zero requests, ${retained.length} accepted events retained.`);
    continue;
  }
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
await mkdir(new URL("../artifacts/", import.meta.url), { recursive: true });
await writeFile(new URL("../artifacts/library-event-parser-report.json", import.meta.url), JSON.stringify({ version: 1, pages: libraryParserDiagnostics }, null, 2));
await writeFile(payloadUrl, JSON.stringify(output, null, 2));
await writeFile(jsUrl, `window.HALIFAX_CITY_EVENTS = ${JSON.stringify(output, null, 2)};\n`);
console.log(`Supplemental city events: collected=${supplemental.length}, merged-total=${events.length}, failures=${failures.length}.`);
