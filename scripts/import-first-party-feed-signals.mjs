import { mkdir, readFile, writeFile } from "node:fs/promises";

const sourcePayload = JSON.parse(await readFile(new URL("../data/build/first-party-sources.json", import.meta.url), "utf8").catch(() => "{\"records\":[]}"));
const sourceRecords = Array.isArray(sourcePayload?.records) ? sourcePayload.records : [];
const delayMs = Number(process.env.FEED_PULL_DELAY_MS ?? 200);
const timeoutMs = Number(process.env.FEED_PULL_TIMEOUT_MS ?? 12000);
const concurrency = Math.max(1, Math.min(16, Number(process.env.FEED_PULL_CONCURRENCY ?? 8)));
const feedLimit = Number(process.env.FEED_PULL_LIMIT ?? 120);
const lookbackDays = Number(process.env.FEED_LOOKBACK_DAYS ?? 180);
const userAgent = "HalifaxSourced/0.3 (+https://github.com/JeremyHennessy/HalifaxSourced)";
const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;

const signalGroups = {
  specials: ["happy hour", "special", "specials", "daily feature", "feature menu", "deal", "deals", "offer", "offers", "promo", "promotion"],
  events: ["event", "events", "live music", "trivia", "dj", "karaoke", "ticket", "tickets", "show", "party", "tasting", "dinner series"],
  openings: ["now open", "opening soon", "grand opening", "soft opening", "new location", "coming soon", "newly opened"],
  brunch: ["brunch", "breakfast"],
  menu: ["menu", "tasting menu", "seasonal menu", "new menu"]
};

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function decode(value) {
  return String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
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
function safeUrl(value, base) {
  try {
    const url = new URL(String(value ?? ""), base);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}
function hostKey(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}
function tagText(block, tags) {
  for (const tag of tags) {
    const match = String(block).match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
    if (match) return decode(match[1]);
  }
  return "";
}
function entryLink(block, baseUrl) {
  const atom = String(block).match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i);
  if (atom) return safeUrl(atom[1], baseUrl);
  return safeUrl(tagText(block, ["link"]), baseUrl);
}
function classify(text) {
  const haystack = String(text ?? "").toLowerCase();
  return Object.fromEntries(Object.entries(signalGroups).map(([kind, words]) => [kind, words.filter((word) => haystack.includes(word))]));
}
function parseFeed(xml, baseUrl) {
  const blocks = [
    ...String(xml).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi),
    ...String(xml).matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)
  ].map((match) => match[1]);
  return blocks.slice(0, 80).map((block) => {
    const title = tagText(block, ["title"]).slice(0, 220);
    const link = entryLink(block, baseUrl);
    const publishedRaw = tagText(block, ["pubDate", "published", "updated", "dc:date"]);
    const publishedStamp = Date.parse(publishedRaw);
    const summary = tagText(block, ["description", "summary", "content:encoded", "content"]);
    return { title, link, publishedAt: Number.isFinite(publishedStamp) ? new Date(publishedStamp).toISOString() : null, signalMatches: classify(`${title} ${summary}`) };
  });
}

const candidateFeeds = [];
for (const record of sourceRecords) {
  for (const feed of record.feeds || []) {
    if (!feed?.url || feed.reviewState !== "verified_link") continue;
    candidateFeeds.push({ restaurantId: record.restaurantId, restaurantName: record.name, website: record.website, ...feed });
  }
}

const feedAssociations = new Map();
for (const feed of candidateFeeds) {
  if (!feedAssociations.has(feed.url)) feedAssociations.set(feed.url, new Set());
  feedAssociations.get(feed.url).add(feed.restaurantId);
}
const sharedFeedUrls = new Set([...feedAssociations.entries()].filter(([, ids]) => ids.size > 1).map(([url]) => url));
const feeds = candidateFeeds.filter((feed) => !sharedFeedUrls.has(feed.url)).slice(0, feedLimit);

const signals = [];
const failures = [];
let feedsChecked = 0;
async function scanFeed(feed) {
  const observedAt = new Date().toISOString();
  try {
    const response = await fetch(feed.url, {
      headers: { "User-Agent": userAgent, Accept: "application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.5" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) { failures.push({ restaurantId: feed.restaurantId, feedUrl: feed.url, reason: `http_${response.status}` }); return; }
    const xml = await response.text();
    feedsChecked += 1;
    for (const entry of parseFeed(xml, response.url || feed.url)) {
      if (!entry.title || !entry.link) continue;
      if (entry.publishedAt && Date.parse(entry.publishedAt) < cutoff) continue;
      const matchedKinds = Object.entries(entry.signalMatches).filter(([, hits]) => hits.length > 0);
      if (!matchedKinds.length) continue;
      signals.push({
        restaurantId: feed.restaurantId,
        restaurantName: feed.restaurantName,
        platform: "website_feed",
        title: entry.title,
        postUrl: entry.link,
        feedUrl: feed.url,
        publishedAt: entry.publishedAt,
        observedAt,
        signalMatches: Object.fromEntries(matchedKinds),
        sourceKind: "official_feed",
        associationBasis: "unique_feed_link_from_official_website",
        confidence: "official_source_signal",
        reviewState: entry.publishedAt ? "source_signal" : "needs_date_review"
      });
    }
  } catch (error) {
    failures.push({ restaurantId: feed.restaurantId, feedUrl: feed.url, reason: error.name === "TimeoutError" ? "timeout" : error.message });
  }
}

const hostGroups = new Map();
for (const feed of feeds) {
  const host = hostKey(feed.url) || feed.url;
  if (!hostGroups.has(host)) hostGroups.set(host, []);
  hostGroups.get(host).push(feed);
}
const groups = [...hostGroups.values()];
let nextGroup = 0;
async function worker() {
  while (true) {
    const current = nextGroup++;
    if (current >= groups.length) return;
    for (const feed of groups[current]) {
      await scanFeed(feed);
      if (delayMs > 0) await sleep(delayMs);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, groups.length || 1) }, () => worker()));

const uniqueSignals = signals.filter((signal, index, all) => all.findIndex((item) => item.restaurantId === signal.restaurantId && item.postUrl === signal.postUrl) === index)
  .sort((a, b) => String(b.publishedAt || b.observedAt).localeCompare(String(a.publishedAt || a.observedAt)));
const output = {
  version: 1,
  generatedAt: new Date().toISOString(),
  feedsDiscovered: candidateFeeds.length,
  uniqueRestaurantFeeds: feeds.length,
  sharedFeedUrlsSkipped: sharedFeedUrls.size,
  feedHostGroups: groups.length,
  concurrency,
  feedsChecked,
  failedFeeds: failures.length,
  signals: uniqueSignals,
  failures: failures.slice(0, 100)
};
await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(new URL("../data/build/website-feed-signals.json", import.meta.url), JSON.stringify(output, null, 2));
await writeFile(new URL("../data/website-feed-signals.js", import.meta.url), `window.HALIFAX_WEBSITE_FEED_SIGNALS = ${JSON.stringify(output, null, 2)};\n`);
console.log(`Website feed pull: discovered=${candidateFeeds.length}, unique=${feeds.length}, shared-skipped=${sharedFeedUrls.size}, checked=${feedsChecked}, failures=${failures.length}, signals=${uniqueSignals.length}, hosts=${groups.length}, concurrency=${concurrency}.`);
