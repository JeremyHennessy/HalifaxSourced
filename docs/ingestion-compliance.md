# Ingestion and Compliance Notes

## Practical source tiers

| Tier | Source type | Use in app |
| --- | --- | --- |
| 1 | Restaurant-owned sites, menus, calendars, newsletters, RSS/Atom feeds | Capture factual offers/events with source URL, timestamp, and review state. |
| 2 | Owner submissions | Treat as primary structured data, with audit history and review workflow. |
| 3 | OpenStreetMap | Use for broad directory discovery, coordinates, address/phone/site fields, and source links with OSM attribution. |
| 4 | Licensed APIs and approved platform APIs | Display or derive fields only within each provider's terms, permissions, attribution, and retention limits. |
| 5 | Search/review/social profile links | Keep as evidence links or refresh targets unless terms permit API-backed collection/display. |
| 6 | User-submitted observations | Mark as community-submitted until confirmed by restaurant-owned or licensed source. |

## Current geography

The starter pull uses a bounding box around the Halifax peninsula and immediately nearby areas:

- South: `44.575`
- West: `-63.69`
- North: `44.705`
- East: `-63.505`

This captures the peninsula, downtown, North End, South End, West End, nearby Dartmouth, Fairview/Armdale, and adjacent food/drink listings. Future passes should replace the rough bounding box with named area polygons if exact neighborhood inclusion matters.

## Platform-specific guardrails

- OpenStreetMap: provide attribution and ODbL notice where OSM data is used. The public app includes a visible OSM attribution link.
- Restaurant sites: respect `robots.txt`, rate limits, copyright, and site terms; capture only facts needed for the product. Restaurant-owned RSS/Atom feeds may be used as discovery sources, but long descriptions/article bodies are not retained.
- Facebook: do not scrape Facebook HTML, logged-in views, comments, reactions, or media. Collection must use Meta's approved APIs and a token/feature set that permits access to the Page being queried. Public Page failures remain failures rather than triggering a scraping fallback.
- Instagram: do not scrape Instagram HTML, logged-in views, stories, comments, or media. Collection must use Meta's approved Instagram APIs. Business Discovery is limited to professional accounts that Meta exposes through the API; consumer/personal accounts are not treated as ingestible sources.
- Social account association: a Facebook or Instagram profile is attached to a restaurant only when the restaurant-owned website links to that profile, an owner submission supplies it, or another approved source provides explicit provenance.
- Social content retention: post/caption text may be classified in memory when the API permits access, but Halifax Sourced stores only source IDs/permalinks, timestamps, platform metadata, and matched discovery keywords unless a separately reviewed use case permits more.
- Google Places: store stable place IDs where allowed; display Google-sourced ratings/reviews/photos only through permitted API use, attribution, and cache controls.
- Review sites: do not copy review text at scale without a license; link to profiles and store manually verified summaries only when permitted.

## Robots policy repair scope (October 22, 2026)

The shared `scripts/lib/robots-policy.mjs` policy is used by exactly seven adapters:
`import-official-sites.mjs`, `verify-official-source-pages.mjs`,
`import-structured-events.mjs`, `import-official-page-intelligence.mjs`,
`import-patio-directory-facts.mjs`, `import-city-events.mjs`, and
`import-public-special-source-leads.mjs`. Policy retrieval uses the existing quarantined-source
and same-host redirect guard, with a deadline around both fetch and body consumption.
An origin's in-flight result is cached for the run, including unavailable policies;
failures are not retried. Network/body errors, deadlines, rejected/missing/looping
redirects, HTTP 401/403, 429, 5xx, incomplete 206 responses and unknown statuses deny
collection. Only complete HTTP 200 policies are parsed; 404/410 are the explicit
absent-policy exceptions. A valid empty/comment-only 200 policy and Sitemap-only text are permitted.
Declared media types other than plain text, HTML/XML/JSON/error bodies, binary
control characters, nonempty Allow/Disallow values without a leading slash,
bodies without usable robots directives and policies larger
than 512 KiB remain unavailable, not empty policies. Absent media types are accepted
only when the body itself qualifies as usable robots text.

