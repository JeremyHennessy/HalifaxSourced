/* Shared by static Pages and local collectors. Public references confer no media licence. */
(function (root) {
  // The purported replacement also returned a cross-entity redirect during the
  // bounded repair. Keep it out of consumer navigation until independently repaired.
  const blockedHosts = new Set(['justitalymentone.com', 'bowtiecreamery.com', 'glitterbeancafe.com', 'turkishdelighthalifax.ca', 'humanitea.com', 'twoifbyseacafe.ca']);
  // Repeated 404 responses observed October 19; quarantine only these paths,
  // not the operating restaurants or their entire domains.
  const brokenPaths = new Set([
  "elagreektaverna.com/dinner",
  "doordash.com/en-CA/store/jungle-jim",
  "terracafe.ca/menu-1-2",
  "magnoliahfx.com/s/trianglemenu_sept25.pdf",
  "magnoliahfx.com/s/menu_sept2025.pdf",
  "swaadsagaa.com/tel&",
  "loupecou.com/menu",
  "x.com/phohoangminh.ca",
  "youtube.com/@phohoangminh.ca",
  "restaurantlogin.com/api/fb/6qxm_n",
  "studioeastfood.ca/menu/dinner",
  "youtube.com/afriteresto",
  "brawta-by-grafton.square.site",
  "brawtajerk.ca/menu",
  "stardustbar.ca/reservations",
  // Repeated 404/410 confirmed by the October 22 release audit; no replacement verified.
  "sushisquare.ca/menu",
  // The subsequent main audit independently confirmed the homepage unavailable too.
  "sushisquare.ca"
]);
  // Exact restaurant + content kind + URL decisions. Raw historical observations
  // remain in the audit ledger; a bad specials link can still be a valid menu.
  const rejectedPointerKeys = new Set([
  "[\"osm-node-11526163876-starbucks\",\"menu\",\"https://dal.mydininghub.ca/en/account?section=my-menu\"]",
  "[\"osm-node-11526163877-fillings-bistro-32\",\"menu\",\"https://dal.mydininghub.ca/en/account?section=my-menu\"]",
  "[\"osm-node-11526163878-tim-hortons\",\"menu\",\"https://dal.mydininghub.ca/en/account?section=my-menu\"]",
  "[\"osm-node-11526163879-zoca\",\"menu\",\"https://dal.mydininghub.ca/en/account?section=my-menu\"]",
  "[\"osm-node-11526163880-pizza-pizza\",\"menu\",\"https://dal.mydininghub.ca/en/account?section=my-menu\"]",
  "[\"osm-node-11526163881-grille-works\",\"menu\",\"https://dal.mydininghub.ca/en/account?section=my-menu\"]",
  "[\"osm-node-11526163882-brief-break\",\"menu\",\"https://dal.mydininghub.ca/en/account?section=my-menu\"]",
  "[\"osm-node-11526163883-green-cafe\",\"menu\",\"https://dal.mydininghub.ca/en/account?section=my-menu\"]",
  "[\"osm-node-11526163885-ground-zero\",\"menu\",\"https://dal.mydininghub.ca/en/account?section=my-menu\"]",
  "[\"osm-node-11552234300-sushi-nami-royale\",\"menu\",\"https://sushinami.ca/bedford-highway/lunch-menu/\"]",
  "[\"osm-node-11552234300-sushi-nami-royale\",\"menu\",\"https://sushinami.ca/downtown-halifax/lunch-menu/\"]",
  "[\"osm-node-11552234300-sushi-nami-royale\",\"menu\",\"https://sushinami.ca/downtown-halifax/take-out/\"]",
  "[\"osm-node-267592735-bluenose-ii\",\"menu\",\"https://bluenoseii.ca/wp-login.php?redirect_to=https%3A%2F%2Fbluenoseii.ca%2Fwp-admin%2Fnav-menus.php%3Faction%3Dlocations&reauth=1\"]",
  "[\"osm-node-3799422457-cora\",\"menu\",\"https://www.chezcora.com/wp-content/uploads/2026/09/Allergenes-menu-2026-05_QC-EN.pdf\"]",
  "[\"osm-node-3799422457-cora\",\"menu\",\"https://www.chezcora.com/wp-content/uploads/2026/09/Allergenes-menu-2026-05_QC-FR.pdf\"]",
  "[\"osm-node-4990340206-subway\",\"menu\",\"https://www.subway.com/en-CA/MenuNutrition/Nutrition\"]",
  "[\"osm-node-5161526522-sushi-nami-royale\",\"menu\",\"https://sushinami.ca/bayers-lake/lunch-menu/\"]",
  "[\"osm-node-5161526522-sushi-nami-royale\",\"menu\",\"https://sushinami.ca/bedford-highway/lunch-menu/\"]",
  "[\"osm-node-6296953436-the-mercantile-social\",\"menu\",\"https://www.thebesthalifax.com/top-cocktail-bars-halifax/\"]",
  "[\"osm-node-6910685885-mexi-s\",\"menu\",\"https://www.mexicalirosas.com/moncton/dinner/\"]",
  "[\"osm-node-6910685885-mexi-s\",\"menu\",\"https://www.mexicalirosas.com/moncton/kids/\"]",
  "[\"osm-node-6910685885-mexi-s\",\"menu\",\"https://www.mexicalirosas.com/moncton/lunch/\"]",
  "[\"osm-node-6910685885-mexi-s\",\"menu\",\"https://www.mexicalirosas.com/ottawa/dinner/\"]",
  "[\"osm-node-6910685885-mexi-s\",\"menu\",\"https://www.mexicalirosas.com/ottawa/kids/\"]",
  "[\"osm-node-11552510567-tako-sushi-and-ramen\",\"special\",\"https://www.takosushiramen.ca/menu/chefs-special-rolls\"]",
  "[\"osm-node-11552510567-tako-sushi-and-ramen\",\"special\",\"https://www.takosushiramen.ca/menu/chefs-special-rolls/entrees\"]",
  "[\"osm-node-11752717941-east-cup-cafe\",\"special\",\"https://eastcupcafe.com/collections/specialty-blends\"]",
  "[\"osm-node-2713247300-pizza-co\",\"special\",\"https://pzzaco.ca/specialty-pizzas/\"]",
  "[\"osm-node-2714920436-greco-pizza\",\"special\",\"https://greco.ca/newsletter/\"]",
  "[\"osm-node-5631529440-hmcs-king-s-wardroom\",\"special\",\"https://ukings.ca/alumni/giving/support/special-projects/\"]",
  "[\"osm-node-8636456775-booster-juice\",\"special\",\"https://boosterjuice.com/en-ca/collections/specialty-shots\"]"
]);
  function pointerSafe(restaurantId, kind, value) {
    try { const url = new URL(value); url.hash = '';
      // A shared header/footer address does not qualify another branch's menu
      // or photo. Consumable pointers must name the catalog location in the
      // first path segment; shared pages remain evidence, not location menus.
      const branches = {
        'osm-node-11552234300-sushi-nami-royale': 'bayers-lake',
        'osm-node-5161526522-sushi-nami-royale': 'downtown-halifax',
        'ns-food-2617563': 'bayers-lake', 'ns-food-2691532': 'downtown-halifax',
        'ns-food-2851000': 'dartmouth-crossing', 'ns-food-2156028': 'bedford-highway'
      };
      const branch = branches[restaurantId];
      if (branch && sourceHost(url) === 'sushinami.ca') {
        const pathBranch = url.pathname.split('/').filter(Boolean)[0] || '';
        const knownBranch = new Set(Object.values(branches)).has(pathBranch);
        const consumable = ['menu', 'special', 'specials', 'image_preview'].includes(kind);
        if ((knownBranch || consumable) && pathBranch !== branch) return false;
      }
      if (restaurantId === 'osm-node-6910685885-mexi-s' && sourceHost(url) === 'mexicalirosas.com' && /^\/(?:moncton|ottawa)\//.test(url.pathname)) return false;
      return safeSource(value) && !rejectedPointerKeys.has(JSON.stringify([restaurantId, kind === 'specials' ? 'special' : kind, url.href])); } catch { return false; }
  }
  function sourceHost(value) {
    try { return new URL(value).hostname.toLowerCase().replace(/\.+$/, '').replace(/^www\./, ''); } catch { return ''; }
  }
  // Action arrays retain their source order/evidence. Every public consumer
  // must apply the existing location/kind/URL policy, not merely URL safety.
  function actionLinks(restaurantId, kind, links = []) {
    if (!primaryActionUrl(restaurantId, kind, links)) return [];
    return (Array.isArray(links) ? links : []).filter(link => pointerSafe(restaurantId, kind, link?.url));
  }
  function primaryActionUrl(restaurantId, kind, links = []) {
    // A rejected first choice is not permission to promote an unreviewed
    // runner-up (which may be a provider homepage or another branch).
    if (!['ordering', 'reservations'].includes(kind)) return null;
    const url = Array.isArray(links) ? links[0]?.url : null;
    return pointerSafe(restaurantId, kind, url) ? url : null;
  }
  function actionAvailable(restaurantId, kind, links, capability = false) {
    if (Array.isArray(links) && links.length) return Boolean(primaryActionUrl(restaurantId, kind, links));
    // Historical keyword-only reservation capability is not a direct link.
    // Preserve that separate existing signal, but never use it as a fallback
    // when a supplied primary action has been rejected.
    return kind === 'reservations' && Boolean(capability);
  }
  function safeSource(value) {
    try { const u = new URL(value); const host = sourceHost(u); return Boolean(host) && !brokenPaths.has(host + u.pathname.replace(/\/+$/, '')) && ['http:', 'https:'].includes(u.protocol) && ![...blockedHosts].some(h => host === h || host.endsWith('.' + h)); } catch { return false; }
  }
  function publicationState(value, now = Date.now(), maxDays = 180) {
    const stamp = Date.parse(String(value || ''));
    if (!Number.isFinite(stamp)) return { ageDays: null, isRecent: false, dateState: 'missing' };
    const age = now - stamp;
    // Even small clock skew is uncertain, never today's publication.
    if (age < 0) return { ageDays: null, isRecent: false, dateState: 'future' };
    return { ageDays: Math.floor(age / 86400000), isRecent: age <= maxDays * 86400000, dateState: 'valid' };
  }
  function postExpiry(item, maxDays = 60) {
    const stamp = Date.parse(String(item.publishedAt || ''));
    if (!Number.isFinite(stamp)) return null;
    let end = stamp + maxDays * 86400000;
    if (item.expiresAt && Number.isFinite(Date.parse(item.expiresAt))) end = Math.min(end, Date.parse(item.expiresAt));
    const title = String(item.title || '').toLowerCase();
    const year = new Date(stamp).getUTCFullYear();
    const season = title.match(/\b(?:this |our )?(spring|summer|fall|autumn|winter)\b(?! garden)/)?.[1];
    if (season) {
      const monthDay = {spring:'06-21',summer:'09-22',fall:'12-21',autumn:'12-21',winter:'03-21'}[season];
      const endYear = season === 'winter' && new Date(stamp).getUTCMonth() >= 9 ? year + 1 : year;
      end = Math.min(end, Date.parse(`${endYear}-${monthDay}T00:00:00-03:00`));
    }
    return new Date(end).toISOString();
  }
  function heldSocialFact(item) {
    return item?.factCandidate != null || item?.contentPolicy === "factual_candidates_no_caption_or_media" || item?.reviewState === "needs_fact_review";
  }
  function currentPost(item, now = Date.now(), maxDays = 60) {
    if (heldSocialFact(item) || !locationSafe(item) || !safeSource(item.postUrl || item.sourceUrl)) return false;
    if (!publicationState(item.publishedAt, now, maxDays).isRecent) return false;
    for (const value of [item.expiresAt, item.reviewDueAt, postExpiry(item, maxDays)]) if (value && (!Number.isFinite(Date.parse(value)) || Date.parse(value) <= now)) return false;
    return true;
  }
  function locationSafe(item) {
    if (item?.locationValidated === false || item?.identityValidated === false || item?.quarantined || item?.reviewState === 'quarantined') return false;
    if (item?.restaurantId === 'osm-node-13141377001-india-paradise') {
      return /\/halifax\/downtown\//i.test(item.postUrl || item.sourceUrl || item.url || '') || item.locationValidated === true;
    }
    return true;
  }
  function currentOffer(item, now = Date.now(), maxDays = 30) {
    if (item?.status !== 'verified_current' || !locationSafe(item) || !safeSource(item.sourceUrl)) return false;
    if (['official_website_link', 'verified_restaurant_owned_page'].includes(item.sourceType)) return false;
    const verified = publicationState(item.verifiedAt, now, maxDays);
    if (!verified.isRecent) return false;
    if (item.expiresAt && (!Number.isFinite(Date.parse(item.expiresAt)) || Date.parse(item.expiresAt) < now)) return false;
    if (item.reviewDueAt && (!Number.isFinite(Date.parse(item.reviewDueAt)) || Date.parse(item.reviewDueAt) < now)) return false;
    if (item.validFrom && (!Number.isFinite(Date.parse(item.validFrom)) || Date.parse(item.validFrom) > now)) return false;
    if (item.validTo && (!Number.isFinite(Date.parse(item.validTo)) || Date.parse(item.validTo) < now)) return false;
    return true;
  }
  // Observation clocks describe evidence, not refresh attempts or rebuilds.
  // Keep a genuine prior observation even when its separate latestAssessment
  // reports a later held/failed refresh. No raw source object is rewritten.
  function observationStamp(value, now = Date.now()) {
    const stamp = typeof value === 'string' ? Date.parse(value) : NaN;
    return Number.isFinite(stamp) && Number.isFinite(now) && stamp <= now ? new Date(stamp).toISOString() : '';
  }
  function observationRootEligible(record) {
    const status = record?.status;
    if (record && Object.hasOwn(record, 'status') && !['number', 'string'].includes(typeof status)) return false;
    const statusText = typeof status === 'string' ? status.trim().toLowerCase() : status;
    const httpStatus = typeof status === 'number' || typeof statusText === 'string' && /^[+-]?(?:\d|\.\d)/.test(statusText);
    const contentStatus = !httpStatus || Number.isInteger(Number(status)) && Number(status) >= 200 && Number(status) < 300;
    return Boolean(record && contentStatus && !record.error &&
      (!Object.hasOwn(record, 'attempted') || record.attempted === true) &&
      (!Object.hasOwn(record, 'state') || ['ok', 'observed'].includes(record.state)) &&
      !Object.hasOwn(record, 'accessHold') && !Object.hasOwn(record, 'holdTarget') &&
      record.reusedObservation !== true &&
      !['failed', 'restricted', 'held', 'blocked', 'unattempted', 'not_attempted', 'rejected'].includes(statusText) &&
      !['failed', 'restricted', 'held', 'blocked', 'rejected'].includes(record.reviewState));
  }
  function officialObservationStamp(record, now = Date.now()) {
    const status = Number(record?.status);
    return ['number', 'string'].includes(typeof record?.status) && Number.isInteger(status) &&
      observationRootEligible(record) && status >= 200 && status < 300
      ? observationStamp(record.observedAt, now) : '';
  }
  function restaurantObservationStamp(restaurant, inputs = {}, now = Date.now()) {
    if (!restaurant || typeof restaurant !== 'object') return '';
    const official = inputs.officialResults ?? (restaurant.signal ? [restaurant.signal] : []);
    const firstParty = inputs.firstPartyRecords ?? (restaurant.firstPartySources ? [restaurant.firstPartySources] : []);
    const associated = record => record && record.restaurantId === restaurant.id;
    const nestedEvidence = record => observationRootEligible(record) &&
      (!Object.hasOwn(record, 'restaurantId') || associated(record));
    const stamps = [
      restaurant.sourceObservedAt,
      nestedEvidence(restaurant.reviewedPlaceResolution) ? restaurant.reviewedPlaceResolution.observedAt : '',
      nestedEvidence(restaurant.operatingStatusEvidence) ? restaurant.operatingStatusEvidence.observedAt || restaurant.operatingStatusEvidence.verifiedAt : '',
      ...(Array.isArray(restaurant.sources) ? restaurant.sources : []).filter(nestedEvidence).map(source => source.observedAt),
      ...(Array.isArray(firstParty) ? firstParty : []).filter(record => associated(record) && record.reviewState === 'verified' && observationRootEligible(record)).map(record => record.observedAt),
      ...(Array.isArray(official) ? official : []).filter(associated).map(record => officialObservationStamp(record, now))
    ].map(value => observationStamp(value, now)).filter(Boolean);
    // Import freshnessDate, generatedAt, lastVerifiedAt and attempt/assessment
    // clocks are deliberately absent. Unknown evidence stays undated.
    return stamps.sort().at(-1) || '';
  }
  function publisherDates(html, now = Date.now()) {
    const dates = [];
    const add = value => { if (publicationState(value, now).dateState === 'valid') dates.push(new Date(value).toISOString()); };
    for (const tag of String(html).matchAll(/<(?:meta|time)\b([^>]*)>/gi)) {
      const attr = Object.fromEntries([...tag[1].matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(m => [m[1].toLowerCase(), m[2]]));
      const key = attr.property || attr.name || attr.itemprop || '';
      if (/^(article:published_time|datepublished|pubdate|publishdate|publication_date)$/i.test(key)) add(attr.content || attr.datetime);
    }
    for (const block of String(html).matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const walk = value => { if (!value || typeof value !== 'object') return; if (/Article|BlogPosting|NewsArticle/i.test(String(value['@type'] || ''))) add(value.datePublished); for (const child of Object.values(value)) if (typeof child === 'object') Array.isArray(child) ? child.forEach(walk) : walk(child); };
        walk(JSON.parse(block[1]));
      } catch { /* invalid publisher metadata stays missing */ }
    }
    return [...new Set(dates)].sort().reverse();
  }
  const api = { observationStamp, officialObservationStamp, restaurantObservationStamp, heldSocialFact, pointerSafe, actionLinks, primaryActionUrl, actionAvailable, safeSource, sourceHost, publicationState, locationSafe, currentOffer, currentPost, postExpiry, publisherDates };
  root.HalifaxDataIntegrity = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
