import { mkdir, readFile, writeFile } from "node:fs/promises";
import { contentFingerprint, sourceRunHealth } from "./lib/source-run-health.mjs";
import { factOnlyPost } from "./lib/social-fact-candidates.mjs";

const sourcePayload = JSON.parse(await readFile(new URL("../data/build/first-party-sources.json", import.meta.url), "utf8").catch(() => "{\"records\":[]}"));
const previousPayload = JSON.parse(await readFile(new URL("../data/build/social-signals.json", import.meta.url), "utf8").catch(() => "{\"posts\":[]}"));
const sourceRecords = Array.isArray(sourcePayload?.records) ? sourcePayload.records : [];
const graphVersion = String(process.env.META_GRAPH_VERSION || "v25.0").replace(/^\/+|\/+$/g, "");
const facebookToken = process.env.META_FB_ACCESS_TOKEN || "";
const instagramToken = process.env.META_IG_ACCESS_TOKEN || facebookToken;
const instagramUserId = process.env.META_IG_USER_ID || "";
const profileLimit = Number(process.env.SOCIAL_PROFILE_LIMIT ?? 100);
if (!Number.isInteger(profileLimit) || profileLimit < 0 || profileLimit > 200) throw new Error("SOCIAL_PROFILE_LIMIT must be an integer from 0 to 200 per platform");
const postLimit = Math.min(25, Math.max(1, Number(process.env.SOCIAL_POST_LIMIT ?? 15)));
const lookbackDays = Number(process.env.SOCIAL_LOOKBACK_DAYS ?? 60);
const summaryChars = Math.max(120, Math.min(700, Number(process.env.SOCIAL_SUMMARY_CHARS ?? 420)));
const delayMs = Number(process.env.SOCIAL_PULL_DELAY_MS ?? 250);
const timeoutMs = Number(process.env.SOCIAL_PULL_TIMEOUT_MS ?? 12000);
const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
const graphBase = `https://graph.facebook.com/${graphVersion}`;

const signalGroups = {
  specials: ["happy hour", "special", "specials", "daily feature", "feature menu", "deal", "deals", "offer", "offers", "promo", "promotion"],
  events: ["event", "events", "live music", "trivia", "dj", "karaoke", "ticket", "tickets", "show", "party", "tasting", "dinner series"],
  openings: ["now open", "opening soon", "grand opening", "soft opening", "new location", "coming soon", "newly opened"],
  brunch: ["brunch", "breakfast"],
  menu: ["menu", "tasting menu", "seasonal menu", "new menu"],
  patio: ["patio", "rooftop", "terrace", "outdoor seating", "beer garden"]
};

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function classify(text) {
  const haystack = String(text ?? "").toLowerCase();
  return Object.fromEntries(Object.entries(signalGroups).map(([kind, words]) => [kind, words.filter((word) => new RegExp(`\\b${word}\\b`, "i").test(haystack))]));
}
function matchedOnly(matches) {
  return Object.fromEntries(Object.entries(matches).filter(([, hits]) => hits.length > 0));
}
function recent(value) {
  const stamp = Date.parse(String(value ?? ""));
  return Number.isFinite(stamp) && stamp >= cutoff && stamp <= Date.now();
}
async function graphGet(path, params, token) {
  const url = new URL(`${graphBase}/${String(path).replace(/^\//, "")}`);
  for (const [key, value] of Object.entries(params || {})) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  const response = await fetch(url, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.error) {
    const message = `http_${response.status}`;
    const code = body?.error?.code || response.status;
    throw new Error(`${code}:${message}`);
  }
  return body;
}

