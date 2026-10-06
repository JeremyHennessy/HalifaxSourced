# Halifax Sourced content coverage baseline

Generated: 2026-10-06T02:02:00.935Z

This report measures the currently committed production data layers. It is a content-completeness baseline, **not a restaurant quality or popularity rating**. Unknown data remains unknown; source leads are not converted into fabricated facts.

## Restaurant coverage

| Metric | Places | Coverage |
| --- | ---: | ---: |
| Canonical places | 564 | 100% |
| Official website | 237 | 42% |
| Verified/reachable official website | 241 | 42.7% |
| Public inspection match | 326 | 57.8% |
| Menu link | 167 | 29.6% |
| Verified menu link | 147 | 26.1% |
| Special evidence | 103 | 18.3% |
| Verified specials source | 43 | 7.6% |
| Reservation link | 64 | 11.3% |
| Online ordering link | 80 | 14.2% |
| Event evidence | 48 | 8.5% |
| Structured upcoming restaurant events | 1 | 0.2% |
| At least one social network profile | 161 | 28.5% |
| Phone | 206 | 36.5% |
| Hours | 195 | 34.6% |
| Coordinates | 553 | 98% |
| Neighbourhood | 564 | 100% |
| Cuisine classification | 564 | 100% |
| Accessibility information | 168 | 29.8% |
| Patio information | 72 | 12.8% |
| Usable rights-approved media | 106 | 18.8% |

Raw layers: 10 curated, 736 OpenStreetMap, 12 reviewed local-discovery records, 554 pre-discovery catalog records.

## Social coverage

| Platform | Places | Coverage |
| --- | ---: | ---: |
| instagram | 149 | 26.4% |
| facebook | 142 | 25.2% |
| tiktok | 18 | 3.2% |
| threads | 0 | 0% |
| x | 65 | 11.5% |
| youtube | 13 | 2.3% |
| linkedin | 8 | 1.4% |
| bluesky | 2 | 0.4% |
| pinterest | 3 | 0.5% |
| snapchat | 0 | 0% |
| linktree | 0 | 0% |
| beacons | 0 | 0% |
| linkinbio | 0 | 0% |
| campsite | 0 | 0% |
| bento | 0 | 0% |

- Website but no social network found: **102**
- No official website in the canonical record: **327**
- Shared-profile keys: **41**; places with shared-brand profiles only: **32**
- Candidate social associations awaiting verification: **0**
- Social source observations older than 90 days: **0**

## City events

- Current/upcoming events: **126**
- Sources represented: **8**
- Next 7 days: **3**; next 30 days: **25**
- Ticket links: **126**; price information: **7**; explicitly free: **0**
- Coordinates: **0**
- Conservative exact venue-name → restaurant matches: **0**
- Possible duplicate current event records: **0**

### Events by municipality

- Halifax: 126

### Events by category

- Arts: 71
- Sports: 52
- Music: 46
- Community: 9
- Food & Drink: 5
- Outdoor: 3
- Comedy: 3
- Festivals: 3
- Family: 3

### Events by source

- Symphony Nova Scotia: 33
- Halifax Mooseheads Home Schedule: 31
- Scotiabank Centre: 26
- Light House Arts Centre: 16
- Tourism Nova Scotia Events: 14
- Neptune Theatre: 3
- HFX Wanderers 2026 Home Schedule: 2
- Halifax Tides 2026 Home Schedule: 1

## Freshness

- < 7 days: 1
- 7–30 days: 0
- 30–90 days: 563
- > 90 days: 0
- Unknown: 0

## Source failures visible in the current data

- officialWebsiteChecks: 63
- firstPartyWebsiteDiscovery: 1
- verifiedSourcePages: 21
- structuredRestaurantEvents: 12
- websiteFeeds: 3
- socialApis: 3
- cityEventSources: 1
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

- Active canonical places: **563**; archived lifecycle records: **1**.
- Canonical restaurants with at least one upcoming structured restaurant event: **1**. This is a distinct-place count.
- Upcoming structured restaurant event records: **2** of **20** stored records. This is an event-record count and can include multiple events for one restaurant.
