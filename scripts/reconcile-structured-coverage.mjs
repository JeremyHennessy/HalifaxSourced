import { readFile, writeFile } from "node:fs/promises";
import vm from "node:vm";

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.now();
async function json(path, fallback = {}) {
  try { return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8")); }
  catch { return fallback; }
}
async function windowData(path) {
  try {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    const context = { window: {} };
    vm.createContext(context);
    vm.runInContext(source, context, { filename: path, timeout: 20_000 });
    return context.window;
  } catch { return {}; }
}
function normalize(value) {
  return String(value ?? "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(the|restaurant|bar|cafe|café|pub)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function hasHits(value, kind) { return Array.isArray(value?.signalMatches?.[kind]) && value.signalMatches[kind].length > 0; }
function pct(count, total) { return total ? Number(((count / total) * 100).toFixed(1)) : 0; }
function isFresh(value, days) {
  const stamp = Date.parse(String(value ?? ""));
  return Number.isFinite(stamp) && stamp <= now + DAY_MS && now - stamp <= days * DAY_MS;
}

const reportPath = new URL("../data/build/content-coverage-report.json", import.meta.url);
const report = JSON.parse(await readFile(reportPath, "utf8"));
const catalog = await json("data/build/catalog.json", { restaurants: [] });
const official = await json("data/build/official-site-signals.json", { results: [] });
const verified = await json("data/build/verified-source-pages.json", { menuSources: [], specialSources: [] });
const firstParty = await json("data/build/first-party-sources.json", { records: [] });
const websiteFeeds = await json("data/build/website-feed-signals.json", { signals: [] });
const socialSignals = await json("data/build/social-signals.json", { signals: [] });
const facts = await json("data/build/structured-place-facts.json", { records: [], counts: {}, failures: [] });
const patioDirectory = await json("data/build/patio-directory-facts.json", { records: [], counts: {}, failures: [] });
const specials = await json("data/build/structured-specials.json", { records: [] });
const discoveredWindow = await windowData("data/discovered-restaurants.js");
const discovered = Array.isArray(discoveredWindow.HALIFAX_DISCOVERED_RESTAURANTS) ? discoveredWindow.HALIFAX_DISCOVERED_RESTAURANTS : [];
const reviewedWindow = await windowData("data/reviewed-place-resolutions.js");
const reviewedResolutions = Array.isArray(reviewedWindow.HALIFAX_REVIEWED_PLACE_RESOLUTIONS?.records) ? reviewedWindow.HALIFAX_REVIEWED_PLACE_RESOLUTIONS.records : [];
const total = Number(report.restaurantCoverage?.totalCanonicalPlaces || 0);
const catalogById = new Map((catalog.restaurants || []).map((item) => [item.id, item]));
const discoveredByName = new Map(discovered.map((item) => [normalize(item.name), item]));

function mergedBase(item) {
  const discovery = discoveredByName.get(normalize(item.name));
  return discovery ? { ...item, phone: item.phone || discovery.phone, openingHours: item.openingHours || discovery.openingHours } : item;
}
const basePhoneIds = new Set();
const baseHoursIds = new Set();
const basePatioIds = new Set();
const baseAccessibilityIds = new Set();
for (const item of catalog.restaurants || []) {
  const merged = mergedBase(item);
  if (String(merged.phone || "").trim()) basePhoneIds.add(item.id);
  if (String(merged.openingHours || "").trim()) baseHoursIds.add(item.id);
  const tags = item.osm?.rawTags || {};
  const tagText = JSON.stringify(tags).toLowerCase();
  if (tags.outdoor_seating === "yes" || /patio|terrace|rooftop|beer garden|outdoor seating/.test(tagText)) basePatioIds.add(item.id);
  if (item.accessibility || Object.keys(tags).some((key) => /wheelchair|accessible|step_free|toilets:wheelchair/.test(key)) || /wheelchair|accessible/.test(tagText)) baseAccessibilityIds.add(item.id);
}

const baseMenuIds = new Set((verified.menuSources || []).map((item) => item.restaurantId));
const baseSpecialIds = new Set((verified.specialSources || []).map((item) => item.restaurantId));
const verifiedSpecialIds = new Set(baseSpecialIds);
const baseReservationIds = new Set();
const baseOrderingIds = new Set();
for (const record of firstParty.records || []) {
  for (const link of record.relatedLinks || []) {
    if (link.kind === "menu") baseMenuIds.add(record.restaurantId);
    if (link.kind === "reservations") baseReservationIds.add(record.restaurantId);
    if (link.kind === "ordering") baseOrderingIds.add(record.restaurantId);
    if (/special|happy hour|feature|deal|promo/i.test(`${link.label || ""} ${link.url || ""}`)) baseSpecialIds.add(record.restaurantId);
  }
}
for (const result of official.results || []) {
  for (const link of result.candidateLinks || []) {
    if (hasHits(link, "menu")) baseMenuIds.add(result.restaurantId);
    if (hasHits(link, "specials")) baseSpecialIds.add(result.restaurantId);
    if (hasHits(link, "reservations")) baseReservationIds.add(result.restaurantId);
    if (hasHits(link, "takeout")) baseOrderingIds.add(result.restaurantId);
    if (hasHits(link, "patio")) basePatioIds.add(result.restaurantId);
  }
  if (hasHits(result, "patio")) basePatioIds.add(result.restaurantId);
}
for (const item of catalog.restaurants || []) if ((item.specials || []).length) baseSpecialIds.add(item.id);
for (const signal of [...(websiteFeeds.signals || []), ...(socialSignals.signals || [])]) {
  if (isFresh(signal.publishedAt, 60) && hasHits(signal, "specials")) baseSpecialIds.add(signal.restaurantId);
}

const phoneIds = new Set(basePhoneIds);
const hoursIds = new Set(baseHoursIds);
const menuIds = new Set(baseMenuIds);
const reservationIds = new Set(baseReservationIds);
const orderingIds = new Set(baseOrderingIds);
const specialIds = new Set(baseSpecialIds);
const patioIds = new Set(basePatioIds);
const accessibilityIds = new Set(baseAccessibilityIds);
for (const fact of facts.records || []) {
  if (!catalogById.has(fact.restaurantId)) continue;
  if (String(fact.phone || "").trim()) phoneIds.add(fact.restaurantId);
  if (fact.hours && typeof fact.hours === "object") hoursIds.add(fact.restaurantId);
  if ((fact.menus || []).length) menuIds.add(fact.restaurantId);
  if ((fact.reservations || []).length) reservationIds.add(fact.restaurantId);
  if ((fact.ordering || []).length) orderingIds.add(fact.restaurantId);
  const features = new Set((fact.features || []).map((item) => item.feature));
  if (["patio", "rooftop", "outdoor_seating"].some((feature) => features.has(feature))) patioIds.add(fact.restaurantId);
  if (["wheelchair_entrance", "accessible_seating", "accessible_washroom", "step_free", "elevator"].some((feature) => features.has(feature))) accessibilityIds.add(fact.restaurantId);
}
for (const special of specials.records || []) {
  if (!catalogById.has(special.restaurantId)) continue;
  specialIds.add(special.restaurantId);
  if (special.status === "verified_current") verifiedSpecialIds.add(special.restaurantId);
}

const SOCIAL = new Set(["instagram", "facebook", "tiktok", "threads", "x", "youtube", "linkedin", "bluesky", "pinterest", "snapchat"]);
const HUBS = new Set(["linktree", "beacons", "linkinbio", "campsite", "bento"]);
const socialIds = new Set();
const hubIds = new Set();
const platformSets = Object.fromEntries([...SOCIAL, ...HUBS].map((platform) => [platform, new Set()]));
for (const record of firstParty.records || []) {
  for (const profile of record.socialProfiles || []) {
    const platform = String(profile.platform || "").toLowerCase();
    if (SOCIAL.has(platform)) socialIds.add(record.restaurantId);
    if (HUBS.has(platform)) hubIds.add(record.restaurantId);
    if (platformSets[platform]) platformSets[platform].add(record.restaurantId);
  }
  for (const hub of record.linkHubs || []) {
    const platform = String(hub.platform || "").toLowerCase();
    if (!HUBS.has(platform)) continue;
    hubIds.add(record.restaurantId);
    platformSets[platform].add(record.restaurantId);
  }
}
for (const resolution of reviewedResolutions) {
  for (const profile of resolution.socialProfiles || []) {
    const platform = String(profile.platform || "").toLowerCase();
    if (SOCIAL.has(platform)) socialIds.add(resolution.restaurantId);
    if (HUBS.has(platform)) hubIds.add(resolution.restaurantId);
    if (platformSets[platform]) platformSets[platform].add(resolution.restaurantId);
  }
}

const rc = report.restaurantCoverage ||= {};
const rp = report.restaurantCoveragePercent ||= {};
rc.withPhone = Number(report.restaurantCoverage?.withPhone || 0) + [...phoneIds].filter((id) => !basePhoneIds.has(id)).length;
rc.withStructuredOrSourceHours = Number(report.restaurantCoverage?.withStructuredOrSourceHours || 0) + [...hoursIds].filter((id) => !baseHoursIds.has(id)).length;
rc.withMenuLink = Number(report.restaurantCoverage?.withMenuLink || 0) + [...menuIds].filter((id) => !baseMenuIds.has(id)).length;
rc.withSpecials = Number(report.restaurantCoverage?.withSpecials || 0) + [...specialIds].filter((id) => !baseSpecialIds.has(id)).length;
rc.withVerifiedSpecials = Number(report.restaurantCoverage?.withVerifiedSpecials || 0) + [...verifiedSpecialIds].filter((id) => !(verified.specialSources || []).some((item) => item.restaurantId === id)).length;
rc.withReservationLink = Number(report.restaurantCoverage?.withReservationLink || 0) + [...reservationIds].filter((id) => !baseReservationIds.has(id)).length;
rc.withOnlineOrderingLink = Number(report.restaurantCoverage?.withOnlineOrderingLink || 0) + [...orderingIds].filter((id) => !baseOrderingIds.has(id)).length;
rc.withPatioInformation = Number(report.restaurantCoverage?.withPatioInformation || 0) + [...patioIds].filter((id) => !basePatioIds.has(id)).length;
rc.withAccessibilityInformation = Number(report.restaurantCoverage?.withAccessibilityInformation || 0) + [...accessibilityIds].filter((id) => !baseAccessibilityIds.has(id)).length;
rc.withAtLeastOneSocialProfile = socialIds.size || rc.withAtLeastOneSocialProfile;
rc.withLinkHub = hubIds.size;
rc.withAnySocialOrLinkHub = new Set([...socialIds, ...hubIds]).size;
rc.socialByPlatform = Object.fromEntries(Object.entries(platformSets).map(([platform, ids]) => [platform, ids.size]));
rc.structuredFactLayer = { generatedAt: facts.generatedAt || null, checkedPlaces: facts.checkedPlaces || 0, sourceFailures: (facts.failures || []).length, ...(facts.counts || {}) };
rc.patioDirectoryLayer = { generatedAt: patioDirectory.generatedAt || null, sourceFailures: (patioDirectory.failures || []).length, ...(patioDirectory.counts || {}) };
rc.structuredSpecialLayer = { generatedAt: specials.generatedAt || null, count: specials.count || 0, verifiedCurrent: specials.verifiedCurrent || 0, recurringVerify: specials.recurringVerify || 0, sourceLeads: specials.sourceLeads || 0, stale: specials.stale || 0, expired: specials.expired || 0, orphanSourceCount: specials.orphanSourceCount || 0 };

for (const [key, count] of Object.entries({
  phone: rc.withPhone,
  hours: rc.withStructuredOrSourceHours,
  menu: rc.withMenuLink,
  specials: rc.withSpecials,
  verifiedSpecials: rc.withVerifiedSpecials,
  reservations: rc.withReservationLink,
  ordering: rc.withOnlineOrderingLink,
  patio: rc.withPatioInformation,
  accessibility: rc.withAccessibilityInformation,
  social: rc.withAtLeastOneSocialProfile,
  linkHub: rc.withLinkHub
})) rp[key] = pct(Number(count || 0), total);

const sa = report.socialAudit ||= {};
sa.placesWithSocial = socialIds.size || sa.placesWithSocial || 0;
sa.placesWithLinkHub = hubIds.size;
sa.platformPlaceCounts = rc.socialByPlatform;
sa.reconciledFromAcceptedStructuredLayers = true;
sa.reconciledAt = new Date().toISOString();
report.definitions ||= {};
report.definitions.structuredFactReconciliation = "Phone, hours, menu, reservation, ordering, patio and accessibility coverage includes accepted restaurant-owned structured facts in addition to the original baseline layers.";
report.definitions.structuredSpecialReconciliation = "Special coverage includes normalized source-backed structured specials. Only records with current verification inside the configured freshness window increase verified-current special coverage.";
report.sourceFailures ||= {};
report.sourceFailures.structuredPlaceFacts = (facts.failures || []).length;
report.sourceFailures.patioDirectorySources = (patioDirectory.failures || []).length;
report.generatedAt = new Date().toISOString();
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ phone: rc.withPhone, hours: rc.withStructuredOrSourceHours, menu: rc.withMenuLink, specials: rc.withSpecials, verifiedSpecials: rc.withVerifiedSpecials, reservations: rc.withReservationLink, ordering: rc.withOnlineOrderingLink, patio: rc.withPatioInformation, accessibility: rc.withAccessibilityInformation, social: rc.withAtLeastOneSocialProfile, linkHub: rc.withLinkHub, structuredFacts: rc.structuredFactLayer, structuredSpecials: rc.structuredSpecialLayer }, null, 2));
