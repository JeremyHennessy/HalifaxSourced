import { sourceRunHealth } from './source-run-health.mjs';
import { createHash } from 'node:crypto';

// Observation/run clocks are receipts, not content changes. Expiry/start/end and
// review/rights verification dates are intentionally NOT ignored. Processing
// clocks are scoped to their known location so an unrelated appliedAt survives.
const receiptKeys = new Set(['generatedAt', 'observedAt', 'durationMs', 'fetchedAt', 'lastAttemptAt']);
const processingClockPaths = new Set(['sanitizedAt', 'supplementalAt', 'manualAdditions.appliedAt', 'entityResolution.appliedAt',
  'events.sourceFailure.attemptedAt', 'events.sourceFailure.previousGeneratedAt']);
export function meaningfulValue(value, depth = 0, path = []) {
  if (Array.isArray(value)) return value.map(item => meaningfulValue(item, depth + 1, path));
  if (path[0] === 'refreshObservations' && path.at(-1) === 'state' && ['changed','unchanged','refreshed'].includes(value)) return 'successful_observation';
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter(key => !(depth === 0 && key === 'runHealth') && !(path[0] === 'refreshObservations' && ['checkedAt','postsReceived','newOrChangedPosts'].includes(key)) && !receiptKeys.has(key) && !(depth === 0 && key === 'range') && !processingClockPaths.has([...path, key].join('.')))
    .map(key => [key, meaningfulValue(value[key], depth + 1, [...path, key])]));
  return value;
}
export function snapshotValue(text) {
  try { return JSON.parse(text); } catch {}
  const match = text.match(/^\s*(?:\/\/[^\n]*\n)*\s*window\.[A-Z_]+\s*=\s*([\s\S]*);\s*$/);
  if (match) { try { return JSON.parse(match[1]); } catch {} }
  return text;
}
export function meaningfulHash(text) { return createHash('sha256').update(JSON.stringify(meaningfulValue(snapshotValue(text)))).digest('hex'); }
export function iso(value) {
  const time = typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
export function latest(values) { return values.map(iso).filter(Boolean).sort().at(-1) || null; }
export function freshness(observedAt, now, targetHours) {
  const stamp = iso(observedAt), current = iso(now);
  if (!stamp || !current || !Number.isFinite(targetHours) || targetHours <= 0) return 'unknown';
  const age = (Date.parse(current) - Date.parse(stamp)) / 36e5;
  if (age < -1) return 'unknown';
  return age > targetHours * 2 ? 'stale' : age > targetHours ? 'warn' : 'fresh';
}

const rows = value => Array.isArray(value) ? value.filter(row => row && typeof row === 'object') : [];
const sourceId = row => row.sourceId || row.restaurantId || row.platform || row.id || null;
const attemptTime = row => row.attempted === false ? null : iso(row.observedAt || row.checkedAt || row.lastAttemptAt);
const failedStates = new Set(['failed', 'error', 'blocked', 'restricted', 'unavailable', 'inconclusive', 'held', 'unattempted']);
function failed(row) {
  return Boolean(row.error) || (typeof row.status === 'number' && (row.status < 200 || row.status >= 400)) ||
    failedStates.has(String(row.status || '').toLowerCase()) || failedStates.has(row.state);
}
const refreshSucceeded = row => row.attempted !== false && ['refreshed', 'changed', 'unchanged'].includes(row.state);
const failureReason = row => row.reason || row.error || (typeof row.status === 'number' ? `http_${row.status}` : row.status || row.state || 'source_failure');
const severity = (age, hasFailures, unknownCount) => age === 'stale' ? 'stale' : unknownCount ? 'unknown' : age === 'fresh' && hasFailures ? 'warn' : age;

export function sourceEntry({id, label, payload, path, targetHours, now, sourceCommitSha, sourceStats = false}) {
  const records = rows(payload.records || payload.events || payload.results || (payload.posts?.length ? payload.posts : payload.signals) || []);
  const stats = sourceStats ? rows(payload.sourceStats) : [];
  const refresh = rows(payload.refreshObservations);
  const explicitFailures = rows(payload.failures);
  const validObservation = value => {
    const stamp = iso(value);
    return stamp && freshness(stamp, now, targetHours) !== 'unknown' ? stamp : null;
  };
  const successfulRecords = records.filter(row => !failed(row));
  const successfulAttempts = [...stats.filter(row => row.status === 'ok' && !failed(row)), ...refresh.filter(refreshSucceeded)];
  // Include the carried records themselves, not just this run's successful source
  // summaries: a fresh attempt must not rejuvenate previously accepted evidence.
  const observations = [...successfulRecords.map(row => validObservation(row.observedAt)),
    ...successfulAttempts.map(row => validObservation(attemptTime(row)))];
  const knownObservations = observations.filter(Boolean).sort();
  const observedAt = knownObservations.at(-1) || null;
  const oldestObservedAt = knownObservations[0] || null;
  const unknownObservationCount = observations.length - knownObservations.length;
  const attempts = [...records, ...stats, ...refresh, ...explicitFailures].filter(row => row.attempted !== false).map(attemptTime);
  const unknownAttemptCount = attempts.filter(value => !value).length;
  const failureRows = [...stats.filter(row => row.status !== 'ok' || failed(row)), ...records.filter(failed),
    ...refresh.filter(failed), ...explicitFailures];
  const failureMap = new Map();
  for (const row of failureRows) {
    const item = {id:sourceId(row), reason:failureReason(row), lastAttemptAt:attemptTime(row)};
    const key = JSON.stringify([item.id, item.reason]);
    item.lastAttemptAt = latest([failureMap.get(key)?.lastAttemptAt, item.lastAttemptAt]);
    failureMap.set(key, item);
  }
  const failures = [...failureMap.values()];

  const sources = new Map();
  const ensureSource = row => {
    const key = sourceId(row);
    if (!key) return null;
    if (!sources.has(key)) sources.set(key, {id:key, attempts:[], observations:[], failures:[], status:'unknown'});
    return sources.get(key);
  };
  for (const row of records) {
    const source = ensureSource(row); if (!source) continue;
    if (row.attempted !== false) source.attempts.push(attemptTime(row));
    if (!failed(row)) { source.observations.push(validObservation(row.observedAt)); source.status = 'ok'; }
  }
  for (const row of [...stats, ...refresh]) {
    const source = ensureSource(row); if (!source) continue;
    if (row.attempted !== false) source.attempts.push(attemptTime(row));
    source.status = row.state || row.status || 'unknown';
    if ((stats.includes(row) && row.status === 'ok' && !failed(row)) || refreshSucceeded(row)) source.observations.push(validObservation(attemptTime(row)));
  }
  for (const row of failureRows) {
    const source = ensureSource(row); if (!source) continue;
    if (row.attempted !== false) source.attempts.push(attemptTime(row)); source.failures.push(failureReason(row));
    source.status = row.state || (typeof row.status === 'string' ? row.status : 'failed');
  }
  return {
    id,label,path,targetHours,runHealth:sourceRunHealth(payload),lastAttemptAt:unknownAttemptCount ? null : latest(attempts),
    latestRecordedAttemptAt:latest(attempts),unknownAttemptCount,lastSuccessfulObservationAt:observedAt,
    oldestSuccessfulObservationAt:oldestObservedAt,snapshotGeneratedAt:iso(payload.generatedAt),reviewedAt:null,
    reviewState:'accepted-input-in-release',publicationState:'included-in-this-release',sourceCommitSha,
    semanticSha256:meaningfulHash(JSON.stringify(payload)),observationCount:knownObservations.length,unknownObservationCount,
    recordCount:records.length,freshness:severity(freshness(oldestObservedAt,now,targetHours),failures.length,unknownObservationCount),
    freshnessAssessedAt:iso(now),
    sources:[...sources.values()].map(source => {
      const known = source.observations.filter(Boolean).sort();
      const unknown = source.observations.length - known.length;
      return {id:source.id,lastAttemptAt:source.attempts.some(value => !value) ? null : latest(source.attempts),
        latestRecordedAttemptAt:latest(source.attempts),lastSuccessfulObservationAt:known.at(-1) || null,
        oldestSuccessfulObservationAt:known[0] || null,status:source.status,
        freshness:severity(freshness(known[0],now,targetHours),source.failures.length,unknown)};
    }),
    // A single new success cannot postpone collecting the oldest accepted input.
    // Missing/future clocks keep the lane due for inspection, never invent a date.
    nextDueAt:oldestObservedAt && !unknownObservationCount ? new Date(Date.parse(oldestObservedAt)+targetHours*36e5).toISOString() : null,
    failures
  };
}
