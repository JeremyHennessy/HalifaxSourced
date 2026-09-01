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
const feedReviewOverrides = JSON.parse(await readFile(new URL("../data/feed-review-overrides.json", import.meta.url), "utf8").catch(() => "{\"records\":[]}"));
const socialProfileOverrides = JSON.parse(await readFile(new URL("../data/social-profile-review-overrides.json", import.meta.url), "utf8").catch(() => "{\"records\":[]}"));
const discoveredWindow = await loadWindowScript("data/discovered-restaurants.js").catch(() => ({ HALIFAX_DISCOVERED_RESTAURANTS: [] }));
const discoveredRestaurants = Array.isArray(discoveredWindow.HALIFAX_DISCOVERED_RESTAURANTS) ? discoveredWindow.HALIFAX_DISCOVERED_RESTAURANTS : [];
const restaurantIds = new Set([...(catalog.restaurants || []), ...discoveredRestaurants].map((restaurant) => restaurant.id));
const firstPartyWindow = await loadWindowScript("data/first-party-sources.js");
const feedWindow = await loadWindowScript("data/website-feed-signals.js");
const websitePageWindow = await loadWindowScript("data/website-page-intelligence.js").catch(() => ({ HALIFAX_WEBSITE_PAGE_INTELLIGENCE: { records: [], signals: [] } }));
const socialWindow = await loadWindowScript("data/social-signals.js");
const recentWindow = await loadWindowScript("data/recent-social-posts.js").catch(() => ({ HALIFAX_RECENT_SOCIAL_POSTS: { records: [] } }));
const firstParty = firstPartyWindow.HALIFAX_FIRST_PARTY_SOURCES || { records: [] };
const feedPayload = feedWindow.HALIFAX_WEBSITE_FEED_SIGNALS || { signals: [] };
const websitePagePayload = websitePageWindow.HALIFAX_WEBSITE_PAGE_INTELLIGENCE || { records: [], signals: [] };
const socialPayload = socialWindow.HALIFAX_SOCIAL_SIGNALS || { signals: [] };
const recentPayload = recentWindow.HALIFAX_RECENT_SOCIAL_POSTS || { records: [] };
const records = Array.isArray(firstParty.records) ? firstParty.records : [];
const feedSignals = Array.isArray(feedPayload.signals) ? feedPayload.signals : [];
const feedPosts = Array.isArray(feedPayload.posts) ? feedPayload.posts : feedSignals;
const websitePageRecords = Array.isArray(websitePagePayload.records) ? websitePagePayload.records : [];
const socialSignals = Array.isArray(socialPayload.signals) ? socialPayload.signals : [];
const socialPosts = Array.isArray(socialPayload.posts) ? socialPayload.posts : socialSignals;
const recentPosts = Array.isArray(recentPayload.records) ? recentPayload.records : [];
const failures = [];
const warnings = [];
const allowedFeedExclusionReasons = new Set(["compromised_off_topic_feed", "shared_brand_nonlocal_feed"]);
const allowedSocialProfileExclusionReasons = new Set(["person_or_creator_profile", "parent_institution_profile", "wrong_location_profile", "supplier_or_partner_profile", "conflicting_profile_evidence"]);
const allowedRecentCategories = new Set(["happy_hour", "specials", "events", "live_music", "openings", "menu", "patio", "brunch", "seasonal", "reservations", "general_update"]);
const excludedFeedUrls = new Set();
const excludedProfileUrlsByRestaurant = new Map();
for (const record of feedReviewOverrides.records || []) {
  if (!restaurantIds.has(record.restaurantId) || record.reviewState !== "reviewed_exclusion" || !allowedFeedExclusionReasons.has(record.reason) || !validDate(record.observedAt) || !String(record.evidence || "").trim() || !(record.feedUrls || []).length) {
    failures.push({ type: "invalid_feed_review_exclusion", restaurantId: record.restaurantId });
    continue;
  }
  for (const url of record.feedUrls) {
    if (!validUrl(url)) failures.push({ type: "invalid_feed_review_exclusion_url", restaurantId: record.restaurantId, url });
    else excludedFeedUrls.add(url);
  }
}
if ((feedPayload.reviewedFeedsExcluded ?? 0) !== excludedFeedUrls.size) failures.push({ type: "feed_review_exclusion_count_mismatch", expected: excludedFeedUrls.size, actual: feedPayload.reviewedFeedsExcluded ?? 0 });
for (const record of socialProfileOverrides.records || []) {
  if (!restaurantIds.has(record.restaurantId) || record.reviewState !== "reviewed_exclusion" || !allowedSocialProfileExclusionReasons.has(record.reason) || !validDate(record.observedAt) || !String(record.evidence || "").trim() || !(record.profileUrls || []).length) {
    failures.push({ type: "invalid_social_profile_review_exclusion", restaurantId: record.restaurantId });
    continue;
  }
  if (!excludedProfileUrlsByRestaurant.has(record.restaurantId)) excludedProfileUrlsByRestaurant.set(record.restaurantId, new Set());
  const bucket = excludedProfileUrlsByRestaurant.get(record.restaurantId);
  for (const url of record.profileUrls) {
    if (!validUrl(url)) failures.push({ type: "invalid_social_profile_review_exclusion_url", restaurantId: record.restaurantId, url });
    else bucket.add(normalizedUrl(url));
  }
}

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
function hasTemplatePlaceholder(value) { return /\{\{|\}\}|%7b|%7d|\bdata\./i.test(String(value ?? "")); }
function oembedFeed(value, type = "") {
  try {
    const url = new URL(String(value ?? "").replace(/&#0*38;|&#x0*26;|&amp;/gi, "&"));
    return /oembed/i.test(type) || /\/oembed(?:\/|$)/i.test(url.pathname) || /(?:^|\/)wp-json\/oembed/i.test(url.pathname) || /(?:^|[?&])rest_route=[^&]*oembed/i.test(url.search);
  } catch { return false; }
}
function validDate(value) { return Number.isFinite(Date.parse(String(value ?? ""))); }
function hasSignalMatches(value) { return value && typeof value === "object" && Object.values(value).some((hits) => Array.isArray(hits) && hits.length > 0); }
function boundedText(value, max = 700) { return !value || (typeof value === "string" && value.length <= max); }
function hasForbiddenRawTextFields(value) {
  return ["caption", "message", "text", "description", "content", "rawText", "rawBody", "html"].some((field) => Object.hasOwn(value || {}, field));
}
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
function normalizedUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || ["fbclid", "gclid", "igshid", "mc_cid", "mc_eid", "ref", "ref_src", "hl", "mibextid"].includes(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    return `${url.protocol}//${url.hostname.toLowerCase().replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "")}${url.search}`.toLowerCase();
  } catch { return ""; }
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
    if (excludedProfileUrlsByRestaurant.get(record.restaurantId)?.has(normalizedUrl(profile.url || profile.profileUrl))) {
      failures.push({ type: "reviewed_excluded_social_profile_published", restaurantId: record.restaurantId, platform: profile.platform, url: profile.url || profile.profileUrl });
    }
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
    if (!validUrl(related.url) || hasEscapedUrlEntities(related.url) || hasTemplatePlaceholder(related.url) || hasTemplatePlaceholder(related.label) || !["reservations", "ordering", "menu", "events", "newsletter", "tickets"].includes(related.kind) || related.reviewState !== "verified_link" || !associationBases.has(related.associationBasis) || !confidenceValues.has(related.confidence) || !validDate(related.observedAt) || !validDate(related.lastVerifiedAt)) {
      failures.push({ type: "invalid_related_link_discovery", restaurantId: record.restaurantId, kind: related.kind, url: related.url });
    }
  }
  for (const feed of record.feeds || []) {
    if (!validUrl(feed.url) || feed.reviewState !== "verified_link" || oembedFeed(feed.url, feed.type)) failures.push({ type: "invalid_feed_discovery", restaurantId: record.restaurantId, url: feed.url });
  }
}

