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
  "stardustbar.ca/reservations"
]);
  function sourceHost(value) {
    try { return new URL(value).hostname.toLowerCase().replace(/\.+$/, '').replace(/^www\./, ''); } catch { return ''; }
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
  function currentPost(item, now = Date.now(), maxDays = 60) {
    if (!locationSafe(item) || !safeSource(item.postUrl || item.sourceUrl)) return false;
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
  const api = { safeSource, sourceHost, publicationState, locationSafe, currentOffer, currentPost, postExpiry, publisherDates };
  root.HalifaxDataIntegrity = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
