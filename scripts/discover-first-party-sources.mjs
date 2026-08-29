// First-party discovery runs as a bounded, review-only refresh before production publication.
import { mkdir, readFile, writeFile } from "node:fs/promises";

const catalog = JSON.parse(await readFile(new URL("../data/build/catalog.json", import.meta.url), "utf8"));
const socialRegistry = JSON.parse(await readFile(new URL("../data/social-platform-registry.json", import.meta.url), "utf8"));
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
const ownedPageLimit = Math.max(1, Math.min(5, Number(process.env.FIRST_PARTY_OWNED_PAGE_LIMIT ?? 3)));
const linkHubLimit = Math.max(0, Math.min(4, Number(process.env.FIRST_PARTY_LINK_HUB_LIMIT ?? 2)));
const userAgent = "HalifaxSourced/0.7 (+https://github.com/JeremyHennessy/HalifaxSourced)";
const robotsCache = new Map();

const PLATFORM_BY_ID = new Map((socialRegistry.platforms || []).map((platform) => [platform.id, platform]));
const SOCIAL_PLATFORM_IDS = new Set((socialRegistry.platforms || []).filter((platform) => platform.kind === "social").map((platform) => platform.id));
const LINK_HUB_IDS = new Set((socialRegistry.platforms || []).filter((platform) => platform.kind === "link_hub").map((platform) => platform.id));
const CONFIDENCE_RANK = { candidate: 0, medium: 1, high: 2, very_high: 3, authoritative: 4 };

const RELATED_HOSTS = {
  reservations: ["opentable.", "resy.com", "exploretock.com", "sevenrooms.com", "yelp-reservations.com", "bookenda.com", "touchbistro.com"],
  ordering: ["toasttab.com", "doordash.com", "ubereats.com", "skipthedishes.com", "ritual.co", "chownow.com", "square.site", "order.online"],
  tickets: ["ticketmaster.", "ticketatlantic.com", "eventbrite.", "tixr.com", "showpass.com", "universe.com", "dice.fm"]
};

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

function platformForUrl(value) {
  const parsed = safeUrl(value);
  if (!parsed) return null;
  const host = hostKey(parsed.href);
  for (const platform of socialRegistry.platforms || []) {
    if ((platform.hosts || []).some((candidate) => host === candidate || host.endsWith(`.${candidate}`))) return platform;
  }
  return null;
}

function normalizedPathParts(url) {
  const parsed = safeUrl(url);
  return parsed ? parsed.pathname.split("/").map((part) => decodeURIComponent(part)).filter(Boolean) : [];
}

function profileHandle(platformId, url) {
  const parsed = safeUrl(url);
  if (!parsed) return null;
  const parts = normalizedPathParts(parsed.href);
  const first = parts[0]?.replace(/^@/, "");
  const metadata = PLATFORM_BY_ID.get(platformId);
  const generic = new Set((metadata?.genericPaths || []).map((item) => item.toLowerCase()));
  if (first && generic.has(first.toLowerCase())) return null;

  if (platformId === "facebook") {
    if (parsed.pathname === "/profile.php" && parsed.searchParams.get("id")) return parsed.searchParams.get("id");
    if (!first || /^permalink\.php$/i.test(first)) return null;
    return first;
  }
  if (platformId === "instagram" || platformId === "x" || platformId === "threads") return first || null;
  if (platformId === "tiktok") return parts.find((part) => part.startsWith("@"))?.replace(/^@/, "") || null;
  if (platformId === "bluesky") return parts[0] === "profile" ? parts[1] || null : first || null;
  if (platformId === "youtube") {
    if (["channel", "c", "user"].includes(parts[0]?.toLowerCase())) return parts[1] || null;
    return first || null;
  }
  if (platformId === "linkedin") {
    if (!["company", "showcase", "school"].includes(parts[0]?.toLowerCase())) return null;
    return parts.slice(0, 2).join("/") || null;
  }
  if (platformId === "pinterest") {
    if (hostKey(parsed.href) === "pin.it") return parts[0] || null;
    return first || null;
  }
  if (platformId === "snapchat") {
    if (parts[0]?.toLowerCase() === "add") return parts[1] || null;
    return first || null;
  }
  if (LINK_HUB_IDS.has(platformId)) return first || null;
  return null;
}

