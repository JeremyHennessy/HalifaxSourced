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
```

Run a live official-page thumbnail discovery pass:

```bash
THUMBNAIL_DISCOVERY_FETCH=1 \
THUMBNAIL_DISCOVERY_PAGE_LIMIT=320 \
THUMBNAIL_DISCOVERY_PAGES_PER_RESTAURANT=3 \
node scripts/build-thumbnail-candidates.mjs
node scripts/check-thumbnail-candidates.mjs
node scripts/build-thumbnail-coverage-report.mjs
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
