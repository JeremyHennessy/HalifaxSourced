import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import corrections from '../../restaurant-corrections.js';
const context = { window: {} };
vm.runInNewContext(await readFile(new URL('../../data/reviewed-restaurant-corrections.js', import.meta.url), 'utf8'), context);
export const reviewedCorrections = context.window.HALIFAX_RESTAURANT_CORRECTIONS;
export function applyReviewedCorrections(records) { return corrections.apply(records, reviewedCorrections); }
export function applyReviewedFactFieldRejections(records) { return corrections.applyFactFieldRejections(records, reviewedCorrections); }
vm.runInNewContext(await readFile(new URL('../../data/reviewed-place-resolutions.js', import.meta.url), 'utf8'), context);
export const reviewedPlaceResolutions = context.window.HALIFAX_REVIEWED_PLACE_RESOLUTIONS?.records || [];

// Review-backed links rendered by the browser are not necessarily present in
// historical first-party/fact snapshots. Keep them in the same release audit.
export function reviewedLocationLinks(restaurants, resolutions = reviewedPlaceResolutions) {
  const inactive = new Set(['permanently_closed', 'temporarily_closed', 'moved', 'replaced']);
  const active = new Set(restaurants.filter(item => !inactive.has(item.operatingStatus)).map(item => item.id));
  const links = new Map();
  function add(value, kind, restaurantId) {
    if (!active.has(restaurantId)) return;
    try {
      const url = new URL(String(value || ''));
      if (['http:', 'https:'].includes(url.protocol)) links.set(`${restaurantId}|${kind}|${url.href}`, { url: url.href, kind, restaurantId });
    } catch { /* Unknown links remain unknown, not guessed. */ }
  }
  for (const place of restaurants) for (const source of place.sources || []) if (source.type === 'menu') add(source.url, 'menu', place.id);
  for (const place of resolutions) {
    add(place.website, 'official_website', place.restaurantId);
    add(place.menuUrl, 'menu', place.restaurantId);
    for (const profile of place.socialProfiles || []) add(profile.profileUrl || profile.url, `social:${profile.platform}`, place.restaurantId);
  }
  return [...links.values()];
}
