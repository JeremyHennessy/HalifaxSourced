# Pier 21 parser research checklist

This prototype is research-only. `scripts/research/pier21-parser-prototype.mjs` is deliberately unregistered and accepts bounded field records supplied by a caller. It does not fetch pages, read source registries, create schedules, dispatch workflows, or write event data. Its offline test uses synthetic records plus one minimal factual sample attributed to its official detail URL.

## Before any activation review

- Review Pier 21's current robots policy and terms for the exact proposed retrieval method and cadence. The prior bounded reader observation does not establish collector permission; robots and terms remain unverified.
- Obtain and record a clear factual-metadata reuse basis. No descriptions, images, logos, page bodies, or third-party content are in scope.
- Reconfirm an official page structure and date/time/location/cost/status fields using an authorized method. Verify that links remain on `pier21.ca` and preserve provenance for every extracted field.
- Have a reviewer inspect date parsing, Atlantic timezone conversion including DST folds and gaps, status handling, unknown ends, recurring items, multiple venues, address qualification, input bounds, and duplicate conflict quarantine against new authorized offline fixtures.
- Keep the candidate disabled until a separate approved change explicitly covers registry integration, collection controls, event review, and publication. This prototype itself is not an activation mechanism.

## Current boundaries

- The existing onboarding candidate `pier21-events` remains disabled and held for review; the event registry is unchanged.
- Do not infer occurrences from “twice monthly, year-round.” Keep a rescheduled status and a missing end time as observed; do not choose one venue from a multi-venue listing.
- Keep unrecognized status labels unknown. Quarantine every record in a conflicting duplicate group, independent of input order; collapse only equivalent records while retaining canonical provenance URLs.
- A changed start time or venue creates a different occurrence identity. Without an explicit occurrence/replacement identifier, keep both candidates and emit a same-source/same-title review warning; do not infer replacement. Bare `pier21.ca` and `www.pier21.ca` remain separate hosts because alias equivalence is unverified.
- Convert local times with the IANA `America/Halifax` zone. Reject ambiguous fall-back wall times and nonexistent spring-forward wall times rather than choosing an instant.
- Canonicalize official source URLs by removing fragments and known tracking parameters (`utm_*`, `fbclid`, `gclid`) while retaining meaningful query parameters. Nondefault HTTPS ports are rejected; source-page identity remains part of event identity.
- Reject non-plain records, non-string fact fields, and inputs above the prototype's documented count and field-length bounds. Provenance field lists should include only values actually supplied.
- Attach 1055 Marginal Road only when a future authorized source observation explicitly associates that address with the event.
- No Pier 21 network request, page refresh, source activation, event promotion, schedule, or workflow dispatch was performed for this prototype.

Run the local offline regression with:

```sh
node scripts/test-pier21-parser-prototype.mjs
```
