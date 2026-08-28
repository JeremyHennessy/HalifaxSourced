# Halifax Sourced

Halifax Sourced is a Halifax-focused restaurant, menu, specials, event, and neighbourhood discovery interface.

## 2026 ground-up UI rebuild

The current interface was rebuilt from a clean visual baseline using the approved Halifax Sourced logo, coastal design references, and static design asset kit. The previous page structure and styling were replaced rather than reskinned.

The rebuild intentionally preserves the repository's existing collection and ingestion layer:

- curated restaurant records
- OpenStreetMap restaurant import
- Nova Scotia public food-inspection index
- official restaurant-site signal collection
- SQLite/catalog build artifacts
- owner-submission import path
- validation and data-ingestion documentation

The site is static and GitHub Pages-friendly. Hash routing is used so the discovery views can deep-link without requiring a server-side SPA fallback.

## Main views

- `#home` — editorial discovery homepage
- `#explore` — searchable/filterable restaurant results
- `#events` — event-source leads
- `#specials` — specials/happy-hour leads
- `#menus` — menu-ready restaurants
- `#map` — Leaflet map/list discovery
- `#restaurant/<id>` — restaurant detail and source evidence
- `#saved` — device-local saved places

## Data integrity

The UI distinguishes source coverage from consumer ratings. It does not fabricate live review scores, event dates, special prices, or reservations when those fields are not present in the collected data. Event and special signals are presented as leads when they require confirmation.

## Development

Serve the repository root over HTTP. For example:

```bash
node scripts/dev-server.mjs
```

Then open the local URL printed by the script.

## Data refresh

Existing import scripts remain under `scripts/`. See `docs/ingestion-compliance.md` and `data/source-contract.json` before extending collection.
