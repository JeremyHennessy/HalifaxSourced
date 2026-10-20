# Reliable source updates

The existing status route `#admin/status` contains a release-scoped publication and
observation ledger. It is not a live connection to GitHub and must not claim that a
later preview is already public. Follow each workflow link for later attempts,
no-op receipts and unpublished previews. Unknown reviewed/attempt timestamps remain
unknown. Release build time is never source freshness. The content hash ignores
receipt-only clocks, not event dates, expiries, rights dates, status or URLs.

## One writer and durable priority queue

`data/update-review-queue.json` is the reviewed human priority/blocker queue.
The operational artifact coordinator is `scripts/coordinate-preview-updates.mjs`,
with pure queue policy and fixture tests in `scripts/lib/preview-coordinator.mjs`
and `scripts/test-preview-coordinator.mjs`. It only reads GitHub APIs using the
existing token. No schedule, source permission, repository setting or credential
is added or expanded.

Every existing successful source workflow trigger reconciles the latest successful,
trusted, retained artifact in **all three** lanes: city events first, source
expansion second, social third. The output has at most three candidates and the
canonical workflow runs its matrix with `max-parallel: 1` and `fail-fast: false`.
Each item checks live reservations again, so a newly prepared source branch holds
social rather than allowing overlapping snapshots into independent active reviews.
If source is a semantic no-op, social can proceed. This is a bounded latest-state
queue, not an archival FIFO of every preview. GitHub concurrency can replace a
pending trigger; reconciling all lanes on the next surviving source trigger avoids
relying on that pending slot as durable queue storage. There is no new timer.

Durable state is:
- Per-lane provenance at `data/build/promotion-receipts/{artifact}.json` on main.
  A receipt is written only for semantic changes and becomes accepted input when
  its commit merges. Preparing or finding old metadata does not create a review
  timestamp or prove a deployment; review/publication fields stay null unless
  independently established by release evidence.
- The stable `codex/promote-{artifact}` owner branch and any open PR changing
  allowlisted lane files (including differently named human/recovery branches).
  Any unmerged branch, including one where PR creation was denied, holds its lane.
  Source and social reserve each other because their file allowlists overlap.
  A closed but unmerged owner branch remains held until explicitly resolved.
  Merged/behind branches can be reused only with their exact expected-SHA lease;
  squash/rebase merges release only the exact head recorded by a merged PR, not
  subsequent owner edits;
  the push also checks ancestry, active PRs and current main. Existing PRs and
  unmerged branches are never edited or overwritten by reconciliation.
- Recent Actions job outcomes, read only since the oldest ready candidate was
  created (at most thirty days, and not fetched when every candidate is held),
  deduplicate successful attempts
  against the same main and bound transient retries. Failed/timed-out candidates
  get five-minute then thirty-minute backoff, at most three attempts in the last
  thirty days, evaluated only on existing triggers. A subsequent new candidate is
  separate work. An exhausted candidate needs explicit diagnosis, not a retry
  storm. API failures and unknown reservation/history read bounds stop the plan
  rather than assume missing reservations. Exhausting the retained-artifact search
  holds only that candidate lane, so an old social lane does not block fresh events. Normal source outages preserve accepted data and observation age.

Manual dispatch requires the exact requested run ID and allowlisted artifact. It
checks producer workflow/path, main branch, same-repository provenance, success,
retained artifact, accepted-run age in every overlapping lane, branch ownership
and the same retry budget. Missing accepted chronology holds for review rather
than assuming an older shared snapshot is safe.
It never silently substitutes a newer run or bypasses an active review. The legacy
`Promote Source Expansion Artifact` workflow is retired to a clear notice; it
cannot copy files, push branches, create PRs or bypass canonical no-op checks.

The repository owner explicitly enabled and read back the Actions PR-creation
setting on 2026-10-20; end-to-end automatic PR creation still needs verification.
Historical failures reported
`GitHub Actions is not permitted to create or approve pull requests`.
If this restriction recurs, the failed attempt preserves the exact error and compare link in its summary,
fails explicitly, and dispatches no Quality Gate without a confirmed PR. Its
prepared branch then holds the queue; elapsed time does not retry the denied
operation. Use existing repository access to open/review the prepared PR and run
Quality Gate for the exact head. Do not alter repository settings or introduce a
token merely to clear this reservation. Reviewers must resolve conflicting
snapshots and rebase accepted data onto current main, not restore old code.

Run `node scripts/plan-source-updates.mjs` for a cheap read-only due/review plan.
Before collecting anything, check existing successful runs and content hashes.
Blocked source records keep explicit resume conditions; elapsed time alone does
not authorize retries of restricted sources. Do not launch independent agent
writers for a reserved lane. Batch compatible reviewed corrections.

## Events acceptance and recovery

1. Retrieve the successful producer's exact allowlisted snapshot and source run.
2. Rebase data only onto current main, never restore code from an old promotion branch.
3. Validate additions, source drift, scope, aliases, provenance and entity resolution.
4. Review removed **future** events against their exact official source; source list
   pagination is not proof an event was cancelled. Expired records need not carry.
5. Open one draft PR with existing repository access when Actions cannot create it.
6. Review exact head, pass Quality Gate, merge, wait for main's Quality and gated
   Pages, then compare served metadata and representative changed records.

This coordinator never changes the PR-creation setting itself and never approves
its own PRs or bypasses Quality Gate. The separately authorized setting change
does not authorize credential changes or removal of source/review restrictions.
Existing-access recovery requires no new token.

Receipt-only promotions leave accepted files and metadata unchanged, create no
commit, and dispatch no full quality run. Each attempted promotion retains a
`promotion-attempt-receipt-{artifact}` artifact for 30 days. This receipt is not a public data
update. A later genuine content change prepares new observation metadata; only
a successful release establishes public deployment.

## Cadence and release separation

Keep existing events six-hour, source/social daily and facts/specials weekly
collection. Tune to observed publication age rather than count of runs. Source
workflows collect; Quality Gate validates accepted snapshots and deterministic
builds. Live link-health is a separately bounded release check, not a new scrape.

Source targets are in `data/update-policy.json`. Oldest and latest successful
observations are both visible, so one fresh source does not hide old records.
Freshness labels do not certify evidence accuracy or source availability.
