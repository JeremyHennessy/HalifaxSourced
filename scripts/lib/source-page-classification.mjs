// Reachability and outbound ownership are not exact-location or content approval.
export function sourcePageDisposition(candidate, details) {
  let url;
  try { url = new URL(details.url || candidate.url); } catch { return { state: 'rejected', reason: 'invalid_destination' }; }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (['facebook.com','instagram.com','twitter.com','x.com','youtube.com','tiktok.com'].some(h => host === h || host.endsWith('.'+h))) {
    return { state: 'needs-review', reason: 'social_profile_is_not_verified_menu_or_special' };
  }
  if (/\/(?:wp-admin|wp-login\.php|shortcodes?|login|sign-?in|admin)(?:\/|$)/i.test(url.pathname)) {
    return { state: 'rejected', reason: 'administrative_or_template_destination' };
  }
  if (details.locationValidated !== true) {
    return { state: 'needs-review', reason: details.sourceKind === 'official_outbound_link' ? 'outbound_link_location_unverified' : 'exact_location_unverified' };
  }
  // Scoped location verification alone still does not establish offer terms or dates.
  return { state: 'verified', reason: 'scoped_location_verified_pointer' };
}
export function preserveAcceptedSources(previous, verified) {
  const key = item => JSON.stringify([item.restaurantId,item.kind,item.url]);
  const accepted = new Map(previous.map(item => [key(item),item]));
  for (const item of verified) accepted.set(key(item),item);
  return [...accepted.values()].sort((a,b) => a.restaurantId.localeCompare(b.restaurantId) || a.url.localeCompare(b.url));
}
