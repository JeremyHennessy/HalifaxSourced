import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { LIFECYCLE_SIGNAL_GROUPS } from "./lib/lifecycle-language.mjs";

const catalog = JSON.parse(await readFile(new URL("../data/build/catalog.json", import.meta.url), "utf8"));
const firstParty = JSON.parse(await readFile(new URL("../data/build/first-party-sources.json", import.meta.url), "utf8").catch(() => "{\"records\":[]}"));
const officialSignals = JSON.parse(await readFile(new URL("../data/build/official-site-signals.json", import.meta.url), "utf8").catch(() => "{\"results\":[]}"));
const restaurants = catalog.restaurants || [];
const restaurantById = new Map(restaurants.map((restaurant) => [restaurant.id, restaurant]));
const firstPartyById = new Map((firstParty.records || []).map((record) => [record.restaurantId, record]));
const officialById = new Map((officialSignals.results || []).map((record) => [record.restaurantId, record]));

const targetLimit = Number(process.env.PAGE_INTELLIGENCE_RESTAURANT_LIMIT ?? 9999);
const pageLimit = Number(process.env.PAGE_INTELLIGENCE_PAGE_LIMIT ?? 450);
const pagesPerRestaurant = Math.max(1, Math.min(10, Number(process.env.PAGE_INTELLIGENCE_PAGES_PER_RESTAURANT ?? 5)));
const delayMs = Number(process.env.PAGE_INTELLIGENCE_DELAY_MS ?? 140);
const timeoutMs = Number(process.env.PAGE_INTELLIGENCE_TIMEOUT_MS ?? 10000);
const concurrency = Math.max(1, Math.min(16, Number(process.env.PAGE_INTELLIGENCE_CONCURRENCY ?? 8)));
const summaryChars = Math.max(120, Math.min(700, Number(process.env.PAGE_INTELLIGENCE_SUMMARY_CHARS ?? 420)));
const userAgent = "HalifaxSourced/0.8 (+https://github.com/JeremyHennessy/HalifaxSourced)";
const robotsCache = new Map();

const signalGroups = {
  happy_hour: ["happy hour", "buck a shuck", "oyster hour", "half price", "drink special", "cocktail special"],
  specials: ["special", "specials", "daily feature", "feature menu", "deal", "deals", "offer", "offers", "promo", "promotion", "prix fixe", "limited time"],
  events: ["event", "events", "ticket", "tickets", "tasting", "dinner series", "pop-up", "popup", "collab", "guest chef", "festival"],
  live_music: ["live music", "dj", "karaoke", "show", "concert", "acoustic", "vinyl night", "open mic", "band", "trivia"],
  openings: ["now open", "opening soon", "grand opening", "soft opening", "new location", "coming soon", "newly opened", "reopening"],
  ...LIFECYCLE_SIGNAL_GROUPS,
  menu: ["menu", "new dish", "seasonal menu", "tasting menu", "new item", "feature dish", "chef special", "brunch menu", "dinner menu", "lunch menu"],
  patio: ["patio", "rooftop", "terrace", "outdoor seating", "beer garden", "sidewalk seating"],
  brunch: ["brunch", "breakfast", "eggs benny", "mimosa", "caesar bar"],
  seasonal: ["seasonal", "summer", "fall menu", "winter menu", "spring menu", "holiday", "new year's", "christmas"],
  reservations: ["reservation", "reservations", "book now", "book a table", "tables available", "walk-ins"]
};

