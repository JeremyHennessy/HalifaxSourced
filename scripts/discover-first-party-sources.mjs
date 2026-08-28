import { mkdir, readFile, writeFile } from "node:fs/promises";

const catalog = JSON.parse(await readFile(new URL("../data/build/catalog.json", import.meta.url), "utf8"));
const targets = (catalog.restaurants || []).filter((restaurant) => restaurant.website).slice(0, Number(process.env.FIRST_PARTY_SOURCE_LIMIT ?? 9999));
const delayMs = Number(process.env.FIRST_PARTY_SOURCE_DELAY_MS ?? 180);
const timeoutMs = Number(process.env.FIRST_PARTY_SOURCE_TIMEOUT_MS ?? 12000);
const concurrency = Math.max(1, Math.min(16, Number(process.env.FIRST_PARTY_SOURCE_CONCURRENCY ?? 8)));
const userAgent = "HalifaxSourced/0.3 (+https://github.com/JeremyHennessy/HalifaxSourced)";
const robotsCache = new Map();

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function safeUrl(value, base) {
  try {
    const url = new URL(String(value ?? ""), base);
    return ["http:", "https:"].includes(url.protocol) ? url : null;
  } catch { return null; }
}

function hostKey(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

function sameSite(a, b) {
  const aHost = hostKey(a);
  const bHost = hostKey(b);
  return Boolean(aHost && bHost && (aHost === bHost || aHost.endsWith(`.${bHost}`) || bHost.endsWith(`.${aHost}`)));
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function attrs(fragment) {
  const out = {};
  for (const match of String(fragment).matchAll(/([:\w-]+)\s*=\s*["']([^"']*)["']/g)) out[match[1].toLowerCase()] = match[2];
  return out;
}

function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const index = line.indexOf(":");
    if (index < 0) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    if (key === "sitemap" && value) {
      const url = safeUrl(value);
      if (url) sitemaps.push(url.href);
      continue;
    }
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
  return { disallow: (specific || wildcard)?.disallow ?? [], sitemaps: [...new Set(sitemaps)] };
}

async function robotsFor(url) {
  const parsed = new URL(url);
  if (!robotsCache.has(parsed.origin)) {
    robotsCache.set(parsed.origin, (async () => {
      try {
        const response = await fetch(new URL("/robots.txt", parsed.origin), {
          headers: { "User-Agent": userAgent },
          redirect: "follow",
          signal: AbortSignal.timeout(Math.min(timeoutMs, 8000))
        });
        if (response.status === 401 || response.status === 403) return { disallow: ["/"], sitemaps: [] };
        if (!response.ok) return { disallow: [], sitemaps: [] };
        return parseRobots(await response.text());
      } catch {
        return { disallow: [], sitemaps: [] };
      }
    })());
  }
  return robotsCache.get(parsed.origin);
}

async function robotsAllows(url) {
  const parsed = new URL(url);
  const robots = await robotsFor(url);
  return !robots.disallow.some((prefix) => prefix === "/" || (prefix && parsed.pathname.startsWith(prefix)));
}

function normalizeFacebook(url) {
  const parsed = safeUrl(url);
  if (!parsed) return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  if (!["facebook.com", "fb.com"].includes(host)) return null;
  if (parsed.pathname === "/profile.php" && parsed.searchParams.get("id")) {
    const handle = parsed.searchParams.get("id");
    return { platform: "facebook", handle, url: `https://www.facebook.com/${handle}` };
  }
  const segment = parsed.pathname.split("/").filter(Boolean)[0];
  if (!segment || ["share", "sharer", "dialog", "plugins", "login", "groups", "events", "watch", "reel", "reels", "photo", "photos", "posts", "permalink.php"].includes(segment.toLowerCase())) return null;
  return { platform: "facebook", handle: segment, url: `https://www.facebook.com/${segment}` };
}

function normalizeInstagram(url) {
  const parsed = safeUrl(url);
  if (!parsed) return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "instagram.com") return null;
  const segment = parsed.pathname.split("/").filter(Boolean)[0];
  if (!segment || ["p", "reel", "reels", "stories", "explore", "accounts", "tv", "direct"].includes(segment.toLowerCase())) return null;
  return { platform: "instagram", handle: segment.replace(/^@/, ""), url: `https://www.instagram.com/${segment.replace(/^@/, "")}/` };
}

