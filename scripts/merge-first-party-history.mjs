import { readFile, writeFile } from "node:fs/promises";

const currentPath = new URL("../data/build/first-party-sources.json", import.meta.url);
const currentJsPath = new URL("../data/first-party-sources.js", import.meta.url);
const previousPath = process.env.FIRST_PARTY_PREVIOUS_PATH || process.argv[2];
if (!previousPath) throw new Error("Set FIRST_PARTY_PREVIOUS_PATH or pass the previous first-party JSON path.");

const current = JSON.parse(await readFile(currentPath, "utf8"));
const previous = JSON.parse(await readFile(previousPath, "utf8"));
const registry = JSON.parse(await readFile(new URL("../data/social-platform-registry.json", import.meta.url), "utf8"));
const platformById = new Map((registry.platforms || []).map((platform) => [platform.id, platform]));
const associationBases = new Set(registry.associationBases || []);
const carryMaxDays = Math.max(1, Number(process.env.FIRST_PARTY_CARRY_FORWARD_MAX_DAYS || 180));
const generatedAt = current.generatedAt || new Date().toISOString();
const generatedStamp = Date.parse(generatedAt);
const previousByRestaurant = new Map((previous.records || []).map((record) => [record.restaurantId, record]));
const currentByRestaurant = new Map((current.records || []).map((record) => [record.restaurantId, record]));

