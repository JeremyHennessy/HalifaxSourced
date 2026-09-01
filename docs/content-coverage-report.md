# Halifax Sourced content coverage baseline

Generated: 2026-09-01T18:02:48.071Z

This report measures the currently committed production data layers. It is a content-completeness baseline, **not a restaurant quality or popularity rating**. Unknown data remains unknown; source leads are not converted into fabricated facts.

## Restaurant coverage

| Metric | Places | Coverage |
| --- | ---: | ---: |
| Canonical places | 750 | 100% |
| Official website | 302 | 40.3% |
| Verified/reachable official website | 240 | 32% |
| Public inspection match | 496 | 66.1% |
| Menu link | 166 | 22.1% |
| Verified menu link | 137 | 18.3% |
| Special evidence | 99 | 13.2% |
| Verified specials source | 39 | 5.2% |
| Reservation link | 63 | 8.4% |
| Online ordering link | 80 | 10.7% |
| Event evidence | 47 | 6.3% |
| Structured upcoming restaurant events | 2 | 0.3% |
| At least one social network profile | 159 | 21.2% |
| Phone | 265 | 35.3% |
| Hours | 239 | 31.9% |
| Coordinates | 739 | 98.5% |
| Neighbourhood | 750 | 100% |
| Cuisine classification | 750 | 100% |
| Accessibility information | 229 | 30.5% |
| Patio information | 81 | 10.8% |
| Usable rights-approved media | 73 | 9.7% |

Raw layers: 10 curated, 736 OpenStreetMap, 12 reviewed local-discovery records, 740 pre-discovery catalog records.

## Social coverage

| Platform | Places | Coverage |
| --- | ---: | ---: |
| instagram | 147 | 19.6% |
| facebook | 140 | 18.7% |
| tiktok | 16 | 2.1% |
| threads | 0 | 0% |
| x | 65 | 8.7% |
| youtube | 13 | 1.7% |
| linkedin | 6 | 0.8% |
| bluesky | 2 | 0.3% |
| pinterest | 3 | 0.4% |
| snapchat | 0 | 0% |
| linktree | 0 | 0% |
| beacons | 0 | 0% |
| linkinbio | 0 | 0% |
| campsite | 0 | 0% |
| bento | 0 | 0% |

- Website but no social network found: **145**
- No official website in the canonical record: **448**
- Shared-profile keys: **39**; places with shared-brand profiles only: **32**
- Candidate social associations awaiting verification: **0**
- Social source observations older than 90 days: **0**

## City events

- Current/upcoming events: **192**
- Sources represented: **15**
- Next 7 days: **23**; next 30 days: **64**
- Ticket links: **192**; price information: **11**; explicitly free: **0**
- Coordinates: **0**
- Conservative exact venue-name → restaurant matches: **10**
- Possible duplicate current event records: **0**

### Events by municipality

- Halifax: 170
- Dartmouth: 16
- Bedford: 6

### Events by category

- Sports: 61
- Music: 58
- Arts: 42
- Community: 30
- Festivals: 18
- Comedy: 4
- Food & Drink: 4
- Outdoor: 2
- Other: 2

### Events by source

- Symphony Nova Scotia: 35
- Halifax Mooseheads Home Schedule: 32
- Scotiabank Centre: 31
- Tourism Nova Scotia Events: 23
- Light House Arts Centre: 17
- The Carleton: 10
- Halifax Convention Centre: 9
- Alderney Gate Public Library: 7
- Bedford Public Library: 6
- Woodlawn Public Library: 6
- HFX Wanderers 2026 Home Schedule: 5
- Halifax Tides 2026 Home Schedule: 4
- Alderney Landing: 3
- Neptune Theatre: 3
- Halifax Public Libraries: 1

## Freshness

- < 7 days: 749
- 7–30 days: 1
- 30–90 days: 0
- > 90 days: 0
- Unknown: 0

## Source failures visible in the current data

- officialWebsiteChecks: 63
- firstPartyWebsiteDiscovery: 64
- verifiedSourcePages: 22
- structuredRestaurantEvents: 9
- websiteFeeds: 2
- socialApis: 3
- cityEventSources: 0
- openingWatchSources: 0
- restaurantDirectorySources: 0
- publicSpecialSources: 0
- patioDirectorySources: 0

## Known model gaps exposed by this baseline

- Reviewed discovery still follows the app's existing name-based merge behavior; name-only merges observed: **2**.
- City events do not yet have canonical venue/organizer entities; the venue relationship number above is only a conservative name match.
- Accessibility and patio coverage are only counted when explicit fields/OSM tags/official-site evidence exist; absence is not treated as “no.”
- Social link hubs are measured separately from social networks.

Machine-readable details, gap queues, definitions, and failure counts are in `data/build/content-coverage-report.json`.

## Lifecycle and restaurant-event definitions

- Active canonical places: **749**; archived lifecycle records: **1**.
- Canonical restaurants with at least one upcoming structured restaurant event: **2**. This is a distinct-place count.
- Upcoming structured restaurant event records: **21** of **21** stored records. This is an event-record count and can include multiple events for one restaurant.
