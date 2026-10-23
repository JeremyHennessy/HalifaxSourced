import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { LANES, planPreviewUpdates, validateRun, PR_CREATION_BLOCKER, laneForPath, promotionLane, reservedBranchNames } from './lib/preview-coordinator.mjs';
const repository = 'JeremyHennessy/HalifaxSourced';
const now = '2026-10-20T15:00:00Z';
const runFor = (lane, id = 100 + lane.priority, at = '2026-10-20T12:00:00Z') => ({ id, name: lane.workflow, path: `.github/workflows/${lane.file}`, status: 'completed', conclusion: 'success', head_branch: 'main', head_repository: { full_name: repository }, event: 'schedule', created_at: at, html_url: `https://github.com/${repository}/actions/runs/${id}`, artifacts: [{ name: lane.artifact, expired: false, expires_at: '2026-11-20T12:00:00Z' }] });
const fresh = () => ({ repository, now, mainSha: 'main-sha', lanes: Object.fromEntries(LANES.map(lane => [lane.artifact, { runs: [runFor(lane)] }])), openPulls: [], attempts: [] });
let count = 0;
const test = (name, fn) => { fn(); count++; console.log(`ok ${name}`); };
const events = LANES[0], source = LANES[1], social = LANES[2];
const held = (state, artifact) => planPreviewUpdates(state).decisions.find(item => item.artifact === artifact);
test('bounded priority order always reconciles all lanes', () => assert.deepEqual(planPreviewUpdates(fresh()).matrix.include.map(item => item.artifact_name), LANES.map(lane => lane.artifact)));
test('exhausted candidate search holds only its lane, not unrelated events', () => { const state = fresh(); state.lanes[social.artifact] = { runs: [], readBlocker: 'retained-run-search-exhausted' }; assert.equal(held(state, social.artifact).reason, 'retained-run-search-exhausted'); assert.equal(planPreviewUpdates(state).matrix.include[0].artifact_name, events.artifact); });
test('latest eligible retained success wins over trigger identity', () => { const state = fresh(); state.lanes[events.artifact].runs.unshift(runFor(events, 999, '2026-10-20T14:00:00Z')); assert.equal(planPreviewUpdates(state).matrix.include[0].run_id, '999'); });
test('expired latest artifact cannot be selected', () => { const state = fresh(), run = runFor(events, 999, '2026-10-20T14:00:00Z'); run.artifacts[0].expired = true; state.lanes[events.artifact].runs.unshift(run); assert.equal(planPreviewUpdates(state).matrix.include[0].run_id, '101'); });
for (const [name, mutate, reason] of [
  ['fork', run => { run.head_repository.full_name = 'other/fork'; }, 'untrusted-producer'],
  ['pull request', run => { run.event = 'pull_request'; }, 'untrusted-producer'],
  ['pull request target', run => { run.event = 'pull_request_target'; }, 'untrusted-producer'],
  ['wrong branch', run => { run.head_branch = 'feature'; }, 'untrusted-producer'],
  ['wrong workflow', run => { run.name = source.workflow; }, 'wrong-producer-workflow'],
  ['missing workflow path', run => { delete run.path; }, 'wrong-producer-workflow'],
  ['wrong workflow file', run => { run.path = '.github/workflows/untrusted.yml'; }, 'wrong-producer-workflow'],
  ['failed run', run => { run.conclusion = 'failure'; }, 'producer-not-successful'],
  ['wrong artifact', run => { run.artifacts[0].name = source.artifact; }, 'artifact-not-retained'],
  ['expired time', run => { run.artifacts[0].expires_at = '2026-10-19T12:00:00Z'; }, 'artifact-not-retained']
]) test(`reject ${name}`, () => { const run = runFor(events); mutate(run); assert.equal(validateRun(run, events, repository, now), reason); });
test('manual run is exact, never silently upgraded', () => { const state = fresh(); state.lanes[events.artifact].runs.push(runFor(events, 77, '2026-10-19T12:00:00Z')); state.manual = { artifact: events.artifact, runId: '77' }; const plan = planPreviewUpdates(state); assert.equal(plan.matrix.include.length, 1); assert.equal(plan.matrix.include[0].run_id, '77'); });
test('manual invalid candidate is explicitly held', () => { const state = fresh(); state.manual = { artifact: events.artifact, runId: 101 }; state.lanes[events.artifact].runs[0].conclusion = 'failure'; assert.equal(held(state, events.artifact).reason, 'producer-not-successful'); });
test('accepted run deduplicates independently by lane', () => { const state = fresh(); state.lanes[events.artifact].acceptedReceipt = { artifactRunId: 101 }; assert.equal(held(state, events.artifact).reason, 'already-accepted'); assert.equal(planPreviewUpdates(state).matrix.include.length, 2); });
test('older manual run cannot regress accepted data', () => { const state = fresh(); state.manual = { artifact: events.artifact, runId: 101 }; state.lanes[events.artifact].acceptedReceipt = { artifactRunId: 999, sourceRunCreatedAt: '2026-10-20T14:00:00Z' }; assert.equal(held(state, events.artifact).reason, 'older-than-accepted'); });
test('unknown accepted chronology holds rather than guesses', () => { const state = fresh(); state.lanes[events.artifact].acceptedReceipt = { artifactRunId: 88 }; assert.equal(held(state, events.artifact).reason, 'accepted-ordering-unknown'); });
for (const [acceptedLane, candidateLane] of [[source, social], [social, source]]) test(`accepted ${acceptedLane.artifact} prevents older overlapping ${candidateLane.artifact}`, () => { const state = fresh(); state.lanes[acceptedLane.artifact].acceptedReceipt = { artifactRunId: 777, sourceRunCreatedAt: '2026-10-20T14:00:00Z' }; assert.equal(held(state, candidateLane.artifact).reason, 'older-than-overlapping-accepted'); });
test('unknown overlapping receipt chronology also holds', () => { const state = fresh(); state.lanes[source.artifact].acceptedReceipt = { artifactRunId: 777 }; assert.equal(held(state, social.artifact).reason, 'accepted-ordering-unknown'); });
test('open source PR reserves both overlapping lanes', () => { const state = fresh(); state.openPulls = [{ head: { ref: source.branch }, html_url: 'https://github.com/x/pull/1' }]; assert.equal(held(state, source.artifact).reason, 'active-review'); assert.equal(held(state, social.artifact).reason, 'active-review'); assert.equal(planPreviewUpdates(state).matrix.include.length, 1); });
test('prepared branch without PR reserves same and overlapping lanes', () => { const state = fresh(); state.lanes[source.artifact].branch = { sha: 'owner', aheadBy: 1, receipt: { artifactRunId: 102 } }; assert.equal(held(state, source.artifact).reason, 'prepared-branch-reserved'); assert.equal(held(state, social.artifact).reason, 'prepared-branch-reserved'); });
test('unknown ancestry fails closed', () => { const state = fresh(); state.lanes[events.artifact].branch = { sha: 'owner' }; assert.equal(held(state, events.artifact).reason, 'prepared-branch-reserved'); });
test('merged branch reusable with exact SHA lease', () => { const state = fresh(); state.lanes[events.artifact].branch = { sha: 'merged', aheadBy: 0 }; assert.equal(planPreviewUpdates(state).matrix.include[0].expected_sha, 'merged'); });
test('squash merged branch released only at its exact merged head', () => { const state = fresh(); state.lanes[events.artifact].branch = { sha: 'squashed-head', aheadBy: 2, mergedHeadSha: 'squashed-head' }; assert.equal(planPreviewUpdates(state).matrix.include[0].released_sha, 'squashed-head'); });
test('post-merge owner edits retain reservation', () => { const state = fresh(); state.lanes[events.artifact].branch = { sha: 'new-owner-edit', aheadBy: 3, mergedHeadSha: 'squashed-head' }; assert.equal(held(state, events.artifact).reason, 'prepared-branch-reserved'); });
test('noncanonical review branches reserve overlapping changed paths', () => { const state = fresh(); state.openPulls = [{ head: { ref: 'human/recover-events' }, reservedGroups: [laneForPath('data/build/city-events.json')] }]; assert.equal(held(state, events.artifact).reason, 'active-review'); assert.equal(held(state, social.artifact).status, 'ready'); assert.equal(laneForPath('app.js'), null); assert.equal(laneForPath('data/first-party-sources.js'), 'source-social'); });
const attempt = (conclusion, completedAt, baseSha = 'main-sha') => ({ artifact: events.artifact, runId: 101, conclusion, completedAt, baseSha });
test('same-main successful no-op is durable deduplication', () => { const state = fresh(); state.attempts = [attempt('success', '2026-10-20T14:00:00Z')]; assert.equal(held(state, events.artifact).reason, 'already-processed-on-current-main'); });
test('a changed main permits re-evaluation', () => { const state = fresh(); state.attempts = [attempt('success', '2026-10-20T14:00:00Z', 'old-main')]; assert.equal(held(state, events.artifact).status, 'ready'); });
test('first transient failure gets five-minute backoff', () => { const state = fresh(); state.attempts = [attempt('failure', '2026-10-20T14:57:00Z')]; assert.equal(held(state, events.artifact).reason, 'retry-backoff'); });
test('elapsed first backoff allows bounded retry', () => { const state = fresh(); state.attempts = [attempt('failure', '2026-10-20T14:50:00Z')]; assert.equal(held(state, events.artifact).reason, 'bounded-retry'); });
test('second transient failure gets thirty-minute backoff', () => { const state = fresh(); state.attempts = [attempt('failure', '2026-10-20T14:50:00Z'), attempt('timed_out', '2026-10-20T14:00:00Z')]; assert.equal(held(state, events.artifact).reason, 'retry-backoff'); });
test('three failures exhaust retry budget including manual runs', () => { const state = fresh(); state.manual = { artifact: events.artifact, runId: 101 }; state.attempts = [1, 2, 3].map(() => attempt('failure', '2026-10-20T12:00:00Z')); assert.equal(held(state, events.artifact).reason, 'retry-budget-exhausted'); });
test('manual does not override an owner reservation', () => { const state = fresh(); state.manual = { artifact: events.artifact, runId: 101 }; state.lanes[events.artifact].branch = { sha: 'reserved', aheadBy: 1 }; assert.equal(held(state, events.artifact).reason, 'prepared-branch-reserved'); });
test('known repository PR restriction stays exact', () => assert.equal(PR_CREATION_BLOCKER, 'GitHub Actions is not permitted to create or approve pull requests'));
test('canonical workflow serializes and rechecks, legacy cannot mutate', () => { const workflow = readFileSync(new URL('../.github/workflows/promote-preview-artifacts.yml', import.meta.url), 'utf8'); const legacy = readFileSync(new URL('../.github/workflows/promote-source-expansion-artifact.yml', import.meta.url), 'utf8'); assert.match(workflow, /max-parallel: 1/); assert.match(workflow, /fail-fast: false/); assert.match(workflow, /coordinate-preview-updates.mjs --guard/); assert.match(workflow, /git merge-base --is-ancestor/); assert.match(legacy, /legacy writer is retired/); assert.doesNotMatch(legacy, /git push|gh pr create|cp |contents: write|actions: write/); });

