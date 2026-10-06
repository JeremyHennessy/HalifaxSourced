# Local source-integrity checkpoint — 2026-10-06

Baseline: `7063613d2e9b93d9f66e391a61e47bb1dcd45d07`, cloned into a separate HalifaxSourced checkout. No repository AGENTS.md was present. Static Pages, hash routing and the approved mobile layout are preserved. No push, PR, workflow dispatch, merge or deployment occurred.

## Implemented

- Shared source-integrity rules block justitalymentone.com, bowtiecreamery.com and glitterbeancafe.com from consumer navigation and the patched collectors. Historical wrong-entity and wrong-location associations are retained in `data/source-quarantine.json`; they are not collection targets.
- India Paradise's catalog website points at its Halifax downtown page. The existing bounded first-party collector read that page and retained its exact official Halifax Instagram and Facebook profile links. Brand homepage, Calgary offer, Mississauga menu and unvalidated local offer associations were quarantined. Social pages/posts were not fetched.
- Cross-entity redirects are rejected before the destination request. Same-host redirects have a bounded loop and a robots check for each destination. Existing feed/structured-event collection fails closed on redirects instead of automatically following them. Bounded first-party collection retains untouched and last-known-good records with their old verification times.
- Current offers require current structured evidence, safe source, identity/location acceptance, special-specific verification no more than 30 days old, and valid start/expiry bounds. URL verification is no longer offer verification. Detail pages explicitly mark historical offers as needing a fresh check. The minimum-current-offer coverage target is a warning; invalid evidence remains an error.
- Page publication parsing accepts explicit publisher metadata or Article/BlogPosting datePublished. Arbitrary meta values, modified dates and event dates cannot become publication dates. Future dates, including small clock skew, have unknown age and cannot be recent. Legacy page dates from the broad parser are retained as unverifiedPublisherDate, with publishedAt missing until re-observed. Retrieval times are not substituted for publication times. New normalized records have a record-content hash and a public-reference rights label, which is not a media licence.
- The promotion workflow fetches its target promotion ref, compares its fetched SHA with the advertised SHA, and supplies an explicit expected-SHA lease. An absent branch uses an explicit empty lease; fetch/network failure cannot become a blind force. This workflow was edited locally only.
- Detail sections and keyboard Skip-to-content retain the restaurant route, move focus, and preserve Back/Forward. Rebinding homepage save buttons is idempotent.
- Two Oct 8/10 Mooseheads duplicates were collapsed using explicit team aliases, venue and timestamp. Both source URLs, source IDs and duplicate IDs survive. Different opponents, venues or dates remain separate.

## Validation

Passed: 113 JavaScript syntax checks; source date/offer/entity regression; mocked safe-fetch redirect/robots regression; canonical-event dedupe regression; existing structured-special model regression; data integrity; expanded sources; structured specials; city events; local restaurant policy; existing rich-discovery browser regression; desktop 1440×1000 and mobile 390×844 detail/skip/history/save browser regression. The three collector files added at the end were syntax-checked as well. `git diff --check` passed.

Browser evidence is in `artifacts/consumer-integrity-test.json`. It records 569 loaded places, 568 active places, zero current verified offers, and no browser errors at both widths. Structured specials now contain 160 local records: 0 verified current, 55 stale, 100 source leads and 5 recurring leads needing verification. There are 48 local unresolved special source associations (61 raw, including 13 policy exclusions). City events contain 189 records after merging two duplicates.

## Source conflict and remaining gaps

The web retrieval of [Glitter Bean contact](https://www.glitterbeancafe.com/contact) returned cached cafe identity, address and social-link evidence. The later bounded direct collector request on 2026-10-06 returned a cross-entity redirect; the guarded collector stopped before fetching the destination. Independent parent research corroborated the gambling redirect. Both observations are preserved here; cached evidence does not establish current ownership. The entire candidate domain remains quarantined. No further request to it or the gambling domains is authorized by this checkpoint.

[India Paradise Halifax downtown](https://www.indiaparadise.ca/halifax/downtown/home) supports the 1537 Barrington identity and local profiles. Its old news and the [food page](https://www.indiaparadise.ca/halifax/downtown/food) are not newly verified offers. A food-menu parser, explicit dietary booleans, menu-date missingness, and independently current offer observation remain follow-on work. The new collector hashing support will apply on the next permitted observation; historical records without source hashes stay missing.

The 564 status/568 Explore discrepancy was diagnosed without inventing counts: deployment/coverage reports merge an exported catalog plus the 12-record static discovery layer; the UI loads 18 discovery records after six manual supplements and excludes one archived place. Export/UI name normalization also differs for Bicycle Thief and Press Gang. The browser artifact records exact UI-only and catalog-only IDs. A trial normalization alignment exposed orphan source IDs, so it was reverted. Full canonical ID reconciliation, shared counting code and report refresh remain pending.

No API credentials were sought. Facebook/Instagram post coverage remains explicitly unavailable; profile navigation is not complete post coverage. Further lawful first-party candidates from parent research are Bearly's normal calendar HTML, Downtown Dartmouth Food Crawl, Pacifico and Doolittle's. They were not enabled or fetched by this patch. Bearly's `?format=ical` and `?format=json` are disallowed; time conflicts stay review-only. Robots wildcard/query correctness needs tests before expansion. Discover Halifax republication restrictions exclude it as an automatic publication fallback.

Remaining independent review items: generic media provenance/licensing and owner media fields; missing link-health incorrectly shown as zero/fresh; immutable tested deployment artifacts; full-catalog lifecycle audit; eager payload size. These are not resolved or claimed as validated here.

Publication approval has since been granted for a repair branch and draft PR only. Publication remains on hold until the independent audit completes; merge and deployment are not approved.

## Independent-review correction

The original `2183ec7` commit had a startup regression: its HTTP-only source guard also ran in the trusted local catalog loader. The network-disabled startup test reproduced the null catalog crash at line 28 with zero requests. The repaired loader accepts only the two explicit local catalog file URLs and throws for any other local script; external protocols and quarantine rules are unchanged. The same test now starts the actual collector in an isolated fixture, records stubbed robots/menu requests, verifies one retained menu, and proves unsafe-domain and untrusted file URLs were never fetched. The test is wired into Quality Gate, but no remote workflow was dispatched.

The earlier review bundle is retained as negative evidence. The revised bundle includes raw commit bytes, full tree manifests, canonical Git archives, and a Git bundle for exact-object verification.
