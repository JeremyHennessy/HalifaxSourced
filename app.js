const restaurants = window.HALIFAX_RESTAURANTS ?? [];

const state = {
  query: "",
  filter: "all",
  sort: "quality",
  selectedId: restaurants[0]?.id ?? null
};

const elements = {
  search: document.querySelector("#search"),
  sort: document.querySelector("#sort"),
  chips: [...document.querySelectorAll(".filter-chip")],
  grid: document.querySelector("#restaurantGrid"),
  resultCount: document.querySelector("#resultCount"),
  statRestaurants: document.querySelector("#statRestaurants"),
  statSpecials: document.querySelector("#statSpecials"),
  statEvents: document.querySelector("#statEvents"),
  statEvidence: document.querySelector("#statEvidence"),
  emptyDetail: document.querySelector("#emptyDetail"),
  detail: document.querySelector("#restaurantDetail"),
  template: document.querySelector("#restaurantCardTemplate")
};

function daysSince(dateValue) {
  const date = new Date(`${dateValue}T00:00:00`);
  const now = new Date();
  return Math.max(0, Math.floor((now - date) / 86400000));
}

function freshnessLabel(dateValue) {
  const days = daysSince(dateValue);
  if (days <= 7) return { text: "fresh", className: "is-fresh" };
  if (days <= 21) return { text: `${days}d old`, className: "" };
  return { text: "stale", className: "is-stale" };
}

function normalizedText(restaurant) {
  return [
    restaurant.name,
    restaurant.neighborhood,
    restaurant.summary,
    ...restaurant.cuisines,
    ...restaurant.vibe
  ]
    .join(" ")
    .toLowerCase();
}

function matchesFilter(restaurant) {
  if (state.filter === "all") return true;
  if (state.filter === "happy-hour") {
    return restaurant.specials.some((special) => /happy hour/i.test(special.title));
  }
  if (state.filter === "specials") return restaurant.specials.length > 0;
  if (state.filter === "events") return restaurant.events.length > 0;
  if (state.filter === "verified") return restaurant.evidenceStatus === "verified";
  if (state.filter === "needs-review") return restaurant.evidenceStatus !== "verified";
  return true;
}

function getFilteredRestaurants() {
  const query = state.query.trim().toLowerCase();

  return restaurants
    .filter((restaurant) => !query || normalizedText(restaurant).includes(query))
    .filter(matchesFilter)
    .sort((a, b) => {
      if (state.sort === "name") return a.name.localeCompare(b.name);
      if (state.sort === "neighborhood") {
        return a.neighborhood.localeCompare(b.neighborhood) || a.name.localeCompare(b.name);
      }
      if (state.sort === "freshness") return daysSince(a.freshnessDate) - daysSince(b.freshnessDate);
      return b.qualityScore - a.qualityScore;
    });
}

function statusText(status) {
  return status.replace("-", " ");
}

function renderStats() {
  const specials = restaurants.reduce((count, item) => count + item.specials.length, 0);
  const events = restaurants.reduce((count, item) => count + item.events.length, 0);
  const verified = restaurants.filter((item) => item.evidenceStatus === "verified").length;

  elements.statRestaurants.textContent = restaurants.length;
  elements.statSpecials.textContent = specials;
  elements.statEvents.textContent = events;
  elements.statEvidence.textContent = `${Math.round((verified / Math.max(restaurants.length, 1)) * 100)}%`;
}

