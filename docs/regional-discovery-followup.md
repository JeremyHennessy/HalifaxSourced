# Regional discovery and source receipt follow-up

Reviewed against main `879a4fb72bee1a6091ad1b85a6d42c3753fae745` on 2026-10-21. This is not a complete restaurant census.

## Discovery footprint

`data/regional-discovery-scope.json` makes the missing Bedford / West Bedford and Hammonds / Upper Hammonds / Pockwock envelopes explicit. They are planned search windows, not municipal boundaries or collected records. Run `node scripts/plan-regional-discovery.mjs` to compare each with the actual accepted OSM bounding box and locality-specific inspection receipt counts. The old OSM snapshot still ends at latitude 44.705. Its observation timestamp and every accepted object remain unchanged.

Known Overpass access denial remains blocked. `import-osm-restaurants.mjs --plan` is network-free; ordinary execution fails before any request while that restriction remains. Regional retrieval must also gain an additive, identity-reviewed snapshot merge before it may replace core data. There is no endpoint hopping, wider crawl, or claim that configuration alone fills coverage.

Inspection locality batches contain at most three cities. They explicitly cover the missed target communities and separate northern, eastern and western discovery work. Missing receipts mean “not yet evidenced,” not “no businesses.” The inspection importer accepts NS_FOOD_BATCH=bedford-hammonds (or another manifest batch) and rejects ambiguous selectors or more than three localities. NS_FOOD_CITIES remains available for exact bounded searches. Defaults remain the original three cities; batch enumeration does not itself run or widen scheduled collection. Failed or partial batches preserve the accepted snapshot.

## Collection health

Meta collection now records successful and failed profile attempts individually. Missing credentials record no access and attempted=false. Fresh factual candidates, a successful pull with no changed facts, partial failure, complete failure, and unattempted/unknown collection are distinct from retained record counts and evidence age. Caption/media reuse and Stories access remain unsupported. Configured credentials alone do not prove usable permissions.

The preview workflow writes an explicit collection summary and a `social-collection-health.json` artifact. A green job means the workflow ran, not that Meta posts were received. Published administration shows the outcome of its accepted snapshot only; later previews remain linked separately. Receipt-only repeat pulls do not trigger content publication merely because the changed-candidate count returns to zero.

## Stale preview reconciliation

- Draft 131, head `a0c4f28512269aace14da4c7d7efcd11ed9723e4`, has 173 events. Current accepted data has 172. Its only unmatched ID is `alderney-gate-library-events-ec0ca632d4bf24a5`, preserved as a duplicateEventIds alias of the accepted Meet Juno event. The qualified additions and expiry reconciliation were already accepted in PR134; merging the old full snapshot would reintroduce duplicate/unreviewed derived state. It is superseded, not an unprocessed fresh event feed.
- Draft 122, head `f1af8dc099331a27f0da2528b3c86114c446ea5d`, is an older broad source preview. Its 225 official website result identities are all present in the 290-result accepted snapshot, but it omits 65 accepted identities. Some individual observations may still warrant evidence review; all remain accessible in the preserved PR/branch. Do not equate identity presence with acceptance of every candidate claim. No removals, fresh clocks, media approvals, or facts from this old snapshot are imported wholesale.
- Both drafts are currently conflicting, bot-created previews, not independent active human edits. Preserve branches and discussion history if closing as superseded. Next collection/review starts from current main with bounded source requests and qualified deltas, not blind rebasing of stale generated files.

## Remaining evidence limits

No blocked adapter, credential, permission, image or Story source is enabled. Exact branch identities, known closures, original source clocks and historical aliases remain authoritative. Unresolved hours, menus and pins stay unknown until qualified owner/location evidence exists.

## Bounded evidence review outcome

All 43 unique held identities are explicitly reconciled in `data/regional-held-dispositions.json`, including the 22 Bedford/Hammonds observations from the preceding audit. No new listing met all admission requirements in this pass. HTTP 200 suspended/unavailable pages, wrong-country namesakes and unrendered application shells are not successful business-content evidence. The previous holds and original observation clocks remain available; Tinápe’s remaining blocker is current branch/operation corroboration, not a claim that no local founders are known.

The 13 recently added listings (12 initially missing pins) are checked field-by-field in `data/regional-recent-field-audit.json`. One field improvement is published: Turkuaz's owner-linked structured contact widget explicitly supplies all seven days in 24-hour time. No meridiem or holiday behavior is inferred.

Alexandra’s Hammonds Plains remains without a map pin. Its owner JSON-LD coordinate conflicts by about 3 km with an exact-address directory coordinate. Both pairs are retained only as audit evidence; neither is substituted for the missing verified location. All 12 initial pin gaps remain unpublished. Hours/menu uncertainties elsewhere remain explicit rather than being filled from neighboring branches or old PDFs.

## Safe promotion-lane rotation

The event and source-expansion replacement lanes use `codex/promote-city-events-preview-v2` and `codex/promote-source-expansion-preview-v2`. The social lane is unchanged. Shared policy drives both the planner and publisher; the former event/source branches remain preserved at their exact reviewed heads. A reopened old PR still reserves its lane, and any changed or missing preserved head fails closed for fresh review. Existing ancestry, SHA lease, accepted-source chronology, manual-run and bounded retry safeguards remain in force.

Manual promotion dispatch has a `dry_run` option that runs read-only reconciliation and preserves its plan artifact while skipping the entire mutation job. Verify actual live queue decisions after this configuration reaches tested main before claiming a lane is operational. Rotation is not approval of source facts and does not merge or deploy generated previews.

Closing obsolete drafts 122 and 131 remains pending explicit owner confirmation. They are still open and therefore still reserve the affected lanes, including their replacements. Tested lane configuration alone is not operational recovery.
