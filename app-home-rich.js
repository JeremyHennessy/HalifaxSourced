"use strict";
const baseRenderHome = renderHome;
function halifaxDateKey(date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Halifax", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const v = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${v.year}-${v.month}-${v.day}`;
}
function halifaxWeekday(date) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Halifax", weekday: "long" }).format(date).toLowerCase();
}
function halifaxMinutes(date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Halifax", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const v = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(v.hour || 0) * 60 + Number(v.minute || 0);
}
function addDays(date, days) { return new Date(date.getTime() + days * 86400000); }
function eventStart(event) { const d = new Date(event.startAt); return Number.isNaN(d.getTime()) ? null : d; }
function richEventCard(event) {
  const start = eventStart(event); if (!start) return "";
  const link = safeUrl(event.ticketUrl) || safeUrl(event.officialUrl) || safeUrl(event.sourceUrl) || safeUrl(event.eventUrl);
  const when = start.toLocaleString("en-CA", { timeZone: "America/Halifax", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const venue = event.venueName || event.city || "Halifax";
  const inner = `<div class="event-card-body"><span class="eyebrow">${escapeHtml((event.categories || [event.category]).filter(Boolean)[0] || "Event")}</span><h3>${escapeHtml(event.title)}</h3><p>${escapeHtml(when)} · ${escapeHtml(venue)}</p>${event.free === true ? '<span class="card-tag">Free</span>' : ""}</div>`;
  return link ? `<a class="rich-event-card" href="${escapeHtml(link)}" target="_blank" rel="noreferrer">${inner}</a>` : `<div class="rich-event-card">${inner}</div>`;
}
function richSpecialCard(restaurant, special) {
  return `<article class="restaurant-card compact-card"><div class="restaurant-card-body"><span class="eyebrow">Verified special</span><h3><a href="#restaurant/${encodeURIComponent(restaurant.id)}">${escapeHtml(restaurant.name)}</a></h3><p><strong>${escapeHtml(special.title)}</strong></p><p>${escapeHtml(special.recurrence || "Check current details")}</p></div></article>`;
}
function dateLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recent";
  return date.toLocaleDateString("en-CA", { timeZone: "America/Halifax", month: "short", day: "numeric" });
}
function sourceFreshnessStamp(restaurant) {
  const firstPartyStamp = restaurant.firstPartySources?.lastVerifiedAt || restaurant.firstPartySources?.observedAt || "";
  return String(restaurant.signal?.observedAt || firstPartyStamp || restaurant.freshnessDate || "");
}
function freshSourceCard(restaurant) {
  const sourceCount = (restaurant.relatedLinks?.length || 0) + (restaurant.socialProfiles?.length || 0) + (restaurant.officialUpdates?.length || 0);
  return `<article class="fresh-data-card">
    <span class="eyebrow">${escapeHtml(dateLabel(sourceFreshnessStamp(restaurant)))}</span>
    <h3><a href="#restaurant/${encodeURIComponent(restaurant.id)}">${escapeHtml(restaurant.name)}</a></h3>
    <p>${escapeHtml(restaurant.neighborhood || "Halifax")} - ${sourceCount.toLocaleString()} official source lead${sourceCount === 1 ? "" : "s"}</p>
    <div>${consumerTags(restaurant).slice(0, 3).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
  </article>`;
}
function currentSpecialCards(limit = 4) {
  return activeRestaurants
    .flatMap((restaurant) => (restaurant.currentVerifiedSpecials || restaurant.structuredSpecials || []).map((special) => ({ restaurant, special })))
    .sort((a, b) => String(b.special.verifiedAt || b.special.observedAt || "").localeCompare(String(a.special.verifiedAt || a.special.observedAt || "")))
    .slice(0, limit)
    .map(({ restaurant, special }) => richSpecialCard(restaurant, special));
}
function recentPostCard(post) {
  const restaurant = activeRestaurants.find((item) => item.id === post.restaurantId);
  const mediaUrl = safeUrl(post.mediaUrl || post.thumbnailUrl);
  const postUrl = safeUrl(post.postUrl || post.sourceUrl);
  const title = post.title || `${post.primaryCategoryLabel || "Restaurant"} update`;
  return `<article class="recent-post-card${mediaUrl ? " has-media" : ""}">
    ${mediaUrl ? `<img src="${escapeHtml(mediaUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
    <div>
      <span class="eyebrow">${escapeHtml(post.reviewState === "approved_post" ? "Reviewed update" : (post.primaryCategoryLabel || post.platform || "Update"))}</span>
      <h3>${postUrl ? `<a href="${escapeHtml(postUrl)}" target="_blank" rel="noreferrer">${escapeHtml(title)} ↗</a>` : escapeHtml(title)}</h3>
      <p>${escapeHtml(post.restaurantName || restaurant?.name || "Halifax restaurant")} - ${escapeHtml(dateLabel(post.publishedAt || post.observedAt))}</p>
      ${post.summary ? `<small>${escapeHtml(post.summary)}</small>` : ""}
    </div>
  </article>`;
}
function approvedThumbnailRestaurants(limit = 4) {
  const payload = window.HALIFAX_THUMBNAIL_CANDIDATES || {};
  const approved = (payload.candidates || [])
    .filter((candidate) => candidate.eligibleForProduction)
    .sort((a, b) => String(b.observedAt || "").localeCompare(String(a.observedAt || "")))
    .slice(0, limit);
  return approved.map((candidate) => activeRestaurants.find((restaurant) => restaurant.id === candidate.restaurantId)).filter(Boolean);
}
function homeRichSections() {
  const now = new Date();
  const today = halifaxDateKey(now);
  const tomorrow = halifaxDateKey(addDays(now, 1));
  const events = (window.HALIFAX_CITY_EVENTS?.events || [])
    .map((event) => ({ event, start: eventStart(event) }))
    .filter((item) => item.start && item.start >= new Date(now.getTime() - 6 * 3600000))
    .sort((a, b) => a.start - b.start);
  const tonight = events
    .filter(({ start }) => { const key = halifaxDateKey(start), mins = halifaxMinutes(start); return (key === today && mins >= 17 * 60) || (key === tomorrow && mins < 3 * 60); })
    .slice(0, 3).map((item) => item.event);
  const openPlaces = activeRestaurants.filter((r) => r.currentHoursState?.state === "open").sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 3);
  const recentlySourced = activeRestaurants
    .filter((restaurant) => restaurant.firstPartySources || restaurant.signal || restaurant.officialUpdates?.length)
    .sort((a, b) => sourceFreshnessStamp(b).localeCompare(sourceFreshnessStamp(a)) || (b.score || 0) - (a.score || 0))
    .slice(0, 4);
  const specials = currentSpecialCards(4);
  const reviewedPosts = Array.isArray(window.HALIFAX_REVIEWED_SOCIAL_POSTS?.records) ? window.HALIFAX_REVIEWED_SOCIAL_POSTS.records : [];
  const sourceLeadPosts = Array.isArray(recentOfficialPosts) ? recentOfficialPosts : [];
  const posts = (reviewedPosts.length ? reviewedPosts : sourceLeadPosts)
    .slice()
    .sort((a, b) => String(b.publishedAt || b.observedAt || "").localeCompare(String(a.publishedAt || a.observedAt || "")))
    .slice(0, 4);
  const thumbnailRestaurants = approvedThumbnailRestaurants(4);
  const sections = [];
  if (tonight.length) sections.push(`<section class="page-shell section-block home-action-section"><div class="section-heading"><div><span class="eyebrow">Tonight in Halifax</span><h2>What’s happening tonight</h2></div><a href="#events">All events →</a></div><div class="event-grid">${tonight.map(richEventCard).join("")}</div></section>`);
  if (openPlaces.length) sections.push(`<section class="page-shell section-block home-action-section"><div class="section-heading"><div><span class="eyebrow">Eat tonight</span><h2>Open now with fresh official hours</h2></div><a href="#explore">Explore →</a></div><div class="restaurant-grid">${openPlaces.map((r, i) => restaurantCard(r, { index: i })).join("")}</div></section>`);
  if (recentlySourced.length) sections.push(`<section class="page-shell section-block home-action-section"><div class="section-heading"><div><span class="eyebrow">Recently sourced</span><h2>New source coverage</h2><p>Freshly indexed official websites, menus, social profiles, reservations, ordering links, and local discovery leads.</p></div><a href="#explore?sort=fresh">Explore fresh data →</a></div><div class="fresh-data-grid">${recentlySourced.map(freshSourceCard).join("")}</div></section>`);
  if (specials.length) sections.push(`<section class="page-shell section-block home-action-section"><div class="section-heading"><div><span class="eyebrow">New specials</span><h2>Current verified offers</h2><p>Structured specials and source-backed offer pages, kept separate from unreviewed social leads.</p></div><a href="#specials">All specials →</a></div><div class="restaurant-grid">${specials.join("")}</div></section>`);
  if (posts.length) sections.push(`<section class="page-shell section-block home-action-section"><div class="section-heading"><div><span class="eyebrow">Recent posts</span><h2>${reviewedPosts.length ? "Reviewed official updates" : "Latest official updates"}</h2><p>${reviewedPosts.length ? "Admin-approved post intelligence from restaurant-owned sources." : "Restaurant-owned feeds and, once Meta secrets are configured, Facebook and Instagram API observations awaiting review."}</p></div><a href="#admin/social">Review posts →</a></div><div class="recent-post-grid">${posts.map(recentPostCard).join("")}</div></section>`);
  if (thumbnailRestaurants.length) sections.push(`<section class="page-shell section-block home-action-section"><div class="section-heading"><div><span class="eyebrow">New thumbnails added</span><h2>Restaurants with approved images</h2><p>Owner-reviewed official-site thumbnails now appear on cards and detail pages with source attribution.</p></div><a href="#admin/thumbnails">Thumbnail admin →</a></div><div class="restaurant-grid">${thumbnailRestaurants.map((restaurant, index) => restaurantCard(restaurant, { index })).join("")}</div></section>`);
  return sections.join("");
}
renderHome = function renderHomeWithStructuredDiscovery() {
  baseRenderHome();
  const rich = homeRichSections();
  if (rich) {
    appView.insertAdjacentHTML("beforeend", rich);
  }
  bindCommonActions();
};