function associationConfidence(associationBasis) {
  if (["linked_from_official_website", "linked_from_official_location_page", "jsonld_sameAs"].includes(associationBasis)) return "authoritative";
  if (associationBasis === "linked_from_official_link_hub") return "very_high";
  return "high";
}

function buildPlatformRecord(url, discoveredFrom, associationBasis, observedAt, label = "") {
  const parsed = safeUrl(url, discoveredFrom);
  if (!parsed) return null;
  const platform = platformForUrl(parsed.href);
  if (!platform) return null;
  const handle = profileHandle(platform.id, parsed.href);
  if (!handle) return null;
  return {
    platform: platform.id,
    platformKind: platform.kind,
    handle,
    url: parsed.href,
    profileUrl: parsed.href,
    label: cleanText(label).slice(0, 120) || platform.label,
    locationSpecific: associationBasis === "linked_from_official_location_page",
    sharedBrandProfile: false,
    discoveredFrom,
    associationBasis,
    observedAt,
    lastVerifiedAt: observedAt,
    reviewState: "verified_link",
    confidence: associationConfidence(associationBasis),
    status: "active"
  };
}

function dedupePlatformRecords(records) {
  const best = new Map();
  for (const record of records.filter(Boolean)) {
    const key = `${record.platform}|${String(record.handle).toLowerCase()}`;
    const current = best.get(key);
    if (!current || (CONFIDENCE_RANK[record.confidence] || 0) > (CONFIDENCE_RANK[current.confidence] || 0)) best.set(key, record);
  }
  return [...best.values()];
}

function discoverAnchorPlatforms(html, baseUrl, associationBasis, observedAt) {
  const socialProfiles = [];
  const linkHubs = [];
  const pattern = /<a\b([^>]*?)href\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of String(html).matchAll(pattern)) {
    const record = buildPlatformRecord(match[2], baseUrl, associationBasis, observedAt, match[4]);
    if (!record) continue;
    if (record.platformKind === "link_hub") linkHubs.push(record);
    else socialProfiles.push(record);
  }
  return { socialProfiles, linkHubs };
}

function flattenJsonLd(value, out = []) {
  if (Array.isArray(value)) for (const item of value) flattenJsonLd(item, out);
  else if (value && typeof value === "object") {
    out.push(value);
    if (value["@graph"]) flattenJsonLd(value["@graph"], out);
  }
  return out;
}

function discoverJsonLdPlatforms(html, baseUrl, observedAt) {
  const socialProfiles = [];
  const linkHubs = [];
  for (const match of String(html).matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const payload = JSON.parse(match[1].trim());
      for (const node of flattenJsonLd(payload)) {
        const sameAs = Array.isArray(node.sameAs) ? node.sameAs : node.sameAs ? [node.sameAs] : [];
        for (const value of sameAs) {
          const record = buildPlatformRecord(value, baseUrl, "jsonld_sameAs", observedAt, "JSON-LD sameAs");
          if (!record) continue;
          if (record.platformKind === "link_hub") linkHubs.push(record); else socialProfiles.push(record);
        }
      }
    } catch {}
  }
  return { socialProfiles, linkHubs };
}

function relatedKind(url, label = "") {
  const href = String(url || "").toLowerCase();
  const text = String(label || "").toLowerCase();
  for (const [kind, needles] of Object.entries(RELATED_HOSTS)) if (needles.some((needle) => href.includes(needle))) return kind;
  if (/reserve|reservation|book a table|book table/.test(text)) return "reservations";
  if (/order online|takeout|take out|delivery|pickup|pick up/.test(text)) return "ordering";
  if (/menu|food menu|drink menu|cocktail menu|wine list|brunch menu|lunch menu|dinner menu/.test(text)) return "menu";
  if (/event|tickets|ticket|calendar|live music|shows/.test(text)) return "events";
  if (/newsletter|mailing list|subscribe/.test(text)) return "newsletter";
  return null;
}

