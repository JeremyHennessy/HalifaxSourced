import { createHash } from 'node:crypto';

export const REVIEWED_EVENT_QUARANTINE_PATH = 'data/quarantine/library-store-navigation-20261027.json';
const GUARD_FIELDS = ['id', 'sourceId', 'title', 'eventUrl', 'startAt', 'endAt', 'observedAt'];

// Stable JSON hashing preserves the complete original evidence, independent of
// object-key order. This is not a title/URL/day heuristic or a source freshness clock.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export function eventRecordSha256(record) {
  return createHash('sha256').update(JSON.stringify(canonical(record))).digest('hex');
}

export function validateReviewedEventQuarantine(archive) {
  if (archive?.version !== 1 || archive.disposition !== 'reviewed_invalid_navigation_extraction'
    || !archive.archiveId || !Number.isFinite(Date.parse(archive.decisionReviewedAt))
    || !Array.isArray(archive.records) || archive.rawArchiveRecordCount !== archive.records.length
    || !Array.isArray(archive.activeQuarantineIds) || !Array.isArray(archive.protectedDetailIds)) {
    throw new Error('Invalid reviewed event quarantine archive');
  }
  const records = new Map();
  for (const entry of archive.records) {
    const expected = entry.expected, raw = entry.rawAcceptedRecord;
    if (!expected?.id || records.has(expected.id) || !raw
      || GUARD_FIELDS.some(field => typeof expected[field] !== 'string' || !expected[field] || expected[field] !== raw[field])
      || !/^[a-f0-9]{64}$/.test(entry.expectedRawRecordCanonicalSha256 || '')
      || eventRecordSha256(raw) !== entry.expectedRawRecordCanonicalSha256
      || !Array.isArray(entry.evidence) || !entry.evidence.length) {
      throw new Error(`Invalid reviewed event quarantine record: ${expected?.id || 'unknown'}`);
    }
    records.set(expected.id, entry);
  }
  const active = new Map();
  for (const id of archive.activeQuarantineIds) {
    if (!records.has(id) || active.has(id) || archive.protectedDetailIds.includes(id)) {
      throw new Error(`Invalid active event quarantine decision: ${id}`);
    }
    active.set(id, records.get(id));
  }
  return active;
}

/** Pure exact-record projection. No I/O, input mutation, source requests or clocks.
 * Changed reviewed IDs stay in events and produce a blocking mismatch receipt.
 * A new/unreviewed ID is never removed, even with the same title/URL/occurrence.
 * Removing an ID from activeQuarantineIds restores it without deleting the archive.
 */
export function applyReviewedEventQuarantine(events, archive = null) {
  const decisions = archive ? validateReviewedEventQuarantine(archive) : new Map();
  const kept = [], quarantined = [], mismatches = [];
  for (const event of events) {
    const entry = decisions.get(event.id);
    if (!entry) { kept.push(event); continue; }
    const mismatchedFields = GUARD_FIELDS.filter(field => event[field] !== entry.expected[field]);
    // Require the whole archived raw record, too: aliases, evidence, source kind
    // or any changed content must never disappear under an earlier review.
    if (eventRecordSha256(event) !== entry.expectedRawRecordCanonicalSha256) mismatchedFields.push('rawRecordSha256');
    if (mismatchedFields.length) {
      kept.push(event);
      mismatches.push({ eventId: event.id, sourceId: event.sourceId || null, reason: 'reviewed_quarantine_record_changed', mismatchedFields });
    } else {
      quarantined.push({ ...entry.expected, rawRecordSha256: entry.expectedRawRecordCanonicalSha256 });
    }
  }
  const bySource = {};
  for (const event of quarantined) bySource[event.sourceId] = (bySource[event.sourceId] || 0) + 1;
  return {
    events: kept,
    blocked: mismatches.length > 0,
    receipt: {
      archiveId: archive?.archiveId || null,
      activeDecisionCount: decisions.size,
      inputEventCount: events.length,
      keptEventCount: kept.length,
      quarantinedCount: quarantined.length,
      quarantinedBySource: bySource,
      quarantined,
      mismatchCount: mismatches.length,
      mismatches
    }
  };
}
