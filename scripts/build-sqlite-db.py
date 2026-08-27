import json
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
catalog_path = root / "data" / "build" / "catalog.json"
db_path = root / "data" / "build" / "halifax_sourced.sqlite"

catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
db_path.parent.mkdir(parents=True, exist_ok=True)

conn = sqlite3.connect(db_path)
cur = conn.cursor()
cur.executescript(
    """
    drop table if exists restaurant_sources;
    drop table if exists specials;
    drop table if exists events;
    drop table if exists review_queue;
    drop table if exists restaurants;

    create table restaurants (
      id text primary key,
      name text not null,
      neighborhood text,
      category text,
      cuisines_json text not null,
      vibe_json text not null,
      quality_score integer not null,
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

    create table review_queue (
      restaurant_id text not null references restaurants(id),
      reason text not null
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
    if restaurant.get("evidenceStatus") != "verified":
        reasons.append(restaurant.get("evidenceStatus", "needs-review"))
    if restaurant.get("sourceLayer") == "openstreetmap":
        reasons.append("OSM-only directory record")
    if not restaurant.get("website"):
        reasons.append("missing official website")
    if not restaurant.get("address"):
        reasons.append("missing address")
    if not restaurant.get("specials"):
        reasons.append("no captured specials")
    if not restaurant.get("events"):
        reasons.append("no captured events")
    for reason in dict.fromkeys(reasons):
        cur.execute("insert into review_queue values (?, ?)", (restaurant["id"], reason))

conn.commit()
conn.close()
print(f"Built SQLite database at {db_path} with {len(catalog['restaurants'])} restaurants.")
