# Halifax weather foundation: recorded ECCC evidence, not live collection

## What this slice does

`#weather` shows **one** official **Halifax Metro and Halifax County West** regional forecast and **two named station observations**, not six independently calibrated point predictions. It loads committed local data only. The footer and mobile More menu link to it. No weather API call occurs in the browser, release build, CI or schedule. `data/weather-source-registry.json` keeps collection **disabled**; the source catalogue/admin row says so and distinguishes request, retrieval, forecast-issue and observation clocks.

Only these six reviewed HRM points are in scope: Halifax Peninsula (44.6488,-63.5752), Bedford (44.7318,-63.6619), Dartmouth (44.6661,-63.5676), Clayton Park (44.6718,-63.6530), Lower Sackville (44.7757,-63.6786), Eastern Passage (44.6109,-63.4820). This is a scope restriction, **not a municipal-polygon completeness certificate**. The application does not generate or distribute point forecasts for them. No other location, legacy model, historical scoring archive or legacy app code was imported.

The two checked city products are `ns-19` **Halifax** at [-63.6,44.65] and `ns-40` **Halifax (Shearwater)** at [-63.56,44.67]. Do not rename the second product Dartmouth. Its station is Shearwater Airport (`yaw`); Halifax's station is Halifax Stanfield Int'l Airport (`yhz`). Those observations are not downtown, Bedford, Dartmouth or neighbourhood readings. Station identity and coordinate text are pinned independently of city-page coordinates.

## Admission evidence and original clocks

