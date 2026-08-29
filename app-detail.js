"use strict";
function renderRestaurantDetail(id) {
  const restaurant = restaurants.find((item) => item.id === id || encodeURIComponent(item.id) === id);
  if (!restaurant) {
    appView.innerHTML = `<section class="page-shell page-intro">${emptyPageState("That restaurant could not be found in the current dataset.")}</section>`;
    return;
  }
  const active = isRestaurantActive(restaurant);
  const website = active ? safeUrl(restaurant.website) : null;
  const menuLink = safeUrl(restaurant.menuLinks?.[0]?.url);
  const reservation = safeUrl(restaurant.reservationLinks?.[0]?.url);
  const ordering = safeUrl(restaurant.orderingLinks?.[0]?.url);
  const sourceLinks = uniqueSourceLinks(restaurant);
  const socialProfiles = (restaurant.socialProfiles || []).filter((profile) => safeUrl(profile.url));
  const linkHubs = (restaurant.linkHubs || []).filter((hub) => safeUrl(hub.url));
  const relatedLinks = active ? (restaurant.relatedLinks || []).filter((link) => safeUrl(link.url)) : [];
  const officialUpdates = active ? (restaurant.officialUpdates || []).filter((update) => safeUrl(update.postUrl)) : [];
  const verifiedSpecials = active ? (restaurant.currentVerifiedSpecials || []).filter((special) => special?.title) : [];
  const statusEvidenceUrl = safeUrl(restaurant.operatingStatusEvidence?.sourceUrl);
  const closureDate = restaurant.closureDate ? new Date(`${restaurant.closureDate}T12:00:00`).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" }) : null;
  const statusLabel = restaurant.operatingStatus === "permanently_closed" ? "Permanently closed" : restaurant.operatingStatus === "temporarily_closed" ? "Temporarily closed" : restaurant.operatingStatus === "moved" ? "Moved" : "Status unavailable";
  const denseMobileOverview = active && restaurant.phone && (menuLink || ordering) && (reservation || website);

  appView.innerHTML = `
    <section class="restaurant-hero media-${mediaTone(restaurant)}${permittedImageClass(restaurant)}${denseMobileOverview ? " is-dense-mobile" : ""}">
      ${mediaImageMarkup(restaurant, { loading: "eager", className: "restaurant-hero-photo", alt: `${restaurant.name} restaurant` })}
      ${mediaAttributionMarkup(restaurant)}
      <div class="restaurant-hero-overlay page-shell"><a class="back-link" href="#explore">← Back to results</a><div class="restaurant-title"><div><div class="title-badges">${active && restaurant.sourceLayer === "curated" ? "<span>Local pick</span>" : ""}${restaurant.sourceLayer === "local_discovery" ? "<span>New discovery</span>" : ""}${!active ? `<span class="status-closed">${escapeHtml(statusLabel)}</span>` : restaurant.signal ? "<span>Official site scanned</span>" : ""}${socialProfiles.length ? `<span>${socialProfiles.length} social link${socialProfiles.length === 1 ? "" : "s"}</span>` : ""}</div><h1>${escapeHtml(restaurant.name)}</h1><p>${escapeHtml(primaryCuisine(restaurant))} · ${escapeHtml(restaurant.neighborhood || "Halifax")}</p><p class="hero-summary">${escapeHtml(restaurant.summary || "Local restaurant listing with public source coverage.")}</p><div class="card-tags">${active ? consumerTags(restaurant).slice(0, 6).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("") : ""}</div><div class="hero-actions">${active ? `${menuLink ? `<a class="button light" href="${escapeHtml(menuLink)}" target="_blank" rel="noreferrer">View menu ↗</a>` : ""}<button class="button secondary save-detail" type="button" data-save-id="${escapeHtml(restaurant.id)}">${state.saved.has(restaurant.id) ? "♥ Saved" : "♡ Save"}</button>${website ? `<a class="button secondary" href="${escapeHtml(website)}" target="_blank" rel="noreferrer">Official site ↗</a>` : ""}` : statusEvidenceUrl ? `<a class="button light" href="${escapeHtml(statusEvidenceUrl)}" target="_blank" rel="noreferrer">Official closure source ↗</a>` : ""}</div></div></div></div>
    </section>
    <section class="page-shell detail-layout">
      <div class="detail-main">
        ${!active ? `<section class="closure-notice" role="status"><strong>${escapeHtml(statusLabel)}${closureDate ? ` · final service ${escapeHtml(closureDate)}` : ""}</strong><p>${escapeHtml(restaurant.operatingStatusEvidence?.claim || "This record is retained for historical source evidence and is excluded from current discovery.")}</p>${statusEvidenceUrl ? `<a href="${escapeHtml(statusEvidenceUrl)}" target="_blank" rel="noreferrer">View official status evidence ↗</a>` : ""}</section>` : ""}
        <nav class="detail-tabs"><a href="#detailOverview">Overview</a><a href="#detailMenu">Menu</a><a href="#detailSpecials">Specials</a><a href="#detailEvents">Events</a>${officialUpdates.length ? '<a href="#detailUpdates">Updates</a>' : ""}<a href="#detailLinks">Links</a><a href="#detailSources">Sources</a></nav>
        <section id="detailOverview" class="mobile-detail-overview${denseMobileOverview ? " is-dense" : ""}" aria-label="Restaurant essentials">
          <div class="mobile-essential-facts">
            <div><span>Hours</span><strong>${escapeHtml(restaurant.openingHours || "Check official source")}</strong></div>
            <div><span>Location</span><strong>${escapeHtml(restaurant.address || restaurant.neighborhood || "Halifax")}</strong></div>
            ${restaurant.phone ? `<div><span>Phone</span><strong>${escapeHtml(restaurant.phone)}</strong></div>` : ""}
          </div>
          ${active ? `<div class="mobile-essential-actions">
            ${menuLink ? `<a class="button primary" href="${escapeHtml(menuLink)}" target="_blank" rel="noreferrer">View menu ↗</a>` : ordering ? `<a class="button primary" href="${escapeHtml(ordering)}" target="_blank" rel="noreferrer">Order online ↗</a>` : ""}
            ${reservation ? `<a class="button teal" href="${escapeHtml(reservation)}" target="_blank" rel="noreferrer">Book table ↗</a>` : website ? `<a class="button teal" href="${escapeHtml(website)}" target="_blank" rel="noreferrer">Official site ↗</a>` : ""}
            <button class="button secondary save-detail" type="button" data-save-id="${escapeHtml(restaurant.id)}">${state.saved.has(restaurant.id) ? "♥ Saved" : "♡ Save"}</button>
          </div>` : ""}
        </section>
        <section id="detailMenu" class="detail-section"><div class="section-heading no-top"><div><h2>Menu sources</h2><p>Direct menu links observed from the restaurant's official source pages.</p></div></div>${restaurant.menuLinks.length ? `<div class="link-list">${restaurant.menuLinks.slice(0, 8).map(sourceLinkRow).join("")}</div>` : `<div class="info-message">No dedicated menu link is represented in the current source data.${website ? " The official website remains available in the Info panel." : ""}</div>`}</section>
        <section id="detailSpecials" class="detail-section"><div class="section-heading no-top"><div><h2>Specials</h2><p>Time-sensitive claims remain source leads until separate structured data establishes current terms, price, and timing.</p></div></div>${verifiedSpecials.length ? `<div class="link-list">${verifiedSpecials.map(structuredSpecialDetailRow).join("")}</div>` : restaurant.specialLinks.length ? `<div class="link-list">${restaurant.specialLinks.map(sourceLinkRow).join("")}</div>` : restaurant.specials.length ? `<div class="link-list">${restaurant.specials.map((s) => `<div class="source-link-row"><span>✦</span><div><strong>${escapeHtml(s.title)}</strong><small>${escapeHtml(s.cadence || "Check current details")}</small></div></div>`).join("")}</div>` : `<div class="info-message">No current special source is represented in the loaded data.</div>`}</section>
        <section id="detailEvents" class="detail-section"><div class="section-heading no-top"><div><h2>Restaurant events</h2><p>${restaurant.structuredEvents.length ? "Structured upcoming dates from restaurant-owned sources. Times are shown in Halifax time." : "Use the official link to confirm dates, times, tickets, and availability."}</p></div></div>${restaurant.structuredEvents.length ? `<div class="link-list">${restaurant.structuredEvents.map(structuredEventDetailRow).join("")}</div>` : restaurant.eventLinks.length ? `<div class="link-list">${restaurant.eventLinks.map(sourceLinkRow).join("")}</div>` : restaurant.events.length ? `<div class="link-list">${restaurant.events.map((event) => `<div class="source-link-row"><span>◫</span><div><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.timing || "Check current details")}</small></div></div>`).join("")}</div>` : `<div class="info-message">No restaurant-specific event lead is represented in the loaded sources.</div>`}</section>
        ${officialUpdates.length ? `<section id="detailUpdates" class="detail-section"><div class="section-heading no-top"><div><h2>Latest official updates</h2><p>Recent posts observed from restaurant-owned feeds or authenticated official social APIs. Open the source for the full post and current details.</p></div></div><div class="official-update-grid">${officialUpdates.slice(0, 12).map(officialUpdateCard).join("")}</div></section>` : ""}
        <section id="detailLinks" class="detail-section"><div class="section-heading no-top"><div><h2>Social & related links</h2><p>Official navigation links are retained only when a restaurant-owned evidence chain supports the association. Shared brand accounts remain navigation links but are not treated as location-specific post evidence.</p></div></div>${socialProfiles.length || linkHubs.length || relatedLinks.length ? `${socialProfiles.length ? `<h3 class="detail-subheading">Official social profiles</h3><div class="link-list">${socialProfiles.map((profile) => socialProfileRow(profile, restaurant.sharedSocialProfiles || [])).join("")}</div>` : ""}${linkHubs.length ? `<h3 class="detail-subheading">Official link hubs</h3><div class="link-list">${linkHubs.map(linkHubRow).join("")}</div>` : ""}${relatedLinks.length ? `<h3 class="detail-subheading">Restaurant links</h3><div class="link-list">${relatedLinks.map(relatedLinkRow).join("")}</div>` : ""}` : `<div class="info-message">No source-backed social, link-hub, or related links have been discovered yet.</div>`}</section>
        <section id="detailSources" class="detail-section"><div class="section-heading no-top"><div><h2>Source evidence</h2><p>What Halifax Sourced has actually observed for this listing.</p></div></div><div class="source-evidence-grid"><div><strong>${restaurant.score || 0}</strong><span>source coverage score</span></div><div><strong>${restaurant.sources.length}</strong><span>listing sources</span></div><div><strong>${restaurant.inspections.length}</strong><span>public registry matches</span></div><div><strong>${socialProfiles.length}</strong><span>official social links</span></div></div><div class="link-list">${sourceLinks.length ? sourceLinks.map(sourceLinkRow).join("") : '<div class="info-message">No direct source links are available.</div>'}</div></section>
      </div>
      <aside class="detail-sidebar" id="detailInfo">
        ${infoCard(active ? "Hours" : "Operating status", active ? (restaurant.openingHours || "Hours not available in the current source data.") : `${statusLabel}${closureDate ? ` · final service ${closureDate}` : ""}`, "◷")}
        ${infoCard("Location", restaurant.address || restaurant.neighborhood || "Halifax", "⌖")}
        ${restaurant.phone ? infoCard("Phone", restaurant.phone, "☎") : ""}
        ${website || menuLink || reservation || ordering ? `<div class="sidebar-card detail-official-actions"><h2>Official actions</h2>${website ? `<a class="sidebar-link" href="${escapeHtml(website)}" target="_blank" rel="noreferrer">Website ↗</a>` : ""}${menuLink ? `<a class="sidebar-link" href="${escapeHtml(menuLink)}" target="_blank" rel="noreferrer">Menu ↗</a>` : ""}${reservation ? `<a class="sidebar-link" href="${escapeHtml(reservation)}" target="_blank" rel="noreferrer">Reservations ↗</a>` : ""}${ordering ? `<a class="sidebar-link" href="${escapeHtml(ordering)}" target="_blank" rel="noreferrer">Order online ↗</a>` : ""}</div>` : ""}
        ${socialProfiles.length ? `<div class="sidebar-card detail-follow-card"><h2>Follow</h2>${socialProfiles.slice(0, 8).map((profile) => `<a class="sidebar-link" href="${escapeHtml(safeUrl(profile.url))}" target="_blank" rel="noreferrer">${escapeHtml(socialPlatformLabel(profile.platform))}${profile.handle ? ` · @${escapeHtml(String(profile.handle).replace(/^@/, ""))}` : ""} ↗</a>`).join("")}</div>` : ""}
        ${linkHubs.length ? `<div class="sidebar-card"><h2>Official link hub</h2>${linkHubs.slice(0, 3).map((hub) => `<a class="sidebar-link" href="${escapeHtml(safeUrl(hub.url))}" target="_blank" rel="noreferrer">${escapeHtml(linkHubLabel(hub.platform))} ↗</a>`).join("")}</div>` : ""}
        ${restaurant.coordinates ? `<div class="sidebar-card"><h2>Map</h2><div id="detailMap" class="detail-map"></div><a class="sidebar-link" href="https://www.openstreetmap.org/?mlat=${restaurant.coordinates.lat}&mlon=${restaurant.coordinates.lon}#map=17/${restaurant.coordinates.lat}/${restaurant.coordinates.lon}" target="_blank" rel="noreferrer">Open map ↗</a></div>` : ""}
      </aside>
    </section>`;
  bindCommonActions();
  if (restaurant.coordinates) requestAnimationFrame(() => initDetailMap(restaurant));
}

