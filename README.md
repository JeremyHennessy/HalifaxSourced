# Halifax Sourced

A local-first restaurant intelligence app for Halifax, focused on happy hours, specials, events, cuisine types, occasions, quality signals, and source evidence.

## Run locally

This version has no build step and no external dependencies.

```powershell
node .\scripts\dev-server.mjs
```

Then open `http://localhost:5173`.

## GitHub Pages

This is a static app and can be hosted from the repository root on the `main` branch with GitHub Pages.

Expected public URL after Pages is enabled:

```text
https://jeremyhennessy.github.io/HalifaxSourced/
```

## What exists now

- Static app shell with search, filters, sorting, summary metrics, restaurant cards, and detail panels.
- Seed records for a small set of Halifax/Dartmouth restaurants.
- Source-aware data model in `data/source-contract.json`.
- Data validator in `scripts/validate-data.mjs`.
- Owner submission starter template in `scripts/owner-submission-template.csv`.
- Evidence status labels so unverified, restricted, and verified facts are not mixed together.

## Validate data

```powershell
node .\scripts\validate-data.mjs
```

## Data strategy

The app should collect restaurant-owned and permitted data first:

- Restaurant websites, menus, calendars, newsletters, RSS feeds, and press pages.
- Owner submissions for happy hours, specials, events, and corrections.
- Google Places API identifiers and permitted display fields, with Google attribution and retention rules.
- Meta Graph API only where access is authorized, such as pages/accounts with proper permissions.
- Review-site links and aggregate evidence where licensing allows it.

Restricted platform content should be stored as source references, not copied into the product database.

## Next build steps

1. Add a restaurant directory database, preferably SQLite or DuckDB for local development.
2. Create importer jobs for official websites and owner-submitted CSV/JSON.
3. Add Google Places integration with attribution and cache controls.
4. Add admin review screens for stale, conflicting, or restricted-source facts.
5. Add public map/list views once the evidence workflow is reliable.
