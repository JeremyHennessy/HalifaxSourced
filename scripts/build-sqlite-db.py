import json
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
catalog_path = root / "data" / "build" / "catalog.json"
official_signals_path = root / "data" / "build" / "official-site-signals.json"
db_path = root / "data" / "build" / "halifax_sourced.sqlite"

catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
official_signals = json.loads(official_signals_path.read_text(encoding="utf-8")) if official_signals_path.exists() else {"results": []}
official_by_id = {signal.get("restaurantId"): signal for signal in official_signals.get("results", []) if signal.get("restaurantId")}
db_path.parent.mkdir(parents=True, exist_ok=True)


def signal_has(restaurant_id, kind):
    signal = official_by_id.get(restaurant_id) or {}
    if signal.get("signalMatches", {}).get(kind):
        return True
    return any((link.get("signalMatches", {}).get(kind) or []) for link in signal.get("candidateLinks", []))


def has_patio_signal(restaurant):
    raw_tags = (restaurant.get("osm") or {}).get("rawTags") or {}
    raw_text = json.dumps(raw_tags).lower()
    return raw_tags.get("outdoor_seating") == "yes" or any(token in raw_text for token in ["patio", "terrace", "rooftop", "beer garden", "outdoor seating"]) or signal_has(restaurant["id"], "patio")


conn = sqlite3.connect(db_path)
cur = conn.cursor()
cur.executescript(
    """
    drop table if exists official_site_signal_links;
    drop table if exists official_site_signals;
    drop table if exists restaurant_inspection_records;
    drop table if exists restaurant_sources;
    drop table if exists specials;
    drop table if exists events;
    drop table if exists source_gap_queue;
    drop table if exists review_queue;
    drop table if exists restaurants;

    create table restaurants (
      id text primary key,
      name text not null,
      neighborhood text,
      category text,
      cuisines_json text not null,
      vibe_json text not null,
      source_coverage_score integer not null,
      freshness_date text not null,
      evidence_status text not null,
      source_layer text not null,
      summary text,
      address text,
      phone text,
      website text,
      opening_hours text,
      lat real,
      lon real,
      osm_type text,
      osm_id text,
      osm_amenity text
    );

    create table restaurant_inspection_records (
      restaurant_id text not null references restaurants(id),
      facility_id text,
      name text not null,
      address text,
      city text,
      detail_url text,
      current_as_of text
    );

    create table restaurant_sources (
      restaurant_id text not null references restaurants(id),
      label text not null,
      type text not null,
      url text,
      status text not null
    );

    create table specials (
      restaurant_id text not null references restaurants(id),
      title text not null,
      cadence text,
      source_status text
    );

    create table events (
      restaurant_id text not null references restaurants(id),
      title text not null,
      timing text,
      source_status text
    );

    create table source_gap_queue (
      restaurant_id text not null references restaurants(id),
      reason text not null
    );

    create table official_site_signals (
      restaurant_id text not null references restaurants(id),
      name text not null,
      website text not null,
      http_status integer,
      error text,
      observed_at text,
      keyword_hits_json text not null,
      signal_matches_json text not null,
      source_kind text,
      review_state text
    );

    create table official_site_signal_links (
      restaurant_id text not null references restaurants(id),
      text text,
      href text not null,
      signal_matches_json text not null
    );
    """
)

for restaurant in catalog["restaurants"]:
    coords = restaurant.get("coordinates") or {}
    osm = restaurant.get("osm") or {}
    cur.execute(
        """
        insert into restaurants values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            restaurant["id"],
            restaurant["name"],
            restaurant.get("neighborhood"),
            restaurant.get("category"),
            json.dumps(restaurant.get("cuisines", [])),
            json.dumps(restaurant.get("vibe", [])),
            restaurant.get("qualityScore", 0),
            restaurant.get("freshnessDate"),
            restaurant.get("evidenceStatus"),
            restaurant.get("sourceLayer", "unknown"),
            restaurant.get("summary"),
            restaurant.get("address"),
            restaurant.get("phone"),
            restaurant.get("website"),
            restaurant.get("openingHours"),
            coords.get("lat"),
            coords.get("lon"),
            osm.get("type"),
            str(osm.get("id")) if osm.get("id") is not None else None,
            osm.get("amenity"),
        ),
    )

    for inspection in restaurant.get("inspectionRecords", []):
        cur.execute(
            "insert into restaurant_inspection_records values (?, ?, ?, ?, ?, ?, ?)",
            (
                restaurant["id"],
                inspection.get("facilityId"),
                inspection.get("name"),
                inspection.get("address"),
                inspection.get("city"),
                inspection.get("detailUrl"),
                inspection.get("currentAsOf"),
            ),
        )

    for source in restaurant.get("sources", []):
        cur.execute(
            "insert into restaurant_sources values (?, ?, ?, ?, ?)",
            (restaurant["id"], source.get("label"), source.get("type"), source.get("url"), source.get("status")),
        )

    for special in restaurant.get("specials", []):
        cur.execute(
            "insert into specials values (?, ?, ?, ?)",
            (restaurant["id"], special.get("title"), special.get("cadence"), special.get("sourceStatus")),
        )

    for event in restaurant.get("events", []):
        cur.execute(
            "insert into events values (?, ?, ?, ?)",
            (restaurant["id"], event.get("title"), event.get("timing"), event.get("sourceStatus")),
        )

    reasons = []
    if not restaurant.get("website"):
        reasons.append("missing direct website")
    if not restaurant.get("address"):
        reasons.append("missing address")
    if not signal_has(restaurant["id"], "menu") and not ((restaurant.get("osm") or {}).get("rawTags") or {}).get("website:menu"):
        reasons.append("missing menu link")
    if not restaurant.get("specials") and not signal_has(restaurant["id"], "specials"):
        reasons.append("no special or happy-hour lead")
    if not restaurant.get("events") and not signal_has(restaurant["id"], "events"):
        reasons.append("no event or live-music lead")
    if not has_patio_signal(restaurant):
        reasons.append("patio unknown")
    if restaurant.get("sourceLayer") == "openstreetmap":
        reasons.append("directory-only source")
    for reason in dict.fromkeys(reasons):
        cur.execute("insert into source_gap_queue values (?, ?)", (restaurant["id"], reason))

restaurant_ids = {restaurant["id"] for restaurant in catalog["restaurants"]}
for signal in official_signals.get("results", []):
    if signal.get("restaurantId") not in restaurant_ids:
        continue
    cur.execute(
        "insert into official_site_signals values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            signal.get("restaurantId"),
            signal.get("name"),
            signal.get("website"),
            signal.get("status"),
            signal.get("error"),
            signal.get("observedAt"),
            json.dumps(signal.get("keywordHits", [])),
            json.dumps(signal.get("signalMatches", {})),
            signal.get("sourceKind"),
            signal.get("reviewState"),
        ),
    )
    for link in signal.get("candidateLinks", []):
        if not link.get("href"):
            continue
        cur.execute(
            "insert into official_site_signal_links values (?, ?, ?, ?)",
            (
                signal.get("restaurantId"),
                link.get("text"),
                link.get("href"),
                json.dumps(link.get("signalMatches", {})),
            ),
        )

conn.commit()
conn.close()
print(f"Built SQLite database at {db_path} with {len(catalog['restaurants'])} restaurants and {len(official_signals.get('results', []))} official site signal records.")