function discoverSocial(html, baseUrl) {
  const seen = new Set();
  const profiles = [];
  const pattern = /<a\b([^>]*?)href\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const href = safeUrl(match[2], baseUrl)?.href;
    if (!href) continue;
    const profile = normalizeFacebook(href) || normalizeInstagram(href);
    if (!profile) continue;
    const key = `${profile.platform}|${profile.handle.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    profiles.push({ ...profile, label: cleanText(match[4]).slice(0, 120) || profile.platform });
  }
  return profiles;
}

function discoverFeeds(html, baseUrl) {
  const found = [];
  const seen = new Set();
  for (const match of html.matchAll(/<link\b([^>]+)>/gi)) {
    const attr = attrs(match[1]);
    const type = String(attr.type || "").toLowerCase();
    const rel = String(attr.rel || "").toLowerCase();
    if (!rel.includes("alternate") || !/(rss|atom|xml)/.test(type)) continue;
    const url = safeUrl(attr.href, baseUrl);
    if (!url || !sameSite(url.href, baseUrl) || seen.has(url.href)) continue;
    seen.add(url.href);
    found.push({ url: url.href, type: type || "feed", title: cleanText(attr.title || "Website feed").slice(0, 120) });
  }
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = safeUrl(match[1], baseUrl);
    if (!url || !sameSite(url.href, baseUrl) || seen.has(url.href)) continue;
    const text = cleanText(match[2]);
    if (!/(^|\/)feed\/?$|rss|atom|\.xml(?:$|\?)/i.test(url.pathname) && !/rss|feed|atom/i.test(text)) continue;
    seen.add(url.href);
    found.push({ url: url.href, type: "discovered_feed_link", title: text.slice(0, 120) || "Website feed" });
  }
  return found.slice(0, 8);
}

const records = new Array(targets.length);
const failures = [];

async function scanRestaurant(item) {
  const { restaurant, index, website } = item;
  if (!(await robotsAllows(website))) {
    failures.push({ restaurantId: restaurant.id, name: restaurant.name, website, reason: "robots_disallow" });
    return;
  }
  const observedAt = new Date().toISOString();
  try {
    const response = await fetch(website, {
      headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs)
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !/html|xhtml/i.test(contentType)) {
      failures.push({ restaurantId: restaurant.id, name: restaurant.name, website, reason: response.ok ? "not_html" : `http_${response.status}` });
      return;
    }
    const html = await response.text();
    const resolvedUrl = response.url || website;
    const robots = await robotsFor(resolvedUrl);
    records[index] = {
      restaurantId: restaurant.id,
      name: restaurant.name,
      website,
      resolvedUrl,
      observedAt,
      socialProfiles: discoverSocial(html, resolvedUrl).map((profile) => ({ ...profile, discoveredFrom: resolvedUrl, associationBasis: "linked_from_official_website", reviewState: "verified_link" })),
      feeds: discoverFeeds(html, resolvedUrl).map((feed) => ({ ...feed, discoveredFrom: resolvedUrl, reviewState: "verified_link" })),
      sitemaps: (robots.sitemaps || []).filter((url) => sameSite(url, resolvedUrl)).slice(0, 8),
      sourceKind: "official_website_discovery",
      reviewState: "verified"
    };
  } catch (error) {
    failures.push({ restaurantId: restaurant.id, name: restaurant.name, website, reason: error.name === "TimeoutError" ? "timeout" : error.message });
  }
}

const groups = new Map();
for (const [index, restaurant] of targets.entries()) {
  const website = safeUrl(restaurant.website)?.href;
  if (!website) {
    failures.push({ restaurantId: restaurant.id, name: restaurant.name, website: restaurant.website, reason: "invalid_url" });
    continue;
  }
  const host = hostKey(website) || `invalid-${index}`;
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

const finalRecords = records.filter(Boolean);
const profileCount = finalRecords.reduce((sum, record) => sum + record.socialProfiles.length, 0);
const facebookCount = finalRecords.reduce((sum, record) => sum + record.socialProfiles.filter((profile) => profile.platform === "facebook").length, 0);
const instagramCount = finalRecords.reduce((sum, record) => sum + record.socialProfiles.filter((profile) => profile.platform === "instagram").length, 0);
const feedCount = finalRecords.reduce((sum, record) => sum + record.feeds.length, 0);
const output = {
  version: 1,
  generatedAt: new Date().toISOString(),
  checkedWebsites: finalRecords.length,
  failedWebsites: failures.length,
  hostGroups: hostGroups.length,
  concurrency,
  profileCount,
  facebookCount,
  instagramCount,
  feedCount,
  failures: failures.slice(0, 100),
  records: finalRecords
};

await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(new URL("../data/build/first-party-sources.json", import.meta.url), JSON.stringify(output, null, 2));
await writeFile(new URL("../data/first-party-sources.js", import.meta.url), `window.HALIFAX_FIRST_PARTY_SOURCES = ${JSON.stringify(output, null, 2)};\n`);
console.log(`First-party source discovery: websites=${finalRecords.length}, failures=${failures.length}, profiles=${profileCount} (facebook=${facebookCount}, instagram=${instagramCount}), feeds=${feedCount}, hosts=${hostGroups.length}, concurrency=${concurrency}.`);
