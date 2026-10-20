// Collection timestamps describe this attempt, never the age of carried evidence.
export const inactiveFactStatuses = new Set(['permanently_closed', 'temporarily_closed', 'moved', 'replaced']);
export function blockedFactReason(reason) {
  return /^(?:http_401|http_403|robots_disallow|quarantined_)/.test(String(reason || ''));
}
function evidence(value) {
  if (Array.isArray(value)) return value.map(evidence);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['observedAt', 'lastVerifiedAt', 'verifiedAt'].includes(key))
    .map(([key, item]) => [key, evidence(item)]));
  return value;
}
export function reconcilePlaceFacts({ previous, fresh, catalog, observations, checkedAt }) {
  const active = new Set(catalog.filter(place => !inactiveFactStatuses.has(place.operatingStatus)).map(place => place.id));
  const current = new Map(fresh.map(record => [record.restaurantId, record]));
  const attempts = new Map(observations.map(item => [item.restaurantId, item]));
  const sourceHistory = [...(previous.sourceHistory || [])];
  const remember = (record, reason) => {
    const key = JSON.stringify(record);
    if (!sourceHistory.some(entry => JSON.stringify(entry.record) === key)) sourceHistory.push({ record, reason, retainedAt: checkedAt });
  };
  let retainedRecords = 0;
  for (const record of previous.records || []) {
    const id = record.restaurantId;
    if (!active.has(id)) { remember(record, 'inactive_or_noncanonical'); continue; }
    const replacement = current.get(id);
    if (!replacement) {
      current.set(id, record); // Exact old provenance, including nested evidence dates.
      retainedRecords++;
      if (!attempts.has(id)) attempts.set(id, { restaurantId: id, state: 'not_attempted', reason: 'no_eligible_source_or_limit', checkedAt, attempted: false });
    } else {
      const changed = JSON.stringify(evidence(record)) !== JSON.stringify(evidence(replacement));
      attempts.get(id).state = changed ? 'changed' : 'unchanged';
      if (changed) remember(record, 'superseded_by_source_observation');
    }
  }
  for (const record of fresh) if (attempts.get(record.restaurantId)?.state === 'refreshed') attempts.get(record.restaurantId).state = 'changed';
  const refreshObservations = [...attempts.values()];
  const refreshCounts = Object.fromEntries(['changed', 'unchanged', 'failed', 'blocked', 'inconclusive', 'not_attempted'].map(state => [state, refreshObservations.filter(item => item.state === state).length]));
  return { records: [...current.values()].filter(record => active.has(record.restaurantId)), sourceHistory, retainedRecords, refreshObservations, refreshCounts };
}
