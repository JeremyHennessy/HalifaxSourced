# Browser CI follow-up, held for independent review

The accepted `dbafa8b` remains the published draft PR head. CI run
37403445265 passed data-integrity and failed browser verification on its
obsolete minimum of 40 current offers. The original log is retained outside
the checkout. Local commit `06edfff` replaced that quota but was not pushed.

The latest local follow-up adds fixed-clock rendering controls at
2026-10-06 02:00 UTC for desktop and mobile: a valid current offer must render
as a verified card and detail row. Stale, old-verification, future,
expired, wrong-identity, wrong-location, quarantined, unsafe-source and
URL-only records must not render as current; their verified filter is empty
and detail notice says current availability is unverified. Fixtures exist
only in the test browser. The unchanged accepted source snapshot retains
160 records, zero current and 55 stale. These controls pass.

Saved local detachment logs identify an image-scroll operation but contain
no original request URL/status. They do not prove a harmless network flake
or an app rerender. A separate network-isolated diagnostic reproduces image
error then removal while the card count and route stay intact. Production
`official-update-media` uses lazy loading and removes itself on error; the
old test scrolled that removable element. A successful controlled response
decodes and stays attached. The minimal test change scrolls the stable card
and still requires image decode. Exact model image URLs are fulfilled with
licensed local test bytes; this verifies rendering, not remote availability.

The deterministic 503 control also reproduced a real layout defect: the
card retained `has-media` and zero top padding after losing its image. The
app error handler now removes that class before removing the image. This is
an application fix, not a test-only change. Desktop/mobile success and
failure controls pass, retaining source text/link, restoring 17px padding,
preserving keyboard detail navigation, and producing no overflow. Each
control records its exact fixture URL/status; the successful case requires
no console errors, the failed case requires exactly one controlled 503
console error, and both reject unexpected script errors.

Full desktop/mobile `verify-ui.mjs` was run once after these fixes. It
completed its interaction assertions and stopped at the unchanged final
console-error gate on `ERR_NETWORK_ACCESS_DENIED` messages. This is a failed
full validation, not a green result. Its log is retained; no broader error
allowlist was introduced and no further full attempt was made. The focused
desktop/mobile consumer test passed. No remote CI rerun occurred.

Original CI quota failure, local detachment failures, controlled pre-fix
layout failure and positive controls are preserved in the review package.
The code remains local pending independent review. No merge or deployment
is authorized.

## Frozen resource gate and geometry correction

The later local implementation removes all model-derived feed-image route
handlers. One exact URL + GET method + image type gate covers the full UI
flow and feed/offer/tile controls. Unknown URLs, wrong methods and wrong
resource types are blocked before transmission and fatal. The static manifest
contains 85 discovered resources, one explicit feed control, and one manually
declared aFrite image already present in accepted data. That last URL first
triggered a fatal unknown in the fixture flow; its log/evidence is retained.
There is no automatic expansion, arbitrary-host rule or console allowance.

A targeted offline diagnostic reproduced 13px Narrows overflow before and
after image failure. The live-music source row extended to x=403px in the
390px viewport. Its grid item/flex sizing allowed nowrap timing text to set
the minimum width. A minimal row/text sizing constraint now produces zero
overflow in both loaded-image and intentional-404 fallback states. The full
browser flow explicitly asserts fallback row bounds and viewport width.

Desktop/mobile fixed-clock offer controls, exact-URL feed image controls,
fatal-unknown gate controls, real 256px tile decode and bounded tile-failure
map/list controls pass locally. Errors are attributed to exact declared
URLs/statuses and checked after the last interaction. Tile controls preserve
the desktop visible result list and exercise the mobile List toggle; marker
selection highlights the same retained row even with failed tiles. The full
desktop/mobile UI flow now passes with synthetic frozen resources. This
does not certify real-source availability or media rights.

## Release provenance blocker

Inspection of deploy-pages-gated.yml confirms that, after a successful main
Quality Gate, deployment checks out that code SHA but runs public-special,
review-directory and thumbnail source builds again. Quality Gate's UI job
also currently builds data separately from its data-integrity job. Therefore
green code CI alone does not identify one immutable tested data/site artifact.
No merge should trigger this deployment path until a reviewed gate binds the
release to the same validated and browser-tested artifact, with receipts for
every file and source SHA/run, or an equivalent explicit provenance gate
validates any changed data. No deployment workflow or credentials were changed
by this fixture patch.
