"use strict";
function renderHome() {
  const featured = activeRestaurants.slice().sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5);
  const specialLeads = activeRestaurants.filter((restaurant) => restaurant.hasSpecial).slice(0, 4);
  const cityEventItems = homeUpcomingCityEvents().slice(0, 4);
  const openingLeads = activeRestaurants
    .filter((restaurant) => restaurant.sourceLayer === "local_discovery" || restaurant.hasOpening)
    .sort((a, b) => String(b.freshnessDate || b.signal?.observedAt || "").localeCompare(String(a.freshnessDate || a.signal?.observedAt || "")))
    .slice(0, 4);
  const neighbourhoodCards = ["Downtown", "North End", "Dartmouth", "Waterfront"];

  appView.innerHTML = `
    <section class="home-hero">
      <div class="page-shell hero-content">
        <div class="hero-copy">
          <span class="eyebrow">Halifax, Nova Scotia</span>
          <h1>Local flavour.<br />Coastal character.</h1>
          <p>Discover restaurants, menus, specials, city events, patios, new openings, and local favourites across Halifax.</p>
          <div class="hero-actions">
            <a class="button primary" href="#explore">Explore restaurants</a>
            <a class="button secondary" href="#events">What's on</a>
          </div>
          <div class="hero-proof"><span>✓</span> Source-backed local discovery</div>
        </div>
      </div>
    </section>

    <section class="category-ribbon page-shell" aria-label="Explore by category">
      <strong>Explore by category</strong>
      ${topCuisineButtons(7)}
      <button class="text-link" type="button" data-action="all-cuisines">View all →</button>
    </section>

    <section class="source-coverage-strip page-shell" aria-label="Fresh source coverage">
      <div><span>Restaurant-owned sources</span><strong>${(window.__halifaxFirstPartySourceCount || 0).toLocaleString()}</strong></div>
      <div><span>Official social profiles</span><strong>${(window.__halifaxFirstPartySocialProfileCount || 0).toLocaleString()}</strong></div>
      <div><span>Menu, booking & other links</span><strong>${(window.__halifaxFirstPartyRelatedLinkCount || 0).toLocaleString()}</strong></div>
      <a href="#explore?feature=social">Explore social-linked places →</a>
    </section>

    <section class="page-shell section-block">
      ${sectionHeader("Featured restaurants", "A curated starting point from the strongest available source coverage.", "#explore", "View all restaurants")}
      <div class="restaurant-carousel">${featured.map((restaurant, index) => restaurantCard(restaurant, { index, compact: true })).join("")}</div>
    </section>

    <section class="page-shell triptych section-block home-discovery-panel" aria-label="Latest Halifax discovery">
      <div class="panel-card">
        ${miniHeader("What's on next", "#events")}
        <div class="lead-list">${cityEventItems.length ? cityEventItems.map(cityEventLeadRow).join("") : emptyLead("City-wide event listings are refreshing.")}</div>
      </div>
      <div class="panel-card">
        ${miniHeader("Current special leads", "#specials")}
        <div class="lead-list">${specialLeads.length ? specialLeads.map(specialLeadRow).join("") : emptyLead("No special-source leads are loaded yet.")}</div>
      </div>
      <div class="panel-card">
        ${miniHeader("New & opening", "#explore?feature=opening")}
        <div class="lead-list">${openingLeads.length ? openingLeads.map(openingLeadRow).join("") : emptyLead("New-opening discovery is refreshing.")}</div>
      </div>
    </section>

    <section class="page-shell section-block neighbourhood-home-section">
      ${sectionHeader("Discover neighbourhoods", "Browse Halifax and Dartmouth by the places already mapped in the source layer.", "#map", "Open the map")}
      <div class="neighbourhood-grid">${neighbourhoodCards.map(neighbourhoodTile).join("")}</div>
    </section>

  `;
  bindCommonActions();
}

