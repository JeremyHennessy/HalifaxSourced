// Collapse explicit team aliases or the same public-library detail URL and occurrence.
// Same venue/time or similar title alone is never sufficient.
const aliases = new Map([
  ['halifax mooseheads', 'halifax-mooseheads'], ['mooseheads', 'halifax-mooseheads'],
  ['rouyn noranda', 'rouyn-noranda'], ['rouyn noranda huskies', 'rouyn-noranda'],
  ['cape breton', 'cape-breton'], ['cape breton eagles', 'cape-breton'],
  ['charlottetown', 'charlottetown'], ['charlottetown islanders', 'charlottetown'],
  ['saint john', 'saint-john'], ['saint john sea dogs', 'saint-john'],
  ['quebec', 'quebec'], ['quebec remparts', 'quebec'],
  ['moncton', 'moncton'], ['moncton wildcats', 'moncton'], ['moncton wildcats home opener', 'moncton'],
  ['val d or', 'val-d-or'], ['val d or foreurs', 'val-d-or'],
  ['shawinigan', 'shawinigan'], ['shawinigan cataractes', 'shawinigan'],
  ['newfoundland', 'newfoundland'], ['newfoundland regiment', 'newfoundland'],
  ['blainville boisbriand', 'blainville-boisbriand'], ['blainville boisbriand armada', 'blainville-boisbriand'],
  ['gatineau', 'gatineau'], ['gatineau olympiques', 'gatineau'],
  ['baie comeau', 'baie-comeau'], ['baie comeau drakkar', 'baie-comeau'],
  ['chicoutimi', 'chicoutimi'], ['chicoutimi sagueneens', 'chicoutimi'],
  ['rimouski', 'rimouski'], ['rimouski oceanic', 'rimouski'],
  ['sherbrooke', 'sherbrooke'], ['sherbrooke phoenix', 'sherbrooke'],
  ['victoriaville', 'victoriaville'], ['victoriaville tigres', 'victoriaville'],
  ['drummondville', 'drummondville'], ['drummondville voltigeurs', 'drummondville']
]);
const normalize = value => String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const venueAliases = new Map([
  ['scotiabank centre', 'scotiabank-centre-halifax'],
  ['scotiabank center', 'scotiabank-centre-halifax']
]);
export function canonicalEventKey(event) {
  if (['official_library_location_calendar', 'public_library_calendar'].includes(event.sourceKind)) {
    try {
      const url = new URL(event.eventUrl);
      const stamp = Date.parse(event.startAt);
      const detail = url.pathname.match(/^\/(?:v2\/)?events\/([a-f0-9]+)\/?$/);
      if (url.hostname === 'halifax.bibliocommons.com' && detail && Number.isFinite(stamp)) {
        // BiblioCommons serves the same occurrence at both /events/:id and
        // /v2/events/:id. Treating those routes as different can manufacture
        // a removal when source order changes during a refresh.
        return `library|${url.hostname}/events/${detail[1]}|${stamp}`;
      }
    } catch { /* Unqualified URL: never infer identity from a title. */ }
  }
  const teams=normalize(event.title).split(/\s+vs?\s+/).map(name=>aliases.get(name));
  const venue=event.venueId || venueAliases.get(normalize(event.venueName)) || normalize(event.venueName);
  const stamp=Date.parse(event.startAt);
  if(teams.length!==2 || teams.some(team=>!team) || !venue || !Number.isFinite(stamp)) return null;
  return `${teams.join('|')}|${venue}|${stamp}`;
}
export function dedupeCanonicalEvents(events, keyForEvent = canonicalEventKey) {
  const seen=new Map(), output=[];
  for(const event of events) {
    const key=keyForEvent(event), existing=key && seen.get(key);
    if(!existing) {const copy={...event};output.push(copy);if(key)seen.set(key,copy);continue;}
    existing.sourceUrls=[...new Set([...(existing.sourceUrls||[]),existing.eventUrl,existing.sourceUrl,existing.ticketUrl,...(event.sourceUrls||[]),event.eventUrl,event.sourceUrl,event.ticketUrl].filter(Boolean))];
    existing.sourceIds=[...new Set([...(existing.sourceIds||[]),existing.sourceId,...(event.sourceIds||[]),event.sourceId].filter(Boolean))];
    existing.duplicateEventIds=[...new Set([...(existing.duplicateEventIds||[]),event.id,...(event.duplicateEventIds||[])].filter(id => id && id !== existing.id))];
  }
  return output;
}

// Refreshes may improve titles or change source order, but published occurrence
// IDs are durable user data (saved events and calendar UIDs). Match only the
// same strict identities already admitted by canonicalEventKey. As a bounded
// fallback, one exact source + event URL + occurrence interval may keep its ID
// when the publisher adds a status prefix such as "SOLD OUT". A shared URL,
// changed source or changed occurrence is never sufficient. Do not copy stale
// content or observation dates.
export function preservePublishedEventIds(events, previousEvents) {
  const previousByKey = new Map();
  const previousByOccurrence = new Map();
  const titleWithoutSoldOut = value => {
    const match = String(value || '').match(/^\s*sold\s*out\s*[:\-–—]\s*(.+)$/i);
    return match ? normalize(match[1]) : null;
  };
  const occurrenceKey = event => {
    try {
      const parsed = new URL(event.eventUrl);
      const stamp = Date.parse(event.startAt);
      const endStamp = Date.parse(event.endAt || event.startAt);
      if (!['https:', 'http:'].includes(parsed.protocol) || !event.sourceId || !Number.isFinite(stamp) || !Number.isFinite(endStamp)) return null;
      parsed.hash = '';
      return `${event.sourceId}|${parsed.href.replace(/\/$/, '')}|${stamp}|${endStamp}`;
    } catch { return null; }
  };
  for (const event of previousEvents) {
    const key = canonicalEventKey(event);
    if (!event.id) continue;
    if (key) {
      const list = previousByKey.get(key) || [];
      list.push(event);
      previousByKey.set(key, list);
    }
    const occurrence = occurrenceKey(event);
    if (occurrence) {
      const list = previousByOccurrence.get(occurrence) || [];
      list.push(event);
      previousByOccurrence.set(occurrence, list);
    }
  }
  const current = dedupeCanonicalEvents(events);
  const output = current.map(event => {
    const canonicalMatches = previousByKey.get(canonicalEventKey(event)) || [];
    const occurrenceMatches = (previousByOccurrence.get(occurrenceKey(event)) || []).filter(previous =>
      titleWithoutSoldOut(event.title) === normalize(previous.title)
      || titleWithoutSoldOut(previous.title) === normalize(event.title));
    const matches = canonicalMatches.length ? canonicalMatches : occurrenceMatches;
    const ids = new Set(matches.map(previous => previous.id));
    if (ids.size > 1) throw new Error('Ambiguous published event identity: ' + [...ids].join(', '));
    if (!matches.length) return event;
    const previous = matches[0];
    const aliases = [...new Set([
      ...(previous.duplicateEventIds || []), ...(event.duplicateEventIds || []), event.id
    ].filter(id => id && id !== previous.id))];
    return { ...event, id: previous.id, duplicateEventIds: aliases };
  });
  assertUniqueEventIds(output);
  return output;
}

export function assertUniqueEventIds(events) {
  const owners = new Map();
  for (const event of events) {
    for (const id of [event.id, ...(event.duplicateEventIds || [])].filter(Boolean)) {
      if (owners.has(id) && owners.get(id) !== event) throw new Error('Conflicting event identity: ' + id);
      owners.set(id, event);
    }
  }
}
