/* Shared by static Pages and local collectors. Public references confer no media licence. */
(function (root) {
  // The purported replacement also returned a cross-entity redirect during the
  // bounded repair. Keep it out of consumer navigation until independently repaired.
  const blockedHosts = new Set(['justitalymentone.com', 'bowtiecreamery.com', 'glitterbeancafe.com']);
  function safeSource(value) {
    try { const u = new URL(value); const host = u.hostname.toLowerCase().replace(/^www\./, ''); return ['http:', 'https:'].includes(u.protocol) && ![...blockedHosts].some(h => host === h || host.endsWith('.' + h)); } catch { return false; }
  }
  function publicationState(value, now = Date.now(), maxDays = 180) {
    const stamp = Date.parse(String(value || ''));
    if (!Number.isFinite(stamp)) return { ageDays: null, isRecent: false, dateState: 'missing' };
    const age = now - stamp;
    // Even small clock skew is uncertain, never today's publication.
    if (age < 0) return { ageDays: null, isRecent: false, dateState: 'future' };
    return { ageDays: Math.floor(age / 86400000), isRecent: age <= maxDays * 86400000, dateState: 'valid' };
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
  const api = { safeSource, publicationState, locationSafe, currentOffer, publisherDates };
  root.HalifaxDataIntegrity = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
