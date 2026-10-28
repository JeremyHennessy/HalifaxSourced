"use strict";

const NEWS_PAGE_SIZE = 12;
const NEWS_TYPE_LABELS = { newsroom: "Journalism", official_public_notice: "Official announcement", library_notice: "Community notice", local_business_publication: "Local business publication" };

function newsMonthValue(value) {
  return /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value || "") ? value : "all";
}

function newsStateFromParams(params) {
  const number = Number(params.get("page"));
  return { query: (params.get("q") || "").slice(0, 200), region: params.get("region") || "all", topic: params.get("topic") || "all", type: params.get("type") || "all", month: newsMonthValue(params.get("month")), page: Number.isSafeInteger(number) && number > 0 ? number : 1 };
}

function newsHash(values) {
  const params = new URLSearchParams();
  for (const [key, field, fallback] of [["q", "query", ""], ["region", "region", "all"], ["topic", "topic", "all"], ["type", "type", "all"], ["month", "month", "all"], ["page", "page", 1]]) {
    if (values[field] != null && values[field] !== fallback) params.set(key, String(values[field]));
  }
  return "#news" + (params.size ? "?" + params : "");
}

function newsExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

function acceptedNewsItems(payload = window.HALIFAX_NEWS) {
  if (payload?.version !== 1 || !Array.isArray(payload.items)) return [];
  return payload.items.filter(item => item && item.reviewStatus === "approved" && NEWS_TYPE_LABELS[item.source_type] && newsExternalUrl(item.canonicalUrl) && typeof item.title === "string" && typeof item.publishedAt === "string" && Number.isFinite(Date.parse(item.publishedAt)))
    .slice().sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || String(a.id).localeCompare(String(b.id)));
}

function newsPublicationMonth(item) {
  // Day-only evidence stays in its original calendar. Qualified instants follow
  // the same Halifax timezone as the visible publication date.
  if (item.publishedPrecision === "day" || /^\d{4}-\d\d-\d\d$/.test(item.publishedAt)) return newsMonthValue(item.publishedAt.slice(0, 7));
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: "America/Halifax" }).formatToParts(new Date(item.publishedAt));
  return parts.find(part => part.type === "year").value + "-" + parts.find(part => part.type === "month").value;
}

function newsMonthLabel(month) {
  return new Intl.DateTimeFormat("en-CA", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(month + "-01T12:00:00Z"));
}

function filteredNewsItems(items, filters) {
  const query = filters.query.trim().toLocaleLowerCase();
  const month = newsMonthValue(filters.month);
  return items.filter(item => (month === "all" || newsPublicationMonth(item) === month) && (filters.region === "all" || item.region === filters.region) && (filters.type === "all" || item.source_type === filters.type) && (filters.topic === "all" || (item.topics || []).includes(filters.topic)) && (!query || [item.title, item.summary, item.sourceName, item.region, ...(item.topics || [])].join(" ").toLocaleLowerCase().includes(query)));
}

function newsDateLabel(item) {
  const day = item.publishedPrecision === "day" || /^\d{4}-\d\d-\d\d$/.test(item.publishedAt);
  const value = day ? item.publishedAt + "T12:00:00Z" : item.publishedAt;
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", ...(day ? {} : { timeStyle: "short" }), timeZone: day ? "UTC" : "America/Halifax" }).format(new Date(value));
}

function newsCard(item, options = {}) {
  const heading = options.headingLevel === 3 ? "h3" : "h2";
  const summary = item.summaryKind === "reviewed_original" && typeof item.summary === "string" ? '<p class="news-summary">' + escapeHtml(item.summary) + '</p>' : "";
  return '<article class="news-card"><div class="news-card-meta"><span class="news-type">' + escapeHtml(NEWS_TYPE_LABELS[item.source_type]) + '</span><span>' + escapeHtml(item.region) + '</span></div><' + heading + '><a href="' + escapeHtml(newsExternalUrl(item.canonicalUrl)) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(item.title) + '</a></' + heading + '><p class="news-byline">' + escapeHtml(item.sourceName) + ' · Published <time datetime="' + escapeHtml(item.publishedAt) + '">' + escapeHtml(newsDateLabel(item)) + '</time></p>' + summary + (item.correctionStatus === "corrected" ? '<p class="news-correction">Corrected item — check the original for the latest information.</p>' : "") + (options.compact ? '' : '<div class="news-topics">' + (item.topics || []).map(topic => '<span>' + escapeHtml(topic) + '</span>').join("") + '</div>') + '<a class="text-link" href="' + escapeHtml(newsExternalUrl(item.canonicalUrl)) + '" target="_blank" rel="noopener noreferrer">Read original ↗</a></article>';
}

