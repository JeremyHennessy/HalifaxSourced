(function () {
  "use strict";

  const nonLocalChainNames = [
    "A&W",
    "Arby's",
    "BarBurrito",
    "Baskin Robbins",
    "BeaverTails",
    "Ben & Florentine",
    "Booster Juice",
    "Boston Pizza",
    "Burger King",
    "Captain Sub",
    "Chop Steakhouse",
    "Cinnabon",
    "Coffee Culture",
    "Cora",
    "Dairy Queen",
    "Denny's",
    "Domino's",
    "East Side Mario's",
    "Earls",
    "Edo Japan",
    "Fatburger",
    "Five Guys",
    "Freshii",
    "Greco Pizza",
    "Harvey's",
    "IHOP",
    "Jack Astor's",
    "KFC",
    "Kernels",
    "Little Caesars",
    "Local Public Eatery",
    "Manchu Wok",
    "Mary Brown's",
    "McCafe",
    "McDonald",
    "McDonald's",
    "Milestones",
    "Montana's",
    "Moxies",
    "Mr. Sub",
    "Mucho Burrito",
    "New York Fries",
    "Osmow",
    "Osmow's",
    "Papa John's",
    "Pizza Delight",
    "Pizza Hut",
    "Pizza Pizza",
    "Pita Pit",
    "Popeyes",
    "Popeyes Louisiana Kitchen",
    "Pur & Simple",
    "Quesada",
    "Robin's Donuts",
    "Second Cup",
    "Smitty's",
    "Starbucks",
    "St. Louis Bar & Grill",
    "Subway",
    "Swiss Chalet",
    "Taco Bell",
    "Taco Del Mar",
    "Teriyaki Experience",
    "Thai Express",
    "The Keg",
    "The Keg Steakhouse",
    "Tim Hortons",
    "Tim Horton's",
    "Villa Madina",
    "Wendy",
    "Wendy's",
    "Wing 'n It",
    "Wing'n It"
  ];

  const nonLocalChainHosts = [
    "aw.ca",
    "arbys.ca",
    "arbys.com",
    "barburrito.ca",
    "baskinrobbins.ca",
    "baskinrobbins.com",
    "beavertails.com",
    "benetflorentine.com",
    "boosterjuice.com",
    "bostonpizza.com",
    "burgerking.ca",
    "burgerking.com",
    "captainsubmarine.com",
    "chop.ca",
    "cinnabon.ca",
    "cinnabon.com",
    "coffeeculturecafe.com",
    "chezcora.com",
    "dairyqueen.com",
    "dennys.ca",
    "dennys.com",
    "dominos.ca",
    "dominos.com",
    "eastsidemarios.com",
    "earls.ca",
    "edojapan.com",
    "fatburger.com",
    "fiveguys.ca",
    "fiveguys.com",
    "freshii.com",
    "greco.ca",
    "harveys.ca",
    "ihop.com",
    "jackastors.com",
    "kfc.ca",
    "kfc.com",
    "kernels.ca",
    "littlecaesars.ca",
    "littlecaesars.com",
    "localpubliceatery.com",
    "manchuwok.com",
    "marybrowns.com",
    "mcdonalds.ca",
    "mcdonalds.com",
    "milestonesrestaurants.com",
    "montanas.ca",
    "moxies.com",
    "mrsub.ca",
    "muchoburrito.com",
    "newyorkfries.com",
    "osmows.com",
    "papajohns.ca",
    "papajohns.com",
    "pizzadelight.com",
    "pizzahut.ca",
    "pizzahut.com",
    "pizzapizza.ca",
    "pitapit.ca",
    "popeyeschicken.ca",
    "popeyes.com",
    "pursimple.com",
    "quesada.ca",
    "robinsdonuts.com",
    "secondcup.com",
    "smittys.ca",
    "stlouiswings.com",
    "starbucks.ca",
    "starbucks.com",
    "subway.com",
    "swisschalet.com",
    "tacobell.ca",
    "tacobell.com",
    "tacodelmar.com",
    "teriyakiexperience.com",
    "thaiexpress.ca",
    "thekeg.com",
    "timhortons.ca",
    "timhortons.com",
    "villamadina.com",
    "wendys.ca",
    "wendys.com",
    "wingnit.ca"
  ];

  function policyToken(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/&/g, " and ")
      .replace(/['\u2019]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const chainTokens = nonLocalChainNames.map(policyToken).filter(Boolean);
  const chainHosts = nonLocalChainHosts.map(normalizeHost).filter(Boolean);

  function normalizeHost(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      return new URL(withProtocol).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  function chainTokenMatches(token, chain) {
    const possessive = `${chain}s`;
    return token === chain || token === possessive || token.startsWith(`${chain} `) || token.startsWith(`${possessive} `) || token.endsWith(` ${chain}`) || token.endsWith(` ${possessive}`);
  }

  function chainLabelMatch(value) {
    const token = policyToken(value);
    if (!token) return null;
    const matchedToken = chainTokens.find((chain) => chainTokenMatches(token, chain));
    return matchedToken ? { matchedToken, matchedValue: String(value) } : null;
  }

  function chainHostMatch(value) {
    const host = normalizeHost(value);
    if (!host) return null;
    const matchedHost = chainHosts.find((chainHost) => host === chainHost || host.endsWith(`.${chainHost}`));
    return matchedHost ? { matchedToken: matchedHost, matchedValue: String(value) } : null;
  }

  function rawTagsFor(record) {
    return (record && record.osm && record.osm.rawTags) || (record && record.rawTags) || {};
  }

  function recordLabel(record) {
    return record && (record.name || record.restaurantName || record.venueName || record.candidateName || record.sourceName);
  }

  function localRestaurantPolicyDecision(record) {
    const tags = rawTagsFor(record);
    const labelCandidates = [
      ["name", (record && record.name) || tags.name],
      ["restaurantName", record && record.restaurantName],
      ["venueName", record && record.venueName],
      ["candidateName", record && record.candidateName],
      ["sourceName", record && record.sourceName],
      ["official_name", (record && record.officialName) || tags.official_name],
      ["brand", (record && record.brand) || tags.brand],
      ["operator", (record && record.operator) || tags.operator],
      ["alt_name", tags.alt_name],
      ["short_name", tags.short_name],
      ["name:en", tags["name:en"]]
    ];

    for (const [field, value] of labelCandidates) {
      const match = chainLabelMatch(value);
      if (match) return { excluded: true, reason: "non_local_chain_label", field, ...match };
    }

    const hostCandidates = [
      ["website", (record && record.website) || tags.website],
      ["contact:website", tags["contact:website"]],
      ["url", (record && record.url) || tags.url],
      ["sourceUrl", record && record.sourceUrl],
      ["sourcePageUrl", record && record.sourcePageUrl],
      ["sourceImageUrl", record && record.sourceImageUrl],
      ["thumbnailUrl", record && record.thumbnailUrl]
    ];

    for (const [field, value] of hostCandidates) {
      const match = chainHostMatch(value);
      if (match) return { excluded: true, reason: "non_local_chain_website", field, ...match };
    }

    return { excluded: false, reason: null, field: null, matchedToken: null, matchedValue: null };
  }

  function isLocalRestaurantRecord(record) {
    return !localRestaurantPolicyDecision(record).excluded;
  }

  function excludedSummary(record, sourceLayer, decision) {
    return {
      sourceLayer,
      id: record && record.id,
      name: recordLabel(record),
      reason: decision.reason,
      field: decision.field,
      matchedToken: decision.matchedToken,
      matchedValue: decision.matchedValue
    };
  }

  function filterRecords(records, sourceLayer, excludedIds) {
    const included = [];
    const excluded = [];
    for (const record of Array.isArray(records) ? records : []) {
      const id = record && record.id;
      if (id && excludedIds.has(id)) {
        excluded.push(excludedSummary(record, sourceLayer, {
          excluded: true,
          reason: "non_local_chain_id",
          field: "id",
          matchedToken: id,
          matchedValue: id
        }));
        continue;
      }
      const decision = localRestaurantPolicyDecision(record);
      if (decision.excluded) {
        if (id) excludedIds.add(id);
        excluded.push(excludedSummary(record, sourceLayer, decision));
      } else {
        included.push(record);
      }
    }
    return { included, excluded };
  }

  function filterChildRecords(records, excludedIds, sourceLayer) {
    const included = [];
    const excluded = [];
    for (const record of Array.isArray(records) ? records : []) {
      if (excludedIds.has(record && record.restaurantId) || localRestaurantPolicyDecision(record).excluded) {
        excluded.push({ sourceLayer, restaurantId: record && record.restaurantId, id: record && record.id, name: recordLabel(record) });
      } else {
        included.push(record);
      }
    }
    return { included, excluded };
  }

  function applyPayloadRecordFilter(payload, field, excludedIds, sourceLayer) {
    if (!payload || !Array.isArray(payload[field])) return { included: 0, excluded: 0 };
    const result = filterChildRecords(payload[field], excludedIds, sourceLayer);
    payload[field] = result.included;
    return { included: result.included.length, excluded: result.excluded.length };
  }

  function refreshGenericCounts(payload, field) {
    if (!payload || !Array.isArray(payload[field])) return;
    if (field === "records" && Object.prototype.hasOwnProperty.call(payload, "count")) payload.count = payload[field].length;
    if (payload.counts && Object.prototype.hasOwnProperty.call(payload.counts, "total")) payload.counts.total = payload[field].length;
  }

  function refreshThumbnailCounts(payload) {
    if (!payload || !payload.counts) return;
    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    const approvedRestaurantIds = new Set(candidates.filter((candidate) => candidate && candidate.eligibleForProduction).map((candidate) => candidate.restaurantId));
    const anyCandidateRestaurantIds = new Set(candidates.map((candidate) => candidate && candidate.restaurantId).filter(Boolean));
    payload.counts.thumbnailCandidates = candidates.length;
    payload.counts.restaurantsWithApprovedThumbnail = approvedRestaurantIds.size;
    payload.counts.restaurantsWithAnyCandidate = anyCandidateRestaurantIds.size;
    if (Array.isArray(payload.missingApproved)) payload.counts.restaurantsMissingApprovedThumbnail = payload.missingApproved.length;
    if (Array.isArray(payload.missingAnyCandidate)) payload.counts.restaurantsMissingAnyCandidate = payload.missingAnyCandidate.length;
  }

  function refreshStructuredPlaceCounts(payload) {
    if (!payload || !payload.counts || !Array.isArray(payload.records)) return;
    const records = payload.records;
    payload.counts.records = records.length;
    payload.counts.hours = records.filter((record) => record.hours).length;
    payload.counts.phone = records.filter((record) => record.phone).length;
    payload.counts.email = records.filter((record) => record.email).length;
    payload.counts.address = records.filter((record) => record.address).length;
    payload.counts.features = records.filter((record) => Array.isArray(record.features) && record.features.length).length;
    payload.counts.menus = records.filter((record) => Array.isArray(record.menus) && record.menus.length).length;
    payload.counts.reservations = records.filter((record) => Array.isArray(record.reservations) && record.reservations.length).length;
    payload.counts.ordering = records.filter((record) => Array.isArray(record.ordering) && record.ordering.length).length;
  }

  function refreshPatioCounts(payload) {
    if (!payload || !payload.counts || !Array.isArray(payload.records)) return;
    const records = payload.records;
    payload.counts.total = records.length;
    payload.counts.resolved = records.filter((record) => record.restaurantId).length;
    payload.counts.unresolved = records.filter((record) => !record.restaurantId && record.matchMethod === "unresolved").length;
    payload.counts.conflicts = records.filter((record) => record.matchMethod === "conflict").length;
    payload.counts.dogFriendly = records.filter((record) => record.dogFriendly).length;
    payload.counts.withWebsite = records.filter((record) => record.website).length;
    payload.counts.withSourceImage = records.filter((record) => record.sourceImageUrl).length;
  }

  function refreshPublicSpecialCounts(payload) {
    if (!payload || !payload.counts || !Array.isArray(payload.records)) return;
    const records = payload.records;
    payload.counts.total = records.length;
    payload.counts.resolved = records.filter((record) => record.restaurantId).length;
    payload.counts.unresolved = records.filter((record) => !record.restaurantId && record.matchMethod === "unresolved").length;
    payload.counts.conflicts = records.filter((record) => record.matchMethod === "conflict").length;
    payload.counts.happyHour = records.filter((record) => record.specialType === "happy_hour").length;
    payload.counts.seasonalCampaign = records.filter((record) => record.sourceId === "discover-halifax-dine-around-2026").length;
    payload.counts.foodCrawl = records.filter((record) => record.sourceId === "downtown-dartmouth-food-crawl-spring-2026").length;
    payload.counts.withPrice = records.filter((record) => record.price !== null && Number.isFinite(Number(record.price))).length;
    payload.counts.withSchedule = records.filter((record) => Array.isArray(record.dayOfWeek) && record.dayOfWeek.length && record.startTime && record.endTime).length;
    payload.counts.withSourceImage = records.filter((record) => record.sourceImageUrl).length;
  }

  function refreshStructuredSpecialCounts(payload) {
    if (!payload || !Array.isArray(payload.records)) return;
    const records = payload.records;
    payload.count = records.length;
    payload.verifiedCurrent = records.filter((record) => record.status === "verified_current").length;
    payload.recurringVerify = records.filter((record) => record.status === "likely_recurring_verify").length;
    payload.sourceLeads = records.filter((record) => record.status === "source_lead").length;
    payload.stale = records.filter((record) => record.status === "stale").length;
    payload.expired = records.filter((record) => record.status === "expired").length;
    if (Array.isArray(payload.orphanSources)) payload.orphanSourceCount = payload.orphanSources.length;
  }

  function refreshVerifiedSourcePageCounts(payload) {
    if (!payload) return;
    if (Array.isArray(payload.failures)) payload.failedPages = payload.failures.length;
    if (Array.isArray(payload.menuSources) || Array.isArray(payload.specialSources)) {
      payload.candidateCount = (payload.menuSources || []).length + (payload.specialSources || []).length;
    }
  }

  const excludedIds = new Set();
  const curated = filterRecords(window.HALIFAX_RESTAURANTS, "curated", excludedIds);
  const openStreetMap = filterRecords(window.HALIFAX_OSM_RESTAURANTS, "openstreetmap", excludedIds);
  const discovered = filterRecords(window.HALIFAX_DISCOVERED_RESTAURANTS, "local_discovery", excludedIds);

  window.HALIFAX_RESTAURANTS = curated.included;
  window.HALIFAX_OSM_RESTAURANTS = openStreetMap.included;
  if (Array.isArray(window.HALIFAX_DISCOVERED_RESTAURANTS)) window.HALIFAX_DISCOVERED_RESTAURANTS = discovered.included;

  const childDatasetCounts = {
    firstPartySources: applyPayloadRecordFilter(window.HALIFAX_FIRST_PARTY_SOURCES, "records", excludedIds, "first_party_sources"),
    verifiedSourceFailures: applyPayloadRecordFilter(window.HALIFAX_VERIFIED_SOURCE_PAGES, "failures", excludedIds, "verified_source_failures"),
    verifiedMenuSources: applyPayloadRecordFilter(window.HALIFAX_VERIFIED_SOURCE_PAGES, "menuSources", excludedIds, "verified_menu_sources"),
    verifiedSpecialSources: applyPayloadRecordFilter(window.HALIFAX_VERIFIED_SOURCE_PAGES, "specialSources", excludedIds, "verified_special_sources"),
    restaurantMedia: applyPayloadRecordFilter(window.HALIFAX_RESTAURANT_MEDIA, "records", excludedIds, "restaurant_media"),
    websiteFeedSignals: applyPayloadRecordFilter(window.HALIFAX_WEBSITE_FEED_SIGNALS, "signals", excludedIds, "website_feed_signals"),
    websiteFeedPosts: applyPayloadRecordFilter(window.HALIFAX_WEBSITE_FEED_SIGNALS, "posts", excludedIds, "website_feed_posts"),
    websitePageIntelligenceRecords: applyPayloadRecordFilter(window.HALIFAX_WEBSITE_PAGE_INTELLIGENCE, "records", excludedIds, "website_page_intelligence"),
    websitePageIntelligenceSignals: applyPayloadRecordFilter(window.HALIFAX_WEBSITE_PAGE_INTELLIGENCE, "signals", excludedIds, "website_page_signals"),
    structuredPlaceFacts: applyPayloadRecordFilter(window.HALIFAX_STRUCTURED_PLACE_FACTS, "records", excludedIds, "structured_place_facts"),
    structuredPlaceFailures: applyPayloadRecordFilter(window.HALIFAX_STRUCTURED_PLACE_FACTS, "failures", excludedIds, "structured_place_failures"),
    patioDirectoryFacts: applyPayloadRecordFilter(window.HALIFAX_PATIO_DIRECTORY_FACTS, "records", excludedIds, "patio_directory_facts"),
    publicSpecialSourceLeads: applyPayloadRecordFilter(window.HALIFAX_PUBLIC_SPECIAL_SOURCE_LEADS, "records", excludedIds, "public_special_source_leads"),
    structuredSpecials: applyPayloadRecordFilter(window.HALIFAX_STRUCTURED_SPECIALS, "records", excludedIds, "structured_specials"),
    structuredSpecialOrphans: applyPayloadRecordFilter(window.HALIFAX_STRUCTURED_SPECIALS, "orphanSources", excludedIds, "structured_special_orphans"),
    socialSignals: applyPayloadRecordFilter(window.HALIFAX_SOCIAL_SIGNALS, "signals", excludedIds, "social_signals"),
    socialPosts: applyPayloadRecordFilter(window.HALIFAX_SOCIAL_SIGNALS, "posts", excludedIds, "social_posts"),
    recentSocialPosts: applyPayloadRecordFilter(window.HALIFAX_RECENT_SOCIAL_POSTS, "records", excludedIds, "recent_social_posts"),
    reviewedSocialPosts: applyPayloadRecordFilter(window.HALIFAX_REVIEWED_SOCIAL_POSTS, "records", excludedIds, "reviewed_social_posts"),
    reviewedPlaceResolutions: applyPayloadRecordFilter(window.HALIFAX_REVIEWED_PLACE_RESOLUTIONS, "records", excludedIds, "reviewed_place_resolutions"),
    thumbnailCandidates: applyPayloadRecordFilter(window.HALIFAX_THUMBNAIL_CANDIDATES, "candidates", excludedIds, "thumbnail_candidates"),
    thumbnailMissingApproved: applyPayloadRecordFilter(window.HALIFAX_THUMBNAIL_CANDIDATES, "missingApproved", excludedIds, "thumbnail_missing_approved"),
    thumbnailMissingAnyCandidate: applyPayloadRecordFilter(window.HALIFAX_THUMBNAIL_CANDIDATES, "missingAnyCandidate", excludedIds, "thumbnail_missing_any")
  };
  refreshGenericCounts(window.HALIFAX_RESTAURANT_MEDIA, "records");
  refreshGenericCounts(window.HALIFAX_WEBSITE_FEED_SIGNALS, "signals");
  refreshGenericCounts(window.HALIFAX_WEBSITE_PAGE_INTELLIGENCE, "records");
  refreshStructuredPlaceCounts(window.HALIFAX_STRUCTURED_PLACE_FACTS);
  refreshPatioCounts(window.HALIFAX_PATIO_DIRECTORY_FACTS);
  refreshPublicSpecialCounts(window.HALIFAX_PUBLIC_SPECIAL_SOURCE_LEADS);
  refreshStructuredSpecialCounts(window.HALIFAX_STRUCTURED_SPECIALS);
  refreshVerifiedSourcePageCounts(window.HALIFAX_VERIFIED_SOURCE_PAGES);
  refreshThumbnailCounts(window.HALIFAX_THUMBNAIL_CANDIDATES);

  window.HALIFAX_LOCAL_RESTAURANT_POLICY = {
    version: "2026-09-11",
    excludedCount: curated.excluded.length + openStreetMap.excluded.length + discovered.excluded.length,
    excludedByLayer: {
      curated: curated.excluded.length,
      openStreetMap: openStreetMap.excluded.length,
      localDiscovery: discovered.excluded.length
    },
    excludedChildRecordCounts: Object.fromEntries(Object.entries(childDatasetCounts).map(([key, value]) => [key, value.excluded])),
    excludedIds: Array.from(excludedIds).slice(0, 500),
    excludedRecords: [...curated.excluded, ...openStreetMap.excluded, ...discovered.excluded].slice(0, 500),
    isLocalRestaurantRecord,
    localRestaurantPolicyDecision
  };
})();