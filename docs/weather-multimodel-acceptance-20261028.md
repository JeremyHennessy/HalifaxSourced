# Reviewed multi-model capture acceptance — 2026-10-28

## Actual evidence and prepared public view

Two genuinely acquired model families now support the same five future temperature instants: **06/09/12/15/18 UTC**, at the three fixed Halifax Peninsula, Bedford and Dartmouth points. These are nearest-grid model projections, not observations at those places. GFS reference: **2026-10-28 00:00 UTC**. ECMWF IFS reference: **2026-10-27 18:00 UTC**. The earlier IFS cycle is the actual listed available cycle, not renamed to October28. Actual publication/first-availability clocks remain unknown; retrieval is separately recorded.

The immutable aggregate was issued at **2026-10-28T04:45:02.765Z** after all contributing receipts. Current source-evidence byte hash: `95c1ef4d0e8bc76530944256f341981144dc8be4b8f4fe1ae4693e55fbf35fb0`; semantic archive hash: `58b3e20281038bd7b9ddfa8603ef8299aecc1b73f090f69a9c3e711001e9ff40`. Original06UTC receipts were preserved when later horizon captures were added. The raw fields were replayed independently through the reviewed ecCodes decoder before acceptance.

The prepared UI shows the transparent equal-family blend, each contributing GFS/IFS value, uncalibrated raw model range, model reference/retrieval/valid clocks, grid distance, original field hashes, limited coverage, unavailable sources and visible attribution. It does not label the range a probability/confidence interval, claim improved prediction, or imply a realtime model feed. Critical warning uncertainty remains above the models; official ECCC forecasts/observations/warnings remain a separate authority and dataset. Context points outside the reviewed GFS subset are not extrapolated.

| Model | Valid UTC | Bytes | First received UTC | Raw field SHA-256 |
|---|---|---:|---|---|
| ECMWF IFS | 2026-10-28T06:00:00Z | 315359 | 2026-10-28T04:37:51.996Z | `b3062c7185595f4a6d41d2378f040c2c9ffa8eed8e0a0751568af905dd018bfb` |
| ECMWF IFS | 2026-10-28T09:00:00Z | 316826 | 2026-10-28T04:41:52.627Z | `d4d947fffad3e135700505004da932ce2bba2311b55d1fe77c1192704818a484` |
| ECMWF IFS | 2026-10-28T12:00:00Z | 317975 | 2026-10-28T04:42:18.004Z | `8f06b22edafd5aca1801beb6310ac836e129824700847dda3c73a0647e110bea` |
| ECMWF IFS | 2026-10-28T15:00:00Z | 317957 | 2026-10-28T04:42:45.324Z | `a60a1801400bfdb3dee2ea9710f6273a0bfac77c8922fc84bee1bd99586fe21b` |
| ECMWF IFS | 2026-10-28T18:00:00Z | 320199 | 2026-10-28T04:43:11.647Z | `931e18ffa2fe854ec184b0ce1d5d3b51dd5faab8ceade4ddf39e1e30689b47a4` |
| GFS | 2026-10-28T06:00:00Z | 183 | 2026-10-28T04:24:41.137Z | `1c1a8bfa8ce5796e2ef33ac503c62adc24991673599cf616fd7a6d92647f0453` |
| GFS | 2026-10-28T09:00:00Z | 184 | 2026-10-28T04:41:41.775Z | `04a424c6867047c5a86806f0e8f7c4fbd1478062412fbf275342eb0ae8d00f3c` |
| GFS | 2026-10-28T12:00:00Z | 182 | 2026-10-28T04:41:56.515Z | `bc082362dd3cc54a176b9fe5172fbf52b1a61d1829a1767803cba818faeda597` |
| GFS | 2026-10-28T15:00:00Z | 181 | 2026-10-28T04:42:09.951Z | `93a68c19252e6487ece7d2b05970ccb608e464dd6e3161df53f0d6c5312a12e5` |
| GFS | 2026-10-28T18:00:00Z | 181 | 2026-10-28T04:42:23.439Z | `dc921ce359c496e9f6fb7638fd99282eb71f19f4bda446c1a8503ed29b87336c` |

