# Source Promotion Workflow

Halifax Sourced keeps raw discovery output, review decisions, and production-approved media separate.

## Meta secrets

Add these GitHub repository secrets before expecting Facebook or Instagram API observations:

- `META_FB_ACCESS_TOKEN`
- `META_IG_ACCESS_TOKEN`
- `META_IG_USER_ID`

Without those secrets, `Source Expansion Preview` still passes but reports `facebook=missing`, `instagram=missing`, `attempted=0`, and `posts=0` for Meta API pulls.

## Preview

Run `Source Expansion Preview` on `main`. The workflow refreshes official website signals, direct menu/special pages, structured events, first-party feeds/social profiles, RSS/Atom posts, Meta API observations when credentials exist, recent post categorization, and thumbnail candidates.

The workflow uploads a `source-expansion-preview` artifact. Preview artifacts are not automatically production data.

## Promotion

Run `Promote Source Expansion Artifact` with the preview run ID. It downloads the artifact, copies an allowlist of generated source-backed files into a new branch, validates the data, and opens a PR.

By default it promotes sanitized recent post intelligence and thumbnail candidate queues. Raw social API artifacts are skipped unless `include_raw_social_signals` is explicitly enabled.

## Social/post review

Use `#admin/social` to review categorized posts. The admin screen saves decisions locally and can export/import JSON.

To publish approved post intelligence:

1. Export decisions from `#admin/social`.
2. Copy approved records into `data/reviewed-social-post-decisions.json`.
3. Run `node scripts/build-reviewed-social-posts.mjs`.
4. Commit `data/reviewed-social-post-decisions.json`, `data/reviewed-social-posts.js`, and `data/build/reviewed-social-posts.json`.

Only `approve_post`, `approved`, `publish`, or `promote` decisions are included in `HALIFAX_REVIEWED_SOCIAL_POSTS`.

## Thumbnail review

Use `#admin/thumbnails` to triage thumbnail candidates. Local approve/reject decisions are not production approval. A production thumbnail still requires a `data/restaurant-media.js` record with exact restaurant ID, source URL, attribution, rights basis, and `permissionConfirmed: true`.

## Place queues

Use `#admin/places` to work down conflicts, name-only matches, unresolved candidates, and source failures. Local decisions should be converted into reviewed place-resolution records before they affect the public directory.
