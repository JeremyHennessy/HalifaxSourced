"use strict";
const SPECIALS_PAGE_SIZE = 12;
const MENUS_PAGE_SIZE = 18;
const specialsUiState = { query: "", neighbourhood: "all", kind: "all", page: 1 };
const menusUiState = { query: "", neighbourhood: "all", sort: "recommended", page: 1 };
let mapUiMode = "map";

function placeMatchesDiscoverySearch(restaurant, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return true;
  return [restaurant.name, restaurant.neighborhood, restaurant.category, ...(restaurant.cuisines || [])].filter(Boolean).join(" ").toLowerCase().includes(needle);
}

function discoveryNeighbourhoodOptions(items) {
  return [...new Set(items.map((restaurant) => restaurant.neighborhood || "Halifax"))].sort((a, b) => a.localeCompare(b));
}

function isVerifiedSpecialRestaurant(restaurant) {
  return Boolean((restaurant.currentVerifiedSpecials || []).length || (restaurant.specialLinks || []).some((link) => link.verified));
}

function renderSpecials() {
  const allItems = activeRestaurants.filter((restaurant) => restaurant.hasSpecial).sort((a, b) => (b.score || 0) - (a.score || 0));
  const filtered = allItems.filter((restaurant) => {
    if (!placeMatchesDiscoverySearch(restaurant, specialsUiState.query)) return false;
    if (specialsUiState.neighbourhood !== "all" && (restaurant.neighborhood || "Halifax") !== specialsUiState.neighbourhood) return false;
    if (specialsUiState.kind === "verified" && !isVerifiedSpecialRestaurant(restaurant)) return false;
    if (specialsUiState.kind === "leads" && isVerifiedSpecialRestaurant(restaurant)) return false;
    return true;
  });
  const verified = filtered.filter(isVerifiedSpecialRestaurant);
  const leads = filtered.filter((restaurant) => !isVerifiedSpecialRestaurant(restaurant));
  const groupedPageSize = Math.floor(SPECIALS_PAGE_SIZE / 2);
  const verifiedLimit = specialsUiState.kind === "leads" ? 0 : specialsUiState.kind === "verified" ? specialsUiState.page * SPECIALS_PAGE_SIZE : specialsUiState.page * groupedPageSize;
  const leadLimit = specialsUiState.kind === "verified" ? 0 : specialsUiState.kind === "leads" ? specialsUiState.page * SPECIALS_PAGE_SIZE : specialsUiState.page * groupedPageSize;
  const visibleVerified = verified.slice(0, verifiedLimit);
  const visibleLeads = leads.slice(0, leadLimit);
  const visibleCount = visibleVerified.length + visibleLeads.length;
  const activeCount = [specialsUiState.query, specialsUiState.neighbourhood !== "all", specialsUiState.kind !== "all"].filter(Boolean).length;
  appView.innerHTML = `
    <section class="page-shell page-intro"><span class="eyebrow">Worth checking now</span><h1>Specials & happy-hour leads</h1><p>Direct official-source pages for happy hours, rotating features, promos, and specials — with verification links instead of fabricated prices or times.</p></section>
    <section class="page-shell discovery-control-panel specials-control-panel" aria-label="Filter specials">
      <form data-specials-filter-form><label><span>Search</span><input id="specialsSearch" type="search" value="${escapeHtml(specialsUiState.query)}" placeholder="Restaurant, cuisine, or neighbourhood" /></label><label><span>Area</span><select id="specialsNeighbourhood"><option value="all">All areas</option>${discoveryNeighbourhoodOptions(allItems).map((name) => `<option value="${escapeHtml(name)}" ${specialsUiState.neighbourhood === name ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}</select></label><label><span>Evidence</span><select id="specialsKind"><option value="all">Verified offers and leads</option><option value="verified" ${specialsUiState.kind === "verified" ? "selected" : ""}>Verified offers</option><option value="leads" ${specialsUiState.kind === "leads" ? "selected" : ""}>Official-source leads</option></select></label><button class="button primary" type="submit">Apply</button>${activeCount ? `<button class="button tertiary" type="button" data-specials-clear>Clear</button>` : ""}</form>
      <p><strong>${filtered.length.toLocaleString()} results</strong> · ${verified.length.toLocaleString()} verified offers · ${leads.length.toLocaleString()} official-source leads</p>
    </section>
    <section class="page-shell specials-results">
      ${visibleVerified.length ? `<div class="discovery-section-heading"><div><span class="eyebrow">Verified offers</span><h2>Current structured specials</h2></div><p>Terms and timing are represented in reviewed structured data. Confirm before visiting.</p></div><div class="specials-grid">${visibleVerified.map((restaurant, index) => specialCard(restaurant, index, true)).join("")}</div>` : ""}
      ${visibleLeads.length ? `<div class="discovery-section-heading"><div><span class="eyebrow">Official-source leads</span><h2>Worth checking on the official page</h2></div><p>These pages mention specials or promotions but do not yet provide a separately verified current offer.</p></div><div class="specials-grid">${visibleLeads.map((restaurant, index) => specialCard(restaurant, visibleVerified.length + index, false)).join("")}</div>` : ""}
      ${filtered.length ? "" : emptyPageState("No specials match the current filters.")}
      ${visibleCount < filtered.length ? `<div class="discovery-load-more"><button class="button secondary" type="button" data-specials-more>Load ${Math.min(SPECIALS_PAGE_SIZE, filtered.length - visibleCount)} more</button><span>${filtered.length - visibleCount} remaining</span></div>` : ""}
    </section>`;
  document.querySelector("[data-specials-filter-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    specialsUiState.query = document.querySelector("#specialsSearch")?.value.trim() || "";
    specialsUiState.neighbourhood = document.querySelector("#specialsNeighbourhood")?.value || "all";
    specialsUiState.kind = document.querySelector("#specialsKind")?.value || "all";
    specialsUiState.page = 1;
    renderSpecials();
  });
  document.querySelector("[data-specials-clear]")?.addEventListener("click", () => { Object.assign(specialsUiState, { query: "", neighbourhood: "all", kind: "all", page: 1 }); renderSpecials(); });
  document.querySelector("[data-specials-more]")?.addEventListener("click", () => { specialsUiState.page += 1; renderSpecials(); });
  bindCommonActions();
}

function specialCard(restaurant, index, verified = isVerifiedSpecialRestaurant(restaurant)) {
  const link = restaurant.specialLinks[0];
  const curated = restaurant.currentVerifiedSpecials?.[0] || restaurant.specials?.[0];
  const linkLabel = String(link?.label || "").trim();
  const title = curated?.title || (/^https?:\/\//i.test(linkLabel) ? "" : linkLabel) || `${restaurant.name} specials`;
  return `<article class="special-card ${verified ? "is-verified" : "is-lead"}"><div class="special-image media-${mediaTone(restaurant)}${permittedImageClass(restaurant)}" style="--media-pos:${20 + ((index * 13) % 60)}%">${mediaImageMarkup(restaurant)}<span>${verified ? "Verified offer" : "Source lead"}</span></div><div><p class="special-kicker">${escapeHtml(restaurant.neighborhood || "Halifax")}</p><h2>${escapeHtml(title)}</h2><p>${escapeHtml(restaurant.name)} · ${escapeHtml(primaryCuisine(restaurant))}</p><small>${curated?.recurrence ? escapeHtml(curated.recurrence) : curated?.cadence ? escapeHtml(curated.cadence) : "Confirm current terms, price, and timing on the official source."}</small><div class="special-actions"><a class="button tertiary" href="#restaurant/${encodeURIComponent(restaurant.id)}">View place</a>${link ? `<a class="text-link" href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer">Official source ↗</a>` : ""}</div></div></article>`;
}

function renderMenus() {
  const allItems = activeRestaurants.filter((restaurant) => restaurant.hasMenu);
  const filtered = allItems.filter((restaurant) => placeMatchesDiscoverySearch(restaurant, menusUiState.query) && (menusUiState.neighbourhood === "all" || (restaurant.neighborhood || "Halifax") === menusUiState.neighbourhood)).sort((a, b) => menusUiState.sort === "name" ? a.name.localeCompare(b.name) : menusUiState.sort === "neighbourhood" ? (a.neighborhood || "").localeCompare(b.neighborhood || "") || a.name.localeCompare(b.name) : (b.score || 0) - (a.score || 0));
  const visible = filtered.slice(0, menusUiState.page * MENUS_PAGE_SIZE);
  appView.innerHTML = `
    <section class="menus-hero"><div class="page-shell"><span class="eyebrow">Browse before you choose</span><h1>Menus across Halifax</h1><p>Find restaurants with direct menu-source coverage, then open the official menu for the latest dishes and prices.</p></div></section>
    <section class="page-shell section-block menu-results-section"><form class="discovery-control-panel menu-control-panel" data-menu-search><label><span>Search menus</span><input type="search" value="${escapeHtml(menusUiState.query)}" placeholder="Restaurant, cuisine, or neighbourhood" aria-label="Search menus"/></label><label><span>Area</span><select id="menuNeighbourhood"><option value="all">All areas</option>${discoveryNeighbourhoodOptions(allItems).map((name) => `<option value="${escapeHtml(name)}" ${menusUiState.neighbourhood === name ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}</select></label><label><span>Sort</span><select id="menuSort"><option value="recommended">Recommended</option><option value="name" ${menusUiState.sort === "name" ? "selected" : ""}>Restaurant name</option><option value="neighbourhood" ${menusUiState.sort === "neighbourhood" ? "selected" : ""}>Neighbourhood</option></select></label><button class="button primary" type="submit">Apply</button></form><div class="section-heading"><div><h2>${filtered.length.toLocaleString()} places with direct menu sources</h2><p>Showing ${visible.length.toLocaleString()} results. Open the restaurant detail for menu provenance and related official links.</p></div></div><div class="restaurant-grid">${visible.map((r, i) => restaurantCard(r, { index: i })).join("")}</div>${visible.length < filtered.length ? `<div class="discovery-load-more"><button class="button secondary" type="button" data-menus-more>Load ${Math.min(MENUS_PAGE_SIZE, filtered.length - visible.length)} more</button><span>${filtered.length - visible.length} remaining</span></div>` : ""}${filtered.length ? "" : emptyPageState("No menu sources match the current filters.")}</section>`;
  bindCommonActions();
  document.querySelector("[data-menu-search]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = event.currentTarget.querySelector("input");
    menusUiState.query = input.value.trim();
    menusUiState.neighbourhood = document.querySelector("#menuNeighbourhood")?.value || "all";
    menusUiState.sort = document.querySelector("#menuSort")?.value || "recommended";
    menusUiState.page = 1;
    renderMenus();
  });
  document.querySelector("[data-menus-more]")?.addEventListener("click", () => { menusUiState.page += 1; renderMenus(); });
}

function renderMapPage() {
  const areas = ["All neighbourhoods", "Downtown", "North End", "South End", "Waterfront", "Dartmouth", "Bedford"];
  const results = filteredRestaurants({ neighbourhood: state.neighbourhood });
  appView.innerHTML = `
    <section class="page-shell page-intro map-intro"><div><span class="eyebrow">Neighbourhood discovery</span><h1>Explore Halifax</h1><p>Browse local places by neighbourhood and move between the map and source-backed listings.</p></div><a class="button secondary" href="#explore">View as list</a></section>
    <section class="page-shell map-page">
      <div class="map-mode-switch" role="group" aria-label="Map display mode"><button type="button" data-map-mode="map" class="${mapUiMode === "map" ? "is-active" : ""}" aria-pressed="${mapUiMode === "map"}">Map</button><button type="button" data-map-mode="list" class="${mapUiMode === "list" ? "is-active" : ""}" aria-pressed="${mapUiMode === "list"}">List</button></div>
      <div class="map-chips">${areas.map((area) => `<button type="button" data-map-area="${area === "All neighbourhoods" ? "all" : escapeHtml(area)}" class="${(area === "All neighbourhoods" && state.neighbourhood === "all") || area === state.neighbourhood ? "is-active" : ""}">${escapeHtml(area)}</button>`).join("")}</div>
      <div class="map-split mode-${mapUiMode}"><div class="map-large" id="mainMap"></div><aside class="map-results"><div class="results-toolbar"><strong>${results.length.toLocaleString()} places</strong><label>Sort <select id="mapSort"><option value="recommended" ${state.sort === "recommended" ? "selected" : ""}>Recommended</option><option value="name" ${state.sort === "name" ? "selected" : ""}>Name</option></select></label></div><div class="local-picks"><h2>Local picks</h2>${results.slice(0, 2).map((r, i) => restaurantCard(r, { compact: true, index: i })).join("")}</div><div class="map-result-list">${results.slice(0, 18).map(mapResultRow).join("")}</div></aside></div>
    </section>`;
  bindCommonActions();
  document.querySelectorAll("[data-map-area]").forEach((button) => button.addEventListener("click", () => {
    state.neighbourhood = button.dataset.mapArea;
    renderMapPage();
  }));
  document.querySelector("#mapSort")?.addEventListener("change", (event) => { state.sort = event.target.value; renderMapPage(); });
  document.querySelectorAll("[data-map-mode]").forEach((button) => button.addEventListener("click", () => {
    mapUiMode = button.dataset.mapMode === "list" ? "list" : "map";
    document.querySelector(".map-split")?.classList.toggle("mode-map", mapUiMode === "map");
    document.querySelector(".map-split")?.classList.toggle("mode-list", mapUiMode === "list");
    document.querySelectorAll("[data-map-mode]").forEach((item) => { item.classList.toggle("is-active", item.dataset.mapMode === mapUiMode); item.setAttribute("aria-pressed", String(item.dataset.mapMode === mapUiMode)); });
    if (mapUiMode === "map") setTimeout(() => state.map?.invalidateSize?.(), 0);
  }));
  requestAnimationFrame(() => initMainMap(results));
}

function mapResultRow(restaurant) {
  return `<article class="map-result-row" data-map-result-id="${escapeHtml(restaurant.id)}" tabindex="0" aria-label="Focus ${escapeHtml(restaurant.name)} on map"><div class="map-thumb media-${mediaTone(restaurant)}${permittedImageClass(restaurant)}">${mediaImageMarkup(restaurant)}</div><div><strong>${escapeHtml(restaurant.name)}</strong><span>${escapeHtml(primaryCuisine(restaurant))} · ${escapeHtml(restaurant.neighborhood || "Halifax")}</span><small>${consumerTags(restaurant).slice(0, 2).map(escapeHtml).join(" · ")}</small></div><a href="#restaurant/${encodeURIComponent(restaurant.id)}">View</a><button class="row-save ${state.saved.has(restaurant.id) ? "is-saved" : ""}" data-save-id="${escapeHtml(restaurant.id)}" aria-label="Save ${escapeHtml(restaurant.name)}">${state.saved.has(restaurant.id) ? "♥" : "♡"}</button></article>`;
}
