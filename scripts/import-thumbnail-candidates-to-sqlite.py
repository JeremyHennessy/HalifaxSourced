import json
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
build_dir = root / "data" / "build"
db_path = build_dir / "halifax_sourced.sqlite"
thumbnail_path = build_dir / "thumbnail-candidates.json"


def load_json(path, fallback):
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def dumps(value):
    return json.dumps(value if value is not None else [], ensure_ascii=False)


payload = load_json(thumbnail_path, {"candidates": [], "missingApproved": [], "missingAnyCandidate": []})
db_path.parent.mkdir(parents=True, exist_ok=True)
conn = sqlite3.connect(db_path)
cur = conn.cursor()
cur.executescript(
    """
    drop table if exists thumbnail_gap_queue;
    drop table if exists thumbnail_candidates;

    create table thumbnail_candidates (
      id text primary key,
      restaurant_id text not null,
      restaurant_name text,
      thumbnail_url text not null,
      source_url text not null,
      post_url text,
      page_url text,
      platform text,
      source_kind text not null,
      extraction_method text,
      review_state text not null,
      rights_status text not null,
      permission text,
      rights_basis text,
      attribution text,
      alt text,
      confidence text,
      observed_at text,
      published_at text,
      title text,
      category text,
      eligible_for_production integer not null
    );

    create table thumbnail_gap_queue (
      restaurant_id text not null,
      restaurant_name text,
      neighborhood text,
      website text,
      reason text not null
    );

    create index idx_thumbnail_candidates_restaurant on thumbnail_candidates(restaurant_id);
    create index idx_thumbnail_candidates_review_state on thumbnail_candidates(review_state);
    create index idx_thumbnail_candidates_source_kind on thumbnail_candidates(source_kind);
    """
)

for candidate in payload.get("candidates", []) or []:
    cur.execute(
        "insert into thumbnail_candidates values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            candidate.get("id"),
            candidate.get("restaurantId"),
            candidate.get("restaurantName"),
            candidate.get("thumbnailUrl"),
            candidate.get("sourceUrl"),
            candidate.get("postUrl"),
            candidate.get("pageUrl"),
            candidate.get("platform"),
            candidate.get("sourceKind"),
            candidate.get("extractionMethod"),
            candidate.get("reviewState"),
            candidate.get("rightsStatus"),
            candidate.get("permission"),
            candidate.get("rightsBasis"),
            candidate.get("attribution"),
            candidate.get("alt"),
            candidate.get("confidence"),
            candidate.get("observedAt"),
            candidate.get("publishedAt"),
            candidate.get("title"),
            candidate.get("category"),
            1 if candidate.get("eligibleForProduction") else 0,
        ),
    )

for item in payload.get("missingApproved", []) or []:
    cur.execute(
        "insert into thumbnail_gap_queue values (?, ?, ?, ?, ?)",
        (item.get("restaurantId"), item.get("name"), item.get("neighborhood"), item.get("website"), "missing_approved_thumbnail"),
    )
for item in payload.get("missingAnyCandidate", []) or []:
    cur.execute(
        "insert into thumbnail_gap_queue values (?, ?, ?, ?, ?)",
        (item.get("restaurantId"), item.get("name"), item.get("neighborhood"), item.get("website"), "missing_any_thumbnail_candidate"),
    )

conn.commit()
conn.close()
print(
    f"Imported {len(payload.get('candidates', []) or [])} thumbnail candidates and "
    f"{len(payload.get('missingApproved', []) or []) + len(payload.get('missingAnyCandidate', []) or [])} gap rows into {db_path}."
)
