# Source onboarding: disabled review backlog

`data/source-onboarding-backlog.json` is a **research backlog, not a collector registry**. The admin source catalogue exposes 13 automated-interface review candidates (8 ranked, 5 secondary) and 10 manual holds under `source-onboarding`. Every backlog row is disabled, held and review-required; this does not mean its publisher lacks a separately reviewed manual news admission. No new events, articles, notices, feeds or media are accepted by this change.

## Review order and known limits

1. Bus Stop Theatre, Sanctuary Arts Centre, Pier 21, AGNS, Bella Rose Arts Centre, Dartmouth Players: broaden performing-arts and museum coverage using source-owned factual schedules, if access and reuse review permits it.
2. Halifax Water and Halifax Harbour Bridges: evaluate operator-authored local service/closure notice metadata. Distinguish current/resolved notices from archives and third-party reposts.
3. Secondary interfaces: The Coast, The Signal, Halifax Partnership, Discovery Centre and Halifax Brewery Farmers’ Market. Discovery Centre exposed a calendar shell, not a usable live payload. Brewery Market’s previously reviewed [events page](https://www.halifaxbrewerymarket.com/events) has March/April entries without years; no current occurrence, exact entrance or current transit/parking claim is established.

The JSON preserves exact primary URLs, geographic limits, observations, priority, access/rights uncertainty and next safe actions. HTML visibility is not automated-access permission or a reuse licence. RSS, iCal, API and JSON-LD remain **unknown**, not absent. No endpoint may be inferred from a platform or URL pattern. Source-owned links to ticketing/promoter pages need their own review; no third-party traversal is implied.

ReTales is already collected through `data/opening-watch-source-registry.json` and `scripts/import-opening-watch.mjs`; it is not a new candidate. The Coast and The Signal now have separately reviewed manual news admissions: four Coast links and one Signal link in the October 27, 2026 review. Both remain collection-disabled with null feed URLs. Their backlog rows concern only potential automated interfaces, not missing publishers or missing manual admission. These counts describe that review batch, not live totals. Global Halifax remains an existing preview source with two additional reviewed links; it is not an additional backlog candidate. AGNS, Bus Stop and Sanctuary are direct-source upgrades to existing project evidence, not newly discovered organizations. Tides and Wanderers already have organizer/tourism representation. Catalogue rows, distinct URLs and normalized hosts are not publisher counts; absence from a host inventory does not prove organizational novelty.

## Manual holds and provenance

The backlog separately records Light House Arts Centre, Alderney Landing, Halifax Examiner, Discover Halifax, Halifax Seaport Farmers Market, HRM news, Halifax Port Authority, Forum Farmers Market, Tides/NSL and Yuk Yuk’s.

- Examiner’s OAI-SearchBot robots denial applies to the exact listed [homepage](https://www.halifaxexaminer.ca/), not an unknown page.
- Forum’s timeout remains an **uncertain transport outcome**, not a confirmed HTTP 400/source denial. Check the uncertain outcome before any further action.
- Yuk Yuk’s reviewed terms URL was not recovered; it has no invented clickable target.
- Do not retry a held source or route around a denial through another path, host or tool. Review materially new relevant permission/access evidence before considering a bounded retry; elapsed time is not evidence. No such retry is authorized here.

These are manual onboarding observations, not observations from the link-QA artifact. The review date is not a precise source-attempt timestamp. New rows have unknown attempt, success and content clocks, no parser, cadence or workflow dispatch link. Existing `data/source-link-access-holds.json`, `data/source-quarantine.json`, fetch policies and committed holds remain unchanged. The new manual list is not wired into fetch policy; it records the review gate for future onboarding without rewriting existing operational row state.

## Before any automated-interface onboarding

1. Review source-specific robots, terms, licence and factual-metadata permission without bypassing existing holds. Keep copied bodies, descriptions, summaries, images, logos and other publisher media out.
2. Verify a source-linked interface and actual response format. Build fixture-backed, disabled parsers only after permission is established; do not invent RSS/iCal/API endpoints.
3. Resolve Halifax/Dartmouth/Bedford item geography, identity and exact dated occurrences. Preserve cancellations, sold-out/rescheduled state and notice start/end/resolution independently of publication times. Do not expand production ranges or vague recurrences into invented showtimes.
4. Deduplicate existing tourism/organizer evidence; manually review each proposed event or news link under the existing editorial rules. News candidates do not authorize allegations, copied summaries or automatic publication.
5. Use a separately reviewed, tested operational change for any admitted source. This backlog has no activation switch: the schema rejects enabled rows, unverified feed URLs and collection clocks. Do not change schedules or accepted content as part of backlog maintenance.

## Offline maintenance

Run the existing CI entrypoint, which includes backlog schema, catalogue and UI regressions:

```sh
NODE_OPTIONS="--import=$PWD/scripts/lib/deny-source-network.mjs" node scripts/test-source-catalog.mjs
```

It rebuilds only `data/build/source-catalog.json`. Repeat builds preserve bytes and mtime when inputs are unchanged. Only new onboarding rows receive review metadata; existing row identities, clocks, state and provenance are preserved. The tests require all collector/workflow code to remain independent of this backlog. Do not run a broad snapshot refresh to update these review notes.
