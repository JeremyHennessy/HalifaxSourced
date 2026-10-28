# Guarded Halifax weather refresh (implemented, not activated)

## Current boundary

Collection remains **disabled** in `data/weather-source-registry.json`. `refreshPolicy.scheduleEnabled` is also **false** and the new `weather-preview.yml` has **no cron**. There has been no source request, workflow dispatch or operational acceptance for this implementation. The only accepted source response remains the original 2026-10-28 00:43 UTC receipt, with its original source issue/observation clocks. This is not yet an operationally fresh service.

No browser weather API calls, Open-Meteo, paid service, credentials, permission changes or accuracy claims are introduced. All 47 accepted news items and all news admission/hold states are outside this lane.

## Immutable evidence versus current publication

- `scripts/fixtures/weather/eccc-citypage-20261028*.json` are immutable **regression fixtures**, not release inputs.
- `data/weather/captures/<sha256>.json` contains the original raw body string and its actual receipt. The hash is of the complete capture bundle; the receipt also verifies the original raw-body bytes/hash. Existing capture bytes must never be replaced or deleted by promotion.
- `data/weather/current.json` selects exactly one accepted capture plus the last attempt/health outcome and producer identity. Failure/held/partial/pending and HTTP 304 retain the same capture. A new actual complete HTTP 200 capture may be accepted separately; the original stays on disk.
- `build-weather.mjs` derives `data/build/halifax-weather.json` and `data/weather.js` from this manifest. Rebuilding is deterministic and cannot refresh any source, receipt, warning, issue, observation or valid-time clock.
- `check-weather.mjs` validates the **actual accepted current snapshot** semantically and requires exact JSON/browser-wrapper parity. Unit/UI edge cases use the immutable fixture. Hosted browser tests first verify the actual packaged snapshot at viewing time, then explicitly inject the fixed fixture for deterministic expiry/failure/partial/notice/DST cases. They no longer require every release to be the 00:43 capture.

## Producer and continuity

`weather-preview-lineage.mjs` reuses the proven exact-run design in a separate weather namespace:

1. Source-disabled and schedule-disabled checks precede metadata or source requests. Only the public repository's trusted default branch, attempt 1, and reviewed dispatch/schedule event are admissible; no PR/fork/rerun.
2. The genuine workflow run number **1** requires explicit manual `initialize_review_cache=true`. Empty history, a renamed workflow, a failed first dispatch, cache loss or an older payload is not bootstrap permission. No fallback or reset input exists.
3. Run N must identify **exact N−1**, successful attempt 1, through bounded official public GitHub metadata; it must restore that run's exact payload and separately saved final receipt. Receipt identity and payload digest must match. Metadata is checked again after restore. Failure, cancellation, skipped runs, missing/broad cache matches or unknown lineage stop before even an ECCC request.
4. The sole endpoint remains the strict `ns-19`/`ns-40` request in `eccc-weather.mjs`: one regional forecast, Halifax Stanfield and Shearwater named airport observations, no additional geography/provider/fallback. Limits remain one transport, no redirects/retries, 20 seconds including body, 512 KiB and two exact records.
5. Before transport, exclusive pending journal bytes, journal pathname and every parent directory are synced. Failed durability, a symlink or an existing journal means zero source requests. The journal is retained in the always-uploaded review evidence even when collection fails.
6. Target cadence after separately reviewed activation: **hourly**, proposed cron `17 * * * *`. A **55-minute minimum interval** permits ordinary scheduler jitter without inadvertently skipping every other hour. An early dispatch creates a deferred receipt and no request or publication candidate. No source retry occurs within a run.
7. Real ETag/Last-Modified validators, when provided, are forwarded conditionally with the meaningful cache-friendly User-Agent; no validator, cachebuster or no-cache directive is invented. HTTP 304 gets a separate validation receipt and preserves the original capture, retrieved/issue/observation/warning clocks. It does **not** re-establish a no-warning or fresh badge. The original sample supplied no validators, so a first subsequent request may be unconditional.
8. Any failed/held/partial/unknown outcome sets an enduring payload hold. Later intact-chain runs retain that hold without source transport; passage of time does not release it. Interrupted or late-unsettled transport also breaks the workflow chain. Held predecessor outcomes cannot be retried directly through the adapter. Recovery needs independent reviewed evidence and an explicit reviewed implementation; there is intentionally no recovery/reset switch here.
9. Transport decisions must drain before a completion marker. The payload cache save is followed by an exact lookup. Only then is the digest-bound final receipt written, saved separately, and independently looked up. A cache-save warning is not treated as durable success. Failure during any later workflow step still makes the next run stop because its predecessor was not successful.

Warning freshness remains <30 minutes and both city updates <90 minutes; hourly polling therefore intentionally leaves periods of **warning status unavailable**. A polling schedule does not extend these safety limits or create complete HRM/all-hazards coverage. Forecast/observation TTLs remain unchanged. Failure and warning uncertainty are visible near the top, before the forecast. Source detail clocks can be expanded, and official forecast text/links appear before the long hourly table.

## Existing publication lane, with no permission expansion

