# Fixed-snapshot release validation

Quality Gate validates the accepted source snapshot at the checked-out pull-request
head or main commit. It does not discover new restaurants, fetch new offer details,
or refresh patio evidence while deciding whether that commit may ship.

## Collection and release responsibilities

| Accepted input pair (`data/*.js` and `data/build/*.json`) | Collection workflow |
| --- | --- |
| `public-special-source-leads` | Source Expansion Preview |
| `patio-directory-facts` | Source Expansion Preview |
| `directory-restaurant-leads` | Restaurant Discovery Preview |

Those scheduled/manual preview workflows still run their importers and publish the
source artifacts. A successful collection run is not, by itself, release acceptance:
the reviewed/promoted source files must become part of the commit being validated.
Missing or inconsistent input pairs fail the release isolation regression; release
validation never repairs them by silently fetching a replacement.

After exporting the reviewed catalog, Quality Gate checks the accepted public-special
and patio snapshots, resolves the existing directory candidates, and rebuilds derived
structured specials, recent/reviewed posts and thumbnail candidates. Thumbnail page
fetching, image probing and automatic thumbnail promotion are explicitly disabled.
Current/expired status is recomputed at release time; rebuilding never refreshes the
underlying source observation dates or grants media rights.

## Live network exception: bounded link health

The existing release link-health check remains live. It examines current active
catalog official, social, menu and action destinations, with a 4-second request
deadline and concurrency of 16. `LINK_HEALTH_LIMIT=0` means complete coverage of that
bounded destination set, not a sample. The release validator still requires complete,
same-commit evidence and preserves the existing handling of confirmed broken reviewed
links versus transient/restricted responses. Link-health observations are not imported
as new offers, venue identities, or automatic lifecycle decisions.

Dependency installation and browser testing are also not claimed to be air-gapped.
The separation is between source collection and accepted-input release projection,
not a claim that the entire GitHub Actions runner has networking disabled.

## Regression and retained protections

Run locally:

```sh
node scripts/test-release-source-isolation.mjs
```

The regression:

1. Rejects collectors and unclassified production/shell entry points in the release
   data job, and rejects enabled thumbnail fetch/probe/promotion flags.
2. Checks the three accepted JavaScript/JSON pairs agree and that each collector
   retains a scheduled preview workflow and published artifact paths.
3. Executes the gate's offline production build/check sequence in two disposable
   copies. Network calls and subprocesses are denied; even caught failures are logged
   and fail the test. Both copies use the same test clock and must produce identical
   data and report bytes without altering any of the three accepted input pairs.
4. Tests its own rejection paths, including a swallowed network exception.

The fixed clock is a regression fixture only, not a production expiry override.
The runtime regression excludes the live link-health pair, SQLite packaging and
immutable-release packaging, which retain their normal gate steps. Fixture-based
collector tests remain separate and may use mocked network responses.

Quality Gate continues to run identity, source-integrity/provenance, media-rights,
expiry, event, local-policy and report-parity checks. It packages the validated site,
tests the packaged bytes with responsive/browser regressions, verifies the immutable
receipt again, and uploads that same tested artifact for the existing gated deployment.
The update ledger is regenerated with the actual PR/main source SHA and Quality Gate
run ID before packaging, so the admin status test inspects this release's ledger
rather than a locally generated, previously committed ledger.

## Link access holds (October 22, 2026)

Link QA version 3 separates current `assessedAt` decisions from actual HTTP
`observedAt` receipts. A complete release assessment includes every original URL,
including explicit holds; `checked` means assessed coverage, not requests made.
`attempted`, `unattempted`, `observed` and `held` are counted separately. Unattempted
holds have null current HTTP status/observation/attempt time, no lifecycle candidate
and no confirmed breakage. A redirect into a held target may retain the actual
intermediate redirect receipt, but the blocked target is not requested or observed.
The prior exact-URL observation is retained separately and never restamped.

