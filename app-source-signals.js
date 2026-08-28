"use strict";

const firstPartySourcePayload = window.HALIFAX_FIRST_PARTY_SOURCES ?? null;
const firstPartySourceRecords = Array.isArray(firstPartySourcePayload?.records) ? firstPartySourcePayload.records : [];
const websiteFeedSignalPayload = window.HALIFAX_WEBSITE_FEED_SIGNALS ?? null;
const websiteFeedSignals = Array.isArray(websiteFeedSignalPayload?.signals) ? websiteFeedSignalPayload.signals : [];
const socialSignalPayload = window.HALIFAX_SOCIAL_SIGNALS ?? null;
const socialSignals = Array.isArray(socialSignalPayload?.signals) ? socialSignalPayload.signals : [];

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

const firstPartyByRestaurant = sourceSignalGroup(firstPartySourceRecords);
const websiteFeedByRestaurant = sourceSignalGroup(websiteFeedSignals);
const socialByRestaurant = sourceSignalGroup(socialSignals);

for (const restaurant of restaurants) {
  const firstParty = firstPartyByRestaurant.get(restaurant.id)?.[0] || null;
  const feedSignals = websiteFeedByRestaurant.get(restaurant.id) || [];
  const apiSignals = socialByRestaurant.get(restaurant.id) || [];
  const allSignals = [...feedSignals, ...apiSignals];

  restaurant.firstPartySources = firstParty;
  restaurant.websiteFeedSignals = feedSignals;
  restaurant.socialSignals = apiSignals;
  restaurant.socialProfiles = Array.isArray(firstParty?.socialProfiles) ? firstParty.socialProfiles : [];

  const specialSignalLinks = allSignals
    .filter((signal) => sourceSignalHas(signal, "specials"))
    .map((signal) => ({
      label: signal.title || `${signal.platform === "instagram" ? "Instagram" : signal.platform === "facebook" ? "Facebook" : "Website"} special signal`,
      url: signal.postUrl,
      sourceSignal: true,
      sourceKind: signal.sourceKind,
      observedAt: signal.observedAt,
      publishedAt: signal.publishedAt || null
    }));

  const eventSignalLinks = allSignals
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
  restaurant.hasOpening = Boolean(restaurant.hasOpening || allSignals.some((signal) => sourceSignalHas(signal, "openings")));
  restaurant.hasPatio = Boolean(restaurant.hasPatio || allSignals.some((signal) => sourceSignalHas(signal, "patio")));

  const profileSources = restaurant.socialProfiles.map((profile) => ({
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