function validUrl(value) {
  try { return ["http:", "https:"].includes(new URL(String(value ?? "")).protocol); }
  catch { return false; }
}
function host(value) {
  try { return new URL(String(value ?? "")).hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, ""); }
  catch { return ""; }
}
function parts(value) {
  try { return new URL(String(value ?? "")).pathname.split("/").map((part) => decodeURIComponent(part)).filter(Boolean); }
  catch { return []; }
}
function normalizeHandle(value) { return String(value ?? "").trim().replace(/^@/, ""); }
function confidence(basis) {
  if (["linked_from_official_website", "linked_from_official_location_page", "jsonld_sameAs"].includes(basis)) return "authoritative";
  if (basis === "linked_from_official_link_hub") return "very_high";
  return "high";
}
function oldVerifiedAt(item, record) {
  return item?.lastVerifiedAt || item?.observedAt || record?.lastVerifiedAt || record?.observedAt || previous.generatedAt || null;
}
function eligibleDate(value) {
  const stamp = Date.parse(String(value || ""));
  if (!Number.isFinite(stamp) || !Number.isFinite(generatedStamp)) return false;
  return generatedStamp - stamp <= carryMaxDays * 24 * 60 * 60 * 1000 && stamp <= generatedStamp + 24 * 60 * 60 * 1000;
}
function platformHostValid(platform, url) {
  const actual = host(url);
  return Boolean(platform && actual && (platform.hosts || []).some((expected) => actual === expected || actual.endsWith(`.${expected}`)));
}
function correctedHandle(platformId, url, fallback) {
  const path = parts(url);
  const first = path[0]?.replace(/^@/, "") || "";
  if (platformId === "facebook") {
    try {
      const parsed = new URL(url);
      if (parsed.pathname === "/profile.php" && parsed.searchParams.get("id")) return parsed.searchParams.get("id");
    } catch {}
    if (["people", "pages"].includes(String(path[0] || "").toLowerCase())) return path[2] || path[1] || null;
    if (String(path[0] || "").toLowerCase() === "pg") return path[1] || null;
  }
  if (platformId === "linkedin" && !["company", "showcase", "school"].includes(String(path[0] || "").toLowerCase())) return null;
  if (platformId === "youtube" && host(url) === "youtu.be") return null;
  if (platformId === "snapchat" && String(path[0] || "").toLowerCase() === "add") return path[1] || null;
  const candidate = normalizeHandle(fallback) || first;
  const metadata = platformById.get(platformId);
  const generic = new Set((metadata?.genericPaths || []).map((item) => String(item).toLowerCase()));
  if (!candidate || generic.has(candidate.toLowerCase()) || generic.has(first.toLowerCase())) return null;
  return candidate;
}
function upgradePlatformItem(item, record) {
  const platformId = String(item?.platform || "").toLowerCase();
  const metadata = platformById.get(platformId);
  const url = item?.profileUrl || item?.url;
  const verifiedAt = oldVerifiedAt(item, record);
  if (!metadata || !validUrl(url) || !platformHostValid(metadata, url) || !eligibleDate(verifiedAt)) return null;
  const handle = correctedHandle(platformId, url, item.handle);
  if (!handle) return null;
  const basis = associationBases.has(item.associationBasis) ? item.associationBasis : "linked_from_official_website";
  return {
    platform: platformId,
    platformKind: metadata.kind,
    handle,
    url,
    profileUrl: url,
    label: item.label || metadata.label || platformId,
    locationSpecific: Boolean(item.locationSpecific),
    sharedBrandProfile: Boolean(item.sharedBrandProfile),
    discoveredFrom: item.discoveredFrom || record?.resolvedUrl || record?.website || url,
    associationBasis: basis,
    observedAt: item.observedAt || record?.observedAt || verifiedAt,
    lastVerifiedAt: verifiedAt,
    reviewState: "verified_link",
    confidence: item.confidence || confidence(basis),
    status: "active",
    refreshState: "carried_forward_previous_verification",
    carriedForwardAt: generatedAt
  };
}
function upgradeRelated(item, record) {
  const verifiedAt = oldVerifiedAt(item, record);
  if (!validUrl(item?.url) || !item?.kind || !eligibleDate(verifiedAt)) return null;
  const basis = associationBases.has(item.associationBasis) ? item.associationBasis : "linked_from_official_website";
  return {
    ...item,
    label: item.label || item.kind,
    discoveredFrom: item.discoveredFrom || record?.resolvedUrl || record?.website || item.url,
    associationBasis: basis,
    observedAt: item.observedAt || record?.observedAt || verifiedAt,
    lastVerifiedAt: verifiedAt,
    reviewState: "verified_link",
    confidence: item.confidence || confidence(basis),
    status: "active",
    refreshState: "carried_forward_previous_verification",
    carriedForwardAt: generatedAt
  };
}
function upgradeFeed(item, record) {
  if (!validUrl(item?.url)) return null;
  return {
    ...item,
    discoveredFrom: item.discoveredFrom || record?.resolvedUrl || record?.website || item.url,
    reviewState: "verified_link",
    refreshState: "carried_forward_previous_verification",
    carriedForwardAt: generatedAt
  };
}
function mergeUnique(currentItems, previousItems, keyFn) {
  const result = [...(currentItems || [])];
  const seen = new Set(result.map(keyFn).filter(Boolean));
  let carried = 0;
  for (const item of previousItems || []) {
    if (!item) continue;
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    carried += 1;
  }
  return { result, carried };
}

