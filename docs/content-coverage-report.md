# Halifax Sourced content coverage snapshot

Generated: 2026-09-01T13:45:12.302Z
Source/deployment commit: `cd4c1e311a91f098322770f9d5e2da7a9b46cd5a`

This is the reconciled snapshot produced from the same data layers packaged for deployment. Unknown values remain unknown; source leads are not promoted to verified facts.

## Restaurant coverage

| Metric | Places | Coverage |
| --- | ---: | ---: |
| Canonical places | 749 | 100.0% |
| Active canonical places | 748 | 99.9% |
| Archived lifecycle places | 1 | 0.1% |
| Official website | 301 | 40.2% |
| Verified/reachable official website | 223 | 29.8% |
| Menu link | 153 | 20.4% |
| Verified menu link | 93 | 12.4% |
| Phone | 264 | 35.2% |
| Hours | 238 | 31.8% |
| At least one social profile | 146 | 19.5% |
| Usable rights-approved media | 73 | 9.7% |
| Coordinates | 738 | 98.5% |
| Neighbourhood | 749 | 100.0% |

## Restaurant-event definitions

- **2 canonical restaurants with upcoming structured events** is a distinct-place count.
- **18 upcoming structured restaurant event records** is an event-record count; one restaurant can have multiple events.
- 20 total structured restaurant event records are stored, including 2 expired records.

## Lifecycle

- Inactive records remain directly addressable as archived details.
- Permanently closed, temporarily closed, and moved records are excluded from active discovery, menus, specials, and maps.
- Official closure or move language creates a review candidate and never changes production status automatically.

## Source failures

- officialWebsiteChecks: 72
- firstPartyWebsiteDiscovery: 73
- verifiedSourcePages: 9
- structuredRestaurantEvents: 8
- websiteFeeds: 6
- socialApis: 0
- cityEventSources: 0
- openingWatchSources: 0
- restaurantDirectorySources: 0

Machine-readable definitions, percentages, gap queues, and counts are in `data/build/content-coverage-report.json`. Exact-SHA deployment metadata is in `data/build/deployment-metadata.json` in CI and the deployed Pages artifact.
