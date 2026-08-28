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
- `#events` — structured upcoming events when available, otherwise source leads
- `#specials` — specials/happy-hour leads
- `#menus` — menu-ready restaurants
- `#map` — Leaflet map/list discovery
- `#restaurant/<id>` — restaurant detail and source evidence
- `#saved` — device-local saved places

## Data integrity

The UI distinguishes source coverage from consumer ratings. It does not fabricate live review scores, event dates, special prices, or reservations when those fields are not present in the collected data. Event and special signals are presented as leads when they require confirmation.

Restaurant imagery is separately provenance-gated. Production photos are loaded from `data/restaurant-media.js` only when the media record has an exact restaurant ID, approved review state, explicit permission confirmation, source URL, source type, and documented rights basis. Unreviewed or merely public images are not rendered. See `docs/media-provenance.md`.

Structured event dates are kept separate from keyword/link leads. `data/structured-events.js` accepts only exact-ID official JSON-LD Event records with valid dates and source provenance. The Events view automatically prefers these records when they exist and falls back to source leads when none are available. See `docs/structured-events.md`.

## Development

Serve the repository root over HTTP. For example:

```bash
node scripts/dev-server.mjs
```

Then open the local URL printed by the script.

## Data refresh

Existing import scripts remain under `scripts/`. See `docs/ingestion-compliance.md`, `docs/media-provenance.md`, `docs/structured-events.md`, and `data/source-contract.json` before extending collection.

Owner media workflow:

```bash
node scripts/import-owner-submissions.mjs
# review normalized media and set reviewState=approved only when rights are verified
node scripts/build-restaurant-media.mjs
node scripts/check-data-integrity.mjs
```

Structured event preview:

```bash
node scripts/import-structured-events.mjs
node scripts/check-data-integrity.mjs
```

The `Structured Events Preview` workflow performs the same scan in GitHub Actions and uploads the generated data for review without modifying `main`.

## Deployment

GitHub Pages deployment is gated behind the `Quality Gate` workflow. The gated workflow deploys the exact `main` commit SHA that passed data-integrity and Playwright UI verification.
