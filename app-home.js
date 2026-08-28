"use strict";
function renderHome() {
  const featured = restaurants.slice().sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5);
  const specialLeads = restaurants.filter((restaurant) => restaurant.hasSpecial).slice(0, 4);
  const eventLeads = restaurants.filter((restaurant) => restaurant.hasEvent).slice(0, 4);
  const neighbourhoodCards = ["Downtown", "North End", "Dartmouth", "Waterfront"];

  appView.innerHTML = `
    <section class="home-hero">
      <div class="page-shell hero-content">
        <div class="hero-copy">
          <span class="eyebrow">Halifax, Nova Scotia</span>
          <h1>Local flavour.<br />Coastal character.</h1>
          <p>Discover restaurants, menus, specials, events, patios, and local favourites across Halifax.</p>
          <div class="hero-actions">
            <a class="button primary" href="#explore">Explore restaurants</a>
            <a class="button secondary" href="#events">View events</a>
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

    <section class="page-shell section-block">
      ${sectionHeader("Featured restaurants", "A curated starting point from the strongest available source coverage.", "#explore", "View all restaurants")}
      <div class="restaurant-carousel">${featured.map((restaurant, index) => restaurantCard(restaurant, { index, compact: true })).join("")}</div>
    </section>

    <section class="page-shell triptych section-block">
      <div class="panel-card">
        ${miniHeader("Events to check", "#events")}
        <div class="lead-list">${eventLeads.length ? eventLeads.map(eventLeadRow).join("") : emptyLead("No event-source leads are loaded yet.")}</div>
      </div>
      <div class="panel-card">
        ${miniHeader("Current special leads", "#specials")}
        <div class="lead-list">${specialLeads.length ? specialLeads.map(specialLeadRow).join("") : emptyLead("No special-source leads are loaded yet.")}</div>
      </div>
      <div class="panel-card neighbourhood-panel">
        ${miniHeader("Discover neighbourhoods", "#map")}
        <div class="neighbourhood-grid">${neighbourhoodCards.map(neighbourhoodTile).join("")}</div>
      </div>
    </section>

    <section class="newsletter page-shell">
      <div>
        <span class="newsletter-icon" aria-hidden="true">✉</span>
        <div><h2>Get the best of Halifax, delivered</h2><p>Newsletter signup is a visual prototype until an email service is connected.</p></div>
      </div>
      <form data-newsletter-form><input type="email" placeholder="Enter your email address" aria-label="Email address" required /><button class="button primary" type="submit">Subscribe</button></form>
    </section>
  `;
  bindCommonActions();
}

function topCuisineButtons(limit) {
  return cuisines.slice(0, limit).map(([name]) => `<button class="category-button" type="button" data-cuisine="${escapeHtml(name)}"><span>${cuisineIcon(name)}</span>${escapeHtml(name)}</button>`).join("");
}

function cuisineIcon(name) {
  const value = name.toLowerCase();
  if (/seafood|fish|oyster/.test(value)) return "◖";
  if (/coffee|cafe|bakery/.test(value)) return "☕";
  if (/bar|beer|brew/.test(value)) return "◇";
  if (/veget|vegan/.test(value)) return "♧";
  if (/burger|fast/.test(value)) return "≋";
  if (/italian|pizza/.test(value)) return "◯";
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
  return `
    <article class="restaurant-card" data-restaurant-id="${escapeHtml(restaurant.id)}">
      <div class="card-media media-${mediaTone(restaurant)}${permittedImageClass(restaurant)}" style="--media-pos:${15 + ((index * 17) % 70)}%">
        ${mediaImageMarkup(restaurant)}
        ${restaurant.sourceLayer === "curated" ? '<span class="media-badge">Local pick</span>' : ""}
        <button class="save-button ${saved ? "is-saved" : ""}" type="button" data-save-id="${escapeHtml(restaurant.id)}" aria-label="${saved ? "Remove from saved" : "Save"} ${escapeHtml(restaurant.name)}">${saved ? "♥" : "♡"}</button>
      </div>
      <div class="card-content">
        <h3><a href="#restaurant/${encodeURIComponent(restaurant.id)}">${escapeHtml(restaurant.name)}</a></h3>
        <p class="card-meta">${escapeHtml(primaryCuisine(restaurant))} · ${escapeHtml(restaurant.neighborhood || "Halifax")}</p>
        <div class="card-tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
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
  if (restaurant.hasSpecial) tags.push("Specials");
  if (restaurant.hasEvent) tags.push("Events");
  if (restaurant.hasPatio) tags.push("Patio");
  if (restaurant.hasMenu) tags.push("Menu");
  if (restaurant.hasOpening) tags.push("New / opening signal");
  if (!tags.length) tags.push(...(restaurant.vibe || []).slice(0, 2));
  return unique(tags);
}

function sourceLabel(restaurant) {
  if (restaurant.signal && restaurant.inspections.length) return "Official + public sources";
  if (restaurant.signal) return "Official site found";
  if (restaurant.inspections.length) return "Public registry match";
  return restaurant.sourceLayer === "openstreetmap" ? "Map listing" : "Curated source";
}

function eventLeadRow(restaurant) {
  const link = restaurant.eventLinks[0];
  return `<article class="lead-row"><div class="date-token">EVENT</div><div><strong>${escapeHtml(restaurant.name)}</strong><span>${escapeHtml(restaurant.neighborhood || "Halifax")}</span><small>${link ? escapeHtml(link.label) : "Event lead — check official channels"}</small></div><a href="#restaurant/${encodeURIComponent(restaurant.id)}">View</a></article>`;
}

function specialLeadRow(restaurant) {
  const link = restaurant.specialLinks[0];
  return `<article class="lead-row"><div class="date-token teal">DEAL</div><div><strong>${escapeHtml(restaurant.name)}</strong><span>${escapeHtml(restaurant.neighborhood || "Halifax")}</span><small>${link ? escapeHtml(link.label) : escapeHtml(restaurant.specials?.[0]?.title || "Special lead — confirm details")}</small></div><a href="#restaurant/${encodeURIComponent(restaurant.id)}">View</a></article>`;
}

function neighbourhoodTile(name, index) {
  const count = neighbourhoods.find(([key]) => key === name)?.[1] || 0;
  return `<button type="button" class="neighbourhood-tile tile-${index % 4}" data-neighbourhood="${escapeHtml(name)}"><strong>${escapeHtml(name)}</strong><span>${count ? `${count} places` : "Explore"}</span></button>`;
}
