import { readFile, writeFile } from "node:fs/promises";

const report = JSON.parse(await readFile(new URL("../data/build/content-coverage-report.json", import.meta.url), "utf8"));
const rc = report.restaurantCoverage || {};
const ea = report.eventCoverage || {};
const total = rc.totalCanonicalPlaces || 0;
const pct = (value) => total ? `${((Number(value || 0) / total) * 100).toFixed(1)}%` : "0.0%";
const rows = [
  ["Canonical places", total], ["Active canonical places", rc.activeCanonicalPlaces], ["Archived lifecycle places", rc.archivedLifecyclePlaces],
  ["Official website", rc.withOfficialWebsite], ["Verified/reachable official website", rc.withVerifiedOfficialWebsite],
  ["Menu link", rc.withMenuLink], ["Verified menu link", rc.withVerifiedMenuLink], ["Phone", rc.withPhone],
  ["Hours", rc.withStructuredOrSourceHours], ["At least one social profile", rc.withAtLeastOneSocialProfile],
  ["Usable rights-approved media", rc.withUsableMedia], ["Coordinates", rc.withCoordinates], ["Neighbourhood", rc.withNeighbourhood]
];
const markdown = `# Halifax Sourced content coverage snapshot

Generated: ${report.generatedAt}
${report.sourceCommitSha ? `Source/deployment commit: \`${report.sourceCommitSha}\`` : "Source/deployment commit: supplied by CI for deployable snapshots."}

This is the reconciled snapshot produced from the same data layers packaged for deployment. Unknown values remain unknown; source leads are not promoted to verified facts.

## Restaurant coverage

| Metric | Places | Coverage |
| --- | ---: | ---: |
${rows.map(([label, value]) => `| ${label} | ${Number(value || 0).toLocaleString()} | ${pct(value)} |`).join("\n")}

## Restaurant-event definitions

- **${ea.canonicalRestaurantsWithStructuredUpcomingEvents || 0} canonical restaurants with upcoming structured events** is a distinct-place count.
- **${ea.upcomingStructuredRestaurantEventRecords || 0} upcoming structured restaurant event records** is an event-record count; one restaurant can have multiple events.
- ${ea.structuredRestaurantEvents || 0} total structured restaurant event records are stored, including ${ea.expiredStructuredRestaurantEvents || 0} expired records.

## Lifecycle

- Inactive records remain directly addressable as archived details.
- Permanently closed, temporarily closed, and moved records are excluded from active discovery, menus, specials, and maps.
- Official closure or move language creates a review candidate and never changes production status automatically.

## Source failures

${Object.entries(report.sourceFailures || {}).map(([key, value]) => `- ${key}: ${value}`).join("\n")}

Machine-readable definitions, percentages, gap queues, and counts are in \`data/build/content-coverage-report.json\`. Exact-SHA deployment metadata is in \`data/build/deployment-metadata.json\` in CI and the deployed Pages artifact.
`;
await writeFile(new URL("../docs/content-coverage-report.md", import.meta.url), markdown);
console.log("Rendered reconciled content coverage report.");
