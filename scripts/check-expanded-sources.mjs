import { mkdir, readFile, writeFile } from "node:fs/promises";
import vm from "node:vm";

async function loadWindowScript(path) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: path, timeout: 20_000 });
  return context.window;
}

const catalog = JSON.parse(await readFile(new URL("../data/build/catalog.json", import.meta.url), "utf8"));
const socialRegistry = JSON.parse(await readFile(new URL("../data/social-platform-registry.json", import.meta.url), "utf8"));
const discoveredWindow = await loadWindowScript("data/discovered-restaurants.js").catch(() => ({ HALIFAX_DISCOVERED_RESTAURANTS: [] }));
const discoveredRestaurants = Array.isArray(discoveredWindow.HALIFAX_DISCOVERED_RESTAURANTS) ? discoveredWindow.HALIFAX_DISCOVERED_RESTAURANTS : [];
const restaurantIds = new Set([...(catalog.restaurants || []), ...discoveredRestaurants].map((restaurant) => restaurant.id));
const firstPartyWindow = await loadWindowScript("data/first-party-sources.js");
const feedWindow = await loadWindowScript("data/website-feed-signals.js");
const socialWindow = await loadWindowScript("data/social-signals.js");
const firstParty = firstPartyWindow.HALIFAX_FIRST_PARTY_SOURCES || { records: [] };
const feedPayload = feedWindow.HALIFAX_WEBSITE_FEED_SIGNALS || { signals: [] };
const socialPayload = socialWindow.HALIFAX_SOCIAL_SIGNALS || { signals: [] };
const records = Array.isArray(firstParty.records) ? firstParty.records : [];
const feedSignals = Array.isArray(feedPayload.signals) ? feedPayload.signals : [];
const feedPosts = Array.isArray(feedPayload.posts) ? feedPayload.posts : feedSignals;
const socialSignals = Array.isArray(socialPayload.signals) ? socialPayload.signals : [];
const failures = [];
const warnings = [];

const platformById = new Map((socialRegistry.platforms || []).map((platform) => [platform.id, platform]));
const associationBases = new Set(socialRegistry.associationBases || []);
const confidenceValues = new Set(socialRegistry.confidenceValues || []);

function validUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return ["http:", "https:"].includes(url.protocol);
  } catch { return false; }
}
function hasEscapedUrlEntities(value) { return /&(?:amp|#0*38|#x0*26);/i.test(String(value ?? "")); }
function validDate(value) { return Number.isFinite(Date.parse(String(value ?? ""))); }
function hasSignalMatches(value) { return value && typeof value === "object" && Object.values(value).some((hits) => Array.isArray(hits) && hits.length > 0); }
function duplicates(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1);
}
function host(value) {
  try { return new URL(String(value ?? "")).hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, ""); }
  catch { return ""; }
}
function platformLinkValid(item, expectedKind) {
  const metadata = platformById.get(String(item?.platform || "").toLowerCase());
  if (!metadata || metadata.kind !== expectedKind || !item.handle || !validUrl(item.url || item.profileUrl)) return false;
  const actualHost = host(item.url || item.profileUrl);
  if (!(metadata.hosts || []).some((expected) => actualHost === expected || actualHost.endsWith(`.${expected}`))) return false;
  if (!associationBases.has(item.associationBasis) || !confidenceValues.has(item.confidence) || item.reviewState !== "verified_link") return false;
  if (!validDate(item.observedAt) || !validDate(item.lastVerifiedAt) || item.status !== "active") return false;
  return true;
}

const duplicateRecords = duplicates(records, (record) => record.restaurantId);
if (duplicateRecords.length) failures.push({ type: "duplicate_first_party_source_records", values: duplicateRecords.slice(0, 30) });

