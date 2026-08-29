import json
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
build_dir = root / "data" / "build"
catalog_path = build_dir / "catalog.json"
official_signals_path = build_dir / "official-site-signals.json"
first_party_sources_path = build_dir / "first-party-sources.json"
website_feed_signals_path = build_dir / "website-feed-signals.json"
social_signals_path = build_dir / "social-signals.json"
recent_posts_path = build_dir / "recent-social-posts.json"
db_path = build_dir / "halifax_sourced.sqlite"


def load_json(path, fallback):
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


catalog = load_json(catalog_path, {"restaurants": []})
official_signals = load_json(official_signals_path, {"results": []})
first_party_sources = load_json(first_party_sources_path, {"records": []})
website_feed_signals = load_json(website_feed_signals_path, {"posts": [], "signals": []})
social_signals = load_json(social_signals_path, {"posts": [], "signals": []})
recent_posts = load_json(recent_posts_path, {"records": []})
official_by_id = {signal.get("restaurantId"): signal for signal in official_signals.get("results", []) if signal.get("restaurantId")}
db_path.parent.mkdir(parents=True, exist_ok=True)


def dumps(value):
    return json.dumps(value if value is not None else [], ensure_ascii=False)


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
    pragma foreign_keys = off;
    drop table if exists recent_social_post_terms;
    drop table if exists recent_social_post_categories;
    drop table if exists recent_social_posts;
    drop table if exists meta_social_posts;
    drop table if exists website_feed_posts;
    drop table if exists first_party_related_links;
    drop table if exists first_party_feeds;
    drop table if exists first_party_link_hubs;
    drop table if exists first_party_social_profiles;
    drop table if exists first_party_sources;
    drop table if exists official_site_signal_links;
    drop table if exists official_site_signals;
    drop table if exists restaurant_inspection_records;
    drop table if exists restaurant_sources;
    drop table if exists specials;
    drop table if exists events;
    drop table if exists source_gap_queue;
    drop table if exists review_queue;
    drop table if exists restaurants;
    pragma foreign_keys = on;

    create table restaurants (
      id text primary key,
      name text not null,
      neighborhood text,
      category text,
      cuisines_json text not null,
      vibe_json text not null,
      source_coverage_score integer not null,
      freshness_date text,
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

    create table first_party_sources (
      restaurant_id text primary key,
      name text,
      website text,
      source_kind text,
      observed_at text,
      last_verified_at text,
      review_state text,
      social_profile_count integer not null default 0,
      link_hub_count integer not null default 0,
      related_link_count integer not null default 0,
      feed_count integer not null default 0
    );

    create table first_party_social_profiles (
      restaurant_id text not null,
      platform text not null,
      handle text,
      url text not null,
      status text,
      association_basis text,
      confidence text,
      review_state text,
      observed_at text,
      last_verified_at text
    );

    create table first_party_link_hubs (
      restaurant_id text not null,
      platform text not null,
      handle text,
      url text not null,
      status text,
      association_basis text,
      confidence text,
      review_state text,
      observed_at text,
      last_verified_at text
    );

    create table first_party_feeds (
      restaurant_id text not null,
      url text not null,
      type text,
      title text,
      status text,
      association_basis text,
      confidence text,
      review_state text,
      observed_at text,
      last_verified_at text
    );

    create table first_party_related_links (
      restaurant_id text not null,
      kind text not null,
      label text,
      url text not null,
      association_basis text,
      confidence text,
      review_state text,
      observed_at text,
      last_verified_at text
    );

    create table website_feed_posts (
      restaurant_id text not null,
      restaurant_name text,
      title text not null,
      excerpt text,
      post_url text not null,
      feed_url text not null,
      media_url text,
      published_at text,
      observed_at text,
      signal_matches_json text not null,
      source_kind text,
      association_basis text,
      confidence text,
      review_state text
    );

    create table meta_social_posts (
      restaurant_id text not null,
      restaurant_name text,
      platform text not null,
      profile_handle text,
      profile_url text,
      platform_object_id text,
      post_id text,
      post_url text not null,
      title text not null,
      summary text,
      media_type text,
      media_url text,
      thumbnail_url text,
      published_at text,
      observed_at text,
      signal_matches_json text not null,
      source_kind text,
      association_basis text,
      confidence text,
      review_state text
    );

    create table recent_social_posts (
      id text primary key,
      restaurant_id text not null,
      restaurant_name text,
      platform text not null,
      source_family text not null,
      source_label text,
      source_kind text,
      post_id text,
      platform_object_id text,
      profile_handle text,
      profile_url text,
      feed_url text,
      post_url text not null,
      media_url text,
      thumbnail_url text,
      media_type text,
      title text not null,
      summary text not null,
      primary_category text not null,
      primary_category_label text,
      published_at text,
      observed_at text,
      age_days integer,
      is_recent integer not null,
      lookback_days integer,
      confidence_score real,
      confidence text,
      review_state text,
      association_basis text,
      categories_json text not null,
      matched_terms_json text not null
    );

    create table recent_social_post_categories (
      post_id text not null references recent_social_posts(id),
      category text not null,
      label text,
      matched_terms_json text not null
    );

    create table recent_social_post_terms (
      post_id text not null references recent_social_posts(id),
      term text not null
    );

    create table review_queue (
      restaurant_id text,
      item_type text not null,
      item_id text,
      reason text not null,
      source_url text,
      observed_at text
    );

    create index idx_recent_social_posts_restaurant on recent_social_posts(restaurant_id);
    create index idx_recent_social_posts_category on recent_social_posts(primary_category);
    create index idx_recent_social_posts_published on recent_social_posts(published_at);
    create index idx_recent_social_posts_review_state on recent_social_posts(review_state);
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
            dumps(restaurant.get("cuisines", [])),
            dumps(restaurant.get("vibe", [])),
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
            dumps(signal.get("keywordHits", [])),
            dumps(signal.get("signalMatches", {})),
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
                dumps(link.get("signalMatches", {})),
            ),
        )

