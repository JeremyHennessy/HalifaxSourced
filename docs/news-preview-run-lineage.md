# News preview run lineage — guarded review-only v3 safety protocol

This is a fail-closed **collection guard**, not a durable shared restriction store,
source admission, recovery authorization or publication receipt.
It uses deterministic Node code, existing Actions cache/artifact facilities and
anonymous read-only official GitHub metadata. No AI, API key, new secret, expanded
workflow permission or paid service is added. Accepted news and source policies are
unchanged. The existing global source-access/quarantine/robots rules still apply.

## Admission before every publisher or robots request

1. Validate the current environment and public GitHub repository/run metadata:
   exact repository ID/name, workflow path/ID, run ID/number, attempt **1**, source
   SHA, current default branch and either `workflow_dispatch` or `schedule`.
   The official current event must exactly match the runtime event. PR, fork,
   push and other events are never admitted. A rerun is never admitted.
2. For run N > 1, find **N−1**, without successful-run/branch/event filters. Its
   direct metadata must match the listing and show completed/success/attempt 1
   for this exact workflow/default branch. Its allowed manual/scheduled event must
   agree between listing and direct metadata; either event may follow the other.
   Missing, deleted, ambiguous, skipped,
   cancelled, failed, timed-out, queued, rerun or interrupted predecessors stop.
   The bounded first 100 workflow runs must contain N−1; otherwise stop, not guess.
