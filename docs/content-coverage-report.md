# Halifax Sourced content coverage snapshot

Generated: 2026-09-02T17:43:38.071Z
Source/deployment commit: supplied by CI for deployable snapshots.

This is the reconciled snapshot produced from the same data layers packaged for deployment. Unknown values remain unknown; source leads are not promoted to verified facts.

## Restaurant coverage

| Metric | Places | Coverage |
| --- | ---: | ---: |
| Canonical places | 750 | 100.0% |
| Active canonical places | 749 | 99.9% |
| Archived lifecycle places | 1 | 0.1% |
| Official website | 302 | 40.3% |
| Verified/reachable official website | 240 | 32.0% |
| Menu link | 166 | 22.1% |
| Verified menu link | 137 | 18.3% |
| Phone | 278 | 37.1% |
| Hours | 245 | 32.7% |
| At least one social profile | 159 | 21.2% |
| Usable rights-approved media | 73 | 9.7% |
| Coordinates | 739 | 98.5% |
| Neighbourhood | 750 | 100.0% |

## Restaurant-event definitions

- **2 canonical restaurants with upcoming structured events** is a distinct-place count.
- **20 upcoming structured restaurant event records** is an event-record count; one restaurant can have multiple events.
- 21 total structured restaurant event records are stored, including 1 expired records.

## Lifecycle

- Inactive records remain directly addressable as archived details.
- Permanently closed, temporarily closed, and moved records are excluded from active discovery, menus, specials, and maps.
- Official closure or move language creates a review candidate and never changes production status automatically.

## Source failures

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
- structuredPlaceFacts: 0

Machine-readable definitions, percentages, gap queues, and counts are in `data/build/content-coverage-report.json`. Exact-SHA deployment metadata is in `data/build/deployment-metadata.json` in CI and the deployed Pages artifact.
