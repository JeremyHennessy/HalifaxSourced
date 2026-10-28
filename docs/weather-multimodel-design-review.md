# Halifax multi-model aggregation: independent design audit

Historical pre-transport review. Subsequent actual captures, reviewed budget recoveries, implementation and remaining limits are recorded in [the acceptance report](weather-multimodel-acceptance-20261028.md); this review alone is not a live-source or skill claim.
Read-only review of `hrm-weather` main `868762f2e6ff48ac57da7e8269a6a36f6029b7aa` and its local evaluation audit. No source/weather requests, repository edits, claims of live model availability or accuracy validation.

## Recommended smallest honest engine

1. **Strict normalizer:** a canonical provider/model registry fixes model identity, operational eligibility, product kind, family/dependence group, declared units and six exact Halifax point IDs/coordinates. Caller-supplied family labels cannot override the registry. Unknown/non-Halifax rows reject before aggregation. API aggregator (e.g. Open-Meteo) is an access provider, not an independent model family.
2. **As-of forecast selection:** retain provider run time separately from first source availability/receipt and the issued aggregation time. Only records known available before the aggregation issuance may enter that issuance. Unknown provider run time stays unknown; do not substitute collection time. Same model/target revisions need deterministic as-of selection with originals retained. Do not silently mix incompatible valid windows, points or accumulation semantics.
3. **Family-balanced baseline:** normalize members within ensemble product, products within family, then equal weights across present families. This is a transparent baseline, not an accuracy-optimal weighting. Family count is descriptive, not measured effective independent N. Distinct origins may still share analysis, physics, training or boundary conditions.
4. **Small projection:** each Halifax point/target/variable has value, actual available family/model counts and identities, exact support/window, source ages, omitted/held reasons and raw cross-model spread. The fixed three-point core headline requires all three reviewed points on the same window and comparable family set; missing point coverage cannot silently redefine the headline. Keep official ECCC warnings and named observations separate. City-page official forecast should be a comparator, not an extra independent GEM vote.
5. **Immutable issued candidates:** hash canonical payload containing issuedAt, target/support, algorithm version, provider/model registry version, input receipt hashes, actual weights, candidate values, training cutoff/data IDs and the chosen issue-time gate. Append-only ledger rejects an existing ID with changed bytes. A future gate or new observation cannot rewrite the issued candidate.
6. **Target-matched prospective scorer:** observations require exact support/point-or-reviewed-station mapping, variable/unit, valid instant or interval, quality and receipt/revision identity. Airport observations are not automatically truth for Halifax Peninsula grid-point forecasts. Missing/incompatible truth stays unscored with a reason. Current radar cannot score historical targets; radar observation and extrapolation are distinct kinds; six-hour analysis only scores exactly matching six-hour accumulations.
7. **Training versus scoring time:** training truth and revisions must have been available strictly before that forecast's aggregation issuedAt. Scoring truth normally arrives after the forecast target and is valid for later scoring. Do not conflate these two barriers. Earlier target alone is insufficient training eligibility; backfilled truth received later is excluded from the historical issuance replay.
8. **Evaluation remains non-promoting:** compare the frozen challenger, family-balanced baseline, individual models, point/station-compatible persistence and train-only climatology on identical cases. Report coverage, failures, point/lead/season strata, paired error differences, wet-event counts and weather-event/day blocks. No n=0 calibration, automatic champion switching, superiority label or generic weather-confidence percentage. Prospective evidence should accumulate first.

## Probability and uncertainty math

- Normalize exactly once from declared units. `0.75 percent = 0.0075 fraction`; `0.75 fraction = 75 percent`. Missing/unknown unit rejects. Do not infer units from values <=1 and do not clamp invalid probabilities into range.
- The Brier score consumes a fraction and a defined event: `(p - y)^2`. A 0.75% dry case yields 0.00005625; 75% yields 0.5625.
- Blend probabilities only for identical point support, event threshold, occurrence definition and valid window. A one-hour >0.1mm event is not a six-hour >1mm event. Deterministic amount/rain code is not a probability.
- Member counts are not family votes. For a family/product mixture, product member weights sum to one product weight; products sum to one family weight; families sum to one. Duplicate aliases/members must not change an output.
- Raw model range, standard deviation or mixture quantiles are **spread/disagreement**, not a calibrated prediction interval or confidence that weather is correct. Do not divide spread by sqrt(model count), call family count independent N, or claim ensemble coverage before verification.
- If a mixture variance is exposed, it uses `sum(w * (variance_within + mean^2)) - mean_mixture^2`, not square of averaged standard deviations. Only use compatible distributions. A temperature Gaussian shortcut is not justified for skewed zero-inflated rain.
- Do not average categorical weather codes or wind degrees numerically. 359° and1° should point north, not180°. Wind vector components have a separate operation; unsupported variables should remain unavailable rather than fall through a generic numeric mean.
- Temperature shrinkage correction (if implemented later): mean signed error `prediction - observed`, then subtract shrunk bias `n/(n+k) * mean_error`. Group exactly by compatible point/model/variable/lead/version. Only pre-issuance truth enters; retain baseline when learning unavailable. Threshold/k are preregistered policy, not chosen after looking at the holdout.