for record in first_party_sources.get("records", []):
    restaurant_id = record.get("restaurantId")
    cur.execute(
        "insert or replace into first_party_sources values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            restaurant_id,
            record.get("name"),
            record.get("website"),
            record.get("sourceKind"),
            record.get("observedAt"),
            record.get("lastVerifiedAt"),
            record.get("reviewState"),
            len(record.get("socialProfiles", []) or []),
            len(record.get("linkHubs", []) or []),
            len(record.get("relatedLinks", []) or []),
            len(record.get("feeds", []) or []),
        ),
    )
    for profile in record.get("socialProfiles", []) or []:
        cur.execute(
            "insert into first_party_social_profiles values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (restaurant_id, profile.get("platform"), profile.get("handle"), profile.get("url"), profile.get("status"), profile.get("associationBasis"), profile.get("confidence"), profile.get("reviewState"), profile.get("observedAt"), profile.get("lastVerifiedAt")),
        )
    for hub in record.get("linkHubs", []) or []:
        cur.execute(
            "insert into first_party_link_hubs values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (restaurant_id, hub.get("platform"), hub.get("handle"), hub.get("url"), hub.get("status"), hub.get("associationBasis"), hub.get("confidence"), hub.get("reviewState"), hub.get("observedAt"), hub.get("lastVerifiedAt")),
        )
    for feed in record.get("feeds", []) or []:
        cur.execute(
            "insert into first_party_feeds values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (restaurant_id, feed.get("url"), feed.get("type"), feed.get("title"), feed.get("status"), feed.get("associationBasis"), feed.get("confidence"), feed.get("reviewState"), feed.get("observedAt"), feed.get("lastVerifiedAt")),
        )
    for link in record.get("relatedLinks", []) or []:
        cur.execute(
            "insert into first_party_related_links values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (restaurant_id, link.get("kind"), link.get("label"), link.get("url"), link.get("associationBasis"), link.get("confidence"), link.get("reviewState"), link.get("observedAt"), link.get("lastVerifiedAt")),
        )

