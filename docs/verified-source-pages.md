# Verified menu and specials source pages

Halifax Sourced distinguishes a keyword signal from a verified direct source page.

`data/verified-source-pages.js` contains only direct menu/specials links that were observed on a restaurant's official website and then passed the source-page verification contract. It does **not** claim that a specific special, price, dish, or service is currently available unless separate structured data establishes that fact.

## Verification contract

For first-party links on the restaurant's own domain, the verifier:

- uses the existing official-site signal dataset as the candidate source
- consults `robots.txt`
- requests pages serially with a named Halifax Sourced user agent
- requires a reachable HTML or PDF response
- validates the restaurant street address for multi-location `/restaurants/...` or `/locations/...` pages when an address is available
- records the final resolved URL, content type, observation time, and verification time

For a menu/specials link that the restaurant's own site deliberately sends to another host, Halifax Sourced records the link as `official_outbound_link` but does not crawl the third-party destination. The evidence is therefore only that the official restaurant site linked to that destination at the observation time.

## Production record

Each record must contain:

- exact `restaurantId`
- `kind`: `menu` or `specials`
- direct `url`
- short official link `label`
- `sourceWebsite`
- `sourceKind`: `official_page` or `official_outbound_link`
- `verificationMethod`
- valid `observedAt` and `verifiedAt`
- `reviewState: verified`

The data-integrity gate rejects unknown restaurant IDs, malformed URLs/dates, unsupported kinds/source types, and duplicate records.

## Preview and publication

The `Verified Source Pages Preview` workflow is intentionally manual and non-mutating. It generates an artifact for review. Production publication should copy the reviewed generated manifest into a separate branch, pass the full Quality Gate, merge to `main`, and then allow the gated Pages deployment to publish the exact verified SHA.
