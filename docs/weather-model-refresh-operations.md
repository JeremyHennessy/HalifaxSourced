# Manual GFS / IFS refresh and local publication review — disabled

This component makes the two already admitted distribution paths repeatable without AI. It does **not** publish a new forecast, enable a workflow/schedule, broaden provider access, or demonstrate improved accuracy. `data/weather-model-refresh-policy.json` has `enabled:false` and `scheduleEnabled:false`. The currently accepted model snapshot, official ECCC source switch, news data and browser behavior are unchanged. A separate explicit **local-only** model publication contract can validate and stage a completed refresh on a review branch; it never activates collection, pushes, merges, deploys or bypasses Quality Gate.

## Fixed scope and discovery

- NOAA NOMADS `filter_gfs_0p25.pl`: follow the actual root → date → cycle → `atmos` links; require the actual form's jointly listed directory/file. Request only 2 m temperature over west−63.75/east−63.5/south44.5/north44.75. Maximum field 1 MiB; metadata 256 KiB/page and four pages.
- ECMWF `data.ecmwf.int/forecasts/`: follow actual date → cycle → `ifs/0p25/oper` links, at most six 1 MiB listings. Only a listed `.index` (≤256 KiB) can authorize its exact 2t surface forecast range. Require HTTP 206, identity entity bytes, matching numeric Content-Range and exact indexed length, ≤4 MiB. Never request a full bundle or execute page JavaScript.
- Newest actually listed date/cycle only. Never invent a cycle, fall back to an older complete cycle, use a mirror, or retry held GeoMet/Open-Meteo/DWD paths. Missing individual target files are explicit partial coverage; unrecognized/challenge/error listings are held. Known stale cycles are unavailable rather than freshened.
- Five next UTC three-hour instants, matched by **valid time**, within 24 hours; source reference cycles may differ. GFS reference age must remain below 18 hours; IFS below 24 hours. Only Halifax Peninsula, Bedford and Dartmouth receive nearest-grid temperature projections. The existing strict ecCodes decoder verifies raw hashes, GRIB identity, units, physical bounds, grid/point bounds and times.
- Actual request, header, body completion, model reference and aggregate issuance clocks remain separate. Source publication and first availability remain unknown. A304 or reused exact field never changes original field clocks. A local target/reference freshness boundary during a completed run becomes partial, not a fabricated source denial. Final aggregation must still contain both expected families for every candidate cell.

## Bounded transport and durable continuity

One run permits at most **27 HTTP operations and40 MiB received bytes**: two robots policies, ten listings, five indexes and ten fields. Every operation has a 15-second complete request/body deadline; the run checks a 12-minute request-start budget. There is at least 10 seconds between completed operations, a descriptive caching-compatible User-Agent, conditional ETag/Last-Modified metadata requests and no cache-busting headers. Immutable exact field reuse avoids repeated downloads. When a new listing postdates a cached index, the index is fetched anew: old source chronology is never relabelled.

Every source request follows an fsync-backed pending journal entry. A fixed private state root has:

- one exclusive, permanent bootstrap identity;
- an exclusive writer lock (no timeout or automatic lock deletion after interruption);
- sequential immutable run directories, state hashes, journal hashes and exact predecessor-final hashes;
- verified referenced metadata bodies, field evidence and current/last-good candidates before the next request;
- content-addressed raw bodies plus compact field metadata, without duplicate per-field base64 blobs;
- a policy fingerprint binding the registry, points, decoder, dependencies, request/robots/hold guards and command code. A changed policy/code fingerprint requires reviewed migration, not an automatic reset. An accepted baseline may advance only to the same store's latest complete candidate with its exact final hash and original clocks; unrelated baseline changes still stop. That advance is recorded in the next immutable state, never by rewriting genesis or prior receipts.

