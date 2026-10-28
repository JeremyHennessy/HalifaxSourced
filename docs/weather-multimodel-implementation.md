# Halifax multi-model implementation and acceptance boundary

This component prepares a real GFS + ECMWF IFS captured forecast and public view; see [actual acceptance evidence](weather-multimodel-acceptance-20261028.md). It is **not a claim that the deployed site has been verified, that every weather source is aggregated, or that prediction is better**. It replaces the old app's unsafe arithmetic and retrospective evaluation ideas with executable, tested review-only components. The ECCC official forecast/observation/warning foundation remains separate and unchanged. All model source/model switches and automatic calibration promotion remain disabled.

## Implemented, not simulated as live weather

- `data/weather-locations.json`: the other app's exact six Halifax-area points; the headline is the equal mean of all three core points (Halifax Peninsula, Bedford, Dartmouth), not an area/population estimate or the whole municipality.
- `data/weather-model-registry.json`: 17 named planned products, fixed provider/dependency identities, held/unreviewed source states, licence/usage references. Open-Meteo free-service commercial eligibility is not assumed. ECCC GeoMet's actual robots hold and DWD's documentation403 are preserved. A browsing-tool documentation timeout is distinguished from a source HTTP denial.
- `scripts/lib/weather-aggregation.mjs`: declared probability scales (`0.75%` is `0.0075`), exact point/variable/window/event matching, true run/availability/receipt/issuance clocks, newest-cycle selection before completeness checks, canonical instant identities, fixed family caps, and missing coverage. Complete ensemble member identities are required; actual member counts have not been invented from the old app. Unknown issue/late receipt/stale inputs cannot enter an earlier issued forecast.
- `scripts/lib/weather-model-archive.mjs`: an explicit newest known outcome for **every admitted model × requested target**, including held/failed/missing outcomes. It cannot drop a partial new cycle and silently substitute retained old forecasts. Each issued candidate freezes the entire input/coverage manifest, policy, registry, locations, threshold, selected baseline and uncertainty description. Hashes bind content; they are not source authentication or independent discovery of omitted cycles.
- `scripts/lib/weather-evaluation.mjs`: exact, quality-accepted, instrument/point-matched truth; immutable issue-time candidates/gates; true receipt/availability barriers; no current-radar/historic-target or airport/city-point substitution; physical bounds and finite losses. Version/point/event/lead-scoped shadow bias learns only from pre-issue truth and stays non-promoting. Paired MAE/RMSE/bias/Brier uses identical cases/truth revisions, explicit coverage, calendar-day blocks, and honest insufficient-evidence states. Unverified model versions cannot train calibration.
- `scripts/aggregate-weather-models.mjs`: executable offline review CLI; writes a new file outside the repository, never public data, never overwrites an issuance, never fetches, and requires raw GRIB replay through the explicit isolated interpreter for nonempty captures. The source collector/admission reviewer still owns latest-cycle completeness and trustworthy transport receipts. No archive can authorize publication.
- `scripts/weather/decode-gfs-temperature.py`: offline bounded NOAA/GFS or ECMWF/IFS single-field decoder using ecCodes. It validates centre, GRIB2, 2m temperature, units, future forecast step/reference/validity, missing/physical bounds and grid size; outputs only selected Halifax point projections and grid distance. Model issue time comes from GRIB, never retrieval. Native grid distance is disclosed; these are not co-located observations.

The baseline weights members within products, products within conservative dependency groups, then present groups equally. GEM products share a cap; IFS/AIFS/ENS share a cap; GFS/GEFS share a cap. This does not measure independence. Raw weighted p10/median/p90 describe model disagreement, **not calibrated intervals or weather confidence**. At least two admitted groups are required. A three-point headline requires all three points and comparable family coverage.

## Local review usage

