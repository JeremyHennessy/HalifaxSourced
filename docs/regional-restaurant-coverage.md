# Regional restaurant coverage

Reviewed 2026-10-21. This is a bounded, source-reviewed expansion, not an exhaustive census.

63 reviewed regional locations are represented; the canonical catalog has 640 locations, compared with 578 before this batch. 1 new location is closed for the season, not permanently closed. No new coordinates or hours were guessed.

## Accepted locations by community

- Beaver Bank: 1
- Bedford: 15
- Cole Harbour: 2
- Dartmouth: 1
- Eastern Passage: 1
- Fall River: 2
- Glen Haven: 1
- Grand Desert: 1
- Halifax / Fairview: 1
- Hammonds Plains: 6
- Hatchet Lake: 2
- Herring Cove: 1
- Hubbards: 2
- Indian Harbour: 1
- Lawrencetown: 1
- Lower Sackville: 6
- Middle Sackville: 2
- Musquodoboit Harbour: 2
- Peggy's Cove: 3
- Porters Lake: 1
- Sheet Harbour: 1
- South End: 1
- Tantallon: 1
- Timberlea: 1
- Upper Tantallon: 3
- Wellington: 1
- West Bedford: 2
- West Petpeswick / Musquodoboit Harbour: 1

## Existing source queue

All 769 directory observations were reconciled, not automatically published. These are observations, not unique restaurants.

- unreviewed_ownership_operation_or_location: 534
- canonical_location_present: 39
- held_reviewed_evidence: 9
- held_location_identity: 88
- excluded_non_local_policy: 99

## What remains

43 reviewed hold entries retain source-specific uncertainty. In particular, inland Musquodoboit Valley, Waverley proper and the airport/northern boundary still need exact-location, ownership or current-operation evidence. Morris East Bedford is not duplicated or relocated from proximity alone. Watermark is independently verified at the former Rhubarb site; the former operators' Hazel's is a separate Liverpool business. No old Rhubarb menu, hours, images or identity are transferred.

All 16 HRM district audit lanes and their practical subcommunity checklists remain partial. Existing neighborhood labels understate rural coverage, so zero accepted additions in an area is not proof that no restaurant is present there. Nearby Hubbards is included as a labeled surrounding community, not automatically assigned to HRM.

- OpenStreetMap: Existing snapshot limited to small core bounding box. Governed named-area or tiled-HRM discovery with original attribution and rate/robots restrictions; do not retry known Overpass denial without new permission/evidence.
- NS food inspections: Only Halifax,Dartmouth,Bedford queried. Expand explicit locality search manifest with source result counts and as-of timestamps; retain old snapshots on partial source failures. Facilities include non-restaurants, so classification/manual review remains necessary.
- Tourism Nova Scotia: Importer filters Region=Halifax Metro and bounded pages. Consider HRM portions of Eastern Shore/South Shore and source exhaustion marker; filter by verified municipality/community evidence, not tourism region alone.
- RANS: Search community list has only 12 terms. Expand exact HRM locality vocabulary and reject corrupted address parser outputs. Existing records contain narrative fragments in civic fields.
- Taste of Nova Scotia: HRM allowlist only 14 terms. Add boundary-confirmed rural communities and review each owner location.
- Sackville BIA: Current directory and old feature guide disagree. Use current detail + owner evidence. Guide still contains legacy COVID language and old tenants; never publish wholesale.
- Blocked sources: YellowPages disabled 403; HappyCow/Yelp not approved adapters; Discover Halifax adapter pending. Preserve disabled state. Manual permitted tourism/editorial pages can support a specific review, not silently activate a bulk adapter.

## Evidence and maintenance

All 63 regional locations have per-field dispositions in [the enrichment ledger](../data/reviewed-regional-enrichment.json), with successful direct source receipts for published additions. Service-specific hours are labeled and uncertain fields remain unknown. Location-specific sources and field caveats are retained in [the reviewed batch](../data/reviewed-regional-restaurants.json). The [source matrix](../data/regional-restaurant-coverage.json) defines the finite audit baseline and residual source work. The [full reconciliation report](../data/build/regional-restaurant-coverage-report.json) accounts for every directory observation. Names, shared websites and shared building numbers are not sufficient to merge restaurants; ambiguous cases stay in review.
