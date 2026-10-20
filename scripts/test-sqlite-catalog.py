"""Verify SQLite preserves catalog identities and unknown source scores."""
import json
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
catalog = json.loads((root / "data/build/catalog.json").read_text(encoding="utf-8"))
expected = {row["id"]: row.get("qualityScore") for row in catalog["restaurants"]}
with sqlite3.connect(f"file:{root / 'data/build/halifax_sourced.sqlite'}?mode=ro", uri=True) as conn:
    contract = {key: json.loads(value) for key, value in conn.execute("select key, value from export_contract")}
    assert contract["scope"] == "partial_research_export"
    assert "structured-place-facts" in contract["omittedDatasets"]
    assert contract == json.loads((root / "data/build/sqlite-export-contract.json").read_text())
    actual = dict(conn.execute("select id, source_coverage_score from restaurants"))
    assert actual == expected, "SQLite identities or source coverage scores differ from the catalog"
    assert conn.execute("pragma integrity_check").fetchone()[0] == "ok"

review = json.loads((root / "data/reviewed-regional-restaurants.json").read_text(encoding="utf-8"))
for row in review["accepted"]:
    assert actual[row["id"]] is None, f"Unmeasured score was fabricated for {row['id']}"
print(f"SQLite catalog parity passed: {len(actual)} IDs and {len(review['accepted'])} unmeasured regional scores preserved.")
