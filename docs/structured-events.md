# Structured event extraction

Halifax Sourced separates **event leads** from **structured upcoming events**.

Event leads are links or keyword signals that suggest a restaurant hosts events but do not establish a date. Structured events require machine-readable `Event` data from a restaurant-owned page and can therefore be displayed with a specific date/time.

## Source policy

`scripts/import-structured-events.mjs` reads existing official-site signals and only requests event candidate pages on the same site as the restaurant's official website. It:

- uses a named Halifax Sourced user agent
- consults `robots.txt` before requesting candidate pages
- requests pages serially with a configurable delay
- does not crawl third-party ticket/review/social sites
- extracts only factual structured fields needed by the product
- does not copy event descriptions or review/editorial text

## Required production fields

Every record in `data/structured-events.js` must contain:

- exact `restaurantId`
- deterministic `id`
- `title`
- `eventType`
- valid `startAt` and `endAt`
- `sourceUrl`
- `sourceKind: official_jsonld`
- `observedAt`
- `validFrom` / `validTo`
- `confidence: structured-official`
- `reviewState: verified`

The data-integrity gate fails malformed records or events attached to unknown restaurant IDs. Expired events are flagged as warnings and are not promoted by the Events UI.

## Preview workflow

The `Structured Events Preview` GitHub Action is deliberately non-mutating. It scans current official event pages, validates the generated data, and uploads an artifact containing:

- `data/structured-events.js`
- `data/build/structured-events.json`
- `artifacts/data-integrity-report.json`

Review that artifact before committing refreshed event data to `main`. This keeps automated crawling separate from production publication and ensures the normal Quality Gate and gated Pages deployment remain authoritative.
