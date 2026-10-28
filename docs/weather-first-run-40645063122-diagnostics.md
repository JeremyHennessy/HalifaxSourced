# First ECCC manual run: rejected response and preserved hold

Reviewed offline on 2026-10-28. No source retry, workflow dispatch, cache reset, source activation, promotion or deployment was performed for this investigation.

## Evidence and exact limit of diagnosis

The first manual workflow run `40645063122`, run number 1 / attempt 1 at source SHA `2af4b308391a6696b02208bd7afdc07b093d3135`, durably completed its private cache/final-receipt chain. **Source collection failed.** The journal records:

- request started `2026-10-28T06:38:27.184Z`;
- HTTP 200 headers observed `2026-10-28T06:38:27.499Z`;
- semantic failure completed `2026-10-28T06:38:27.502Z`;
- reason `ERR_ASSERTION: future source clock`.

The published-preview and review payload copies both retain the original accepted capture `da7ea2b8dcc69ad149f64034d5eb755f0414e41b5f94c359ad37ea8a168cc488`. Its 64,781-byte source body is SHA-256 `448b6c163d4a8083f17adecb6620c82ba5b6fa52c61844c999ea349abb374ccb`, retrieved at `2026-10-28T00:43:33.585Z`. The failed payload is `blocked:true`, `decision:"collected"`, `lastAttempt.status:"failed"`; the misleading decision name did not indicate acceptance of new facts.

The old adapter read a complete response into memory, then projected it before returning or writing its body receipt. A projection exception discarded that response and returned only the prior accepted capture. The failure journal retained HTTP status and header clock, **not the offending field/value, rejected body, or its hash**. No rejected response bytes occur in the supplied review/publication artifacts; the workflow caches only the retained payload and final receipt. No retained copy of the rejected body is known. A later source request would be new evidence, not recovery of these missing bytes.

The precise clock cause therefore **cannot be established from this run**. The failing message can originate only from acquisition clocks, collection response generation, per-record source updates, station observation time, regional forecast issuance or hourly-product issuance. The array's hourly forecast `timestamp` / projected `validAt` values are separately permitted to be in the future and do not emit this message. There is no evidence supporting relaxation of future-issued/observed guards, tolerance for assumed server skew, or reinterpretation of product timestamps.

## Narrow correction

1. Every existing future-source-clock guard remains strict, including a one-millisecond future value. Errors now identify the exact static source path and role, value, receipt retrieval time and positive millisecond difference. No clock is rewritten or tolerated.
2. A fully read bounded HTTP 200 JSON response is durably retained **before UTF-8 decoding or semantic projection**, at `artifacts/eccc-weather-review-journal.jsonl.response.json`. The exclusive, fsync-backed file contains exact fetch body bytes as base64 (before character decoding, not raw HTTP wire bytes) plus the bounded receipt and an explicit `semanticAcceptance:false` marker. UTF-8 errors and a source BOM remain inspectable without silently normalizing bytes. Content-Encoding and Content-Length provenance are retained; automatic HTTP decompression is not mislabelled as original wire bytes. Incomplete/oversize bodies are not labelled complete. Failure to retain evidence prevents success; existing evidence cannot be overwritten or used to authorize another request.
3. The response sidecar is uploaded only with nonpublishable review evidence. It is not a cache reset, accepted capture, publication input or browser asset. No cookies or credentials are included; selected provenance headers only. It adds at most one bounded response per run.
4. New source failures use `decision:"rejected"`. Legacy blocked `collected` payloads remain valid **private continuity state**, so the actual run's original payload/final hashes remain untouched. A successor continues to carry its hold without source requests.
5. Both normal publication gates now require `blocked:false` and a matching `success/collected` or `not_modified/not_modified` outcome. Failed/held/partial/pending artifacts—including legacy `collected` failures—cannot be packaged or accepted by the promoter. Any future public health-only update needs a separately reviewed contract, not a disguised successful refresh.
6. After final-receipt verification, the workflow writes a separate source-outcome artifact and job summary. It explicitly distinguishes successful private state persistence from rejected source collection, accepted new capture, conditional revalidation and publication eligibility.

## Verification and recovery boundary

Offline tests cover all 11 guarded source-clock sites, genuinely future hourly valid times, exact rejected-byte retention, UTF-8/BOM handling, incomplete responses, evidence-write failure, immutable evidence, both publication gates, original failed-cache compatibility and zero-request held successors. Existing source, schema, lineage, journal, publication, isolation and access-hold gates remain in place.

This change does not repair or reopen run 1. Its failed state remains blocked. Exact reviewed recovery is still required before any new source request; no recovery/reset input or automatic retry is added. The diagnostic change improves the next **separately authorized** acquisition's evidence, not the completeness of the already-lost response.
