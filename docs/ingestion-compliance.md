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

The shared `scripts/lib/robots-policy.mjs` policy is used by exactly nine adapters:
`import-official-sites.mjs`, `verify-official-source-pages.mjs`,
`import-structured-events.mjs`, `import-official-page-intelligence.mjs`,
`import-patio-directory-facts.mjs`, `import-city-events.mjs`,
`import-public-special-source-leads.mjs`, `import-first-party-feed-signals.mjs`, and
`discover-first-party-sources.mjs`. Policy retrieval uses the existing quarantined-source
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
not full RFC 9309 conformance. All nine adapters consult the same policy callback
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

Four independent implementations remain outside this migration:
`import-structured-place-facts.mjs`,
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

## First-party discovery transport safety (October 22, 2026)

Discovery obtains permission and sitemap metadata from one qualified, cached robots
response per origin. Unavailable, partial or challenge responses yield no metadata
and no content fetch; unavailable results are not retried. The existing
`createRobotsAllows` callback API remains unchanged for other adapters. Discovery
also retains its distinct historical Sitemap/group denial projection as an opt-in
union with the shared modern and legacy denials. In particular, a nonempty Sitemap
line never splits that historical discovery group; switching parsers cannot reopen
a path denied by the old discovery implementation. Sitemap pointers stay deduplicated,
same-site filtered and limited to 12; they do not authorize fetching their targets.

HTML fetch and body consumption share a bounded operation deadline. A stalled body
settles as a failure and releases that host's queue; late responses cannot admit
another redirect or manufacture a successful observation. The existing target/ID,
owned-page, link-hub, concurrency and host-serial bounds remain unchanged. Only
restaurant-linked supported hubs may be traversed, under their own robots policy.
Social destinations and discovered feed/sitemap pointers are never crawled here.
HTTP/MIME success is not venue identity, ownership, content verification or media
permission; HTML challenge/content classification beyond the existing checks is not
claimed by this scoped transport repair.

Failed and unattempted discovery records retain their exact prior objects, including
hashes, genuine observation/verification clocks, rights and review fields. Actual
entrypoint fixtures run discovery, history merge and sanitation to verify retained
records and genuine old relationship dates after partial owned-page/hub failures.
This is not an association-lifetime repair: the separate history merger still has
known build-receipt clock fallback, review-state upgrade, expired/changed-site feed
association and attempt-counter limitations. Those require a separately reviewed
provenance batch, not fabricated new clocks or destructive history loss here.
No historical record is re-observed, re-reviewed or newly licensed by this patch.

Social's exact-head, transport-denied PR lane now runs the composite policy/adapter
suite and watches all its local fixture dependencies. The suite includes the complete
105-case discovery policy matrix, HTML deadlines, cached sitemap metadata, bounds,
per-hop denials and the real discovery/history/sanitation path. The scheduled/manual
producer body, permissions, collection limits, schedules and artifact paths remain
byte-identical. Source Expansion and City's existing offline adapter commands also
exercise these fixtures. Restaurant Discovery has its separate PR boundary below.
No accepted data, UI, source registry, API authentication or publication
rights change is included.

## Restaurant Discovery PR isolation (October 22, 2026)

Restaurant Discovery Preview now separates exact-head pull-request validation
from its existing `discover` producer. The PR job has read-only permissions and
one command block with `deny-source-network.mjs` preloaded. Collector entrypoints
are syntax-checked only: directory import, review-directory import, Dartmouth
refinement and opening-watch collection never execute in that job. It does not
upload preview or diagnostic artifacts and is not a publication path.

The real Dartmouth decoder and Taste member-helper regressions run offline.
`test-restaurant-discovery-offline.mjs` also runs them and the actual approved
discovery builder, catalog exporter, directory resolver and two discovery checks
in disposable copies. It starts without stale catalog/resolution/discovery build
outputs, proves the resolver needs the catalog export, checks accepted JS/JSON
input parity, and verifies every immutable input byte and candidate/approved-ID
count. Two runs at one test-only clock must produce identical derived bytes.
Transport and subprocess attempts fail even when caught. The checkout's accepted
inputs, output files, observation dates and approval decisions are never rewritten.
This projection test does not certify or repair collector robots semantics,
historical association eligibility or existing build-time freshness fallbacks.