test('only obsolete event and source lanes rotate while social remains unchanged',()=>{assert.equal(events.branch,'codex/promote-city-events-preview-v3');assert.equal(source.branch,'codex/promote-source-expansion-preview-v2');assert.equal(social.branch,'codex/promote-social-source-preview');assert.deepEqual(events.retiredBranches,[{branch:'codex/promote-city-events-preview',sha:'a0c4f28512269aace14da4c7d7efcd11ed9723e4'},{branch:'codex/promote-city-events-preview-v2',sha:'cf297092c01613441b241bcf6627c33f413ad729'}]);assert.equal(source.retiredBranches[0].sha,'f1af8dc099331a27f0da2528b3c86114c446ea5d');assert.throws(()=>promotionLane('untrusted'));});
test('reopened old source review still reserves both source lanes',()=>{const state=fresh();state.openPulls=[{head:{ref:source.retiredBranches[0].branch}}];assert.equal(held(state,source.artifact).reason,'active-review');assert.equal(held(state,social.artifact).reason,'active-review');});
test('changed preserved source head blocks replacement and overlapping social lane',()=>{const state=fresh();state.lanes[source.artifact].retiredBranchConflicts=[{branch:source.retiredBranches[0].branch,actualSha:'owner-edit'}];assert.equal(held(state,source.artifact).reason,'retired-branch-changed');assert.equal(held(state,social.artifact).reason,'retired-branch-changed');assert.equal(held(state,events.artifact).status,'ready');});
test('unchanged preserved old heads do not reserve fresh replacement branches',()=>{const state=fresh();state.lanes[source.artifact].retiredBranchConflicts=[];assert.equal(held(state,source.artifact).status,'ready');assert.equal(planPreviewUpdates(state).matrix.include.find(row=>row.artifact_name===source.artifact).expected_sha,'');});
test('publisher uses the same branch policy and read-only dispatch skips mutations',()=>{const workflow=readFileSync(new URL('../.github/workflows/promote-preview-artifacts.yml',import.meta.url),'utf8');assert(workflow.includes('node scripts/preview-branch-policy.mjs target'));assert(workflow.includes('node scripts/preview-branch-policy.mjs peers'));assert(workflow.includes("inputs.dry_run != true"));assert(reservedBranchNames(source.artifact).includes(source.retiredBranches[0].branch));assert(reservedBranchNames(source.artifact).includes(social.branch));});

