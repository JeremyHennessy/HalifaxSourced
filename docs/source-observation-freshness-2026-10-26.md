# Source-observation freshness — 26 October 2026

## Defect and bounded scope

Explore's fresh-source ordering and Home's source cards used the raw official
fetch `observedAt` even when that record was a failed attempt. They also preferred
that clock over newer accepted evidence and fell back to import `freshnessDate`.
The coverage report already distinguished unsuccessful official attempts from
successful observations and excluded import clocks. The browser therefore told a
different source-freshness story from the report for the same accepted data.

This code-only change shares a read-only source-observation selector between
coverage and browser consumers. It does not collect, verify, refresh or rewrite
any source. It changes no restaurant facts, identities, lifecycle flags, source
associations, access holds, action decisions, source clocks, media or CSS.

## Evidence contract

The selector uses the existing coverage evidence families: explicit source
observation, reviewed location resolution, accepted lifecycle evidence, canonical
source observations, verified first-party discovery and successful official-site
observations. It takes the newest valid non-future observation and normalizes its
representation only in the returned value. No source object is mutated.

Official evidence requires an integer 2xx HTTP receipt with no error or
contradictory root attempt/held/restricted marker. Redirect-only status does not
prove a content observation. First-party discovery requires the exact restaurant
identity and verified state. Nested evidence may not explicitly name another
restaurant or carry failed/restricted/rejected/held markers. Legacy accepted
canonical source entries without optional markers remain evidence. An access
restriction on a later, separate `latestAssessment` does not invalidate or
restamp a genuine prior success; root restrictions remain ineligible.

Browser recency groups all original official and first-party rows by exact identity,
independently of legacy last/first detail-row selection. Duplicate rows cannot hide
older success or make the answer depend on input order; raw detail selection remains
unchanged.

Unknown, malformed and future dates remain undated. Import `freshnessDate`,
`generatedAt`, `reviewedAt`, `lastVerifiedAt` and assessment/attempt timestamps do
not provide source freshness. Existing historical lifecycle `verifiedAt` remains
its established fallback when no observation field exists. No new date family is
introduced.

Explore and Home source cards use the same selector. Unknown Home dates say
“Date unavailable,” never “Recent” or an epoch date. Event-source cards show
OBSERVED only for their own qualifying official-site clock, otherwise
UNDATED/SOURCE; an unrelated source observation cannot date that event lead.
The separate New/opening section retains its existing discovery-date ranking and
membership; only its optional official-clock fallback is qualified.

## Fixed-snapshot effect

Compared with main `51e2f60c2e8e83b49b55c28954ad78188588aead` (including concurrent
custodian #219), at `2026-10-26T00:00:00Z`:

- All **654** complete restaurant projections and all **641** active identities
  are identical before and after. Raw evidence and observation clocks are unchanged.
- **47** active failed official attempts cease to supply freshness; **38** have no
  independent dated evidence. The other nine retain their genuine accepted dates.
- **352** records remain correctly undated instead of borrowing import timestamps.
- **629** restaurant source-stamp selections differ semantically; the other 25
  retain the same instant. All 641 fresh-sort positions change, without changing
  membership, recommendation scores or the default recommended ordering.
- Freshness coverage is unchanged: **112** under seven days, **14** at 7–30 days,
  **176** at 30–90 days, **0** over 90 days, and **352** unknown. The complete
  independently rebuilt report differs only in its generation metadata.
- The New/opening top-four ordering remains unchanged.

Home source cards retain the existing candidate pool. They change from Lake City
Cider, Side Hustle, Oxalis and The Canteen (September 4 discovery clocks) to:

| Restaurant | Existing accepted observation | Existing source |
| --- | --- | --- |
| Battery Park | October 25, 17:13:47 UTC | `https://batterypark.ca/` |
| Café Marco Polo | October 25, 12:19:32 UTC | `https://cafemarcopolodartmouth.com/` |
| Humble Pie | October 25, 10:50:41 UTC | `https://humblepiekitchen.ca/` |
| Revana Dartmouth | October 24, 08:51:37 UTC | `https://dartmouth.revanapizza.ca/` |

These are already accepted source observations, not new research. Café Marco
Polo's failed September 4 fetch no longer masks its accepted October 25 evidence.
Dharma's failed clock becomes unknown; Dartmouth Krave retains its genuine
September 1 first-party observation instead of its failed September 4 attempt.

Queen Street Sushi Nami's October 25 phone-retention review does **not** become an
October source observation. Its correction keeps the original August 29 clock;
its latest independent source observation remains September 4, 13:33:35.848 UTC.
The explicitly failed Manilla website and restricted Ilai social receipt cannot
supply freshness, while their separate accepted directory evidence survives.

## Verification boundary

Offline tests cover hostile HTTP/clock/state inputs, identity scope, independent
accepted sources, retained old success after a held refresh, original clocks,
complete runtime ordering, report execution and all-record immutability. The
release isolation test executes all 44 offline build/check commands twice,
requiring identical outputs and no source transport.

The new hosted navigation regression covers 390, 900 and 1440 pixel widths,
Explore/Home ordering and labels, Back/Forward/reload, unknown/failed/future and
retained-evidence fixtures, overflow and raw-data immutability, using offline
resource fixtures. Hosted exact-head/main Quality and gated deployment acceptance
are required separately. No local Chromium or blocked-source retry is part of
this offline evidence review.
