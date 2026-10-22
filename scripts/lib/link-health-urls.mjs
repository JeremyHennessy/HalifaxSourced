// One bounded URL universe shared by the collector and independent release gate.
import { reviewedLocationLinks } from './reviewed-corrections.mjs';
export const inactiveStatuses = new Set(['permanently_closed','seasonally_closed','temporarily_closed','moved','replaced']);
export function linkHealthUrls({catalog, firstParty, facts, city}, release) {
  const activeIds = new Set(catalog.restaurants.filter(item => !inactiveStatuses.has(item.operatingStatus)).map(item => item.id));
  const urls = new Map();
  function add(value, kind, id) {
    if (release && !activeIds.has(id)) return;
    try {
      const url = new URL(String(value || ''));
      if (!['http:', 'https:'].includes(url.protocol)) return;
      if (!urls.has(url.href)) urls.set(url.href, {url:url.href, kinds:[], entityIds:[], officialEntityIds:[]});
      const item = urls.get(url.href);
      if (!item.kinds.includes(kind)) item.kinds.push(kind);
      if (id && !item.entityIds.includes(id)) item.entityIds.push(id);
      if (id && kind === 'official_website' && !item.officialEntityIds.includes(id)) item.officialEntityIds.push(id);
    } catch { /* Missing/non-URL fields do not invent destinations. */ }
  }
  for (const item of catalog.restaurants) {
    add(item.website, 'official_website', item.id);
    if (!release) for (const source of item.sources || []) add(source.url, `place_source:${source.type || 'source'}`, item.id);
  }
  for (const link of reviewedLocationLinks(catalog.restaurants)) add(link.url, link.kind, link.restaurantId);
  for (const item of firstParty.records || []) {
    for (const source of item.socialProfiles || []) add(source.profileUrl || source.url, `social:${source.platform}`, item.restaurantId);
    for (const source of item.linkHubs || []) add(source.url, `link_hub:${source.platform}`, item.restaurantId);
    for (const source of item.relatedLinks || []) add(source.url, `action:${source.kind}`, item.restaurantId);
  }
  for (const item of facts.records || []) for (const [field, kind] of [['menus','menu'],['reservations','reservation'],['ordering','ordering']]) for (const source of item[field] || []) add(source.url, kind, item.restaurantId);
  if (!release) for (const event of city.events || []) { add(event.ticketUrl, 'event_ticket', event.eventId || event.id); add(event.officialUrl || event.eventUrl || event.sourceUrl, 'event_source', event.eventId || event.id); }
  return {urls:[...urls.values()], activeCatalogRecords:activeIds.size};
}
