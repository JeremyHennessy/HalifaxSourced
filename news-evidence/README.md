# Reviewed news operational receipts (not publication)

`current.json` is a review-controlled, digest-pinned acceptance manifest for an
already completed GitHub run. It does not authorize a fetch, scheduler change,
cache reset, candidate approval, or news publication. This directory is excluded
from the Pages release by the release packager's directory allowlist.

The retained ZIP is the original GitHub artifact, not a rewritten cache. The
other files are read-only official GitHub API responses for its run, artifact,
and jobs. The initial accepted capture is scheduled run 40693348332, attempt 1,
SHA 754db8b8543dc36d6d18d0cb89f81fc6fdad5acd, verified 2026-10-28 13:22 UTC.
Its artifact SHA-256 matches the official artifact digest. Full candidate data
stays in this repository audit archive and is never projected into the website.

The offline verifier checks the reviewed file digests, successful exact run/job,
workflow and branch identity, artifact ownership/digest, current payload/final
receipt identity and digest, canonical current/predecessor cache keys, predecessor
receipt/plan identity consistency and final-state flags, successful cache-verification steps, source config
fingerprints, host identities and clocks. It reads the five small ZIP entries in
memory without extraction or execution. The predecessor payload is not present
in this artifact: its digest is not independently recalculated here. The prior
independent audit and the successful pre-request cache verification step are
separate supporting evidence, not substitute payload bytes. A committed manifest is a reviewed trust
anchor, not a cryptographic GitHub signature. Replacing it requires another
review of independent GitHub evidence; editing all pins together is not itself
verification. No automatic archive acceptance or dashboard refresh is installed.

The catalogue receives only sanitized diagnostic clocks and a link to the run.
Candidate titles, URLs, validator headers, publication and first-seen timestamps
are not projected. Successful collection means a source check succeeded; it does
not mean new content appeared, or that collection happened at the nominal cron
time. Candidate and accepted news content remain unchanged.

Absence of the manifest leaves collection clocks unknown. Corrupt or mismatched
present evidence fails the build rather than silently publishing healthy clocks.
Current source configuration must match the recorded source identities; a future
source configuration change needs a separately reviewed compatible receipt.

Checks: `node scripts/test-news-health-receipt.mjs`,
`node scripts/test-source-catalog.mjs`, `node scripts/test-release-artifact.mjs`,
and `node scripts/test-release-source-isolation.mjs`.
