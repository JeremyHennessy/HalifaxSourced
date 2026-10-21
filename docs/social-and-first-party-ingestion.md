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
- bounded factual candidate tokens (dates, times, prices and standard condition flags) for deals/events

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

## Fact-only deal and event candidates

The Meta importer now classifies the available caption/message in memory, then discards it. It does not request or retain image/video URLs. Its title and summary are generated generic discovery labels, not copied captions. Image publication rights remain a completely separate workflow; extracting a factual candidate never grants image permission.

`scripts/lib/social-fact-candidates.mjs` collects bounded literal date/time/price mentions and a small vocabulary of conditions. These are **candidates**, not a complete language understanding system or verified offers. Unknown conditions may be absent, dollar signs do not establish CAD, and relative dates are not resolved. The original post permalink and observation/publication timestamps remain attached. Missing exact post permalinks must not be presented as verified post evidence.

Every candidate is explicitly non-publishable and requires exact-branch, timing, timezone, complete terms, expiry, freshness and cancellation checks. `America/Halifax` is the target-region timezone, not a statement that the post confirmed it. A unique website-linked handle is not exact-venue proof. Shared-brand profiles and non-active profile records are excluded from API attempts. Existing post approval decisions cannot publish these unresolved factual candidates.

Stories are not collected by this importer. No Story endpoint, expired-Story recovery, OCR, media downloading, browser login, or HTML scraping fallback has been added. Content available only in artwork remains a coverage gap. An authorized source submission could supply facts later, but no such source or access is implied here.

## Access and coverage audit, 2026-10-21

The accepted first-party snapshot (generated 2026-10-06) contains 150 Facebook and 153 Instagram profile associations. After the existing local-restaurant policy filter, these become 125 Facebook and 129 Instagram associations. These are navigation/source-discovery relationships, not functioning content feeds. Examples include Battery Park, The Canteen, Bar Kismet, and separate Dartmouth/Halifax handles for 2 Doors Down; the latter illustrates why profile uniqueness must not resolve branch identity by itself.

The accepted Meta snapshot (generated 2026-09-04) reports zero posts observed and missing Facebook/Instagram credentials. This historical snapshot does not prove current secret configuration. A fresh Metricool capability read on 2026-10-21 also reported no connected social network; its account analytics/scheduling connection is not a substitute for the Meta permissions required by this collector. No live Meta posts were newly collected in this change.

Next access step: verify the existing authorized Meta application and the exact Page/Instagram permissions before configuring any credential. Persistent access changes require separate approval. Eligible public business websites, RSS/Atom feeds and linked public event/menu sources remain independent permitted sources, subject to their own access and identity checks. Linking a public Instagram/Facebook account does not authorize bypassing access controls or guarantee Stories coverage.

Failed, missing-access and unattempted profile refreshes retain eligible, still-recent prior observations without changing their source timestamps. Retained legacy records are reduced to the same fact-only contract; captions and media URLs are not carried forward. `retainedPosts`, `profilesCompleted` and `observationState: retained_not_refreshed` distinguish history from newly observed content. Successful profile pulls replace that profile's bounded snapshot. No missing-access run becomes a fresh observation.

The public runtime excludes fact-only candidates from current special/event flags, source links and official updates. The review builder also rejects all fact-only candidates, including malformed or older blanket approvals. A future explicit fact-verification workflow is required before these candidates can become published deals/events; this patch does not invent one.
