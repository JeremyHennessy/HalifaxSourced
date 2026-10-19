# October 19 release repair checkpoint

The user explicitly authorized fixes, push, merge and checked deployment. This work is not complete until the exact final head passes Quality Gate, main passes its post-merge gate, Pages deploys its tested artifact, and the live release manifest/metadata agree. Do not treat queued Actions or local tests as a deployed release.

## Implemented

- Promotion publication uses an explicitly fetched expected remote SHA and a lease, including safe initial creation. The producer's six new diagnostic files are review-only; unexpected files still fail. Twenty Git/artifact regression assertions cover initial, existing, racing and retried pushes.
- The data job builds one immutable site bundle. The browser job serves that bundle and verifies its SHA-256 receipt before and after UI tests. Pages downloads that exact tested bundle from the successful main run, validates its source SHA, run ID, file inventory and metadata, and does not recollect/rebuild.
- Sixteen reviewed field/status corrections archive Lockside, Turkish Delight, Humani-T, Asia, La Frasca and Sushi Shige; mark Clay West replaced and old Juice Press/Sushi Cove locations moved; fix six official URLs; preserve Barrington Bird's Nest hours. Dates observed in earlier audits remain those dates. Sushi Shige's September 19 closure supersedes its temporary break. Unspecified final-service days remain unknown.
- Eight separately identified current locations added: Big Leagues Bayer's Lake, Juice Press Dutch Village Road, Sushi Square, Tulipan, HUX, Reta's, The Waaris and Via Condotti. Unconfirmed coordinates/hours remain unset. HUX has three explicitly priced, source-reviewed offers with 30-day review deadlines; Monday availability is not assumed.
- Café Lunette and Bubba Ray's aliases preserve original source/address/coordinate evidence and saved/detail-route continuity. Existing curated/OSM aliases remain valid evidence associations.
- Browser and export now agree on the complete identity set, including the six discovery supplements omitted by prior export. The reviewed set contains 575 identities, 565 discoverable and 10 archived/inactive.
- Coverage metrics intersect the same canonical universe; import/rebuild `freshnessDate` is excluded from the observation clock. Seven licensed assets remain in the manifest; six belong to the local-policy catalog. The other media records remain reference-only under PR #91's rights contract.
- Source dates without valid publisher evidence stay unknown; future dates are withheld from the publication field. Recent-post eligibility is 60 days with seasonal expiry and review deadlines. Reviewed-post approval dates no longer default to the build time. Sixty-three past-ended specials now report `expired` at the local October 19 checkpoint.
- Lifecycle checks cover the complete catalog and retained official page/feed/post observations. A release-time full active official/social/menu/action link pass adds fresh official-page language candidates, per-source observation dates, provenance and explicit inconclusive states. A twice-confirmed 404/410 for a newly reviewed official URL blocks release. The initial 943-URL pass found three repeated-404 action paths (Ela dinner, a truncated Jungle Jim’s DoorDash URL, Terra Café menu); those exact paths are quarantined without closing the venues. Legacy broken links remain visible review candidates; timeouts, restrictions and redirect identity failures never establish closure.

## Verification and external blockers

The 39 local data/model/report checks passed after preserving Bicycle Thief's canonical alias. The 20 promotion assertions and 13 immutable-release regression checks passed. The model check executes the real browser data/model script sequence and compares every exported identity, each reviewed field, inactive action suppression, duplicate provenance, idempotency and seasonal/future-date controls. It is not a screenshot test.

GitHub reported degraded Actions, Pages and Webhooks on October 19 (incident `8tzbpcnl75jp`); release jobs remained queued while this checkpoint was prepared. The local Chromium CDN returned invalid/truncated archives. Browser screenshots, remote exact-head CI and live deployment checks remain required. No production change is claimed here.

## Resume and held evidence

Read current PR #91/#92 heads and required checks first. PR #91 incorporates the promotion repair as well as the source/lifecycle/provenance work; merge only the reviewed unchanged green head. Close redundant PR #92 only after its changes are confirmed included. Re-run a failed job only after diagnosing the actual failure; avoid repeated dispatches during the platform incident.

Do not promote old preview artifacts blindly. The ordinary source-expansion workflows may have accumulated preview branches during the outage; use the repaired promotion path and review identities, dates and rights before merging. Confirm the new tested-site artifact and live manifest rather than relying only on a successful deployment status.

Downtown Dartmouth and Spring Garden identity conflicts without exact-location evidence remain review work, not permission to invent a match. Crown & Anchor, Saj House's replacement, Crème and HEAL require current owner/location evidence. HUX Monday hours conflict, Sushi Square's malformed hours and uncertain successor coordinates remain explicitly unset/held. No new reusable image rights were inferred from an official-site photograph.

## Reconciled stacked PR #93

PR #93 was based on the earlier release head. Its Sushi Shige and WAARIS identities are already covered here; its older partial lifecycle/coverage reports must not replace the full-catalog report. The September 19 owner announcement does not establish an exact final-service day, so no fabricated Shige closure date is copied. Seaport Social November 14 tea was independently rechecked on the official specials page on October 19: 2–4pm, $55 or $57 with Prosecco, tax/gratuity extra. It is separate from expired October 17 tea, with Halifax-offset start/end timestamps.

HEAL Bayers Lake at 218 Chain Lake Drive is supported by https://healwellness.ca/locations/, but the same owner directory lists a national/international franchise. It is classified as excluded under the existing local-only policy, not silently added as an independent restaurant. Coordinates and hours were not inferred. No generated snapshots or weaker partial-report checks from #93 are imported.
