# Restaurant discovery sources

Halifax Sourced uses separate source tiers for established listings and newly opening restaurants. The goal is to reduce the lag between a restaurant opening and appearing in the app without presenting a local-news mention as if it were a fully verified first-party record.

## Directory sources

### NovaScotia.com tourism listings

`scripts/import-directory-restaurants.mjs` reads the public NovaScotia.com plain listings datasource and extracts Halifax Metro food-and-drink records, including the listing URL, address, website, coordinates, phone, and observation time when present.

This is treated as a public tourism-directory source. It can identify restaurants absent from the current curated/OpenStreetMap catalog, but it does not automatically create editorial ratings or claims.

### Downtown Halifax Business Commission

The same importer reads the Downtown Halifax Business Commission Food & Drink directory. It uses the directory search page to identify business records and only fetches details for names that are missing from the current catalog.

Downtown directory records retain the DHBC detail page as provenance. When the directory exposes an official website or social profile, that link is retained as a source target.

## Local opening watch

`scripts/import-opening-watch.mjs` monitors public local opening-news feeds. The first configured source is Halifax ReTales.

Opening-watch sources are discovery leads, not primary factual authority. The importer keeps only:

- extracted business name
- coarse opening state such as `open`, `opening`, or `coming_soon`
- a short location hint when parsable
- article title and source URL
- publication/observation timestamps
- review state and confidence

It does not retain full article bodies.

A lead is not automatically rendered as a restaurant. Promotion into `data/discovered-restaurants.js` requires an explicit reviewed entry in `data/discovery-overrides.json` or stronger source evidence.

## Current provisional opening: Sakaba

Sakaba is included as a provisional local-discovery record because a current Halifax opening report says the hand-roll-and-drinks restaurant is open on Lower Water Street beside the Brewery Market.

The production listing is deliberately conservative:

- neighbourhood: Waterfront
- address: Lower Water Street, Halifax
- cuisine: Japanese / hand rolls / cocktails
- evidence state: `needs-review`
- source: local opening report

The pipeline should replace the provisional details as soon as restaurant-owned website, official social, directory, OpenStreetMap, or licensed place evidence becomes available.

## Refresh and review

`.github/workflows/restaurant-discovery-preview.yml` runs daily and on demand. It:

1. refreshes tourism and downtown directory candidates;
2. refreshes local opening-watch leads;
3. rebuilds explicitly approved discovery records;
4. validates IDs, URLs, provenance, and retained fields;
5. uploads the result as a review artifact.

New candidates remain review-only until intentionally promoted. This avoids silently adding incorrect names, wrong locations, or closed/announced-but-not-open businesses to the public app.
