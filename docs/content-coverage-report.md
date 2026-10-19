# Halifax Sourced content coverage baseline

Generated: 2026-10-19T15:59:07.189Z

Snapshot: historical_committed_snapshot (not deployment certification).

This report measures the controlled data layers in this build. It is a content-completeness baseline, **not a restaurant quality or popularity rating**. Unknown data remains unknown; source leads are not converted into fabricated facts.

## Restaurant coverage

| Metric | Places | Coverage |
| --- | ---: | ---: |
| Canonical places | 566 | 100% |
| Official website | 239 | 42.2% |
| Verified/reachable official website | 241 | 42.6% |
| Public inspection match | 326 | 57.6% |
| Menu link | 167 | 29.5% |
| Verified menu link | 147 | 26% |
| Special evidence | 103 | 18.2% |
| Verified specials source | 43 | 7.6% |
| Reservation link | 64 | 11.3% |
| Online ordering link | 80 | 14.1% |
| Event evidence | 48 | 8.5% |
| Structured upcoming restaurant events | 1 | 0.2% |
| At least one social network profile | 161 | 28.4% |
| Phone | 207 | 36.6% |
| Hours | 196 | 34.6% |
| Coordinates | 553 | 97.7% |
| Neighbourhood | 566 | 100% |
| Cuisine classification | 566 | 100% |
| Accessibility information | 168 | 29.7% |
| Patio information | 72 | 12.7% |
| Usable rights-approved media | 7 | 1.2% |

Raw layers: 10 curated, 736 OpenStreetMap, 14 reviewed local-discovery records, 554 pre-discovery catalog records.

## Social coverage

| Platform | Places | Coverage |
| --- | ---: | ---: |
| instagram | 149 | 26.3% |
| facebook | 142 | 25.1% |
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

- Website but no social network found: **104**
- No official website in the canonical record: **327**
- Shared-profile keys: **41**; places with shared-brand profiles only: **32**
- Candidate social associations awaiting verification: **0**
- Social source observations older than 90 days: **0**

## City events

- Current/upcoming events: **109**
- Sources represented: **7**
- Next 7 days: **8**; next 30 days: **24**
- Ticket links: **109**; price information: **6**; explicitly free: **0**
- Coordinates: **0**
- Conservative exact venue-name → restaurant matches: **0**
- Possible duplicate current event records: **0**

### Events by municipality

- Halifax: 109

### Events by category

- Arts: 63
- Sports: 44
- Music: 43
- Community: 8
- Food & Drink: 5
- Outdoor: 3
- Comedy: 3
- Festivals: 3
- Family: 3

### Events by source

- Symphony Nova Scotia: 31
- Halifax Mooseheads Home Schedule: 27
- Scotiabank Centre: 23
- Light House Arts Centre: 14
- Tourism Nova Scotia Events: 10
- Neptune Theatre: 3
- HFX Wanderers 2026 Home Schedule: 1

## Freshness

- < 7 days: 2
- 7–30 days: 1
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

- Active canonical places: **564**; archived lifecycle records: **2**.
- Canonical restaurants with at least one upcoming structured restaurant event: **1**. This is a distinct-place count.
- Upcoming structured restaurant event records: **1** of **20** stored records. This is an event-record count and can include multiple events for one restaurant.