function homeUpcomingCityEvents() {
  const items = Array.isArray(window.HALIFAX_CITY_EVENTS?.events) ? window.HALIFAX_CITY_EVENTS.events : [];
  const cutoff = Date.now() - 30 * 60 * 1000;
  return items
    .filter((event) => Number.isFinite(Date.parse(event.startAt)) && Date.parse(event.endAt || event.startAt) >= cutoff)
    .sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)) || String(a.title).localeCompare(String(b.title)));
}

function topCuisineButtons(limit) {
  const liveCuisines = countValues(activeRestaurants.flatMap((restaurant) => restaurant.cuisines || []));
  return liveCuisines.slice(0, limit).map(([name]) => `<button class="category-button" type="button" data-cuisine="${escapeHtml(name)}"><span>${cuisineIcon(name)}</span>${escapeHtml(name)}</button>`).join("");
}

function cuisineIcon(name) {
  const value = name.toLowerCase();
  if (/seafood|fish|oyster/.test(value)) return "◖";
  if (/coffee|cafe|bakery/.test(value)) return "☕";
  if (/bar|beer|brew/.test(value)) return "◇";
  if (/veget|vegan/.test(value)) return "♧";
  if (/burger|fast/.test(value)) return "≋";
  if (/italian|pizza/.test(value)) return "◯";
  if (/japanese|sushi|ramen/.test(value)) return "◎";
  return "✦";
}

function sectionHeader(title, subtitle, href, linkText) {
  return `<div class="section-heading"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div><a href="${href}">${escapeHtml(linkText)} →</a></div>`;
}

function miniHeader(title, href) {
  return `<div class="mini-heading"><h2>${escapeHtml(title)}</h2><a href="${href}">View all →</a></div>`;
}

function emptyLead(text) {
  return `<p class="empty-message">${escapeHtml(text)}</p>`;
}

function restaurantCard(restaurant, options = {}) {
  const saved = state.saved.has(restaurant.id);
  const tags = consumerTags(restaurant).slice(0, 2);
  const index = options.index || 0;
  const socialProfiles = (restaurant.socialProfiles || []).filter((profile) => safeUrl(profile.url)).slice(0, 3);
  return `
    <article class="restaurant-card" data-restaurant-id="${escapeHtml(restaurant.id)}">
      <div class="card-media media-${mediaTone(restaurant)}${permittedImageClass(restaurant)}" style="--media-pos:${15 + ((index * 17) % 70)}%">
        ${mediaImageMarkup(restaurant)}
        ${restaurant.sourceLayer === "curated" ? '<span class="media-badge">Local pick</span>' : restaurant.sourceLayer === "local_discovery" ? '<span class="media-badge">New discovery</span>' : ""}
        <button class="save-button ${saved ? "is-saved" : ""}" type="button" data-save-id="${escapeHtml(restaurant.id)}" aria-label="${saved ? "Remove from saved" : "Save"} ${escapeHtml(restaurant.name)}">${saved ? "♥" : "♡"}</button>
      </div>
      <div class="card-content">
        <h3><a href="#restaurant/${encodeURIComponent(restaurant.id)}">${escapeHtml(restaurant.name)}</a></h3>
        <p class="card-meta">${escapeHtml(primaryCuisine(restaurant))} · ${escapeHtml(restaurant.neighborhood || "Halifax")}</p>
        <div class="card-tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
        ${socialProfiles.length ? `<div class="card-social" aria-label="${escapeHtml(restaurant.name)} social profiles">${socialProfiles.map((profile) => `<a href="${escapeHtml(safeUrl(profile.url))}" target="_blank" rel="noreferrer" aria-label="${escapeHtml(`${socialPlatformLabel(profile.platform)} for ${restaurant.name}`)}">${escapeHtml(socialPlatformLabel(profile.platform))}</a>`).join("")}</div>` : ""}
        <div class="card-footer"><span>${sourceLabel(restaurant)}</span><a href="#restaurant/${encodeURIComponent(restaurant.id)}">View →</a></div>
      </div>
    </article>`;
}

