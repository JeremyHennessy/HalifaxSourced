# Halifax Sourced content coverage baseline

Generated: 2026-08-29T17:21:49.561Z

This report measures the currently committed production data layers. It is a content-completeness baseline, **not a restaurant quality or popularity rating**. Unknown data remains unknown; source leads are not converted into fabricated facts.

## Restaurant coverage

| Metric | Places | Coverage |
| --- | ---: | ---: |
| Canonical places | 749 | 100% |
| Official website | 290 | 38.7% |
| Verified/reachable official website | 242 | 32.3% |
| Public inspection match | 496 | 66.2% |
| Menu link | 156 | 20.8% |
| Verified menu link | 86 | 11.5% |
| Special evidence | 55 | 7.3% |
| Verified specials source | 25 | 3.3% |
| Reservation link | 62 | 8.3% |
| Online ordering link | 81 | 10.8% |
| Event evidence | 47 | 6.3% |
| Structured upcoming restaurant events | 2 | 0.3% |
| At least one social network profile | 143 | 19.1% |
| Phone | 251 | 33.5% |
| Hours | 225 | 30% |
| Coordinates | 738 | 98.5% |
| Neighbourhood | 749 | 100% |
| Cuisine classification | 749 | 100% |
| Accessibility information | 229 | 30.6% |
| Patio information | 40 | 5.3% |
| Usable rights-approved media | 1 | 0.1% |

Raw layers: 10 curated, 735 OpenStreetMap, 12 reviewed local-discovery records, 739 pre-discovery catalog records.

## Social coverage

| Platform | Places | Coverage |
| --- | ---: | ---: |
| instagram | 132 | 17.6% |
| facebook | 115 | 15.4% |
| tiktok | 12 | 1.6% |
| threads | 0 | 0% |
| x | 59 | 7.9% |
| youtube | 12 | 1.6% |
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

- Current/upcoming events: **184**
- Sources represented: **15**
- Next 7 days: **16**; next 30 days: **50**
- Ticket links: **184**; price information: **11**; explicitly free: **0**
- Coordinates: **0**
- Conservative exact venue-name → restaurant matches: **8**
- Possible duplicate current event records: **0**

### Events by municipality

- Halifax: 164
- Dartmouth: 14
- Bedford: 6

### Events by category

- Sports: 61
- Music: 57
- Arts: 49
- Community: 30
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
- The Carleton: 8
- Alderney Gate Public Library: 7
- Woodlawn Public Library: 6
- Bedford Public Library: 6
- HFX Wanderers 2026 Home Schedule: 5
- Halifax Tides 2026 Home Schedule: 4
- Halifax Public Libraries: 3
- Neptune Theatre: 3
- Alderney Landing: 1
- Halifax Convention Centre: 1

## Freshness

- < 7 days: 741
- 7–30 days: 8
- 30–90 days: 0
- > 90 days: 0
- Unknown: 0

## Source failures visible in the current data

- officialWebsiteChecks: 51
- firstPartyWebsiteDiscovery: 75
- verifiedSourcePages: 15
- structuredRestaurantEvents: 12
- websiteFeeds: 9
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
