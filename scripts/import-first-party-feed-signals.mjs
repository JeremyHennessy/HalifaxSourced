import { fetchPublicSource, withSourceDeadline } from "./lib/fetch-public-source.mjs";
import { createRobotsAllows } from "./lib/robots-policy.mjs";
import { feedEntryBlocks, feedKey, hasFeedSignals, readPreviousFeedPosts, reconcileFeedPosts } from "./lib/first-party-feed-safety.mjs";
import integrity from "../source-integrity.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { LIFECYCLE_SIGNAL_GROUPS } from "./lib/lifecycle-language.mjs";

const sourcePayload = JSON.parse(await readFile(new URL("../data/build/first-party-sources.json", import.meta.url), "utf8"));
const reviewOverrides = JSON.parse(await readFile(new URL("../data/feed-review-overrides.json", import.meta.url), "utf8"));
if (!Array.isArray(sourcePayload?.records) || sourcePayload.records.some(record => !record || typeof record.restaurantId !== "string" || !record.restaurantId.trim() || (record.feeds !== undefined && !Array.isArray(record.feeds)))) throw new Error("Invalid first-party source associations");
if (!Array.isArray(reviewOverrides?.records) || reviewOverrides.records.some(record => !record || (record.reviewState === "reviewed_exclusion" && (!Array.isArray(record.feedUrls) || record.feedUrls.some(url => typeof url !== "string"))))) throw new Error("Invalid feed review exclusions");
const sourceRecords = sourcePayload.records;
const previousPosts = await readPreviousFeedPosts(new URL("../data/build/website-feed-signals.json", import.meta.url), new URL("../data/website-feed-signals.js", import.meta.url));
function setting(name, fallback, { min = 0, max = Infinity, integer = false } = {}) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`Invalid ${name}`);
  return value;
}
const delayMs = setting("FEED_PULL_DELAY_MS", 200);
const timeoutMs = setting("FEED_PULL_TIMEOUT_MS", 12000, { min: 1 });
const concurrency = Math.max(1, Math.min(16, setting("FEED_PULL_CONCURRENCY", 8, { min: 1, integer: true })));
const feedLimit = setting("FEED_PULL_LIMIT", 120, { integer: true });
const lookbackDays = setting("FEED_LOOKBACK_DAYS", 180);
const excerptChars = Math.max(120, Math.min(700, setting("FEED_EXCERPT_CHARS", 420, { integer: true })));
const userAgent = "HalifaxSourced/0.3 (+https://github.com/JeremyHennessy/HalifaxSourced)";
const now = Date.now();
const cutoff = now - lookbackDays * 24 * 60 * 60 * 1000;
const robotsAllows = createRobotsAllows({ userAgent, timeoutMs });

