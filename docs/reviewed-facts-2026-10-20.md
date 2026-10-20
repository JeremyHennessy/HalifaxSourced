# Selected owner-verified facts review, 20 October 2026

This bounded batch updates five existing restaurant identities. It does not
approve a wholesale source-preview promotion or infer prices, new identities,
current image permissions, coordinates, or new closure/reopening events.

## Published changes

| Existing identity | Change | Location-specific evidence |
| --- | --- | --- |
| `osm-node-267592027-the-black-sheep` | Address `BH204 – 1496 Lower Water Street, Halifax, NS B3J 1R9`; telephone `902-429-6491`. | [Owner homepage](https://blacksheephalifax.com/) contact block. Existing weekly hours, October 26 Monday revision, and November 14 early closure remain unchanged. |
| `osm-node-11751643550-cafe-lunette` | Address `160-1741 Lower Water Street, Halifax, NS B3J 0J2`; telephone `902-334-1300`; café hours Monday–Thursday 07:30–22:00, Friday 07:30–23:00, Saturday 09:00–23:00, Sunday 09:00–22:00. | [Owner contact page](https://www.cafelunette.com/contact/). These are café hours, not continuous full-menu kitchen service. Existing canonical alias remains unchanged. |
| `osm-node-4797459279-tilted-tap` | Telephone `902-462-5333`, complete civic address, and separately labelled bar/kitchen hours. | [Owner contact page](https://www.tiltedtap.ca/contact) and [homepage](https://www.tiltedtap.ca/) agree. Bar Monday–Tuesday 10:00–23:00 and Wednesday–Sunday 10:00–midnight; kitchen Monday–Wednesday 11:30–21:00, Thursday–Friday 11:30–22:00, Saturday 10:00–22:00, Sunday 10:00–21:00. Retain the noon holiday-opening caveat without inventing dated exceptions. |
| `sushi-square-scotia-square` | [Official lunch/dinner menu](https://sushisquare.ca/menu/) link. | [Owner contact page](https://sushisquare.ca/contact/) identifies 5201 Duke Street and telephone 902-266-6228. The former Sushi Cove remains archived and receives no action links. |
| `retas-gottingen` | [Food menu](https://www.retasrestaurant.com/s/Retas-FOOD-menu-16th-October-2026.pdf) and [drinks menu](https://www.retasrestaurant.com/s/Retas-DRINK-menu-16th-October-2026.pdf) links. | [Owner homepage](https://www.retasrestaurant.com/) identifies 3061 Gottingen Street and links both files. Both returned HTTP 200 and `application/pdf` through their owner-linked Squarespace redirects. PDFs are image-only; no prices were extracted and filename dates are not treated as verified publication dates. |

All five reviews have an observation/review date of `2026-10-20`. Existing
source records are not relabelled with new collection timestamps.

## Durable rejected address

`osm-node-8443747544-saj-house` had the structured address
`433 World Trade Center, Gibraltar, GI` in record index 147 of both generated
place-facts surfaces. Its original observation is
`2026-09-04T13:24:31.147Z`. This conflicts with the existing Halifax location
record, whose September 1 OSM snapshot identifies 19 Alma Crescent:
[OSM object](https://www.openstreetmap.org/node/8443747544).

The reviewed correction payload now holds an entity-and-field-scoped rejection.
It clears only this entity's source-derived `address`, not its entire domain,
email, other facts, identity, lifecycle or original OSM address. An explicit new
location review is needed to remove the rejection. The local OSM address is
retained as existing evidence, not promoted to a fresh owner verification.

The shared rejection helper runs before consumer fact enrichment and before
refresh reconciliation, on both previous and fresh records. Thus raw historical snapshots, retained observations,
and new scrapes cannot reintroduce the rejected address. The original source
record remains in `sourceHistory` with its original timestamps. Counts exclude
the suppressed field. Accepted-content comparison uses the filtered records;
repeated rejected scrapes are unchanged, not false changes. Rejected raw history
is deduplicated independently of observation timestamps, so identical rejected
content does not grow history while a distinct rejected value is retained once.

## Still held

- Sushi Square's [hours](https://sushisquare.ca/hours/) contain 11:00 PM opening
  and 8:00 PM closing times. No AM/PM repair is guessed.
- Water Polo homepage weekend opening conflicts with its location/menu pages.
- Latitude 44 homepage gives conflicting closing times.
- Tulipan, Reta's and Buta Ramen did not publish readable weekly schedules in
  the reviewed pages.
- Existing Black Sheep and Chanoey's dated exceptions are preserved.

## Verification

Run `node scripts/export-catalog.mjs` followed by
`node scripts/test-reviewed-fact-batch.mjs`,
`node scripts/test-reviewed-corrections.mjs`,
`node scripts/test-place-facts-history.mjs` and
`node scripts/check-structured-place-facts.mjs`.

The new batch test covers exact browser/export fields and identities, menu
links, unknown hours, dated exceptions and aliases. It injects an unsafe stale
payload into the actual consumer script order and mocks the actual importer to
exercise zero-target retention, newly fetched rejected evidence, repeated identical
rejected scrapes, and a distinct rejected value without network requests.

Local checks passed on October 20: catalog export (578 canonical identities),
the new fact-batch regression, reviewed corrections, place-facts history, hours
state, scheduled-source guards, lifecycle language, canonical menu coverage,
structured-place-facts validation and `git diff --check`. The reviewed-corrections
test now builds specials in an isolated temporary fixture at an explicit
`2026-10-20T16:00:00Z` clock, avoiding reliance on an old generated snapshot or
the date the regression is run. Production date handling is unchanged.

The local Playwright visual smoke test did not complete: its bundled browser
was missing, and system Chromium could not create a required Unix socket in the
execution sandbox. The actual browser release gate remains required; the
consumer-order VM test is not a substitute for visual verification.
