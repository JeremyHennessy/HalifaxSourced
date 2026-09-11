(function () {
  "use strict";

  const nonLocalChainNames = [
    "A&W",
    "Arby's",
    "BarBurrito",
    "Baskin Robbins",
    "BeaverTails",
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
    "McDonald's",
    "Milestones",
    "Montana's",
    "Moxies",
    "Mr. Sub",
    "Mucho Burrito",
    "New York Fries",
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
    "Wendy's"
  ];

  const nonLocalChainHosts = [
    "aw.ca",
    "arbys.ca",
    "arbys.com",
    "barburrito.ca",
    "baskinrobbins.ca",
    "baskinrobbins.com",
    "beavertails.com",
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
    "wendys.com"
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

  function chainLabelMatch(value) {
    const token = policyToken(value);
    if (!token) return null;
    const matchedToken = chainTokens.find((chain) => token === chain || token.startsWith(`${chain} `) || token.endsWith(` ${chain}`));
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

  function localRestaurantPolicyDecision(record) {
    const tags = rawTagsFor(record);
    const labelCandidates = [
      ["name", (record && record.name) || tags.name],
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
      ["url", (record && record.url) || tags.url]
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

  function filterRecords(records, sourceLayer) {
    const included = [];
    const excluded = [];
    for (const record of Array.isArray(records) ? records : []) {
      const decision = localRestaurantPolicyDecision(record);
      if (decision.excluded) {
        excluded.push({
          sourceLayer,
          id: record && record.id,
          name: record && record.name,
          reason: decision.reason,
          field: decision.field,
          matchedToken: decision.matchedToken,
          matchedValue: decision.matchedValue
        });
      } else {
        included.push(record);
      }
    }
    return { included, excluded };
  }

  const curated = filterRecords(window.HALIFAX_RESTAURANTS, "curated");
  const openStreetMap = filterRecords(window.HALIFAX_OSM_RESTAURANTS, "openstreetmap");

  window.HALIFAX_RESTAURANTS = curated.included;
  window.HALIFAX_OSM_RESTAURANTS = openStreetMap.included;
  window.HALIFAX_LOCAL_RESTAURANT_POLICY = {
    version: "2026-09-11",
    excludedCount: curated.excluded.length + openStreetMap.excluded.length,
    excludedByLayer: {
      curated: curated.excluded.length,
      openStreetMap: openStreetMap.excluded.length
    },
    excludedRecords: [...curated.excluded, ...openStreetMap.excluded].slice(0, 250),
    isLocalRestaurantRecord,
    localRestaurantPolicyDecision
  };
})();