The normal minimum interval is 55 minutes. There is **no retry within a run**. Only a completely received 502/503/504 response without challenge evidence is eligible for the next invocation after explicit 1 h/2 h/4 h backoff. A valid Retry-After can only delay further; malformed values hold. A fourth consecutive complete transient response holds. Any 401/403/429, redirect, unknown transport/timeout, interrupted body, malformed data, invalid range, missing state, unresolved journal or integrity mismatch requires reviewed recovery. Complete response evidence is retained separately from unknown outcomes. A later failure/partial state retains the previous successful candidate or the original accepted-publication baseline reference; it cannot publish or freshen that forecast.

## Storage and publication boundary

The store is outside the repository and must be private durable storage controlled by the operator. The implementation enforces a 512 MiB ceiling, reserves 96 MiB before a run and stops instead of deleting evidence or exceeding retention. Receipts and original bodies are immutable. **There is no automatic garbage collection.** This is a bounded manual producer, not yet an indefinite hosted service.

Portal HTML/JavaScript remains only in this private store for conditional caching. `candidate.json` includes licensed GRIB/index evidence and an explicit factual index-anchor extraction—not portal HTML/JS, cookies, credentials or response headers. Review artifacts are capped at 32 MiB. Bodies are not appended to binary Git history and are not copied to Pages. Operators must not upload the entire private store as a public Actions artifact.

**Hosted persistence remains a concrete unmet prerequisite, not an implemented/operational lane.** A hosted automatic producer needs a reviewed exact-run/final-receipt persistence adapter and a finite raw-evidence retention/export policy that preserves active holds and candidate provenance. The ECCC/news exact-run identities and verified-save sequence are useful patterns, but their payload persistence is not reusable for this store as-is: it includes portal HTML/JavaScript, response headers, journals and original error bodies that must stay private. A sanitized candidate lacks the complete robots/listing/error evidence and pending-state continuity needed to resume safely. No suitable existing private hosted persistence has been established. Therefore there is no nominal hosted workflow, full-store public cache upload, body-stripping restore, automatic rebootstrap or claim of indefinite operation. Cache eviction or lost pending/final state must stop collection, not bootstrap again. No new service, credential, repository setting or permission is requested. The current ECCC-only hosted weather promoter does not accept model candidates and is unchanged. The model-specific local review command below is separate and requires the original private store; its output is not an automatically trusted Actions artifact. Generic Quality Gate, decoder, source/schema/privacy and browser gates remain intact.

## First bounded acceptance (after independent review and exact-main verification)

1. Review this code and the existing provider admission evidence in `weather-multimodel-acceptance-20261028.md`. Test a separate change setting **only this manual policy's `enabled:true`**; keep schedule false and all provider publication/accuracy claims unchanged. No collection before that change is reviewed and the exact tested main is confirmed.
2. Prepare the existing hash-locked ecCodes isolated interpreter. No decoder/package download occurs inside the producer. Use the same commands as Quality Gate; do not use a system-wide install.
3. Choose one persistent private absolute directory outside the repository. Run the explicit one-time bootstrap only for genuinely empty first-run storage:
   ```sh
   node scripts/refresh-weather-models.mjs bootstrap /absolute/private/model-review
   WEATHER_GRIB_PYTHON=/absolute/reviewed-venv/bin/python \
     node scripts/refresh-weather-models.mjs collect /absolute/private/model-review
   ```
   CLI rejects GitHub event environments: no hosted adapter is activated yet. Bootstrap is not recovery. Never change the directory to escape a hold or lost state.
4. Independently check the final receipt chain, all request/body hashes and status, selected actual cycles/targets, exact ECMWF ranges, raw decoder replay, three-point scope, unknown publication clocks, candidate aggregation and absence of portal code/private headers. A partial/failed candidate is not a successful refresh.
5. After at least 55 minutes (or the explicit later backoff), use the **same directory** once more. Prove conditional/reused facts retain original clocks, new facts have true clocks, and the predecessor chain is exact. No publication, dispatch or cron activation is implied.

## Explicit local model-only publication contract

Only the latest **complete successful** run is eligible. Later failed, partial, held, unresolved or pending runs prevent publication of an older success. Publication replays the entire retained newest-listing discovery chain, original field/index receipts and ECMWF anchor extraction, checks all five future instants × three points × both families, and **redecodes all ten licensed GRIB fields** with the reviewed isolated interpreter. Raw hashes do not independently prove source authorship; the private journal and reviewed acquisition code remain necessary trust boundaries.

