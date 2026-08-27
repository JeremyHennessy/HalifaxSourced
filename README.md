# Halifax Sourced

A public discovery app for Halifax food and drink: events, happy hours, specials, patios, openings, menus, hours, and practical details. The app cross-references public and permitted sources so each lead can be traced back to where it came from.

## Live app

```text
https://jeremyhennessy.github.io/HalifaxSourced/
```

## Current scope

The expanded directory starts with the Halifax peninsula plus nearby Dartmouth, Bedford, Armdale, Fairview, and immediate surrounding areas. Curated starter records are layered on top of OpenStreetMap discovery records, restaurant-owned website signal checks, Nova Scotia public registry records, owner/community submissions, and optional Google Places place-ID links.

This is not an ownership or compliance review app. Public registry and inspection links are used only as cross-references for matching active establishments and addresses. The product should lead with what people are looking for: what is open, where the patios are, what has specials, what has events, and where to find the official source.

## Run locally

This version has no build step and no package install requirement.

```powershell
node .\scripts\dev-server.mjs
```

Then open `http://localhost:5173`.

## What exists now

- Public directory with search, category filters, patio/opening filters, sorting, restaurant cards, detail panes, and a Leaflet map using OpenStreetMap public tiles.
- Source Gap Workbench for missing menus, missing direct websites, no special/event lead, patio unknown, stale source checks, and directory-only records.
- 735 OpenStreetMap food/drink records plus 10 curated starter records, merged into 739 public records.
- 282 official restaurant websites scanned for discovery signals.
- Current official-site signal leads: 163 menu, 108 specials, 74 events, 19 patio, 9 opening, 37 brunch, 102 reservation, and 92 takeout/delivery leads.
- 1,919 Government of Nova Scotia public registry records for Halifax, Dartmouth, and Bedford, with 496 public records currently matched to at least one registry entry.
- Source-aware data model in `data/source-contract.json`.
- Local development catalog and SQLite database in `data/build/`.
- Import jobs for OpenStreetMap, Nova Scotia public registry records, owner/community submissions, official website signals, and Google Places place-ID linking.

## Data commands

```powershell
node .\scripts\import-osm-restaurants.mjs
node .\scripts\import-ns-food-inspections.mjs
node .\scripts\import-owner-submissions.mjs
$env:OFFICIAL_SITE_LIMIT='9999'; node .\scripts\import-official-sites.mjs
node .\scripts\validate-data.mjs
node .\scripts\export-catalog.mjs
C:\Users\JeremyHennessy\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe .\scripts\build-sqlite-db.py
```

The SQLite database is written to:

```text
data/build/halifax_sourced.sqlite
```

Current SQLite tables include `restaurants`, `restaurant_sources`, `specials`, `events`, `source_gap_queue`, `official_site_signals`, `official_site_signal_links`, and `restaurant_inspection_records`.

## Import jobs

OpenStreetMap discovery:

```powershell
node .\scripts\import-osm-restaurants.mjs
```

Nova Scotia public registry cross-reference:

```powershell
$env:NS_FOOD_CITIES='Halifax,Dartmouth,Bedford'
node .\scripts\import-ns-food-inspections.mjs
```

This writes permitted government registry records to `data/ns-food-inspections.js` and `data/build/ns-food-inspections.json`. The app treats registry matches as establishment/address cross-references, not ratings or rankings.

Owner/community submissions:

```powershell
node .\scripts\import-owner-submissions.mjs
```

Put CSV or JSON files in `data/imports/`. See `data/imports/owner-submissions.example.csv` for the starter shape.

Official website discovery signals:

```powershell
$env:OFFICIAL_SITE_LIMIT='9999'
node .\scripts\import-official-sites.mjs
```

This checks restaurant-owned websites for candidate menu, happy-hour, special, event, patio, opening, brunch, reservation, takeout, and delivery links. It writes public lead data to `data/official-site-signals.js` and build data to `data/build/official-site-signals.json`.

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
- Government of Nova Scotia registry records are cross-reference links, not restaurant rankings.
- Facebook and Instagram content should only be imported through authorized API access, permitted embeds, or owner/community submissions.
- Google reviews/ratings/photos should only be displayed through permitted Google Places API use with attribution and retention controls.
- Missing data is not a negative rating. It stays visible as a source gap for future cross-reference.