const signalGroups = {
  specials: ["happy hour", "special", "specials", "daily feature", "feature menu", "deal", "deals", "offer", "offers", "promo", "promotion"],
  events: ["event", "events", "live music", "trivia", "dj", "karaoke", "ticket", "tickets", "show", "party", "tasting", "dinner series"],
  openings: ["now open", "opening soon", "grand opening", "soft opening", "new location", "coming soon", "newly opened"],
  ...LIFECYCLE_SIGNAL_GROUPS,
  brunch: ["brunch", "breakfast"],
  menu: ["menu", "tasting menu", "seasonal menu", "new menu"],
  patio: ["patio", "rooftop", "terrace", "outdoor seating", "beer garden"]
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
function excerpt(value, maxChars = excerptChars) {
  const text = decode(value)
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length > maxChars ? `${text.slice(0, maxChars - 3).trim()}...` : text;
}
function safeUrl(value, base) {
  try {
    const url = new URL(String(value ?? ""), base);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}
function oembedFeed(value, type = "") {
  try {
    const url = new URL(String(value ?? "").replace(/&#0*38;|&#x0*26;|&amp;/gi, "&"));
    return /oembed/i.test(type) || /\/oembed(?:\/|$)/i.test(url.pathname) || /(?:^|\/)wp-json\/oembed/i.test(url.pathname) || /(?:^|[?&])rest_route=[^&]*oembed/i.test(url.search);
  } catch { return false; }
}
function hostKey(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}
function tagText(fields, tags) {
  for (const tag of tags) {
    const block = fields.find(field => new RegExp(`<${tag}\\b`, "i").test(field.slice(0, field.indexOf(">") + 1))) || "";
    const match = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
    if (match) return decode(match[1]);
  }
  return "";
}
function entryLink(fields, baseUrl) {
  const block = fields.find(field => /^<link\b/i.test(field)) || "";
  const atom = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i);
  if (atom) return safeUrl(decode(atom[1]), baseUrl);
  const link = tagText(fields, ["link"]);
  return link ? safeUrl(link, baseUrl) : null;
}
function entryMedia(fields, baseUrl) {
  const block = fields.find(field => /^<(?:media:content|media:thumbnail)\b/i.test(field)) || "";
  const media = block.match(/<(?:media:content|media:thumbnail)\b[^>]*url=["']([^"']+)["'][^>]*>/i);
  if (media) return safeUrl(decode(media[1]), baseUrl);
  const enclosure = fields.find(field => /^<enclosure\b/i.test(field))?.match(/<enclosure\b[^>]*>/i)?.[0] || "";
  const enclosureUrl = enclosure.match(/\burl=["']([^"']+)["']/i)?.[1] || "";
  const enclosureType = enclosure.match(/\btype=["']([^"']+)["']/i)?.[1] || "";
  return enclosureUrl && (/^image\//i.test(enclosureType) || /\.(?:avif|gif|jpe?g|png|webp)(?:\?|$)/i.test(enclosureUrl)) ? safeUrl(decode(enclosureUrl), baseUrl) : null;
}
function classify(text) {
  const haystack = String(text ?? "").toLowerCase();
  return Object.fromEntries(Object.entries(signalGroups).map(([kind, words]) => [kind, words.filter((word) => haystack.includes(word))]));
}
function parseFeed(xml, baseUrl) {
  const blocks = feedEntryBlocks(xml);
  return blocks.slice(0, 80).map((block) => {
    const title = tagText(block, ["title"]).slice(0, 220);
    const link = entryLink(block, baseUrl);
    if (!title || !link || !integrity.safeSource(link)) throw new Error("invalid_feed_entry");
    const publishedRaw = tagText(block, ["pubDate", "published", "updated", "dc:date"]);
    const publishedStamp = Date.parse(publishedRaw);
    const summary = tagText(block, ["description", "summary", "content:encoded", "content"]);
    const shortExcerpt = excerpt(summary);
    return { title, link, excerpt: shortExcerpt || null, mediaUrl: entryMedia(block, baseUrl), publishedAt: Number.isFinite(publishedStamp) ? new Date(publishedStamp).toISOString() : null, signalMatches: classify(`${title} ${shortExcerpt}`) };
  });
}

function unsafeAssociation(value) {
  return ["quarantined", "reviewed_exclusion", "rejected"].includes(value?.reviewState) || Boolean(value?.quarantined) || value?.identityValidated === false || value?.locationValidated === false || value?.locationSpecific === false || value?.sharedBrandProfile === true;
}
const candidateFeeds = [];
const deniedAssociationKeys = new Set();
for (const record of sourceRecords) {
  for (const feed of record.feeds || []) {
    if (feed?.url && (unsafeAssociation(record) || unsafeAssociation(feed))) deniedAssociationKeys.add(feedKey({ restaurantId: record.restaurantId, url: feed.url }));
    if (!feed?.url || feed.reviewState !== "verified_link" || oembedFeed(feed.url, feed.type)) continue;
    // Ownership comes from the parent; the exact collected URL, not an alias,
    // is the association key for deny, completion and retention decisions.
    candidateFeeds.push({ ...feed, feedUrl: feed.url, restaurantId: record.restaurantId, restaurantName: record.name, website: record.website,
      associationSafe: !unsafeAssociation(record) && !unsafeAssociation(feed) && integrity.safeSource(record.website) && integrity.safeSource(feed.url) });
  }
}

const excludedFeedUrls = new Set(reviewOverrides.records
  .filter(record => record.reviewState === "reviewed_exclusion")
  .flatMap(record => record.feedUrls));
const reviewedFeedsExcluded = candidateFeeds.filter(feed => excludedFeedUrls.has(feed.url));
const eligibleCandidateFeeds = candidateFeeds.filter(feed => !excludedFeedUrls.has(feed.url));

const feedAssociations = new Map();
for (const feed of eligibleCandidateFeeds) {
  if (!feedAssociations.has(feed.url)) feedAssociations.set(feed.url, new Set());
  feedAssociations.get(feed.url).add(feed.restaurantId);
}
const sharedFeedUrls = new Set([...feedAssociations.entries()].filter(([, ids]) => ids.size > 1).map(([url]) => url));
const unsafeKeys = new Set(candidateFeeds.filter(feed => !feed.associationSafe).map(feedKey));
const eligibleFeeds = [...new Map(eligibleCandidateFeeds.filter(feed => feed.associationSafe && !unsafeKeys.has(feedKey(feed)) && !deniedAssociationKeys.has(feedKey(feed)) && !sharedFeedUrls.has(feed.url)).map(feed => [feedKey(feed), feed])).values()];
const eligibleKeys = new Set(eligibleFeeds.map(feedKey));
const feeds = eligibleFeeds.slice(0, feedLimit);
const attemptedKeys = new Set(feeds.map(feedKey));
const completedKeys = new Set();
const posts = [];
const failures = [];
let feedsChecked = 0;
async function scanFeed(feed) {
  const attemptedAt = new Date().toISOString();
  try {
    const entries = await withSourceDeadline(async signal => {
      const response = await fetchPublicSource(feed.url, {
        headers: { "User-Agent": userAgent, Accept: "application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.5" },
        redirect: "manual", signal
      }, async target => {
        const allowed = await robotsAllows(target);
        // The shared policy may finish after this feed's deadline. Never admit
        // a late content request, even if its transport ignores cancellation.
        signal.throwIfAborted();
        return allowed;
      });
      signal.throwIfAborted();
      if (response.status !== 200) throw new Error(`http_${response.status}`);
      const type = (response.headers?.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (type && !["application/rss+xml", "application/atom+xml", "application/xml", "text/xml", "text/plain"].includes(type)) throw new Error("invalid_feed_content_type");
      if (Number(response.headers?.get("content-length")) > 4 * 1024 * 1024) throw new Error("feed_body_too_large");
      const xml = await response.text();
      signal.throwIfAborted();
      return parseFeed(xml, response.url || feed.url);
    }, timeoutMs);
    // Commit only a complete, valid source result. A later parse/body failure
    // cannot leak partial posts or a successful receipt into shared output.
    const observedAt = new Date().toISOString();
    const staged = entries.filter(entry => !entry.publishedAt || Date.parse(entry.publishedAt) >= cutoff).map(entry => ({
      restaurantId: feed.restaurantId,
      restaurantName: feed.restaurantName,
      platform: "website_feed",
      title: entry.title,
      excerpt: entry.excerpt,
      postUrl: entry.link,
      feedUrl: feed.url,
      mediaUrl: entry.mediaUrl,
      publishedAt: entry.publishedAt,
      observedAt,
      signalMatches: Object.fromEntries(Object.entries(entry.signalMatches).filter(([, hits]) => hits.length > 0)),
      sourceKind: "official_feed",
      associationBasis: "unique_feed_link_from_official_website",
      confidence: "official_source_signal",
      reviewState: entry.publishedAt ? "source_signal" : "needs_date_review"
    }));
    posts.push(...staged);
    completedKeys.add(feedKey(feed));
    feedsChecked += 1;
  } catch (error) {
    failures.push({ restaurantId: feed.restaurantId, feedUrl: feed.url, reason: error.name === "TimeoutError" ? "timeout" : error.message, attemptedAt });
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

const retained = [];
let historyOutsideRetentionBounds = 0;
for (const post of previousPosts) {
  const key = feedKey(post);
  if (!eligibleKeys.has(key) || completedKeys.has(key) || !integrity.safeSource(post.postUrl) || (post.mediaUrl && !integrity.safeSource(post.mediaUrl)) || unsafeAssociation(post)) continue;
  // Bound failed and unattempted history by original source dates, never by
  // generatedAt/attempt time. Missing publication uses the original observation.
  const stamp = Date.parse(post.publishedAt || post.observedAt || "");
  const observed = Date.parse(post.observedAt || "");
  if (!Number.isFinite(stamp) || stamp < cutoff || stamp > now || (Number.isFinite(observed) && observed > now)) { historyOutsideRetentionBounds++; continue; }
  retained.push(post);
}
const uniquePosts = reconcileFeedPosts(posts, retained);
const uniqueSignals = uniquePosts.filter(hasFeedSignals);
const retainedSet = new Set(retained);
const retainedWinners = uniquePosts.filter(post => retainedSet.has(post));
const output = {
  version: 3,
  generatedAt: new Date().toISOString(),
  feedsDiscovered: candidateFeeds.length,
  reviewedFeedsExcluded: reviewedFeedsExcluded.length,
  uniqueRestaurantFeeds: feeds.length,
  sharedFeedUrlsSkipped: sharedFeedUrls.size,
  feedHostGroups: groups.length,
  concurrency,
  lookbackDays,
  excerptChars,
  feedsChecked,
  unattemptedFeeds: eligibleFeeds.length - feeds.length,
  retainedPosts: retainedWinners.length,
  retainedFeeds: new Set(retainedWinners.map(feedKey)).size,
  retainedAfterFailure: retainedWinners.filter(post => attemptedKeys.has(feedKey(post))).length,
  retainedUnattempted: retainedWinners.filter(post => !attemptedKeys.has(feedKey(post))).length,
  historyOutsideRetentionBounds,
  failedFeeds: failures.length,
  posts: uniquePosts,
  signals: uniqueSignals,
  failures: failures.slice(0, 100)
};
await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(new URL("../data/build/website-feed-signals.json", import.meta.url), JSON.stringify(output, null, 2));
await writeFile(new URL("../data/website-feed-signals.js", import.meta.url), `window.HALIFAX_WEBSITE_FEED_SIGNALS = ${JSON.stringify(output, null, 2)};\n`);
console.log(`Website feed pull: discovered=${candidateFeeds.length}, reviewed-excluded=${reviewedFeedsExcluded.length}, unique=${feeds.length}, shared-skipped=${sharedFeedUrls.size}, checked=${feedsChecked}, failures=${failures.length}, posts=${uniquePosts.length}, signals=${uniqueSignals.length}, hosts=${groups.length}, concurrency=${concurrency}.`);
