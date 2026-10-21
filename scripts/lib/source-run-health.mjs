// Run outcome is distinct from retained evidence age, workflow success and approval.
// Legacy snapshots without explicit per-attempt receipts remain unknown.
export function contentFingerprint(post) {
  const strip = value => Array.isArray(value) ? value.map(strip) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().filter(key => !['observedAt', 'checkedAt', 'generatedAt', 'observationState'].includes(key)).map(key => [key, strip(value[key])])) : value;
  return JSON.stringify(strip({publishedAt:post.publishedAt, postUrl:post.postUrl, signalMatches:post.signalMatches, factCandidate:post.factCandidate}));
}
export function sourceRunHealth(payload) {
  const receipts = Array.isArray(payload.refreshObservations) ? payload.refreshObservations : [];
  const failures = Array.isArray(payload.failures) ? payload.failures : [];
  const unavailable = failures.filter(row => row.state === 'no_access' || /missing_credentials|(?:TOKEN|USER_ID).*missing|robots_disallow|http_40[13]/i.test(row.reason || ''));
  const attempts = receipts.filter(row => row.attempted === true);
  const successful = attempts.filter(row => ['changed', 'unchanged', 'refreshed'].includes(row.state));
  const failed = [...attempts.filter(row => ['failed','error'].includes(row.state)), ...failures.filter(row => row.attempted === true)];
  const newOrChanged = successful.reduce((count, row) => count + (Number.isInteger(row.newOrChangedPosts) && row.newOrChangedPosts >= 0 ? row.newOrChangedPosts : 0), 0);
  const received = successful.reduce((count, row) => count + (Number.isInteger(row.postsReceived) && row.postsReceived >= 0 ? row.postsReceived : 0), 0);
  let state = 'unknown';
  if (successful.length) state = failed.length || unavailable.length ? 'partial_failure' : newOrChanged ? 'success_fresh_data' : successful.every(row => Number.isInteger(row.newOrChangedPosts) && row.newOrChangedPosts >= 0) ? 'success_no_change' : 'success_observed_change_unknown';
  else if (failed.length) state = 'failure';
  else if (unavailable.length) state = 'no_access';
  else if (payload.profilesAttempted === 0 && payload.profilesCompleted === 0) state = 'not_attempted';
  return {state, successfulRequests:successful.length, failedRequests:failed.length, unavailableReasons:unavailable.length, postsReceived:received, newOrChangedPosts:newOrChanged,
    scope:'Latest recorded collection run only; retained posts are not new receipts. Fresh data means newly observed or changed factual candidates, not verified publication or a recent event.'};
}
