/* Shared, conservative location identity for browser and catalog export. */
(function (root) {
  'use strict';
  const words = value => String(value ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  const nameKey = value => words(value).replace(/\bthe\b/g, '').replace(/\s+/g, '');
  function address(value, record = {}) {
    const tags = record.osm?.rawTags || record.rawTags || {};
    const raw = String(value || (tags['addr:housenumber'] && tags['addr:street'] ? `${tags['addr:housenumber']} ${tags['addr:street']}${tags['addr:city'] ? ', ' + tags['addr:city'] : ''}` : '')).trim();
    if (!raw) return null;
    const segments = raw.split(',');
    const first = words(segments[0]);
    // Ambiguous civic ranges and unit-first addresses require review, not guessing.
    if (/^\s*\d+\s*[-/]/.test(raw)) return null;
    const match = first.match(/^(\d+[a-z]?)\s+(.+)$/);
    if (!match) return null;
    const explicitUnit = words(raw).match(/\b(?:unit|suite)\s+([a-z0-9]+)\b/)?.[1] || raw.match(/#\s*([a-z0-9]+)/i)?.[1]?.toLowerCase() || '';
    const tagUnit = words(tags['addr:unit'] || record.unit);
    const unit = explicitUnit || tagUnit;
    const suffixes = { street:'st', road:'rd', avenue:'ave', boulevard:'blvd', drive:'dr', lane:'ln', place:'pl', court:'ct', crescent:'cres', highway:'hwy', terrace:'terr' };
    const street = match[2].split(/\b(?:unit|suite)\b/)[0].trim().replace(/\b(street|road|avenue|boulevard|drive|lane|place|court|crescent|highway|terrace)\b/g, word => suffixes[word]);
    const parsedLocality = segments.slice(1).map(words).filter(part => part && !/^(?:unit|suite)\b/.test(part) && !/^\d+$/.test(part) && !/^(?:ns|nova scotia|canada)\b/.test(part))[0]?.replace(/\b[a-z]\d[a-z]\s*\d[a-z]\d\b/g, '').replace(/\b(?:ns|nova scotia|canada)\b/g, '').trim() || '';
    const tagCity = words(tags['addr:city'] || record.city);
    const locality = parsedLocality || tagCity;
    return { civic:match[1], street, unit, locality, inconsistent: Boolean(explicitUnit && tagUnit && explicitUnit !== tagUnit || parsedLocality && tagCity && parsedLocality !== tagCity) };
  }
  function distance(a, b) {
    const values = [a?.lat, a?.lon ?? a?.lng, b?.lat, b?.lon ?? b?.lng];
    if (!values.every(value => typeof value === 'number' && Number.isFinite(value))) return null;
    const [lat1, lon1, lat2, lon2] = values;
    return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(Math.sin((lat2-lat1)*Math.PI/360)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin((lon2-lon1)*Math.PI/360)**2)));
  }
  function location(a, b) {
    const left = address(a.address, a), right = address(b.address, b), metres = distance(a.coordinates, b.coordinates);
    if (left?.inconsistent || right?.inconsistent) return 'conflict';
    if ((!left || !right) && a.address && b.address && words(a.address) !== words(b.address)) return 'conflict';
    if (left && right) {
      if (left.civic !== right.civic || left.street !== right.street || (left.unit && right.unit && left.unit !== right.unit)) return 'different';
      if (left.locality && right.locality && left.locality !== right.locality) return 'conflict';
      if (metres !== null && metres > 250) return 'conflict';
      if (Boolean(left.unit) !== Boolean(right.unit)) return 'unknown';
      return left.locality && right.locality || metres !== null && metres <= 75 ? 'same' : 'unknown';
    }
    if (metres !== null && metres > 250) return 'different';
    // Coordinate proximity alone can be a mall, market or approximate geocode.
    return 'unknown';
  }
  function decide(existing, incoming, aliases = []) {
    const explicit = Boolean(existing.id && incoming.id && existing.id === incoming.id) || (existing.aliasIds || []).includes(incoming.id) || aliases.some(alias => alias.from === incoming.id && alias.to === existing.id && alias.reviewedAt && alias.reason);
    const sameName = nameKey(existing.name) && nameKey(existing.name) === nameKey(incoming.name);
    if (!explicit && !sameName) return { state:'distinct', reason:'different_identity' };
    const place = location(existing, incoming);
    if (place === 'different' || place === 'conflict') return { state:explicit ? 'review' : place === 'different' ? 'distinct' : 'review', reason:explicit ? 'explicit_identity_location_conflict' : 'location_' + place };
    if (explicit) return { state:'match', reason:'reviewed_or_stable_identity', reviewedAlias: aliases.find(alias => alias.from === incoming.id && alias.to === existing.id) || null };
    return place === 'same' ? { state:'match', reason:'name_and_exact_location' } : { state:'review', reason:'name_without_decisive_location' };
  }
  function find(records, incoming, aliases = []) {
    const decisions = records.map(record => ({ record, ...decide(record, incoming, aliases) }));
    const matches = decisions.filter(item => item.state === 'match');
    const conflicts = decisions.filter(item => item.state === 'review');
    if (matches.length === 1 && !conflicts.some(item => item.reason === 'explicit_identity_location_conflict')) return matches[0];
    if (matches.length > 1 || conflicts.length) return { state:'review', reason:matches.length > 1 ? 'multiple_location_matches' : conflicts[0].reason, candidateIds:[...matches, ...conflicts].map(item => item.record.id) };
    return { state:'distinct', reason:'no_matching_location' };
  }
  const unique = values => [...new Set(values.filter(Boolean))];
  function merge(target, incoming, decision = {}) {
    if (target.id !== incoming.id) {
      target.mergedIdentityEvidence = [...(target.mergedIdentityEvidence || []).filter(item => item.id !== incoming.id), {
        id: incoming.id, name: incoming.name, address: incoming.address || null, coordinates: incoming.coordinates || null,
        phone: incoming.phone || null, sources: incoming.sources || [], basis: decision.reason || 'location_resolved',
        reviewedAlias: decision.reviewedAlias || null
      }];
    }
    target.aliasIds = unique([...(target.aliasIds || []), ...(incoming.aliasIds || []), incoming.id]).filter(id => id !== target.id);
    for (const field of ['category','address','phone','website','openingHours','coordinates','neighborhood','osm','summary','operatingStatus','operatingStatusEvidence','seasonality','lifecycleSchedule','ownershipEvidence']) target[field] ||= incoming[field];
    for (const field of ['cuisines','vibe']) target[field] = unique([...(target[field] || []), ...(incoming[field] || [])]);
    for (const [field, key] of [['sources', value => `${value.type}|${value.url}`], ['specials', value => `${value.title}|${value.cadence || ''}`], ['socialProfiles', value => value.url || value.profileUrl]]) target[field] = [...new Map([...(target[field] || []), ...(incoming[field] || [])].map(value => [key(value), value])).values()];
    target.freshnessDate = [target.freshnessDate, incoming.freshnessDate].filter(Boolean).sort().at(-1) || null;
    return target;
  }
  function applyResolution(record, resolutions = []) {
    const resolution = resolutions.find(item => item.restaurantId === record.id);
    if (!resolution) return record;
    record.neighborhood = resolution.neighborhood || record.neighborhood;
    for (const field of ['address', 'coordinates', 'phone', 'openingHours', 'website']) record[field] ||= resolution[field];
    record.operatingStatus = resolution.operatingStatus || record.operatingStatus;
    record.socialProfiles = [...new Map([...(record.socialProfiles || []), ...(resolution.socialProfiles || [])].map(item => [item.url || item.profileUrl, item])).values()];
    record.reviewedPlaceResolution = resolution;
    const source = { label: 'Reviewed neighbourhood resolution', type: 'business_district_directory', url: resolution.sourceUrl, status: resolution.reviewState, observedAt: resolution.observedAt };
    const sources = [source, ...(resolution.menuUrl ? [{ label: 'Official menu', type: 'menu', url: resolution.menuUrl, status: 'verified', observedAt: resolution.observedAt }] : [])];
    record.sources = [...new Map([...(record.sources || []), ...sources].map(item => [`${item.type}|${item.url}`, item])).values()];
    return record;
  }
  const api = { nameKey, address, location, decide, find, merge, applyResolution };
  root.HalifaxRestaurantIdentity = api;
  if (root.window) root.window.HalifaxRestaurantIdentity = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
