# Halifax Sourced

A source-aware restaurant intelligence app for Halifax, focused on happy hours, specials, events, cuisine types, occasions, quality signals, and review workflow.

## Live app

```text
https://jeremyhennessy.github.io/HalifaxSourced/
```

## Current scope

The first expanded directory starts with the Halifax peninsula plus nearby Dartmouth, Armdale, Fairview, and immediate surrounding areas. The bulk directory source is OpenStreetMap via Overpass API, with curated records layered on top for higher-value notes, specials, and evidence.

## Run locally

This version has no build step and no package install requirement.

```powershell
node .\scripts\dev-server.mjs
```

Then open `http://localhost:5173`.

## What exists now

- Public directory with search, category filters, sorting, restaurant cards, details, and a coordinate-based map view.
- Admin review queue for stale, OSM-only, missing-site, missing-address, no-special, and no-event records.
- 735 OpenStreetMap food/drink records plus 10 curated starter records, merged into 739 public records.
- Source-aware data model in `data/source-contract.json`.
- Local development catalog and SQLite database in `data/build/`.
- Import jobs for OpenStreetMap, owner submissions, official website signals, and Google Places place-ID linking.

## Data commands

```powershell
node .\scripts\import-osm-restaurants.mjs
node .\scripts\validate-data.mjs
node .\scripts\export-catalog.mjs
C:\Users\JeremyHennessy\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe .\scripts\build-sqlite-db.py
```

The SQLite database is written to:

```text
data/build/halifax_sourced.sqlite
```

## Import jobs

Owner submissions:

```powershell
node .\scripts\import-owner-submissions.mjs
```

Put CSV or JSON files in `data/imports/`. See `data/imports/owner-submissions.example.csv` for the starter shape.

Official website signals:

```powershell
$env:OFFICIAL_SITE_LIMIT='50'
node .\scripts\import-official-sites.mjs
```

This checks restaurant-owned websites for candidate menu, special, happy hour, and event links. It writes review-needed signals rather than auto-promoting facts.

Google Places place-ID linking:

```powershell
$env:GOOGLE_PLACES_API_KEY='your-key'
$env:GOOGLE_PLACES_LIMIT='25'
node .\scripts\import-google-places.mjs
```

This job is intentionally conservative: it stores place IDs for matching only. Google-sourced display fields, reviews, ratings, and photos must be fetched/rendered under Google Places API terms with attribution and cache controls.

## Source rules

- OpenStreetMap data requires attribution: Map data © OpenStreetMap contributors, ODbL.
- Facebook and Instagram content should only be imported through authorized API access or owner submissions.
- Google reviews/ratings/photos should only be displayed through permitted Google Places API use with attribution and retention controls.
- Missing data is not a negative rating. It stays visible as a review-needed coverage state.
