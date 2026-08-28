import { readFile, writeFile } from "node:fs/promises";

const reportPath = new URL("../data/build/content-coverage-report.json", import.meta.url);
const firstPartyPath = new URL("../data/build/first-party-sources.json", import.meta.url);
const report = JSON.parse(await readFile(reportPath, "utf8"));
const firstParty = JSON.parse(await readFile(firstPartyPath, "utf8"));
const records = Array.isArray(firstParty.records) ? firstParty.records : [];
const total = Number(report.restaurantCoverage?.totalCanonicalPlaces || 0);
const socialPlatforms = ["instagram", "facebook", "tiktok", "threads", "x", "youtube", "linkedin", "bluesky", "pinterest", "snapchat"];
const hubPlatforms = ["linktree", "beacons", "linkinbio", "campsite", "bento"];
const socialIds = new Set();
const anyIds = new Set();
const hubIds = new Set();
const perPlatform = Object.fromEntries([...socialPlatforms, ...hubPlatforms].map((platform) => [platform, new Set()]));
const profileKeyCounts = new Map();
const profilesByRestaurant = new Map();
let profileAssociations = 0;
let hubAssociations = 0;

for (const record of records) {
  const id = record.restaurantId;
  if (!id) continue;
  const profiles = Array.isArray(record.socialProfiles) ? record.socialProfiles : [];
  const hubs = Array.isArray(record.linkHubs) ? record.linkHubs : [];
  profilesByRestaurant.set(id, profiles);
  for (const profile of profiles) {
    const platform = String(profile.platform || "").toLowerCase();
    const handle = String(profile.handle || "").toLowerCase().replace(/^@/, "");
    if (!socialPlatforms.includes(platform) || !handle) continue;
    socialIds.add(id);
    anyIds.add(id);
    perPlatform[platform].add(id);
    profileAssociations += 1;
    const key = `${platform}|${handle}`;
    profileKeyCounts.set(key, (profileKeyCounts.get(key) || 0) + 1);
  }
  for (const hub of hubs) {
    const platform = String(hub.platform || "").toLowerCase();
    const handle = String(hub.handle || "").toLowerCase().replace(/^@/, "");
    if (!hubPlatforms.includes(platform) || !handle) continue;
    hubIds.add(id);
    anyIds.add(id);
    perPlatform[platform].add(id);
    hubAssociations += 1;
  }
}

const sharedKeys = new Set([...profileKeyCounts].filter(([, count]) => count > 1).map(([key]) => key));
let sharedOnly = 0;
for (const id of socialIds) {
  const profiles = profilesByRestaurant.get(id) || [];
  const validKeys = profiles
    .filter((profile) => socialPlatforms.includes(String(profile.platform || "").toLowerCase()) && profile.handle)
    .map((profile) => `${String(profile.platform).toLowerCase()}|${String(profile.handle).toLowerCase().replace(/^@/, "")}`);
  if (validKeys.length && validKeys.every((key) => sharedKeys.has(key))) sharedOnly += 1;
}

const counts = Object.fromEntries(Object.entries(perPlatform).map(([platform, ids]) => [platform, ids.size]));
const pct = (count) => total ? Number(((count / total) * 100).toFixed(1)) : 0;
report.restaurantCoverage ||= {};
report.restaurantCoveragePercent ||= {};
report.socialAudit ||= {};
report.restaurantCoverage.withAtLeastOneSocialProfile = socialIds.size;
report.restaurantCoverage.withAnySocialOrLinkHub = anyIds.size;
report.restaurantCoverage.withLinkHub = hubIds.size;
report.restaurantCoverage.socialByPlatform = counts;
report.restaurantCoveragePercent.social = pct(socialIds.size);
report.restaurantCoveragePercent.linkHub = pct(hubIds.size);
report.socialAudit.placesWithSocial = socialIds.size;
report.socialAudit.placesWithLinkHub = hubIds.size;
report.socialAudit.platformPlaceCounts = counts;
report.socialAudit.profileAssociations = profileAssociations;
report.socialAudit.linkHubAssociations = hubAssociations;
report.socialAudit.sharedProfileKeys = sharedKeys.size;
report.socialAudit.sharedBrandOnlyPlaces = sharedOnly;
report.socialAudit.reconciledFromDedicatedLinkHubField = true;
report.socialAudit.reconciledAt = new Date().toISOString();
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ placesWithSocial: socialIds.size, placesWithLinkHub: hubIds.size, profileAssociations, hubAssociations, platformPlaceCounts: counts }, null, 2));