function renderNews() {
  const filters = newsStateFromParams(route().params);
  const payloadAvailable = window.HALIFAX_NEWS?.version === 1 && Array.isArray(window.HALIFAX_NEWS.items);
  const items = acceptedNewsItems();
  const filtered = filteredNewsItems(items, filters);
  const pages = Math.max(1, Math.ceil(filtered.length / NEWS_PAGE_SIZE));
  const page = Math.min(filters.page, pages);
  const visible = filtered.slice((page - 1) * NEWS_PAGE_SIZE, page * NEWS_PAGE_SIZE);
  const regions = [...new Set(items.map(item => item.region))].sort();
  const topics = [...new Set(items.flatMap(item => item.topics || []))].sort();
  // Retain a valid bookmarked month even if the reviewed selection has no items.
  const months = [...new Set([...items.map(newsPublicationMonth), ...(filters.month === "all" ? [] : [filters.month])])].filter(month => month !== "all").sort().reverse();
  const options = (values, selected) => values.map(value => '<option value="' + escapeHtml(value) + '"' + (value === selected ? ' selected' : '') + '>' + escapeHtml(value) + '</option>').join("");
  appView.innerHTML = '<section class="page-shell page-intro news-intro"><div><span class="eyebrow">Around the province</span><h1>Local news &amp; notices</h1><p>Source-linked updates for Halifax, surrounding communities and Nova Scotia. Journalism, official announcements and local business publications are labelled separately.</p></div><a class="button secondary" href="#admin/status">Sources &amp; coverage</a></section><section class="page-shell section-block news-section"><form class="discovery-control-panel news-controls" data-news-filters><label><span>Search news</span><input type="search" name="newsQuery" value="' + escapeHtml(filters.query) + '" maxlength="200" placeholder="Topic, place or publisher" /></label><label><span>Region</span><select name="newsRegion"><option value="all">All Nova Scotia</option>' + options(regions, filters.region) + '</select></label><label><span>Topic</span><select name="newsTopic"><option value="all">All topics</option>' + options(topics, filters.topic) + '</select></label><label><span>Source type</span><select name="newsType"><option value="all">All source types</option>' + Object.entries(NEWS_TYPE_LABELS).map(([key, label]) => '<option value="' + key + '"' + (filters.type === key ? ' selected' : '') + '>' + label + '</option>').join("") + '</select></label><label><span>Publication month</span><select name="newsMonth"><option value="all">All publication dates</option>' + months.map(month => '<option value="' + month + '"' + (filters.month === month ? ' selected' : '') + '>' + escapeHtml(newsMonthLabel(month)) + '</option>').join("") + '</select></label><button class="button primary" type="submit">Apply</button><a class="button tertiary" href="#news">Clear filters</a></form><p class="news-coverage-note">A reviewed selection, not a complete archive or live news service. Dates refer to the original publication, not our collection time. Older stories are archival coverage, not active alerts or upcoming-event listings. Summaries, where shown, are short editorial annotations; the original publisher has the full story. No publisher photographs are reproduced.</p><p class="news-result-count" role="status">' + filtered.length.toLocaleString() + ' reviewed items' + (filtered.length ? ' · Page ' + page + ' of ' + pages : '') + '</p><div class="news-grid">' + visible.map(newsCard).join("") + '</div>' + (!visible.length ? '<div class="news-empty"><h2>' + (!payloadAvailable ? 'News data is unavailable' : items.length ? 'No items match these filters' : 'News sources are being reviewed') + '</h2><p>' + (!payloadAvailable ? 'The news file could not be loaded. This does not mean there are no local stories.' : items.length ? 'Try another month, region, topic or source type.' : 'Only verified, reviewed links will appear here. Collection has not been activated for unapproved sources.') + '</p></div>' : '') + (pages > 1 ? '<nav class="news-pagination" aria-label="News pages">' + (page > 1 ? '<a class="button secondary" href="' + escapeHtml(newsHash({ ...filters, page: page - 1 })) + '">Previous</a>' : '') + '<span>Page ' + page + ' of ' + pages + '</span>' + (page < pages ? '<a class="button secondary" href="' + escapeHtml(newsHash({ ...filters, page: page + 1 })) + '">Next</a>' : '') + '</nav>' : '') + '</section>';
  document.querySelector('[data-news-filters]')?.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    navigate(newsHash({ query: form.elements.newsQuery.value.trim(), region: form.elements.newsRegion.value, topic: form.elements.newsTopic.value, type: form.elements.newsType.value, month: newsMonthValue(form.elements.newsMonth.value), page: 1 }));
  });
}
