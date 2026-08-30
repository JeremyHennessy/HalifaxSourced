# Recent post intelligence

Halifax Sourced keeps a local, source-backed feed of restaurant updates for specials, events, patio notices, menu changes, openings, live music, brunch, seasonal items, and other official updates.

The pipeline is intentionally split into three stages:

1. `scripts/import-first-party-feed-signals.mjs` pulls RSS/Atom entries discovered from restaurant-owned websites and stores bounded excerpts, source links, dates, media URLs declared by the feed, and keyword matches.
2. `scripts/import-meta-social.mjs` pulls Facebook and Instagram posts through Meta APIs when `META_FB_ACCESS_TOKEN`, `META_IG_ACCESS_TOKEN`, and `META_IG_USER_ID` are configured. It stores bounded summaries, source IDs, permalinks, timestamps, media URLs returned by the API, and keyword matches.
3. `scripts/build-recent-social-posts.mjs` normalizes feed and Meta API posts into `data/build/recent-social-posts.json` and `data/recent-social-posts.js` with stable IDs, summaries, categories, matched terms, confidence, recency, and review state.

Run locally:

```bash
node scripts/import-first-party-feed-signals.mjs
META_FB_ACCESS_TOKEN=... META_IG_ACCESS_TOKEN=... META_IG_USER_ID=... node scripts/import-meta-social.mjs
node scripts/build-recent-social-posts.mjs
python scripts/build-sqlite-db.py
```

If Meta credentials are missing, the Meta importer records the missing credential state and exits without attempting Facebook or Instagram HTML scraping.

## SQLite tables

`python scripts/build-sqlite-db.py` now creates these post/source tables in `data/build/halifax_sourced.sqlite`:

- `first_party_sources`
- `first_party_social_profiles`
- `first_party_link_hubs`
- `first_party_feeds`
- `first_party_related_links`
- `website_feed_posts`
- `meta_social_posts`
- `recent_social_posts`
- `recent_social_post_categories`
- `recent_social_post_terms`
- `review_queue`

Useful local queries:

```sql
select primary_category, count(*)
from recent_social_posts
group by primary_category
order by count(*) desc;

select restaurant_name, platform, title, primary_category, published_at, post_url
from recent_social_posts
order by coalesce(published_at, observed_at) desc
limit 50;

select reason, count(*)
from review_queue
group by reason;
```

## Guardrails

The app stores summaries, excerpts, IDs, links, timestamps, categories, and source metadata. It does not store unrestricted raw post bodies, private posts, login-wall scrape output, or social HTML. Use original source links for full details and current terms.
