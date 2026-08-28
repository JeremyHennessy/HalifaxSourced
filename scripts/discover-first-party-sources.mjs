import { mkdir, readFile, writeFile } from "node:fs/promises";

const catalog = JSON.parse(await readFile(new URL("../data/build/catalog.json", import.meta.url), "utf8"));
let discoveredRestaurants = [];
try {
  const source = await readFile(new URL("../data/discovered-restaurants.js", import.meta.url), "utf8");
  const match = source.match(/window\.HALIFAX_DISCOVERED_RESTAURANTS\s*=\s*([\s\S]*);\s*$/);
  if (match) discoveredRestaurants = JSON.parse(match[1]);
} catch {}

const mergedTargets = [...(catalog.restaurants || []), ...discoveredRestaurants]
  .filter((restaurant) => restaurant?.website)
  .filter((restaurant, index, all) => all.findIndex((item) => item.id === restaurant.id) === index);
const targets = mergedTargets.slice(0, Number(process.env.FIRST_PARTY_SOURCE_LIMIT ?? 9999));
const delayMs = Number(process.env.FIRST_PARTY_SOURCE_DELAY_MS ?? 180);
const timeoutMs = Number(process.env.FIRST_PARTY_SOURCE_TIMEOUT_MS ?? 12000);
const concurrency = Math.max(1, Math.min(16, Number(process.env.FIRST_PARTY_SOURCE_CONCURRENCY ?? 8)));
const userAgent = "HalifaxSourced/0.4 (+https://github.com/JeremyHennessy/HalifaxSourced)";
const robotsCache = new Map();

const SOCIAL_HOSTS = {
  facebook: ["facebook.com", "fb.com"],
  instagram: ["instagram.com"],
  x: ["x.com", "twitter.com"],
  tiktok: ["tiktok.com"],
  youtube: ["youtube.com", "youtu.be"],
  threads: ["threads.net"],
  linkedin: ["linkedin.com"],
  bluesky: ["bsky.app"],
  linktree: ["linktr.ee"]
};

const RELATED_HOSTS = {
  reservations: ["opentable.", "resy.com", "exploretock.com", "sevenrooms.com", "yelp-reservations.com"],
  ordering: ["toasttab.com", "doordash.com", "ubereats.com", "skipthedishes.com", "ritual.co", "chownow.com", "square.site"],
  tickets: ["ticketmaster.", "ticketatlantic.com", "eventbrite.", "tixr.com", "showpass.com", "universe.com"]
};

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