const crawlNeedle = /(menu|menus|special|specials|happy|event|events|music|show|shows|calendar|news|blog|post|posts|updates|what.?s.?on|patio|rooftop|terrace|brunch|breakfast|hours|location|visit|order|reservation|book)/i;
const ignoredPath = /\.(?:css|js|json|xml|ico|svg|png|jpe?g|gif|webp|avif|pdf|zip|woff2?|ttf|eot)(?:$|\?)/i;
const badImageNeedle = /(favicon|apple-touch-icon|logo|icon-|sprite|badge|placeholder|tracking|pixel|avatar|manifest|loader|spinner)/i;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function safeUrl(value, base) {
  try {
    const url = new URL(String(value ?? ""), base);
    return ["http:", "https:"].includes(url.protocol) ? url : null;
  } catch { return null; }
}
function hostKey(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, ""); }
  catch { return ""; }
}
function sameSite(a, b) {
  const aHost = hostKey(a);
  const bHost = hostKey(b);
  return Boolean(aHost && bHost && (aHost === bHost || aHost.endsWith(`.${bHost}`) || bHost.endsWith(`.${aHost}`)));
}
function cleanText(value) {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/\s+/g, " ")
    .trim();
}
function summarize(value, maxChars = summaryChars) {
  const text = cleanText(value).replace(/https?:\/\/\S+/gi, " ").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxChars ? `${text.slice(0, maxChars - 3).trim()}...` : text;
}
function attrs(fragment) {
  const out = {};
  for (const match of String(fragment).matchAll(/([:\w-]+)\s*=\s*["']([^"']*)["']/g)) out[match[1].toLowerCase()] = match[2];
  return out;
}
function classify(text) {
  const haystack = String(text ?? "").toLowerCase();
  return Object.fromEntries(Object.entries(signalGroups)
    .map(([kind, terms]) => [kind, terms.filter((term) => haystack.includes(term))])
    .filter(([, hits]) => hits.length));
}
function hashId(parts) {
  return createHash("sha1").update(parts.filter(Boolean).join("|"), "utf8").digest("hex").slice(0, 18);
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
  return (specific || wildcard)?.disallow ?? [];
}
async function robotsAllows(url) {
  const parsed = new URL(url);
  if (!robotsCache.has(parsed.origin)) {
    robotsCache.set(parsed.origin, (async () => {
      try {
        const response = await fetch(new URL("/robots.txt", parsed.origin), {
          headers: { "User-Agent": userAgent },
          redirect: "follow",
          signal: AbortSignal.timeout(Math.min(timeoutMs, 8000))
        });
        if (response.status === 401 || response.status === 403) return ["/"];
        if (!response.ok) return [];
        return parseRobots(await response.text());
      } catch {
        return [];
      }
    })());
  }
  const disallow = await robotsCache.get(parsed.origin);
  return !disallow.some((prefix) => prefix === "/" || (prefix && parsed.pathname.startsWith(prefix)));
}
async function fetchHtml(url) {
  if (!(await robotsAllows(url))) return { error: "robots_disallow", url };
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs)
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok) return { error: `http_${response.status}`, url };
    if (!/html|xhtml/i.test(contentType)) return { error: "not_html", url };
    return { html: await response.text(), url: response.url || url, status: response.status };
  } catch (error) {
    return { error: error.name === "TimeoutError" ? "timeout" : error.message, url };
  }
}
function pageTitle(html) {
  const og = String(html).match(/<meta\b[^>]*(?:property|name)=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i)?.[1];
  const title = String(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return summarize(og || title || "Official page update", 160);
}
function metaDescription(html) {
  for (const name of ["description", "og:description", "twitter:description"]) {
    const match = String(html).match(new RegExp(`<meta\\b[^>]*(?:name|property)=["']${name}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i"));
    if (match) return summarize(match[1]);
  }
  return "";
}
function imageFromHtml(html, baseUrl) {
  const candidates = [];
  for (const name of ["og:image", "twitter:image"]) {
    const match = String(html).match(new RegExp(`<meta\\b[^>]*(?:property|name)=["']${name}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i"));
    const url = match ? safeUrl(match[1], baseUrl) : null;
    if (url) candidates.push(url.href);
  }
  for (const match of String(html).matchAll(/<img\b([^>]+)>/gi)) {
    const attr = attrs(match[1]);
    const raw = attr.src || attr["data-src"] || attr["data-lazy-src"];
    const url = raw ? safeUrl(raw, baseUrl) : null;
    if (!url) continue;
    const width = Number(attr.width || 0);
    const height = Number(attr.height || 0);
    const label = `${url.href} ${attr.alt || ""} ${attr.class || ""}`.toLowerCase();
    if (badImageNeedle.test(label)) continue;
    if ((width && width < 180) || (height && height < 140)) continue;
    candidates.push(url.href);
  }
  return [...new Set(candidates)].find((url) => !badImageNeedle.test(url.toLowerCase())) || null;
}
function datesFromHtml(html) {
  const values = [];
  for (const match of String(html).matchAll(/<(?:time|meta)\b([^>]*)>/gi)) {
    const attr = attrs(match[1]);
    for (const key of ["datetime", "content"]) {
      const stamp = Date.parse(attr[key] || "");
      if (Number.isFinite(stamp)) values.push(new Date(stamp).toISOString());
    }
  }
  return [...new Set(values)].sort().reverse();
}
function contextualExcerpt(text, matches) {
  const lowered = text.toLowerCase();
  const terms = [...new Set(Object.values(matches).flat())];
  const positions = terms.map((term) => lowered.indexOf(term)).filter((index) => index >= 0).sort((a, b) => a - b);
  if (!positions.length) return summarize(text);
  const start = Math.max(0, positions[0] - 180);
  const end = Math.min(text.length, positions[0] + 520);
  return summarize(text.slice(start, end));
}
function internalLinks(html, baseUrl) {
  const found = [];
  const seen = new Set();
  for (const match of String(html).matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = safeUrl(match[1], baseUrl);
    if (!url || !sameSite(url.href, baseUrl) || ignoredPath.test(url.pathname)) continue;
    url.hash = "";
    const label = cleanText(match[2]);
    const haystack = `${url.pathname} ${url.search} ${label}`;
    if (!crawlNeedle.test(haystack)) continue;
    const key = url.href.replace(/\/+$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ url: key, label: label.slice(0, 140) || url.pathname });
  }
  return found;
}
function targetPages(restaurant) {
  const seen = new Set();
  const pages = [];
  function add(url, reason, label = "") {
    const parsed = safeUrl(url, restaurant.website);
    if (!parsed || ignoredPath.test(parsed.pathname)) return;
    parsed.hash = "";
    const key = parsed.href.replace(/\/+$/, "");
    if (seen.has(key)) return;
    seen.add(key);
    pages.push({ url: key, reason, label });
  }
  add(restaurant.website, "official_homepage", "Official website");
  const first = firstPartyById.get(restaurant.id);
  for (const link of first?.relatedLinks || []) {
    if (["menu", "events", "reservations", "ordering"].includes(link.kind)) add(link.url, `first_party_${link.kind}`, link.label);
  }
  for (const link of officialById.get(restaurant.id)?.candidateLinks || []) add(link.href, "official_signal_candidate_link", link.text);
  return pages.slice(0, pagesPerRestaurant);
}

const targets = restaurants.filter((restaurant) => restaurant.website).slice(0, targetLimit);
const planned = targets.flatMap((restaurant) => targetPages(restaurant).map((page) => ({ restaurant, page }))).slice(0, pageLimit);
const records = [];
const failures = [];

async function scan(item) {
  const observedAt = new Date().toISOString();
  const fetched = await fetchHtml(item.page.url);
  if (!fetched.html) {
    failures.push({ restaurantId: item.restaurant.id, name: item.restaurant.name, url: item.page.url, reason: fetched.error || "fetch_failed" });
    return;
  }
  const resolvedUrl = fetched.url || item.page.url;
  const title = pageTitle(fetched.html);
  const description = metaDescription(fetched.html);
  const pageText = cleanText(fetched.html);
  const signalMatches = classify(`${resolvedUrl} ${title} ${description} ${pageText}`);
  const candidateLinks = internalLinks(fetched.html, resolvedUrl).slice(0, 10);
  if (!Object.keys(signalMatches).length && !candidateLinks.length) return;
  const dates = datesFromHtml(fetched.html);
  records.push({
    id: `official-page-${hashId([item.restaurant.id, resolvedUrl, title])}`,
    restaurantId: item.restaurant.id,
    restaurantName: item.restaurant.name,
    platform: "official_page",
    title: title || `${item.restaurant.name} official update`,
    excerpt: description || contextualExcerpt(pageText, signalMatches) || title,
    postUrl: resolvedUrl,
    mediaUrl: imageFromHtml(fetched.html, resolvedUrl),
    publishedAt: dates[0] || null,
    observedAt,
    signalMatches,
    candidateLinks,
    sourceKind: "official_page_html",
    associationBasis: sameSite(resolvedUrl, item.restaurant.website) ? "same_site_official_page" : "official_site_linked_page",
    confidence: "official_source_page_signal",
    reviewState: dates[0] ? "source_signal" : "needs_date_review",
    discoveryReason: item.page.reason,
    sourceLabel: item.page.label || "Official page"
  });
}

const hostGroups = new Map();
for (const item of planned) {
  const host = hostKey(item.page.url) || item.page.url;
  if (!hostGroups.has(host)) hostGroups.set(host, []);
  hostGroups.get(host).push(item);
}
const groups = [...hostGroups.values()];
let nextGroup = 0;
async function worker() {
  while (true) {
    const current = nextGroup++;
    if (current >= groups.length) return;
    for (const item of groups[current]) {
      await scan(item);
      if (delayMs > 0) await sleep(delayMs);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, groups.length || 1) }, () => worker()));

