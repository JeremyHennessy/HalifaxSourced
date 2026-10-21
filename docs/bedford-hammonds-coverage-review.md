# Bedford and Hammonds Plains coverage review

Reviewed 2026-10-21 against main `a42c144`. This is a targeted, evidence-backed batch, not an exhaustive restaurant census.

## Result

- 13 new restaurant locations: 10 Bedford, 2 Hammonds Plains, 1 West Bedford.
- 3 existing Peakview/Larry Uteck records moved from the misleading Armdale / Fairview discovery label to Larry Uteck / Bedford South. IDs, coordinates and history are unchanged.
- 640 canonical locations, up from 627. All 627 prior IDs remain reachable.
- Area counts after this batch: Bedford 19; West Bedford 3; Hammonds Plains 6; Larry Uteck / Bedford South 3. Area filters are exact neighborhood filters; West Bedford remains separately selectable. Text search for Bedford includes those subarea names.
- Unverified coordinates remain null. These restaurants appear in Explore and in the map result list without invented pins.
- No restaurant images, discounts, or event claims imported. National-chain exclusions are unchanged. Alexandra’s and Jessy’s are explicitly local regional franchises, not described as independent single-site businesses.

## Added locations

- [Turkuaz Restaurant](https://turkuazrestaurant.ca/) — 827 Bedford Highway, Unit 102A, Bedford, NS B4A 0J1
- [Izzy’s Bagel Co.](https://izzysbagel.com/) — 1180 Bedford Highway, Bedford, NS B4A 1C1
- [Makhani Bistro](https://www.makhanibistro.ca/) — 1595 Bedford Highway, Bedford, NS B4A 3Y4
- [Resto Urban Dining](https://www.restourbandining.com/) — 1516 Bedford Highway, Bedford, NS B4A 1E5
- [True North Diner](https://www.truenorthdiner.com/) — 1658 Bedford Highway, Bedford, NS B4A 2X9
- [Mill Cove Brew Pub](https://millcovebrewpub.com/) — 961 Bedford Highway, Bedford, NS B4A 1A9
- [Cha Baa Thai – Bedford](https://chabaathai.ca/bedford/) — 1511 Bedford Highway, Bedford, NS B4A 1E3
- [May Garden – Mill Cove](https://maygarden.ca/) — 961 Bedford Highway, Bedford, NS
- [Thai Ivory Cuisine – Bedford](https://www.thaiivorycuisine.ca/home) — 1149 Bedford Highway, Bedford, NS B4A 1B9
- [On The Wedge](https://www.onthewedgepizza.com/) — 1595 Bedford Highway, Marketside, Sunnyside Mall, Bedford, NS
- [Alexandra’s Pizza — Hammonds Plains](https://www.alexandraspizza.com/locations/hammonds-plains-tantallon) — 1679 Hammonds Plains Road, Hammonds Plains, NS
- [Jessy’s Pizza — Hammonds Plains](https://jessyspizza.ca/) — 1 Kingswood Drive, Hammonds Plains, NS
- [WoodFire Mezze](https://www.woodfiremezze.ca/) — 11 Bloom Lane, Bedford, NS

## Evidence safeguards

The regional review and enrichment ledgers retain fresh source-body hashes, exact location evidence, local-business evidence and field-by-field dispositions. Shared civic addresses do not trigger merges. May Garden and Mill Cove Brew Pub are separate tenants; mall restaurants remain distinct. No pin is borrowed from a neighboring business, map viewport, or an unresolved orphan record.

Makhani’s owner-written Sunday start says midnight, so its weekly hours remain unknown. Mill Cove publishes kitchen hours separately from bar hours; only the explicitly labeled kitchen schedule is used. True North and Resto schedules omit meridiem labels, so this review does not silently fill them in. WoodFire's explicit address and displayed hours are read from the website’s linked public application bundle; its family-origin description is not represented as a verified legal ownership registry search.

## Remaining review queue

The finite audit contains 22 held candidate observations, including the already-held Panada location. These are leads, not approved listings. The broader regional queue has 43 unique held entries after adding 21 new unresolved subjects. Specific blockers and sources are recorded in [the audit matrix](../data/bedford-hammonds-coverage-audit.json).

- Current owner source access: Peacock, Bedford Neighbourhood Pub and Martha’s Pizza.
- Local-ownership/branch evidence: Modern Orchid, Seoul, Sushi Jet Express and others.
- Identity reconciliation: Morris East’s existing addressless OSM record, and the possible Patrons/Sou’Wester successor. Do not duplicate or rename on name/proximity alone.
- Conflicting current status: Shajeela’s; a third-party closure claim is not sufficient to declare closure or reopen it.
- Exact owner branch address: Panada and Peppertoni’s, among others.
- Upper Hammonds Plains/Pockwock: no new location met the admission threshold in this review; this is not evidence that the area has no restaurants.

Sunnyside Restaurant is not revived from its stale “open” website. A court-monitor report dated August 28, 2025 records permanent closure after flooding. Edible Matters and Jam’s remain excluded under their prior closure evidence.

## Why the gap existed and next bounded work

The retained OpenStreetMap snapshot stops at latitude 44.705, south of much of Bedford and Hammonds Plains. It cannot establish full regional coverage. This batch does not re-enable blocked adapters or bypass an earlier source denial.

Next priorities are to resolve the named hold queue using current owner/landlord evidence, maintain a community-by-community source inventory, and enrich exact venue pins only when sourced. Keep coverage completeness separate from listing count and fresh content receipt separate from successful scraping status.