function structuredSpecialDetailRow(special) {
  const source = safeUrl(special.sourceUrl);
  const price = Number.isFinite(special.price) ? `${special.currency || "CAD"} $${Number(special.price).toFixed(2).replace(/\.00$/, "")}` : null;
  const timing = [special.recurrence, price].filter(Boolean).join(" · ") || "Check the official source for current timing.";
  const body = `<span>✦</span><div><strong>${escapeHtml(special.title)}</strong><small>${escapeHtml(timing)}</small></div>`;
  return source ? `<a class="source-link-row" href="${escapeHtml(source)}" target="_blank" rel="noreferrer">${body}</a>` : `<div class="source-link-row">${body}</div>`;
}

function structuredEventDetailRow(event) {
  const source = safeUrl(event.eventUrl) || safeUrl(event.sourceUrl);
  const start = new Date(event.startAt);
  const when = Number.isNaN(start.getTime()) ? "Date unavailable" : start.toLocaleString("en-CA", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Halifax", timeZoneName: "short" });
  const body = `<span>◫</span><div><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(when)} · ${escapeHtml(event.venueName || "Official venue")}</small></div>`;
  return source ? `<a class="source-link-row" href="${escapeHtml(source)}" target="_blank" rel="noreferrer">${body}</a>` : `<div class="source-link-row">${body}</div>`;
}

function socialPlatformLabel(platform) {
  const labels = { instagram: "Instagram", facebook: "Facebook", x: "X", tiktok: "TikTok", youtube: "YouTube", linkedin: "LinkedIn", threads: "Threads", bluesky: "Bluesky", pinterest: "Pinterest", snapchat: "Snapchat" };
  return labels[String(platform || "").toLowerCase()] || String(platform || "Social");
}

function linkHubLabel(platform) {
  const labels = { linktree: "Linktree", beacons: "Beacons", linkinbio: "Linkin.bio", campsite: "Campsite", bento: "Bento" };
  return labels[String(platform || "").toLowerCase()] || "Link hub";
}

function associationBasisLabel(basis) {
  const labels = {
    linked_from_official_website: "linked from official site",
    linked_from_official_location_page: "linked from official location page",
    jsonld_sameAs: "declared by official-site structured data",
    linked_from_official_link_hub: "linked through official link hub",
    linked_from_verified_social_profile: "cross-linked by verified social profile",
    trusted_directory_explicit_link: "explicit trusted-directory link",
    openstreetmap_contact_tag: "listed in OpenStreetMap contact data",
    verified_search_match: "verified search match",
    manual_review: "manually reviewed",
    shared_brand_profile: "shared brand profile"
  };
  return labels[basis] || "source-backed association";
}

function socialProfileRow(profile, sharedProfiles = []) {
  const url = safeUrl(profile.url);
  if (!url) return "";
  const shared = sharedProfiles.some((item) => String(item.platform).toLowerCase() === String(profile.platform).toLowerCase() && String(item.handle).toLowerCase() === String(profile.handle).toLowerCase());
  const handle = profile.handle ? `@${String(profile.handle).replace(/^@/, "")}` : new URL(url).hostname.replace(/^www\./, "");
  const evidence = shared ? "shared brand profile" : associationBasisLabel(profile.associationBasis);
  return `<a class="source-link-row" href="${escapeHtml(url)}" target="_blank" rel="noreferrer"><span>↗</span><div><strong>${escapeHtml(socialPlatformLabel(profile.platform))}</strong><small>${escapeHtml(handle)} · ${escapeHtml(evidence)}</small></div></a>`;
}

function linkHubRow(hub) {
  const url = safeUrl(hub.url);
  if (!url) return "";
  return `<a class="source-link-row" href="${escapeHtml(url)}" target="_blank" rel="noreferrer"><span>↗</span><div><strong>${escapeHtml(linkHubLabel(hub.platform))}</strong><small>${escapeHtml(associationBasisLabel(hub.associationBasis))}</small></div></a>`;
}

function relatedLinkRow(link) {
  const url = safeUrl(link.url);
  if (!url) return "";
  const kindLabels = { menu: "Menu", reservations: "Reservations", events: "Events", ordering: "Order online", newsletter: "Newsletter", tickets: "Tickets" };
  const kind = kindLabels[link.kind] || link.kind || "Official link";
  return `<a class="source-link-row" href="${escapeHtml(url)}" target="_blank" rel="noreferrer"><span>↗</span><div><strong>${escapeHtml(link.label || kind)}</strong><small>${escapeHtml(kind)} · ${escapeHtml(new URL(url).hostname.replace(/^www\./, ""))}</small></div></a>`;
}

function uniqueSourceLinks(restaurant) {
  const links = [];
  for (const source of restaurant.sources || []) {
    const url = safeUrl(source.url);
    if (url) links.push({ label: source.label || source.type || "Source", url });
  }
  if (restaurant.signal?.website) links.push({ label: "Official website", url: safeUrl(restaurant.signal.website) });
  return links.filter((link) => link.url && links.findIndex((item) => item.url === link.url) === links.indexOf(link)).slice(0, 24);
}

function sourceLinkRow(link) {
  const url = safeUrl(link.url);
  if (!url) return "";
  const sourceNote = link.verified ? " · verified direct source" : link.verifiedLink ? " · official-site link" : "";
  return `<a class="source-link-row" href="${escapeHtml(url)}" target="_blank" rel="noreferrer"><span>↗</span><div><strong>${escapeHtml(link.label || "Official source")}</strong><small>${escapeHtml(new URL(url).hostname.replace(/^www\./, ""))}${escapeHtml(sourceNote)}</small></div></a>`;
}

function officialUpdateCard(update) {
  const url = safeUrl(update.postUrl);
  if (!url) return "";
  const published = new Date(update.publishedAt);
  const date = Number.isNaN(published.getTime()) ? "Date unavailable" : published.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Halifax" });
  const platform = update.platform === "website_feed" ? "Official website" : socialPlatformLabel(update.platform);
  const mediaUrl = safeUrl(update.mediaUrl || update.thumbnailUrl);
  const media = mediaUrl ? `<img class="official-update-media" src="${escapeHtml(mediaUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">` : "";
  return `<a class="official-update-card${mediaUrl ? " has-media" : ""}" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${media}<span>${escapeHtml(platform)}</span><strong>${escapeHtml(update.title || `${platform} update`)}</strong><small>${escapeHtml(date)} · Open original ↗</small></a>`;
}

function infoCard(title, text, icon) {
  const slug = String(title || "info").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `<div class="sidebar-card detail-info-card detail-info-${escapeHtml(slug)}"><div class="sidebar-card-title"><span>${icon}</span><h2>${escapeHtml(title)}</h2></div><p>${escapeHtml(text)}</p></div>`;
}

function renderSaved() {
  const saved = restaurants.filter((restaurant) => state.saved.has(restaurant.id));
  appView.innerHTML = `<section class="page-shell page-intro"><span class="eyebrow">Your list</span><h1>Saved places</h1><p>Saved on this device. No account or cloud sync is implied.</p></section><section class="page-shell section-block"><div class="restaurant-grid">${saved.length ? saved.map((r, i) => restaurantCard(r, { index: i })).join("") : emptyPageState("You haven't saved any places yet.")}</div></section>`;
  bindCommonActions();
}

function emptyPageState(text) {
  return `<div class="empty-state wide"><span class="empty-brand-mark" aria-hidden="true"></span><h2>Nothing to show yet</h2><p>${escapeHtml(text)}</p><a class="button primary" href="#explore">Explore restaurants</a></div>`;
}
