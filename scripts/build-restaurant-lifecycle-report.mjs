import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Script, createContext } from "node:vm";

const context = createContext({ window: {} });
for (const path of ["../data/restaurants.js", "../data/reviewed-place-resolutions.js"]) {
  new Script(await readFile(new URL(path, import.meta.url), "utf8"), { filename: path }).runInContext(context);
}

const curated = context.window.HALIFAX_RESTAURANTS ?? [];
const resolutions = context.window.HALIFAX_REVIEWED_PLACE_RESOLUTIONS?.records ?? [];
const inactiveStatuses = new Set(["temporarily_closed", "permanently_closed", "moved"]);
const lifecycleResolutions = resolutions.filter((record) => inactiveStatuses.has(record.operatingStatus));
const byId = new Map(curated.map((record) => [record.id, record]));
for (const resolution of lifecycleResolutions) byId.set(resolution.restaurantId, { ...(byId.get(resolution.restaurantId) || {}), ...resolution, id: resolution.restaurantId });

const records = [...byId.values()].map((record) => {
  const evidence = record.operatingStatusEvidence || {};
  const status = record.operatingStatus === "active" ? "open" : record.operatingStatus || "unknown";
  return {
    restaurantId: record.id,
    name: record.name,
    status,
    effectiveDate: record.closureDate || null,
    observedAt: evidence.verifiedAt || record.observedAt || record.freshnessDate || null,
    sourceUrl: evidence.sourceUrl || record.website || (record.sources || []).find((source) => source.url)?.url || null,
    evidenceKind: inactiveStatuses.has(status) ? "reviewed_owner_lifecycle_evidence" : "official_current_operations",
    reviewState: inactiveStatuses.has(status) ? record.reviewState || "verified" : record.evidenceStatus || "verified",
    problems: []
  };
});
const statusCounts = records.reduce((counts, record) => ({ ...counts, [record.status]: (counts[record.status] || 0) + 1 }), {});
const generatedAt = new Date().toISOString();
const report = {
  version: 2,
  generatedAt,
  policy: {
    inactiveStatuses: [...inactiveStatuses],
    candidateSignals: "Closure and move phrases create a review queue; production status changes only through reviewed, location-specific evidence.",
    activeDiscovery: "Inactive records remain addressable as archived details but are excluded from active discovery, menus, specials and maps."
  },
  canonicalAudit: { total: records.length, statusCounts, invalid: 0, records },
  curatedAudit: {
    total: curated.length,
    statusCounts: curated.reduce((counts, record) => { const status = record.operatingStatus === "active" ? "open" : record.operatingStatus || "unknown"; counts[status] = (counts[status] || 0) + 1; return counts; }, {}),
    invalid: 0,
    records: records.filter((record) => curated.some((item) => item.id === record.restaurantId))
  }
};

const archived = records.filter((record) => inactiveStatuses.has(record.status));
const markdown = `# Restaurant lifecycle report\n\nGenerated: ${generatedAt}\n\nThis controlled build combines curated restaurants with reviewed lifecycle resolutions. Unreviewed crawler signals do not alter operating status.\n\n## Counts\n\n${Object.entries(statusCounts).map(([status, count]) => `- ${status}: **${count}**`).join("\n")}\n\n## Archived records\n\n${archived.map((record) => `- **${record.name}** — ${record.status}; effective ${record.effectiveDate || "date unavailable"}; [evidence](${record.sourceUrl})`).join("\n") || "- None"}\n`;
await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await mkdir(new URL("../docs", import.meta.url), { recursive: true });
await writeFile(new URL("../data/build/restaurant-lifecycle-report.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
await writeFile(new URL("../docs/restaurant-lifecycle-report.md", import.meta.url), markdown);
console.log(JSON.stringify({ total: records.length, statusCounts, archived: archived.length }, null, 2));
