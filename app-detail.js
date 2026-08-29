"use strict";
function renderRestaurantDetail(id) {
  const restaurant = restaurants.find((item) => item.id === id || encodeURIComponent(item.id) === id);
  if (!restaurant) {
    appView.innerHTML = `<section class="page-shell page-intro">${emptyPageState("That restaurant could not be found in the current dataset.")}</section>`;
    return;
  }
  const website = safeUrl(restaurant.website);
  const menuLink = safeUrl(restaurant.menuLinks?.[0]?.url);
  const reservation = safeUrl(restaurant.reservationLinks?.[0]?.url);
  const ordering = safeUrl(restaurant.orderingLinks?.[0]?.url);
  const sourceLinks = uniqueSourceLinks(restaurant);
  const socialProfiles = (restaurant.socialProfiles || []).filter((profile) => safeUrl(profile.url));
  const linkHubs = (restaurant.linkHubs || []).filter((hub) => safeUrl(hub.url));
  const relatedLinks = (restaurant.relatedLinks || []).filter((link) => safeUrl(link.url));

  appView.innerHTML = `
    <section class="restaurant-hero media-${mediaTone(restaurant)}${permittedImageClass(restaurant)}">
      ${mediaImageMarkup(restaurant, { loading: "eager", className: "restaurant-hero-photo", alt: `${restaurant.name} restaurant` })}
      <div class="restaurant-hero-overlay page-shell"><a class="back-link" href="#explore">← Back to results</a><div class="restaurant-title"><div><div class="title-badges">${restaurant.sourceLayer === "curated" ? "<span>Local pick</span>" : ""}${restaurant.sourceLayer === "local_discovery" ? "<span>New discovery</span>" : ""}${restaurant.signal ? "<span>Official site scanned</span>" : ""}${socialProfiles.length ? `<span>${socialProfiles.length} social link${socialProfiles.length === 1 ? "" : "s"}</span>` : ""}</div><h1>${escapeHtml(restaurant.name)}</h1><p>${escapeHtml(primaryCuisine(restaurant))} · ${escapeHtml(restaurant.neighborhood || "Halifax")}</p><p class="hero-summary">${escapeHtml(restaurant.summary || "Local restaurant listing with public source coverage.")}</p><div class="card-tags">${consumerTags(restaurant).slice(0, 6).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div><div class="hero-actions">${menuLink ? `<a class="button light" href="${escapeHtml(menuLink)}" target="_blank" rel="noreferrer">View menu ↗</a>` : ""}<button class="button secondary save-detail" type="button" data-save-id="${escapeHtml(restaurant.id)}">${state.saved.has(restaurant.id) ? "♥ Saved" : "♡ Save"}</button>${website ? `<a class="button secondary" href="${escapeHtml(website)}" target="_blank" rel="noreferrer">Official site ↗</a>` : ""}</div></div></div></div>
    </section>
    <section class="page-shell detail-layout">
      <div class="detail-main">
        <nav class="detail-tabs"><a href="#detailMenu">Menu</a><a href="#detailSpecials">Specials</a><a href="#detailEvents">Events</a><a href="#detailLinks">Links</a><a href="#detailInfo">Info</a><a href="#detailSources">Sources</a></nav>
        <section id="detailMenu" class="detail-section"><div class="section-heading no-top"><div><h2>Menu sources</h2><p>Direct menu links observed from the restaurant's official source pages.</p></div></div>${restaurant.menuLinks.length ? `<div class="link-list">${restaurant.menuLinks.slice(0, 8).map(sourceLinkRow).join("")}</div>` : `<div class="info-message">No dedicated menu link is represented in the current source data.${website ? " The official website remains available in the Info panel." : ""}</div>`}</section>
        <section id="detailSpecials" class="detail-section"><div class="section-heading no-top"><div><h2>Specials</h2><p>Time-sensitive claims remain source leads until separate structured data establishes current terms, price, and timing.</p></div></div>${restaurant.specialLinks.length ? `<div class="link-list">${restaurant.specialLinks.map(sourceLinkRow).join("")}</div>` : restaurant.specials.length ? `<div class="link-list">${restaurant.specials.map((s) => `<div class="source-link-row"><span>✦</span><div><strong>${escapeHtml(s.title)}</strong><small>${escapeHtml(s.cadence || "Check current details")}</small></div></div>`).join("")}</div>` : `<div class="info-message">No current special source is represented in the loaded data.</div>`}</section>
        <section id="detailEvents" class="detail-section"><div class="section-heading no-top"><div><h2>Restaurant events</h2><p>${restaurant.structuredEvents.length ? "Structured upcoming dates from restaurant-owned sources. Times are shown in Halifax time." : "Use the official link to confirm dates, times, tickets, and availability."}</p></div></div>${restaurant.structuredEvents.length ? `<div class="link-list">${restaurant.structuredEvents.map(structuredEventDetailRow).join("")}</div>` : restaurant.eventLinks.length ? `<div class="link-list">${restaurant.eventLinks.map(sourceLinkRow).join("")}</div>` : restaurant.events.length ? `<div class="link-list">${restaurant.events.map((event) => `<div class="source-link-row"><span>◫</span><div><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.timing || "Check current details")}</small></div></div>`).join("")}</div>` : `<div class="info-message">No restaurant-specific event lead is represented in the loaded sources.</div>`}</section>
        <section id="detailLinks" class="detail-section"><div class="section-heading no-top"><div><h2>Social & related links</h2><p>Official navigation links are retained only when a restaurant-owned evidence chain supports the association. Shared brand accounts remain navigation links but are not treated as location-specific post evidence.</p></div></div>${socialProfiles.length || linkHubs.length || relatedLinks.length ? `${socialProfiles.length ? `<h3 class="detail-subheading">Official social profiles</h3><div class="link-list">${socialProfiles.map((profile) => socialProfileRow(profile, restaurant.sharedSocialProfiles || [])).join("")}</div>` : ""}${linkHubs.length ? `<h3 class="detail-subheading">Official link hubs</h3><div class="link-list">${linkHubs.map(linkHubRow).join("")}</div>` : ""}${relatedLinks.length ? `<h3 class="detail-subheading">Restaurant links</h3><div class="link-list">${relatedLinks.map(relatedLinkRow).join("")}</div>` : ""}` : `<div class="info-message">No source-backed social, link-hub, or related links have been discovered yet.</div>`}</section>
        <section id="detailSources" class="detail-section"><div class="section-heading no-top"><div><h2>Source evidence</h2><p>What Halifax Sourced has actually observed for this listing.</p></div></div><div class="source-evidence-grid"><div><strong>${restaurant.score || 0}</strong><span>source coverage score</span></div><div><strong>${restaurant.sources.length}</strong><span>listing sources</span></div><div><strong>${restaurant.inspections.length}</strong><span>public registry matches</span></div><div><strong>${socialProfiles.length}</strong><span>official social links</span></div></div><div class="link-list">${sourceLinks.length ? sourceLinks.map(sourceLinkRow).join("") : '<div class="info-message">No direct source links are available.</div>'}</div></section>
      </div>
      <aside class="detail-sidebar" id="detailInfo">
        ${infoCard("Hours", restaurant.openingHours || "Hours not available in the current source data.", "◷")}
        ${infoCard("Location", restaurant.address || restaurant.neighborhood || "Halifax", "⌖")}
        ${restaurant.phone ? infoCard("Phone", restaurant.phone, "☎") : ""}
        ${website || menuLink || reservation || ordering ? `<div class="sidebar-card"><h2>Official actions</h2>${website ? `<a class="sidebar-link" href="${escapeHtml(website)}" target="_blank" rel="noreferrer">Website ↗</a>` : ""}${menuLink ? `<a class="sidebar-link" href="${escapeHtml(menuLink)}" target="_blank" rel="noreferrer">Menu ↗</a>` : ""}${reservation ? `<a class="sidebar-link" href="${escapeHtml(reservation)}" target="_blank" rel="noreferrer">Reservations ↗</a>` : ""}${ordering ? `<a class="sidebar-link" href="${escapeHtml(ordering)}" target="_blank" rel="noreferrer">Order online ↗</a>` : ""}</div>` : ""}
        ${socialProfiles.length ? `<div class="sidebar-card"><h2>Follow</h2>${socialProfiles.slice(0, 8).map((profile) => `<a class="sidebar-link" href="${escapeHtml(safeUrl(profile.url))}" target="_blank" rel="noreferrer">${escapeHtml(socialPlatformLabel(profile.platform))}${profile.handle ? ` · @${escapeHtml(String(profile.handle).replace(/^@/, ""))}` : ""} ↗</a>`).join("")}</div>` : ""}
        ${linkHubs.length ? `<div class="sidebar-card"><h2>Official link hub</h2>${linkHubs.slice(0, 3).map((hub) => `<a class="sidebar-link" href="${escapeHtml(safeUrl(hub.url))}" target="_blank" rel="noreferrer">${escapeHtml(linkHubLabel(hub.platform))} ↗</a>`).join("")}</div>` : ""}
        ${restaurant.coordinates ? `<div class="sidebar-card"><h2>Map</h2><div id="detailMap" class="detail-map"></div><a class="sidebar-link" href="https://www.openstreetmap.org/?mlat=${restaurant.coordinates.lat}&mlon=${restaurant.coordinates.lon}#map=17/${restaurant.coordinates.lat}/${restaurant.coordinates.lon}" target="_blank" rel="noreferrer">Open map ↗</a></div>` : ""}
      </aside>
    </section>
    <div class="mobile-detail-actions">${menuLink ? `<a class="button primary" href="${escapeHtml(menuLink)}" target="_blank" rel="noreferrer">View menu</a>` : ordering ? `<a class="button primary" href="${escapeHtml(ordering)}" target="_blank" rel="noreferrer">Order online</a>` : ""}${reservation ? `<a class="button teal" href="${escapeHtml(reservation)}" target="_blank" rel="noreferrer">Book table</a>` : website ? `<a class="button teal" href="${escapeHtml(website)}" target="_blank" rel="noreferrer">Official site</a>` : ""}</div>`;
  bindCommonActions();
  if (restaurant.coordinates) requestAnimationFrame(() => initDetailMap(restaurant));
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

function infoCard(title, text, icon) {
  return `<div class="sidebar-card"><div class="sidebar-card-title"><span>${icon}</span><h2>${escapeHtml(title)}</h2></div><p>${escapeHtml(text)}</p></div>`;
}

function renderSaved() {
  const saved = restaurants.filter((restaurant) => state.saved.has(restaurant.id));
  appView.innerHTML = `<section class="page-shell page-intro"><span class="eyebrow">Your list</span><h1>Saved places</h1><p>Saved on this device. No account or cloud sync is implied.</p></section><section class="page-shell section-block"><div class="restaurant-grid">${saved.length ? saved.map((r, i) => restaurantCard(r, { index: i })).join("") : emptyPageState("You haven't saved any places yet.")}</div></section>`;
  bindCommonActions();
}

function emptyPageState(text) {
  return `<div class="empty-state wide"><span class="empty-brand-mark" aria-hidden="true"></span><h2>Nothing to show yet</h2><p>${escapeHtml(text)}</p><a class="button primary" href="#explore">Explore restaurants</a></div>`;
}
