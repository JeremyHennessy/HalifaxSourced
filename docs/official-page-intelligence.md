# Official page intelligence

`scripts/import-official-page-intelligence.mjs` performs a bounded public-web pass over restaurant-owned websites and official-site-linked pages. It is meant to fill the gap between sparse RSS feeds and Meta API access.

The importer may inspect the canonical website, official menu/event/order/reservation links, and other same-site pages whose URL or anchor text suggests menus, specials, events, happy hour, brunch, patios, openings, or related dining signals. It respects `robots.txt`, uses the Halifax Sourced user agent, limits pages per restaurant, applies request timeouts, and avoids login-restricted social-network HTML.

The generated files are:

- `data/website-page-intelligence.js`
- `data/build/website-page-intelligence.json`

Each record keeps only bounded review data:

- restaurant ID and name
- source URL
- concise title and excerpt
- optional candidate image URL
- observed/publication timestamps when available
- matched signal categories
- candidate follow-on links
- review state

The script does not retain full HTML, full article bodies, comments, reactions, or unrestricted social-media text. Records with uncertain dates remain review leads until approved or rejected through the admin/review workflow.