let carriedProfiles = 0;
let carriedHubs = 0;
let carriedRelated = 0;
let carriedFeeds = 0;
let carriedRecords = 0;
let rejectedPreviousProfiles = 0;
for (const [restaurantId, oldRecord] of previousByRestaurant) {
  const oldPlatformItems = [];
  for (const old of oldRecord.socialProfiles || []) {
    const upgraded = upgradePlatformItem(old, oldRecord);
    if (upgraded) oldPlatformItems.push(upgraded); else rejectedPreviousProfiles += 1;
  }
  for (const old of oldRecord.linkHubs || []) {
    const upgraded = upgradePlatformItem(old, oldRecord);
    if (upgraded) oldPlatformItems.push(upgraded); else rejectedPreviousProfiles += 1;
  }
  const previousProfiles = oldPlatformItems.filter((item) => item.platformKind === "social");
  const previousHubs = oldPlatformItems.filter((item) => item.platformKind === "link_hub");
  const previousRelated = (oldRecord.relatedLinks || []).map((item) => upgradeRelated(item, oldRecord)).filter(Boolean);
  const previousFeeds = (oldRecord.feeds || []).map((item) => upgradeFeed(item, oldRecord)).filter(Boolean);
  let record = currentByRestaurant.get(restaurantId);
  if (!record) {
    if (!previousProfiles.length && !previousHubs.length && !previousRelated.length && !previousFeeds.length) continue;
    record = {
      restaurantId,
      name: oldRecord.name,
      website: oldRecord.website,
      resolvedUrl: oldRecord.resolvedUrl || oldRecord.website,
      observedAt: oldRecord.observedAt || previous.generatedAt,
      lastVerifiedAt: oldRecord.lastVerifiedAt || oldRecord.observedAt || previous.generatedAt,
      scannedOwnedPages: [],
      socialProfiles: [],
      linkHubs: [],
      relatedLinks: [],
      feeds: [],
      sitemaps: oldRecord.sitemaps || [],
      sourceKind: "official_website_discovery",
      reviewState: "verified",
      refreshState: "carried_forward_after_refresh_failure"
    };
    current.records.push(record);
    currentByRestaurant.set(restaurantId, record);
    carriedRecords += 1;
  }
  const profiles = mergeUnique(record.socialProfiles, previousProfiles, (item) => `${item.platform}|${String(item.handle).toLowerCase()}`);
  const hubs = mergeUnique(record.linkHubs, previousHubs, (item) => `${item.platform}|${String(item.handle).toLowerCase()}`);
  const related = mergeUnique(record.relatedLinks, previousRelated, (item) => `${item.kind}|${item.url}`);
  const feeds = mergeUnique(record.feeds, previousFeeds, (item) => item.url);
  record.socialProfiles = profiles.result;
  record.linkHubs = hubs.result;
  record.relatedLinks = related.result;
  record.feeds = feeds.result;
  carriedProfiles += profiles.carried;
  carriedHubs += hubs.carried;
  carriedRelated += related.carried;
  carriedFeeds += feeds.carried;
}

current.records.sort((a, b) => String(a.restaurantId).localeCompare(String(b.restaurantId)));
current.checkedWebsites = current.records.length;
current.profileCount = current.records.reduce((sum, record) => sum + (record.socialProfiles?.length || 0), 0);
current.platformCounts = {};
for (const record of current.records) for (const profile of record.socialProfiles || []) current.platformCounts[profile.platform] = (current.platformCounts[profile.platform] || 0) + 1;
current.linkHubCount = current.records.reduce((sum, record) => sum + (record.linkHubs?.length || 0), 0);
current.linkHubCounts = {};
for (const record of current.records) for (const hub of record.linkHubs || []) current.linkHubCounts[hub.platform] = (current.linkHubCounts[hub.platform] || 0) + 1;
current.relatedLinkCount = current.records.reduce((sum, record) => sum + (record.relatedLinks?.length || 0), 0);
current.relatedKindCounts = {};
for (const record of current.records) for (const link of record.relatedLinks || []) current.relatedKindCounts[link.kind] = (current.relatedKindCounts[link.kind] || 0) + 1;
current.feedCount = current.records.reduce((sum, record) => sum + (record.feeds?.length || 0), 0);
current.carryForward = {
  previousGeneratedAt: previous.generatedAt || null,
  maxAgeDays: carryMaxDays,
  recordsCarriedAfterRefreshFailure: carriedRecords,
  socialProfilesCarried: carriedProfiles,
  linkHubsCarried: carriedHubs,
  relatedLinksCarried: carriedRelated,
  feedsCarried: carriedFeeds,
  previousProfilesRejectedByCurrentRegistry: rejectedPreviousProfiles,
  appliedAt: generatedAt
};

await writeFile(currentPath, JSON.stringify(current, null, 2));
await writeFile(currentJsPath, `window.HALIFAX_FIRST_PARTY_SOURCES = ${JSON.stringify(current, null, 2)};\n`);
console.log(`First-party carry-forward: records=${carriedRecords}, profiles=${carriedProfiles}, hubs=${carriedHubs}, related=${carriedRelated}, feeds=${carriedFeeds}, rejectedPreviousProfiles=${rejectedPreviousProfiles}.`);
console.log(`Merged first-party totals: records=${current.records.length}, profiles=${current.profileCount}, hubs=${current.linkHubCount}, related=${current.relatedLinkCount}, feeds=${current.feedCount}.`);