import { readFile, writeFile } from "node:fs/promises";

const jsonPath = new URL("../data/build/first-party-sources.json", import.meta.url);
const jsPath = new URL("../data/first-party-sources.js", import.meta.url);
const registry = JSON.parse(await readFile(new URL("../data/social-platform-registry.json", import.meta.url), "utf8"));
const payload = JSON.parse(await readFile(jsonPath, "utf8"));
const records = Array.isArray(payload?.records) ? payload.records : [];
const platformById = new Map((registry.platforms || []).map((platform) => [platform.id, platform]));
const associationBases = new Set(registry.associationBases || []);
const confidenceValues = new Set(registry.confidenceValues || []);

function token(value) { return String(value ?? "").trim().toLowerCase().replace(/^@/, ""); }
function decodeUrlEntities(value) {
  let decoded = String(value ?? "");
  for (let index = 0; index < 4; index += 1) {
    const next = decoded.replace(/&(?:amp|#0*38|#x0*26);/gi, "&");
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}
function host(value) {
  try { return new URL(String(value ?? "")).hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, ""); }
  catch { return ""; }
}
function hostAllowed(value, platform) {
  const actual = host(value);
  return Boolean(actual && (platform.hosts || []).some((expected) => actual === expected || actual.endsWith(`.${expected}`)));
}
function identityToken(value) {
  return String(value ?? "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(the|restaurant|resto|cafe|café|bar|pub|inc|incorporated|limited|ltd|company|co|cuisine|japanese|brewing)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}
function normalizeFacebookProfile(item, record) {
  if (String(item?.platform || "").toLowerCase() !== "facebook") return item;
  const rawUrl = item.profileUrl || item.url;
  let parsed;
  try { parsed = new URL(String(rawUrl || "")); } catch { return item; }
  const parts = parsed.pathname.split("/").map((part) => decodeURIComponent(part)).filter(Boolean);
  const first = String(parts[0] || "").toLowerCase();
  let handle = String(item.handle || "").replace(/^@/, "");
  let legacyLabel = null;
  if (["pages", "people", "pg"].includes(first) && parts[1]) {
    legacyLabel = parts[1];
    handle = parts[1];
    if (first === "pg") {
      const canonical = `https://www.facebook.com/${encodeURIComponent(parts[1])}`;
      item = { ...item, url: canonical, profileUrl: canonical };
    }
  } else if (parsed.pathname === "/profile.php" && parsed.searchParams.get("id")) {
    handle = parsed.searchParams.get("id");
  }
  item = { ...item, handle };
  if (legacyLabel) {
    const restaurantIdentity = identityToken(record?.name);
    const profileIdentity = identityToken(legacyLabel);
    const compatible = Boolean(restaurantIdentity && profileIdentity && (restaurantIdentity.includes(profileIdentity) || profileIdentity.includes(restaurantIdentity)));
    if (!compatible) {
      item.sharedBrandProfile = true;
      item.locationSpecific = false;
      item.associationBasis = "shared_brand_profile";
      item.confidence = "high";
    }
  }
  return item;
}
function validPlatformLink(item, kind) {
  const platform = platformById.get(String(item?.platform || "").toLowerCase());
  const handle = token(item?.handle);
  if (!platform || platform.kind !== kind || !handle || handle.length < 2 || !hostAllowed(item.url || item.profileUrl, platform)) return false;
  const generic = new Set((platform.genericPaths || []).map((value) => token(value)));
  if (generic.has(handle.split("/")[0])) return false;
  if (!associationBases.has(item.associationBasis) || !confidenceValues.has(item.confidence) || item.reviewState !== "verified_link") return false;
  return true;
}

function validRelated(link) {
  try {
    const url = new URL(String(link?.url || ""));
    return ["http:", "https:"].includes(url.protocol) && Boolean(link?.kind) && link?.reviewState === "verified_link" && associationBases.has(link.associationBasis) && confidenceValues.has(link.confidence);
  } catch { return false; }
}

let removedProfiles = 0;
let duplicateProfilesRemoved = 0;
let normalizedFacebookProfiles = 0;
let sharedBrandProfilesFlagged = 0;
let removedHubs = 0;
let duplicateHubsRemoved = 0;
let removedRelated = 0;
let duplicateRelatedRemoved = 0;
for (const record of records) {
  const seenProfiles = new Set();
  const cleanedProfiles = [];
  for (let profile of record.socialProfiles || []) {
    const decodedUrl = decodeUrlEntities(profile?.url || profile?.profileUrl);
    profile = { ...profile, url: decodedUrl, profileUrl: decodedUrl };
    const beforeHandle = String(profile?.handle || "");
    const beforeShared = Boolean(profile?.sharedBrandProfile);
    profile = normalizeFacebookProfile(profile, record);
    if (String(profile?.handle || "") !== beforeHandle) normalizedFacebookProfiles += 1;
    if (!beforeShared && profile?.sharedBrandProfile) sharedBrandProfilesFlagged += 1;
    if (!validPlatformLink(profile, "social")) { removedProfiles += 1; continue; }
    const key = `${profile.platform}|${token(profile.handle)}`;
    if (seenProfiles.has(key)) { duplicateProfilesRemoved += 1; continue; }
    seenProfiles.add(key);
    cleanedProfiles.push(profile);
  }
  record.socialProfiles = cleanedProfiles;

  const seenHubs = new Set();
  const cleanedHubs = [];
  for (let hub of record.linkHubs || []) {
    const decodedUrl = decodeUrlEntities(hub?.url || hub?.profileUrl);
    hub = { ...hub, url: decodedUrl, profileUrl: decodedUrl };
    if (!validPlatformLink(hub, "link_hub")) { removedHubs += 1; continue; }
    const key = `${hub.platform}|${token(hub.handle)}`;
    if (seenHubs.has(key)) { duplicateHubsRemoved += 1; continue; }
    seenHubs.add(key);
    cleanedHubs.push(hub);
  }
  record.linkHubs = cleanedHubs;

  const seenRelated = new Set();
  const cleanedRelated = [];
  for (let link of record.relatedLinks || []) {
    link = { ...link, url: decodeUrlEntities(link?.url) };
    if (!validRelated(link)) { removedRelated += 1; continue; }
    const key = `${link.kind}|${link.url}`;
    if (seenRelated.has(key)) { duplicateRelatedRemoved += 1; continue; }
    seenRelated.add(key);
    cleanedRelated.push(link);
  }
  record.relatedLinks = cleanedRelated;
}

payload.profileCount = records.reduce((sum, record) => sum + (record.socialProfiles?.length || 0), 0);
payload.platformCounts = {};
for (const record of records) for (const profile of record.socialProfiles || []) payload.platformCounts[profile.platform] = (payload.platformCounts[profile.platform] || 0) + 1;
payload.linkHubCount = records.reduce((sum, record) => sum + (record.linkHubs?.length || 0), 0);
payload.linkHubCounts = {};
for (const record of records) for (const hub of record.linkHubs || []) payload.linkHubCounts[hub.platform] = (payload.linkHubCounts[hub.platform] || 0) + 1;
payload.relatedLinkCount = records.reduce((sum, record) => sum + (record.relatedLinks?.length || 0), 0);
payload.relatedKindCounts = {};
for (const record of records) for (const link of record.relatedLinks || []) payload.relatedKindCounts[link.kind] = (payload.relatedKindCounts[link.kind] || 0) + 1;
payload.facebookCount = payload.platformCounts.facebook || 0;
payload.instagramCount = payload.platformCounts.instagram || 0;
payload.sanitization = {
  appliedAt: new Date().toISOString(),
  registryVersion: registry.version,
  removedGenericOrInvalidProfiles: removedProfiles,
  duplicateProfilesRemoved,
  normalizedFacebookLegacyProfiles: normalizedFacebookProfiles,
  sharedBrandProfilesFlagged,
  removedGenericOrInvalidLinkHubs: removedHubs,
  duplicateLinkHubsRemoved: duplicateHubsRemoved,
  removedInvalidRelatedLinks: removedRelated,
  duplicateRelatedLinksRemoved: duplicateRelatedRemoved
};

await writeFile(jsonPath, JSON.stringify(payload, null, 2));
await writeFile(jsPath, `window.HALIFAX_FIRST_PARTY_SOURCES = ${JSON.stringify(payload, null, 2)};\n`);
console.log(`Sanitized first-party sources: profiles=${payload.profileCount}, hubs=${payload.linkHubCount}, related=${payload.relatedLinkCount}, profile-removed=${removedProfiles}, facebook-normalized=${normalizedFacebookProfiles}, shared-brand-flagged=${sharedBrandProfilesFlagged}, hub-removed=${removedHubs}, related-removed=${removedRelated}.`);
