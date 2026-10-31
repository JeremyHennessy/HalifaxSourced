# Halifax Sourced content coverage baseline

Generated: 2026-10-30T22:17:27.720Z

This report measures the currently committed production data layers. It is a content-completeness baseline, **not a restaurant quality or popularity rating**. Unknown data remains unknown; source leads are not converted into fabricated facts.

## Restaurant coverage

| Metric | Places | Coverage |
| --- | ---: | ---: |
| Canonical places | 656 | 100% |
| Official website | 338 | 51.5% |
| Verified/reachable official website | 181 | 27.6% |
| Public inspection match | 282 | 43% |
| Menu link | 196 | 29.9% |
| Verified menu link | 121 | 18.4% |
| Special evidence | 87 | 13.3% |
| Verified specials source | 27 | 4.1% |
| Reservation link | 57 | 8.7% |
| Online ordering link | 61 | 9.3% |
| Event evidence | 44 | 6.7% |
| Structured upcoming restaurant events | 1 | 0.2% |
| At least one social network profile | 146 | 22.3% |
| Phone | 301 | 45.9% |
| Hours | 249 | 38% |
| Coordinates | 574 | 87.5% |
| Neighbourhood | 656 | 100% |
| Cuisine classification | 624 | 95.1% |
| Accessibility information | 167 | 25.5% |
| Patio information | 72 | 11% |
| Usable rights-approved media | 10 | 1.5% |

Raw layers: 10 curated, 736 OpenStreetMap, 75 reviewed local-discovery records, 656 pre-discovery catalog records.

## Social coverage

| Platform | Places | Coverage |
| --- | ---: | ---: |
| instagram | 135 | 20.6% |
| facebook | 118 | 18% |
| tiktok | 11 | 1.7% |
| threads | 0 | 0% |
| x | 49 | 7.5% |
| youtube | 4 | 0.6% |
| linkedin | 3 | 0.5% |
| bluesky | 2 | 0.3% |
| pinterest | 1 | 0.2% |
| snapchat | 0 | 0% |
| linktree | 0 | 0% |
| beacons | 0 | 0% |
| linkinbio | 0 | 0% |
| campsite | 0 | 0% |
| bento | 0 | 0% |

- Website but no social network found: **198**
- No official website in the canonical record: **318**
- Shared-profile keys: **25**; places with shared-brand profiles only: **20**
- Candidate social associations awaiting verification: **0**
- Social source observations older than 90 days: **0**

## City events

- Current/upcoming events: **1291**
- Sources represented: **12**
- Next 7 days: **155**; next 30 days: **582**
- Ticket links: **33**; price information: **6**; explicitly free: **0**
- Coordinates: **89**
- Conservative exact venue-name → restaurant matches: **11**
- Possible duplicate current event records: **3**

### Events by municipality

- Halifax: 900
- Bedford: 82
- Dartmouth: 309

### Events by category

- Community: 752
- Arts: 569
- Music: 147
- Family: 49
- Food & Drink: 45
- Sports: 39
- Outdoor: 33
- Festivals: 14
- Comedy: 7
- Markets: 1

### Events by source

- Halifax Public Libraries: 1064
- Bedford Public Library: 82
- Symphony Nova Scotia: 31
- Scotiabank Centre: 31
- Halifax Mooseheads Home Schedule: 25
- Light House Arts Centre: 24
- Tourism Nova Scotia Events: 13
- The Carleton: 10
- Alderney Gate Public Library: 4
- Woodlawn Public Library: 3
- Neptune Theatre: 3
- Halifax International Wine Festival: 1

## Freshness

- < 7 days: 44
- 7–30 days: 95
- 30–90 days: 175
- > 90 days: 0
- Unknown: 342

## Source failures visible in the current data

- officialWebsiteChecks: 51
- firstPartyWebsiteDiscovery: 1
- verifiedSourcePages: 21
- structuredRestaurantEvents: 12
- websiteFeeds: 3
- socialApis: 3
- cityEventSources: 4
- openingWatchSources: 0
- restaurantDirectorySources: 1
- publicSpecialSources: 2
- patioDirectorySources: 0

## Known model gaps exposed by this baseline

- Reviewed discovery uses canonical IDs and reviewed aliases, never names alone; name-only merges: **0**.
- City events do not yet have canonical venue/organizer entities; the venue relationship number above is only a conservative name match.
- Accessibility and patio coverage are only counted when explicit fields/OSM tags/official-site evidence exist; absence is not treated as “no.”
- Social link hubs are measured separately from social networks.

Machine-readable details, gap queues, definitions, and failure counts are in `data/build/content-coverage-report.json`.

## Lifecycle and restaurant-event definitions

- Active canonical places: **639**; archived lifecycle records: **1**.
- Canonical restaurants with at least one upcoming structured restaurant event: **1**. This is a distinct-place count.
- Upcoming structured restaurant event records: **1** of **20** stored records. This is an event-record count and can include multiple events for one restaurant.
