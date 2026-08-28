"use strict";
function renderExplore() {
  document.body.classList.remove("filter-drawer-open");
  const liveCuisines = countValues(restaurants.flatMap((restaurant) => restaurant.cuisines || []));
  const liveNeighbourhoods = countValues(restaurants.map((restaurant) => restaurant.neighborhood || "Halifax"));
  const results = filteredRestaurants();
  const pages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  state.page = Math.min(state.page, pages);
  const start = (state.page - 1) * PAGE_SIZE;
  const pageItems = results.slice(start, start + PAGE_SIZE);
  const filterCount = [state.cuisine, state.neighbourhood, state.feature].filter((value) => value !== "all").length;

  appView.innerHTML = `
    <section class="page-shell page-intro compact-intro">
      <div><span class="eyebrow">Discover</span><h1>Explore Halifax</h1><p>${state.query ? `Showing places matching “${escapeHtml(state.query)}”.` : "Search restaurants and venues by cuisine, neighbourhood, social presence, booking links, and source-backed features."}</p></div>
    </section>
    <div class="page-shell mobile-filter-bar"><button class="mobile-filter-toggle" type="button" data-open-filters aria-controls="exploreFilters" aria-expanded="false">Filters${filterCount ? `<span>${filterCount}</span>` : ""}</button><span>${results.length.toLocaleString()} places</span></div>
    <div class="filter-drawer-backdrop" data-filter-backdrop></div>
    <section class="page-shell explore-layout">
      <aside class="filters-panel" id="exploreFilters" data-filter-drawer aria-label="Restaurant filters">
        <div class="filter-title"><h2>Filters</h2><div class="filter-title-actions"><button type="button" data-clear-filters>Clear all</button><button class="filter-close" type="button" data-close-filters aria-label="Close filters">×</button></div></div>
        ${filterSelect("Cuisine", "cuisineFilter", state.cuisine, [["all", "All cuisines"], ...liveCuisines.slice(0, 24).map(([name, count]) => [name, `${name} (${count})`])])}
        ${filterSelect("Neighbourhood", "neighbourhoodFilter", state.neighbourhood, [["all", "All neighbourhoods"], ...liveNeighbourhoods.slice(0, 24).map(([name, count]) => [name, `${name} (${count})`])])}
        ${filterSelect("Feature", "featureFilter", state.feature, [["all", "All places"], ["menus", "Menu link"], ["specials", "Special signal"], ["events", "Event signal"], ["patio", "Patio"], ["opening", "New / opening"], ["social", "Official social profiles"], ["reservations", "Reservations"], ["ordering", "Online ordering"]])}
        <button class="button primary filter-apply" type="button" data-filter-apply>Apply filters</button>
      </aside>
      <div class="results-area">
        <div class="results-toolbar">
          <div><strong>${results.length.toLocaleString()} places found</strong>${activeFilterPills()}</div>
          <label>Sort by <select id="sortFilter"><option value="recommended" ${state.sort === "recommended" ? "selected" : ""}>Recommended</option><option value="fresh" ${state.sort === "fresh" ? "selected" : ""}>Fresh source check</option><option value="name" ${state.sort === "name" ? "selected" : ""}>Name</option><option value="neighbourhood" ${state.sort === "neighbourhood" ? "selected" : ""}>Neighbourhood</option></select></label>
        </div>
        <div class="restaurant-grid">${pageItems.length ? pageItems.map((r, i) => restaurantCard(r, { index: i })).join("") : noResults()}</div>
        ${pagination(state.page, pages)}
      </div>
      <aside class="context-column">
        <div class="mini-map-card"><div id="exploreMiniMap" class="mini-map"></div><a href="#map">Open full map →</a></div>
        <div class="tip-card"><span>♧</span><div><h2>Local tip</h2><p>Menu, social, reservation, ordering, specials, event, patio and opening badges indicate source-backed links or signals. Confirm time-sensitive details with the restaurant.</p></div></div>
        <div class="source-card"><h2>Source coverage</h2><p>${restaurants.length.toLocaleString()} combined restaurant and venue records are loaded from curated, public-map and reviewed discovery layers.</p><p>${officialPayload ? `${(officialPayload.count ?? officialSignals.length).toLocaleString()} restaurant-owned sites checked for menu, event, special, reservation and social links.` : "Official-site signal data not loaded."}</p><p>${window.__halifaxFirstPartySocialProfileCount ? `${window.__halifaxFirstPartySocialProfileCount.toLocaleString()} official-site-linked social profiles and ${window.__halifaxFirstPartyRelatedLinkCount.toLocaleString()} related first-party links are indexed.` : "Social and related-link discovery data is still growing."}</p></div>
      </aside>
    </section>`;

  bindExploreActions();
  bindCommonActions();
  requestAnimationFrame(() => initMiniMap(results.slice(0, 100)));
}

function filterSelect(label, id, selected, options) {
  return `<label class="filter-control"><span>${escapeHtml(label)}</span><select id="${id}">${options.map(([value, text]) => `<option value="${escapeHtml(value)}" ${String(selected) === String(value) ? "selected" : ""}>${escapeHtml(text)}</option>`).join("")}</select></label>`;
}

function activeFilterPills() {
  const labels = { social: "Social profiles", reservations: "Reservations", ordering: "Online ordering", opening: "New / opening" };
  const pills = [];
  if (state.cuisine !== "all") pills.push(state.cuisine);
  if (state.neighbourhood !== "all") pills.push(state.neighbourhood);
  if (state.feature !== "all") pills.push(labels[state.feature] || state.feature);
  return pills.length ? `<div class="active-pills">${pills.map((pill) => `<span>${escapeHtml(pill)}</span>`).join("")}</div>` : "";
}

function noResults() {
  return `<div class="empty-state"><span class="empty-brand-mark" aria-hidden="true"></span><h2>No matches yet</h2><p>Try a broader search or clear a filter.</p><button class="button primary" type="button" data-clear-filters>Clear filters</button></div>`;
}

function pagination(current, pages) {
  if (pages <= 1) return "";
  const start = Math.max(1, current - 2);
  const end = Math.min(pages, start + 4);
  const buttons = [];
  for (let page = start; page <= end; page++) buttons.push(`<button type="button" class="${page === current ? "is-active" : ""}" data-page="${page}">${page}</button>`);
  return `<nav class="pagination" aria-label="Results pages"><button type="button" data-page="${Math.max(1, current - 1)}" ${current === 1 ? "disabled" : ""}>‹</button>${buttons.join("")}<button type="button" data-page="${Math.min(pages, current + 1)}" ${current === pages ? "disabled" : ""}>›</button></nav>`;
}
