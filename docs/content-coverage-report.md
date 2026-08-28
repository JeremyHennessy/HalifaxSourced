# Halifax Sourced content coverage baseline

Generated: 2026-08-28T21:37:40.761Z

This report measures the currently committed production data layers. It is a content-completeness baseline, **not a restaurant quality or popularity rating**. Unknown data remains unknown; source leads are not converted into fabricated facts.

## Restaurant coverage

| Metric | Places | Coverage |
| --- | ---: | ---: |
| Canonical places | 743 | 100% |
| Official website | 284 | 38.2% |
| Verified/reachable official website | 236 | 31.8% |
| Public inspection match | 496 | 66.8% |
| Menu link | 152 | 20.5% |
| Verified menu link | 86 | 11.6% |
| Special evidence | 53 | 7.1% |
| Verified specials source | 25 | 3.4% |
| Reservation link | 60 | 8.1% |
| Online ordering link | 79 | 10.6% |
| Event evidence | 47 | 6.3% |
| Structured upcoming restaurant events | 2 | 0.3% |
| At least one social network profile | 137 | 18.4% |
| Phone | 245 | 33% |
| Hours | 219 | 29.5% |
| Coordinates | 734 | 98.8% |
| Neighbourhood | 743 | 100% |
| Cuisine classification | 743 | 100% |
| Accessibility information | 229 | 30.8% |
| Patio information | 40 | 5.4% |
| Usable rights-approved media | 0 | 0% |

Raw layers: 10 curated, 735 OpenStreetMap, 6 reviewed local-discovery records, 739 pre-discovery catalog records.

## Social coverage

| Platform | Places | Coverage |
| --- | ---: | ---: |
| instagram | 127 | 17.1% |
| facebook | 109 | 14.7% |
| tiktok | 13 | 1.7% |
| threads | 0 | 0% |
| x | 58 | 7.8% |
| youtube | 11 | 1.5% |
| linkedin | 6 | 0.8% |
| bluesky | 2 | 0.3% |
| pinterest | 2 | 0.3% |
| snapchat | 0 | 0% |
| linktree | 0 | 0% |
| beacons | 0 | 0% |
| linkinbio | 0 | 0% |
| campsite | 0 | 0% |
| bento | 0 | 0% |

- Website but no social network found: **148**
- No official website in the canonical record: **459**
- Shared-profile keys: **24**; places with shared-brand profiles only: **24**
- Candidate social associations awaiting verification: **0**
- Social source observations older than 90 days: **0**

## City events

- Current/upcoming events: **166**
- Sources represented: **11**
- Next 7 days: **9**; next 30 days: **35**
- Ticket links: **166**; price information: **11**; explicitly free: **0**
- Coordinates: **0**
- Conservative exact venue-name → restaurant matches: **10**
- Possible duplicate current event records: **0**

### Events by municipality

- Halifax: 166

### Events by category

- Sports: 61
- Music: 58
- Arts: 42
- Community: 11
- Festivals: 10
- Comedy: 4
- Food & Drink: 3
- Other: 2
- Outdoor: 1

### Events by source

- Symphony Nova Scotia: 35
- Halifax Mooseheads Home Schedule: 32
- Scotiabank Centre: 31
- Tourism Nova Scotia Events: 23
- Light House Arts Centre: 19
- The Carleton: 10
- HFX Wanderers 2026 Home Schedule: 5
- Halifax Tides 2026 Home Schedule: 4
- Halifax Public Libraries: 3
- Neptune Theatre: 3
- Halifax Convention Centre: 1

## Freshness

- < 7 days: 735
- 7–30 days: 8
- 30–90 days: 0
- > 90 days: 0
- Unknown: 0

## Source failures visible in the current data

- officialWebsiteChecks: 51
- firstPartyWebsiteDiscovery: 75
- verifiedSourcePages: 15
- structuredRestaurantEvents: 12
- websiteFeeds: 14
- socialApis: 3
- cityEventSources: 0
- openingWatchSources: 0
- restaurantDirectorySources: 0

## Known model gaps exposed by this baseline

- Reviewed discovery still follows the app's existing name-based merge behavior; name-only merges observed: **2**.
- City events do not yet have canonical venue/organizer entities; the venue relationship number above is only a conservative name match.
- Accessibility and patio coverage are only counted when explicit fields/OSM tags/official-site evidence exist; absence is not treated as “no.”
- Social link hubs are measured separately from social networks.

Machine-readable details, gap queues, definitions, and failure counts are in `data/build/content-coverage-report.json`.
