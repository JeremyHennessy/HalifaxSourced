# Inspection location matching

Browser and catalog export use `app-inspection-matching.js`. Similar business names
must be corroborated by the same civic number and street, with no known city
conflict. Street suffix abbreviations and omitted registry suffixes are normalized;
explicit contradictory suffixes are rejected. Missing addresses, civic ranges,
unit-first ambiguity and unverified relocations are not treated as matches.

On the 2026-10-20 578-record generated catalog, the prior name-or-address matcher
attached at least one inspection to 340 restaurants. The new matcher attaches 239:
235 retained and four newly corroborated records. Of the 105 unlinked restaurants,
73 had no address, two had no civic number, and 30 had conflicting civic/street
identity. This is intentionally a reduction in unsupported claims, not deletion
of registry records. No quality thresholds were relaxed.

Examples: Jukai at 49 Kings Wharf Place only receives the Dartmouth registry
record; Jukai at 1715 Barrington receives the Halifax record. Wooden Monkey at
1707 Grafton only receives that location's record. Dartmouth's owner address at
40 Alderney is not silently equated with the registry's 88 Alderney. Differences
such as 15B versus 15 also remain unresolved, requiring source review.

Regression: `node scripts/test-inspection-location-matching.mjs` covers these
branches and valid punctuation, accent, Bedford Highway, Dresden Row, and
Farnham Gate Road cases. Both runtime and export call the same implementation.
