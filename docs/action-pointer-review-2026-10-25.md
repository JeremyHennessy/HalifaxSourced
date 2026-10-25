# Existing action-pointer policy enforcement — 25 October 2026

This code-only review closes a consumer-policy gap; it neither verifies a new
source nor changes the existing restaurant/kind/URL rejection decisions.

## Established defect

Sushi Nami Bayers Lake (`osm-node-11552234300-sushi-nami-royale`, 201 Chain Lake
Drive) retained `https://sushinami.ca/downtown-halifax/take-out/` as its first
ordering action. The existing `pointerSafe` policy already rejects that known
other-branch destination. Final lifecycle filtering removed it from related
links, but not from the historical ordering array, and the detail CTA used only
URL safety. The wrong-branch Order button therefore survived.

Two other rejected first ordering pointers left false availability flags:

- Brawta (`osm-node-7465111619-brawta-jamaican-jerk-joint`): the already rejected
  `https://brawta-by-grafton.square.site/`.
- Downtown Pizza (`osm-node-4797459277-downtown-pizza`): the already rejected
  `https://www.restaurantlogin.com/api/fb/6qxm_n`.

Their later array entries are respectively a generic Uber Eats homepage and an
ordering link labelled Woodside. Removing the first entry and selecting the next
would be a new, unsupported primary-action promotion. This change does not do so.

## Consumer contract

Raw action arrays, order, source payloads, source clocks and historical evidence
remain unchanged. The shared primary-action helper checks only the original
first entry against the existing location/kind/URL policy. Rejection yields no
primary CTA; it never selects a runner-up. Public action flags, filter membership,
action search terms and mobile/sidebar CTAs use that same decision. Valid first
actions retain permitted secondary search evidence; raw structured provider
terms survive first-party deduplication when their action remains eligible.

Reservation capability and reservation links are not identical. Existing
keyword-only reservation flags with no action array retain their prior meaning.
A supplied but rejected primary cannot use a stale boolean or raw array length
to restore link-derived availability. No current assembled reservation primary
is rejected by this release. Independently listed descriptive source keywords
are not globally removed, and existing related/source evidence links are not
promoted into new primary actions.

The two coverage builders retain their existing source-evidence unions and
historical/active denominator semantics, but exclude rejected assembled ordering
primaries. Structured history cannot re-add those IDs. Raw structured-layer
counts remain evidence counts. Reservation source-coverage semantics are unchanged.

## Fixed-snapshot verification

On base `a358876c9bf3ff8732116e7be3aace8990dbc141`, the actual browser script order
has 654 identities. Exactly the three ordering flags above change, 62 to 59; all
651 other complete restaurant projections are identical. Reservation flags stay
97, including all 42 keyword-only capabilities. Every raw source payload and
observation clock is unchanged. Fresh catalog report ordering coverage changes
64 to 61; reservation source coverage stays 57, intentionally distinct from the
browser's keyword-inclusive and active flags.

Offline regressions cover exact entity/kind/URL scope, valid-first retention,
blocked-first/allowed-second behavior, malformed inputs, original evidence/order,
provider-search retention, public filters/counts, actual detail rendering,
reservation fixtures, repeated lifecycle application, and real base/structured
report execution. Hosted browser regression covers 390, 900 and 1440 pixel widths,
Back/Forward, reload, valid Downtown versus rejected Bayers use of the same URL,
mobile/sidebar CTA absence, overflow and page errors. It never clicks an external
action. Hosted success is required before merge; syntax checks are not browser QA.

No collection, new source policy, source hold removal, location/contact correction,
menu/offer promotion, CSS/media change or thumbnail approval is included.

## Separate unresolved review finding

The Queen Street Sushi Nami phone filled by the accepted reviewed resolution
(`902-422-1636`, original location-specific observation 2026-08-29) is later
replaced by a generic-site structured extraction (`+19024229020`, original
2026-09-04 observation). This review does not establish current phone ownership,
assign that generic number to another branch, or change either phone/source clock.
That factual conflict remains separate from the established action-policy defect.
