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
const restaurantIds = new Set((catalog.restaurants || []).map((restaurant) => restaurant.id));
const firstPartyWindow = await loadWindowScript("data/first-party-sources.js");
const feedWindow = await loadWindowScript("data/website-feed-signals.js");
const socialWindow = await loadWindowScript("data/social-signals.js");
const firstParty = firstPartyWindow.HALIFAX_FIRST_PARTY_SOURCES || { records: [] };
const feedPayload = feedWindow.HALIFAX_WEBSITE_FEED_SIGNALS || { signals: [] };
const socialPayload = socialWindow.HALIFAX_SOCIAL_SIGNALS || { signals: [] };
const records = Array.isArray(firstParty.records) ? firstParty.records : [];
const feedSignals = Array.isArray(feedPayload.signals) ? feedPayload.signals : [];
const socialSignals = Array.isArray(socialPayload.signals) ? socialPayload.signals : [];
const failures = [];
const warnings = [];

function validUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return ["http:", "https:"].includes(url.protocol);
  } catch { return false; }
}
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

const duplicateRecords = duplicates(records, (record) => record.restaurantId);
if (duplicateRecords.length) failures.push({ type: "duplicate_first_party_source_records", values: duplicateRecords.slice(0, 30) });

for (const record of records) {
  if (!restaurantIds.has(record.restaurantId) || !validUrl(record.website) || record.sourceKind !== "official_website_discovery") {
    failures.push({ type: "invalid_first_party_source_record", restaurantId: record.restaurantId, website: record.website });
    continue;
  }
  for (const profile of record.socialProfiles || []) {
    const expectedHost = profile.platform === "facebook" ? /(^|\.)facebook\.com$/i : profile.platform === "instagram" ? /(^|\.)instagram\.com$/i : null;
    let host = "";
    try { host = new URL(profile.url).hostname; } catch {}
    if (!expectedHost || !expectedHost.test(host) || !profile.handle || profile.reviewState !== "verified_link" || profile.associationBasis !== "linked_from_official_website") {
      failures.push({ type: "invalid_social_profile_discovery", restaurantId: record.restaurantId, platform: profile.platform, url: profile.url });
    }
  }
  for (const feed of record.feeds || []) {
    if (!validUrl(feed.url) || feed.reviewState !== "verified_link") failures.push({ type: "invalid_feed_discovery", restaurantId: record.restaurantId, url: feed.url });
  }
}

const duplicateFeedSignals = duplicates(feedSignals, (signal) => `${signal.restaurantId}|${signal.postUrl}`);
if (duplicateFeedSignals.length) failures.push({ type: "duplicate_website_feed_signals", values: duplicateFeedSignals.slice(0, 30) });
for (const signal of feedSignals) {
  if (!restaurantIds.has(signal.restaurantId) || !validUrl(signal.postUrl) || !validUrl(signal.feedUrl) || !validDate(signal.observedAt) || !hasSignalMatches(signal.signalMatches) || signal.sourceKind !== "official_feed") {
    failures.push({ type: "invalid_website_feed_signal", restaurantId: signal.restaurantId, postUrl: signal.postUrl });
  }
  if (Object.hasOwn(signal, "description") || Object.hasOwn(signal, "summary") || Object.hasOwn(signal, "content")) failures.push({ type: "website_feed_raw_body_retained", restaurantId: signal.restaurantId, postUrl: signal.postUrl });
}

const duplicateSocialSignals = duplicates(socialSignals, (signal) => `${signal.platform}|${signal.restaurantId}|${signal.postId}`);
if (duplicateSocialSignals.length) failures.push({ type: "duplicate_social_signals", values: duplicateSocialSignals.slice(0, 30) });
for (const signal of socialSignals) {
  if (!restaurantIds.has(signal.restaurantId) || !["facebook", "instagram"].includes(signal.platform) || !validUrl(signal.profileUrl) || !validUrl(signal.postUrl) || !validDate(signal.publishedAt) || !validDate(signal.observedAt) || !hasSignalMatches(signal.signalMatches) || signal.reviewState !== "api_observed" || !String(signal.sourceKind || "").startsWith("meta_graph_api") || signal.associationBasis !== "linked_from_official_website") {
    failures.push({ type: "invalid_social_signal", restaurantId: signal.restaurantId, platform: signal.platform, postId: signal.postId });
  }
  if (Object.hasOwn(signal, "caption") || Object.hasOwn(signal, "message") || Object.hasOwn(signal, "text")) failures.push({ type: "social_raw_post_text_retained", restaurantId: signal.restaurantId, platform: signal.platform, postId: signal.postId });
}

if (socialPayload.credentialState?.facebook === "missing") warnings.push({ type: "facebook_api_credentials_missing" });
if (socialPayload.credentialState?.instagram === "missing") warnings.push({ type: "instagram_api_credentials_missing" });

const report = {
  generatedAt: new Date().toISOString(),
  counts: {
    firstPartyRecords: records.length,
    socialProfiles: records.reduce((sum, record) => sum + (record.socialProfiles?.length || 0), 0),
    websiteFeeds: records.reduce((sum, record) => sum + (record.feeds?.length || 0), 0),
    websiteFeedSignals: feedSignals.length,
    socialSignals: socialSignals.length
  },
  credentialState: socialPayload.credentialState || null,
  failures,
  warnings
};

await mkdir(new URL("../artifacts", import.meta.url), { recursive: true });
await writeFile(new URL("../artifacts/expanded-source-integrity-report.json", import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.counts, null, 2));
if (warnings.length) console.warn(`Expanded source warnings: ${warnings.map((warning) => warning.type).join(", ")}`);
if (failures.length) {
  console.error(JSON.stringify(failures.slice(0, 30), null, 2));
  process.exit(1);
}
console.log("Expanded source integrity checks passed.");
