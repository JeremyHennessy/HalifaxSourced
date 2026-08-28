import { mkdir, readFile, writeFile } from "node:fs/promises";

const catalog = JSON.parse(await readFile(new URL("../data/build/catalog.json", import.meta.url), "utf8"));
const targets = (catalog.restaurants || []).filter((restaurant) => restaurant.website).slice(0, Number(process.env.OFFICIAL_SITE_LIMIT ?? 9999));
const delayMs = Number(process.env.OFFICIAL_SITE_DELAY_MS ?? 120);
const timeoutMs = Number(process.env.OFFICIAL_SITE_TIMEOUT_MS ?? 12000);
const userAgent = "HalifaxSourced/0.3 (+https://github.com/JeremyHennessy/HalifaxSourced)";
const robotsCache = new Map();
const signalGroups = {
  menu: ["menu", "food menu", "drink menu", "cocktail", "wine list"],
  specials: ["happy hour", "special", "specials", "daily feature", "features", "deal", "offers", "promo"],
  events: ["event", "events", "live music", "trivia", "dj", "calendar", "ticket", "show", "karaoke"],
  patio: ["patio", "rooftop", "terrace", "outdoor seating", "beer garden", "sidewalk"],
  openings: ["now open", "opening soon", "grand opening", "soft opening", "new location", "coming soon", "newly opened"],
  brunch: ["brunch", "breakfast"],
  reservations: ["reservation", "reserve", "book a table", "opentable", "resy"],
  takeout: ["takeout", "take away", "pickup", "pick up", "order online", "delivery"]
};
const keywords = [...new Set(Object.values(signalGroups).flat())];
const results = [];

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function safeUrl(value, base) {
  try {
    const url = new URL(String(value ?? ""), base);
    return ["http:", "https:"].includes(url.protocol) ? url : null;
  } catch { return null; }
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

for (const restaurant of targets) {
  const observedAt = new Date().toISOString();
  const website = safeUrl(restaurant.website)?.href;
  if (!website) {
    results.push({ restaurantId: restaurant.id, name: restaurant.name, website: restaurant.website, error: "invalid_url", observedAt, sourceKind: "official_website", reviewState: "cross-check" });
    continue;
  }
  if (!(await robotsAllows(website))) {
    results.push({ restaurantId: restaurant.id, name: restaurant.name, website, error: "robots_disallow", observedAt, sourceKind: "official_website", reviewState: "restricted" });
    continue;
  }
  if (delayMs > 0) await sleep(delayMs);
  try {
    const response = await fetch(website, { headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    const contentType = response.headers.get("content-type") || "";
    if (!/html|xhtml/i.test(contentType)) {
      results.push({ restaurantId: restaurant.id, name: restaurant.name, website, status: response.status, error: "not_html", observedAt, sourceKind: "official_website", reviewState: "cross-check" });
      continue;
    }
    const html = await response.text();
    const pageText = cleanText(html);
    const resolvedWebsite = response.url || website;
    const signalMatches = classifySignal(`${resolvedWebsite} ${pageText}`);
    results.push({
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
    });
  } catch (error) {
    results.push({ restaurantId: restaurant.id, name: restaurant.name, website, error: error.name === "TimeoutError" ? "timeout" : error.message, observedAt, sourceKind: "official_website", reviewState: "cross-check" });
  }
}

const kindCounts = Object.fromEntries(Object.keys(signalGroups).map((group) => [
  group,
  results.filter((result) => (result.signalMatches?.[group]?.length ?? 0) > 0 || result.candidateLinks?.some((link) => (link.signalMatches?.[group]?.length ?? 0) > 0)).length
]));
const payload = { generatedAt: new Date().toISOString(), count: results.length, kindCounts, signalGroups, results };
await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(new URL("../data/build/official-site-signals.json", import.meta.url), JSON.stringify(payload, null, 2));
await writeFile(new URL("../data/official-site-signals.js", import.meta.url), `window.HALIFAX_OFFICIAL_SITE_SIGNALS = ${JSON.stringify(payload, null, 2)};\n`);
console.log(`Checked ${results.length} official websites for menu/special/event/patio/opening signals.`);
console.log(`Signal counts: ${Object.entries(kindCounts).map(([key, value]) => `${key}=${value}`).join(", ")}`);
