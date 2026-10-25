# Queen Street contact retention — 25 October 2026

This is an offline precedence repair, not a new source visit or verification of
current phone ownership. It preserves a previously accepted location review.

## Provenance and observed failure

Canonical ID `osm-node-5161526522-sushi-nami-royale` is Sushi Nami Royale at
1458 Queen Street, Halifax. Its unchanged `data/reviewed-place-resolutions.js`
entry records `902-422-1636`, source `https://sushinami.ca/downtown-halifax/`,
observation **2026-08-29**, `resolved_high`, `resolved-by-evidence`, and explicit
`official_location_contact` / compatible-street-address evidence.

`HalifaxRestaurantIdentity.applyResolution` fills that previously empty phone.
The exported catalog already retains it. In the browser, the later structured
phone display projection replaces it with `+19024229020` from the generic
`https://sushinami.ca/` observation **2026-09-04T13:24:27.324Z**. That structured
record has no address or phone-specific location evidence. Its `verified_source`
state identifies source provenance, not a separately reviewed branch contact.
The saved record does not establish whether the importer obtained the number
from JSON-LD or its first-`tel:` fallback; no extraction path is asserted here.

The same generic value is present in the Bayers Lake / 201 Chain Lake Drive
record (`osm-node-11552234300-sushi-nami-royale`), originally observed
**2026-09-04T13:24:15.452Z**. That repetition does not establish which branch owns
the number. This change neither assigns it elsewhere nor changes that branch.

## Exact correction

One phone-only record in `data/reviewed-restaurant-corrections.js` retains
`902-422-1636` for the exact Queen Street ID. It uses the existing correction
engine and final lifecycle reapplication; no global precedence logic changes.
`sourceUrl` and `observedAt` remain the original accepted location evidence.
`reviewedAt` records this offline retention review, explicitly distinguished by
`reviewBasis: preserve_accepted_location_evidence` and the claim wording. The
existing correction schema's `verified` state means this retention decision was
reviewed; it is not a fresh phone-ownership verification.

| Projection | Before | After |
| --- | --- | --- |
| Queen Street runtime/display phone | `+19024229020` | `902-422-1636` |
| Queen Street exported catalog phone | `902-422-1636` | unchanged |
| Queen Street raw structured phone/date | `+19024229020` / 2026-09-04T13:24:27.324Z | unchanged |
| Queen Street accepted review phone/date | `902-422-1636` / 2026-08-29 | unchanged |
| Bayers Lake entire projection | Existing accepted main projection | unchanged |

All other fields, raw data, reviewed resolutions, source clocks, action arrays,
branch policy, source holds, media, styles and UI code are unchanged. The original
location source is retained; runtime/export add only the explicit correction
provenance alongside the corrected runtime phone. No collector runs, broad data
snapshot is promoted, or held PR #141 material is adopted. PR #217 is untouched.

## Verification contract

`test-queen-street-contact.mjs` compares actual browser script order at a fixed
clock with and without the one correction. Exactly one phone changes among 654
records, with only the expected correction/source provenance addition; all 653
other full restaurant projections and all other raw payloads match exactly. It
checks original observations and repeated lifecycle application, and runs the
real catalog exporter before/after and twice in a network-disabled scratch copy.

`test-queen-street-contact-navigation.mjs` checks mobile essentials and desktop
sidebar phone at 390, 900 and 1440 pixel widths, both branches, Back/Forward and
reload. Its frozen offline-resource gate prevents external requests. It also
checks that #217's existing source/action holds remain effective. Both regressions
are in Quality Gate. Full offline checks, independent review, exact-head hosted
Quality Gate, main Quality Gate, gated deployment and live parity are required
before claiming completion.