function profileTargetSet(platform) {
  const raw = [];
  const seen = new Set();
  for (const record of sourceRecords) {
    for (const profile of record.socialProfiles || []) {
      if (profile.platform !== platform || profile.reviewState !== "verified_link" || profile.status !== "active" || !profile.handle) continue;
      const handle = profile.handle.toLowerCase();
      const rowKey = `${record.restaurantId}|${handle}`;
      if (seen.has(rowKey)) continue;
      seen.add(rowKey);
      raw.push({ restaurantId: record.restaurantId, restaurantName: record.name, website: record.website, ...profile, normalizedHandle: handle });
    }
  }

  const associations = new Map();
  for (const profile of raw) {
    if (!associations.has(profile.normalizedHandle)) associations.set(profile.normalizedHandle, new Set());
    associations.get(profile.normalizedHandle).add(profile.restaurantId);
  }
  const sharedHandles = new Set([...associations.entries()].filter(([, ids]) => ids.size > 1).map(([handle]) => handle));
  return {
    targets: raw.filter((profile) => !sharedHandles.has(profile.normalizedHandle) && !profile.sharedBrandProfile),
    sharedAssociationsSkipped: raw.filter((profile) => (sharedHandles.has(profile.normalizedHandle) || profile.sharedBrandProfile)).length,
    sharedHandles: sharedHandles.size
  };
}

const facebookTargets = profileTargetSet("facebook");
const instagramTargets = profileTargetSet("instagram");
const completedProfiles = new Set();
const signals = [];
const posts = [];
const failures = [];
const refreshObservations = [];
const previousPosts = new Map((previousPayload.posts || []).map(post => [`${post.platform}|${post.restaurantId}|${post.postId}`, post]));
function recordProfileReceipt(profile, startedAt, startPostCount) {
  const received = posts.slice(startPostCount);
  const newPosts = received.filter(post => {
    const old = previousPosts.get(`${post.platform}|${post.restaurantId}|${post.postId}`);
    return !old || contentFingerprint(old) !== contentFingerprint(post);
  }).length;
  refreshObservations.push({sourceId:`${profile.platform}|${profile.restaurantId}|${profile.normalizedHandle}`, restaurantId:profile.restaurantId, platform:profile.platform, attempted:true, checkedAt:new Date().toISOString(), lastAttemptAt:startedAt, state:newPosts ? "changed" : "unchanged", postsReceived:received.length, newOrChangedPosts:newPosts});
}
let profilesAttempted = 0;
let postsObserved = 0;

if (facebookToken) {
  for (const profile of facebookTargets.targets.slice(0, profileLimit)) {
    if (delayMs > 0) await sleep(delayMs);
    profilesAttempted += 1;
    const startedAt = new Date().toISOString(), startPostCount = posts.length;
    try {
      const page = await graphGet(profile.handle, { fields: "id,name,link" }, facebookToken);
      const pagePosts = await graphGet(`${page.id}/posts`, { fields: "id,message,created_time,permalink_url", limit: postLimit }, facebookToken);
      if (!Array.isArray(pagePosts.data)) throw new Error("invalid_posts_response");
      completedProfiles.add(`facebook|${profile.restaurantId}|${profile.normalizedHandle}`);
      for (const post of pagePosts.data) {
        if (!recent(post.created_time) || !post.permalink_url) continue;
        postsObserved += 1;
        const matches = matchedOnly(classify(String(post.message || "").slice(0, 20000)));
        const record = {
          restaurantId: profile.restaurantId,
          restaurantName: profile.restaurantName,
          platform: "facebook",
          profileHandle: profile.handle,
          profileUrl: profile.url,
          platformObjectId: page.id,
          postId: post.id,
          postUrl: post.permalink_url || profile.url,
          publishedAt: new Date(post.created_time).toISOString(),
          observedAt: new Date().toISOString(),
          signalMatches: matches,
          sourceKind: "meta_graph_api",
          associationBasis: "unique_profile_link_from_official_website",
          profileAssociationBasis: profile.associationBasis || null,
          profileDiscoveredFrom: profile.discoveredFrom || null,
          locationSpecific: profile.locationSpecific === true,
          confidence: "official_social_api_signal",
          reviewState: "api_observed"
        };
        Object.assign(record, factOnlyPost(post.message, record));
        posts.push(record);
        if (Object.keys(matches).length) signals.push(record);
      }
      recordProfileReceipt(profile, startedAt, startPostCount);
    } catch (error) {
      failures.push({ sourceId:`facebook|${profile.restaurantId}|${profile.normalizedHandle}`, attempted:true, checkedAt:new Date().toISOString(), lastAttemptAt:startedAt, state:"failed", restaurantId: profile.restaurantId, platform: "facebook", handle: profile.handle, reason: error.name === "TimeoutError" ? "timeout" : error.message });
    }
  }
} else {
  failures.push({ attempted:false, state:"no_access", platform: "facebook", reason: "META_FB_ACCESS_TOKEN_missing" });
}

