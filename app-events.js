"use strict";
function renderEvents() {
  const items = restaurants.filter((restaurant) => restaurant.hasEvent).sort((a, b) => (b.score || 0) - (a.score || 0));
  const featured = items[0];
  appView.innerHTML = `
    <section class="editorial-hero events-hero">
      <div class="page-shell editorial-hero-inner">
        <div><span class="eyebrow">What's happening</span><h1>Events in Halifax</h1><p>Food, music, community, market, and venue event leads gathered from restaurant and venue source pages.</p></div>
        ${featured ? `<div class="featured-event"><span>FEATURED SOURCE LEAD</span><h2>${escapeHtml(featured.name)}</h2><p>${escapeHtml(featured.eventLinks[0]?.label || featured.events?.[0]?.title || "Event information available from official channels")}</p><a class="button light" href="#restaurant/${encodeURIComponent(featured.id)}">View details</a></div>` : ""}
      </div>
    </section>
    <section class="page-shell two-column-page">
      <div>
        <div class="chip-row"><button class="chip is-active">All events</button><button class="chip">Food & drink</button><button class="chip">Live music</button><button class="chip">Community</button></div>
        <div class="section-heading no-top"><div><h2>Event leads</h2><p>Time-sensitive details are intentionally not invented. Follow the official source before making plans.</p></div></div>
        <div class="event-list">${items.length ? items.slice(0, 40).map(eventSourceCard).join("") : emptyPageState("No event-source leads are loaded yet.")}</div>
      </div>
      <aside class="events-sidebar">
        <div class="calendar-card">${simpleCalendar()}</div>
        <div class="source-card"><h2>How to read this page</h2><p>These are discovery leads from official-site keywords and links, not a claim that an event occurs today. Open the source to confirm date, time, tickets, and availability.</p></div>
      </aside>
    </section>`;
  bindCommonActions();
}

function eventSourceCard(restaurant) {
  const link = restaurant.eventLinks[0];
  const observed = restaurant.signal?.observedAt ? new Date(restaurant.signal.observedAt).toLocaleDateString("en-CA", { month: "short", day: "numeric" }) : "SOURCE";
  return `<article class="event-card"><div class="event-date"><span>CHECKED</span><strong>${escapeHtml(observed)}</strong></div><div class="event-thumb media-${mediaTone(restaurant)}${permittedImageClass(restaurant)}">${mediaImageMarkup(restaurant)}</div><div class="event-copy"><div class="event-title-line"><h3>${escapeHtml(restaurant.name)}</h3><span>Event lead</span></div><p>${escapeHtml(link?.label || restaurant.events?.[0]?.title || "Official channel contains event-related information")}</p><small>${escapeHtml(restaurant.neighborhood || "Halifax")} · Confirm current details</small><div class="card-tags"><span>Official source</span>${restaurant.hasPatio ? "<span>Patio</span>" : ""}</div></div><a class="button tertiary" href="#restaurant/${encodeURIComponent(restaurant.id)}">View</a></article>`;
}

function simpleCalendar() {
  const now = new Date();
  const month = now.toLocaleDateString("en-CA", { month: "long", year: "numeric" });
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const blanks = first.getDay();
  const cells = [...Array(blanks).fill(""), ...Array.from({ length: days }, (_, i) => String(i + 1))];
  return `<div class="calendar-heading"><span>▣</span><h2>${escapeHtml(month)}</h2></div><div class="calendar-week"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div><div class="calendar-grid">${cells.map((day) => `<span class="${Number(day) === now.getDate() ? "today" : ""}">${day}</span>`).join("")}</div><p>Calendar dates are illustrative until structured event dates are collected.</p>`;
}
