import { readFile, writeFile } from "node:fs/promises";

const jsonPath = new URL("../data/build/first-party-sources.json", import.meta.url);
const jsPath = new URL("../data/first-party-sources.js", import.meta.url);
const payload = JSON.parse(await readFile(jsonPath, "utf8"));
const records = Array.isArray(payload?.records) ? payload.records : [];
const blockedFacebookHandles = new Set([
  "pages", "people", "share", "sharer", "dialog", "plugins", "login", "groups", "events",
  "watch", "reel", "reels", "photo", "photos", "posts", "permalink.php", "home.php"
]);
const blockedInstagramHandles = new Set(["p", "reel", "reels", "stories", "explore", "accounts", "tv", "direct"]);

function token(value) { return String(value ?? "").trim().toLowerCase(); }
function validProfile(profile) {
  const handle = token(profile?.handle).replace(/^@/, "");
  if (!handle || handle.length < 2) return false;
  if (profile.platform === "facebook") return !blockedFacebookHandles.has(handle);
  if (profile.platform === "instagram") return !blockedInstagramHandles.has(handle);
  return false;
}

let removedProfiles = 0;
let duplicateProfilesRemoved = 0;
for (const record of records) {
  const seen = new Set();
  const cleaned = [];
  for (const profile of record.socialProfiles || []) {
    if (!validProfile(profile)) {
      removedProfiles += 1;
      continue;
    }
    const key = `${profile.platform}|${token(profile.handle)}`;
    if (seen.has(key)) {
      duplicateProfilesRemoved += 1;
      continue;
    }
    seen.add(key);
    cleaned.push(profile);
  }
  record.socialProfiles = cleaned;
}

payload.profileCount = records.reduce((sum, record) => sum + (record.socialProfiles?.length || 0), 0);
payload.facebookCount = records.reduce((sum, record) => sum + (record.socialProfiles || []).filter((profile) => profile.platform === "facebook").length, 0);
payload.instagramCount = records.reduce((sum, record) => sum + (record.socialProfiles || []).filter((profile) => profile.platform === "instagram").length, 0);
payload.sanitization = {
  appliedAt: new Date().toISOString(),
  removedGenericOrInvalidProfiles: removedProfiles,
  duplicateProfilesRemoved
};

await writeFile(jsonPath, JSON.stringify(payload, null, 2));
await writeFile(jsPath, `window.HALIFAX_FIRST_PARTY_SOURCES = ${JSON.stringify(payload, null, 2)};\n`);
console.log(`Sanitized first-party profiles: kept=${payload.profileCount}, removed=${removedProfiles}, duplicate-removed=${duplicateProfilesRemoved}.`);
