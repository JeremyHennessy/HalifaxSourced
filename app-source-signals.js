"use strict";

const firstPartySourcePayload = window.HALIFAX_FIRST_PARTY_SOURCES ?? null;
const firstPartySourceRecords = Array.isArray(firstPartySourcePayload?.records) ? firstPartySourcePayload.records : [];
const websiteFeedSignalPayload = window.HALIFAX_WEBSITE_FEED_SIGNALS ?? null;
const websiteFeedSignals = Array.isArray(websiteFeedSignalPayload?.signals) ? websiteFeedSignalPayload.signals : [];
const websiteFeedPosts = Array.isArray(websiteFeedSignalPayload?.posts) ? websiteFeedSignalPayload.posts : websiteFeedSignals;
const socialSignalPayload = window.HALIFAX_SOCIAL_SIGNALS ?? null;
const socialSignals = Array.isArray(socialSignalPayload?.signals) ? socialSignalPayload.signals : [];
const socialPosts = Array.isArray(socialSignalPayload?.posts) ? socialSignalPayload.posts : socialSignals;
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

function mergeSocialProfiles(existing = [], additions = []) {
  const profiles = [];
  const seen = new Set();
  for (const profile of [...existing, ...additions]) {
    const url = safeUrl(profile?.url);
    if (!url) continue;
    const profileIdentity = profileKey(profile);
    const key = profileIdentity !== "|" ? profileIdentity : `${String(profile?.platform || "").toLowerCase()}|${url.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    profiles.push({ ...profile, url });
  }
  return profiles;
}

function socialSourceMeta(profile) {
  const platform = String(profile?.platform || "").toLowerCase();
  const labels = {
    facebook: "Official Facebook",
    instagram: "Official Instagram",
    x: "Official X",
    tiktok: "Official TikTok",
    youtube: "Official YouTube",
    threads: "Official Threads",
    linkedin: "Official LinkedIn",
    bluesky: "Official Bluesky",
    pinterest: "Official Pinterest",
    snapchat: "Official Snapchat"
  };
  const types = {
    facebook: "facebook_page",
    instagram: "instagram_profile",
    x: "x_profile",
    tiktok: "tiktok_profile",
    youtube: "youtube_channel",
    threads: "threads_profile",
    linkedin: "linkedin_profile",
    bluesky: "bluesky_profile",
    pinterest: "pinterest_profile",
    snapchat: "snapchat_profile"
  };
  return { label: labels[platform] || `Official ${platform}`, type: types[platform] || "social_profile" };
}

function linkHubSourceMeta(hub) {
  const platform = String(hub?.platform || "").toLowerCase();
  const labels = { linktree: "Official Linktree", beacons: "Official Beacons", linkinbio: "Official Linkin.bio", campsite: "Official Campsite", bento: "Official Bento" };
  return { label: labels[platform] || "Official link hub", type: "official_link_hub" };
}

const firstPartyByRestaurant = sourceSignalGroup(firstPartySourceRecords);
const websiteFeedByRestaurant = sourceSignalGroup(websiteFeedSignals);
const websiteFeedPostsByRestaurant = sourceSignalGroup(websiteFeedPosts);
const socialByRestaurant = sourceSignalGroup(socialSignals);
const socialPostsByRestaurant = sourceSignalGroup(socialPosts);
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
  const feedPosts = websiteFeedPostsByRestaurant.get(restaurant.id) || [];
  const apiSignals = socialByRestaurant.get(restaurant.id) || [];
  const apiPosts = socialPostsByRestaurant.get(restaurant.id) || [];
  const allSignals = [...feedSignals, ...apiSignals];
  const currentSignals = allSignals.filter((signal) => sourceSignalFresh(signal));
  const allProfiles = mergeSocialProfiles(restaurant.socialProfiles || [], Array.isArray(firstParty?.socialProfiles) ? firstParty.socialProfiles : []);
  const linkHubs = Array.isArray(firstParty?.linkHubs) ? firstParty.linkHubs : [];
  const uniqueProfiles = allProfiles.filter((profile) => profileAssociationCounts.get(profileKey(profile)) === 1);
  const sharedProfiles = allProfiles.filter((profile) => profileAssociationCounts.get(profileKey(profile)) > 1);
  const relatedLinks = Array.isArray(firstParty?.relatedLinks) ? firstParty.relatedLinks : [];

  restaurant.firstPartySources = firstParty;
  restaurant.websiteFeedSignals = feedSignals;
  restaurant.socialSignals = apiSignals;
  restaurant.currentSourceSignals = currentSignals;
  restaurant.officialUpdates = [...feedPosts, ...apiPosts]
    .filter((signal) => safeUrl(signal?.postUrl))
    .filter((signal, index, all) => all.findIndex((item) => item.postUrl === signal.postUrl) === index)
    .sort((a, b) => String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")));
  restaurant.socialProfiles = allProfiles;
  restaurant.linkHubs = linkHubs;
  restaurant.uniqueSocialProfiles = uniqueProfiles;
  restaurant.sharedSocialProfiles = sharedProfiles;
  restaurant.relatedLinks = relatedLinks;
  restaurant.orderingLinks = relatedLinks.filter((link) => link.kind === "ordering");
  restaurant.newsletterLinks = relatedLinks.filter((link) => link.kind === "newsletter");
  restaurant.ticketLinks = relatedLinks.filter((link) => link.kind === "tickets");

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

  const relatedMenuLinks = relatedLinks.filter((link) => link.kind === "menu").map((link) => ({ ...link, verifiedLink: true, sourceKind: "official_website_link" }));
  const relatedReservationLinks = relatedLinks.filter((link) => link.kind === "reservations").map((link) => ({ ...link, verifiedLink: true, sourceKind: "official_website_link" }));
  const relatedSpecialLinks = relatedLinks.filter((link) => ["menu", "ordering"].includes(link.kind) && /special|happy hour|feature|deal|promo/i.test(link.label || ""));
  const relatedEventLinks = relatedLinks.filter((link) => ["events", "tickets"].includes(link.kind));

  restaurant.menuLinks = uniqueSourceSignalLinks(restaurant.menuLinks, relatedMenuLinks);
  restaurant.reservationLinks = uniqueSourceSignalLinks(restaurant.reservationLinks, relatedReservationLinks);
  restaurant.specialLinks = uniqueSourceSignalLinks(restaurant.specialLinks, [...specialSignalLinks, ...relatedSpecialLinks]);
  restaurant.eventLinks = uniqueSourceSignalLinks(restaurant.eventLinks, [...eventSignalLinks, ...relatedEventLinks]);
  restaurant.hasMenu = Boolean(restaurant.hasMenu || relatedMenuLinks.length);
  restaurant.hasSpecial = Boolean(restaurant.hasSpecial || specialSignalLinks.length || relatedSpecialLinks.length);
  restaurant.hasEvent = Boolean(restaurant.hasEvent || eventSignalLinks.length || relatedEventLinks.length);
  restaurant.hasOpening = Boolean(isRestaurantActive(restaurant) && (restaurant.hasOpening || currentSignals.some((signal) => sourceSignalHas(signal, "openings"))));
  restaurant.hasPatio = Boolean(restaurant.hasPatio || currentSignals.some((signal) => sourceSignalHas(signal, "patio")));
  restaurant.hasSocial = allProfiles.length > 0;
  restaurant.hasLinkHub = linkHubs.length > 0;
  restaurant.hasReservation = Boolean(restaurant.hasReservation || relatedReservationLinks.length);
  restaurant.hasOrdering = restaurant.orderingLinks.length > 0;

  const profileSources = allProfiles.map((profile) => {
    const meta = socialSourceMeta(profile);
    return {
      ...meta,
      url: profile.url,
      status: profile.reviewState || "verified_link",
      associationBasis: profile.associationBasis,
      lastVerifiedAt: profile.lastVerifiedAt || profile.observedAt || null,
      sharedBrandProfile: profileAssociationCounts.get(profileKey(profile)) > 1
    };
  });
  const hubSources = linkHubs.map((hub) => ({
    ...linkHubSourceMeta(hub),
    url: hub.url,
    status: hub.reviewState || "verified_link",
    associationBasis: hub.associationBasis,
    lastVerifiedAt: hub.lastVerifiedAt || hub.observedAt || null
  }));
  const relatedSources = relatedLinks.map((link) => ({
    label: link.label || link.kind,
    type: `official_${link.kind}`,
    url: link.url,
    status: link.reviewState || "verified_link",
    associationBasis: link.associationBasis,
    lastVerifiedAt: link.lastVerifiedAt || link.observedAt || null
  }));
  restaurant.sources = mergeSources(restaurant.sources, [...profileSources, ...hubSources, ...relatedSources]);
}

window.__halifaxFirstPartySourceCount = firstPartySourceRecords.length;
window.__halifaxFirstPartySocialProfileCount = firstPartySourceRecords.reduce((sum, record) => sum + (record.socialProfiles?.length || 0), 0);
window.__halifaxFirstPartyLinkHubCount = firstPartySourceRecords.reduce((sum, record) => sum + (record.linkHubs?.length || 0), 0);
window.__halifaxFirstPartyRelatedLinkCount = firstPartySourceRecords.reduce((sum, record) => sum + (record.relatedLinks?.length || 0), 0);
window.__halifaxWebsiteFeedSignalCount = websiteFeedSignals.length;
window.__halifaxSocialSignalCount = socialSignals.length;
window.__halifaxCurrentSourceSignalCount = [...websiteFeedSignals, ...socialSignals].filter((signal) => sourceSignalFresh(signal)).length;