if (instagramToken && instagramUserId) {
  for (const profile of instagramTargets.targets.slice(0, profileLimit)) {
    if (delayMs > 0) await sleep(delayMs);
    profilesAttempted += 1;
    const startedAt = new Date().toISOString(), startPostCount = posts.length;
    try {
      const fields = `business_discovery.username(${profile.handle}){id,name,username,website,media.limit(${postLimit}){id,caption,permalink,timestamp}}`;
      const body = await graphGet(instagramUserId, { fields }, instagramToken);
      const account = body.business_discovery;
      if (!account || !Array.isArray(account.media?.data)) throw new Error("business_discovery_unavailable");
      completedProfiles.add(`instagram|${profile.restaurantId}|${profile.normalizedHandle}`);
      for (const media of account.media?.data || []) {
        if (!recent(media.timestamp) || !media.permalink) continue;
        postsObserved += 1;
        const matches = matchedOnly(classify(String(media.caption || "").slice(0, 20000)));
        const record = {
          restaurantId: profile.restaurantId,
          restaurantName: profile.restaurantName,
          platform: "instagram",
          profileHandle: profile.handle,
          profileUrl: profile.url,
          platformObjectId: account.id,
          postId: media.id,
          postUrl: media.permalink || profile.url,
          publishedAt: new Date(media.timestamp).toISOString(),
          observedAt: new Date().toISOString(),
          signalMatches: matches,
          sourceKind: "meta_graph_api_business_discovery",
          associationBasis: "unique_profile_link_from_official_website",
          profileAssociationBasis: profile.associationBasis || null,
          profileDiscoveredFrom: profile.discoveredFrom || null,
          locationSpecific: profile.locationSpecific === true,
          confidence: "official_social_api_signal",
          reviewState: "api_observed"
        };
        Object.assign(record, factOnlyPost(media.caption, record));
        posts.push(record);
        if (Object.keys(matches).length) signals.push(record);
      }
      recordProfileReceipt(profile, startedAt, startPostCount);
    } catch (error) {
      failures.push({ sourceId:`instagram|${profile.restaurantId}|${profile.normalizedHandle}`, attempted:true, checkedAt:new Date().toISOString(), lastAttemptAt:startedAt, state:"failed", restaurantId: profile.restaurantId, platform: "instagram", handle: profile.handle, reason: error.name === "TimeoutError" ? "timeout" : error.message });
    }
  }
} else {
  if (!instagramToken) failures.push({ attempted:false, state:"no_access", platform: "instagram", reason: "META_IG_ACCESS_TOKEN_or_META_FB_ACCESS_TOKEN_missing" });
  if (!instagramUserId) failures.push({ attempted:false, state:"no_access", platform: "instagram", reason: "META_IG_USER_ID_missing" });
}

