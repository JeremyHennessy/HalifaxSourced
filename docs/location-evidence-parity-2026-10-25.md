# Location evidence consistency review — October 25, 2026

This offline pass repairs two reproduced location-association defects. It does
not collect new business facts, approve images, change coordinates, or refresh
source observation clocks. Accepted restaurant identities and the UI are retained.

## Directory civic-number conflicts

The resolver previously ignored differing civic numbers when address token
similarity was at least 0.4. Shared domains, phone numbers or nearby coordinates
could therefore automatically resolve conflicting addresses. The accepted
snapshot exercises three such automatic associations: Ori Foods (258 versus 260
Wyse Road), Buta Ramen (65 versus 67 King Street), and Jukai (42 versus 49 Kings
Wharf Place). This review does not decide which source address is correct.

Clearly leading conflicting civic numbers now require review regardless of the
other matching evidence. Unit-first addresses, phone prefixes and civic ranges
are not guessed into new conflict evidence. Existing candidate scores and rankings
are unchanged, so holding one association cannot automatically promote a different
candidate. Explicit candidate-scoped reviewed decisions still supersede stale
directory addresses; the validator checks the accepted review rather than trusting
an output flag.

Against main `9340be9b04b1fbf710edcef9b9b01bdee5b39a0a`, all 1,093 candidates
remain present. Automatic/reviewed resolved associations decrease from 259 to 256,
and the retained review queue increases from 834 to 837. No new association is
promoted; 53 already-held rows additionally expose their civic conflict. All
original observation clocks and accepted candidate inputs are preserved.

## Browser/export inspection parity

The browser matched inspections before final reviewed identity corrections.
Kai Brady’s stale OSM address (5675 Spring Garden) therefore produced no automatic
inspection match even though its final reviewed address (5679 Spring Garden)
correctly matches facility `3670733` in the exported catalog.

Automatic browser matches are now recalculated after explicit reviewed name or
address corrections. Matching is still strict and location-specific. Corrections
away from an old name/address also remove stale automatic associations; independently
reviewed evidence, source history and raw registry records remain untouched.

## Verification

- `test-place-source-location-conflicts.mjs`: conflicting numbers and letter
  suffixes; matching addresses; ambiguous units, ranges and phone prefixes;
  reviewed relocation exception; validator rejection of lost conflict flags and
  fabricated review flags. All production fixture commands deny network access.
- `test-reviewed-corrections.mjs`: real Kai Brady browser/export parity plus
  corrected-away identities and preservation of separate reviewed evidence.
- Both new regressions fail against the corresponding original production code.
- Existing offline discovery, inspection, reviewed-fact, hours, menu-pointer,
  regional, source-integrity and fixed-snapshot release checks remain in force.
- Exact-head hosted Quality Gate and gated Pages acceptance are required before
  release. No physical-device testing is claimed by these offline checks.
