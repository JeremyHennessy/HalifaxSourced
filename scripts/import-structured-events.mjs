import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const signalsPath = new URL("../data/build/official-site-signals.json", import.meta.url);
const outputJson = new URL("../data/build/structured-events.json", import.meta.url);
const outputJs = new URL("../data/structured-events.js", import.meta.url);
const pageLimit = Number(process.env.STRUCTURED_EVENT_PAGE_LIMIT ?? 180);
const perRestaurantLimit = Number(process.env.STRUCTURED_EVENT_PAGES_PER_RESTAURANT ?? 3);
const delayMs = Number(process.env.STRUCTURED_EVENT_DELAY_MS ?? 400);
const userAgent = "HalifaxSourced/0.2 (+https://github.com/JeremyHennessy/HalifaxSourced)";
const now = Date.now();
const earliest = now - 12 * 60 * 60 * 1000;
const latest = now + 370 * 24 * 60 * 60 * 1000;

const payload = JSON.parse(await readFile(signalsPath, "utf8"));
const signals = Array.isArray(payload?.results) ? payload.results : [];
const robotsCache = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeUrl(value, base) {
  try {
    const url = new URL(String(value ?? ""), base);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function hostKey(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

function sameSite(a, b) {
  return hostKey(a) && hostKey(a) === hostKey(b);
}

function token(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function decodeText(value) {
  return String(value ?? "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRobotsGroup(text, wantedAgent) {
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
  const specific = groups.find((group) => group.agents.some((agent) => agent.includes(wantedAgent.toLowerCase())));
  const wildcard = groups.find((group) => group.agents.includes("*"));
  return (specific || wildcard)?.disallow ?? [];
}

async function robotsAllows(url) {
  const parsed = new URL(url);
  const origin = parsed.origin;
  if (!robotsCache.has(origin)) {
    const promise = (async () => {
      try {
        const response = await fetch(new URL("/robots.txt", origin), { headers: { "User-Agent": userAgent } });
        if (response.status === 401 || response.status === 403) return ["/"];
        if (!response.ok) return [];
        return parseRobotsGroup(await response.text(), "HalifaxSourced");
      } catch {
        return [];
      }
    })();
    robotsCache.set(origin, promise);
  }
  const disallow = await robotsCache.get(origin);
  return !disallow.some((prefix) => prefix === "/" || parsed.pathname.startsWith(prefix));
}

function eventType(node) {
  const types = Array.isArray(node?.["@type"]) ? node["@type"] : [node?.["@type"]];
  return types.map(String).find((type) => /Event$/i.test(type) && !/(Status|Reservation)Event$/i.test(type)) || null;
}

function walkJson(node, output) {
  if (!node || typeof node !== "object") return;
  if (eventType(node)) output.push(node);
  if (Array.isArray(node)) {
    for (const child of node) walkJson(child, output);
    return;
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") walkJson(value, output);
  }
}

function jsonLdEvents(html) {
  const events = [];
  const pattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    const raw = match[1].trim().replace(/^<!--/, "").replace(/-->$/, "").trim();
    if (!raw) continue;
    try { walkJson(JSON.parse(raw), events); } catch {}
  }
  return events;
}

function normalizeDate(value) {
  const stamp = Date.parse(String(value ?? ""));
  return Number.isFinite(stamp) ? new Date(stamp).toISOString() : null;
}

function locationName(event, fallback) {
  const location = Array.isArray(event.location) ? event.location[0] : event.location;
  return decodeText(location?.name || fallback || "Halifax");
}

function eventStatus(event) {
  const raw = String(event.eventStatus ?? "");
  return token(raw.split(/[\/#]/).pop());
}

function eventId(record) {
  return `evt-${createHash("sha256").update(`${record.restaurantId}|${record.title}|${record.startAt}|${record.sourceUrl}`).digest("hex").slice(0, 18)}`;
}

function normalizeEvent(event, context) {
  const type = eventType(event);
  const title = decodeText(event.name);
  const startAt = normalizeDate(event.startDate);
  const endAt = normalizeDate(event.endDate) || startAt;
  const status = eventStatus(event);
  if (!type || !title || !startAt) return null;
  const startStamp = Date.parse(startAt);
  const endStamp = Date.parse(endAt);
  if (Math.max(startStamp, endStamp) < earliest || startStamp > latest) return null;
  if (/cancelled|canceled|postponed/.test(status)) return null;
  const eventUrl = safeUrl(event.url, context.pageUrl);
  const record = {
    restaurantId: context.restaurantId,
    title,
    eventType: type,
    startAt,
    endAt,
    venueName: locationName(event, context.restaurantName),
    eventUrl,
    sourceUrl: context.pageUrl,
    sourceKind: "official_jsonld",
    observedAt: context.observedAt,
    validFrom: startAt,
    validTo: endAt,
    confidence: "structured-official",
    reviewState: "verified",
    notes: "JSON-LD Event extracted from a restaurant-owned page."
  };
  return { id: eventId(record), ...record };
}

function candidatePages(signal) {
  const website = safeUrl(signal.website);
  if (!website) return [];
  const urls = [];
  if ((signal.signalMatches?.events?.length ?? 0) > 0) urls.push(website);
  for (const link of signal.candidateLinks ?? []) {
    if ((link.signalMatches?.events?.length ?? 0) === 0) continue;
    const href = safeUrl(link.href, website);
    if (href && sameSite(href, website)) urls.push(href);
  }
  return [...new Set(urls)].slice(0, perRestaurantLimit);
}

const pages = [];
for (const signal of signals) {
  for (const url of candidatePages(signal)) {
    pages.push({ restaurantId: signal.restaurantId, restaurantName: signal.name, pageUrl: url });
    if (pages.length >= pageLimit) break;
  }
  if (pages.length >= pageLimit) break;
}

const events = [];
const failures = [];
let scannedPages = 0;
for (const page of pages) {
  if (!(await robotsAllows(page.pageUrl))) {
    failures.push({ ...page, reason: "robots_disallow" });
    continue;
  }
  await sleep(delayMs);
  const observedAt = new Date().toISOString();
  try {
    const response = await fetch(page.pageUrl, { headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml" }, redirect: "follow" });
    if (!response.ok) {
      failures.push({ ...page, reason: `http_${response.status}` });
      continue;
    }
    const contentType = response.headers.get("content-type") || "";
    if (!/html|xhtml/i.test(contentType)) {
      failures.push({ ...page, reason: "not_html" });
      continue;
    }
    const html = await response.text();
    scannedPages += 1;
    for (const event of jsonLdEvents(html)) {
      const normalized = normalizeEvent(event, { ...page, pageUrl: response.url || page.pageUrl, observedAt });
      if (normalized) events.push(normalized);
    }
  } catch (error) {
    failures.push({ ...page, reason: error.message });
  }
}

const uniqueEvents = events
  .filter((event, index, all) => all.findIndex((candidate) => candidate.restaurantId === event.restaurantId && candidate.title === event.title && candidate.startAt === event.startAt) === index)
  .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.title.localeCompare(b.title));

const output = {
  version: 1,
  generatedAt: new Date().toISOString(),
  scannedPages,
  failedPages: failures.length,
  failures: failures.slice(0, 100),
  events: uniqueEvents
};

await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(outputJson, JSON.stringify(output, null, 2));
await writeFile(outputJs, `window.HALIFAX_STRUCTURED_EVENTS = ${JSON.stringify(output, null, 2)};\n`);
console.log(`Structured event scan: pages=${scannedPages}, failures=${failures.length}, events=${uniqueEvents.length}.`);