`data/source-link-access-holds.json` is an explicit, committed, cross-run access
policy, not a source snapshot, success cache, content refresh or permission grant.
Its initial 187 observations are exact four-field projections (URL, final URL,
status and original observation time) from successful main Quality run 39773856843,
artifact 12423373003 at commit 4f3a43b0ce8236519d2fb9f93e91c4775d8ecb50.
The policy records the immutable ZIP and report-member SHA-256 values. There are
44 actual HTTP 403 receipts (no recorded 401) and 143 HTTP 429 receipts (112 Instagram, 31 Canton).
The source artifact recorded no Retry-After value, so none is invented.

401/403 holds apply to the exact normalized requested and final URL, retaining
path/query distinctions. Fragments, trailing DNS dots and www/apex aliases cannot
bypass a hold. A 429 holds its canonical hostname across schemes/ports and www/apex,
not unrelated subdomains or the public reference itself. This is conservative
access control, not a claim that every page on that host returned 429. Instagram
links remain present and are not globally quarantined by source-integrity policy.
All holds require materially new reviewed evidence and a reviewed policy/code
change before resumption. There is no timed release, expiration override, automatic
probe, alternate credential or host-wide inference of business closure. A genuine
Retry-After header is recorded and parsed as an advisory minimum, never as renewed
permission. Missing/malformed policy stops the checker before transport.

The fixed, validated registry is mandatory at the shared `fetchPublicSource` /
`fetchGuardedSource` boundary, not only in QA. Known targets are checked before
robots callbacks, inside a canonical-host header queue, and on every redirect hop.
The robots adapter also checks a known content hold before an unnecessary robots
request. Host holds include robots.txt; exact-URL holds do not block unrelated
paths. Existing quarantine still takes precedence without removing the independent
access hold. The queue lock covers only the native request and response-header
boundary, never robots recursion or body reads, so a robots request to the same
host cannot deadlock. Requests for unrelated hosts remain independent.

A response observer remains necessary for truthful per-hop receipts if a later
redirect is denied or fails, and for capturing restrictions before body handling.
A 401/403/429 is registered at the native header boundary even when it arrives after
the operation expired; an expired successful response is never revived as content,
a successful observation, or permission to redirect. On deadline, one explicit
event-loop turn lets an ordinary native abort settle. A genuinely still-pending,
abort-ignoring transport creates a host suspension with null HTTP observation,
`pendingTransportReviews`, and a failing process status. Its host cannot resume.
Late actual restrictions are separately logged even after the QA report snapshot.
The cleanup does not extend a deadline or accept late content. This mandatory
access boundary intentionally also affects callers without optional observers;
their unaffected manual redirects, quarantine, robots decisions, limits and schedules
are not relaxed. It does not claim to repair every collector's robots behavior.

Only two actual hard 404/410 responses confirm a broken link. The validator rejects
a one-response confirmation, more than four responses in an attempt, noncontiguous
attempt chains, and receipts attributed to an attempt that never ran. Transient
failures, holds and unresolved transports never become confirmed breakage.

The release validator independently reconstructs the complete ordered URL universe,
identities/kinds, counts, HTTP chains, policy bindings and lifecycle projections.
Held evidence may be old but cannot be invalid/future or fabricated; successful
current evidence must still be recent. Same-head cache reuse remains opt-in and
cannot override access holds. Reused successful receipts preserve original clocks
and the prior-report digest; they are explicitly unattempted now and cannot create
new lifecycle candidates. A closure candidate requires an actual official-website
HTML/XHTML response and a completed bounded read/cancellation receipt. Social or
action-only HTTP success is not content evidence. The independent lifecycle and
parity consumers additionally bind each candidate to its current exact official
source association. Generic ledgers cannot turn a held decision into a successful
observation. Quality reports distinguish held/attempt counters and retain blocked
destinations as restrictions, not retryable failures.

