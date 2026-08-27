# Halifax Sourced

A source-aware restaurant intelligence app for Halifax, focused on happy hours, specials, events, cuisine types, occasions, quality signals, map discovery, and admin review workflow.

## Live app

```text
https://jeremyhennessy.github.io/HalifaxSourced/
```

## Current scope

The expanded directory starts with the Halifax peninsula plus nearby Dartmouth, Bedford, Armdale, Fairview, and immediate surrounding areas. Curated records are layered on top of OpenStreetMap discovery records, Nova Scotia food-establishment inspection registry records, restaurant-owned website signal checks, owner submissions, and optional Google Places place-ID links.

## Run locally

This version has no build step and no package install requirement.

```powershell
node .\scripts\dev-server.mjs
```

Then open `http://localhost:5173`.

## What exists now

- Public directory with search, category filters, sorting, restaurant cards, detail panes, and a Leaflet map using OpenStreetMap public tiles.
- Admin review queue for stale, OSM-only, missing-site, missing-address, no-special, no-event, and inspection/evidence review states.
- 735 OpenStreetMap food/drink records plus 10 curated starter records, merged into 739 public records.
- 1,919 Government of Nova Scotia food inspection registry records for Halifax, Dartmouth, and Bedford, with 496 public records currently matched to at least one inspection entry.
- Official website signal cache covering 120 restaurant-owned sites for menu, specials, happy-hour, and event evidence review.
- Source-aware data model in `data/source-contract.json`.
- Local development catalog and SQLite database in `data/build/`.
- Import jobs for OpenStreetMap, Nova Scotia food inspections, owner submissions, official website signals, and Google Places place-ID linking.

## Data commands

```powershell
node .\scripts\import-osm-restaurants.mjs
node .\scripts\import-ns-food-inspections.mjs
node .\scripts\import-owner-submissions.mjs
$env:OFFICIAL_SITE_LIMIT='120'; node .\scripts\import-official-sites.mjs
node .\scripts\validate-data.mjs
node .\scripts\export-catalog.mjs
C:\Users\JeremyHennessy\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe .\scripts\build-sqlite-db.py
```

The SQLite database is written to:

```text
data/build/halifax_sourced.sqlite
```

Current SQLite tables include `restaurants`, `restaurant_sources`, `specials`, `events`, `review_queue`, and `restaurant_inspection_records`.

## Import jobs

OpenStreetMap discovery:

```powershell
node .\scripts\import-osm-restaurants.mjs
```

Nova Scotia food inspection registry:

```powershell
$env:NS_FOOD_CITIES='Halifax,Dartmouth,Bedford'
node .\scripts\import-ns-food-inspections.mjs
```

This writes permitted government registry records to `data/ns-food-inspections.js` and `data/build/ns-food-inspections.json`. The app treats registry matches as evidence links, not quality ratings.

Owner submissions:

```powershell
node .\scripts\import-owner-submissions.mjs
```

Put CSV or JSON files in `data/imports/`. See `data/imports/owner-submissions.example.csv` for the starter shape.

Official website signals:

```powershell
$env:OFFICIAL_SITE_LIMIT='120'
node .\scripts\import-official-sites.mjs
```

This checks restaurant-owned websites for candidate menu, special, happy-hour, and event links. It writes review-needed signals rather than auto-promoting facts.

Google Places place-ID linking:

```powershell
$env:GOOGLE_PLACES_API_KEY='your-key'
$env:GOOGLE_PLACES_LIMIT='25'
node .\scripts\import-google-places.mjs
```

This job is intentionally conservative: it stores place IDs for matching only. Google-sourced display fields, reviews, ratings, and photos must be fetched/rendered under Google Places API terms with attribution and cache controls.

## Map and source rules

- The public map uses Leaflet 1.9.4 and OpenStreetMap tiles from `https://tile.openstreetmap.org/{z}/{x}/{y}.png` with visible attribution.
- Do not bulk-download, prefetch, or package OSM tiles for offline use from the public tile service.
- OpenStreetMap data requires attribution: Map data (c) OpenStreetMap contributors, ODbL.
- Government of Nova Scotia inspection records are source/evidence links, not restaurant rankings.
- Facebook and Instagram content should only be imported through authorized API access or owner submissions.
- Google reviews/ratings/photos should only be displayed through permitted Google Places API use with attribution and retention controls.
- Missing data is not a negative rating. It stays visible as a review-needed coverage state.