The existing `Promote Preview Artifacts` workflow already owns `contents: write`, `pull-requests: write`, and `actions: write`. **None of those permissions changed.** A new **manual-only** `weather-preview` choice uses that writer, reservation/lease protection and draft-PR flow. Other producer triggers never select the weather lane; news remains excluded.

The artifact may contain exactly:

- `data/weather/current.json`
- its one content-addressed `data/weather/captures/<sha256>.json`
- `data/build/halifax-weather.json`
- the precisely regenerated JSON-assignment wrapper `data/weather.js`
- three review-only contract/payload/final-receipt files under `artifacts/`.

No arbitrary JS, news, source registry, holds, other data or app/rendering file can pass. Unknown/missing paths, symlinks, mismatched hashes, wrong producer/run, receipt tampering, current/attempt rollback, failure/304 replacing accepted LKG, or existing capture replacement fail closed **before copying**. Retained/deferred runs produce evidence, not a new publication candidate. Weather uses exact byte changes rather than the unrelated news/content receipt-normalization heuristic: true weather observation and health clocks must not be discarded as a meaningless change.

The contract also hashes all tracked app/scripts/workflow/vendor/config files (excluding data/docs/reports) and requires them to match the promoter's current baseline. A newer app or parser cannot be silently replaced by an old producer tree. This is an **additional** safeguard, not a faster data-only release gate. The ordinary full Quality Gate—including source/schema, privacy, browser/offline-edge, release-integrity and unchanged generic checks—still runs on the proposed branch and exact main after merge. Existing gated Pages deployment remains unchanged.

**Remaining publication boundary:** a successful producer only prepares evidence. An explicit exact-run promotion can prepare a draft PR, not merge/deploy it. Existing repository PR-creation restrictions may prevent Actions from opening the PR; then it leaves the reserved branch and exact error for an already-authorized operator to open/review using existing access. Do not change repository security, add a token or create credentials. Full exact-head CI, review/authorized merge, main Quality Gate and Pages verification are still required. Failed/unknown producer workflow runs are never eligible for automatic artifact promotion; any public health update from such a run needs separate reviewed recovery, while existing published data expires locally on its original TTL.

## First bounded live acceptance procedure — not executed

1. Review/test/merge this dormant implementation and verify exact-head hosted UI/source/privacy/release gates. Inspect public main and Pages provenance separately; do not call implementation tests live-source acceptance.
2. Review the existing ECCC access policy, weather workflow run history and registry. Confirm this weather workflow has never run and its first run number will be 1. **Do not dispatch while disabled as a test:** that consumes run number 1 and safely prevents unreviewed bootstrap.
3. In a separately tested activation change, set only the ECCC source `enabled=true`, update its descriptive state/name, and keep `scheduleEnabled=false` and cron absent. Do not modify a held-source policy, credentials or permissions. Verify the exact activation main SHA and applicable full gates.
4. Dispatch that exact trusted main workflow **once**, initialization **true**. Expect at most one allowed ECCC request and no publication. Wait for terminal status; verify actual pending/final journal, response body/receipt hashes and times, exact two city/station identities, units/24-hour ordering/forecast equality, actual warning shape, drained completion, and both exact cache saves/final digest. A denial, malformed/partial response, unknown transport, wrong identity or lost receipt is a stop, not permission to rerun.
5. After at least 55 minutes, dispatch **once** with initialization **false**. Verify exact first payload/final receipt restoration and second payload/final cache identities. Record whether the real branch was HTTP 200 or 304; do not claim conditional live acceptance from mocked tests or an absent validator.
6. Review the strict weather-only candidate. Explicitly promote the exact successful run using `Promote Preview Artifacts`, `artifact_name=weather-preview` (read-only `dry_run=true` first if desired). Verify the reserved branch contains only the whitelisted weather capture/manifest/derivations and standard promotion receipts; all 47 news items/states and all non-weather data stay intact. A failure/304 candidate must refer to the already accepted capture; accept its successful predecessor first if necessary.
7. Complete the existing draft-PR/full-quality/authorized-merge/main-quality/Pages path. Verify deployed capture hash, source clocks and fresh/stale/failure/unknown-warning behavior. No realtime or improved-accuracy claim.
8. Only after this evidence, separately review a schedule activation that sets `scheduleEnabled=true` and adds the proposed hourly cron. Do not backdate the workflow's first bootstrap or use initialization on later runs. Publication remains separately reviewed unless another explicitly tested, authorized publication policy is approved; no such autonomous merge/deploy path is introduced here.

## Offline verification

`test-weather.mjs`, `test-weather-journal.mjs`, `test-weather-operations.mjs`, `test-weather-run-lineage.mjs`, `test-weather-ui.mjs`, and `check-weather.mjs` cover identity/units/geography/TTL; immutable/current separation; original clock retention and 304; exclusive durable pending journal failures; exact bootstrap/predecessor/cache/final-receipt matching; permanent holds and cadence; strict weather-only artifacts, injected JS rejection and unchanged-code baseline; and current snapshot semantic parity. All transports/metadata in tests are mocked. Hosted browser tests retain source-network denial and test both actual-current and fixed edge inputs. No local browser escalation is required or authorized.