// Admission must run before the coordinator considers ANY retained lane. Evaluate
// the expression extracted from the real reconcile job rather than a copied predicate.
const promotionWorkflow = readFileSync(new URL('../.github/workflows/promote-preview-artifacts.yml', import.meta.url), 'utf8');
const cityGuard = "(github.event.workflow_run.name != 'City Events Preview' || github.event.workflow_run.event == 'schedule' || github.event.workflow_run.event == 'workflow_dispatch')";
function reconcileCondition(workflow) {
  const reconcile = workflow.match(/^  reconcile:\n([\s\S]*?)(?=^  promote:)/m)?.[1];
  assert(reconcile, 'Reconcile job exists');
  const expression = reconcile.match(/^    if: >-\n([\s\S]*?)(?=^    runs-on:)/m)?.[1]?.trim();
  assert(expression, 'Admission is on reconcile itself, before checkout, planning or diagnostic upload');
  return expression;
}
const admitted = (expression, run, event_name = 'workflow_run') => vm.runInNewContext(expression, { github: { event_name, repository, event: { workflow_run: run } } });
const admissionCases = [];
for (const lane of LANES) {
  for (const event of ['pull_request', 'pull_request_target', 'push', 'schedule', 'workflow_dispatch', undefined, 'unknown']) {
    // Existing non-City admission semantics are intentionally unchanged, including
    // unknown non-PR event values. validateRun still performs its own trust checks.
    const expected = lane === events ? ['schedule', 'workflow_dispatch'].includes(event) : event !== 'pull_request';
    admissionCases.push([`${lane.workflow}: ${String(event)}`, { ...runFor(lane), event }, expected]);
  }
}
for (const event of ['schedule', 'workflow_dispatch']) {
  for (const [label, overrides] of [
    ['fork', { head_repository: { full_name: 'other/fork' } }],
    ['failed', { conclusion: 'failure' }],
    ['cancelled', { conclusion: 'cancelled' }],
    ['wrong branch', { head_branch: 'feature' }]
  ]) admissionCases.push([`City ${event} ${label}`, { ...runFor(events), event, ...overrides }, false]);
}
function assertTruthTable(expression) {
  for (const [label, run, expected] of admissionCases) assert.equal(admitted(expression, run), expected, label);
  assert.equal(admitted(expression, undefined, 'workflow_dispatch'), true, 'Explicit coordinator manual invocation remains admitted without workflow_run metadata');
}
function assertAdmissionTruthTable(workflow) {
  const expression = reconcileCondition(workflow);
  const normalized = expression.replace(/\s+/g, ' ');
  const trustedBranch = "github.event_name == 'workflow_dispatch' || ( github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.head_branch == 'main' && github.event.workflow_run.head_repository.full_name == github.repository && github.event.workflow_run.event != 'pull_request' && " + cityGuard + ' )';
  assert.equal(normalized, trustedBranch, 'City allowlist must be a conjunct inside the existing trusted-success branch');
  assertTruthTable(expression);
  return expression;
}
const admission = assertAdmissionTruthTable(promotionWorkflow);
test('actual reconcile condition truth table preserves trusted producers and rejects City validation events', () => {
  assert.equal(admissionCases.length, 29);
});
test('City validation push cannot reconcile ready older artifacts from ANY retained lane', () => {
  const state = fresh();
  const queue = planPreviewUpdates(state).matrix.include;
  assert.deepEqual(queue.map(row => row.artifact_name), LANES.map(lane => lane.artifact));
  assert.equal(queue.find(row => row.artifact_name === events.artifact).run_id, '101');
  const validationPush = { ...runFor(events, 999, '2026-10-20T14:00:00Z'), event: 'push', artifacts: [] };
  assert.equal(validateRun(validationPush, events, repository, now), 'artifact-not-retained');
  assert.equal(admitted(admission, validationPush), false, 'Missing trigger artifact alone would not protect the already-ready queue');
  assert.equal(admitted(admission, { ...validationPush, event: 'pull_request' }), false);
  assert.equal(queue.length, 3, 'Admission guard, not absence of retained work, prevents all downstream execution');
});
for (const event of ['schedule', 'workflow_dispatch']) test(`exact manual selection retains successful City ${event} producer provenance`, () => {
  const state = fresh();
  const selected = { ...runFor(events, 77, '2026-10-19T12:00:00Z'), event, head_sha: 'historical-producer-sha' };
  state.lanes[events.artifact].runs.push(selected);
  state.manual = { artifact: events.artifact, runId: '77' };
  assert.equal(validateRun(selected, events, repository, now), null);
  assert.equal(admitted(admission, selected), true);
  const plan = planPreviewUpdates(state);
  assert.equal(plan.matrix.include.length, 1);
  assert.equal(plan.matrix.include[0].run_id, '77');
  assert.equal(plan.matrix.include[0].artifact_name, events.artifact);
  assert.equal(plan.matrix.include[0].source_run_url, selected.html_url);
  assert.equal(plan.matrix.include[0].source_run_created_at, selected.created_at);
});
test('skipped reconcile cannot reach promotion, downloads, pushes, PRs, dispatch or always receipt', () => {
  const promote = promotionWorkflow.match(/^  promote:\n([\s\S]*)$/m)?.[1];
  assert(promote);
  assert.match(promote, /^    needs: reconcile$/m);
  assert.match(promote, /^    if: needs\.reconcile\.outputs\.has_work == 'true' && \(github\.event_name != 'workflow_dispatch' \|\| inputs\.dry_run != true\)$/m);
  for (const marker of ['actions/download-artifact@v4', 'git push --force-with-lease', 'gh pr create', 'gh workflow run', 'name: Preserve promotion attempt receipt']) assert(promote.includes(marker), `Downstream operation stays inside gated promote: ${marker}`);
  assert.match(promote, /name: Preserve promotion attempt receipt\n        if: always\(\)/);
  const reconcile = promotionWorkflow.split('  reconcile:\n')[1].split('  promote:\n')[0];
  assert(reconcile.indexOf('    if: >-') < reconcile.indexOf('actions/checkout'));
  assert(reconcile.includes('node scripts/coordinate-preview-updates.mjs'));
  assert(reconcile.includes('name: preview-queue-plan'));
});
test('mutation controls reject dropped, widened, misplaced or globally restrictive City guards', () => {
  for (const [label, from, to] of [
    ['remove City guard', ' &&\n        ' + cityGuard, ''],
    ['permit City push', "github.event.workflow_run.event == 'schedule'", "github.event.workflow_run.event == 'push'"],
    ['bypass trust with OR', ' &&\n        ' + cityGuard, ' ||\n        ' + cityGuard],
    ['restrict other producer lanes', cityGuard, "(github.event.workflow_run.event == 'schedule' || github.event.workflow_run.event == 'workflow_dispatch')"],
    ['remove repository trust', 'github.event.workflow_run.head_repository.full_name == github.repository', 'true'],
    ['remove success check', "github.event.workflow_run.conclusion == 'success'", 'true'],
    ['remove branch check', "github.event.workflow_run.head_branch == 'main'", 'true']
  ]) {
    assert(promotionWorkflow.includes(from), `Mutation target exists: ${label}`);
    const mutated = promotionWorkflow.replace(from, to);
    assert.throws(() => assertAdmissionTruthTable(mutated), undefined, `${label}: structural placement`);
    assert.throws(() => assertTruthTable(reconcileCondition(mutated)), undefined, `${label}: admission semantics`);
  }
  // Merely mentioning the conjunct later (or on promote) cannot satisfy admission.
  const misplaced = promotionWorkflow.replace(' &&\n        ' + cityGuard, '') + '\n# ' + cityGuard + '\n';
  assert.throws(() => assertAdmissionTruthTable(misplaced));
  assert.throws(() => assertTruthTable(reconcileCondition(misplaced)));
});

console.log(`Preview coordinator: ${count} fixture scenarios passed.`);