const duplicateFeedSignals = duplicates(feedSignals, (signal) => `${signal.restaurantId}|${signal.postUrl}`);
if (duplicateFeedSignals.length) failures.push({ type: "duplicate_website_feed_signals", values: duplicateFeedSignals.slice(0, 30) });
for (const signal of feedSignals) {
  if (!restaurantIds.has(signal.restaurantId) || !validUrl(signal.postUrl) || !validUrl(signal.feedUrl) || oembedFeed(signal.feedUrl) || !validDate(signal.observedAt) || !hasSignalMatches(signal.signalMatches) || signal.sourceKind !== "official_feed" || signal.associationBasis !== "unique_feed_link_from_official_website") {
    failures.push({ type: "invalid_website_feed_signal", restaurantId: signal.restaurantId, postUrl: signal.postUrl });
  }
  if (hasForbiddenRawTextFields(signal)) failures.push({ type: "website_feed_raw_body_retained", restaurantId: signal.restaurantId, postUrl: signal.postUrl });
  if (!boundedText(signal.excerpt)) failures.push({ type: "website_feed_excerpt_too_long", restaurantId: signal.restaurantId, postUrl: signal.postUrl });
}

const duplicateFeedPosts = duplicates(feedPosts, (post) => `${post.restaurantId}|${post.postUrl}`);
if (duplicateFeedPosts.length) failures.push({ type: "duplicate_website_feed_posts", values: duplicateFeedPosts.slice(0, 30) });
for (const post of feedPosts) {
  if (!restaurantIds.has(post.restaurantId) || !validUrl(post.postUrl) || !validUrl(post.feedUrl) || oembedFeed(post.feedUrl) || !validDate(post.observedAt) || post.sourceKind !== "official_feed" || post.associationBasis !== "unique_feed_link_from_official_website") {
    failures.push({ type: "invalid_website_feed_post", restaurantId: post.restaurantId, postUrl: post.postUrl });
  }
  if (post.mediaUrl && !validUrl(post.mediaUrl)) failures.push({ type: "invalid_website_feed_media", restaurantId: post.restaurantId, mediaUrl: post.mediaUrl });
  if (excludedFeedUrls.has(post.feedUrl)) failures.push({ type: "reviewed_excluded_feed_post_published", restaurantId: post.restaurantId, feedUrl: post.feedUrl });
  if (hasForbiddenRawTextFields(post)) failures.push({ type: "website_feed_raw_body_retained", restaurantId: post.restaurantId, postUrl: post.postUrl });
  if (!boundedText(post.excerpt)) failures.push({ type: "website_feed_excerpt_too_long", restaurantId: post.restaurantId, postUrl: post.postUrl });
}

