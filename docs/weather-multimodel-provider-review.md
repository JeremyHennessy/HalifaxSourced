# Halifax-only multi-model source review — 2026-10-28

Historical pre-transport review. Subsequent actual captures, reviewed budget recoveries, implementation and remaining limits are recorded in [the acceptance report](weather-multimodel-acceptance-20261028.md); this review alone is not a live-source or skill claim.
**Scope:** primary documentation/terms only. No weather-data sample, API query, GRIB/index/capabilities download, source activation, subscription, credentials, source-hold change or repository edit was performed. Read the existing integration review; this is a provider-admission recommendation, not live acceptance or legal clearance. All candidate model inputs remain disabled.

## Practical conclusion

There is a credible **no-new-paid-access, multi-centre** route: direct ECCC model products, NOAA GFS/GEFS, and the ECMWF free open subset. This avoids assuming Open-Meteo service eligibility. Start with ECCC + NOAA, then ECMWF's explicitly free self-serve route after the exact access contract is reviewed. DWD remains held because its official documentation returned 403. The older app's other model labels are not thirteen separately admitted providers; its common Open-Meteo service does not confer independent access rights.

### 1. ECCC — licence eligible; operational model admission outstanding

The [ECCC end-use licence](https://eccc-msc.github.io/open-data/licence/readme_en/) permits commercial reuse with source/third-party attribution, while official alert intent must remain intact. [MSC GeoMet](https://eccc-msc.github.io/open-data/msc-geomet/readme_en/) documents anonymous, free access, raw clipping and geospatial services.

Useful products for the six reviewed Halifax points:
- [HRDPS](https://eccc-msc.github.io/open-data/msc-data/nwp_hrdps/readme_hrdps_en/): most of Canada, about 2.5 km, to 48h, up to four daily runs. Halifax point coverage still needs exact layer/response validation.
- [RDPS](https://eccc-msc.github.io/open-data/msc-data/nwp_rdps/readme_rdps_en/): Canada/US, about 10 km, to 84h, four runs daily. **The current documentation says RDPS is a component of GDPS.**
- [GDPS](https://eccc-msc.github.io/open-data/msc-data/nwp_gdps/readme_gdps_en/): global, 0.15° distributed grid, twice daily to ten days. Current documentation says large-scale temperature/wind are spectrally nudged toward GEML.
- [GEPS](https://eccc-msc.github.io/open-data/msc-data/nwp_geps/readme_geps_en/): global probabilistic forecasts, twice daily, a 0.5° distributed grid; retain member identity and actual admitted member completeness rather than counting members as independent models.

**Smallest shape:** layer-specific metadata, then bounded [WMS GetFeatureInfo](https://eccc-msc.github.io/open-data/msc-geomet/wms_en/) raw point JSON for an exact admitted layer, point, `TIME` and `DIM_REFERENCE_TIME`. Both temporal dimensions must be explicit; valid time and model-reference time differ. WMS 1.3.0 EPSG:4326 bbox axis order is latitude/longitude, and I/J select the queried pixel; test these instead of reusing ordinary lon/lat bbox ordering. No image/tile batch is needed.

The [usage policy](https://eccc-msc.github.io/open-data/usage-policy/readme_en/) requires considerate requests, meaningful User-Agent and caching-compatible headers. Bulk/batch WMS tile retrieval is prohibited. Sustained systematic Datamart collection requires AMQPS notification/retrieval rather than directory polling; archiving workflows should use Datamart, not an improvised GeoMet bulk archive. Contact is required at 86,400 requests/day, **not permission to target that volume**. For a small initial point review, propose one model/variable/valid time across only the necessary points, serial and budgeted; any archive plan needs a separate compliant mechanism.

**Family recommendation (inference):** group HRDPS/RDPS/GDPS/GEPS/GEML under an ECCC/GEM dependence centre for outer blend weight. Preserve product identities within the group; do not claim statistical independence. Regional resolution is useful but not additional independent confidence.

### 2. NOAA — licence eligible; exact GFS/GEFS transport/schema admission outstanding

[NWS data terms](https://www.weather.gov/disclaimer) allow lawful no-charge reuse of public-domain NWS information unless specifically excepted. Do not imply endorsement or present transformed output as official NWS information; third-party material has separate rights. Request only needed data on the product refresh cycle and honor restrictions.

[GFS documentation](https://www.emc.ncep.noaa.gov/emc/pages/numerical_forecast_systems/gfs.php) describes global deterministic guidance, four daily runs and hourly short-range output. [GEFS documentation](https://www.emc.ncep.noaa.gov/emc/pages/numerical_forecast_systems/gefs.php) describes global ensemble guidance and shared FV3/GFS lineage. These model overview pages contain legacy version/future-plan text, so **do not pin current operational version/member count from them**. Verify actual GRIB edition, centre, model/process version, cycle, member IDs and expected completeness during admission; no 2026 GFS/GEFS upgrade was established here.

**Smallest shape:** [NOMADS GRIB Filter](https://nomads.ncep.noaa.gov/info.php?page=gribfilter) supports a regional subset with explicit variable(s), level(s), cycle and single forecast-step file. Use a tiny Halifax-containing domain sufficient for six fixed points, never a global whole-file pull, then verify the extracted grid's footprint and interpolation. The documentation requires at least **10 seconds between loop fetches**; serial first review and explicit request/byte caps are appropriate. For parameters/levels without spatial subsetting, NOAA recommends partial HTTP transfer instead; select one reviewed path, not fallback-on-denial. The [NOMADS migration documentation](https://nomads.ncep.noaa.gov/info.php?page=opendap_grib_migration) indicates the old OpenDAP route should not be copied from legacy examples.

**Family recommendation (inference):** GFS and GEFS share a NOAA/NCEP outer weight; ensemble members inform within-family uncertainty, not dozens of centre votes. Avoid NAEFS as an additional independent vote because it combines NOAA/Canadian ensembles.

### 3. ECMWF — open commercial data eligible; exact free self-serve boundary to confirm

The [open-data product page](https://www.ecmwf.int/en/forecasts/datasets/open-data) explicitly makes an IFS/AIFS subset free with CC BY 4.0 commercial reuse. [Free-access guidance](https://confluence.ecmwf.int/spaces/DAC/pages/228871366/What+ECMWF+forecasts+can+I+access+for+free) lists the public open-data portal. This is distinct from paid delivery, archive or advanced services: [commercial-access guidance](https://confluence.ecmwf.int/spaces/DAC/pages/439585258/What+you+need+to+know+before+you+access+ECMWF+data+for+commercial+purposes) and [terms](https://apps.ecmwf.int/datasets/licences/general/) discuss service agreements and possible service charges. Do not sign one or use an account-only service under this task. Record the actual selected free route before activation.

[Current technical overview](https://confluence.ecmwf.int/spaces/DAC/pages/272310539/ECMWF+open+data+real-time+forecasts+from+IFS+and+AIFS) documents global IFS control/ensemble and AIFS Single/ENS. The October 20, 2026 change added IFS 0.1° alongside 0.25°, with the higher-resolution distribution about two hours later. These are **the same forecast resampled**, not separate models; AIFS remains 0.25°. AIFS output is six-hourly, so do not invent unlabelled hourly native predictions.

**Smallest shape:** the [single-field access guide](https://confluence.ecmwf.int/spaces/DAC/pages/738041083/ECMWF+open+data+getting+the+data) documents one matching `.index` plus an HTTP byte-range request for an exact GRIB field using its run-specific offset/length. Require exact 206/Content-Range correspondence and bounded bytes; if ranges are ignored, stop rather than downloading the full bundle. One field is still a global grid; extract only reviewed Halifax points privately, disclose coarse-grid interpolation, and confirm the field size fits the approved budget. No published geospatial subsetting service was established. Do not copy IFS URL structure for AIFS; its naming convention differs.

[Operational AIFS documentation](https://www.ecmwf.int/en/forecasts/dataset/aifs-machine-learning-data) and [ECMWF's initial-condition explanation](https://www.ecmwf.int/en/about/media-centre/news/2025/ecmwfs-ai-forecasts-become-operational) show shared ECMWF operational analyses/initial conditions. **Inference:** keep IFS/AIFS algorithms distinct internally but use a shared ECMWF outer dependence cap. This is a conservative grouping, not an estimated correlation coefficient.

The attribution contract should link the exact [terms](https://apps.ecmwf.int/datasets/licences/general/), include the required source/licence/disclaimer and mark derived modifications. Do not replace those terms with generic “weather data” credit.

### 4. DWD ICON — documentation access held; not admitted

The official documentation request to `https://www.dwd.de/EN/ourservices/opendata/opendata.html` returned **403 Forbidden** on this review. No alternate host/path or data endpoint was tried afterward. Do not present ICON as licensed/live/eligible on the strength of old app labels or remembered licensing. Keep `documentation_access_held` and `enabled=false`; a lawful pre-existing rights document or reviewed recovery is needed. This is a documentation-access observation, not a fabricated denial receipt for an unrequested ICON data endpoint.

### 5. Open-Meteo — data licence is not API service eligibility

[Current terms](https://open-meteo.com/en/terms) restrict the free API to non-commercial purposes, with specific examples including no advertising/subscriptions and excluding promotional/commercial use. Its CC BY data reuse basis does **not** establish HalifaxSourced's free-service eligibility. Commercial API plans require subscription arrangements; none is authorized here. Keep both deterministic and ensemble API service entries disabled/held pending evidence of the permitted service basis. Do not route through `hrm-weather`, change hosts or reuse another app's key to evade this boundary.

## Recommended registry fields / admission separation

Each provider/model entry should include:

`providerId`, `modelId`, `algorithmFamily`, `dependenceGroup`, `productKind`, `licenceUrl`, `usagePolicyUrl`, `termsReviewedAt`, `commercialReuseBasis`, `serviceAccessBasis`, `transportAdmissionStatus`, `enabled:false`, `accessHolds`, `allowedHosts`, `allowedPathShape`, `allowedLocationIds`, `explicitUnits`, `runIdentityFields`, `availabilityEvidence`, `expectedMemberPolicy`, `maxRequestsPerRun`, `minRequestSpacingMs`, `maxBodyBytes`, `maxRunBytes`, `timeoutMs`, `retries:0`, `redirects:false`, `fallbacks:[]`.

Licence review, transport success, freshness, geographic coverage, model availability and accuracy are separate states. Never make `termsReviewedAt` into `lastSuccessAt`, or `modelReferenceTime` into actual source availability. Retain raw headers/body hashes and exact retrieval clocks prospectively; missing genuine availability/issue metadata excludes an input from issue-time backtesting even if it can be shown with honest limitations.

## Suggested first live admission order (not executed)

1. ECCC model point value plus current official observation/alert component; same exact six-location allowlist, not municipality-wide claims. Separately review compliant archival mechanism.
2. One NOAA GFS 2m temperature regional subset for one known cycle/valid time; then GEFS only with complete expected member/interval contracts.
3. ECMWF IFS 2m temperature, one cycle/step/field via documented range; then AIFS with its explicit six-hour temporal semantics and family cap. No broad source switching.
4. Only after traceable matching cases exist, admit wind/precipitation variables. Convert Kelvin/m/s/accumulations only from declared units and matching intervals. Percent is normalized exactly once; 0.75% stays 0.75%.
5. Evaluate the fixed family-balanced challenger prospectively against each centre, official guidance and persistence on identical Halifax-only targets, with truths available before training issuance. Report missingness, uncertainty and subgroup failures. More model inputs alone do not establish improved prediction. Multiple reviewed points can map to the same coarse grid cell; preserve that fact and never treat those repeated cell values as independent neighbourhood evidence. Raw inter-model spread is descriptive disagreement, not a calibrated prediction interval.

## Versioning caution

Current ECMWF overview/product pages differ on some 06/18-cycle horizon details; initial 24-hour acceptance avoids that boundary, and the exact advertised target set must still be checked. Never infer a model issue/availability clock from a nominal cycle schedule, especially after dissemination changes. GFS/GEFS overview pages also contain legacy version text; actual model metadata remains an admission requirement.

## Observed documentation failures

- DWD official open-data page: HTTP 403; held, no workaround attempted.
- A guessed ECCC `msc-geomet/web-services_en/` documentation path: HTTP 404; not a weather-source response. Correct official WMS documentation was subsequently discovered through the documentation search result, not an access-denial bypass.
- NOMADS `info.php?page=fastdownload` documentation path: tool timeout/400; no retry or alternate retrieval was attempted. GRIB Filter's already successful documentation is the only transport-shape evidence used for NOAA here.


## Later bounded GeoMet admission evidence — 2026-10-28 04:06 UTC

A separately authorized guarded review made exactly one live source operation, GeoMet robots.txt (200, 217 bytes, original SHA-256 `4a90453a94abab235a1ee43eccc9213d8817bef0bb81478ebe11b68a66617865`). It returned wildcard Disallow patterns for GetMap, GetCoverage and GetFeature. The existing parser treats the non-slash-leading patterns as unavailable; the intended GetFeatureInfo point route is now held, not admitted. No capabilities or model point was requested, and no alternate ECCC route was attempted. Durable full evidence and outcome: `/workspace/scratch/a88befccac87/halifax-weather-model-admission-20261028/RESULT.md`. This supersedes any inference that the documented GeoMet point method is operationally admitted.