for post in website_feed_signals.get("posts", []) or []:
    cur.execute(
        "insert into website_feed_posts values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            post.get("restaurantId"),
            post.get("restaurantName"),
            post.get("title"),
            post.get("excerpt"),
            post.get("postUrl"),
            post.get("feedUrl"),
            post.get("mediaUrl"),
            post.get("publishedAt"),
            post.get("observedAt"),
            dumps(post.get("signalMatches", {})),
            post.get("sourceKind"),
            post.get("associationBasis"),
            post.get("confidence"),
            post.get("reviewState"),
        ),
    )

for post in social_signals.get("posts", []) or []:
    cur.execute(
        "insert into meta_social_posts values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            post.get("restaurantId"),
            post.get("restaurantName"),
            post.get("platform"),
            post.get("profileHandle"),
            post.get("profileUrl"),
            post.get("platformObjectId"),
            post.get("postId"),
            post.get("postUrl"),
            post.get("title"),
            post.get("summary"),
            post.get("mediaType"),
            post.get("mediaUrl"),
            post.get("thumbnailUrl"),
            post.get("publishedAt"),
            post.get("observedAt"),
            dumps(post.get("signalMatches", {})),
            post.get("sourceKind"),
            post.get("associationBasis"),
            post.get("confidence"),
            post.get("reviewState"),
        ),
    )

for post in recent_posts.get("records", []) or []:
    cur.execute(
        "insert into recent_social_posts values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            post.get("id"),
            post.get("restaurantId"),
            post.get("restaurantName"),
            post.get("platform"),
            post.get("sourceFamily"),
            post.get("sourceLabel"),
            post.get("sourceKind"),
            post.get("postId"),
            post.get("platformObjectId"),
            post.get("profileHandle"),
            post.get("profileUrl"),
            post.get("feedUrl"),
            post.get("postUrl"),
            post.get("mediaUrl"),
            post.get("thumbnailUrl"),
            post.get("mediaType"),
            post.get("title"),
            post.get("summary"),
            post.get("primaryCategory"),
            post.get("primaryCategoryLabel"),
            post.get("publishedAt"),
            post.get("observedAt"),
            post.get("ageDays"),
            1 if post.get("isRecent") else 0,
            post.get("lookbackDays"),
            post.get("confidenceScore"),
            post.get("confidence"),
            post.get("reviewState"),
            post.get("associationBasis"),
            dumps(post.get("categories", [])),
            dumps(post.get("matchedTerms", [])),
        ),
    )
    for category in post.get("categories", []) or []:
        cur.execute(
            "insert into recent_social_post_categories values (?, ?, ?, ?)",
            (post.get("id"), category.get("id"), category.get("label"), dumps(category.get("terms", []))),
        )
    for term in post.get("matchedTerms", []) or []:
        cur.execute("insert into recent_social_post_terms values (?, ?)", (post.get("id"), term))
    if post.get("reviewState") in {"needs_date_review", "needs_category_review"}:
        cur.execute(
            "insert into review_queue values (?, ?, ?, ?, ?, ?)",
            (post.get("restaurantId"), "recent_social_post", post.get("id"), post.get("reviewState"), post.get("postUrl"), post.get("observedAt")),
        )

conn.commit()
conn.close()
print(
    f"Built SQLite database at {db_path} with {len(catalog['restaurants'])} restaurants, "
    f"{len(first_party_sources.get('records', []))} first-party source records, "
    f"{len(website_feed_signals.get('posts', []) or [])} website feed posts, "
    f"{len(social_signals.get('posts', []) or [])} Meta social posts, and "
    f"{len(recent_posts.get('records', []) or [])} normalized recent post records."
)