const duplicateWebsitePageRecords = duplicates(websitePageRecords, (record) => `${record.restaurantId}|${record.postUrl}`);
if (duplicateWebsitePageRecords.length) failures.push({ type: "duplicate_website_page_intelligence", values: duplicateWebsitePageRecords.slice(0, 30) });
for (const record of websitePageRecords) {
  if (!restaurantIds.has(record.restaurantId) || record.platform !== "official_page" || !validUrl(record.postUrl) || !validDate(record.observedAt) || record.sourceKind !== "official_page_html" || !["same_site_official_page", "official_site_linked_page"].includes(record.associationBasis) || !["source_signal", "needs_date_review"].includes(record.reviewState) || !String(record.title || "").trim() || !boundedText(record.excerpt)) {
    failures.push({ type: "invalid_website_page_intelligence", restaurantId: record.restaurantId, postUrl: record.postUrl });
  }
  if (record.mediaUrl && !validUrl(record.mediaUrl)) failures.push({ type: "invalid_website_page_media", restaurantId: record.restaurantId, mediaUrl: record.mediaUrl });
  if (hasForbiddenRawTextFields(record)) failures.push({ type: "website_page_raw_body_retained", restaurantId: record.restaurantId, postUrl: record.postUrl });
}

const duplicateSocialSignals = duplicates(socialSignals, (signal) => `${signal.platform}|${signal.restaurantId}|${signal.postId}`);
if (duplicateSocialSignals.length) failures.push({ type: "duplicate_social_signals", values: duplicateSocialSignals.slice(0, 30) });
for (const signal of socialSignals) {
  if (!restaurantIds.has(signal.restaurantId) || !["facebook", "instagram"].includes(signal.platform) || !validUrl(signal.profileUrl) || !validUrl(signal.postUrl) || !validDate(signal.publishedAt) || !validDate(signal.observedAt) || !hasSignalMatches(signal.signalMatches) || signal.reviewState !== "api_observed" || !String(signal.sourceKind || "").startsWith("meta_graph_api") || signal.associationBasis !== "unique_profile_link_from_official_website") {
    failures.push({ type: "invalid_social_signal", restaurantId: signal.restaurantId, platform: signal.platform, postId: signal.postId });
  }
  if (hasForbiddenRawTextFields(signal)) failures.push({ type: "social_raw_post_text_retained", restaurantId: signal.restaurantId, platform: signal.platform, postId: signal.postId });
  if (!boundedText(signal.summary)) failures.push({ type: "social_summary_too_long", restaurantId: signal.restaurantId, platform: signal.platform, postId: signal.postId });
}

const duplicateSocialPosts = duplicates(socialPosts, (post) => `${post.platform}|${post.restaurantId}|${post.postId || post.postUrl}`);
if (duplicateSocialPosts.length) failures.push({ type: "duplicate_social_posts", values: duplicateSocialPosts.slice(0, 30) });
for (const post of socialPosts) {
  if (!restaurantIds.has(post.restaurantId) || !["facebook", "instagram"].includes(post.platform) || !validUrl(post.profileUrl) || !validUrl(post.postUrl) || !validDate(post.publishedAt) || !validDate(post.observedAt) || post.reviewState !== "api_observed" || !String(post.sourceKind || "").startsWith("meta_graph_api") || post.associationBasis !== "unique_profile_link_from_official_website") {
    failures.push({ type: "invalid_social_post", restaurantId: post.restaurantId, platform: post.platform, postId: post.postId });
  }
  if (post.mediaUrl && !validUrl(post.mediaUrl)) failures.push({ type: "invalid_social_post_media", restaurantId: post.restaurantId, mediaUrl: post.mediaUrl });
  if (post.thumbnailUrl && !validUrl(post.thumbnailUrl)) failures.push({ type: "invalid_social_post_thumbnail", restaurantId: post.restaurantId, thumbnailUrl: post.thumbnailUrl });
  if (hasForbiddenRawTextFields(post)) failures.push({ type: "social_raw_post_text_retained", restaurantId: post.restaurantId, platform: post.platform, postId: post.postId });
  if (!boundedText(post.summary)) failures.push({ type: "social_summary_too_long", restaurantId: post.restaurantId, platform: post.platform, postId: post.postId });
}