The actual official-site overlap has a narrow retention path: a held/failed refresh
is a separate current assessment, never a new successful observation. A genuine
prior official-site observation survives only with the same restaurant identity,
exact normalized requested-source association, valid old clock and successful HTTP
receipt. Changed paths, queries or identities cannot borrow same-host evidence;
invalid/disassociated prior records are archived rather than relabeled current.
The same qualification applies to unselected records before bounded refreshes
carry them forward. Disappeared identities, changed sources, invalid clocks and
root held/unattempted pseudo-observations are archived, not retained as active
content. A separate latestAssessment held does not invalidate a genuine prior
observation. Structured-facts pre-transport holds
are explicitly unattempted and do not restamp retained facts. Accepted canonical
data, reference links, media rights, source inputs and public UI code are unchanged.

New restrictions and unresolved transports stop relevant queues immediately. Each
produces a provenance-bound `HALIFAX_SOURCE_ACCESS_DIAGNOSTIC` JSON line in the
existing job log and in `artifacts/source-access-diagnostics.jsonl`, with a failing
process status even if an individual producer catches its exception. That prevents
the next normal workflow command from automatically proceeding after discovery.
QA additionally emits `pendingAccessHolds`, `pendingTransportReviews` and any late
restriction receipts available before its snapshot. The release gate fails closed.
Quality's always-uploaded diagnostic artifact includes both the link report and
JSONL; Content Quality also uploads a nonpublishable diagnostic artifact. The log
receipt remains available if no validated-site artifact was produced. Diagnostics
are explicitly not accepted releases.

Review the exact run and original receipts and commit the necessary holds before
any subsequent hosted batch. The committed policy persists across runners; newly
discovered state is only process-local. There is no authorized shared durable
runtime store, automatic cross-run policy write or guarantee that an unreviewed
denial is visible to an independently started later workflow. Publication and
collection coordination must enforce the reviewed policy-update boundary. Time
passing or a later incidental 200 is never a hold-removal decision. No credentials,
access, durable-state service or permissions were added.

For QA or other producer failures, a reviewed `reviewed_workflow_log` evidence group can
bind an original HTTP-restriction diagnostic to the exact repository, source SHA,
workflow run/attempt/job identity, independently retrieved full job-log hash, and
exact compact diagnostic/HTTP-receipt hashes. `loggedAt` is a diagnostic emission
clock, not a replacement for the original HTTP `observedAt`. The embedded original
diagnostic must match its selected observation, receipt and run/policy context.
Unresolved transport is not an HTTP observation and cannot enter that variant.
An unresolved-only outcome blocks the next batch until independently resolved or
a separately reviewed conservative hold/code change is accepted. Never invent a
status or observation clock, or retry a blocked target merely to fit this schema.
Before committing any such group, retrieve the actual job log and job metadata and
independently verify those hashes and the selected original line. Local structural
validation does not authenticate an external log merely because hashes are present.
The variant has hostile fixture coverage and is also used below for five actual
reviewed QA diagnostics. It adds no storage service or automatic cross-run writes.

Content Quality Audit PRs run only exact-head, transport-denied fixtures; its
scheduled/manual producer commands, bounds and schedule remain unchanged. Quality
remains the sole live PR link-status lane. All 13 workflow intersections were
audited against the complete changed-file set. Seven intersect the candidate PR:

| Workflow | Candidate PR jobs | Scheduled/manual producer boundary |
| --- | --- | --- |
| Quality | `data-integrity`, `ui-verification` | Existing release validation only |
| Content Quality Audit | `validate-pr` | `audit` excludes PRs; commands/bounds unchanged |
| City Events | `validate-pr` | `refresh-events` excludes PRs |
| Social Source | `validate-pr` | `social-refresh` excludes PRs |
| Source Expansion | `validate-pr` | `refresh` excludes PRs |
| Structured Specials | `validate-pr` | `refresh` excludes PRs |
| Structured Place Facts | `validate-pr` | `refresh` excludes PRs |
| Restaurant Discovery | None | Legacy `discover` trigger paths are untouched |
| Structured Events | None | `extract` trigger paths untouched |
| Verified Source Pages | None | `verify` trigger paths untouched |
| Deploy Pages | None | `deploy` is gated on accepted Quality artifact |
| Promote Preview Artifacts | None | `reconcile` / `promote` triggers untouched |
| Retired Source Expansion Promotion | None | `retired` triggers untouched |