The workflow regression pins the complete PR command/path/checkout/environment/
permissions/job envelope and rejects adversarial mutations. `scripts/**` covers
the source scanner and transitive fixture dependencies, `data/**` covers accepted
and fallback inputs, `.github/workflows/**` covers workflow readers, and the five
root runtime dependencies are explicit. These wider filters enter only the
offline validator. The `discover` job gains only a pull-request exclusion; its
body is byte-identical to the merged #158 baseline, including source bounds,
commands, artifact paths and 30-day retention. Daily 10:43 UTC and manual behavior
are unchanged. No other workflow or producer changes.

Restaurant remains absent from the preview coordinator's trigger and lane
allowlists. A synthetic successful Restaurant PR is also rejected by the global
PR admission guard even when all three older retained artifact lanes are ready;
an empty/new artifact set alone is not that protection. Quality Gate retains its
existing bounded live link-status exception and the full immutable release path.
Local offline tests are not hosted Node 22, Pages deployment or live acceptance.
No source/coordinate holds, accepted data, UI, rights, clocks or review states
are changed, and the separate first-party history defects remain unresolved.

## Feed refresh safety (October 22, 2026)

First-party feed refreshes use the shared fail-closed robots policy and the same
per-hop quarantine/hostname boundary. A complete-operation deadline includes policy
admission, content fetch, body consumption and bounded parsing. The shared guarded
fetch also checks abort state before and after policy admission and transport, so
late responses cannot admit another redirect or revive an expired operation. No
new credentials, origin permissions, source families or retry paths are added.

Only a complete HTTP 200 RSS/RDF/Atom envelope with a permitted XML/plain media
type (or no declared type) can complete a feed. The conservative structural parser
rejects malformed nesting, multiple roots, invalid entities, DTDs, error/challenge
bodies and out-of-scope item nodes. Comments and CDATA cannot fabricate items or
item metadata. Unsupported XML is a failure, not an empty successful feed. Content
is bounded to 4 MiB and extraction to the existing first 80 items. A valid empty
feed, or one whose valid items all fall outside the configured publication lookback,
successfully replaces that exact source's history; incomplete 206/other statuses,
body errors, timeouts and malformed entries do not. Parsing is staged before any
posts or successful receipt are committed.

Before requests or writes, the previous JSON/JavaScript pair must agree and satisfy
the bounded post contract, including valid original observation dates and an exact
signal subset. Only the importer's native `source_signal`/`needs_date_review` prior
states are admitted. Unsupported review states or explicit prior quarantine/failed
identity/location decisions abort before transport, so even a successful refresh
cannot reset them to `source_signal`. Both files absent means first use; an incomplete/malformed pair
stops the importer without replacing either file. No script snapshot is evaluated.
Missing/malformed association or exclusion input also stops the run.

Failed and limit-unattempted sources retain only current, uniquely verified exact
restaurant/feed associations, determined before the collection limit. Global
reviewed URL exclusions, shared-brand/oEmbed sources, reassigned identities,
quarantines and explicit failed identity/location validation cannot be resurrected.
Retention remains at most 80 prior posts per source and within FEED_LOOKBACK_DAYS
(default 180), using publication time or the original observation when undated,
never build/attempt time. Future dates are not carried. Pruned historical dates
are counted separately from completed sources. Retained objects preserve their
original evidence, rights, media pointers and review fields unchanged. Aggregate
retention/attempt counters do not certify new observations. Fresh rows win any
same-restaurant/post collision; signals are projected from the winning posts so a
retained stale signal cannot survive its refreshed non-signal replacement.

The existing bounded excerpts (default 420, maximum 700 characters) and image URLs
remain references, not a new grant to retain raw articles or publish media. Source
association and robots access do not verify business identity or image rights.
The new actual-entrypoint regression uses finite mocked transport with fatal
network denial. It runs in protected exact-head Social/Source Expansion PR lanes
and Quality Gate, with complete fixture dependency paths. Collection job bodies,
schedules, accepted data and publication/review gates are unchanged. Restaurant
Discovery's separate legacy PR collection lane is neither touched nor activated.

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
