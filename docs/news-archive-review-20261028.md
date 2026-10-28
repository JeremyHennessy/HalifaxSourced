# Reviewed news archive expansion — 2026-10-28

## Selection and boundaries

This manual, metadata-only review adds **36 original-title source links**, increasing the reviewed selection from **11 to 47 items across 8 represented sources**. It is not a full archive crawl or a live news service. Original publication dates range from **March 24 through October 27, 2026**; the new additions range from March 24 through October 26. All 36 new summaries are null. Publication and review dates remain separate.

The Dalhousie Gazette and The Laker News are two new publishers in this selection. Halifax ReTales is an **existing organization/opening-watch source newly represented in News**, explicitly labelled **Local business publication**, not an independent newsroom or a newly discovered publisher. The three News admissions have `enabled: false` and `feedUrl: null`. No collector, schedule or opening-watch behavior changes.

| Source | Added | Total | Added original publication dates |
| --- | ---: | ---: | --- |
| CityNews Halifax | 7 | 8 | 2026-08-03–2026-10-26 |
| The Dalhousie Gazette | 3 | 3 | 2026-10-22–2026-10-22 |
| Global News Halifax | 8 | 10 | 2026-08-21–2026-10-21 |
| Halifax ReTales | 3 | 3 | 2026-08-22–2026-10-03 |
| Nova Scotia Newsroom | 0 | 3 | No new items |
| The Coast | 7 | 11 | 2026-08-11–2026-10-01 |
| The Laker News | 3 | 3 | 2026-10-18–2026-10-25 |
| The Signal | 5 | 6 | 2026-03-24–2026-04-03 |

The complete selection contains 28 October, 9 September, 5 August, 3 April and 2 March publications. The Signal's smaller March/April sample deliberately fills a seasonal archive gap; it does not suggest continuous publication or complete coverage for missing months. Five archived Signal items cover local sports, music, community fundraising and the provincial kelp industry.

## Evidence, dates and rights

Every new accepted row identifies its canonical publisher URL, geographic support, source/type, original publication day, bounded observation time and review time. Rights annotations retain the observed cache label and observation window. The reviewed representations were cached primary-publisher text views: **exact cache freshness, current origin status and origin retrieval time are unknown**. Observation-window upper bounds are not exact origin-fetch timestamps. No source was re-fetched during integration.

The Coast's Nova Scotia Music Week story uses its explicit original **August 11** publication date, not the later October header date. Gazette masthead dates were not substituted for article byline dates. Historical competition, announcement and performance dates were not substituted for publication dates. Unqualified local update clocks remain null rather than being invented as UTC timestamps.

The two Global News video-report pages are outbound links only, not embedded/downloaded video. No article bodies, quotations, excerpts, feed descriptions, publisher photos, logos or media were reproduced. Public accessibility is not a republication licence or blanket collection permission. Titles are short factual editorial annotations, not copied headlines or endorsements. Laker team-result reports are attributed to that publisher; its disclosed submitted results are not independently verified here. No minors' personal names appear in the annotations; canonical publisher URLs remain unaltered.

Historical titles and the publication-month filter do not turn old reports into active alerts, current policy advice, upcoming events or owner-confirmed business lifecycle changes. ReTales links do not change restaurant records. All original 11 decisions and all 8 pre-existing registry objects remain unchanged, including prior access evidence and collector settings. Existing access-hold, quarantine, onboarding and opening-watch inputs remain unchanged.

## Deduplication and exclusions

The 36 candidates have **zero accepted URL duplicates or identified duplicate story topics** against each other or the original 11. Original publisher reports were favored over wire syndication. Research excluded duplicate coverage of the grain-terminal fire and boatbuilding announcement, a syndicated youth-safety funding report already covered by the chosen Global story, and three Canadian Press reports. Four current Coast links and the existing Signal Nocturne link were not imported again. This excludes eight known repeat links/topics across those five links and the fire, boatbuilding and youth-safety stories, in addition to the three wire-report exclusions. Similar beats are not duplicate events: for example, the Gazette university rugby qualification and the Signal March hockey final are distinct stories.

