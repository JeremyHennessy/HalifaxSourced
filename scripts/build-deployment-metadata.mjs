import { mkdir, readFile, writeFile } from "node:fs/promises";

async function json(path, fallback = {}) {
  try { return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8")); }
  catch { return fallback; }
}

const sourceCommitSha = process.env.SOURCE_COMMIT_SHA || process.env.GITHUB_SHA || null;
if (!sourceCommitSha || !/^[0-9a-f]{40}$/i.test(sourceCommitSha)) throw new Error("A full SOURCE_COMMIT_SHA or GITHUB_SHA is required for deployment metadata.");

const coverage = await json("data/build/content-coverage-report.json");
const lifecycle = await json("data/build/restaurant-lifecycle-report.json");
if (coverage.sourceCommitSha !== sourceCommitSha) throw new Error(`Coverage report SHA ${coverage.sourceCommitSha || "missing"} does not match deployment SHA ${sourceCommitSha}.`);

const metadata = {
  version: 1,
  generatedAt: new Date().toISOString(),
  sourceCommitSha,
  qualityWorkflowRunId: process.env.QUALITY_WORKFLOW_RUN_ID || null,
  deploymentWorkflowRunId: process.env.GITHUB_RUN_ID || null,
  coverageGeneratedAt: coverage.generatedAt || null,
  lifecycleGeneratedAt: lifecycle.generatedAt || null,
  counts: {
    canonicalPlaces: coverage.restaurantCoverage?.totalCanonicalPlaces ?? null,
    activePlaces: coverage.restaurantCoverage?.activeCanonicalPlaces ?? null,
    archivedPlaces: coverage.restaurantCoverage?.archivedLifecyclePlaces ?? null,
    rightsApprovedMedia: coverage.restaurantCoverage?.withUsableMedia ?? null,
    canonicalRestaurantsWithUpcomingStructuredEvents: coverage.restaurantCoverage?.withStructuredUpcomingEvents ?? null,
    upcomingStructuredRestaurantEventRecords: coverage.eventCoverage?.upcomingStructuredRestaurantEventRecords ?? null
  }
};

await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(new URL("../data/build/deployment-metadata.json", import.meta.url), JSON.stringify(metadata, null, 2) + "\n");
console.log(JSON.stringify(metadata, null, 2));