## Minimum adversarial tests

1. Percent boundary values0,0.5,0.75,1,2,50,100 and explicit fractions; reject negative,>range,NaN,Infinity,string,null-as-zero and unknown units.
2. Canada temperatures[0,0,0] plus ECMWF[10] gives family mean5, not2.5. Alias/member duplicates reject or deduplicate by proven canonical identity; arbitrary caller family names cannot create votes.
3. 51 ECMWF ensemble members cannot outweigh21 Canadian members merely due counts. Deterministic IFS and IFS ensemble share their family cap.
4. Mixed point ID/coordinates, non-Halifax history, forged model family and unreviewed source model reject before computation.
5. Missing one of three core points prevents a complete fixed headline; partial families are named, not hidden as full coverage.
6. Same numerical forecast with one-hour versus six-hour interval, preceding-hour total versus instantaneous rate, or different rain threshold cannot blend or score.
7. Truth earlier than target but later than held-out issue is excluded from training. Same target across different leads cannot contaminate held-out folds. Observation correction received later cannot retroactively enter the earlier training cut.
8. A provider run timestamp earlier than issue but first retrieval later than issue is not eligible for that historical issuance. Current collector time is never provider run time.
9. Old target plus current radar remains unscored. Same exact target archived radar can score only under an explicit same-support occurrence rule; radar rate never becomes gauge accumulation.
10. Airport/station mismatch, ±2.5-hour truth, ±3-hour nearest-model valid time, quality flag failure and missing precipitation remain unscored—not zero or nearest-match success.
11. Adding future outcomes/new gates leaves all previous candidate IDs/values unchanged. Tampered input/weight/value/gate invalidates the candidate hash. Same truth revision cannot be counted twice.
12. Candidate and baseline use identical case IDs and truth receipts; adding unmatched easy cases cannot improve a paired comparison. Distinct row count and distinct weather-event block count are reported separately.
13. Zero samples, single event block or zero wet events cannot produce calibrated probability or significant-improvement status. Any eligible diagnostic remains explicitly non-promoting initially.
14. Failure and held-source handling preserve old receipt clocks and source outcomes; model count cannot make an expired target current. Unknown warning coverage remains unavailable.

## Old implementation details not to transplant

- `accuracy_engine_v2.py:203`: nearest valid time admits +/-3h; inappropriate for exact hourly target claims.
- `accuracy_engine_v2.py:746`: useful family cap but `effective_independent_sources=len(families)` overstates independence.
- `accuracy_engine_v2.py:799`: ensemble spread combines averaged within-family SDs, not a fully specified equal-family distribution.
- `precipitation_walkforward.py:22`: <=1 unit inference; earlier-target-only training leaks availability time.
- `accuracy_engine_v3_verify.py:64`: +/-2.5h temperature truth; global confidence bins are not Halifax-only.
- `precip_nowcast_verifier.py`: current radar for historical truth; recalculating gate at scoring; unmatched RDPA accumulation.
- `engine32_family_benchmark.py`: “earlier targets only” is not an issue-time-correct replay; tiny historical winner differences must not select live superiority claims.
- Existing13 deterministic products are mostly accessed via one Open-Meteo service; adding product names alone does not establish lawful API eligibility, actual availability, independence or better accuracy.

## First implementation audit (04:00–04:03 UTC; fixes requested)

Confirmed by read-only synthetic execution against the first draft:

- Known newest GEPS cycle containing only null members disappeared before run selection; the older06Z cycle silently contributed, yielding5 with a GFS10 input. Deterministic newest-null had the same issue. Select newest eligible-as-of cycle before value/completeness checks; no fallback from known-missing newest source.
- Same model/run with v1=0 andv2=20 returned5 versus15 when input order reversed with ECMWF10. Reject same-cycle revision ambiguity or impose an audited explicit revision selection policy.
- Three-point PoP headline mixed0.1mm and1mm event thresholds while reporting0.5. Match event definition/unit/window across all three target objects; reject duplicate/ambiguous targets.
- Probability null values bypassed declared-unit validation. Targets lacked duplicate and interval-schema rejection. Canonical family pins and same-cycle version rejection were being added during audit.
- Training score eligibility needs policy/registry/location-version scope and duplicate score/candidate/case rejection; point/variable/lead alone mixes model epochs and can count a repeated forecast or truth revision more than once.
- Paired reports need one variable/unit/event cohort. Otherwise pooled metrics mix°C,mm and probabilities. Probability uncertainty intervals need paired Brier differences, not absolute probability error. Observed-day gaps must not be silently treated as consecutive calendar-day bootstrap blocks.

Reusable pure reviewer tests (outside repository): `weather-aggregation-independent-tests-20261028.mjs`. Synthetic fixtures only; no requests. Awaiting fixes/retest before independent acceptance.