The Nova Scotia Newsroom supplied **no new items**: its earlier direct-metadata HTTP 403 has unresolved target scope. Search-only leads were not promoted or re-opened. Original three approved official notices remain intact. Haligonia supplied no items or registry admission; its aggregator identity was not relabelled as a newsroom. The Laker's explicitly sponsored haunted-house video was excluded. Ambiguous Coast publication dates, unsupported health claims, allegations/private-victim material and subjective restaurant-review pricing were excluded rather than embellished or copied.

## Exact research targets not retried

These failures are retained as **manual no-retry research records**, not fabricated HTTP/robots denials. They cannot truthfully be inserted into the confirmed 401/403/429 link-access registry, whose provenance contract is different. None was accepted as a new story. No alternate tool, mirror, path or hostname was used to retrieve a failed document. Leave them untouched pending materially new relevant reviewed evidence.

| Exact target | Observed outcome | UTC observation window |
| --- | --- | --- |
| https://dalgazette.com/sports/dalhousie-baseball-falls-short-of-playoffs-after-a-strong-regular-season/ | Reader cache miss; no confirmed HTTP/robots denial | 2026-10-28T00:34:45.388Z–2026-10-28T00:34:46.678Z |
| https://dalgazette.com/arts-culture/loud-women-fest-returns-to-halifax-for-its-second-year/ | Reader cache miss; no confirmed HTTP/robots denial | 2026-10-28T00:34:56.834Z–2026-10-28T00:34:58.421Z |
| https://dalgazette.com/news/nova-scotians-weigh-in-on-provincial-budget-at-government-consultations/ | Reader cache miss; no confirmed HTTP/robots denial | 2026-10-28T00:34:56.834Z–2026-10-28T00:34:58.421Z |
| https://dalgazette.com/news/only-three-candidates-running-across-nine-empty-positions-in-dsu-by-election/ | Reader cache miss; no confirmed HTTP/robots denial | 2026-10-28T00:34:56.834Z–2026-10-28T00:34:58.421Z |
| https://haligonia.ca/red-sky-cider-harvest-dinner-nscc-akerley-323668/ | Reader cache miss; no confirmed HTTP/robots denial | 2026-10-28T00:35:11.198Z–2026-10-28T00:35:12.478Z |
| https://haligonia.ca/mill-cove-draft-vision-feedback-open-house-323468/ | Uncertain transport timeout; no confirmed publisher HTTP 400 | 2026-10-28T00:35:11.198Z–2026-10-28T00:35:12.478Z |
| https://www.thecoast.ca/arts-music/ | Reader cache miss; no confirmed HTTP/robots denial | 2026-10-28T00:33:52.092Z–2026-10-28T00:33:54.005Z |

The previously accepted CityNews grain-terminal report was not re-read; its original registry entry still records the later inaccessible attempt. Other pre-existing held targets and the NS Newsroom pause were preserved.

## UI and verification

News gains a URL-backed **Publication month** selector derived from original publication dates. Day-only dates keep their calendar month; qualified timestamps use the same Halifax timezone as their displayed date. Search, geography, topic, source type and month combine; Apply resets pagination; pagination retains filters; restoring a URL restores the selected month/page. Valid empty-month bookmarks remain visible rather than silently switching to another month. Cards explicitly label publication dates and the selection warns that historical coverage is not active alerts or upcoming events. The homepage still selects only the newest three approved records.

The news JSON/browser pair and source catalogue were rebuilt offline. The catalogue adds only three disabled/manual News rows; it does not infer collection success clocks or change prior source rows. Changed JS/CSS assets are cache-busted. Regression checks freeze all original decisions/source objects, enforce date and rights metadata, exercise manual collectors with zero requests, preserve held-host/backoff behavior, test the business-publication type and reject copied/unreviewed fields.

The browser runner was prepared for read-only localhost QA, but Chromium could not launch in the command sandbox (`socket() Operation not permitted`), and the escalated execution wrapper failed before running it. Offline VM/contract tests passed; actual rendered viewport screenshots and browser Back/Forward remain a separate verification limitation until an available browser can run them.

Hosted browser assertions are extended in the existing news/source suite: source-type labels, original dates, combined month/type filters, pagination, Back/Forward, repeated Apply, empty bookmarks and control bounds at 320/390/901/1024/1440px. The suite writes archive screenshots at each width. These hosted assertions are added but not reported as locally executed.
