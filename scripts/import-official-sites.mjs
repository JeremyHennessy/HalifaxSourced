import { mkdir, readFile, writeFile } from "node:fs/promises";
import { LIFECYCLE_SIGNAL_GROUPS } from "./lib/lifecycle-language.mjs";

const catalog = JSON.parse(await readFile(new URL("../data/build/catalog.json", import.meta.url), "utf8"));
const targets = (catalog.restaurants || []).filter((restaurant) => restaurant.website).slice(0, Number(process.env.OFFICIAL_SITE_LIMIT ?? 9999));
const delayMs = Number(process.env.OFFICIAL_SITE_DELAY_MS ?? 120);
const timeoutMs = Number(process.env.OFFICIAL_SITE_TIMEOUT_MS ?? 12000);
const concurrency = Math.max(1, Math.min(16, Number(process.env.OFFICIAL_SITE_CONCURRENCY ?? 8)));
const userAgent = "HalifaxSourced/0.3 (+https://github.com/JeremyHennessy/HalifaxSourced)";
const robotsCache = new Map();
const signalGroups = {
  menu: ["menu", "food menu", "drink menu", "cocktail", "wine list"],
  specials: ["happy hour", "special", "specials", "daily feature", "features", "deal", "offers", "promo"],
  events: ["event", "events", "live music", "trivia", "dj", "calendar", "ticket", "show", "karaoke"],
  patio: ["patio", "rooftop", "terrace", "outdoor seating", "beer garden", "sidewalk"],
  openings: ["now open", "opening soon", "grand opening", "soft opening", "new location", "coming soon", "newly opened"],
  ...LIFECYCLE_SIGNAL_GROUPS,
  brunch: ["brunch", "breakfast"],
  reservations: ["reservation", "reserve", "book a table", "opentable", "resy"],
  takeout: ["takeout", "take away", "pickup", "pick up", "order online", "delivery"]
};
const keywords = [...new Set(Object.values(signalGroups).flat())];
const results = new Array(targets.length);

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function safeUrl(value, base) {
  try {
    const url = new URL(String(value ?? ""), base);
    return ["http:", "https:"].includes(url.protocol) ? url : null;
  } catch { return null; }
}
function hostKey(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return "invalid"; }
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
  if (!robotsCache.has(parsed.origin)) {
    robotsCache.set(parsed.origin, (async () => {
      try {
        const response = await fetch(new URL("/robots.txt", parsed.origin), { headers: { "User-Agent": userAgent }, redirect: "follow", signal: AbortSignal.timeout(Math.min(timeoutMs, 8000)) });
        if (response.status === 401 || response.status === 403) return ["/"];
        if (!response.ok) return [];
        return parseRobotsGroup(await response.text(), "HalifaxSourced");
      } catch { return []; }
    })());
  }
  const disallow = await robotsCache.get(parsed.origin);
  return !disallow.some((prefix) => prefix === "/" || parsed.pathname.startsWith(prefix));
}
function cleanText(value) {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function uniqueLinks(links) {
  const seen = new Set();
  return links.filter((link) => {
    const key = `${link.href}|${link.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function classifySignal(text) {
  const haystack = text.toLowerCase();
  return Object.fromEntries(Object.entries(signalGroups).map(([group, groupKeywords]) => [group, groupKeywords.filter((keyword) => haystack.includes(keyword))]));
}
function linksFromHtml(html, baseUrl) {
  const links = [];
  const pattern = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis;
  for (const match of html.matchAll(pattern)) {
    const url = safeUrl(match[1], baseUrl);
    if (!url) continue;
    const text = cleanText(match[2]);
    const signalMatches = classifySignal(`${url.href} ${text}`);
    if (Object.values(signalMatches).some((hits) => hits.length)) links.push({ text: text || url.href, href: url.href, signalMatches });
  }
  return uniqueLinks(links).slice(0, 24);
}
async function scanRestaurant(item) {
  const { restaurant, index, website } = item;
  const observedAt = new Date().toISOString();
  if (!(await robotsAllows(website))) {
    results[index] = { restaurantId: restaurant.id, name: restaurant.name, website, error: "robots_disallow", observedAt, sourceKind: "official_website", reviewState: "restricted" };
    return;
  }
  try {
    const response = await fetch(website, { headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    const contentType = response.headers.get("content-type") || "";
    if (!/html|xhtml/i.test(contentType)) {
      results[index] = { restaurantId: restaurant.id, name: restaurant.name, website, status: response.status, error: "not_html", observedAt, sourceKind: "official_website", reviewState: "cross-check" };
      return;
    }
    const html = await response.text();
    const pageText = cleanText(html);
    const resolvedWebsite = response.url || website;
    const signalMatches = classifySignal(`${resolvedWebsite} ${pageText}`);
    results[index] = {
      restaurantId: restaurant.id,
      name: restaurant.name,
      website: resolvedWebsite,
      status: response.status,
      observedAt,
      keywordHits: keywords.filter((keyword) => `${resolvedWebsite} ${pageText}`.toLowerCase().includes(keyword)),
      signalMatches,
      candidateLinks: linksFromHtml(html, resolvedWebsite),
      sourceKind: "official_website",
      reviewState: response.ok ? "cross-check" : "needs-review"
    };
  } catch (error) {
    results[index] = { restaurantId: restaurant.id, name: restaurant.name, website, error: error.name === "TimeoutError" ? "timeout" : error.message, observedAt, sourceKind: "official_website", reviewState: "cross-check" };
  }
}

const groups = new Map();
for (const [index, restaurant] of targets.entries()) {
  const website = safeUrl(restaurant.website)?.href;
  if (!website) {
    results[index] = { restaurantId: restaurant.id, name: restaurant.name, website: restaurant.website, error: "invalid_url", observedAt: new Date().toISOString(), sourceKind: "official_website", reviewState: "cross-check" };
    continue;
  }
  const host = hostKey(website);
  if (!groups.has(host)) groups.set(host, []);
  groups.get(host).push({ restaurant, index, website });
}

const hostGroups = [...groups.values()];
let nextGroup = 0;
async function worker() {
  while (true) {
    const current = nextGroup++;
    if (current >= hostGroups.length) return;
    for (const item of hostGroups[current]) {
      await scanRestaurant(item);
      if (delayMs > 0) await sleep(delayMs);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, hostGroups.length || 1) }, () => worker()));

const finalResults = results.filter(Boolean);
const kindCounts = Object.fromEntries(Object.keys(signalGroups).map((group) => [
  group,
  finalResults.filter((result) => (result.signalMatches?.[group]?.length ?? 0) > 0 || result.candidateLinks?.some((link) => (link.signalMatches?.[group]?.length ?? 0) > 0)).length
]));
const payload = { generatedAt: new Date().toISOString(), count: finalResults.length, kindCounts, signalGroups, results: finalResults };
await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(new URL("../data/build/official-site-signals.json", import.meta.url), JSON.stringify(payload, null, 2));
await writeFile(new URL("../data/official-site-signals.js", import.meta.url), `window.HALIFAX_OFFICIAL_SITE_SIGNALS = ${JSON.stringify(payload, null, 2)};\n`);
console.log(`Checked ${finalResults.length} official websites across ${hostGroups.length} host groups with concurrency=${concurrency}.`);
console.log(`Signal counts: ${Object.entries(kindCounts).map(([key, value]) => `${key}=${value}`).join(", ")}`);
