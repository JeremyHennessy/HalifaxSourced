# First-party website and social ingestion

Halifax Sourced treats restaurant-owned websites, restaurant-owned feeds, official social profiles, link hubs, and post-level social APIs as separate evidence layers. The association chain is preserved so a navigation link can be useful without being misrepresented as location-specific post evidence.

The supported social/link-hub vocabulary lives in `data/social-platform-registry.json`. Scripts and validators must use that registry rather than inventing platform strings independently.

## Supported relationship types

### Social networks

- Instagram
- Facebook
- TikTok
- Threads
- X / Twitter
- YouTube
- LinkedIn
- Bluesky
- Pinterest
- Snapchat

### Link hubs

Link hubs are **not** social networks. Supported hub types are:

- Linktree
- Beacons
- Later Linkin.bio
- Campsite
- Bento

### Other first-party relationships

Reservation, ordering, menu, event, newsletter, and ticket links remain separate action-link types.

## Association evidence order

The current automated first-party pass supports these high-confidence association bases:

1. `linked_from_official_website` — a restaurant-owned page explicitly links to the profile/action.
2. `linked_from_official_location_page` — a restaurant-owned location/visit page explicitly links to it.
3. `jsonld_sameAs` — restaurant-owned JSON-LD declares the profile/hub through `sameAs`.
4. `linked_from_official_link_hub` — a restaurant-owned site links to a supported hub and that permitted public hub links onward to a social profile.

The registry also reserves values for trusted-directory, verified-search, manual-review, verified-social cross-link, and shared-brand evidence. Those lower-confidence paths must not be silently emitted by the first-party crawler.

Each social/hub record carries:

- platform
- handle
- URL/profile URL
- `locationSpecific`
- `sharedBrandProfile`
- `discoveredFrom`
- `associationBasis`
- `observedAt`
- `lastVerifiedAt`
- `reviewState`
- `confidence`
- `status`

Only sufficiently verified relationships are presented to users as official.

## Restaurant-owned website expansion

`scripts/discover-first-party-sources.mjs` begins from the canonical restaurant-owned website and, subject to `robots.txt`, may inspect a small bounded set of same-site about/contact/location/visit pages. It records:

- supported social profile links
- supported link hubs
- JSON-LD `sameAs` social/hub relationships
- reservation/order/menu/event/newsletter/ticket action links
- RSS/Atom feeds
- same-site sitemap declarations from `robots.txt`

The pass uses a named Halifax Sourced user agent, bounded request timeouts, per-host sequencing, and limited cross-host concurrency. It does not crawl login-restricted social-network HTML.

`scripts/sanitize-first-party-sources.mjs` validates profile hosts, platform values, generic/login/share/content paths, association bases, confidence values, and link-hub separation against `data/social-platform-registry.json`. The integrity gate independently validates the sanitized output.

## Official link hubs

A hub is traversed only when a restaurant-owned evidence source links to that hub. Halifax Sourced may fetch the public hub landing page when `robots.txt` allows it, then retain only supported outgoing social-profile links and provenance.

The evidence chain is preserved:

restaurant-owned page → official hub → social profile

Hub traversal does not authorize scraping the destination social network. Generic share/login/discovery URLs are discarded.

## Shared-brand profiles

Profiles linked by more than one restaurant location remain useful navigation links. The browser calculates shared profile associations and labels them as shared-brand relationships. Shared profiles are not treated as location-specific post evidence merely because multiple locations use them.

Post-level Meta ingestion keeps its stricter unique-location association requirement.

## Restaurant-owned feeds

`scripts/import-first-party-feed-signals.mjs` reads RSS/Atom feeds discovered by the official-site pass. It uses feed title/summary text only to classify possible menu, special, event, opening, and brunch signals. The output retains only a short feed-item title, source/permalink, timestamps, and matched signal keywords; it does not retain article bodies or long descriptions.

A feed URL linked to more than one Halifax Sourced restaurant is treated as a shared brand feed and is excluded from restaurant-specific signal promotion. Only uniquely associated feed URLs can produce restaurant-specific feed signals.

Feed items remain historical evidence after they age out of consumer discovery. Unstructured feed/social signals set current consumer leads only when they have a parseable publication timestamp within the configured freshness window. The browser currently uses a 60-day maximum age.

## Facebook and Instagram post signals

Profile-link discovery is separate from social-content ingestion.

Facebook and Instagram post/media collection is API-only through `scripts/import-meta-social.mjs`. Halifax Sourced does not fall back to scraping public Meta HTML when API access is missing or insufficient.

The importer classifies permitted API-returned post/caption text in memory and retains only the minimum discovery metadata:

- profile association/profile URL
- platform object ID
- post/media permalink
- publication/observation time
- matched discovery keywords

It intentionally does not retain full Facebook messages, Instagram captions, comments, reactions, or media bodies for republishing.

## Required GitHub Actions secrets

- `META_FB_ACCESS_TOKEN` — Facebook Graph API token with the permissions/features required for queried Pages.
- `META_IG_ACCESS_TOKEN` — Instagram Business Discovery token; if omitted the importer may try the Facebook token where compatible.
- `META_IG_USER_ID` — Instagram professional account ID used as the Business Discovery caller.

Secrets are read from the Actions environment and are never written to build artifacts or production JavaScript. Missing credentials produce an explicit missing-credential state; there is no scraping fallback.

## Refresh workflows

`.github/workflows/source-expansion-preview.yml` performs the full non-destructive source refresh: official-site signals, verified menu/special pages, structured restaurant events, first-party social/hub/feed/action discovery, sanitization, feed signals, permitted Meta API signals, and integrity validation.

`.github/workflows/social-source-preview.yml` is the focused first-party/social path. Both workflows upload review artifacts. Scheduled output does not automatically overwrite production `main`.

## Evidence states

- `verified_link` — a supported relationship passed the first-party evidence and sanitation rules.
- `source_signal` — a uniquely associated restaurant-owned feed produced a keyword-classified item with usable source/date evidence.
- `needs_date_review` — a restaurant-owned feed produced a signal but lacks a parseable publication date.
- `api_observed` — an approved platform API returned a post/media object for a uniquely associated profile.

A verified profile relationship does **not** make every post, special, event, hour, price, or opening claim current. Time-sensitive claims require their own source observation and freshness policy.
