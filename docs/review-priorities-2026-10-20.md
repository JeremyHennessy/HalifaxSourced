# Reviewed site improvements, 20 October 2026

## Scope and evidence

This bounded release addresses the six site-review priorities. It is not an exhaustive census, a guarantee of current operation at every venue, or a grant to reuse photographs. The retained source-expansion PR remains separate; no broad candidate payload was promoted.

1. Discovery filters, sorting and pagination round-trip through the URL. Global search starts a new unfiltered search; Clear removes URL filters. Saved places remain reachable on desktop, tablet and mobile. Explore/map handoffs retain the selected filters.
2. All 47 regional locations have a five-field disposition in `data/reviewed-regional-enrichment.json`. Direct-source evidence supports 18 exact map coordinates, 15 scoped weekly schedules, 19 menu destinations, 32 verified phone values (13 previously missing), and 34 contact routes. Held, blocked and unknown fields preserve prior facts. Menu landing-page verification does not imply dishes or prices were transcribed. Pickup, kitchen and taproom schedules remain distinguished. Margaret's season ends October 25; Tuna Blue remains seasonally closed.
3. All 11 canonical structured-hours records were reviewed: seven corrected schedules and four holds/removals, with two noncanonical chains still excluded. Unlisted days remain unknown, midnight service carries correctly, and business hours are not unioned with overlapping pickup hours. Exact-location conflicts are rejected. Hours have their own verification timestamp, without refreshing unrelated facts. A bounded 32-offer refresh covers HUX, Highwayman, Rush Hour and Look Ho Ho; one no-longer-observed Rush Hour offer is retained in history, not assigned an invented expiration. Specials display individual offers, their own source links and accurate counts.
4. Coverage uses explicit-null end-date fallback and both coordinate field conventions, while missing coordinates remain missing. Fact counters are computed after reviewed field handling. SQLite has a versioned partial-export contract; it is not suitable as a complete current-hours, lifecycle, city-event or offer mirror.
5. Thumbnail review separates a source-backed review preview, successful visual inspection, and existing documented publication permission. No missing or failed preview can be visually accepted. An official-source URL never creates permission or a rights basis; legacy local approvals cannot manufacture a publishable media export.
6. Home event cards prefer the same precise event URL as Events. Filtered-empty calendar copy does not imply no data is loaded; the calendar is labeled as a non-interactive month summary. Routes have meaningful titles, and exact duplicated event-title halves are collapsed for display without changing event identities or calendar timing.

## Verification

Regression coverage includes URL round-trip/reset/reload/back/forward, five responsive widths, per-offer rendering with two offers at one restaurant, preview and rights separation using the real permission predicate, null-ended events, coordinate forms, partial-day and overnight hours, exact-location safeguards, catalog identities and unknown scores, source-history retention, and the pre-existing SVG map lifecycle tests. The release gate rebuilds accepted data without collecting sources and verifies immutable deployment receipts. The final pull-request receipt is the authority for exact-head CI, screenshots and served deployment verification.

## Remaining limits

Source denials, unavailable content, shared-brand ambiguity, contradictory schedules and missing coordinates remain explicit in the per-field ledger. No business was contacted, no paid source or new credentials were added, no image rights were inferred, and no fixed desktop/tablet/mobile banner asset was replaced.