const uniqueRecords = records
  .filter((record, index, all) => all.findIndex((item) => item.restaurantId === record.restaurantId && item.postUrl === record.postUrl) === index)
  .sort((a, b) => String(b.publishedAt || b.observedAt).localeCompare(String(a.publishedAt || a.observedAt)));

const categoryCounts = {};
for (const record of uniqueRecords) for (const kind of Object.keys(record.signalMatches || {})) categoryCounts[kind] = (categoryCounts[kind] || 0) + 1;

const output = {
  version: 1,
  generatedAt: new Date().toISOString(),
  targetRestaurants: targets.length,
  plannedPages: planned.length,
  pagesChecked: planned.length - failures.length,
  records: uniqueRecords,
  signals: uniqueRecords.filter((record) => Object.keys(record.signalMatches || {}).length),
  failures: failures.slice(0, 150),
  counts: {
    records: uniqueRecords.length,
    restaurants: new Set(uniqueRecords.map((record) => record.restaurantId)).size,
    categoryCounts
  }
};

await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(new URL("../data/build/website-page-intelligence.json", import.meta.url), JSON.stringify(output, null, 2));
await writeFile(new URL("../data/website-page-intelligence.js", import.meta.url), `window.HALIFAX_WEBSITE_PAGE_INTELLIGENCE = ${JSON.stringify(output, null, 2)};\n`);
console.log(`Official page intelligence: targets=${targets.length}, pages=${planned.length}, records=${uniqueRecords.length}, restaurants=${output.counts.restaurants}, failures=${failures.length}.`);
console.log(`Categories: ${Object.entries(categoryCounts).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`);
