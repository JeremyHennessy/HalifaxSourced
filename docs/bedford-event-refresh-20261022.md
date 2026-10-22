# Bounded Bedford event review, October 22, 2026

This batch does not promote draft PR 144 or its older producer. It takes only two independently corroborated additions from the accepted-main City Events Preview run 39700675756 (artifact 12393090171, SHA-256 6ca125345db0187483c73af9c248cf5450fa8f111659daea7b375a01ca71941f). Restaurant records, media approvals, blocked-source state and all unrelated event observation clocks are unchanged.

## Official evidence

The official library location page and event listing were reviewed October 22, 2026. The web reader returned the location page crawled today and the event-list pages crawled six days earlier; detail pages rendered empty event bodies, so those were not treated as independent date/location confirmation. The new producer independently observed the two additions at 00:38:32 UTC on October 22.

- https://www.halifaxpubliclibraries.ca/locations/bedford-public-library/ confirms the branch address, October 24 puppet show at 10:30–11:00am, and the elapsed October 21 Scott Manor House talk at 6:30–7:45pm.
- https://halifax.bibliocommons.com/v2/events?locations=BED independently lists the October 24, 2026 puppet show at Bedford Public Library and the October 21 After School Club: PS5 at 3:30–4:30pm. Both elapsed October 21 events are removed from this bounded snapshot; this is expiry, not cancellation.
- https://halifax.bibliocommons.com/v2/events?locations=BED&page=2 confirms Super Saturday: Halloween Crafts on October 24, 2026, 2:00–3:00pm, at Bedford Public Library. Its prose says mornings, but the explicit occurrence time says 2:00pm and agrees with the producer; no morning time is inferred.
- https://halifax.bibliocommons.com/v2/events?locations=BED identifies PD Day: Halloween Haunt Party on October 23, 2026, 10:00am–noon, explicitly at the non-branch Scott Manor House, 15 Fort Sackville Rd, Bedford, NS B4A 2G6. Its event detail identity is https://halifax.bibliocommons.com/events/6aa820e3ca248a002915b216.

All times are Atlantic daylight time (UTC−03:00), matching the stored UTC instants. No personal attendee information is collected.

## Safe publication rules

The Halloween party retains its published ID and any saved aliases. Its reviewed correction is exact-occurrence-specific (official library source kind, detail URL, start and end), runs in final entity resolution for both preview and immutable release, and cannot fall back to the organizing branch. Its old branch coordinates and venue ID are removed. The address is verified; coordinates are not, so no replacement map pin is guessed. The integrity gate allows absent coordinates only for the exact reviewed, correctly applied occurrence and rejects stale coordinates/venue IDs. All other regional events still require finite numeric coordinates in geographic range.

The two new records retain producer IDs and observation times. This is not a blanket source refresh: all other source observations and failure timestamps remain their accepted values. There are still 172 events, including six Bedford events. No unrelated preview additions, removals, or alias changes are included. PRs 141 and 144 stay held.
