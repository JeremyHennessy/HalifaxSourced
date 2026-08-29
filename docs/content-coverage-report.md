# Halifax Sourced content coverage snapshot

Generated: 2026-08-29T18:23:04.314Z
Source/deployment commit: `e083247491e097a10ab8a2bc44e93541373a34d9`

This is the reconciled snapshot produced from the same data layers packaged for deployment. Unknown values remain unknown; source leads are not promoted to verified facts.

## Restaurant coverage

| Metric | Places | Coverage |
| --- | ---: | ---: |
| Canonical places | 749 | 100.0% |
| Active canonical places | 748 | 99.9% |
| Archived lifecycle places | 1 | 0.1% |
| Official website | 299 | 39.9% |
| Verified/reachable official website | 242 | 32.3% |
| Menu link | 158 | 21.1% |
| Verified menu link | 86 | 11.5% |
| Phone | 274 | 36.6% |
| Hours | 243 | 32.4% |
| At least one social profile | 145 | 19.4% |
| Usable rights-approved media | 7 | 0.9% |
| Coordinates | 738 | 98.5% |
| Neighbourhood | 749 | 100.0% |

## Restaurant-event definitions

- **2 canonical restaurants with upcoming structured events** is a distinct-place count.
- **17 upcoming structured restaurant event records** is an event-record count; one restaurant can have multiple events.
- 19 total structured restaurant event records are stored, including 2 expired records.

## Lifecycle

- Inactive records remain directly addressable as archived details.
- Permanently closed, temporarily closed, and moved records are excluded from active discovery, menus, specials, and maps.
- Official closure or move language creates a review candidate and never changes production status automatically.

## Source failures

- officialWebsiteChecks: 51
- firstPartyWebsiteDiscovery: 75
- verifiedSourcePages: 15
- structuredRestaurantEvents: 12
- websiteFeeds: 9
- socialApis: 3
- cityEventSources: 0
- openingWatchSources: 0
- restaurantDirectorySources: 0
- structuredPlaceFacts: 3

Machine-readable definitions, percentages, gap queues, and counts are in `data/build/content-coverage-report.json`. Exact-SHA deployment metadata is in `data/build/deployment-metadata.json` in CI and the deployed Pages artifact.