## Guarded acquisition outcomes

- NOAA: robots404 was treated as absent by the existing unchanged policy. The initial filter page exposed date links rather than the complete advertised form; a reviewed hash-bound continuation followed actual date/cycle/atmos links. Nested form tags were handled offline against retained bytes. One06UTC field plus four new horizon fields were requested. All four-node subsets stayed inside the exact reviewed bounding box; no source URL was repeated as a retry.
- ECMWF: original root and later date-page attempts each exceeded the deliberately small metadata budget and stopped. Those original incomplete receipts remain retained. Explicit reviewed recoveries used observed evidence that each portal page includes roughly395KiB of inline JavaScript boilerplate: each subsequent immediately listed metadata page was bounded at1MiB, the traversal at6MiB, each index at256KiB and each exact Range field at4MiB. Scripts were never executed. Actual index offsets and lengths matched every HTTP206 Content-Range. No full forecast bundle, mirror, guessed cycle, redirect, denial bypass or credentials were used.
- Horizon spacing was at least10seconds after each prior body on each host; all source decisions drained and both final receipts completed without pending holds. No retry or fallback loop was enabled.
- ECCC numerical-model GeoMet remains held after its robots policy; its separately admitted city-page source is unaffected. Canadian GEM/GDPS/HRDPS ingestion is not implemented, not a universally inaccessible publisher: the separate official Datamart service needs a compliant AMQPS consumer for systematic updates, not HTTP directory polling. No such consumer or workaround is added here. Open-Meteo free-service eligibility remains unestablished for commercial use; DWD's documentation403 remains held. Other model sources remain unreviewed. These are not presented as active inputs.

Full original acquisition journals and portal bodies remain in the reviewed workspace. The repository retains licensed raw GRIB/index data and explicitly labelled factual anchor extraction with original page hashes/clocks, not copied website code, cookies or raw transport headers. The non-Page evidence directory is excluded from the Pages copy.

## Tests and deployment boundary

- Existing source, weather, journal, exact-run lineage, promotion, release-isolation, privacy and news gates remain intact. All47 approved news items remain unchanged in this component.
- Every actual packaged raw GRIB is now replayed in a mandatory hash-locked Python3.12/ecCodes hosted job. Data-integrity depends on that job; UI verification still depends on data-integrity. Dependency installation is isolated and hash-pinned, with no account, new permissions or system mutation. No weather source requests run in that job.
- Mathematical/temporal, archive/CLI, range/admission, UI stale/failed/history/XSS and actual-current-snapshot tests remain separate from synthetic regression fixtures. Future accepted snapshots are semantically checked rather than pinned to this issuance time.
- This local component does not itself push, deploy or activate a model collector. The live-site release still requires parent's full hosted CI/visual/source gates and deployment verification. The existing weather-only ECCC promoter does not silently accept this different model artifact.

## Remaining operational boundary — not completed by a saved capture

Automatic model refresh is **not active**. Model switches and liveCollectionEnabled remain false; the browser clearly labels saved captures. The accepted-registry projection permits only the two reviewed sources' captured contributions, not network collection. Receipt age is bounded at12hours, GFS reference age at18hours and IFS reference age at24hours; expired targets become historical, and held/failed/unknown latest attempts cannot be presented as current.

A durable model producer still needs the same exact-run/cache/final-receipt continuity as the ECCC operational lane, explicit first manual bootstrap, per-provider conditional metadata caching and finite cycle/horizon budgets, provenance-bound recovery, immutable archive retention and a reviewed weather-only publication contract. No new token, paid service, access setting or generic-gate shortcut is required or authorized. Continuous updates remain an open task, not satisfied by this initial forecast.

Prospective exact-support observations and frozen paired comparator forecasts must accumulate before any improvement claim. Current model software versions and city-point observational truth remain unverified; no calibration auto-promotion is allowed.
