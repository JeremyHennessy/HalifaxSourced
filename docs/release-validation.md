# Fixed-snapshot release validation

Quality Gate validates the accepted source snapshot at the checked-out pull-request
head or main commit. It does not discover new restaurants, fetch new offer details,
or refresh patio evidence while deciding whether that commit may ship.

## Collection and release responsibilities

| Accepted input pair (`data/*.js` and `data/build/*.json`) | Collection workflow |
| --- | --- |
| `public-special-source-leads` | Source Expansion Preview |
| `patio-directory-facts` | Source Expansion Preview |
| `directory-restaurant-leads` | Restaurant Discovery Preview |

Those scheduled/manual preview workflows still run their importers and publish the
source artifacts. A successful collection run is not, by itself, release acceptance:
the reviewed/promoted source files must become part of the commit being validated.
Missing or inconsistent input pairs fail the release isolation regression; release
validation never repairs them by silently fetching a replacement.

After exporting the reviewed catalog, Quality Gate checks the accepted public-special
and patio snapshots, resolves the existing directory candidates, and rebuilds derived
structured specials, recent/reviewed posts and thumbnail candidates. Thumbnail page
fetching, image probing and automatic thumbnail promotion are explicitly disabled.
Current/expired status is recomputed at release time; rebuilding never refreshes the
underlying source observation dates or grants media rights.

## Live network exception: bounded link health

The existing release link-health check remains live. It examines current active
catalog official, social, menu and action destinations, with a 4-second request
deadline and concurrency of 16. `LINK_HEALTH_LIMIT=0` means complete coverage of that
bounded destination set, not a sample. The release validator still requires complete,
same-commit evidence and preserves the existing handling of confirmed broken reviewed
links versus transient/restricted responses. Link-health observations are not imported
as new offers, venue identities, or automatic lifecycle decisions.

Dependency installation and browser testing are also not claimed to be air-gapped.
The separation is between source collection and accepted-input release projection,
not a claim that the entire GitHub Actions runner has networking disabled.

## Regression and retained protections

Run locally:

```sh
node scripts/test-release-source-isolation.mjs
```

The regression:

1. Rejects collectors and unclassified production/shell entry points in the release
   data job, and rejects enabled thumbnail fetch/probe/promotion flags.
2. Checks the three accepted JavaScript/JSON pairs agree and that each collector
   retains a scheduled preview workflow and published artifact paths.
3. Executes the gate's offline production build/check sequence in two disposable
   copies. Network calls and subprocesses are denied; even caught failures are logged
   and fail the test. Both copies use the same test clock and must produce identical
   data and report bytes without altering any of the three accepted input pairs.
4. Tests its own rejection paths, including a swallowed network exception.

The fixed clock is a regression fixture only, not a production expiry override.
The runtime regression excludes the live link-health pair, SQLite packaging and
immutable-release packaging, which retain their normal gate steps. Fixture-based
collector tests remain separate and may use mocked network responses.

Quality Gate continues to run identity, source-integrity/provenance, media-rights,
expiry, event, local-policy and report-parity checks. It packages the validated site,
tests the packaged bytes with responsive/browser regressions, verifies the immutable
receipt again, and uploads that same tested artifact for the existing gated deployment.
The update ledger is regenerated with the actual PR/main source SHA and Quality Gate
run ID before packaging, so the admin status test inspects this release's ledger
rather than a locally generated, previously committed ledger.