for (const record of records) {
  if (!restaurantIds.has(record.restaurantId) || !validUrl(record.website) || record.sourceKind !== "official_website_discovery") {
    failures.push({ type: "invalid_first_party_source_record", restaurantId: record.restaurantId, website: record.website });
    continue;
  }
  for (const profile of record.socialProfiles || []) {
    if (!platformLinkValid(profile, "social")) {
      failures.push({ type: "invalid_social_profile_discovery", restaurantId: record.restaurantId, platform: profile.platform, url: profile.url, associationBasis: profile.associationBasis });
    }
  }
  for (const hub of record.linkHubs || []) {
    if (!platformLinkValid(hub, "link_hub")) {
      failures.push({ type: "invalid_link_hub_discovery", restaurantId: record.restaurantId, platform: hub.platform, url: hub.url, associationBasis: hub.associationBasis });
    }
  }
  for (const related of record.relatedLinks || []) {
    if (!validUrl(related.url) || hasEscapedUrlEntities(related.url) || !["reservations", "ordering", "menu", "events", "newsletter", "tickets"].includes(related.kind) || related.reviewState !== "verified_link" || !associationBases.has(related.associationBasis) || !confidenceValues.has(related.confidence) || !validDate(related.observedAt) || !validDate(related.lastVerifiedAt)) {
      failures.push({ type: "invalid_related_link_discovery", restaurantId: record.restaurantId, kind: related.kind, url: related.url });
    }
  }
  for (const feed of record.feeds || []) {
    if (!validUrl(feed.url) || feed.reviewState !== "verified_link") failures.push({ type: "invalid_feed_discovery", restaurantId: record.restaurantId, url: feed.url });
  }
}

const duplicateFeedSignals = duplicates(feedSignals, (signal) => `${signal.restaurantId}|${signal.postUrl}`);
if (duplicateFeedSignals.length) failures.push({ type: "duplicate_website_feed_signals", values: duplicateFeedSignals.slice(0, 30) });
for (const signal of feedSignals) {
  if (!restaurantIds.has(signal.restaurantId) || !validUrl(signal.postUrl) || !validUrl(signal.feedUrl) || !validDate(signal.observedAt) || !hasSignalMatches(signal.signalMatches) || signal.sourceKind !== "official_feed" || signal.associationBasis !== "unique_feed_link_from_official_website") {
    failures.push({ type: "invalid_website_feed_signal", restaurantId: signal.restaurantId, postUrl: signal.postUrl });
  }
  if (Object.hasOwn(signal, "description") || Object.hasOwn(signal, "summary") || Object.hasOwn(signal, "content")) failures.push({ type: "website_feed_raw_body_retained", restaurantId: signal.restaurantId, postUrl: signal.postUrl });
}

const duplicateFeedPosts = duplicates(feedPosts, (post) => `${post.restaurantId}|${post.postUrl}`);
if (duplicateFeedPosts.length) failures.push({ type: "duplicate_website_feed_posts", values: duplicateFeedPosts.slice(0, 30) });
for (const post of feedPosts) {
  if (!restaurantIds.has(post.restaurantId) || !validUrl(post.postUrl) || !validUrl(post.feedUrl) || !validDate(post.observedAt) || post.sourceKind !== "official_feed" || post.associationBasis !== "unique_feed_link_from_official_website") {
    failures.push({ type: "invalid_website_feed_post", restaurantId: post.restaurantId, postUrl: post.postUrl });
  }
  if (post.mediaUrl && !validUrl(post.mediaUrl)) failures.push({ type: "invalid_website_feed_media", restaurantId: post.restaurantId, mediaUrl: post.mediaUrl });
  if (Object.hasOwn(post, "description") || Object.hasOwn(post, "summary") || Object.hasOwn(post, "content")) failures.push({ type: "website_feed_raw_body_retained", restaurantId: post.restaurantId, postUrl: post.postUrl });
}

