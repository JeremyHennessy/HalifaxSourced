# One reviewed ECCC acquisition after run 40645063122 — preparation only

This is a narrowly scoped, one-use review of a known HTTP 200 local semantic rejection, **not** an exception to publisher access restrictions. No acquisition, dispatch, cache reset or publication is performed by this change. The diagnostic/publication correction was reviewed separately at local `4d117d3` / tree `76677b77075dd7276fdb8e84328ddbe168190a7e` and merged as remote main `a6ea15e58ecb1625fa46e4dae1261b7257c0f1b2`.

## Exact reviewed evidence

`weather-evidence/recoveries/eccc-40645063122/` preserves the original failed payload, paired final receipt and journal byte-for-byte. These are also required from the exact original workflow caches; the checked-in copies are **never a missing-cache fallback**.

- Original run: `40645063122`, workflow `399017463`, run number 1, attempt 1, manual event, main SHA `2af4b308391a6696b02208bd7afdc07b093d3135`.
- Payload SHA-256: `8f1d941299b710244387af37cf1678e06e77c0544f8b8eed6035fde34a6e45b1`.
- Paired final receipt SHA-256: `bd2c5136c2f86ee6b661085a0352784a42d1d7c75d40aa2f848debf68cd3bfcc`.
- Journal SHA-256: `6db258c2103f3e7dab7115a6b8e735fa3462a669feae0303fa697ec814136e66`.
- Exact failure: `ERR_ASSERTION: future source clock`, after HTTP 200 at `2026-10-28T06:38:27.499Z`; failure completed at `06:38:27.502Z`.
- Earliest new request: `2026-10-28T07:33:27.502Z`. Grant expires at `2026-10-29T00:00:00.000Z`; expiry is rechecked immediately before transport.

The rejected HTTP response itself was not retained by the old code. Preserving the failed **payload** does not recover those lost response bytes or identify the offending source clock. No future clock tolerance or reinterpretation is introduced.

## Scope and one-use consumption

The only selectable grant is `eccc-40645063122-http200-clock-review-1`; the manual workflow defaults to `none`. The ordinary exact-run lineage resolver must establish the immediate successor **run number 2, attempt 1, manual event, on the public default branch**, with the exact original predecessor. A rerun, intervening run, schedule, missing cache, cancelled/failed workflow predecessor or mismatched digest cannot use it. No generic reset, alternative endpoint, provider or automatic retry exists.

Before any source operation:

1. Restore and verify the original paired payload/final cache through the unchanged exact-key gates.
2. Confirm the fixed one-use consumption cache does not already exist. Missing/ambiguous lookup evidence is not permission to proceed; a cache loss cannot authorize another run because only this one run/attempt identity qualifies.
3. Bind the exact descriptor, currently verified workflow identity, runtime code digest and immutable originals into an exclusive fsync-backed reservation. Copy the original payload/final/journal unchanged into review evidence. A partial or existing reservation is never deleted/replaced.
4. Save the reservation to its fixed one-use cache, then restore its actual bytes—not a lookup-only check. Compare them with the independently retained local reservation digest, descriptor digest, current identity and original evidence hashes.
5. Create an exclusive durable consumption record and an opaque in-process capability. The adapter accepts it only for the exact original failed envelope, consumes it once, and permits at most one guarded request to the unchanged ECCC city-page endpoint. A second call or expiry before transport stops without a request.

The source registry, access policy, quarantine, future-issued/observed guards, byte/deadline limits and retained-body diagnostics remain authoritative. A source access/robots restriction, 401/403/429, timeout, unknown transport, missing evidence or cancellation cannot be cleared by this grant. There is no global hold mutation. Newly encountered failure/uncertainty remains blocked and cannot loop through the grant. Current runtime access restrictions are checked at reservation, authorization and transport in addition to the ordinary every-hop fetch guard.

The new payload retains the descriptor/consumption hashes, original hashes and consuming workflow identity as immutable recovery history. A failed successor carries that history forward and makes no new source request. A successful response still requires the normal separate weather publication review and full gates; recovery never deploys directly. Original cache keys and evidence are untouched.

## Non-self-referential code approval

The checked-in descriptor contains a digest of **every tracked file except the descriptor itself**. Executable files under `data/` are included; no broad data-directory exclusion is used. Its exact schema and all grant identities, hashes, endpoint, reason and time bounds are separately fixed in code. The descriptor must retain its canonical bytes on the tested commit. Runtime also requires a clean tracked checkout and exact agreement between local HEAD, the workflow environment SHA and official run metadata.

The descriptor is excluded only to avoid a circular digest. It is not a runtime caller argument and cannot be regenerated by the workflow. Parent review must independently approve both final descriptor SHA and runtime digest on the exact tested main. If another component is combined into the tree, recompute the descriptor **offline in the new reviewed release**, rerun tests and obtain exact-tree review; an old descriptor must fail closed. No SHA for an as-yet-uncreated deployment is invented.

## Execution boundary

Preparation and tests make zero external requests. Only after the parent verifies the exact tested recovery release on main and independently accepts the final descriptor may it manually select the specific grant, with bootstrap initialization false. The approved time window alone is not activation. The reviewed parent will inspect the new raw diagnostic response, final cache continuity and publication eligibility before any separate promotion.

Do not dispatch another workflow merely to inspect this grant: an intervening run consumes the unique run-number opportunity. Do not change a cache key, directory, descriptor, original evidence or run attempt to regain it after failure. Any unresolved reservation, failed persistence or failed new acquisition requires a new independent review; this implementation provides no reset path.