```
node scripts/test-weather-aggregation.mjs
node scripts/test-weather-model-adversarial.mjs
node scripts/test-weather-model-archive.mjs
# Existing Quality Gate runs all three alongside every existing gate.

# Explicit reviewed input; output parent directory must already exist outside repo.
WEATHER_GRIB_PYTHON=/absolute/path/to/reviewed-venv/bin/python \
  node scripts/aggregate-weather-models.mjs /private/archive.json /private/new-review.json
```

The archive schema is enforced in `aggregateIssuedArchive`. Production registry switches remain false, so an empty reviewed archive yields unavailable targets rather than fabricated forecasts. Synthetic tests temporarily admit small in-memory fixture registries; no fixture or historic other-city training data is published.

### Optional local decoder installation

The isolated Python3.12 Linux environment used for local tests installed official PyPI `eccodes==2.50.0`, with the complete eight-wheel hash lock in `scripts/weather/requirements-eccodes-reviewed.txt`. The lock is platform-specific, not permission to substitute another wheel/dependency silently. Approximately63MB of no-cost packages were installed into a workspace virtualenv, with no system change, account or credentials. [Official package documentation](https://pypi.org/project/eccodes/) identifies the ECMWF project and bundled library.

```
python3 -m venv /private/weather-grib-venv
/private/weather-grib-venv/bin/python -m pip --isolated install \
  --require-hashes --no-deps --only-binary=:all: --retries 0 --timeout 20 \
  --index-url https://pypi.org/simple -r scripts/weather/requirements-eccodes-reviewed.txt
/private/weather-grib-venv/bin/python -m eccodes selfcheck
/private/weather-grib-venv/bin/python scripts/weather/test-gfs-decoder.py
/private/weather-grib-venv/bin/python scripts/weather/test-ecmwf-decoder.py
```

These decoder tests generate local synthetic GRIB fields; their success is not a source admission or accuracy result. Hosted Quality Gate now has a mandatory isolated, hash-locked decoder job that replays every actual accepted raw field and synthetic decoder edges. Data-integrity depends on it; no weather source request or collector activation occurs in release tests.

## First real acceptance and remaining operational work

1. Review source-specific terms/service eligibility and actual robots policy. Preserve pending-before-transport journal, exact receipts, byte/time budgets and no redirects/retries/fallbacks. A transport denial/unknown remains held until an explicit evidence-bound recovery; a known metadata-shape mismatch requires reviewed continuation, never guessed cycles.
2. Discover **actual listed** cycle/file/index. NOAA: one region/variable/level; ECMWF: one exact indexed field, ≤4MiB, exact206 range, never the whole bundle or a mirror. No user location or browser-to-provider request. Record original body, hash, request clock, response clock, true GRIB cycle/validity and unknown first-publication clock separately.
3. Review decoded metadata and replay raw bytes. Capture original actual member coverage/version evidence, licence/attribution and declared omission outcomes. Source switches remain disabled until this review; one successful body is not a scheduled feed.
4. Require at least two genuinely admitted groups on identical future target windows before calling any output a multi-model aggregate. For the fixed core headline acquire all three core points; a Peninsula-only test is not full Halifax coverage.
5. Preserve the immutable issuance before its target, then acquire independently admitted exact-support truth afterward. Airport observations do not verify the six UI points; station-side model targets need a separately reviewed geography/support contract. No suitable live prospective truth series is admitted by this component.
6. Only after prospective paired baseline/model/persistence/climatology evaluation, predeclared holdout/sample/season/weather-event review and independent review may any improvement be claimed. Current synthetic tests establish software behavior, not forecast skill.
7. A model refresh producer needs its own reviewed cycle cadence, exact-run/cache/final receipt continuity and durable hold recovery. No model cron/workflow or activation is added here. The existing ECCC weather-only promotion whitelist intentionally **does not** accept this model archive. A future model UI/artifact extension must retain full source/schema/privacy/browser/release gates and explicitly reviewed publication schema; no write token or repo security expansion is authorized or needed for this local component.

The three source review concepts remain separate: lawful reuse, actual operational source access, and demonstrated predictive skill. None substitutes for the next.
