# Preview promotion outcomes

`Promote Preview Artifacts` remains restricted to the source, social and city
preview artifact allowlists in `scripts/promote-preview-artifacts.mjs`. It does not
expand collection, alter preview schedules, or deploy preview data directly.

- No data change against `main`: no branch update, PR or Quality Gate dispatch.
- Changed data with a confirmed promotion PR: dispatch Quality Gate for the
  promotion branch. The normal main-branch Quality Gate and Pages deployment
  still run only after merge.
- Changed data without a confirmed PR: leave the branch available for review,
  skip the expensive Quality Gate, and fail the promotion with an action-needed
  summary and a direct `main...codex/promote-<artifact>` comparison link.

If automatic PR creation is unavailable, use the comparison link to review the
data and open a draft PR with existing repository access. Then run
`Promote Preview Artifacts` again with the same source run ID and artifact name
to confirm the existing PR and dispatch its Quality Gate. This recovery does not
require a new token, additional permissions, or a repository security change.
Listing, editing or resolving an existing PR can also fail; these outcomes stay
explicit rather than dispatching quality work without a confirmed PR URL.

Repeated promotions compare the complete proposed tree against the existing
promotion branch, excluding only `data/build/preview-promotion-metadata.json`.
Identical content retains the branch commit and its original provenance metadata
instead of creating a timestamp-only replacement. Data changes or other tree
changes from `main` still update the branch. Every push retains the explicit
expected-SHA `--force-with-lease` protection; a competing remote writer fails
the update instead of being overwritten.

Run the offline regression with `node scripts/test-preview-promotion.mjs`. It
executes the workflow's Bash against temporary Git repositories and a stubbed
GitHub CLI, covering no-op/rebased-content updates, competing writers, successful
PRs, unavailable PR creation and other unresolved-PR outcomes.
