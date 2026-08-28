# First-party website and social ingestion

Halifax Sourced treats restaurant-owned websites, restaurant-owned feeds, and official social accounts as separate evidence layers. The source chain matters: a social account is associated with a restaurant only when the restaurant's official website links to that profile, or when a future owner-submission/approved licensed source provides the same association.

## Website expansion

`scripts/discover-first-party-sources.mjs` checks restaurant-owned homepages and records:

- official Facebook profile links
- official Instagram profile links
- RSS/Atom feed links
- same-site sitemap declarations from `robots.txt`

The discovery pass respects `robots.txt`, uses a named Halifax Sourced user agent, applies bounded request timeouts, rate-limits requests per host, and stores provenance. It does not crawl Facebook or Instagram HTML. Cross-host work is parallelized while requests to the same host remain sequential.

`scripts/sanitize-first-party-sources.mjs` removes generic platform paths such as Facebook `/pages/` or `/people/` routes that are not actual restaurant profile handles. The integrity gate then validates the remaining profile URLs and association metadata.

## Restaurant-owned feeds

`scripts/import-first-party-feed-signals.mjs` reads RSS/Atom feeds discovered by the official-site pass. It uses feed title/summary text only to classify possible menu, special, event, opening, and brunch signals. The output retains only a short feed-item title, source/permalink, timestamps, and matched signal keywords; it does not retain article bodies or long descriptions.

A feed URL linked to more than one Halifax Sourced restaurant is treated as a shared brand feed and is excluded from restaurant-specific signal promotion. This avoids attaching chain-wide posts to one local location. Only uniquely associated feed URLs can produce restaurant-specific feed signals.

Feed items remain historical evidence even after they age out of consumer discovery. Unstructured feed/social signals are promoted into current special/event/opening/patio leads only when they have a parseable publication timestamp within the current freshness window. The browser currently uses a 60-day maximum age; older items stay in the source dataset but do not set current consumer flags.

## Facebook

Facebook collection is API-only. `scripts/import-meta-social.mjs` uses the Meta Graph API when `META_FB_ACCESS_TOKEN` is configured. For public Pages not managed by the app user, Meta may require the relevant reviewed public Page access/permissions. If access is not granted, the importer records the failure rather than scraping the public website.

The importer requests recent post metadata needed for discovery, classifies the post text in memory, then retains only:

- Page association and profile URL
- post ID/permalink
- publication/observation time
- matched discovery keywords

It intentionally does not retain Facebook post message text, comments, reactions, or images.

A Facebook handle linked by multiple Halifax Sourced restaurant records is considered a shared brand profile. It is excluded from location-specific post collection until a location-specific association is available.

## Instagram

Instagram collection is API-only. Halifax Sourced uses Instagram Business Discovery through the Meta Graph API when both `META_IG_USER_ID` and a suitable `META_IG_ACCESS_TOKEN` (or compatible Facebook Page access token) are configured.

Business Discovery can only cover Instagram professional accounts that Meta exposes through that API. Personal/consumer Instagram accounts are not treated as ingestible sources.

The importer classifies captions in memory and retains only the media ID, permalink, timestamp, media type, profile association, and matched signal keywords. It does not retain caption text or media URLs for reuse.

As with Facebook, an Instagram handle linked by multiple restaurant records is treated as a shared brand profile and is excluded from location-specific post collection.

## Required GitHub Actions secrets

- `META_FB_ACCESS_TOKEN` — Facebook Graph API token with the permissions/features required for the Pages being queried.
- `META_IG_ACCESS_TOKEN` — token used for Instagram Business Discovery. If omitted, the importer will try `META_FB_ACCESS_TOKEN`.
- `META_IG_USER_ID` — the Instagram professional account ID used as the Business Discovery caller.

Tokens are read only from the Actions environment. They are never written to build artifacts or production JavaScript. When credentials are absent, the importer records an explicit missing-credential state and exits without a scraping fallback.

## Refresh workflows

`.github/workflows/source-expansion-preview.yml` runs the full non-destructive source refresh. It refreshes official-site signals, verifies menu/special pages, refreshes structured events, discovers website feeds/social profiles, sanitizes profile paths, pulls RSS/Atom signals, attempts Facebook/Instagram API collection, validates the datasets, and uploads the results as a review artifact.

`.github/workflows/social-source-preview.yml` is the faster focused workflow for first-party source, feed, and Meta social layers. It is useful for validating social-source changes without waiting for the full menu/event refresh.

The full workflow is scheduled daily and can also be started manually. Production publication remains a separate reviewed step; scheduled source output does not automatically replace `main`.

## Evidence states

- `verified_link` — official website directly links to the feed/profile.
- `source_signal` — a uniquely associated restaurant-owned feed produced a keyword-classified item with a usable date/source.
- `needs_date_review` — restaurant-owned feed produced a signal but no parseable publication date.
- `api_observed` — Meta API returned a post/media object from a uniquely associated profile linked by the restaurant's official website.

Association bases used for restaurant-specific signals are `unique_feed_link_from_official_website` and `unique_profile_link_from_official_website`. Shared brand feeds/profiles are retained as discovery context where appropriate but are not promoted into location-specific signals.

None of these states means a special or event is currently active unless the underlying structured facts support that claim. The UI labels unstructured findings as leads, applies the freshness gate, and links to the original source for confirmation.