// Failed or unattempted profiles do not erase history or invent fresh observations.
// Keep only currently eligible profiles and sanitize legacy caption/media fields.
const eligibleProfiles = new Set([...facebookTargets.targets, ...instagramTargets.targets].map(profile => `${profile.platform}|${profile.restaurantId}|${profile.normalizedHandle}`));
let retainedPosts = 0;
for (const previous of previousPayload.posts || []) {
  const key = `${previous.platform}|${previous.restaurantId}|${String(previous.profileHandle || "").toLowerCase()}`;
  if (!eligibleProfiles.has(key) || completedProfiles.has(key) || !recent(previous.publishedAt) || !previous.postUrl || !previous.observedAt) continue;
  const record = Object.fromEntries(["restaurantId", "restaurantName", "platform", "profileHandle", "profileUrl", "platformObjectId", "postId", "postUrl", "publishedAt", "observedAt", "signalMatches", "sourceKind", "associationBasis", "profileAssociationBasis", "profileDiscoveredFrom", "locationSpecific", "confidence"].map(field => [field, previous[field] ?? null]));
  const tokens = previous.factCandidate
    ? ["dateMentions", "timeMentions", "priceMentions", "relativeDateMentions"].flatMap(field => Array.isArray(previous.factCandidate[field]) ? previous.factCandidate[field].slice(0, 12).filter(value => typeof value === "string").map(value => value.slice(0, 80)) : []).join(" ")
    : previous.summary || previous.title || "";
  Object.assign(record, factOnlyPost(tokens, record));
  if (record.factCandidate && previous.factCandidate) {
    const allowedConditions = new Set(["dine_in_only", "while_supplies_last", "reservation_required", "tax_extra", "age_restriction_19_plus", "limited_time"]);
    record.factCandidate.conditionSignals = (Array.isArray(previous.factCandidate.conditionSignals) ? previous.factCandidate.conditionSignals : []).filter(value => allowedConditions.has(value));
    if (["possible_cancellation", "possible_postponement", "possible_sold_out"].includes(previous.factCandidate.status)) record.factCandidate.status = previous.factCandidate.status;
  }
  record.observationState = "retained_not_refreshed";
  posts.push(record); retainedPosts += 1;
  if (Object.keys(record.signalMatches || {}).length) signals.push(record);
}

const uniqueSignals = signals.filter((signal, index, all) => all.findIndex((item) => item.platform === signal.platform && item.postId === signal.postId && item.restaurantId === signal.restaurantId) === index)
  .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
const uniquePosts = posts.filter((post, index, all) => all.findIndex((item) => item.platform === post.platform && item.postId === post.postId && item.restaurantId === post.restaurantId) === index)
  .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

const output = {
  version: 4,
  contentPolicy: "factual_candidates_no_caption_or_media",
  storyCoverage: "not_supported_no_story_endpoint_or_archive",
  generatedAt: new Date().toISOString(),
  graphVersion,
  lookbackDays,
  summaryChars,
  credentialState: {
    facebook: facebookToken ? "configured" : "missing",
    instagram: instagramToken && instagramUserId ? "configured" : "missing"
  },
  discoveredProfileAssociations: facebookTargets.targets.length + instagramTargets.targets.length + facebookTargets.sharedAssociationsSkipped + instagramTargets.sharedAssociationsSkipped,
  uniqueRestaurantProfiles: facebookTargets.targets.length + instagramTargets.targets.length,
  sharedProfileAssociationsSkipped: facebookTargets.sharedAssociationsSkipped + instagramTargets.sharedAssociationsSkipped,
  sharedProfileHandles: facebookTargets.sharedHandles + instagramTargets.sharedHandles,
  profilesAttempted,
  postsObserved,
  retainedPosts,
  profilesCompleted: completedProfiles.size,
  refreshObservations,
  posts: uniquePosts,
  signals: uniqueSignals,
  failures
};

output.runHealth = sourceRunHealth(output);

await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(new URL("../data/build/social-signals.json", import.meta.url), JSON.stringify(output, null, 2));
await writeFile(new URL("../data/social-signals.js", import.meta.url), `window.HALIFAX_SOCIAL_SIGNALS = ${JSON.stringify(output, null, 2)};\n`);
console.log(`Meta social pull: unique-profiles=${output.uniqueRestaurantProfiles}, shared-skipped=${output.sharedProfileAssociationsSkipped}, attempted=${profilesAttempted}, posts=${postsObserved}, signals=${uniqueSignals.length}, failures=${failures.length}, facebook=${output.credentialState.facebook}, instagram=${output.credentialState.instagram}.`);
