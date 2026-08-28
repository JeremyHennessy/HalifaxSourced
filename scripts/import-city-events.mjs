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
const userAgent = "HalifaxSourced/0.5 (+https://github.com/JeremyHennessy/HalifaxSourced)";
const robotsCache = new Map();

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function safeUrl(value, base) {
  try {
    const url = new URL(String(value ?? ""), base);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}
function cleanText(value) {
  return String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
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
function normalize(value) {
  return String(value ?? "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}
function validDate(value) { return Number.isFinite(Date.parse(String(value ?? ""))); }
function inWindow(value) {
  const stamp = Date.parse(String(value ?? ""));
  return Number.isFinite(stamp) && stamp >= minStamp && stamp <= maxStamp;
}
function dateOnly(value) {
  const stamp = Date.parse(String(value ?? ""));
  return Number.isFinite(stamp) ? new Date(stamp).toISOString().slice(0, 10) : "";
}
function hashId(value) { return createHash("sha256").update(value).digest("hex").slice(0, 16); }
function sourceEventId(source, event) {
  return `${source.id}-${hashId(`${event.eventUrl || event.sourceUrl || source.url}|${event.title}|${event.startAt}`)}`;
}

function parseRobots(text) {
  const groups = [];
  let current = null;
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
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
async function getText(url) {
  if (!(await robotsAllows(url))) throw new Error("robots_disallow");
  const response = await fetch(url, {
    headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5" },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`http_${response.status}`);
  return { text: await response.text(), resolvedUrl: response.url || url, contentType: response.headers.get("content-type") || "" };
}
async function getJson(url) {
  if (!(await robotsAllows(url))) throw new Error("robots_disallow");
  const response = await fetch(url, {
    headers: { "User-Agent": userAgent, Accept: "application/json" },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`http_${response.status}`);
  return response.json();
}

function categoriesFromText(...parts) {
  const text = parts.flat().filter(Boolean).join(" ").toLowerCase();
  const categories = [];
  const add = (name, regex) => { if (regex.test(text)) categories.push(name); };
  add("Sports", /sport|soccer|football|hockey|lacrosse|basketball|baseball|rugby|paddl|race|run\b|marathon|game\b|match\b/);
  add("Music", /music|concert|band|singer|songwriter|orchestra|symphony|dj\b|album|jazz|rock\b|folk\b|country|hip hop|opera/);
  add("Food & Drink", /food|drink|beer|wine|cocktail|tasting|dinner|brunch|culinary|brew|restaurant|chef/);
  add("Festivals", /festival|fest\b|fringe|celebration|convention|expo|fair\b/);
  add("Markets", /market|vendor|craft fair|night market|farmers/);
  add("Arts", /art\b|arts|theatre|theater|dance|film|cinema|gallery|museum|performance|play\b/);
  add("Comedy", /comedy|comedian|stand[ -]?up|improv/);
  add("Outdoor", /outdoor|park\b|harbour|harbor|waterfront|trail|garden|beach/);
  add("Community", /community|family|parade|heritage|culture|cultural|pride/);
  return [...new Set(categories.length ? categories : ["Other"])];
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
  if (typeof location === "string") return location;
  return cleanText(location.name || location.venue || location.title || "") || null;
}
function isHalifaxEvent(event, source) {
  if (source.kind === "official_venue_calendar" || source.kind === "official_sports_schedule") return true;
  const haystack = [event.city, event.region, event.venueName, event.address, event.title].filter(Boolean).join(" ").toLowerCase();
  return ["halifax", "dartmouth", "bedford", "halifax metro"].some((term) => haystack.includes(term));
}
function normalizeEvent(source, raw) {
  const title = cleanText(raw.title || raw.name || "").replace(/\s+/g, " ").trim();
  const startAt = validDate(raw.startAt) ? new Date(Date.parse(raw.startAt)).toISOString() : null;
  const endAt = validDate(raw.endAt) ? new Date(Date.parse(raw.endAt)).toISOString() : startAt;
  if (!title || !startAt || !inWindow(endAt || startAt)) return null;
  const eventUrl = safeUrl(raw.eventUrl || raw.url || raw.sourceUrl, source.url);
  const sourceUrl = safeUrl(raw.sourceUrl || eventUrl || source.url, source.url);
  if (!sourceUrl) return null;
  const venueName = cleanText(raw.venueName || source.venueName || "") || null;
  const address = cleanText(raw.address || source.venueAddress || "") || null;
  const city = cleanText(raw.city || "") || (address && /dartmouth/i.test(address) ? "Dartmouth" : address && /bedford/i.test(address) ? "Bedford" : "Halifax");
  const categories = [...new Set([...(raw.categories || []), ...categoriesFromText(raw.categories || [], title, venueName)])];
  const event = {
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
  return isHalifaxEvent(event, source) ? event : null;
}

function flattenJsonLd(value, out = []) {
  if (!value) return out;
  if (Array.isArray(value)) { for (const item of value) flattenJsonLd(item, out); return out; }
  if (typeof value !== "object") return out;
  if (value["@graph"]) flattenJsonLd(value["@graph"], out);
  out.push(value);
  return out;
}
function parseJsonLdEvents(html, source, pageUrl) {
  const events = [];
  for (const match of String(html).matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      for (const item of flattenJsonLd(parsed)) {
        const types = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
        if (!types.some((type) => /Event$/i.test(String(type || "")))) continue;
        const location = item.location || item.location?.[0];
        const address = addressText(location);
        const normalized = normalizeEvent(source, {
          id: item["@id"] || null,
          title: item.name,
          startAt: item.startDate,
          endAt: item.endDate || item.startDate,
          allDay: !String(item.startDate || "").includes("T"),
          venueName: locationName(location),
          address,
          city: typeof location?.address === "object" ? location.address.addressLocality : null,
          categories: [item.eventAttendanceMode, item.eventStatus].filter(Boolean),
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

async function importTribeApi(source) {
  const events = [];
  const startDate = new Date(minStamp).toISOString().slice(0, 10);
  const endDate = new Date(maxStamp).toISOString().slice(0, 10);
  for (let page = 1; page <= 20; page += 1) {
    const url = new URL(source.endpoint);
    url.searchParams.set("start_date", startDate);
    url.searchParams.set("end_date", endDate);
    url.searchParams.set("per_page", "50");
    url.searchParams.set("page", String(page));
    const payload = await getJson(url.href);
    const rows = Array.isArray(payload?.events) ? payload.events : [];
    for (const row of rows) {
      const venue = row.venue || {};
      const categoryNames = (row.categories || []).map((category) => category.name || category.slug).filter(Boolean);
      const normalized = normalizeEvent(source, {
        id: row.id ? `${source.id}-${row.id}` : null,
        title: row.title,
        startAt: row.start_date || row.start_date_details?.year,
        endAt: row.end_date || row.start_date,
        allDay: row.all_day,
        venueName: venue.venue,
        address: [venue.address, venue.city, venue.province, venue.zip].filter(Boolean).join(", "),
        city: venue.city,
        categories: categoryNames,
        price: row.cost,
        ticketUrl: row.website,
        eventUrl: row.url,
        sourceUrl: row.url
      });
      if (normalized) events.push(normalized);
    }
    const totalPages = Number(payload?.total_pages || payload?.totalPages || 0);
    if (!rows.length || (totalPages && page >= totalPages) || rows.length < 50) break;
  }
  return events;
}

function candidateEventLinks(html, baseUrl) {
  const baseHost = new URL(baseUrl).hostname.replace(/^www\./, "");
  const links = [];
  const seen = new Set();
  for (const match of String(html).matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = safeUrl(match[1], baseUrl);
    const label = cleanText(match[2]).replace(/\s+/g, " ").trim();
    if (!url || !label || label.length < 3 || label.length > 180) continue;
    const parsed = new URL(url);
    const sameHost = parsed.hostname.replace(/^www\./, "") === baseHost;
    if (!sameHost) continue;
    if (!/event|events|show|concert|performance|calendar|music|ticket/i.test(`${parsed.pathname} ${label}`)) continue;
    if (/^(events?|calendar|learn more|read more|view event|buy tickets?|tickets?)$/i.test(label)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    links.push({ url, label });
  }
  return links.slice(0, 120);
}

async function importJsonLdIndex(source) {
  const { text, resolvedUrl } = await getText(source.url);
  const events = parseJsonLdEvents(text, source, resolvedUrl);
  if (events.length) return events;
  const candidates = candidateEventLinks(text, resolvedUrl);
  for (let index = 0; index < candidates.length; index += 8) {
    const batch = candidates.slice(index, index + 8);
    const results = await Promise.all(batch.map(async (candidate) => {
      try {
        const page = await getText(candidate.url);
        return parseJsonLdEvents(page.text, source, page.resolvedUrl);
      } catch { return []; }
    }));
    events.push(...results.flat());
    await sleep(100);
  }
  return events;
}

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
function atlanticOffset(year, month, day) {
  const secondSundayMarch = (() => { const d = new Date(Date.UTC(year, 2, 1)); return 1 + ((7 - d.getUTCDay()) % 7) + 7; })();
  const firstSundayNovember = (() => { const d = new Date(Date.UTC(year, 10, 1)); return 1 + ((7 - d.getUTCDay()) % 7); })();
  const dst = month > 3 && month < 11 || (month === 3 && day >= secondSundayMarch) || (month === 11 && day < firstSundayNovember);
  return dst ? "-03:00" : "-04:00";
}
function localIso(dateText, timeText) {
  const date = new Date(`${dateText} 12:00:00 UTC`);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  let hour = 0;
  let minute = 0;
  if (timeText) {
    const match = String(timeText).match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (match) {
      hour = Number(match[1]);
      minute = Number(match[2] || 0);
      const suffix = String(match[3] || "").toLowerCase();
      if (suffix === "pm" && hour < 12) hour += 12;
      if (suffix === "am" && hour === 12) hour = 0;
    }
  }
  const pad = (value) => String(value).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00${atlanticOffset(year, month, day)}`;
}

function parseHtmlCalendar(html, source, pageUrl) {
  const events = [];
  const headings = [...String(html).matchAll(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/gi)];
  for (let index = 0; index < headings.length; index += 1) {
    const title = cleanText(headings[index][1]);
    if (!title || title.length < 3 || title.length > 180 || /upcoming performances|archives/i.test(title)) continue;
    const start = headings[index].index + headings[index][0].length;
    const end = index + 1 < headings.length ? headings[index + 1].index : Math.min(String(html).length, start + 4000);
    const block = String(html).slice(start, end);
    const text = cleanText(block);
    const dateMatch = text.match(new RegExp(`(${MONTHS})\\s+(\\d{1,2}),\\s+(20\\d{2})`, "i"));
    if (!dateMatch) continue;
    const timeMatch = text.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*(?:-|–|—|to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i) || text.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);
    const startAt = localIso(`${dateMatch[1]} ${dateMatch[2]}, ${dateMatch[3]}`, timeMatch?.[1]);
    const endAt = timeMatch?.[2] ? localIso(`${dateMatch[1]} ${dateMatch[2]}, ${dateMatch[3]}`, timeMatch[2]) : startAt;
    const linkMatch = block.match(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/i);
    const eventUrl = safeUrl(linkMatch?.[1], pageUrl) || pageUrl;
    const normalized = normalizeEvent(source, { title, startAt, endAt, venueName: source.venueName, address: source.venueAddress, eventUrl, sourceUrl: eventUrl, categories: categoriesFromText(title, text.slice(0, 500)) });
    if (normalized) events.push(normalized);
  }
  return events;
}
async function importHtmlCalendar(source) {
  const { text, resolvedUrl } = await getText(source.url);
  const jsonLd = parseJsonLdEvents(text, source, resolvedUrl);
  return [...jsonLd, ...parseHtmlCalendar(text, source, resolvedUrl)];
}

function categoryFromHalifaxEventsUrl(url) {
  const slug = new URL(url).pathname.split("/").filter(Boolean).at(-1) || "other";
  const map = { music: "Music", festivals: "Festivals", "food-drink": "Food & Drink", markets: "Markets", arts: "Arts", comedy: "Comedy", sports: "Sports", outdoor: "Outdoor" };
  return map[slug] || "Other";
}
function parseHalifaxEventsCategory(html, source, pageUrl, category) {
  const events = [];
  const seen = new Set();
  for (const match of String(html).matchAll(/<a\b[^>]*href\s*=\s*["']([^"']*\/things-to-do\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const eventUrl = safeUrl(match[1], pageUrl);
    const title = cleanText(match[2]);
    if (!eventUrl || !title || title.length < 3 || title.length > 180 || seen.has(eventUrl)) continue;
    seen.add(eventUrl);
    const around = String(html).slice(Math.max(0, match.index - 550), Math.min(String(html).length, match.index + match[0].length + 700));
    const text = cleanText(around);
    const dateMatch = text.match(new RegExp(`(${MONTHS})\\s+(\\d{1,2}),\\s+(20\\d{2})`, "i")) || text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    if (!dateMatch) continue;
    let dateText;
    if (/^20\d{2}$/.test(dateMatch[1])) dateText = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
    else dateText = `${dateMatch[1]} ${dateMatch[2]}, ${dateMatch[3]}`;
    const timeMatch = text.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);
    const startAt = localIso(dateText, timeMatch?.[1]);
    const venueMatch = text.match(/(?:am|pm)\s+([^\n]{2,90}?)(?:Music|Festivals|Food & Drink|Markets|Arts|Comedy|Sports|Outdoor|Free|Learn more|$)/i);
    const venueName = venueMatch ? venueMatch[1].trim() : null;
    const normalized = normalizeEvent(source, { title, startAt, endAt: startAt, venueName, city: "Halifax", categories: [category], eventUrl, sourceUrl: eventUrl });
    if (normalized) events.push(normalized);
  }
  return events;
}
async function importHalifaxEventsCategories(source) {
  const events = [];
  for (const url of source.categoryUrls || []) {
    try {
      const { text, resolvedUrl } = await getText(url);
      events.push(...parseJsonLdEvents(text, source, resolvedUrl));
      events.push(...parseHalifaxEventsCategory(text, source, resolvedUrl, categoryFromHalifaxEventsUrl(url)));
      await sleep(100);
    } catch {}
  }
  return events;
}

function jsonScripts(html) {
  const values = [];
  for (const match of String(html).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = match[1];
    if (!/application\/json|__NEXT_DATA__|ld\+json/i.test(attrs)) continue;
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
  const keys = ["startDate", "start_date", "date", "datetime", "dateTime", "start", "startTime", "start_time", "scheduled", "scheduledAt", "utcStartTime", "gameDate", "matchDate", "timestamp"];
  for (const key of keys) if (obj?.[key] && validDate(obj[key])) return obj[key];
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
  const { text, resolvedUrl } = await getText(source.url);
  const events = parseJsonLdEvents(text, source, resolvedUrl);
  const seen = new Set();
  for (const payload of jsonScripts(text)) walkEmbedded(payload, source, resolvedUrl, events, seen);
  return events;
}

function dedupe(events) {
  const byKey = new Map();
  for (const event of events) {
    const key = `${normalize(event.title)}|${dateOnly(event.startAt)}|${normalize(event.venueName || event.address || "halifax")}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, event);
      continue;
    }
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
for (const source of sources.sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))) {
  const started = Date.now();
  try {
    let events = [];
    if (source.mode === "tribe_api") events = await importTribeApi(source);
    else if (source.mode === "jsonld_index") events = await importJsonLdIndex(source);
    else if (source.mode === "html_calendar") events = await importHtmlCalendar(source);
    else if (source.mode === "halifaxevents_categories") events = await importHalifaxEventsCategories(source);
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
  version: 1,
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