The six non-Quality validation jobs are exact-head, transport-denied tests, not
collection. The shared guard enforces the reviewed access policy if an existing
scheduled/manual collector later runs, including concrete official-site, discovery,
verified-page, page-intelligence, event, structured-fact and thumbnail overlaps.
Those schedules and collection bounds were not changed. No hosted workflow or
source request was run by this offline repair.

Offline regression commands:

```sh
node scripts/test-link-access-holds.mjs
node scripts/test-link-audit-freshness.mjs
node scripts/test-scheduled-source-guards.mjs
node scripts/test-public-source-fetch.mjs
node scripts/test-lifecycle-language.mjs
node scripts/test-update-consistency.mjs
node scripts/test-release-source-isolation.mjs
```

Historical restriction union: the policy also preserves 26 exact Jungle Jim's
403 receipts from accepted run 39767300296/artifact 12421525297 and the additional
Instagram 429 receipt from accepted run 39744158052/artifact 12411255693. Their own
immutable ZIP/member hashes and original clocks are recorded in historical evidence
groups. A later 200 is not a reviewed decision to lift an earlier restriction.
That accepted-artifact union of 214 original receipt URLs yields 74 unique normalized exact 403
original/final keys plus two canonical 429 hosts, covering 215 current reference
URLs. One of those references had a source-response-dependent quarantine in the
original artifact. The host hold prevents contacting it to recreate that redirect.
Static initial-URL quarantine still takes precedence; current held/quarantine totals
must come from actual decisions, not a projected replay of old redirect outcomes.
All ten locally retained accepted ZIPs were inspected offline; their 1,232 restriction
rows add no URL/status pair outside this three-artifact union. No new source request
was used to reconstruct this evidence. Public reference URLs remain unchanged.

PR 159 Quality run 39792176695, attempt 1, `data-integrity` job 119870732180
at source commit c1fd484193edb6200a508f067f00d47ac6656de2 failed closed after
five new actual HTTP restrictions. Five appended `reviewed_workflow_log` groups
preserve the original diagnostic and request/observation clocks from that job:
four exact 403 URLs (two order.online paths, one Uber Eats URL and one SkipTheDishes
URL), plus a canonical linkedin.com host hold from one 429. No Retry-After was
recorded, and there were no unresolved-transport or late-restriction diagnostics.
The full retrieved log SHA-256 is
`24ccd634fb6f1b5677901fb4250bef55a2b80539918576f8b5d7d377db958bca`.
Each compact diagnostic exactly matches its JSONL line in diagnostic artifact
12431353274, ZIP SHA-256
`b85096b6c05c52f7ff44ccc9bae6a34d1c248114c8878adb72a78ec5a1436d21`,
and its actual receipt in the artifact's link report. This failed-run artifact is
not an accepted release. Existing accepted-artifact evidence is unchanged.

The expanded union has 219 observations (74 actual 403, 145 actual 429 and no
production 401), 78 exact original/final 403 URL keys and three canonical 429 hosts.
It holds 222 of the unchanged 1,060 release reference URLs. The seven additional
held references are the four exact denied URLs and three LinkedIn references;
the latter are host-scope decisions, not three separate 429 observations. No
business facts, public URLs or lifecycle decisions are changed. The next hosted
batch still requires independent review of these original receipts and metadata;
neither elapsed time nor a failed job permits automatic source retries.
