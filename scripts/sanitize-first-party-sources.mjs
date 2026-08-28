import { readFile, writeFile } from "node:fs/promises";

const jsonPath = new URL("../data/build/first-party-sources.json", import.meta.url);
const jsPath = new URL("../data/first-party-sources.js", import.meta.url);
const payload = JSON.parse(await readFile(jsonPath, "utf8"));
const records = Array.isArray(payload?.records) ? payload.records : [];

const blocked = {
  facebook: new Set(["pages", "people", "share", "sharer", "dialog", "plugins", "login", "groups", "events", "watch", "reel", "reels", "photo", "photos", "posts", "permalink.php", "home.php"]),
  instagram: new Set(["p", "reel", "reels", "stories", "explore", "accounts", "tv", "direct"]),
  x: new Set(["home", "share", "intent", "search", "explore", "i"]),
  tiktok: new Set(["discover", "foryou", "tag", "music", "login"]),
  youtube: new Set(["watch", "shorts", "playlist", "results", "feed"]),
  threads: new Set(["search", "activity", "settings"]),
  linkedin: new Set(["feed", "login", "pulse", "jobs", "learning"]),
  bluesky: new Set(["search", "notifications", "messages"]),
  linktree: new Set([])
};

function token(value) { return String(value ?? "").trim().toLowerCase().replace(/^@/, ""); }
function validProfile(profile) {
  const platform = String(profile?.platform || "").toLowerCase();
  const handle = token(profile?.handle);
  if (!blocked[platform] || !handle || handle.length < 2) return false;
  const first = handle.split("/")[0];
  return !blocked[platform].has(first);
}

function validRelated(link) {
  try {
    const url = new URL(String(link?.url || ""));
    return ["http:", "https:"].includes(url.protocol) && Boolean(link?.kind) && link?.reviewState === "verified_link";
  } catch {
    return false;
  }
}

let removedProfiles = 0;
let duplicateProfilesRemoved = 0;
let removedRelated = 0;
let duplicateRelatedRemoved = 0;
for (const record of records) {
  const seenProfiles = new Set();
  const cleanedProfiles = [];
  for (const profile of record.socialProfiles || []) {
    if (!validProfile(profile)) {
      removedProfiles += 1;
      continue;
    }
    const key = `${profile.platform}|${token(profile.handle)}`;
    if (seenProfiles.has(key)) {
      duplicateProfilesRemoved += 1;
      continue;
    }
    seenProfiles.add(key);
    cleanedProfiles.push(profile);
  }
  record.socialProfiles = cleanedProfiles;

  const seenRelated = new Set();
  const cleanedRelated = [];
  for (const link of record.relatedLinks || []) {
    if (!validRelated(link)) {
      removedRelated += 1;
      continue;
    }
    const key = `${link.kind}|${link.url}`;
    if (seenRelated.has(key)) {
      duplicateRelatedRemoved += 1;
      continue;
    }
    seenRelated.add(key);
    cleanedRelated.push(link);
  }
  record.relatedLinks = cleanedRelated;
}

payload.profileCount = records.reduce((sum, record) => sum + (record.socialProfiles?.length || 0), 0);
payload.platformCounts = {};
for (const record of records) for (const profile of record.socialProfiles || []) payload.platformCounts[profile.platform] = (payload.platformCounts[profile.platform] || 0) + 1;
payload.relatedLinkCount = records.reduce((sum, record) => sum + (record.relatedLinks?.length || 0), 0);
payload.relatedKindCounts = {};
for (const record of records) for (const link of record.relatedLinks || []) payload.relatedKindCounts[link.kind] = (payload.relatedKindCounts[link.kind] || 0) + 1;
payload.facebookCount = payload.platformCounts.facebook || 0;
payload.instagramCount = payload.platformCounts.instagram || 0;
payload.sanitization = {
  appliedAt: new Date().toISOString(),
  removedGenericOrInvalidProfiles: removedProfiles,
  duplicateProfilesRemoved,
  removedInvalidRelatedLinks: removedRelated,
  duplicateRelatedLinksRemoved: duplicateRelatedRemoved
};

await writeFile(jsonPath, JSON.stringify(payload, null, 2));
await writeFile(jsPath, `window.HALIFAX_FIRST_PARTY_SOURCES = ${JSON.stringify(payload, null, 2)};\n`);
console.log(`Sanitized first-party sources: profiles=${payload.profileCount}, related=${payload.relatedLinkCount}, profile-removed=${removedProfiles}, related-removed=${removedRelated}.`);
