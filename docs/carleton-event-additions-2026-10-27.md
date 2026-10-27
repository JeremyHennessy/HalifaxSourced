# Two reviewed Carleton listings — October 27, 2026

This bounded batch adds two official event occurrences through the existing
`city-event-additions` JSON/JavaScript pair. It does not collect a new calendar,
change source enablement/pagination, expand market recurrence, or promote a stale
preview. Main was `6f31157e6d066bf07d10fc0d4cafb7766ee0656f`; neither exact event URL
was present in its city-event, structured-event or reviewed-addition inputs.
Carleton had no matching access hold or quarantine.

## Evidence and clocks

One successful official-page web-reader open per event occurred within
2026-10-27 21:46:48–21:46:52 UTC. The reader supplied no exact retrieval timestamp.
Each new `observedAt` is explicitly the read-completion **upper bound**, not an
exact HTTP fetch time or proof of fresh publisher content. The literal cache-age
reports are retained: AfterWords **“today”**, Alan Cross **“2 days ago”**. These
rounded reports are not converted into invented crawl dates; the exact source
crawl timestamp remains null. The separate review time is
2026-10-27 21:47:17 UTC. No HTTP status or content hash is invented.

- [AfterWords official occurrence](https://www.thecarleton.ca/events/afterwords-the-world-we-long-for-nov2/):
  November 2, 2026, 1:00–2:30 pm; $8. Its explicit venue-change notice identifies
  **The Stardust Bar + Kitchen, 1688 Barrington Street**, not the Carleton contact
  address in the page header.
- [Alan Cross official occurrence](https://www.thecarleton.ca/events/an-evening-with-alan-cross/):
  November 4, 2026, 7:00–9:00 pm at **The Carleton, 1685 Argyle Street, Halifax**;
  $30 plus HST. No live ticket inventory or availability is claimed.

The pages print local wall times, not a timezone or UTC timestamps. The existing
production `localIso` / `atlanticOffset` helpers derive the instants from the
Halifax venue location: AfterWords **November 2, 17:00–18:30Z**; Alan Cross
**November 4, 23:00Z–November 5, 01:00Z**. The latter remains **November 4** in the
America/Halifax display. The provenance distinguishes that derivation from printed
source facts. Tickets remain navigation via the exact official event source;
separate ticket URLs are unknown, and no linked ticket destination was fetched.

Only titles, factual metadata and source links are retained. No publisher bodies,
images, precise source-fetch clocks, new media rights, coordinates or unverified
Stardust venue/restaurant association are supplied. The pre-existing exact-source,
URL/start/end relocation correction is reused unchanged, including its original
review timestamp. Source registry records, all 12 older additions, original
collection snapshots and their generated/observed timestamps are unchanged.

## Regression coverage

`test-reviewed-carleton-additions.mjs` is included by the existing
`test-reviewed-event-locations.mjs` runner, so existing Quality Gate and offline
City validation exercise it without a workflow/collector change. It checks:

- production-derived UTC instants and existing title/URL/time ID generation;
- literal cache-age evidence, separate review time and read-window upper bound;
- real browser helper/card execution in a VM: Halifax dates/times, venue, price
  and exact source links, including Alan Cross's UTC-midnight boundary;
- runtime merge repetition and unchanged non-target event records/clocks;
- transport-disabled, disposable release projections in normal order: catalog
  export, reviewed additions, sanitation, entity resolution, and both gates;
- baseline versus proposed projections differing by exactly two event records;
- future reimport with unchanged and changed titles/IDs: one occurrence, stable
  reviewed identity, preserved fresh observation/alias, and corrected off-site
  venue without an organizer pin;
- unchanged accepted input bytes after testing.

The checked-in city-event dataset is intentionally not broadly regenerated. Normal
release generation incorporates the two additions (1,449 to 1,451 records for this
accepted snapshot). Local VM/Node checks are not a full hosted Node 22 Quality Gate,
a real-browser visual check, publication, deployment or live ticket verification.
