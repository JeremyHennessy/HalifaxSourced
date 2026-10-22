# Successful receipts and freshness

The October 22, 2026 review reproduced two fail-open freshness paths without collecting new source content:

- Official-site failures carry an attempt timestamp. The coverage builder previously treated that timestamp as restaurant evidence, even for timeouts, robots restrictions and HTTP failures. It now uses only the latest valid, nonfuture successful official receipt, while retaining failures in diagnostics and preserving independent accepted evidence.
- Link-audit release validation previously accepted missing, malformed and future report timestamps. The release gate now rejects those dates in both the report and its observations. Recent-observation reuse also requires a nonempty matching source revision and a valid, nonfuture observation within one hour. Reuse preserves the original observation time. Lifecycle reporting cannot call an invalid or stale link-audit report current.

On the accepted source snapshot evaluated at October 22, 00:00 UTC, 45 restaurant records changed from 30–90-day evidence to unknown freshness. These records had been dated solely by failed official checks. Unknown freshness is not a closure claim or a new failure. All 51 canonical official-check failures remain visible. No restaurant fact, identity, image approval or source observation was refreshed by this repair.

`test-coverage-freshness.mjs` exercises the actual report builder with failed, successful, missing, malformed, future and duplicate observations. `test-link-audit-freshness.mjs` exercises the release validator and source-link entry point with mocked network responses, including preservation of reused receipt clocks. The lifecycle regression covers invalid report timestamps. These tests run in isolated fixtures and do not mutate accepted snapshots or contact public sources.
