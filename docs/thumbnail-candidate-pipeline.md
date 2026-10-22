# Thumbnail candidate pipeline

Halifax Sourced can now discover thumbnail candidates for restaurants and recent updates without weakening the production media rules.

The pipeline collects:

- already approved restaurant media from `data/restaurant-media.js`
- image URLs declared by official RSS/Atom feed posts
- image URLs returned by Meta Graph API post/media objects
- optional first-party page thumbnail metadata such as `og:image`, `twitter:image`, `image_src`, and JSON-LD `image`

Run a deterministic local build from existing artifacts:

```bash
node scripts/build-recent-social-posts.mjs
node scripts/build-thumbnail-candidates.mjs
node scripts/check-thumbnail-candidates.mjs
node scripts/build-thumbnail-coverage-report.mjs
node scripts/plan-thumbnail-coverage-attack.mjs
```

Run a live official-page thumbnail discovery pass:

```bash
THUMBNAIL_DISCOVERY_FETCH=1 \
THUMBNAIL_DISCOVERY_PAGE_LIMIT=320 \
THUMBNAIL_DISCOVERY_PAGES_PER_RESTAURANT=3 \
node scripts/build-thumbnail-candidates.mjs
node scripts/check-thumbnail-candidates.mjs
node scripts/build-thumbnail-coverage-report.mjs
node scripts/plan-thumbnail-coverage-attack.mjs
```

The coverage builder writes:

- `data/build/thumbnail-coverage-report.json`
- `artifacts/thumbnail-coverage-report.json`
- `docs/thumbnail-coverage-report.md`

The report separates:

- restaurants with production-approved thumbnails
- restaurants with any source-backed candidate
- restaurants missing an approved thumbnail but having candidates ready for review
- restaurants with no candidate at all
- candidates grouped by source kind, review state, rights state, extraction method and platform

The attack planner writes:

- `data/build/thumbnail-promotion-plan.json`
- `data/build/thumbnail-promotion-plan.csv`
- `data/build/thumbnail-source-check-priority.csv`
- `artifacts/thumbnail-promotion-plan.json`
- `docs/thumbnail-coverage-attack-plan.md`

The promotion CSV ranks the cleanest exact-ID candidate-review images first. It admits only HTTPS images, first-party or approved-CDN provenance, no hard decoded-image quality flags, and source kinds that can move through governed review. The source-check CSV keeps remote-host cases held, but sorts the cleanest records first for first-party host validation.

Owner outreach remains aggregate-only in public artifacts. The planner counts the no-candidate restaurants and splits them into website-first versus manual-contact lookup buckets, but row-level owner outreach and submitted-image rights metadata should stay in the private owner-submission workflow unless publication is explicitly approved.

Store the resulting candidates in the local SQLite database:

```bash
python scripts/build-sqlite-db.py
```

The main SQLite builder automatically imports the generated thumbnail candidates into `thumbnail_candidates` and `thumbnail_gap_queue`. The standalone `scripts/import-thumbnail-candidates-to-sqlite.py` remains available for refreshing just those two tables after a thumbnail-only candidate rebuild.

Useful SQLite queries:

```sql
select source_kind, review_state, count(*)
from thumbnail_candidates
group by source_kind, review_state
order by count(*) desc;

select restaurant_name, thumbnail_url, source_url, source_kind, rights_status
from thumbnail_candidates
where review_state = 'candidate_review'
order by restaurant_name;

select reason, count(*)
from thumbnail_gap_queue
group by reason;
```

## Production use

Candidate thumbnails are not automatically production restaurant photos. Anything with `rightsStatus = requires_rights_review` remains a review lead. To render a restaurant thumbnail as production media, promote it through the existing owner/licensed media path so it has:

- exact `restaurantId`
- approved review state
- permission/rights basis
- source URL
- creator/licence/attribution where required
- `permissionConfirmed: true`

Recent update cards may use source-declared feed/API media as linked update media, with the original post/source retained for context. Restaurant cards continue to use only approved restaurant media or branded fallbacks.

## Automatic evidence-gated approval

