"use strict";
function renderExplore() {
  const results = filteredRestaurants();
  const pages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  state.page = Math.min(state.page, pages);
  const start = (state.page - 1) * PAGE_SIZE;
  const pageItems = results.slice(start, start + PAGE_SIZE);

  appView.innerHTML = `
    <section class="page-shell page-intro compact-intro">
      <div><span class="eyebrow">Discover</span><h1>Explore Halifax</h1><p>${state.query ? `Showing places matching “${escapeHtml(state.query)}”.` : "Search restaurants and venues by cuisine, neighbourhood, and source-backed features."}</p></div>
    </section>
    <section class="page-shell explore-layout">
      <aside class="filters-panel" aria-label="Restaurant filters">
        <div class="filter-title"><h2>Filters</h2><button type="button" data-clear-filters>Clear all</button></div>
        ${filterSelect("Cuisine", "cuisineFilter", state.cuisine, [["all", "All cuisines"], ...cuisines.slice(0, 18).map(([name, count]) => [name, `${name} (${count})`])])}
        ${filterSelect("Neighbourhood", "neighbourhoodFilter", state.neighbourhood, [["all", "All neighbourhoods"], ...neighbourhoods.slice(0, 20).map(([name, count]) => [name, `${name} (${count})`])])}
        ${filterSelect("Feature", "featureFilter", state.feature, [["all", "All places"], ["menus", "Menu link"], ["specials", "Special signal"], ["events", "Event signal"], ["patio", "Patio"], ["opening", "Opening signal"]])}
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
        <div class="tip-card"><span>♧</span><div><h2>Local tip</h2><p>Menu, specials, event, and patio badges indicate source signals. Confirm time-sensitive details with the restaurant.</p></div></div>
        <div class="source-card"><h2>Source coverage</h2><p>${osmMeta ? `${osmMeta.count?.toLocaleString?.() || restaurants.length} public map places imported.` : `${restaurants.length.toLocaleString()} places loaded.`}</p><p>${officialPayload ? `${(officialPayload.count ?? officialSignals.length).toLocaleString()} official sites checked for menu, event, special, and reservation links.` : "Official-site signal data not loaded."}</p></div>
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
  const pills = [];
  if (state.cuisine !== "all") pills.push(state.cuisine);
  if (state.neighbourhood !== "all") pills.push(state.neighbourhood);
  if (state.feature !== "all") pills.push(state.feature);
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