const duplicateRecentPosts = duplicates(recentPosts, (post) => post.id);
if (duplicateRecentPosts.length) failures.push({ type: "duplicate_recent_social_posts", values: duplicateRecentPosts.slice(0, 30) });
for (const post of recentPosts) {
  const categories = Array.isArray(post.categories) ? post.categories : [];
  const categoryIds = categories.map((category) => category.id);
  if (!post.id || !restaurantIds.has(post.restaurantId) || !["website_feed", "official_page", "facebook", "instagram"].includes(post.platform) || !["feed", "website_page", "social_api"].includes(post.sourceFamily) || !validUrl(post.postUrl) || !validDate(post.observedAt) || !String(post.title || "").trim() || !String(post.summary || "").trim() || !allowedRecentCategories.has(post.primaryCategory) || !categoryIds.every((id) => allowedRecentCategories.has(id))) {
    failures.push({ type: "invalid_recent_social_post", id: post.id, restaurantId: post.restaurantId, postUrl: post.postUrl });
  }
  if (post.publishedAt && !validDate(post.publishedAt)) failures.push({ type: "invalid_recent_social_post_date", id: post.id, publishedAt: post.publishedAt });
  if (post.mediaUrl && !validUrl(post.mediaUrl)) failures.push({ type: "invalid_recent_social_post_media", id: post.id, mediaUrl: post.mediaUrl });
  if (post.thumbnailUrl && !validUrl(post.thumbnailUrl)) failures.push({ type: "invalid_recent_social_post_thumbnail", id: post.id, thumbnailUrl: post.thumbnailUrl });
  if (hasForbiddenRawTextFields(post)) failures.push({ type: "recent_social_raw_text_retained", id: post.id });
  if (!boundedText(post.summary, Number(recentPayload.summaryLimit || 700))) failures.push({ type: "recent_social_summary_too_long", id: post.id });
}

if (socialPayload.credentialState?.facebook === "missing") warnings.push({ type: "facebook_api_credentials_missing" });
if (socialPayload.credentialState?.instagram === "missing") warnings.push({ type: "instagram_api_credentials_missing" });
if ((socialPayload.sharedProfileAssociationsSkipped || 0) > 0) warnings.push({ type: "shared_brand_social_profiles_excluded", count: socialPayload.sharedProfileAssociationsSkipped });
if ((feedPayload.sharedFeedUrlsSkipped || 0) > 0) warnings.push({ type: "shared_brand_feeds_excluded", count: feedPayload.sharedFeedUrlsSkipped });
if (recentPosts.length === 0) warnings.push({ type: "recent_social_post_records_empty" });
if (websitePageRecords.length === 0) warnings.push({ type: "website_page_intelligence_records_empty" });

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
const recentCategoryCounts = {};
const recentPlatformCounts = {};
for (const post of recentPosts) {
  recentCategoryCounts[post.primaryCategory] = (recentCategoryCounts[post.primaryCategory] || 0) + 1;
  recentPlatformCounts[post.platform] = (recentPlatformCounts[post.platform] || 0) + 1;
}
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
    reviewedFeedsExcluded: feedPayload.reviewedFeedsExcluded ?? 0,
    websiteFeedSignals: feedSignals.length,
    websiteFeedPosts: feedPosts.length,
    websitePageIntelligence: websitePageRecords.length,
    websitePageRestaurants: new Set(websitePageRecords.map((record) => record.restaurantId)).size,
    uniqueRestaurantSocialProfiles: socialPayload.uniqueRestaurantProfiles ?? null,
    sharedProfileAssociationsSkipped: socialPayload.sharedProfileAssociationsSkipped ?? 0,
    socialSignals: socialSignals.length,
    socialPosts: socialPosts.length,
    recentSocialPosts: recentPosts.length,
    recentSocialPostCategories: recentCategoryCounts,
    recentSocialPostPlatforms: recentPlatformCounts
  },
  credentialState: socialPayload.credentialState || null,
  recentPostState: {
    generatedAt: recentPayload.generatedAt || null,
    lookbackDays: recentPayload.lookbackDays || null,
    sourceState: recentPayload.sourceState || null
  },
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