`node scripts/approve-eligible-thumbnails.mjs` assesses every rebuilt candidate and
writes `data/build/thumbnail-auto-approval-report.json`. It updates only validated generated media. `--assess-only` produces a report
without changing public media.
The existing Quality Gate runs this command in apply mode before final candidate
validation and immutable release packaging; existing source/social preview jobs
run assessment-only. Preview reports are review-only artifacts, never authority
for production approval. No new scheduled or paid AI job is introduced.

No human approval is needed. An assistant may inspect the actual source and image,
record genuine verification evidence in `data/thumbnail-assessments.json`, and let
the deterministic publisher approve the image. The script does not pretend to
perform semantic visual review from filenames or dimensions. It holds incomplete,
uncertain, rejected, mismatched, stale and reference-only candidates.

Each assessment is image-specific, not a restaurant-wide authorization:

- `candidateId`, `restaurantId`, `thumbnailUrl` and `sourceUrl` must exactly match.
- `assessedBy` and `assessedAt` identify the completed assessment.
- `location`: `verified: true`, exact active canonical `restaurantId` and current
  `address`, source-confirmed `operatingStatus: active`, HTTPS `sourceUrl`, and `notes` explaining the actual location match.
- `visual`: `inspected: true`, `verdict: usable`, actual inspected local JPEG's
  `sha256`, decoded `width`/`height`, and `notes` about subject/crop/quality.
- `assetPath`: a repository `assets/restaurants/<name>.jpg`. It must contain the
  exact inspected bytes; unavailable, changed, tiny or unsuitable-aspect assets
  are held. Remote originals are not downloaded by this script. A grant must
  permit local reproduction before a local asset is added.
- `alt`: useful location-specific alternative text, at least 20 characters.
- `rights`: `verified: true`, `permissionConfirmed: true`, HTTPS `evidenceUrl`,
  `verifiedAt`, `localReproductionPermitted: true`, `conditionsSatisfied: true`,
  `usageConditions`, optional `expiresAt`, and `notes` documenting the actual licence/grant and compliance,
  `sourceType`, `permission`, `rightsBasis`, `creator`, `license`, and `attribution`.
  All applicable attribution and licence conditions must already be satisfied.

Evidence must describe checks actually performed, not generated assertions.
Existing source-host confidence, owner app clicks, public availability and
noncommercial intent do not establish usage rights. Historical source references
remain unchanged and separate from licensed production media. The old metadata
planner is now a shortlist only; `THUMBNAIL_PROMOTION_APPLY=1` fails closed.

The publisher preserves separately reviewed media. Automatically managed records
are reevaluated each build and withdrawn if their supporting assessment disappears
or its location/content/rights checks fail. Repeated runs with unchanged evidence and lifecycle/expiry state are deterministic
and create no timestamp-only changes. The browser's existing media-permission
predicate remains the final shared validation gate.

### Initial batch, October 20, 2026

A full catalog and candidate rebuild assessed 2,393 candidates: 8 already approved
catalog thumbnails and 2,385 held candidates. Of the held candidates, 2,368 require
rights review and 17 were rejected. There are no owner submissions or additional
verified image assessments. Therefore **zero new thumbnails are approved**.
All 9 previously licensed manifest records are preserved (one is outside the
current eligible catalog). The report gives overlapping hold-reason counts and a
per-candidate disposition, rather than presenting the 72 metadata-shortlisted
restaurants as permission-cleared.

## Observation clocks

Candidate `observedAt` is preserved source evidence, not candidate-build or approval
time. Offline projections and normalization keep an explicit observation unchanged;
missing, null and empty observations remain null. Review, assessment, rights
verification, publication, capture and source-update dates do not fill that gap.
Only successful opt-in page discovery can introduce a source observation. The
top-level `generatedAt` remains the build receipt, and first-wins duplicate retention
is unchanged. Approved photo cards make no claim about when a photo was added.

`node scripts/test-thumbnail-observation-clocks.mjs` exercises the real offline
entrypoint at two clocks, finite mocked page success/failure, nullable JSON/JS and
SQLite output, coverage, decision exports and home selection. It denies external
source/image transport and does not collect, approve media or modify accepted inputs.
