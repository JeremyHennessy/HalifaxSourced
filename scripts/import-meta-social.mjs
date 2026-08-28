import { mkdir, readFile, writeFile } from "node:fs/promises";

const sourcePayload = JSON.parse(await readFile(new URL("../data/build/first-party-sources.json", import.meta.url), "utf8").catch(() => "{\"records\":[]}"));
const sourceRecords = Array.isArray(sourcePayload?.records) ? sourcePayload.records : [];
const graphVersion = String(process.env.META_GRAPH_VERSION || "v25.0").replace(/^\/+|\/+$/g, "");
const facebookToken = process.env.META_FB_ACCESS_TOKEN || "";
const instagramToken = process.env.META_IG_ACCESS_TOKEN || facebookToken;
const instagramUserId = process.env.META_IG_USER_ID || "";
const profileLimit = Number(process.env.SOCIAL_PROFILE_LIMIT ?? 100);
const postLimit = Math.min(25, Math.max(1, Number(process.env.SOCIAL_POST_LIMIT ?? 15)));
const lookbackDays = Number(process.env.SOCIAL_LOOKBACK_DAYS ?? 60);
const delayMs = Number(process.env.SOCIAL_PULL_DELAY_MS ?? 250);
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
  return Object.fromEntries(Object.entries(signalGroups).map(([kind, words]) => [kind, words.filter((word) => haystack.includes(word))]));
}
function matchedOnly(matches) {
  return Object.fromEntries(Object.entries(matches).filter(([, hits]) => hits.length > 0));
}
function recent(value) {
  const stamp = Date.parse(String(value ?? ""));
  return Number.isFinite(stamp) && stamp >= cutoff;
}
async function graphGet(path, params, token) {
  const url = new URL(`${graphBase}/${String(path).replace(/^\//, "")}`);
  for (const [key, value] of Object.entries(params || {})) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  url.searchParams.set("access_token", token);
  const response = await fetch(url, { headers: { Accept: "application/json" }, redirect: "follow" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.error) {
    const message = body?.error?.message || `http_${response.status}`;
    const code = body?.error?.code || response.status;
    throw new Error(`${code}:${message}`);
  }
  return body;
}
function profileTargets(platform) {
  const out = [];
  const seen = new Set();
  for (const record of sourceRecords) {
    for (const profile of record.socialProfiles || []) {
      if (profile.platform !== platform || profile.reviewState !== "verified_link" || !profile.handle) continue;
      const key = `${record.restaurantId}|${profile.handle.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ restaurantId: record.restaurantId, restaurantName: record.name, website: record.website, ...profile });
    }
  }
  return out;
}

const signals = [];
const failures = [];
let profilesAttempted = 0;
let postsObserved = 0;

if (facebookToken) {
  for (const profile of profileTargets("facebook").slice(0, profileLimit)) {
    if (delayMs > 0) await sleep(delayMs);
    profilesAttempted += 1;
    try {
      const page = await graphGet(profile.handle, { fields: "id,name,link" }, facebookToken);
      const posts = await graphGet(`${page.id}/posts`, { fields: "id,message,created_time,permalink_url", limit: postLimit }, facebookToken);
      for (const post of posts.data || []) {
        if (!recent(post.created_time)) continue;
        postsObserved += 1;
        const matches = matchedOnly(classify(post.message));
        if (!Object.keys(matches).length) continue;
        signals.push({
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
          associationBasis: "linked_from_official_website",
          confidence: "official_social_api_signal",
          reviewState: "api_observed"
        });
      }
    } catch (error) {
      failures.push({ restaurantId: profile.restaurantId, platform: "facebook", handle: profile.handle, reason: error.message });
    }
  }
} else {
  failures.push({ platform: "facebook", reason: "META_FB_ACCESS_TOKEN_missing" });
}

if (instagramToken && instagramUserId) {
  for (const profile of profileTargets("instagram").slice(0, profileLimit)) {
    if (delayMs > 0) await sleep(delayMs);
    profilesAttempted += 1;
    try {
      const fields = `business_discovery.username(${profile.handle}){id,name,username,website,media.limit(${postLimit}){id,caption,media_type,permalink,timestamp}}`;
      const body = await graphGet(instagramUserId, { fields }, instagramToken);
      const account = body.business_discovery;
      if (!account) throw new Error("business_discovery_unavailable");
      for (const media of account.media?.data || []) {
        if (!recent(media.timestamp)) continue;
        postsObserved += 1;
        const matches = matchedOnly(classify(media.caption));
        if (!Object.keys(matches).length) continue;
        signals.push({
          restaurantId: profile.restaurantId,
          restaurantName: profile.restaurantName,
          platform: "instagram",
          profileHandle: profile.handle,
          profileUrl: profile.url,
          platformObjectId: account.id,
          postId: media.id,
          postUrl: media.permalink || profile.url,
          mediaType: media.media_type || null,
          publishedAt: new Date(media.timestamp).toISOString(),
          observedAt: new Date().toISOString(),
          signalMatches: matches,
          sourceKind: "meta_graph_api_business_discovery",
          associationBasis: "linked_from_official_website",
          confidence: "official_social_api_signal",
          reviewState: "api_observed"
        });
      }
    } catch (error) {
      failures.push({ restaurantId: profile.restaurantId, platform: "instagram", handle: profile.handle, reason: error.message });
    }
  }
} else {
  if (!instagramToken) failures.push({ platform: "instagram", reason: "META_IG_ACCESS_TOKEN_or_META_FB_ACCESS_TOKEN_missing" });
  if (!instagramUserId) failures.push({ platform: "instagram", reason: "META_IG_USER_ID_missing" });
}

const uniqueSignals = signals.filter((signal, index, all) => all.findIndex((item) => item.platform === signal.platform && item.postId === signal.postId && item.restaurantId === signal.restaurantId) === index)
  .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

const output = {
  version: 1,
  generatedAt: new Date().toISOString(),
  graphVersion,
  lookbackDays,
  credentialState: {
    facebook: facebookToken ? "configured" : "missing",
    instagram: instagramToken && instagramUserId ? "configured" : "missing"
  },
  profilesAttempted,
  postsObserved,
  signals: uniqueSignals,
  failures: failures.slice(0, 200)
};

await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(new URL("../data/build/social-signals.json", import.meta.url), JSON.stringify(output, null, 2));
await writeFile(new URL("../data/social-signals.js", import.meta.url), `window.HALIFAX_SOCIAL_SIGNALS = ${JSON.stringify(output, null, 2)};\n`);
console.log(`Meta social pull: profiles=${profilesAttempted}, posts=${postsObserved}, signals=${uniqueSignals.length}, failures=${failures.length}, facebook=${output.credentialState.facebook}, instagram=${output.credentialState.instagram}.`);
