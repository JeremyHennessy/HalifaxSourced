# Ingestion and Compliance Notes

## Practical source tiers

| Tier | Source type | Use in app |
| --- | --- | --- |
| 1 | Restaurant-owned sites, menus, calendars, newsletters | Capture factual offers/events with source URL, timestamp, and review state. |
| 2 | Owner submissions | Treat as primary structured data, with audit history and review workflow. |
| 3 | OpenStreetMap | Use for broad directory discovery, coordinates, address/phone/site fields, and source links with OSM attribution. |
| 4 | Licensed APIs and feeds | Display fields only within each provider's terms, attribution, and retention limits. |
| 5 | Search/review/social profile links | Keep as evidence links or refresh targets unless terms permit copying/display. |
| 6 | User-submitted observations | Mark as community-submitted until confirmed by restaurant-owned or licensed source. |

## Current geography

The starter pull uses a bounding box around the Halifax peninsula and immediately nearby areas:

- South: `44.575`
- West: `-63.69`
- North: `44.705`
- East: `-63.505`

This captures the peninsula, downtown, North End, South End, West End, nearby Dartmouth, Fairview/Armdale, and adjacent food/drink listings. Future passes should replace the rough bounding box with named area polygons if exact neighborhood inclusion matters.

## Platform-specific guardrails

- OpenStreetMap: provide attribution and ODbL notice where OSM data is used. The public app includes a visible OSM attribution link.
- Facebook and Instagram: do not automate collection from pages, profiles, comments, posts, stories, or logged-in views without explicit permission and approved API access.
- Google Places: store stable place IDs where allowed; display Google-sourced ratings/reviews/photos only through permitted API use, attribution, and cache controls.
- Restaurant sites: respect `robots.txt`, rate limits, copyright, and site terms; capture only facts needed for the product.
- Review sites: do not copy review text at scale without a license; link to profiles and store manually verified summaries only when permitted.

## Review workflow

Every captured fact should carry:

- `sourceUrl`
- `sourceType`
- `observedAt`
- `validFrom`
- `validTo`
- `confidence`
- `reviewState`
- `notes`

Recommended review states:

- `verified`: confirmed from restaurant-owned or permitted licensed source.
- `needs-review`: imported but not reviewed, stale, or conflicting.
- `restricted`: useful as a link or lookup target, but not copied into the app.
- `expired`: known offer/event is no longer active.

## Quality scoring

Quality should be transparent and tunable. A useful first score can combine:

- Menu/offer freshness.
- Source reliability.
- Sentiment or rating signal where licensing allows it.
- Local/editorial tags.
- Repeat visit suitability.
- Accessibility of practical data such as hours, reservation link, and neighborhood.

Never let unavailable data silently become a low score. OSM-only directory records currently receive practical-data scores, not editorial quality judgments.
