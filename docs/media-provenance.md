# Restaurant media provenance

Halifax Sourced does not treat a publicly viewable restaurant photo as reusable by default. Production restaurant imagery must have an explicit rights basis and must pass review before the browser is allowed to render it.

## Production media record

Approved records are published to `data/restaurant-media.js` and are joined to restaurant data by exact `restaurantId`. Name-only/fuzzy matching is intentionally not used for media.

Every production record requires:

- `restaurantId` — exact Halifax Sourced restaurant ID
- `url` — image URL or repository `assets/...` path
- `alt` — useful alternative text
- `sourceUrl` — HTTP(S) page documenting the source/provenance
- `sourceType` — one of `owner`, `owner_submission`, `restaurant_owner`, `first_party`, `official_site_permitted`, `licensed`
- `rightsBasis` — short explanation such as `owner_attestation`, `written_permission`, or the applicable licence
- `permission` — `permitted`, `owner_approved`, `written_permission`, or `licensed`
- `permissionConfirmed: true`
- `reviewState: approved`
- `attribution` — when required by the owner/licence

The browser rejects records missing any of the required approval/provenance fields. The data-integrity gate also fails if an invalid record is present in the production manifest.

## Owner-submission workflow

1. Put owner-supplied CSV/JSON files in `data/imports/` using `scripts/owner-submission-template.csv`.
2. Run `node scripts/import-owner-submissions.mjs`.
3. Review the normalized submission in `data/build/owner-submissions.normalized.json`.
4. Confirm the exact `restaurant_id`, source URL, rights basis, permission attestation, attribution requirements, and image content.
5. Change the image `reviewState` to `approved` only after that review is complete. Do not approve merely because the image appears on a public website or social account.
6. Run `node scripts/build-restaurant-media.mjs` to publish only approved media into `data/restaurant-media.js`.
7. Run `node scripts/check-data-integrity.mjs` and the full Quality Gate before deployment.

## Queue handoff files

The thumbnail coverage report writes two operator handoff files under `data/build/`:

- `thumbnail-source-check-queue.csv` lists held candidates that need source/provenance review before promotion. Treat every row as unapproved until the source URL, image host, rights status, and visual crop have been checked.
- `owner-media-outreach.csv` lists restaurants with no discovered thumbnail candidate using the owner-submission import columns. Fill the blank contact and image fields only from owner-provided material or explicit written permission, then import through `node scripts/import-owner-submissions.mjs`.

## Rights rules

- A restaurant's official website can establish first-party provenance, but it does **not** by itself establish reuse permission.
- Social-media availability is not permission.
- Search-engine thumbnails are not a valid source.
- User/owner submissions require an affirmative rights attestation and review.
- Licensed media must retain the licence/attribution requirements in the record.
- When rights are uncertain, leave the record unapproved; the site will use a branded cuisine fallback instead.

This is intentionally conservative so imagery can be enriched without creating an undocumented copyright/provenance layer.