Matching includes pathname plus query, literal URI characters, `*`, terminal `$`,
UTF-8/percent-encoding normalization and case-insensitive exact product tokens.
Matching bot groups are merged; wildcard groups are merged only when there is no
exact matching bot group. The prior selected-group/literal-prefix denials are also
retained, so this repair cannot reopen a legacy-denied path, including legacy
literal `$` paths and erroneously selected `NotHalifaxSourced` groups. `Allow`
exceptions never reopen a denial. This is an intentionally stricter project policy,
not full RFC 9309 conformance. All seven adapters consult the same policy callback
at each guarded content redirect destination. Patio retains its single hardcoded
source and registry metadata semantics; intelligence retains its existing page,
restaurant, concurrency and host-serial delay bounds. City retains its registry modes,
priority, date windows, source page limits, batching, delays, extraction, identities
and ICS-to-list fallback semantics; unavailable same-origin policy remains cached
across fallback attempts.

Public-special retains its three hardcoded source families, discovery rules,
request limits, campaign delay, parsing and review states. The same policy callback
guards its HTML, discovered JavaScript bundle and existing happy-hour JSON API,
including each same-host content redirect destination. The API origin's robots
request carries only the collection User-Agent, never API authentication headers;
an unavailable or denied policy stops the API request without retries or alternate
credentials. The redirect boundary is canonical hostname, not strict same-origin;
each distinct origin receives its own policy check. Any failure within a source
family discards its partial refresh and retains that family's prior records,
preserving evidence clocks, rights/review states and media pointers. A successful
empty result remains distinct from a failed source. No retained record becomes
fresh or licensed merely because another refresh was attempted.

Publicly discoverable API metadata, an anonymous client value in a public bundle,
and a permitting robots policy are not licensing or provider-authorization
evidence. They neither authorize API access nor grant image or content rights.
The existing API path still requires the applicable provider permission, terms,
attribution and retention limits; this code-only policy guard establishes no new
permission or source-specific agreement. Provider denials must not be bypassed.

Five independent implementations remain outside this migration:
`discover-first-party-sources.mjs`, `import-structured-place-facts.mjs`,
`import-review-directory-restaurants.mjs`, `import-directory-restaurants.mjs`, and
`refine-dartmouth-directory.mjs`. Their robots semantics and failure handling have
not been repaired by this change. Future migration must preserve each adapter's
sitemap, crawl-delay, source enablement, rate and review constraints and add actual
entrypoint fixtures before any expansion.

Source Expansion pull requests now run exact-head offline validation with a
transport-denial preload and cannot run collection or publish preview artifacts.
City pull requests and code pushes likewise run exact-head transport-denied validation
only, without collection or preview/diagnostic uploads. City workflow-run admission
to retained-queue reconciliation is restricted to trusted successful main
schedule/manual producers, so validation pushes cannot promote any retained lane.
Existing scheduled/manual collection remains separate and otherwise unchanged.
The policy and actual-adapter regressions run in both that PR lane and Quality Gate.
The adapter suite preserves the 105-case, six-entrypoint matrix and 22 targeted
City fixtures, then runs the dedicated public-special and retention suites once
each under transport denial. Changes to either public-special suite trigger
Source Expansion PR validation. Adapter-suite changes also trigger City's offline
PR/push validation, never its collection job or retained-queue promotion.
Quality Gate link-status QA remains unchanged and is not wholly offline:
`LINK_HEALTH_LIMIT=0` checks all release URLs. The offline policy regressions
include the 22 original offline audit fixtures with unsafe expectations
reversed, tightening-only comparisons, cache/no-retry and stalled-body tests.
No source registry enablement, accepted dataset, source clock, media/review gate,
or collection schedule is changed by this code-only repair.

## Review workflow

Every captured fact should carry:

- `sourceUrl`
- `sourceType`
- `observedAt`
- `validFrom`
- `validTo`
- `confidence`
- `reviewState`
- `notes`

Recommended review states:

- `verified`: confirmed from restaurant-owned or permitted licensed source.
- `verified_link`: restaurant-owned source directly links to the discovered feed/profile.
- `source_signal`: restaurant-owned feed produced a dated discovery signal, but it is not automatically a current offer/event claim.
- `api_observed`: approved platform API returned a source object from an officially associated profile.
- `needs-review`: imported but not reviewed, stale, or conflicting.
- `restricted`: useful as a link or lookup target, but not copied into the app.
- `expired`: known offer/event is no longer active.

## Quality scoring

Quality should be transparent and tunable. A useful first score can combine:

- Menu/offer freshness.
- Source reliability.
- Sentiment or rating signal where licensing allows it.
- Local/editorial tags.
- Repeat visit suitability.
- Accessibility of practical data such as hours, reservation link, and neighborhood.

Never let unavailable data silently become a low score. OSM-only directory records currently receive practical-data scores, not editorial quality judgments. Likewise, failure to access a Facebook/Instagram account through the permitted API path must be treated as unavailable data, not as a negative restaurant signal.
