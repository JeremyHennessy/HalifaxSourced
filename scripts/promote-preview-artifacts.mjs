import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import process from "node:process";

const PROMOTED_FILES_BY_ARTIFACT = {
  "source-expansion-preview": [
    "data/official-site-signals.js",
    "data/build/official-site-signals.json",
    "data/verified-source-pages.js",
    "data/build/verified-source-pages.json",
    "data/structured-events.js",
    "data/build/structured-events.json",
    "data/patio-directory-facts.js",
    "data/build/patio-directory-facts.json",
    "data/public-special-source-leads.js",
    "data/build/public-special-source-leads.json",
    "data/first-party-sources.js",
    "data/build/first-party-sources.json",
    "data/website-feed-signals.js",
    "data/build/website-feed-signals.json",
    "data/website-page-intelligence.js",
    "data/build/website-page-intelligence.json",
    "data/social-signals.js",
    "data/build/social-signals.json",
    "data/recent-social-posts.js",
    "data/build/recent-social-posts.json",
    "data/reviewed-social-posts.js",
    "data/build/reviewed-social-posts.json",
    "data/thumbnail-candidates.js",
    "data/build/thumbnail-candidates.json",
    "data/build/thumbnail-coverage-report.json"
  ],
  "social-source-preview": [
    "data/first-party-sources.js",
    "data/build/first-party-sources.json",
    "data/website-feed-signals.js",
    "data/build/website-feed-signals.json",
    "data/social-signals.js",
    "data/build/social-signals.json",
    "data/recent-social-posts.js",
    "data/build/recent-social-posts.json",
    "data/thumbnail-candidates.js",
    "data/build/thumbnail-candidates.json",
    "data/build/thumbnail-coverage-report.json"
  ],
  "city-events-preview": [
    "data/city-events.js",
    "data/build/city-events.json",
    "data/build/event-entity-resolution.json"
  ]
};

const REVIEW_ONLY_FILES_BY_ARTIFACT = {
  "source-expansion-preview": [
    "docs/thumbnail-coverage-report.md",
    "artifacts/data-integrity-report.json",
    "artifacts/expanded-source-integrity-report.json",
    "artifacts/thumbnail-candidates-report.json",
    "artifacts/thumbnail-coverage-report.json",
    "artifacts/patio-directory-facts-report.json",
    "artifacts/public-special-source-leads-report.json"
  ],
  "social-source-preview": [
    "docs/thumbnail-coverage-report.md",
    "artifacts/expanded-source-integrity-report.json",
    "artifacts/thumbnail-candidates-report.json",
    "artifacts/thumbnail-coverage-report.json"
  ],
  "city-events-preview": [
    "artifacts/city-event-source-drift-report.json",
    "artifacts/city-event-integrity-report.json",
    "artifacts/event-entity-resolution-report.json",
    "artifacts/city-event-additions-report.json"
  ]
};

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function toPosix(filePath) {
  return filePath.split(sep).join("/");
}

function assertSafeRelativePath(filePath) {
  if (!filePath || filePath.startsWith("../") || filePath.includes("/../") || isAbsolute(filePath)) {
    throw new Error(`Unsafe artifact path: ${filePath}`);
  }
}

async function listFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = resolve(current, entry.name);
    const relativePath = toPosix(relative(root, absolutePath));
    assertSafeRelativePath(relativePath);

    if (entry.isSymbolicLink()) {
      throw new Error(`Refusing to promote symlink from artifact: ${relativePath}`);
    }

    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, absolutePath)));
      continue;
    }

    if (!entry.isFile()) {
      throw new Error(`Refusing to promote unsupported artifact entry: ${relativePath}`);
    }

    files.push(relativePath);
  }

  return files;
}

function ensureInsideRepo(repoRoot, targetPath) {
  const relativePath = relative(repoRoot, targetPath);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`Refusing to write outside repository: ${targetPath}`);
  }
}

async function main() {
  const artifactName = process.env.ARTIFACT_NAME;
  const artifactDir = process.env.ARTIFACT_DIR;
  const repoRoot = process.cwd();

  if (!artifactName || !PROMOTED_FILES_BY_ARTIFACT[artifactName]) {
    fail(`Unsupported ARTIFACT_NAME: ${artifactName || "<missing>"}`);
    return;
  }

  if (!artifactDir) {
    fail("ARTIFACT_DIR is required.");
    return;
  }

  const artifactRoot = resolve(artifactDir);
  const promotedFiles = new Set(PROMOTED_FILES_BY_ARTIFACT[artifactName]);
  const knownFiles = new Set([
    ...PROMOTED_FILES_BY_ARTIFACT[artifactName],
    ...(REVIEW_ONLY_FILES_BY_ARTIFACT[artifactName] || [])
  ]);

  const artifactFiles = (await listFiles(artifactRoot)).sort();
  const unexpectedFiles = artifactFiles.filter((filePath) => !knownFiles.has(filePath));
  if (unexpectedFiles.length > 0) {
    fail(`Artifact contains unexpected files:\n${unexpectedFiles.map((filePath) => `- ${filePath}`).join("\n")}`);
    return;
  }

  const missingPromotedFiles = [...promotedFiles].filter((filePath) => !artifactFiles.includes(filePath));
  if (missingPromotedFiles.length > 0) {
    fail(`Artifact is missing required promotion files:\n${missingPromotedFiles.map((filePath) => `- ${filePath}`).join("\n")}`);
    return;
  }

  for (const filePath of artifactFiles) {
    if (!promotedFiles.has(filePath)) {
      continue;
    }

    assertSafeRelativePath(filePath);
    const sourcePath = resolve(artifactRoot, ...filePath.split("/"));
    const targetPath = resolve(repoRoot, ...filePath.split("/"));
    ensureInsideRepo(repoRoot, targetPath);
    await mkdir(dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
  }

  const metadataPath = resolve(repoRoot, "data/build/preview-promotion-metadata.json");
  ensureInsideRepo(repoRoot, metadataPath);
  await mkdir(dirname(metadataPath), { recursive: true });
  await writeFile(
    metadataPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        artifactName,
        artifactRunId: process.env.ARTIFACT_RUN_ID || null,
        sourceWorkflowName: process.env.SOURCE_WORKFLOW_NAME || null,
        sourceWorkflowRunUrl: process.env.SOURCE_WORKFLOW_RUN_URL || null,
        promotedFileCount: promotedFiles.size,
        promotedFiles: [...promotedFiles].sort(),
        reviewOnlyArtifactFiles: artifactFiles.filter((filePath) => !promotedFiles.has(filePath))
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  console.log(`Promoted ${promotedFiles.size} ${artifactName} files into data/ and data/build/.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