The exact store baseline, code and policy/configuration bytes are pinned before decoder replay and rechecked afterwards. Pending writers, a changed final receipt, moved baseline, changed code/policy, future completion clocks or an expired target/reference fail closed. A newly accepted model archive uses a narrow v2 model manifest with refresh admission and original private candidate/final hashes. Existing v1 captures and their issuance guards are unchanged. The actual run-completion clock may follow its frozen aggregate issuance; field retrieval and model-reference clocks are never rewritten.

After the manual producer has been independently reviewed, enabled and completed, use an absolute **new** package directory outside both the repository and private store:

```sh
WEATHER_GRIB_PYTHON=/absolute/reviewed-venv/bin/python \
  node scripts/review-weather-model-refresh.mjs package /absolute/private/model-review /absolute/model-package
WEATHER_GRIB_PYTHON=/absolute/reviewed-venv/bin/python \
  node scripts/review-weather-model-refresh.mjs verify /absolute/private/model-review /absolute/model-package
# Explicit review-branch edit only; no source request, push, merge or deployment:
WEATHER_GRIB_PYTHON=/absolute/reviewed-venv/bin/python \
  node scripts/review-weather-model-refresh.mjs apply /absolute/private/model-review /absolute/model-package
```

The package contains exactly five files: `weather-evidence/current.json`, its content-addressed licensed archive, `data/build/halifax-weather-models.json`, `data/weather-models.js`, and `review/model-refresh-publication.json`. Only the first four become review-branch inputs; the last is a hash-only review contract. No supplied JavaScript is executed: the wrapper and JSON must exactly match an independently rebuilt projection. Extra files/directories, symlinks, executable injections, private metadata and mutated receipts/values are rejected. The immutable archive retains only licensed GRIB/index bytes plus factual anchor extraction—never source portal bodies or response headers. It remains outside the Pages release copy.

`apply` stages every file, then performs the final clock/code/policy/private-run check **before replacing any accepted file**. A rejected final check leaves all four accepted targets unchanged; a caught filesystem write failure restores the original bytes. A process crash or failed rollback still requires review of the local branch, never deployment or automatic recovery. Normal raw-decoder, schema/privacy, data-integrity, browser, PR and deployment gates remain mandatory. The refresh policy stays `enabled:false` and `scheduleEnabled:false` in this change; no new source access, service, credential or schedule is implied.

Failed/partial collection does not publish a fresh-looking model snapshot. The accepted last-known-good forecast remains visible with its original timestamps and normal age/expiry behavior. This provides a usable bounded local review/publication path, **not** continual hosted aggregation, all-weather coverage, calibrated uncertainty or proven accuracy improvement.

## Offline verification

```sh
node scripts/test-weather-model-discovery.mjs
node scripts/test-weather-model-refresh-state.mjs
node scripts/test-weather-model-refresh-transport.mjs
node scripts/test-weather-model-refresh.mjs
WEATHER_GRIB_PYTHON=/absolute/reviewed-venv/bin/python \
  node scripts/test-weather-model-refresh.mjs
```

Discovery uses synthetic edge fixtures and was additionally replayed locally against the actual retained NOAA/IFS discovery evidence. Integration uses synthetic HTTP/discovery with ten frozen retained real fields in isolated fixture repositories (not a date pin on future accepted releases); it is explicitly **not a new source acquisition**. With the interpreter supplied, the producer and publication package/verify/apply paths invoke the real decoder on all ten fields. Regressions cover exact baseline continuity, no-write rejection at the final apply boundary, code/policy changes during replay, changed private runs, stale/future/partial cases, symlinks and private/executable injection. The separate accepted-snapshot decoder gate continues to replay whatever archive is actually current. Hosted Quality Gate requires that replay in the decoder job and runs all offline state/transport/discovery tests again in data-integrity. No live source is called by these tests.