function discoverRelatedLinks(html, baseUrl, associationBasis, observedAt) {
  const links = [];
  const seen = new Set();
  const pattern = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(html).matchAll(pattern)) {
    const url = safeUrl(match[1], baseUrl);
    if (!url) continue;
    const label = cleanText(match[2]).slice(0, 140);
    const kind = relatedKind(url.href, label);
    if (!kind || platformForUrl(url.href)) continue;
    const key = `${kind}|${url.href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({
      kind, url: url.href, label: label || kind, discoveredFrom: baseUrl, associationBasis,
      observedAt, lastVerifiedAt: observedAt, reviewState: "verified_link", confidence: associationConfidence(associationBasis), status: "active"
    });
  }
  return links.slice(0, 40);
}

function discoverFeeds(html, baseUrl) {
  const found = [];
  const seen = new Set();
  for (const match of String(html).matchAll(/<link\b([^>]+)>/gi)) {
    const attr = attrs(match[1]);
    const type = String(attr.type || "").toLowerCase();
    const rel = String(attr.rel || "").toLowerCase();
    if (!rel.includes("alternate") || !/(rss|atom|xml)/.test(type)) continue;
    const url = safeUrl(attr.href, baseUrl);
    if (!url || !sameSite(url.href, baseUrl) || seen.has(url.href)) continue;
    seen.add(url.href);
    found.push({ url: url.href, type: type || "feed", title: cleanText(attr.title || "Website feed").slice(0, 120) });
  }
  for (const match of String(html).matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = safeUrl(match[1], baseUrl);
    if (!url || !sameSite(url.href, baseUrl) || seen.has(url.href)) continue;
    const text = cleanText(match[2]);
    if (!/(^|\/)feed\/?$|rss|atom|\.xml(?:$|\?)/i.test(url.pathname) && !/rss|feed|atom/i.test(text)) continue;
    seen.add(url.href);
    found.push({ url: url.href, type: "discovered_feed_link", title: text.slice(0, 120) || "Website feed" });
  }
  return found.slice(0, 12);
}

function discoverOwnedPageCandidates(html, baseUrl) {
  const found = [];
  const seen = new Set([baseUrl]);
  for (const match of String(html).matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = safeUrl(match[1], baseUrl);
    if (!url || !sameSite(url.href, baseUrl) || seen.has(url.href)) continue;
    const label = cleanText(match[2]);
    const haystack = `${url.pathname} ${label}`.toLowerCase();
    if (!/(contact|about|location|locations|visit|find us|connect|restaurant|our story)/.test(haystack)) continue;
    if (/\.(pdf|jpg|jpeg|png|webp|gif|zip)$/i.test(url.pathname)) continue;
    seen.add(url.href);
    found.push({ url: url.href, associationBasis: /location|locations|visit|find us/.test(haystack) ? "linked_from_official_location_page" : "linked_from_official_website" });
  }
  return found.slice(0, Math.max(0, ownedPageLimit - 1));
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
    return { html: await response.text(), url: response.url || url };
  } catch (error) {
    return { error: error.name === "TimeoutError" ? "timeout" : error.message, url };
  }
}

async function scanLinkHub(hub, observedAt) {
  if (!(await robotsAllows(hub.url))) return { profiles: [], failure: { url: hub.url, reason: "robots_disallow" } };
  const fetched = await fetchHtml(hub.url);
  if (!fetched.html) return { profiles: [], failure: { url: hub.url, reason: fetched.error || "fetch_failed" } };
  const discovered = discoverAnchorPlatforms(fetched.html, fetched.url, "linked_from_official_link_hub", observedAt);
  return { profiles: discovered.socialProfiles, failure: null };
}

const records = new Array(targets.length);
const failures = [];

async function scanRestaurant(item) {
  const { restaurant, index, website } = item;
  const observedAt = new Date().toISOString();
  const home = await fetchHtml(website);
  if (!home.html) {
    failures.push({ restaurantId: restaurant.id, name: restaurant.name, website, reason: home.error || "fetch_failed" });
    return;
  }
  const resolvedUrl = home.url;
  const robots = await robotsFor(resolvedUrl);
  const pageCandidates = discoverOwnedPageCandidates(home.html, resolvedUrl);
  const pages = [{ url: resolvedUrl, html: home.html, associationBasis: "linked_from_official_website" }];

  for (const candidate of pageCandidates) {
    if (pages.some((page) => page.url === candidate.url)) continue;
    const fetched = await fetchHtml(candidate.url);
    if (fetched.html) pages.push({ url: fetched.url, html: fetched.html, associationBasis: candidate.associationBasis });
  }

  let socialProfiles = [];
  let linkHubs = [];
  let relatedLinks = [];
  let feeds = [];
  for (const page of pages) {
    const anchor = discoverAnchorPlatforms(page.html, page.url, page.associationBasis, observedAt);
    const jsonld = discoverJsonLdPlatforms(page.html, page.url, observedAt);
    socialProfiles.push(...anchor.socialProfiles, ...jsonld.socialProfiles);
    linkHubs.push(...anchor.linkHubs, ...jsonld.linkHubs);
    relatedLinks.push(...discoverRelatedLinks(page.html, page.url, page.associationBasis, observedAt));
    feeds.push(...discoverFeeds(page.html, page.url).map((feed) => ({ ...feed, discoveredFrom: page.url, reviewState: "verified_link" })));
  }

  linkHubs = dedupePlatformRecords(linkHubs);
  for (const hub of linkHubs.slice(0, linkHubLimit)) {
    const hubResult = await scanLinkHub(hub, observedAt);
    socialProfiles.push(...hubResult.profiles);
    if (hubResult.failure) failures.push({ restaurantId: restaurant.id, name: restaurant.name, website, reason: `link_hub_${hubResult.failure.reason}`, sourceUrl: hubResult.failure.url });
  }
  socialProfiles = dedupePlatformRecords(socialProfiles.filter((profile) => SOCIAL_PLATFORM_IDS.has(profile.platform)));
  relatedLinks = relatedLinks.filter((link, idx, all) => all.findIndex((item) => `${item.kind}|${item.url}` === `${link.kind}|${link.url}`) === idx).slice(0, 60);
  feeds = feeds.filter((feed, idx, all) => all.findIndex((item) => item.url === feed.url) === idx).slice(0, 12);

  records[index] = {
    restaurantId: restaurant.id,
    name: restaurant.name,
    website,
    resolvedUrl,
    observedAt,
    lastVerifiedAt: observedAt,
    scannedOwnedPages: pages.map((page) => page.url),
    socialProfiles,
    linkHubs,
    relatedLinks,
    feeds,
    sitemaps: (robots.sitemaps || []).filter((url) => sameSite(url, resolvedUrl)).slice(0, 12),
    sourceKind: "official_website_discovery",
    reviewState: "verified"
  };
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
const linkHubCounts = {};
for (const record of finalRecords) {
  for (const profile of record.socialProfiles || []) platformCounts[profile.platform] = (platformCounts[profile.platform] || 0) + 1;
  for (const hub of record.linkHubs || []) linkHubCounts[hub.platform] = (linkHubCounts[hub.platform] || 0) + 1;
}
const relatedKindCounts = {};
for (const record of finalRecords) for (const link of record.relatedLinks || []) relatedKindCounts[link.kind] = (relatedKindCounts[link.kind] || 0) + 1;
const profileCount = finalRecords.reduce((sum, record) => sum + record.socialProfiles.length, 0);
const linkHubCount = finalRecords.reduce((sum, record) => sum + record.linkHubs.length, 0);
const relatedLinkCount = finalRecords.reduce((sum, record) => sum + record.relatedLinks.length, 0);
const feedCount = finalRecords.reduce((sum, record) => sum + record.feeds.length, 0);
const output = {
  version: 3,
  generatedAt: new Date().toISOString(),
  platformRegistryVersion: socialRegistry.version,
  checkedWebsites: finalRecords.length,
  failedWebsites: failures.length,
  hostGroups: hostGroups.length,
  concurrency,
  ownedPageLimit,
  linkHubLimit,
  profileCount,
  platformCounts,
  linkHubCount,
  linkHubCounts,
  relatedLinkCount,
  relatedKindCounts,
  feedCount,
  failures: failures.slice(0, 200),
  records: finalRecords
};

await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(new URL("../data/build/first-party-sources.json", import.meta.url), JSON.stringify(output, null, 2));
await writeFile(new URL("../data/first-party-sources.js", import.meta.url), `window.HALIFAX_FIRST_PARTY_SOURCES = ${JSON.stringify(output, null, 2)};\n`);
console.log(`First-party source discovery: websites=${finalRecords.length}, failures=${failures.length}, profiles=${profileCount}, hubs=${linkHubCount}, related=${relatedLinkCount}, feeds=${feedCount}, hosts=${hostGroups.length}, concurrency=${concurrency}.`);
console.log(`Social platforms: ${Object.entries(platformCounts).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`);
console.log(`Link hubs: ${Object.entries(linkHubCounts).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`);
console.log(`Related links: ${Object.entries(relatedKindCounts).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`);