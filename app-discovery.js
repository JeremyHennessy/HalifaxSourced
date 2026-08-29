"use strict";
function renderSpecials() {
  const items = restaurants.filter((restaurant) => restaurant.hasSpecial).sort((a, b) => (b.score || 0) - (a.score || 0));
  appView.innerHTML = `
    <section class="page-shell page-intro"><span class="eyebrow">Worth checking now</span><h1>Specials & happy-hour leads</h1><p>Direct official-source pages for happy hours, rotating features, promos, and specials — with verification links instead of fabricated prices or times.</p></section>
    <section class="page-shell specials-grid">${items.length ? items.map((restaurant, index) => specialCard(restaurant, index)).join("") : emptyPageState("No direct specials sources are currently represented in the source data.")}</section>`;
  bindCommonActions();
}

function specialCard(restaurant, index) {
  const link = restaurant.specialLinks[0];
  const curated = restaurant.specials?.[0];
  const linkLabel = String(link?.label || "").trim();
  const title = curated?.title || (/^https?:\/\//i.test(linkLabel) ? "" : linkLabel) || `${restaurant.name} specials`;
  return `<article class="special-card"><div class="special-image media-${mediaTone(restaurant)}${permittedImageClass(restaurant)}" style="--media-pos:${20 + ((index * 13) % 60)}%">${mediaImageMarkup(restaurant)}<span>${link?.verified ? "Verified source" : "Special lead"}</span></div><div><p class="special-kicker">${escapeHtml(restaurant.neighborhood || "Halifax")}</p><h2>${escapeHtml(title)}</h2><p>${escapeHtml(restaurant.name)} · ${escapeHtml(primaryCuisine(restaurant))}</p><small>${curated?.cadence ? escapeHtml(curated.cadence) : "Confirm current terms, price, and timing on the official source."}</small><div class="special-actions"><a class="button tertiary" href="#restaurant/${encodeURIComponent(restaurant.id)}">View place</a>${link ? `<a class="text-link" href="${link.url}" target="_blank" rel="noreferrer">${link.verified ? "Verified source" : "Official source"} ↗</a>` : ""}</div></div></article>`;
}

function renderMenus() {
  const items = restaurants.filter((restaurant) => restaurant.hasMenu).sort((a, b) => (b.score || 0) - (a.score || 0));
  appView.innerHTML = `
    <section class="menus-hero"><div class="page-shell"><span class="eyebrow">Browse before you choose</span><h1>Menus across Halifax</h1><p>Find restaurants with direct menu-source coverage, then open the official menu for the latest dishes and prices.</p><form class="inline-search" data-menu-search><input type="search" value="${escapeHtml(state.query)}" placeholder="Search cuisine, restaurant, or neighbourhood" aria-label="Search menus"/><button class="button primary">Search</button></form></div></section>
    <section class="page-shell section-block"><div class="section-heading"><div><h2>${items.length.toLocaleString()} places with direct menu sources</h2><p>Verified source pages are preferred; direct menu links from the official-site scan remain the fallback while verification coverage grows.</p></div></div><div class="restaurant-grid">${filteredRestaurants({ feature: "menus" }).slice(0, 60).map((r, i) => restaurantCard(r, { index: i })).join("")}</div></section>`;
  bindCommonActions();
  document.querySelector("[data-menu-search]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = event.currentTarget.querySelector("input");
    state.query = input.value.trim();
    renderMenus();
  });
}

function renderMapPage() {
  const areas = ["All neighbourhoods", "Downtown", "North End", "South End", "Waterfront", "Dartmouth", "Bedford"];
  const results = filteredRestaurants({ neighbourhood: state.neighbourhood });
  appView.innerHTML = `
    <section class="page-shell page-intro map-intro"><div><span class="eyebrow">Neighbourhood discovery</span><h1>Explore Halifax</h1><p>Browse local places by neighbourhood and move between the map and source-backed listings.</p></div><a class="button secondary" href="#explore">View as list</a></section>
    <section class="page-shell map-page">
      <div class="map-chips">${areas.map((area) => `<button type="button" data-map-area="${area === "All neighbourhoods" ? "all" : escapeHtml(area)}" class="${(area === "All neighbourhoods" && state.neighbourhood === "all") || area === state.neighbourhood ? "is-active" : ""}">${escapeHtml(area)}</button>`).join("")}</div>
      <div class="map-split"><div class="map-large" id="mainMap"></div><aside class="map-results"><div class="results-toolbar"><strong>${results.length.toLocaleString()} places</strong><label>Sort <select id="mapSort"><option value="recommended" ${state.sort === "recommended" ? "selected" : ""}>Recommended</option><option value="name" ${state.sort === "name" ? "selected" : ""}>Name</option></select></label></div><div class="local-picks"><h2>Local picks</h2>${results.slice(0, 2).map((r, i) => restaurantCard(r, { compact: true, index: i })).join("")}</div><div class="map-result-list">${results.slice(0, 18).map(mapResultRow).join("")}</div></aside></div>
    </section>`;
  bindCommonActions();
  document.querySelectorAll("[data-map-area]").forEach((button) => button.addEventListener("click", () => {
    state.neighbourhood = button.dataset.mapArea;
    renderMapPage();
  }));
  document.querySelector("#mapSort")?.addEventListener("change", (event) => { state.sort = event.target.value; renderMapPage(); });
  requestAnimationFrame(() => initMainMap(results));
}

function mapResultRow(restaurant) {
  return `<article class="map-result-row" data-map-result-id="${escapeHtml(restaurant.id)}" tabindex="0" aria-label="Focus ${escapeHtml(restaurant.name)} on map"><div class="map-thumb media-${mediaTone(restaurant)}${permittedImageClass(restaurant)}">${mediaImageMarkup(restaurant)}</div><div><strong>${escapeHtml(restaurant.name)}</strong><span>${escapeHtml(primaryCuisine(restaurant))} · ${escapeHtml(restaurant.neighborhood || "Halifax")}</span><small>${consumerTags(restaurant).slice(0, 2).map(escapeHtml).join(" · ")}</small></div><a href="#restaurant/${encodeURIComponent(restaurant.id)}">View</a><button class="row-save ${state.saved.has(restaurant.id) ? "is-saved" : ""}" data-save-id="${escapeHtml(restaurant.id)}" aria-label="Save ${escapeHtml(restaurant.name)}">${state.saved.has(restaurant.id) ? "♥" : "♡"}</button></article>`;
}