function primaryCuisine(restaurant) {
  return restaurant.cuisines?.[0] || restaurant.category || "Food & drink";
}

function mediaTone(restaurant) {
  const text = `${restaurant.name} ${restaurant.category || ""} ${(restaurant.cuisines || []).join(" ")}`.toLowerCase();
  if (/seafood|oyster|fish|lobster|sushi/.test(text)) return "seafood";
  if (/bar|pub|beer|brew|cocktail/.test(text)) return "bar";
  if (/cafe|coffee|bakery|dessert|ice cream/.test(text)) return "cafe";
  if (/asian|ramen|thai|japanese|korean|chinese|noodle/.test(text)) return "asian";
  return "dining";
}

function consumerTags(restaurant) {
  const tags = [];
  if (restaurant.hasOpening) tags.push("New / opening");
  if (restaurant.hasSpecial) tags.push("Specials");
  if (restaurant.hasEvent) tags.push("Events");
  if (restaurant.hasPatio) tags.push("Patio");
  if (restaurant.hasMenu) tags.push("Menu");
  if (restaurant.hasReservation) tags.push("Reservations");
  if (restaurant.hasOrdering) tags.push("Order online");
  if (restaurant.hasSocial) tags.push("Social");
  if (!tags.length) tags.push(...(restaurant.vibe || []).slice(0, 2));
  return unique(tags);
}

function sourceLabel(restaurant) {
  if (restaurant.sourceLayer === "local_discovery") return "Reviewed local discovery";
  if (restaurant.signal && restaurant.inspections.length) return "Official + public sources";
  if (restaurant.signal) return "Official site found";
  if (restaurant.inspections.length) return "Public registry match";
  if (restaurant.hasSocial) return "Official social links";
  return restaurant.sourceLayer === "openstreetmap" ? "Map listing" : "Curated source";
}

function homeEventWhen(event) {
  const date = new Date(event.startAt);
  if (Number.isNaN(date.getTime())) return "Upcoming";
  return date.toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "America/Halifax" });
}

function cityEventLeadRow(event) {
  const category = event.categories?.[0] || "Event";
  return `<article class="lead-row"><div class="date-token">${escapeHtml(homeEventWhen(event).toUpperCase())}</div><div><strong>${escapeHtml(event.title)}</strong><span>${escapeHtml(event.venueName || event.city || "Halifax")}</span><small>${escapeHtml(category)} · ${escapeHtml(event.sourceName || "Source")}</small></div><a href="#events">View</a></article>`;
}

function specialLeadRow(restaurant) {
  const link = restaurant.specialLinks[0];
  return `<article class="lead-row"><div class="date-token teal">DEAL</div><div><strong>${escapeHtml(restaurant.name)}</strong><span>${escapeHtml(restaurant.neighborhood || "Halifax")}</span><small>${link ? escapeHtml(link.label) : escapeHtml(restaurant.specials?.[0]?.title || "Special lead — confirm details")}</small></div><a href="#restaurant/${encodeURIComponent(restaurant.id)}">View</a></article>`;
}

function openingLeadRow(restaurant) {
  return `<article class="lead-row"><div class="date-token">NEW</div><div><strong>${escapeHtml(restaurant.name)}</strong><span>${escapeHtml(restaurant.neighborhood || "Halifax")}</span><small>${escapeHtml(restaurant.summary || "New or opening source signal")}</small></div><a href="#restaurant/${encodeURIComponent(restaurant.id)}">View</a></article>`;
}

function neighbourhoodTile(name, index) {
  const liveNeighbourhoods = countValues(activeRestaurants.map((restaurant) => restaurant.neighborhood || "Halifax"));
  const count = liveNeighbourhoods.find(([key]) => key === name)?.[1] || 0;
  return `<button type="button" class="neighbourhood-tile tile-${index % 4}" data-neighbourhood="${escapeHtml(name)}"><strong>${escapeHtml(name)}</strong><span>${count ? `${count} places` : "Explore"}</span></button>`;
}
