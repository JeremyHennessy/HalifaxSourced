// Only explicit team aliases are collapsed. Same venue/time alone is never sufficient.
const aliases = new Map([
  ['halifax mooseheads', 'halifax-mooseheads'], ['mooseheads', 'halifax-mooseheads'],
  ['rouyn noranda', 'rouyn-noranda'], ['rouyn noranda huskies', 'rouyn-noranda'],
  ['drummondville', 'drummondville'], ['drummondville voltigeurs', 'drummondville']
]);
const normalize = value => String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const venueAliases = new Map([
  ['scotiabank centre', 'scotiabank-centre-halifax'],
  ['scotiabank center', 'scotiabank-centre-halifax']
]);
export function canonicalEventKey(event) {
  const teams=normalize(event.title).split(/\s+vs?\s+/).map(name=>aliases.get(name));
  const venue=event.venueId || venueAliases.get(normalize(event.venueName)) || normalize(event.venueName);
  const stamp=Date.parse(event.startAt);
  if(teams.length!==2 || teams.some(team=>!team) || !venue || !Number.isFinite(stamp)) return null;
  return `${teams.join('|')}|${venue}|${stamp}`;
}
export function dedupeCanonicalEvents(events) {
  const seen=new Map(), output=[];
  for(const event of events) {
    const key=canonicalEventKey(event), existing=key && seen.get(key);
    if(!existing) {const copy={...event};output.push(copy);if(key)seen.set(key,copy);continue;}
    existing.sourceUrls=[...new Set([...(existing.sourceUrls||[]),existing.eventUrl,existing.sourceUrl,existing.ticketUrl,...(event.sourceUrls||[]),event.eventUrl,event.sourceUrl,event.ticketUrl].filter(Boolean))];
    existing.sourceIds=[...new Set([...(existing.sourceIds||[]),existing.sourceId,...(event.sourceIds||[]),event.sourceId].filter(Boolean))];
    existing.duplicateEventIds=[...new Set([...(existing.duplicateEventIds||[]),event.id,...(event.duplicateEventIds||[])].filter(Boolean))];
  }
  return output;
}
