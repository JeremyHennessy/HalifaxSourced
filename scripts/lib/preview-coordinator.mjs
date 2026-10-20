// Pure, read-only queue policy. GitHub branches, PRs and retained workflow runs
// are the durable state; an Actions concurrency slot is never treated as a FIFO.
export const LANES = [
  { artifact: 'city-events-preview', workflow: 'City Events Preview', file: 'city-events-preview.yml', priority: 1, group: 'events' },
  { artifact: 'source-expansion-preview', workflow: 'Source Expansion Preview', file: 'source-expansion-preview.yml', priority: 2, group: 'source-social' },
  { artifact: 'social-source-preview', workflow: 'Social Source Preview', file: 'social-source-preview.yml', priority: 3, group: 'source-social' }
].map(lane => ({ ...lane, branch: `codex/promote-${lane.artifact}` }));
export function laneForPath(path) {
  if (/^data\/(?:build\/)?(?:city-events|event-entity-resolution)\.(?:js|json)$/.test(path)) return 'events';
  if (/^data\/(?:build\/)?(?:official-site-signals|verified-source-pages|structured-events|patio-directory-facts|public-special-source-leads|first-party-sources|website-feed-signals|website-page-intelligence|social-signals|recent-social-posts|reviewed-social-posts|thumbnail-candidates|thumbnail-coverage-report)\.(?:js|json)$/.test(path)) return 'source-social';
  return null;
}
export const PR_CREATION_BLOCKER = 'GitHub Actions is not permitted to create or approve pull requests';
const stamp = value => Number.isFinite(Date.parse(value || '')) ? Date.parse(value) : null;
export function validateRun(run, lane, repository, now) {
  if (!run || !/^\d+$/.test(String(run.id))) return 'missing-or-invalid-run';
  if (run.name !== lane.workflow || (typeof run.path !== 'string' || run.path.split('@')[0] !== `.github/workflows/${lane.file}`)) return 'wrong-producer-workflow';
  if (run.status !== 'completed' || run.conclusion !== 'success') return 'producer-not-successful';
  if (run.head_branch !== 'main' || run.head_repository?.full_name !== repository || ['pull_request', 'pull_request_target'].includes(run.event)) return 'untrusted-producer';
  if (!stamp(run.created_at)) return 'missing-source-run-time';
  const artifact = (run.artifacts || []).find(item => item.name === lane.artifact && !item.expired && (!item.expires_at || stamp(item.expires_at) > stamp(now)));
  return artifact ? null : 'artifact-not-retained';
}
export function laneReservation(lane, state) {
  const peers = LANES.filter(other => other.group === lane.group);
  for (const peer of peers) {
    const peerState = state.lanes?.[peer.artifact] || {};
    const pr = (state.openPulls || []).find(item => item.head?.ref === peer.branch || item.headRefName === peer.branch || item.reservedGroups?.includes(lane.group));
    if (pr) return { reason: 'active-review', holder: peer.artifact, url: pr.html_url || pr.url || null };
    if (peerState.branch?.sha && peerState.branch.aheadBy !== 0 && peerState.branch.mergedHeadSha !== peerState.branch.sha) {
      return { reason: 'prepared-branch-reserved', holder: peer.artifact, sha: peerState.branch.sha,
        sourceRunId: peerState.branch.receipt?.artifactRunId || peerState.branch.metadata?.artifactRunId || null,
        blocker: 'An unmerged owner branch is reserved. Review/open its PR with existing access, or explicitly resolve the reservation. Actions PR creation may remain restricted.' };
    }
  }
  return null;
}
export function planPreviewUpdates(state) {
  const decisions = [];
  const include = [];
  const manual = state.manual || null;
  if (manual && (!LANES.some(lane => lane.artifact === manual.artifact) || !/^\d+$/.test(String(manual.runId)))) throw new Error('Manual promotion requires an allowlisted artifact and an exact numeric run ID.');
  for (const lane of LANES) {
    if (manual && lane.artifact !== manual.artifact) continue;
    const laneState = state.lanes?.[lane.artifact] || {};
    const eligible = (laneState.runs || []).filter(run => !validateRun(run, lane, state.repository, state.now)).sort((a, b) => stamp(b.created_at) - stamp(a.created_at) || Number(b.id) - Number(a.id));
    const run = manual ? (laneState.runs || []).find(item => String(item.id) === String(manual.runId)) : eligible[0];
    const decision = { artifact: lane.artifact, priority: lane.priority, runId: run ? String(run.id) : null };
    const block = reason => decisions.push({ ...decision, status: 'held', reason });
    if (!run) { block(manual ? 'requested-run-not-found' : (laneState.readBlocker || 'no-eligible-retained-artifact'));  continue; }
    const invalid = validateRun(run, lane, state.repository, state.now);
    if (invalid) { block(invalid); continue; }
    const receipt = laneState.acceptedReceipt;
    if (receipt && String(receipt.artifactRunId) === String(run.id)) { block('already-accepted'); continue; }
    // Receipts are provenance, not assertions about review/publication time.
    // A lane may not roll back shared files accepted from its overlapping peer.
    const acceptedPeers = LANES.filter(peer => peer.group === lane.group).map(peer => ({ lane: peer, receipt: state.lanes?.[peer.artifact]?.acceptedReceipt })).filter(peer => peer.receipt?.artifactRunId);
    const unknownAge = acceptedPeers.find(peer => stamp(peer.receipt.sourceRunCreatedAt) === null);
    if (unknownAge) { block('accepted-ordering-unknown'); continue; }
    const newerAccepted = acceptedPeers.find(peer => stamp(run.created_at) <= stamp(peer.receipt.sourceRunCreatedAt));
    if (newerAccepted) { block(newerAccepted.lane.artifact === lane.artifact ? 'older-than-accepted' : 'older-than-overlapping-accepted'); continue; }
    const reservation = laneReservation(lane, state);
    if (reservation) { decisions.push({ ...decision, status: 'held', ...reservation }); continue; }
    const attempts = (state.attempts || []).filter(item => item.artifact === lane.artifact && String(item.runId) === String(run.id)).sort((a, b) => stamp(b.completedAt) - stamp(a.completedAt));
    // Manual selection does not bypass review reservations, provenance or retry caps.
    if (attempts.some(item => item.conclusion === 'success' && item.baseSha === state.mainSha)) { block('already-processed-on-current-main'); continue; }
    const failures = attempts.filter(item => ['failure', 'timed_out'].includes(item.conclusion));
    if (failures.length >= 3) { block('retry-budget-exhausted'); continue; }
    if (failures.length) {
      const delay = failures.length === 1 ? 5 * 60_000 : 30 * 60_000;
      if (stamp(state.now) - stamp(failures[0].completedAt) < delay) { block('retry-backoff'); continue; }
    }
    const item = { artifact_name: lane.artifact, run_id: String(run.id), workflow_name: lane.workflow,
      source_run_url: run.html_url, source_run_created_at: run.created_at,
      expected_sha: laneState.branch?.sha || '', released_sha: laneState.branch?.mergedHeadSha || '', priority: lane.priority };
    include.push(item);
    decisions.push({ ...decision, status: 'ready', reason: failures.length ? 'bounded-retry' : 'latest-retained-eligible' });
  }
  return { schemaVersion: 1, checkedAt: state.now, mainSha: state.mainSha, matrix: { include: include.slice(0, 3) }, hasWork: include.length > 0, decisions };
}
