# Bluenose II administrative navigation — 26 October 2026

## Accepted evidence, not a new merchant observation

The accepted October 21 menu audit already classifies Bluenose II's exact
WordPress login URL as `administrative_login_not_menu`. Its `redirect_to`
parameter names the exact `/wp-admin/nav-menus.php?action=locations` URL retained
in the September 4 first-party, structured-fact and official-site records.
The first-party link label is “Please select a menu in this location.” This is
site-administration navigation, not a diner-facing food menu.

Evidence remains in:

- `data/audit/menu-pointer-requalification-2026-10-21.json` and the unchanged
  `data/audit/menu-pointer-suppressions.json`;
- `data/build/first-party-sources.json` and its accepted JavaScript pair;
- `data/build/structured-place-facts.json` and its accepted JavaScript pair;
- the accepted official-page update titled “Log In … Bluenose II Restaurant —
  WordPress,” with its original missing publication date.

No endpoint was re-observed for this correction. A separate bounded collection
pass could not retrieve the robots policies for 7 Peppers Grill, Bluenose II or
Budapest Bisztro through the available web tool. Each result was **unavailable**,
not a robots disallow, HTTP denial, closure or evidence of a changed merchant
fact. No merchant content was requested and no retry or alternative route was
used. These unsuccessful policy lookups supply no source-observation timestamp.

## Defect and exact boundary

Against main `dd18a542e99e4e2831b3274cf389185fa9c24956`, the existing policy rejects
only the login URL for kind `menu`. Later first-party/structured decorators still
add its administrative destination as a menu. Neutral source/update rendering
also admits administrative navigation. The actual final detail renderer exposes:

1. the admin URL in Menu sources;
2. the same URL in related links;
3. the same URL in Source evidence;
4. the login URL in Latest official updates.

The repair adds exactly five restaurant/kind/URL rejections for
`osm-node-267592735-bluenose-ii`: the exact admin URL for `menu`, `source` and
`update`, and the already menu-rejected login URL for `source` and `update`.
There is no generic WordPress, domain-wide or other-restaurant rule. It does not
alter `safeSource`, access holds, robots policy, collector transport or schedules.

The legitimate `https://bluenoseii.ca/menu/` remains the first menu and remains
publicly linked. The homepage and reservation link are unchanged. No replacement
link, contact, hours, lifecycle state, offer, social association or media right is
inferred or promoted. Raw administrative records remain available for audit; only
their misleading consumer navigation is suppressed.

## Verification

The transport-denied `test-bluenose-admin-pointers.mjs` loads the actual browser
script order and executes the actual detail/source/related-link/update renderers.
It removes only this exact policy addition for the former-behaviour comparison.
At the reviewed snapshot:

- Administrative anchors fall from **4 to 0**; every other Bluenose anchor remains.
- Only Bluenose's derived `menuLinks` and `relatedLinks` lose the admin entry.
  Its `hasMenu` remains true; raw sources, updates and history are identical.
- All **653 other complete restaurant models and detail renders** are identical.
- All **654 source-freshness selections**, raw source payloads and original
  observation clocks are unchanged. Bluenose retains
  `2026-09-04T13:33:08.856Z`, not this review date.
- Repeated final lifecycle application is idempotent. Exact identity, URL and
  kind boundaries are tested, including unrelated admin paths and query variants.

The existing action-policy regression is extended only to expect the additional
one source and one update suppression. The original 31 menu-audit dispositions,
all other location policies and their regression checks remain intact.

`test-bluenose-admin-navigation.mjs` adds offline-resource browser coverage at
390, 900 and 1440 pixels, including Back/Forward, reload, legitimate-menu retention,
raw-evidence retention, model immutability and overflow. No external destination
is clicked or fetched. Local Chromium could not launch because its socket
operation was denied; this is **not** a local browser pass. Hosted exact-head
Quality Gate, gated deployment and live acceptance remain separate requirements.
