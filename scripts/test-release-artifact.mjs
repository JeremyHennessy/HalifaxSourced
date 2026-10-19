import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const fixture = await mkdtemp(join(tmpdir(), 'halifax-release-'));
const source = join(fixture, 'source');
const release = join(fixture, 'release');
const sha = 'a'.repeat(40);
const runId = '12345';
let checks = 0;
const env = { ...process.env, RELEASE_SOURCE_DIR: source, RELEASE_DIR: release, SOURCE_COMMIT_SHA: sha, QUALITY_WORKFLOW_RUN_ID: runId };
function run(command, override = {}, success = true, message = '') {
  const result = spawnSync(process.execPath, [new URL('./release-artifact.mjs', import.meta.url).pathname, command], { env: { ...env, ...override }, encoding: 'utf8' });
  assert.equal(result.status === 0, success, message || result.stderr);
  checks++;
}
try {
  for (const directory of ['assets', 'data/build', 'vendor', 'docs']) await mkdir(join(source, directory), { recursive: true });
  await writeFile(join(source, 'index.html'), '<h1>Release fixture</h1>');
  await writeFile(join(source, '.nojekyll'), '');
  await writeFile(join(source, 'app-core.js'), 'const fixture = true;');
  await writeFile(join(source, 'data/build/deployment-metadata.json'), JSON.stringify({ sourceCommitSha: sha, qualityWorkflowRunId: runId, counts: { canonicalPlaces: 4, activePlaces: 3, archivedPlaces: 1, rightsApprovedMedia: 2 } }));
  await writeFile(join(source, 'data/build/content-coverage-report.json'), JSON.stringify({ sourceCommitSha: sha, restaurantCoverage: { totalCanonicalPlaces: 4, activeCanonicalPlaces: 3, archivedLifecyclePlaces: 1, withUsableMedia: 2 } }));
  run('build');
  run('verify');
  assert.equal(await readFile(join(release, '.nojekyll'), 'utf8'), ''); checks++;
  run('verify', { SOURCE_COMMIT_SHA: 'b'.repeat(40) }, false, 'Different source SHA must fail');
  run('verify', { QUALITY_WORKFLOW_RUN_ID: '54321' }, false, 'Different workflow run must fail');
  await writeFile(join(release, 'app-core.js'), 'const changed = true;');
  run('verify', {}, false, 'Changed tested application bytes must fail');
  run('build');
  await rm(join(release, 'index.html'));
  run('verify', {}, false, 'Missing tested file must fail');
  run('build');
  await writeFile(join(release, 'unreviewed.js'), 'unreviewed');
  run('verify', {}, false, 'Added untested file must fail');
  run('build');
  await symlink(join(source, 'index.html'), join(release, 'external.html'));
  run('verify', {}, false, 'Symlink must fail');
  const metadataFile = join(source, 'data/build/deployment-metadata.json');
  const metadata = JSON.parse(await readFile(metadataFile));
  metadata.counts.activePlaces = 4;
  await writeFile(metadataFile, JSON.stringify(metadata));
  run('build', {}, false, 'Coverage and deployment count mismatch must fail');
  console.log(`${checks} immutable-release regression checks passed.`);
} finally { await rm(fixture, { recursive: true, force: true }); }
