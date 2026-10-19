# Custodian handoff

Observed: 2026-10-19 16:00 UTC

## Exact state

- Production `main`: `7063613d2e9b93d9f66e391a61e47bb1dcd45d07`.
- PR #91 candidate: `fabbea83747b97c4966b471565f531168febb67d`; exact-release workflows are queued.
- PR #92 blocker repair: `9dcc827c693aa996830d5d072ba5fac5f14cfbd5`; Quality Gate run 39280077149 is queued.
- This isolated data candidate is based on PR #91 head and is intentionally not pushed while the interactive release owner controls that branch.

## Completed and locally verified

- Sushi Shige is preserved under its existing OSM ID and archived from owner evidence dated September 19; the earlier temporary-break post cannot reactivate it.
- HEAL Bayers Lake and WAARIS are location-specific current records backed by official sites; coordinates remain unset rather than inferred.
- Seaport Social's October 17 tea is expired, while November 14 is a separate dated source lead and cannot render as a current offer early.
- Lifecycle reporting now combines curated and reviewed lifecycle records; the controlled snapshot reports 566 canonical places, 564 active and 2 archived.
- Data, lifecycle, source-integrity, offer-expiry, media-rights, coverage-parity and immutable-release checks pass locally. The focused correction regression has 22 assertions.

## Remaining blockers and next action

- Do not merge PR #92 or PR #91 until their exact-head required checks leave the GitHub Actions queue and pass.
- Local screenshot verification is blocked by the absence of a Chromium executable; remote UI verification remains a required exact-head check.
- After PR #92 merges, recheck `main`, reconcile PR #91 without overwriting its release-artifact work, then rebase/cherry-pick this isolated data candidate, run exact-head CI, and merge only the reviewed green head.
- After deployment, verify the served SHA and data on the real domain. HTTP currently serves the September 11 site; HTTPS returns 503 and must not be certified healthy.
