# Halifax Sourced content coverage baseline

Generated: 2026-09-04T12:58:51.597Z

This report measures the currently committed production data layers. It is a content-completeness baseline, **not a restaurant quality or popularity rating**. Unknown data remains unknown; source leads are not converted into fabricated facts.

## Restaurant coverage

| Metric | Places | Coverage |
| --- | ---: | ---: |
| Canonical places | 750 | 100% |
| Official website | 302 | 40.3% |
| Verified/reachable official website | 241 | 32.1% |
| Public inspection match | 496 | 66.1% |
| Menu link | 167 | 22.3% |
| Verified menu link | 142 | 18.9% |
| Special evidence | 106 | 14.1% |
| Verified specials source | 42 | 5.6% |
| Reservation link | 64 | 8.5% |
| Online ordering link | 80 | 10.7% |
| Event evidence | 48 | 6.4% |
| Structured upcoming restaurant events | 2 | 0.3% |
| At least one social network profile | 160 | 21.3% |
| Phone | 265 | 35.3% |
| Hours | 239 | 31.9% |
| Coordinates | 739 | 98.5% |
| Neighbourhood | 750 | 100% |
| Cuisine classification | 750 | 100% |
| Accessibility information | 229 | 30.5% |
| Patio information | 81 | 10.8% |
| Usable rights-approved media | 107 | 14.3% |

Raw layers: 10 curated, 736 OpenStreetMap, 12 reviewed local-discovery records, 740 pre-discovery catalog records.

## Social coverage

| Platform | Places | Coverage |
| --- | ---: | ---: |
| instagram | 148 | 19.7% |
| facebook | 141 | 18.8% |
| tiktok | 18 | 2.4% |
| threads | 0 | 0% |
| x | 65 | 8.7% |
| youtube | 13 | 1.7% |
| linkedin | 8 | 1.1% |
| bluesky | 2 | 0.3% |
| pinterest | 3 | 0.4% |
| snapchat | 0 | 0% |
| linktree | 0 | 0% |
| beacons | 0 | 0% |
| linkinbio | 0 | 0% |
| campsite | 0 | 0% |
| bento | 0 | 0% |

- Website but no social network found: **144**
- No official website in the canonical record: **448**
- Shared-profile keys: **41**; places with shared-brand profiles only: **32**
- Candidate social associations awaiting verification: **0**
- Social source observations older than 90 days: **0**

## City events

- Current/upcoming events: **192**
- Sources represented: **15**
- Next 7 days: **27**; next 30 days: **66**
- Ticket links: **192**; price information: **10**; explicitly free: **0**
- Coordinates: **0**
- Conservative exact venue-name → restaurant matches: **10**
- Possible duplicate current event records: **0**

### Events by municipality

- Halifax: 170
- Dartmouth: 16
- Bedford: 6

### Events by category

- Sports: 61
- Music: 57
- Arts: 44
- Community: 29
- Festivals: 18
- Comedy: 4
- Food & Drink: 4
- Other: 2
- Markets: 1
- Outdoor: 1

### Events by source

- Symphony Nova Scotia: 36
- Halifax Mooseheads Home Schedule: 32
- Scotiabank Centre: 30
- Tourism Nova Scotia Events: 23
- Light House Arts Centre: 18
- The Carleton: 10
- Halifax Convention Centre: 8
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

- officialWebsiteChecks: 64
- firstPartyWebsiteDiscovery: 66
- verifiedSourcePages: 21
- structuredRestaurantEvents: 9
- websiteFeeds: 3
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
- Upcoming structured restaurant event records: **20** of **20** stored records. This is an event-record count and can include multiple events for one restaurant.