Official interface documentation: [ECCC City Page Weather](https://eccc-msc.github.io/open-data/msc-data/citypage-weather/readme_citypageweather_en/) links the experimental [GeoMet collection](https://api.weather.gc.ca/collections/citypageweather-realtime?lang=en). Schema changes are expected to require review, not permissive fallback.

One bounded request was made before this implementation:

`https://api.weather.gc.ca/collections/citypageweather-realtime/items?f=json&lang=en&bbox=-63.61,44.63,-63.55,44.67&limit=3`

| Evidence | Actual clock/value |
| --- | --- |
| Request attempted | 2026-10-28T00:43:26.981Z |
| HTTP response | 2026-10-28T00:43:33.582Z, HTTP 200, application/json |
| Body retrieved | 2026-10-28T00:43:33.585Z |
| API response generated | 2026-10-28T00:43:33.534142Z |
| Source updated (Halifax / Shearwater) | 2026-10-28T00:03:43Z / 00:06:37Z |
| Regional / hourly forecast issued | 2026-10-27T19:00:00Z (4 p.m. ADT) |
| Hourly valid instants | 2026-10-28T01:00:00Z through 2026-10-29T00:00:00Z; 24 hourly points |
| Both station observations | 2026-10-28T00:00:00Z (9 p.m. ADT Oct 27) |
| Stanfield / Shearwater temperature | 1.6°C / 4.1°C |
| Raw body | 64,781 bytes |
| SHA-256 | `448b6c163d4a8083f17adecb6620c82ba5b6fa52c61844c999ea349abb374ccb` |

Raw JSON: `scripts/fixtures/weather/eccc-citypage-20261028.json`. Original receipt: adjacent `eccc-citypage-20261028-receipt.json`. The original probe's `allowedCityNames` discovery expectation included Dartmouth; the actual returned record and subsequent strict semantic admission use **Halifax (Shearwater)**. The original receipt is preserved rather than retrospectively rewritten. Both regional and hourly forecast objects were identical across the two city pages. Projection checks this equality and refuses divergent products.

The server supplied no ETag, Last-Modified or Cache-Control; no validators are invented. The original request used a meaningful HalifaxSourced source-review User-Agent, JSON Accept header, no no-cache/cachebuster, no redirects, a 20-second complete-operation budget and 512 KiB body ceiling. It used the project's guarded transport and existing held-source policy. No further source request was made for implementation/testing.

## Contract and honest failure handling

- Raw admission: `scripts/lib/eccc-weather.mjs`; exact URL, two distinct IDs, names, coordinates, region, station identities, units, ordering, full result counts, no next page, bounded body and hash/receipt correspondence are checked. Additional/non-Halifax records, partial responses or divergent regional products fail closed.
- Offline projection: `node scripts/build-weather.mjs` writes `data/build/halifax-weather.json` and `data/weather.js` from the fixed fixture. It never creates a new issue, observation, retrieval or successful-collection clock. Identical rebuild preserves bytes and mtime.
- Envelope: `{version:1, activation:'recorded_snapshot_no_refresh', lastAttempt, lastKnownGood}`. Failed/held/partial/pending attempts retain old accepted facts and old clocks; they cannot retain a fresh status or no-warning badge.
- Browser/Node view policy: `weather-contract.js`. Application limits (not ECCC guarantees) are observation age **<2h**, forecast issue age **<18h** plus a future hourly valid point and successful receipt age **<2h**; warnings require successful complete receipt age **<30min** and both city-update ages **<90min**. Equality at the boundary expires the label. The page checks its local viewing clock, not build time.
- UTC clocks are stored unchanged; UI uses `America/Halifax` with explicit ADT/AST, including repeated fall-back hours. Hourly times are **valid instants**, not invented hourly interval endpoints. Daily publisher labels have no supplied exact start/end timestamps; the UI preserves `Tuesday night`, issue time and original text, never rolls `Tonight` to the viewer's day.
- Units: °C, km/h, declared **percent** probabilities, kPa. A source 0.75% remains 0.75%, not 75%. Null stays unavailable, not zero. No numeric precipitation amount was admitted in this sample; `precipitationAmountMm:null` must not become 0 mm. Source QA codes are not accuracy percentages.
- Warnings: both complete successful source records explicitly held `warnings: []`. Only a fresh complete accepted response may say **“No warnings were listed in the checked ECCC Halifax city pages”** at the recorded check time. This is not all HRM, all hazards or an all-clear. Missing, stale, failed, held, partial or malformed warning evidence means **unavailable**. Nonempty warning objects preserve the original source object, but their detailed schema was not fixture-verified: show a neutral notice with the original official page links, never rewrite warning intent or silently declare none.

Dormant adapter: `scripts/lib/eccc-weather-adapter.mjs` exports a review-only function, no CLI or workflow. Its default registry is disabled. A future separately reviewed activation would use the existing mandatory access/quarantine guard, exact single endpoint, no redirects/retries/fallback, 20-second body-inclusive deadline, 512 KiB ceiling and meaningful User-Agent. Before transport, every ancestor directory is opened without following symlinks and synced; any newly created directory and its parent are synced in order. Exclusive journal creation then writes/fsyncs the pending bytes and fsyncs the containing directory, making the journal pathname durable before the guarded request can begin. Unsupported directory fsync or any failed barrier aborts without a source request; it never deletes an uncertain journal. Final success/failure is appended and fsynced afterward. Any existing journal blocks another invocation, including after interruption; do not delete/rename it to bypass source restrictions. Returned candidates are not published. Persistent access denials still require the project's reviewed-evidence process; a success journal is not permission for repeated polling. Headers retain actual validators if provided, but this slice has no repeated/conditional request policy because collection is not active.

## Reuse and attribution

Reviewed official [ECCC data-service end-use licence](https://eccc-msc.github.io/open-data/licence/readme_en/) (v2.1.1, August 2026) allows reuse including commercial use with attribution and applicable third-party conditions. Display **Data Source: Environment and Climate Change Canada**, licence and original source links. Do not imply endorsement, copy official logos or alter warning content/intent. No source icons/images/logos were fetched or admitted. [ECCC usage policy](https://eccc-msc.github.io/open-data/usage-policy/readme_en/) requires considerate, purposeful requests; no no-cache headers, bulk WMS tiles or archive polling. The [official forecast guide](https://www.canada.ca/en/environment-climate-change/services/types-weather-forecasts-use/public/guide/bulletins.html) explains regional forecasts, typical issue schedules and hourly products; it does not establish complete municipal coverage.

## Accuracy limits and next admissible work

This improves **provenance, freshness honesty and separation of forecasts from observed conditions**, not demonstrated prediction skill. No ensemble, learned correction, interpolation, probability calibration or accuracy improvement is claimed. There is no active refresh schedule, independent CAP/all-hazards feed, complete HRM boundary verification or verified nonempty-warning parser. Open-Meteo eligibility is unresolved and it is not used. No paid source, API key or permission expansion is required or added.

Before forecasting improvements: independently review source admission/rights; decide a bounded refresh and durable retained-evidence policy; archive issued forecasts with immutable issue/valid times and observations with availability times; backtest using forward-only, station-aligned holdouts against official and persistence baselines; report sample counts, lead-time/season/station errors, missingness and uncertainty. Precipitation needs actual target-period observed outcomes, not present radar scored against old forecasts. Keep all non-Halifax rows/models out. Calibration and ensembles require measured out-of-sample gains before any accuracy claim.

## Offline verification

`node scripts/test-weather.mjs` exercises fixed fixture identity, geographic rejection, partial/extra/duplicate responses, hash/units, percent/null semantics, clocks/hourly spacing, TTL boundaries, warning empty/nonempty/failure semantics, LKG retention, byte-deterministic build, disabled collector, mocked guarded request/journal/no-retry/hold behavior, and honest admin clocks. `node scripts/test-weather-ui.mjs` checks escaped text, pinned official links, no transport, DST, stale states, forecast/observation labels, menu/route state and local freshness checks. Neither performs external requests. Quality Gate runs both; no source-collection schedule is added.

`node scripts/test-weather-browser.mjs` is wired into the existing hosted Quality Gate UI job against its exact immutable release. It checks desktop/mobile widths, More navigation, Back/Forward and restaurant-state preservation, the true recorded fixture, fresh/stale/unavailable/failed/partial/nonempty warning states, expiry and DST, with all external resources blocked or served from the existing frozen local manifest. Local execution is environment-blocked (Chromium socket restriction); no local browser pass is claimed. Hosted CI is the remaining release gate.

`node scripts/test-weather-journal.mjs` fault-injects every pre-request filesystem operation, verifies the newly created/existing ancestor chain and pending-file/pathname sync order, checks unsupported directory fsync and blocked asynchronous barriers, and proves zero transport on failure. It runs offline in Quality Gate and never changes the source snapshot or enables collection.
