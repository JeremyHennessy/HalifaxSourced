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

## Independent HOLD follow-up

Parent candidate feee152 remains preserved. Read-only independent review identified two missing denials: source-integrity.js uses the boolean quarantined convention, and app-admin.js/data/thumbnail-candidates.js use rightsStatus while collected public references use rightsState. The shared predicate now checks both rights fields and quarantine before choosing a permissive value. All supplied reviewState/reviewStatus, permission/usageRights/rights, license/licence, rightsBasis/rightsNote and explicit confirmation aliases are checked for conflicting denials or uncertainty. production_approved is a recognized candidate status, but never substitutes for specific permission evidence. No dataset changes in this follow-up.

The browser regression now inserts negative markup from all five renderers (officialUpdateCard, recentPostCard, socialPostReviewCard, adminCandidateCard, mediaImageMarkup), under the unchanged context gate. Eleven contradictory records cover quarantine, rights-state/status disagreement, normalization, review disagreement, permission aliases, false confirmation masked by true approval, unknown licence alias, and generic rights-note alias. Each retains title/source links where applicable and emits no image. Unknown-host request count is zero. Licensed/owner positives remain valid. Local asset paths reject dot traversal, ambiguous segments, encoded traversal and backslashes; six bounded path controls exercise this boundary.

The independent report and audit-results.json are preserved read-only outside the checkout. The feee152 review package is unchanged. Follow-up full UI output is captured as a complete log, alongside exact bounded control results, for independent review. No push or pipeline changes.
