# Reviewed event refresh, 20 October 2026

Recovered the data-only City Events Preview from [run 39417305655](https://github.com/JeremyHennessy/HalifaxSourced/actions/runs/39417305655) onto current code, not the stale promotion branch's application code.

- 199 raw source IDs became 172 canonical records after existing and five newly covered hockey-team aliases. Duplicate source IDs remain represented in duplicateEventIds.
- Compared removals with the accepted snapshot: 79 expired entries, three replaced representations, two old listings with incorrect future end dates, and three real upcoming omissions requiring official review. A calendar's omission is not treated as cancellation.
- Replaced the Symphony index's erroneous season-heading record with [Alex Cuba + Symphony Nova Scotia](https://symphonynovascotia.ca/concerts-and-tickets/concerts/rebecca-cohn-auditorium/alex-cuba-symphony-nova-scotia/) on 23 October at 7:30 p.m. ADT. The parser now respects individual heading boundaries.
- Restored [Craft Nova Scotia Designer Craft Show](https://novascotia.com/event/craft-nova-scotia-designer-craft-show/), 13–15 November, Pier 22 Pavilion, using local event times rather than timezone-less JSON-LD.
- Restored [Halifax International Wine Festival](https://novascotia.com/event/halifax-international-wine-festival/), 28 November, 2–10 p.m. AST. Its ticket link targets the verified [2026 edition](https://www.showpass.com/2026-halifax-international-wine-fest/), not the old Tourism page's 2025 ticket destination.

The resulting accepted candidate has 174 canonical events. Source failures remain explicit; this is not a claim that every Halifax event is covered. Alderney's failed source had no accepted events to carry in this batch.

A durable refresh guard retains valid future events on explicit source failure without renewing their evidence timestamps. Unexplained successful/partial-source removals and questionable ongoing listings stop promotion for review; they are not silently removed or automatically revived. Failure diagnostics are retained separately from promotable previews.

## Explicit expired-removal review

[Festa Italiana organizer](https://festaitalianahalifax.ca/) lists September 11, 2026 (6–10 p.m.) and September 12 (noon–10 p.m.), not the old record’s December 9 end. The page returned HTTP 200 on October 20 at 15:30:17 UTC. The [Clan MacNicol gathering page](https://www.clanmacnicol.org/halifax2026) gives September 11–14, and its [official journal](https://www.clanmacnicol.org/sites/default/files/2025-12/Vol%2033%20No3%202025.pdf) places the flag raising on September 11. Official cached content supports those dates; the final direct organizer fetch timed out and Tourism’s event URL returned 404, so no fresh successful retrieval is claimed for Clan. These are explicit reviewed removals of expired events, not exceptions that weaken the ongoing-event guard.