function renderCards() {
  const visible = getFilteredRestaurants();
  elements.grid.innerHTML = "";
  elements.resultCount.textContent = `Showing ${visible.length} ${visible.length === 1 ? "place" : "places"}`;

  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "empty-results";
    empty.textContent = "No restaurants match those filters yet.";
    elements.grid.append(empty);
    renderDetail(null);
    return;
  }

  if (!visible.some((restaurant) => restaurant.id === state.selectedId)) {
    state.selectedId = visible[0].id;
  }

  for (const restaurant of visible) {
    const fragment = elements.template.content.cloneNode(true);
    const button = fragment.querySelector(".card-button");
    const freshness = freshnessLabel(restaurant.freshnessDate);

    button.dataset.id = restaurant.id;
    button.classList.toggle("is-selected", restaurant.id === state.selectedId);
    fragment.querySelector(".neighborhood").textContent = restaurant.neighborhood;
    fragment.querySelector(".freshness").textContent = freshness.text;
    if (freshness.className) {
      fragment.querySelector(".freshness").classList.add(freshness.className);
    }
    fragment.querySelector("h3").textContent = restaurant.name;
    fragment.querySelector(".meta").textContent = restaurant.summary;
    fragment.querySelector(".score").textContent = `${restaurant.qualityScore}`;
    fragment.querySelector(".evidence-badge").textContent = statusText(restaurant.evidenceStatus);
    fragment.querySelector(".evidence-badge").classList.add(restaurant.evidenceStatus);

    const tags = fragment.querySelector(".tags");
    [...restaurant.cuisines.slice(0, 2), ...restaurant.vibe.slice(0, 2)].forEach((tag) => {
      const tagElement = document.createElement("span");
      tagElement.className = "tag";
      tagElement.textContent = tag;
      tags.append(tagElement);
    });

    button.addEventListener("click", () => {
      state.selectedId = restaurant.id;
      render();
    });

    elements.grid.append(fragment);
  }

  renderDetail(restaurants.find((restaurant) => restaurant.id === state.selectedId));
}

function renderDetail(restaurant) {
  elements.emptyDetail.hidden = Boolean(restaurant);
  elements.detail.hidden = !restaurant;
  if (!restaurant) return;

  const specialsMarkup = restaurant.specials.length
    ? restaurant.specials
        .map(
          (special) => `
            <li>
              <strong>${special.title}</strong>
              <small>${special.cadence} · ${statusText(special.sourceStatus)}</small>
            </li>
          `
        )
        .join("")
    : "<li>No current special captured yet.<small>Ready for official menu or owner submission.</small></li>";

  const eventsMarkup = restaurant.events.length
    ? restaurant.events
        .map(
          (event) => `
            <li>
              <strong>${event.title}</strong>
              <small>${event.timing} · ${statusText(event.sourceStatus)}</small>
            </li>
          `
        )
        .join("")
    : "<li>No upcoming event captured yet.<small>Ready for calendar, ticketing, or official social feed.</small></li>";

  const sourceMarkup = restaurant.sources
    .map(
      (source) => `
        <div class="source-item">
          <a href="${source.url}" target="_blank" rel="noreferrer">${source.label}</a>
          <span class="source-state ${source.status}">${statusText(source.status)}</span>
        </div>
      `
    )
    .join("");

  elements.detail.innerHTML = `
    <h2 class="detail-title">${restaurant.name}</h2>
    <p class="detail-subtitle">${restaurant.neighborhood} · ${restaurant.cuisines.join(", ")}</p>
    <p class="detail-subtitle">${restaurant.summary}</p>

    <div class="quality-meter" aria-label="Quality score ${restaurant.qualityScore} out of 100">
      <div class="meter-bar"><div class="meter-fill" style="width: ${restaurant.qualityScore}%"></div></div>
      <strong>${restaurant.qualityScore}/100</strong>
    </div>

    <section class="detail-section">
      <h3>Specials</h3>
      <ul class="detail-list">${specialsMarkup}</ul>
    </section>

    <section class="detail-section">
      <h3>Events</h3>
      <ul class="detail-list">${eventsMarkup}</ul>
    </section>

    <section class="detail-section">
      <h3>Best for</h3>
      <div class="tags">${restaurant.vibe.map((tag) => `<span class="tag">${tag}</span>`).join("")}</div>
    </section>

    <section class="detail-section">
      <h3>Source Evidence</h3>
      <div class="source-list">${sourceMarkup}</div>
    </section>
  `;
}

function render() {
  elements.chips.forEach((chip) => chip.classList.toggle("is-active", chip.dataset.filter === state.filter));
  renderStats();
  renderCards();
}

elements.search.addEventListener("input", (event) => {
  state.query = event.target.value;
  render();
});

elements.sort.addEventListener("change", (event) => {
  state.sort = event.target.value;
  render();
});

elements.chips.forEach((chip) => {
  chip.addEventListener("click", () => {
    state.filter = chip.dataset.filter;
    render();
  });
});

render();