function socialPlatform(url) {
  const parsed = safeUrl(url);
  if (!parsed) return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  for (const [platform, hosts] of Object.entries(SOCIAL_HOSTS)) {
    if (hosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`))) return platform;
  }
  return null;
}

function socialHandle(platform, url) {
  const parsed = safeUrl(url);
  if (!parsed) return null;
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (platform === "facebook") {
    if (parsed.pathname === "/profile.php" && parsed.searchParams.get("id")) return parsed.searchParams.get("id");
    const first = parts[0];
    if (!first || ["share", "sharer", "dialog", "plugins", "login", "groups", "events", "watch", "reel", "reels", "photo", "photos", "posts", "permalink.php"].includes(first.toLowerCase())) return null;
    return first;
  }
  if (platform === "instagram") {
    const first = parts[0]?.replace(/^@/, "");
    if (!first || ["p", "reel", "reels", "stories", "explore", "accounts", "tv", "direct"].includes(first.toLowerCase())) return null;
    return first;
  }
  if (platform === "x") {
    const first = parts[0]?.replace(/^@/, "");
    if (!first || ["home", "share", "intent", "search", "explore", "i"].includes(first.toLowerCase())) return null;
    return first;
  }
  if (platform === "tiktok") return parts.find((part) => part.startsWith("@"))?.replace(/^@/, "") || null;
  if (platform === "threads") return parts[0]?.replace(/^@/, "") || null;
  if (platform === "bluesky") return parts[0] === "profile" ? parts[1] || null : parts[0] || null;
  if (platform === "youtube") {
    const marker = parts[0];
    if (["channel", "c", "user"].includes(marker)) return parts[1] || null;
    return marker?.replace(/^@/, "") || null;
  }
  if (platform === "linkedin") return parts.slice(0, 2).join("/") || null;
  if (platform === "linktree") return parts[0] || null;
  return null;
}

function discoverSocial(html, baseUrl) {
  const seen = new Set();
  const profiles = [];
  const pattern = /<a\b([^>]*?)href\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const href = safeUrl(match[2], baseUrl)?.href;
    if (!href) continue;
    const platform = socialPlatform(href);
    if (!platform) continue;
    const handle = socialHandle(platform, href);
    if (!handle) continue;
    const key = `${platform}|${handle.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    profiles.push({
      platform,
      handle,
      url: href,
      label: cleanText(match[4]).slice(0, 120) || platform
    });
  }
  return profiles;
}

function relatedKind(url, label = "") {
  const href = String(url || "").toLowerCase();
  const text = String(label || "").toLowerCase();
  for (const [kind, needles] of Object.entries(RELATED_HOSTS)) if (needles.some((needle) => href.includes(needle))) return kind;
  if (/reserve|reservation|book a table|book table/.test(text)) return "reservations";
  if (/order online|takeout|take out|delivery|pickup|pick up/.test(text)) return "ordering";
  if (/menu|food menu|drink menu|cocktail menu|wine list/.test(text)) return "menu";
  if (/event|tickets|ticket|calendar|live music|shows/.test(text)) return "events";
  if (/newsletter|mailing list|subscribe/.test(text)) return "newsletter";
  return null;
}

function discoverRelatedLinks(html, baseUrl) {
  const links = [];
  const seen = new Set();
  const pattern = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const url = safeUrl(match[1], baseUrl);
    if (!url) continue;
    const label = cleanText(match[2]).slice(0, 140);
    const kind = relatedKind(url.href, label);
    if (!kind) continue;
    if (socialPlatform(url.href)) continue;
    const key = `${kind}|${url.href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ kind, url: url.href, label: label || kind });
  }
  return links.slice(0, 40);
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
  return found.slice(0, 12);
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
      relatedLinks: discoverRelatedLinks(html, resolvedUrl).map((link) => ({ ...link, discoveredFrom: resolvedUrl, associationBasis: "linked_from_official_website", reviewState: "verified_link" })),
      feeds: discoverFeeds(html, resolvedUrl).map((feed) => ({ ...feed, discoveredFrom: resolvedUrl, reviewState: "verified_link" })),
      sitemaps: (robots.sitemaps || []).filter((url) => sameSite(url, resolvedUrl)).slice(0, 12),
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
const platformCounts = {};
for (const record of finalRecords) for (const profile of record.socialProfiles || []) platformCounts[profile.platform] = (platformCounts[profile.platform] || 0) + 1;
const relatedKindCounts = {};
for (const record of finalRecords) for (const link of record.relatedLinks || []) relatedKindCounts[link.kind] = (relatedKindCounts[link.kind] || 0) + 1;
const profileCount = finalRecords.reduce((sum, record) => sum + record.socialProfiles.length, 0);
const relatedLinkCount = finalRecords.reduce((sum, record) => sum + record.relatedLinks.length, 0);
const feedCount = finalRecords.reduce((sum, record) => sum + record.feeds.length, 0);
const output = {
  version: 2,
  generatedAt: new Date().toISOString(),
  checkedWebsites: finalRecords.length,
  failedWebsites: failures.length,
  hostGroups: hostGroups.length,
  concurrency,
  profileCount,
  platformCounts,
  relatedLinkCount,
  relatedKindCounts,
  feedCount,
  failures: failures.slice(0, 150),
  records: finalRecords
};

await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(new URL("../data/build/first-party-sources.json", import.meta.url), JSON.stringify(output, null, 2));
await writeFile(new URL("../data/first-party-sources.js", import.meta.url), `window.HALIFAX_FIRST_PARTY_SOURCES = ${JSON.stringify(output, null, 2)};\n`);
console.log(`First-party source discovery: websites=${finalRecords.length}, failures=${failures.length}, profiles=${profileCount}, related=${relatedLinkCount}, feeds=${feedCount}, hosts=${hostGroups.length}, concurrency=${concurrency}.`);
console.log(`Social platforms: ${Object.entries(platformCounts).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`);
console.log(`Related links: ${Object.entries(relatedKindCounts).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`);
