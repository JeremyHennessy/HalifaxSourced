# Manual ECCC refresh readiness

This change enables only the existing guarded ECCC Halifax city-page source for a first bounded live acceptance. It does not add an automatic schedule, broaden geography, change request limits, add credentials or bypass access holds. The source's `scheduleEnabled` value remains false and the workflow has no cron.

The previously admitted endpoint, expected city/station IDs, byte/deadline limits, original snapshots and exact-run continuity safeguards are unchanged. New source facts are not claimed until a real successful response is validated. Publication remains a separate weather-only review, full quality gate, merge and exact live-asset verification.

Before dispatch, verify this change's exact main commit and the workflow's genuinely unused run history. The first ever manual run may use explicit initialization; no later run may reset missing or failed predecessor state. Verify its durable journal, response, hashes, clocks and exact payload/final-receipt cache saves. After the 55-minute minimum, a second run must prove exact predecessor restoration. No automatic polling is activated by this readiness change.

This is an official-forecast component, not a claim that multi-model aggregation or improved prediction accuracy is complete. The independently developed model comparison must retain its own source admission, geographic coverage, evidence and validation limits.
