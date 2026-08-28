"use strict";
function renderRestaurantDetail(id) {
  const restaurant = restaurants.find((item) => item.id === id || encodeURIComponent(item.id) === id);
  if (!restaurant) {
    appView.innerHTML = `<section class="page-shell page-intro">${emptyPageState("That restaurant could not be found in the current dataset.")}</section>`;
    return;
  }
  const website = safeUrl(restaurant.website);
  const menuLink = restaurant.menuLinks[0]?.url || null;
  const reservation = restaurant.reservationLinks[0]?.url;
  const sourceLinks = uniqueSourceLinks(restaurant);

  appView.innerHTML = `
    <section class="restaurant-hero media-${mediaTone(restaurant)}${permittedImageClass(restaurant)}">
      ${mediaImageMarkup(restaurant, { loading: "eager", className: "restaurant-hero-photo", alt: `${restaurant.name} restaurant` })}
      <div class="restaurant-hero-overlay page-shell"><a class="back-link" href="#explore">← Back to results</a><div class="restaurant-title"><div><div class="title-badges">${restaurant.sourceLayer === "curated" ? "<span>Local pick</span>" : ""}${restaurant.signal ? "<span>Official site scanned</span>" : ""}</div><h1>${escapeHtml(restaurant.name)}</h1><p>${escapeHtml(primaryCuisine(restaurant))} · ${escapeHtml(restaurant.neighborhood || "Halifax")}</p><p class="hero-summary">${escapeHtml(restaurant.summary || "Local restaurant listing with public source coverage.")}</p><div class="card-tags">${consumerTags(restaurant).slice(0, 5).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div><div class="hero-actions">${menuLink ? `<a class="button light" href="${menuLink}" target="_blank" rel="noreferrer">View menu ↗</a>` : ""}<button class="button secondary save-detail" type="button" data-save-id="${escapeHtml(restaurant.id)}">${state.saved.has(restaurant.id) ? "♥ Saved" : "♡ Save"}</button>${website ? `<a class="button secondary" href="${website}" target="_blank" rel="noreferrer">Official site ↗</a>` : ""}</div></div></div></div>
    </section>
    <section class="page-shell detail-layout">
      <div class="detail-main">
        <nav class="detail-tabs"><a href="#detailMenu">Menu</a><a href="#detailSpecials">Specials</a><a href="#detailEvents">Events</a><a href="#detailInfo">Info</a><a href="#detailSources">Sources</a></nav>
        <section id="detailMenu" class="detail-section"><div class="section-heading no-top"><div><h2>Menu sources</h2><p>Direct menu links observed from the restaurant's official source pages.</p></div></div>${restaurant.menuLinks.length ? `<div class="link-list">${restaurant.menuLinks.slice(0, 8).map(sourceLinkRow).join("")}</div>` : `<div class="info-message">No dedicated menu link is represented in the current source data.${website ? " The official website remains available in the Info panel." : ""}</div>`}</section>
        <section id="detailSpecials" class="detail-section"><div class="section-heading no-top"><div><h2>Specials</h2><p>Time-sensitive claims remain source leads until separate structured data establishes current terms, price, and timing.</p></div></div>${restaurant.specialLinks.length ? `<div class="link-list">${restaurant.specialLinks.map(sourceLinkRow).join("")}</div>` : restaurant.specials.length ? `<div class="link-list">${restaurant.specials.map((s) => `<div class="source-link-row"><span>✦</span><div><strong>${escapeHtml(s.title)}</strong><small>${escapeHtml(s.cadence || "Check current details")}</small></div></div>`).join("")}</div>` : `<div class="info-message">No current special source is represented in the loaded data.</div>`}</section>
        <section id="detailEvents" class="detail-section"><div class="section-heading no-top"><div><h2>Events</h2><p>${restaurant.structuredEvents.length ? "Structured upcoming dates from restaurant-owned sources. Times are shown in Halifax time." : "Use the official link to confirm dates, times, tickets, and availability."}</p></div></div>${restaurant.structuredEvents.length ? `<div class="link-list">${restaurant.structuredEvents.map(structuredEventDetailRow).join("")}</div>` : restaurant.eventLinks.length ? `<div class="link-list">${restaurant.eventLinks.map(sourceLinkRow).join("")}</div>` : restaurant.events.length ? `<div class="link-list">${restaurant.events.map((event) => `<div class="source-link-row"><span>◫</span><div><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.timing || "Check current details")}</small></div></div>`).join("")}</div>` : `<div class="info-message">No event lead is represented in the loaded sources.</div>`}</section>
        <section id="detailSources" class="detail-section"><div class="section-heading no-top"><div><h2>Source evidence</h2><p>What Halifax Sourced has actually observed for this listing.</p></div></div><div class="source-evidence-grid"><div><strong>${restaurant.score || 0}</strong><span>source coverage score</span></div><div><strong>${restaurant.sources.length}</strong><span>listing sources</span></div><div><strong>${restaurant.inspections.length}</strong><span>public registry matches</span></div><div><strong>${restaurant.signal ? "Yes" : "No"}</strong><span>official site scan</span></div></div><div class="link-list">${sourceLinks.length ? sourceLinks.map(sourceLinkRow).join("") : '<div class="info-message">No direct source links are available.</div>'}</div></section>
      </div>
      <aside class="detail-sidebar" id="detailInfo">
        ${infoCard("Hours", restaurant.openingHours || "Hours not available in the current source data.", "◷")}
        ${infoCard("Location", restaurant.address || restaurant.neighborhood || "Halifax", "⌖")}
        ${restaurant.phone ? infoCard("Phone", restaurant.phone, "☎") : ""}
        ${website ? `<div class="sidebar-card"><h2>Official links</h2><a class="sidebar-link" href="${website}" target="_blank" rel="noreferrer">Website ↗</a>${menuLink ? `<a class="sidebar-link" href="${menuLink}" target="_blank" rel="noreferrer">Menu ↗</a>` : ""}${reservation ? `<a class="sidebar-link" href="${reservation}" target="_blank" rel="noreferrer">Reservations ↗</a>` : ""}</div>` : ""}
        ${restaurant.coordinates ? `<div class="sidebar-card"><h2>Map</h2><div id="detailMap" class="detail-map"></div><a class="sidebar-link" href="https://www.openstreetmap.org/?mlat=${restaurant.coordinates.lat}&mlon=${restaurant.coordinates.lon}#map=17/${restaurant.coordinates.lat}/${restaurant.coordinates.lon}" target="_blank" rel="noreferrer">Open map ↗</a></div>` : ""}
      </aside>
    </section>
    <div class="mobile-detail-actions">${menuLink ? `<a class="button primary" href="${menuLink}" target="_blank" rel="noreferrer">View menu</a>` : ""}${reservation ? `<a class="button teal" href="${reservation}" target="_blank" rel="noreferrer">Book table</a>` : website ? `<a class="button teal" href="${website}" target="_blank" rel="noreferrer">Official site</a>` : ""}</div>`;
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

function uniqueSourceLinks(restaurant) {
  const links = [];
  for (const source of restaurant.sources || []) {
    const url = safeUrl(source.url);
    if (url) links.push({ label: source.label || source.type || "Source", url });
  }
  if (restaurant.signal?.website) links.push({ label: "Official website", url: safeUrl(restaurant.signal.website) });
  return links.filter((link) => link.url && links.findIndex((item) => item.url === link.url) === links.indexOf(link)).slice(0, 12);
}

function sourceLinkRow(link) {
  const sourceNote = link.verified ? " · verified direct source" : "";
  return `<a class="source-link-row" href="${link.url}" target="_blank" rel="noreferrer"><span>↗</span><div><strong>${escapeHtml(link.label || "Official source")}</strong><small>${escapeHtml(new URL(link.url).hostname.replace(/^www\./, ""))}${escapeHtml(sourceNote)}</small></div></a>`;
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
