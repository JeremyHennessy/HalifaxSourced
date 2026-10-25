import integrity from '../../source-integrity.js';

// Mirror the browser's ordering-primary assembly only to exclude established
// rejected primaries from existing coverage unions. Do not add new coverage or
// reinterpret raw fact counts, reservation keyword capability, or source clocks.
export function rejectedOrderingPrimaryIds(firstPartyRecords = [], factRecords = []) {
  const firstParty = new Map(firstPartyRecords.map(record => [record.restaurantId, record]));
  const facts = new Map(factRecords.map(record => [record.restaurantId, record]));
  const rejected = new Set();
  for (const id of new Set([...firstParty.keys(), ...facts.keys()])) {
    // app-source-signals retains first-party ordering links in source order.
    const links = (firstParty.get(id)?.relatedLinks || []).filter(link => link.kind === 'ordering');
    if (!links.length) {
      // app-place-facts admits structured additions only through safeUrl,
      // and quarantined fact roots cannot supply current actions.
      const fact = facts.get(id);
      if (fact && (!fact.sourceUrl || integrity.safeSource(fact.sourceUrl))) {
        links.push(...(fact.ordering || []).filter(link => integrity.safeSource(link?.url)));
      }
    }
    if (links.length && !integrity.primaryActionUrl(id, 'ordering', links)) rejected.add(id);
  }
  return rejected;
}
