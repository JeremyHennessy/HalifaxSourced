# Local media-rights follow-up

Base: 4d384b12b6b9ce7021ccd292fc5a67c9db00b2e2. Branch: codex/local-media-rights-followup. Local only; no publication or pipeline changes.

The shared media eligibility predicate requires approved review, explicit permission, permitted source type, creator, specific licence/rights basis, and a safe provenance URL. Public-reference, unverified, unknown, and restricted rights states override approval flags. Generic first-party website/remote-reference rationale is insufficient evidence. This classifies uncertainty; it does not assert that permission cannot exist.

Consumer path trace:
- Home and recent-post/event-home lists: recentPostCard -> permittedPostMediaUrl.
- Restaurant official-update detail cards: officialUpdateCard -> permittedPostMediaUrl.
- Explore cards, restaurant details, menus/specials, structured restaurant events and map rows: mediaImageMarkup/permittedImageClass -> permittedImageFor -> shared eligibility.
- Public city-event cards use decorative CSS and factual source links, no record image renderer.
- Admin candidate/social previews also use the same eligibility boundary; original image/source links remain available for rights review. The legacy admin export can still produce generic permission claims, but these are rejected by both consumer eligibility and the manifest checker.
- Map tiles remain separately bounded by the unchanged offline tile controls. Static app icons are not collected source media.

Metadata-only audit: current baseline has 106 records, not the previously reported 107. Of these, 99 carry generic first-party/remote-reference claims without an additional specific licence or grant field. Their full previous records are retained in data/audit/media-rights-reclassification.json. The records and source URLs remain in the manifest with unverified rights, unknown permission, false confirmation, and rights_review_required. The queue/report now count seven approved and 110 pending. Seven local CC assets are byte-unchanged; the existing local-restaurant policy excludes Smitty's at runtime, leaving six consumer-eligible images. No owner-authorized records were found in this current manifest; explicit owner-authorized controls remain eligible.

No collector/network refetch, fixture-manifest expansion, CI rerun, remote push, merge, deployment, workflow edits, or permission changes. Original CI 37408531361 failure and artifact evidence remain in the parent workspace. Immutable deployment-artifact provenance remains a release blocker.

Validation: full verify-ui passed with the unchanged frozen external-resource manifest; licensed image success/failure controls passed at desktop/mobile; manifest rights checker and local asset-repair tests passed. New browser controls exercise public-reference/unverified/unknown/restricted overrides, missing confirmation, generic licence rejection, source/text retention, Home/detail/shared restaurant media paths, and zero requests to unknown unlicensed hosts. The new standalone rights test is not wired into CI because pipeline changes are pending independent review.
