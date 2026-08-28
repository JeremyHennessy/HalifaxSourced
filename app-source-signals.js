"use strict";

const firstPartySourcePayload = window.HALIFAX_FIRST_PARTY_SOURCES ?? null;
const firstPartySourceRecords = Array.isArray(firstPartySourcePayload?.records) ? firstPartySourcePayload.records : [];
const websiteFeedSignalPayload = window.HALIFAX_WEBSITE_FEED_SIGNALS ?? null;
const websiteFeedSignals = Array.isArray(websiteFeedSignalPayload?.signals) ? websiteFeedSignalPayload.signals : [];
const socialSignalPayload = window.HALIFAX_SOCIAL_SIGNALS ?? null;
const socialSignals = Array.isArray(socialSignalPayload?.signals) ? socialSignalPayload.signals : [];
const CURRENT_SOURCE_SIGNAL_DAYS = 60;

function sourceSignalGroup(items) {
  const grouped = new Map();
  for (const item of items) {
    if (!item?.restaurantId) continue;
    if (!grouped.has(item.restaurantId)) grouped.set(item.restaurantId, []);
    grouped.get(item.restaurantId).push(item);
  }
  return grouped;
}

function sourceSignalHas(item, kind) {
  return Array.isArray(item?.signalMatches?.[kind]) && item.signalMatches[kind].length > 0;
}

function sourceSignalFresh(item, maxDays = CURRENT_SOURCE_SIGNAL_DAYS) {
  const stamp = Date.parse(String(item?.publishedAt ?? ""));
  if (!Number.isFinite(stamp)) return false;
  const age = Date.now() - stamp;
  return age >= -24 * 60 * 60 * 1000 && age <= maxDays * 24 * 60 * 60 * 1000;
}

function uniqueSourceSignalLinks(existing, additions) {
  const links = [...(existing || [])];
  const seen = new Set(links.map((link) => safeUrl(link?.url)).filter(Boolean));
  for (const link of additions || []) {
    const url = safeUrl(link?.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    links.push({ ...link, url });
  }
  return links;
}

function profileKey(profile) {
  return `${String(profile?.platform || "").toLowerCase()}|${String(profile?.handle || "").toLowerCase().replace(/^@/, "")}`;
}

const firstPartyByRestaurant = sourceSignalGroup(firstPartySourceRecords);
const websiteFeedByRestaurant = sourceSignalGroup(websiteFeedSignals);
const socialByRestaurant = sourceSignalGroup(socialSignals);
const profileAssociationCounts = new Map();
for (const record of firstPartySourceRecords) {
  const seenInRecord = new Set();
  for (const profile of record.socialProfiles || []) {
    const key = profileKey(profile);
    if (!key || key === "|") continue;
    if (seenInRecord.has(key)) continue;
    seenInRecord.add(key);
    profileAssociationCounts.set(key, (profileAssociationCounts.get(key) || 0) + 1);
  }
}

for (const restaurant of restaurants) {
  const firstParty = firstPartyByRestaurant.get(restaurant.id)?.[0] || null;
  const feedSignals = websiteFeedByRestaurant.get(restaurant.id) || [];
  const apiSignals = socialByRestaurant.get(restaurant.id) || [];
  const allSignals = [...feedSignals, ...apiSignals];
  const currentSignals = allSignals.filter((signal) => sourceSignalFresh(signal));
  const uniqueProfiles = (firstParty?.socialProfiles || []).filter((profile) => profileAssociationCounts.get(profileKey(profile)) === 1);

  restaurant.firstPartySources = firstParty;
  restaurant.websiteFeedSignals = feedSignals;
  restaurant.socialSignals = apiSignals;
  restaurant.currentSourceSignals = currentSignals;
  restaurant.socialProfiles = uniqueProfiles;

  const specialSignalLinks = currentSignals
    .filter((signal) => sourceSignalHas(signal, "specials"))
    .map((signal) => ({
      label: signal.title || `${signal.platform === "instagram" ? "Instagram" : signal.platform === "facebook" ? "Facebook" : "Website"} special signal`,
      url: signal.postUrl,
      sourceSignal: true,
      sourceKind: signal.sourceKind,
      observedAt: signal.observedAt,
      publishedAt: signal.publishedAt || null
    }));

  const eventSignalLinks = currentSignals
    .filter((signal) => sourceSignalHas(signal, "events"))
    .map((signal) => ({
      label: signal.title || `${signal.platform === "instagram" ? "Instagram" : signal.platform === "facebook" ? "Facebook" : "Website"} event signal`,
      url: signal.postUrl,
      sourceSignal: true,
      sourceKind: signal.sourceKind,
      observedAt: signal.observedAt,
      publishedAt: signal.publishedAt || null
    }));

  restaurant.specialLinks = uniqueSourceSignalLinks(restaurant.specialLinks, specialSignalLinks);
  restaurant.eventLinks = uniqueSourceSignalLinks(restaurant.eventLinks, eventSignalLinks);
  restaurant.hasSpecial = Boolean(restaurant.hasSpecial || specialSignalLinks.length);
  restaurant.hasEvent = Boolean(restaurant.hasEvent || eventSignalLinks.length);
  restaurant.hasOpening = Boolean(restaurant.hasOpening || currentSignals.some((signal) => sourceSignalHas(signal, "openings")));
  restaurant.hasPatio = Boolean(restaurant.hasPatio || currentSignals.some((signal) => sourceSignalHas(signal, "patio")));

  const profileSources = uniqueProfiles.map((profile) => ({
    label: profile.platform === "instagram" ? "Official Instagram" : "Official Facebook",
    type: profile.platform === "instagram" ? "instagram_professional" : "facebook_page",
    url: profile.url,
    status: "verified_link"
  }));
  restaurant.sources = mergeSources(restaurant.sources, profileSources);
}

window.__halifaxFirstPartySourceCount = firstPartySourceRecords.length;
window.__halifaxWebsiteFeedSignalCount = websiteFeedSignals.length;
window.__halifaxSocialSignalCount = socialSignals.length;
window.__halifaxCurrentSourceSignalCount = [...websiteFeedSignals, ...socialSignals].filter((signal) => sourceSignalFresh(signal)).length;
