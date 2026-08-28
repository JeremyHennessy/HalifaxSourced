# First-party website and social ingestion

Halifax Sourced now treats restaurant-owned websites, restaurant-owned feeds, and official social accounts as separate evidence layers. The source chain matters: a social account is associated with a restaurant only when the restaurant's official website links to that profile, or when a future owner-submission/approved licensed source provides the same association.

## Website expansion

`scripts/discover-first-party-sources.mjs` checks restaurant-owned homepages and records:

- official Facebook profile links
- official Instagram profile links
- RSS/Atom feed links
- same-site sitemap declarations from `robots.txt`

The discovery pass respects `robots.txt`, uses a named Halifax Sourced user agent, rate-limits requests, and stores provenance. It does not crawl Facebook or Instagram HTML.

`scripts/import-first-party-feed-signals.mjs` reads restaurant-owned RSS/Atom feeds discovered by the official-site pass. It uses feed title/summary text only to classify possible menu, special, event, opening, brunch, and patio signals. The output retains only a short feed-item title, source/permalink, timestamps, and matched signal keywords; it does not retain article bodies or long descriptions.

## Facebook

Facebook collection is API-only. `scripts/import-meta-social.mjs` uses the Meta Graph API when `META_FB_ACCESS_TOKEN` is configured. For public Pages not managed by the app user, Meta may require the relevant reviewed public Page access/permissions. If access is not granted, the importer records the failure rather than scraping the public website.

The importer requests recent post metadata needed for discovery, classifies the post text in memory, then retains only:

- Page association and profile URL
- post ID/permalink
- publication/observation time
- matched discovery keywords

It intentionally does not retain Facebook post message text, comments, reactions, or images.

## Instagram

Instagram collection is API-only. Halifax Sourced uses Instagram Business Discovery through the Meta Graph API when both `META_IG_USER_ID` and a suitable `META_IG_ACCESS_TOKEN` (or compatible Facebook Page access token) are configured.

Business Discovery can only cover Instagram professional accounts that Meta exposes through that API. Personal/consumer Instagram accounts are not treated as ingestible sources.

The importer classifies captions in memory and retains only the media ID, permalink, timestamp, media type, profile association, and matched signal keywords. It does not retain caption text or media URLs for reuse.

## Required GitHub Actions secrets

- `META_FB_ACCESS_TOKEN` — Facebook Graph API token with the permissions/features required for the Pages being queried.
- `META_IG_ACCESS_TOKEN` — token used for Instagram Business Discovery. If omitted, the importer will try `META_FB_ACCESS_TOKEN`.
- `META_IG_USER_ID` — the Instagram professional account ID used as the Business Discovery caller.

Tokens are read only from the Actions environment. They are never written to build artifacts or production JavaScript.

## Refresh workflow

`.github/workflows/source-expansion-preview.yml` runs a non-destructive source refresh. It refreshes official-site signals, verifies menu/special pages, refreshes structured events, discovers website feeds/social profiles, pulls RSS/Atom signals, attempts Facebook/Instagram API collection, validates the datasets, and uploads the results as a review artifact.

The workflow is scheduled daily and can also be started manually. It does not automatically merge generated social data into `main`; source output should pass integrity review before publication.

## Evidence states

- `verified_link` — official website directly links to the feed/profile.
- `source_signal` — restaurant-owned feed produced a keyword-classified item with a usable date/source.
- `needs_date_review` — restaurant-owned feed produced a signal but no parseable publication date.
- `api_observed` — Meta API returned a post/media object from a profile linked by the restaurant's official website.

None of these states means a special or event is currently active unless the underlying structured facts support that claim. The UI should continue to label unstructured social/feed findings as leads and link to the original source for confirmation.
