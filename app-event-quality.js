"use strict";

const EVENT_LINK_TERMS = /\b(event|events|calendar|live music|music|trivia|karaoke|ticket|tickets|show|shows|concert|festival|market|workshop)\b/i;

function credibleEventLinks(restaurant) {
  return (restaurant?.eventLinks || []).filter((link) => {
    const href = safeUrl(link?.url);
    if (!href) return false;
    let parsed;
    try { parsed = new URL(href); } catch { return false; }
    const label = String(link?.label ?? "").replace(/\s+/g, " ").trim();
    const pathText = `${parsed.pathname} ${parsed.search}`.replace(/[\/_-]+/g, " ");
    const pathLooksEventSpecific = EVENT_LINK_TERMS.test(pathText);
    const conciseEventLabel = label.length > 0 && label.length <= 80 && EVENT_LINK_TERMS.test(label);
    return pathLooksEventSpecific || conciseEventLabel;
  });
}

function displayEventLabel(value, fallback = "Official event source") {
  const label = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!label) return fallback;
  return label.length > 100 ? `${label.slice(0, 97).trim()}…` : label;
}

function eventLeadItems() {
  return restaurants
    .map((restaurant) => ({
      restaurant,
      credibleLinks: credibleEventLinks(restaurant),
      curatedEvents: Array.isArray(restaurant.events) ? restaurant.events : []
    }))
    .filter((item) => item.credibleLinks.length > 0 || item.curatedEvents.length > 0)
    .sort((a, b) => (b.restaurant.score || 0) - (a.restaurant.score || 0));
}