const duplicateSocialSignals = duplicates(socialSignals, (signal) => `${signal.platform}|${signal.restaurantId}|${signal.postId}`);
if (duplicateSocialSignals.length) failures.push({ type: "duplicate_social_signals", values: duplicateSocialSignals.slice(0, 30) });
for (const signal of socialSignals) {
  if (!restaurantIds.has(signal.restaurantId) || !["facebook", "instagram"].includes(signal.platform) || !validUrl(signal.profileUrl) || !validUrl(signal.postUrl) || !validDate(signal.publishedAt) || !validDate(signal.observedAt) || !hasSignalMatches(signal.signalMatches) || signal.reviewState !== "api_observed" || !String(signal.sourceKind || "").startsWith("meta_graph_api") || signal.associationBasis !== "unique_profile_link_from_official_website") {
    failures.push({ type: "invalid_social_signal", restaurantId: signal.restaurantId, platform: signal.platform, postId: signal.postId });
  }
  if (Object.hasOwn(signal, "caption") || Object.hasOwn(signal, "message") || Object.hasOwn(signal, "text")) failures.push({ type: "social_raw_post_text_retained", restaurantId: signal.restaurantId, platform: signal.platform, postId: signal.postId });
}

if (socialPayload.credentialState?.facebook === "missing") warnings.push({ type: "facebook_api_credentials_missing" });
if (socialPayload.credentialState?.instagram === "missing") warnings.push({ type: "instagram_api_credentials_missing" });
if ((socialPayload.sharedProfileAssociationsSkipped || 0) > 0) warnings.push({ type: "shared_brand_social_profiles_excluded", count: socialPayload.sharedProfileAssociationsSkipped });
if ((feedPayload.sharedFeedUrlsSkipped || 0) > 0) warnings.push({ type: "shared_brand_feeds_excluded", count: feedPayload.sharedFeedUrlsSkipped });

const platformCounts = {};
const linkHubCounts = {};
const associationBasisCounts = {};
for (const record of records) {
  for (const profile of record.socialProfiles || []) {
    platformCounts[profile.platform] = (platformCounts[profile.platform] || 0) + 1;
    associationBasisCounts[profile.associationBasis] = (associationBasisCounts[profile.associationBasis] || 0) + 1;
  }
  for (const hub of record.linkHubs || []) linkHubCounts[hub.platform] = (linkHubCounts[hub.platform] || 0) + 1;
}
const relatedKindCounts = {};
for (const record of records) for (const link of record.relatedLinks || []) relatedKindCounts[link.kind] = (relatedKindCounts[link.kind] || 0) + 1;
const report = {
  generatedAt: new Date().toISOString(),
  socialPlatformRegistryVersion: socialRegistry.version,
  counts: {
    firstPartyRecords: records.length,
    socialProfiles: records.reduce((sum, record) => sum + (record.socialProfiles?.length || 0), 0),
    platformCounts,
    linkHubs: records.reduce((sum, record) => sum + (record.linkHubs?.length || 0), 0),
    linkHubCounts,
    associationBasisCounts,
    relatedLinks: records.reduce((sum, record) => sum + (record.relatedLinks?.length || 0), 0),
    relatedKindCounts,
    websiteFeeds: records.reduce((sum, record) => sum + (record.feeds?.length || 0), 0),
    uniqueRestaurantFeeds: feedPayload.uniqueRestaurantFeeds ?? null,
    sharedFeedUrlsSkipped: feedPayload.sharedFeedUrlsSkipped ?? 0,
    websiteFeedSignals: feedSignals.length,
    websiteFeedPosts: feedPosts.length,
    uniqueRestaurantSocialProfiles: socialPayload.uniqueRestaurantProfiles ?? null,
    sharedProfileAssociationsSkipped: socialPayload.sharedProfileAssociationsSkipped ?? 0,
    socialSignals: socialSignals.length
  },
  credentialState: socialPayload.credentialState || null,
  failures,
  warnings
};

await mkdir(new URL("../artifacts", import.meta.url), { recursive: true });
await writeFile(new URL("../artifacts/expanded-source-integrity-report.json", import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.counts, null, 2));
if (warnings.length) console.warn(`Expanded source warnings: ${warnings.map((warning) => `${warning.type}${warning.count ? `=${warning.count}` : ""}`).join(", ")}`);
if (failures.length) {
  console.error(JSON.stringify(failures.slice(0, 30), null, 2));
  process.exit(1);
}
console.log("Expanded source integrity checks passed.");