3. Restore only N−1's exact `news-review-v3-<repositoryId>-<workflowId>-<runNumber>-
   <runId>-<runAttempt>-<sha>` payload key and its separate `-final` receipt key.
   There are no prefix restore keys, latest-success fallback or v2 migration.
   Both the cache-hit flag and returned matched key must be exact.
4. Re-read official metadata after restore. Verify the exact final receipt,
   including repository/workflow/run/attempt/SHA, payload key, completed transport
   decision flag, saved-payload flag and SHA-256 of the **actual restored bytes**.
   Validate the existing news-cache schema before calling the collector.
5. Only then construct the existing collector/robots transport by starting its
   child process. Existing candidates, conditional validators, original clocks,
   retired holds, canonical www/apex/DNS-dot aliases and unresolved hold reasons
   remain retained. The original predecessor receipt is kept as local evidence.

Missing/malformed/limited/unavailable GitHub API responses, wrong environment,
cache eviction/miss/partial match, receipt loss, digest mismatch or any lineage gap
fail before both news and robots requests. API reads are unauthenticated, bounded,
HTTPS-only, nonredirecting and have no retry or source fallback.

## Bootstrap is not recovery

Initialization requires explicit `initialize_review_cache: true` **and** an
independently validated current run_number=1/run_attempt=1/workflow_dispatch.
Existing local payload/receipt files prohibit initialization. An empty API listing
or missing cache never proves a first run. No other run can create an empty cache.
Scheduled events have no dispatch inputs: missing/empty/false initialization is
treated only as **no initialization**. A first scheduled run or any scheduled
`true` value is rejected. The same v3 identity, cache keys and receipt format are
retained so verified manual predecessors remain usable without reset or migration.
Event types are stored separately in the current uncached plan and compared again
before collection and completion; cached v3 final-receipt identities are unchanged.
Offline tests alone do not establish actual bootstrap or continuation readiness.

Any lost chain requires separate reviewed investigation/recovery. This change
implements no reset, migration, hold release, failure skipping or reconstruction
from an older successful cache. Recovery must preserve all known restrictions and
unknown outcomes; inability to recover their evidence is a reason to remain stopped.
Do not dispatch a later run merely to test whether an interrupted restriction was
lost. Independently started workflows are not coordinated by this news-only chain;
the existing committed access-policy review boundary still governs those workflows.

## Completion is not the existence of an old file

- The parent wrapper waits for the collector process to exit 0 with no termination
  signal. The existing collector awaits `sourceAccessState().drainDecisions()`
  before writing its result; new unresolved/HTTP-restriction diagnostics set a
  failing process exit status. A killed/failed collector cannot complete the run.
- Only that successful current process creates a fresh, noncached collection marker
  bound to its current identity and output digest. Prior held source identities
  must still be present. Restoring an old payload or receipt cannot create this marker.
- Save the current payload under its unique exact key. Since `actions/cache/save`
  can warn and exit successfully after a failed save, perform a separate exact-key
  lookup and require both `cache-hit=true` and the matching key.
- Only after that verification write the current final receipt. Save it under the
  distinct `-final` key, then verify that exact key as well. The next run requires
  this run's **overall GitHub success**, both exact cache entries and the actual
  payload digest/receipt binding; a cache lookup alone is never admission.
- A crash before either save, a save failure, missing final receipt, or a later job
  failure prevents the next collection. This intentionally sacrifices availability
  rather than pretending cache storage survives eviction or runner interruption.
- Failure evidence is uploaded with `always()` when the runner permits it. Upload
  availability is not assumed, and an artifact is neither a completion receipt nor
  permission to retry. Raw review diagnostics stay outside deployed `data/`/`docs/`.

## Schedule, collection and publication are separate

The workflow attempts collection at **00:17, 06:17, 12:17 and 18:17 UTC**
(`17 */6 * * *`), matching the regional-news six-hour target. It remains
default-branch-only, serialized, `contents: read` and bounded to ten minutes.
Every scheduled attempt passes the same current/N−1/exact-cache/receipt checks
before news or robots transport. A trigger is not a promise of successful collection:
scheduling delays, source backoff/holds, GitHub API failure or a broken chain can
prevent requests. Later triggers remain blocked after a broken chain; they cannot
bootstrap, skip a failed run, reset a hold or recover from an older cache.

A successful collector completion still produces **nonpublishable review evidence**
only. It does not guarantee every source was contacted or succeeded: disabled,
backed-off and held sources retain their own clocks/status. No sources are enabled
by this schedule; Global Halifax remains the only admitted enabled feed and the
other ten sources remain collection-disabled. The 47 reviewed published records
are unchanged. Explicit review decisions and normal release gates are still required
for publication. No promotion workflow consumes this artifact. Receipt-only updates
stay in Actions artifacts/caches, with no content commits, full release or deployment.

Before merging/activating this schedule, separately verify the actual first manual
bootstrap, a successful second manual continuation with initialization false and
both exact caches, independent implementation review, exact-head CI and unchanged
source-specific admission/robots/access policy. Those are operational evidence,
not facts inferred from the cron or unit tests. Recovery remains a separately
reviewed action; this workflow adds no recovery dispatch or automatic retry lane.

## Offline verification and limits

```sh
node scripts/test-news-run-lineage.mjs
node scripts/test-regional-news.mjs
node scripts/check-news.mjs
```

The lineage suite forbids real fetches and uses fake official metadata, temporary
cache files and explicit news/robots counters. It covers manual/scheduled event
combinations, absent schedule inputs, event-type confusion, first-schedule rejection,
backward-compatible manual receipts, identity/rerun matrices,
empty/gapped history, failed/cancelled/interrupted predecessors, API error/size/JSON
failures, wrong exact keys, stale/missing/corrupt payloads and receipts, digest/SHA
mismatch, cache-save warnings/misses, completion-marker loss, child-process failure,
strict bootstrap, held alias/unknown-reason retention and shipped workflow ordering.
Quality Gate runs it before any live producer step. These tests do not establish
GitHub cache availability, actual bootstrap readiness, live feed permission or
production collection success. Local schedule implementation does not dispatch a
workflow or activate scheduling; activation occurs only when the reviewed workflow
is merged onto the default branch after those gates.

Implementation references: GitHub's [workflow-run API](https://docs.github.com/en/rest/actions/workflow-runs)
allows public metadata reads without authentication; the official cache action
[save implementation](https://github.com/actions/cache/blob/v4/src/saveImpl.ts)
and [restore outputs](https://github.com/actions/cache/blob/v4/restore/action.yml)
explain why action outcome and a partial key match are insufficient evidence.
