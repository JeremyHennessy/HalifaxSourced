import { createHash } from 'node:crypto';
import { generateSeoPages } from './generate-seo-pages.mjs';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.env.RELEASE_SOURCE_DIR || fileURLToPath(new URL('..', import.meta.url)));
const site = resolve(process.env.RELEASE_DIR || join(root, '.release-site'));
const receiptPath = 'data/build/release-manifest.json';
const sha = process.env.SOURCE_COMMIT_SHA;
const runId = process.env.QUALITY_WORKFLOW_RUN_ID;
if (!/^[a-f0-9]{40}$/.test(sha || '') || !/^\d+$/.test(runId || '')) throw Error('Exact source SHA and Quality Gate run ID are required');
if (site === root) throw Error('Release directory must be separate from source directory');

async function inventory(directory, prefix = '') {
  const files = {};
  for (const entry of (await readdir(join(directory, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw Error(`Unsupported release entry: ${path}`);
    if (entry.isDirectory()) Object.assign(files, await inventory(directory, path));
    else if (path !== receiptPath) files[path] = createHash('sha256').update(await readFile(join(directory, path))).digest('hex');
  }
  return files;
}

async function validateMetadata() {
  const metadata = JSON.parse(await readFile(join(site, 'data/build/deployment-metadata.json')));
  const coverage = JSON.parse(await readFile(join(site, 'data/build/content-coverage-report.json')));
  if (metadata.sourceCommitSha !== sha || coverage.sourceCommitSha !== sha) throw Error('Release metadata/coverage source SHA mismatch');
  if (String(metadata.qualityWorkflowRunId) !== runId) throw Error('Release Quality Gate run mismatch');
  for (const [key, field] of Object.entries({ canonicalPlaces: 'totalCanonicalPlaces', activePlaces: 'activeCanonicalPlaces', archivedPlaces: 'archivedLifecyclePlaces', rightsApprovedMedia: 'withUsableMedia' })) {
    if (metadata.counts?.[key] !== coverage.restaurantCoverage?.[field]) throw Error(`Release coverage count mismatch: ${key}`);
  }
}

if (process.argv[2] === 'build') {
  await rm(site, { recursive: true, force: true });
  await mkdir(site, { recursive: true });
  const rootFiles = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isFile() && (/\.(?:html|js|css|svg|ico|webmanifest)$/.test(entry.name) || ['.nojekyll', 'CNAME', 'robots.txt'].includes(entry.name)));
  for (const entry of rootFiles) await cp(join(root, entry.name), join(site, entry.name));
  for (const directory of ['assets', 'data', 'vendor', 'docs']) await cp(join(root, directory), join(site, directory), { recursive: true, dereference: false });
  await validateMetadata();
  const seo = await generateSeoPages({ sourceDir: root, siteDir: site });
  console.log('Generated source-backed SEO pages:', JSON.stringify(seo));
  const files = await inventory(site);
  await writeFile(join(site, receiptPath), JSON.stringify({ version: 1, sourceCommitSha: sha, qualityWorkflowRunId: runId, files }, null, 2) + '\n');
  console.log(`Built immutable release: ${Object.keys(files).length} files, ${sha}, Quality Gate ${runId}`);
} else if (process.argv[2] === 'verify') {
  const receipt = JSON.parse(await readFile(join(site, receiptPath)));
  if (receipt.sourceCommitSha !== sha || String(receipt.qualityWorkflowRunId) !== runId) throw Error('Release receipt provenance mismatch');
  const actual = await inventory(site);
  const expected = receipt.files || {};
  for (const path of new Set([...Object.keys(actual), ...Object.keys(expected)])) {
    if (!/^[a-f0-9]{64}$/.test(expected[path] || '') || actual[path] !== expected[path]) throw Error(`Release file mismatch: ${path}`);
  }
  if (!Object.hasOwn(expected, 'index.html') || !Object.hasOwn(expected, 'data/build/deployment-metadata.json')) throw Error('Release receipt missing mandatory files');
  await validateMetadata();
  console.log(`Verified immutable release: ${Object.keys(actual).length} files, ${sha}, Quality Gate ${runId}`);
} else throw Error('Usage: release-artifact.mjs build|verify');
