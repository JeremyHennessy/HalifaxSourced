# Regional news and source operations

## Delivered scope

- `#news` is a separate, URL-filtered news/notices view. It does not change restaurant search or the five mobile tabs; mobile navigation exposes it through More.
- `#admin/status` adds a searchable, paginated source catalogue built from committed registries and evidence. This is a public, sanitized release snapshot, not a private administration backend or a live run monitor.
- The initial published news selection contains three manually reviewed Nova Scotia government links with original factual annotations. They are labelled official announcements, not independent journalism. Calendar-only publication evidence stays at day precision.
- Global Halifax RSS is admitted for metadata **preview** collection only after a guarded access/schema/date probe. Its article bodies, feed descriptions and photographs are never imported for publication. Other proposed feeds remain disabled.
- Existing restaurant, specials and event collection schedules remain unchanged. One separately evidenced Highwayman sangria-pitcher offer was added; unresolved opening leads remain held.

## Deterministic flow (no AI/model/API-key dependency)

1. Read the reviewed source registry and access holds.
2. Check source/cache state before issuing a bounded request. Respect robots, exact access holds, host/redirect limits and deadlines.
3. Parse only the permitted feed fields. Reject invalid XML, calendar dates, unsafe URLs and over-limit bodies.
4. Normalize identifiers and preserve publication, modification, observation, attempt and success clocks separately.
5. Compare candidates and retain observations unchanged when content is unchanged. Conditional requests support ETag/Last-Modified and HTTP 304.
6. Keep candidates and diagnostics under `artifacts/`, never under deployed `data/` or `docs/`.
7. Explicit approved decisions generate the accepted JSON/browser pair. Failed collection cannot delete that pair.
8. Run offline checks and the full existing release/browser gates before publication.

No unchanged receipt causes an automatic content commit or deployment. AI is for source onboarding, parser repair and ambiguous evidence, not routine polling.

## Commands and publication boundary

```sh
node scripts/test-regional-news.mjs
node scripts/build-regional-news.mjs
node scripts/check-news.mjs
node scripts/test-news-ui.mjs
node scripts/build-source-catalog.mjs
node scripts/test-source-catalog.mjs
```

`import-regional-news.mjs` writes review-only cache/candidates, not accepted data. Review decisions are in `data/reviewed-news-decisions.json`. Source admission is in `data/news-source-registry.json`. An admitted manual source can remain collection-disabled and still support reviewed published links.

Do not put credentials, full article bodies, private diagnostics or unreviewed candidate text in deployed trees. The release builder copies `data/` and `docs/`.

## Scheduling and retry limits

Existing UTC schedules: city events every six hours at minute 23; public social 08:41 daily; source expansion 09:17 daily; restaurant discovery 10:43 daily; structured place facts Tuesday 11:29; structured specials Wednesday 11:37; content audit Wednesday 12:17. These are scheduled preview/review lanes, not promises of successful collection or direct automatic publication.

The new Regional News Preview remains **manual**, default-branch-only, serialized and bounded to ten minutes. It uses existing GitHub authentication for dispatch and no contents-write permission. Its explicit first-ever run may initialize an empty review cache only when requested; later missing/corrupt caches stop all network requests. Initialization cannot clear a retained hold.

Six-hour unattended news collection is deliberately not enabled yet. GitHub cache eviction or a terminated runner can lose a newly observed access restriction before cache save. Activation requires a durable pre-request/final-receipt mechanism that fails closed after interruptions, and a tested source-specific release policy. A cache hit alone is not proof of that guarantee.

GitHub workflow links are not permission to retry a restricted source. New paid services, secrets or broader access are not part of this implementation.

## Events: preserve, do not silently remove

The library adapter now accepts only qualified publisher event-detail links inside bounded cards. Navigation headings must not borrow dates or venues from an adjacent event. Unknown markup is surfaced in count-only diagnostics. The existing source-drift and identity guards remain authoritative.

Failed previews retain the last produced candidate snapshot as a separate diagnostic artifact. This does not authorize deleting any of the held accepted events. Earlier 143-record research found 83 suspicious Library Store links; later omissions require their own reconciliation and are not automatically the same set.

## Follow-up gates

- Verify live collection and publisher reuse conditions separately for each new source.
- Expand geographic coverage only from story evidence, never publisher headquarters.
- Keep corrections/withdrawals explicit; do not refresh old publication dates.
- Keep allegations and uncertain content in review. Do not infer factual certainty from publication in a feed.
- Add an authenticated backend only if actual write controls are needed; a static-page password is not protection.
- Independently verify the exact merged commit, required checks and deployed artifacts before claiming a release is live.

## Local discovery home follow-up

The home page now links directly to Today, This weekend, Music & shows, Markets, Festivals, Restaurants, Specials and Local news. It reuses existing date/category filters rather than promising a new live search service. The compact news section shows up to three approved items, retaining publisher, source type, region and original publication date.

One manually reviewed CityNews Halifax link brings the accepted selection to four items. CityNews collection remains disabled with no feed configured. Its observation timestamp is explicitly the upper bound of the evidenced six-second observation window in committed admission provenance, not a claimed exact fetch time.

A reviewed correction protects the exact November 2 Carleton-listed AfterWords occurrence from inheriting the wrong venue when imported later: it belongs at The Stardust Bar + Kitchen. This guard creates no event and requires the exact source ID, source kind, URL and occurrence times; UTC times are derived using the existing Halifax local-time policy. It removes inherited Carleton identifiers and coordinates. Other missing event candidates and unverified market occurrences remain unpublished.
