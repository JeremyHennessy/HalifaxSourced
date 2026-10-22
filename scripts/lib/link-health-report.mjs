import assert from 'node:assert/strict';
import integrity from '../../source-integrity.js';

export const resultStates = ['ok','broken','restricted','transient','http_error','quarantined','held'];
export function linkCounts(results) {
  return {checked:results.length, reused:results.filter(row => row.reusedObservation === true).length, attempted:results.filter(row => row.attempted).length, unattempted:results.filter(row => !row.attempted).length, observed:results.filter(row => row.observedAt !== null).length, ...Object.fromEntries(resultStates.map(state => [state === 'http_error' ? 'httpError' : state, results.filter(row => row.state === state).length]))};
}
export const lifecycleContentLimit = 512000;
const redirects = new Set([301,302,303,307,308]);
const lifecycleError = 'Lifecycle candidates lack current successful official HTML content receipts';
const recent = (value, now) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) <= now && now - Date.parse(value) <= 86400000;

// A response header/status is not evidence that any venue prose was read. This
// marker is written only after bounded reading AND awaited cancellation finish.
// Consumers validate it independently; flattening candidates cannot add proof.
export function validateLifecycleContentReceipt(row, now = Date.now()) {
  assert(row && row.attempted === true && row.reusedObservation !== true && row.state === 'ok' && Number.isInteger(row.status) && row.status >= 200 && row.status < 300, lifecycleError);
  assert(Array.isArray(row.kinds) && row.kinds.includes('official_website') && Array.isArray(row.entityIds) && row.entityIds.length && row.entityIds.every(id => typeof id === 'string' && id), lifecycleError);
  assert(Array.isArray(row.officialEntityIds) && row.officialEntityIds.length && new Set(row.officialEntityIds).size === row.officialEntityIds.length && row.officialEntityIds.every(id => row.entityIds.includes(id)), lifecycleError);
  assert(integrity.safeSource(row.url) && integrity.safeSource(row.finalUrl) && integrity.sourceHost(row.url) === integrity.sourceHost(row.finalUrl), lifecycleError);
  assert(recent(row.attemptedAt,now) && recent(row.observedAt,now) && recent(row.assessedAt,now) && Date.parse(row.attemptedAt) <= Date.parse(row.observedAt) && Date.parse(row.observedAt) <= Date.parse(row.assessedAt), lifecycleError);
  assert(Array.isArray(row.receipts) && row.receipts.length && [1,2].includes(row.attempt), lifecycleError);
  for (const attempt of [1,2]) assert(row.receipts.filter(receipt => receipt.attempt === attempt).length <= 4, lifecycleError);
  let previous;
  for (const receipt of row.receipts) {
    assert(receipt && [1,2].includes(receipt.attempt) && Number.isInteger(receipt.status) && receipt.status >= 100 && receipt.status <= 599 && integrity.safeSource(receipt.url) && integrity.sourceHost(receipt.url) === integrity.sourceHost(row.url), lifecycleError);
    assert(recent(receipt.observedAt,now) && Date.parse(receipt.observedAt) >= Date.parse(previous?.observedAt || row.attemptedAt) && Date.parse(receipt.observedAt) <= Date.parse(row.assessedAt), lifecycleError);
    if (!previous) assert(receipt.url === row.url && receipt.attempt === 1, lifecycleError);
    else if (receipt.attempt !== previous.attempt) assert(previous.attempt === 1 && receipt.attempt === 2 && [404,410].includes(previous.status) && receipt.url === row.url, lifecycleError);
    else assert(redirects.has(previous.status) && previous.redirectUrl === receipt.url, lifecycleError);
    previous = receipt;
  }
  assert(previous.url === row.finalUrl && previous.status === row.status && previous.observedAt === row.observedAt && previous.attempt === row.attempt, lifecycleError);
  const content = row.contentReceipt;
  assert(content && content.version === 1 && content.url === previous.url && content.status === previous.status && content.observedAt === previous.observedAt, lifecycleError);
  assert(['text/html','application/xhtml+xml'].includes(previous.mediaType) && content.mediaType === previous.mediaType && content.maxBytes === lifecycleContentLimit && Number.isInteger(content.bytesRead) && content.bytesRead >= 0 && content.bytesRead <= lifecycleContentLimit, lifecycleError);
  assert(content.bytesRead > 0 || !row.lifecycle?.length, lifecycleError);
  assert(['eof','byte_limit'].includes(content.termination) && (content.termination !== 'byte_limit' || content.bytesRead === lifecycleContentLimit) && content.readCompleted === true && content.cancelCompleted === true, lifecycleError);
  assert(recent(content.completedAt,now) && Date.parse(content.completedAt) >= Date.parse(row.observedAt) && Date.parse(content.completedAt) <= Date.parse(row.assessedAt), lifecycleError);
  return content;
}
export function lifecycleEligible(row, now = Date.now()) {
  try { validateLifecycleContentReceipt(row,now); return true; } catch { return false; }
}
export function lifecycleCandidates(results, enabled = true, now = Date.now()) {
  assert(Array.isArray(results), lifecycleError);
  return results.flatMap(row => {
    assert(Array.isArray(row.lifecycle), lifecycleError);
    if (!row.lifecycle.length) return [];
    assert(enabled === true, lifecycleError);
    validateLifecycleContentReceipt(row,now);
    assert(row.contentReceipt.bytesRead > 0, lifecycleError);
    return row.lifecycle.map(candidate => ({...candidate, sourceUrl:row.url, observedAt:row.observedAt, restaurantIds:row.officialEntityIds}));
  });
}
// Independent consumers cannot treat a flattened array or a new build timestamp
// as proof that source language was actually observed in this release.
export function currentLifecycleCandidates(report, now = Date.now(), catalog) {
  if (report.version !== 3) return [];
  assert(report.complete === true && recent(report.generatedAt,now) && typeof report.lifecycleExtraction === 'boolean' && Array.isArray(report.lifecycleCandidates), lifecycleError);
  const candidates = lifecycleCandidates(report.results, report.lifecycleExtraction, now);
  for (const row of report.results.filter(row => row.lifecycle.length)) {
    assert(Date.parse(row.assessedAt) <= Date.parse(report.generatedAt), lifecycleError);
    if (catalog !== undefined) {
      assert(Array.isArray(catalog?.restaurants), lifecycleError);
      const websiteKey = value => { const url = new URL(value); url.hash = ''; url.hostname = integrity.sourceHost(value); return url.href; };
      for (const id of row.officialEntityIds) {
        const restaurant = catalog.restaurants.find(item => item.id === id);
        assert(restaurant && integrity.safeSource(restaurant.website) && websiteKey(restaurant.website) === websiteKey(row.url), 'Lifecycle official entity does not match its catalog website');
      }
    }
  }
  assert.deepEqual(report.lifecycleCandidates,candidates,lifecycleError);
  return candidates;
}
