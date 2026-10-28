# Reviewed model-source evidence (not a Pages asset)

This directory is tracked for reproducible source/schema checks but is deliberately **not copied into the public Pages build**. The Git repository may itself be public. It contains bounded licensed weather data and factual metadata, not website JavaScript, cookies, transport headers or credentials.

`current.json` selects one immutable issuance by exact byte hash. Original provider receipt clocks, model reference times, forecast valid times and raw GRIB hashes remain unchanged. Every hosted Quality Gate replays all admitted raw GRIB fields through the hash-locked isolated ecCodes decoder before data-integrity or UI release checks can pass. The browser receives only the small whitelisted point/forecast projection in `data/weather-models.js`.

ECMWF raw fields are single bounded global0.25° temperature fields because its documented Range service has no point endpoint. They are retained solely to reproduce the three reviewed Halifax-core point projections. This is not a global weather UI, complete model archive, observation at those points or whole-municipality coverage claim.

Full ECMWF portal directory responses include unrelated inline website code. Those original bodies, hashes and acquisition journals are retained privately in the reviewed acquisition workspace, not republished here. Evidence records clearly labelled factual index-anchor extraction, the original body hash/byte count/clocks, extraction policy and a separate proof digest. Hashes do not authenticate authorship; actual acquisition and anchor extraction were reviewed against the retained originals. Licensed raw index fields and raw GRIB bytes remain directly replayable in CI.

## Sources and reuse

- NOAA/NCEP GFS: [NWS disclaimer and public-domain policy](https://www.weather.gov/disclaimer). Point extraction and equal-family aggregation were modified by HalifaxSourced; no NOAA endorsement is implied.
- This service is based on data and products of the European Centre for Medium-Range Weather Forecasts (ECMWF). ©2026 ECMWF. [Source](https://www.ecmwf.int/en/forecasts/datasets/open-data), [CC BY4.0 licence](https://creativecommons.org/licenses/by/4.0/), [terms and disclaimer](https://apps.ecmwf.int/datasets/licences/general/). HalifaxSourced modified the data through nearest-grid point extraction and equal-family aggregation. ECMWF disclaims liability for data errors, omissions, availability and resulting loss or damage; no endorsement or warranty is implied.

No improved forecast accuracy, calibrated uncertainty, operational model refresh, complete source coverage or automatic promotion is established by this evidence directory.
