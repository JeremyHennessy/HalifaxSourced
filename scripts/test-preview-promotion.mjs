import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, symlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const scratch = mkdtempSync(join(tmpdir(), 'halifax-promotion-'));
const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const identity = cwd => { git(cwd, 'config', 'user.name', 'Promotion test'); git(cwd, 'config', 'user.email', 'test@example.invalid'); };
let assertions = 0;
try {
  // Feed the consumer the actual producer's complete upload manifest.
  const producer = readFileSync(join(root, '.github/workflows/source-expansion-preview.yml'), 'utf8');
  const paths = producer.split('name: source-expansion-preview')[1].split('path: |')[1].split('if-no-files-found:')[0].split('\n').map(s => s.trim()).filter(Boolean);
  const artifact = join(scratch, 'artifact');
  for (const path of paths) put(join(artifact, path), `fixture:${path}\n`);
  const destination = join(scratch, 'destination');
  const catalog = join(destination, 'data/build/catalog.json');
  put(catalog, 'release catalog must not be overwritten');
  const promote = () => spawnSync(process.execPath, [join(root, 'scripts/promote-preview-artifacts.mjs')], {
    cwd: destination, encoding: 'utf8', env: { ...process.env, ARTIFACT_DIR: artifact, ARTIFACT_NAME: 'source-expansion-preview' }
  });
  let result = promote();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(catalog, 'utf8'), 'release catalog must not be overwritten');
  const metadata = JSON.parse(readFileSync(join(destination, 'data/build/preview-promotion-metadata.json')));
  assert.equal(metadata.promotedFileCount, 25);
  assert.equal(metadata.reviewOnlyArtifactFiles.length, 13);
  assert.ok(!existsSync(join(destination, 'docs/thumbnail-coverage-attack-plan.md')));
  assert.equal(readFileSync(join(destination, 'data/official-site-signals.js'), 'utf8'), 'fixture:data/official-site-signals.js\n');
  assertions += 6;
  put(join(artifact, 'unexpected.txt'), 'reject');
  result = promote(); assert.notEqual(result.status, 0); assert.match(result.stderr, /unexpected files/); assertions += 2;
  rmSync(join(artifact, 'unexpected.txt'));
  rmSync(join(artifact, 'data/official-site-signals.js'));
  result = promote(); assert.notEqual(result.status, 0); assert.match(result.stderr, /missing required/); assertions += 2;
  symlinkSync(catalog, join(artifact, 'data/official-site-signals.js'));
  result = promote(); assert.notEqual(result.status, 0); assert.match(result.stderr, /symlink/); assertions += 2;

  // Exercise the workflow's real shell in fresh shallow clones, with and without
  // a pre-existing promotion branch, and with a competing remote update.
  const workflow = readFileSync(join(root, '.github/workflows/promote-preview-artifacts.yml'), 'utf8');
  const section = workflow.split('      - name: Commit promoted data\n')[1].split('\n      - name:')[0];
  const shell = section.split('        run: |\n')[1].split('\n').map(s => s.replace(/^          /, '')).join('\n')
    .replace(/\$\{\{ steps.preview.outputs.artifact_name \}\}/g, 'city-events-preview');
  assert.match(shell, /--force-with-lease="refs\/heads\/\$branch:\$expected_sha"/); assertions++;
  const remote = join(scratch, 'remote.git'); const seed = join(scratch, 'seed');
  mkdirSync(seed); git(seed, 'init', '-b', 'main'); identity(seed);
  put(join(seed, 'data/build/base.json'), '{}'); git(seed, 'add', '.'); git(seed, 'commit', '-m', 'base');
  git(scratch, 'init', '--bare', remote); git(seed, 'remote', 'add', 'origin', remote); git(seed, 'push', 'origin', 'main');
  const branch = 'refs/heads/codex/promote-city-events-preview';
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const shim = join(scratch, 'bin', 'git');
  put(shim, `#!/bin/bash\nif [ "$1" = push ] && [ -n "$RACE_SHA" ]; then\n  "${realGit}" --git-dir="$RACE_REMOTE" update-ref "${branch}" "$RACE_SHA"\nfi\nexec "${realGit}" "$@"\n`); chmodSync(shim, 0o755);
  const run = (label, extra = {}) => {
    const cwd = join(scratch, label);
    git(scratch, 'clone', '--depth=1', '--branch=main', `file://${remote}`, cwd);
    put(join(cwd, 'data/change.json'), JSON.stringify({ label }));
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', shell], {
      cwd, encoding: 'utf8', env: { ...process.env, RUNNER_TEMP: scratch, GITHUB_OUTPUT: join(scratch, 'outputs'), ...extra }
    });
    return { ...result, cwd };
  };
  let pushed = run('initial'); assert.equal(pushed.status, 0, pushed.stderr); assertions++;
  const first = git(scratch, '--git-dir=' + remote, 'rev-parse', branch);
  pushed = run('existing'); assert.equal(pushed.status, 0, pushed.stderr);
  assert.notEqual(git(scratch, '--git-dir=' + remote, 'rev-parse', branch), first); assertions += 2;
  put(join(seed, 'data/racer.json'), '{}'); git(seed, 'add', '.'); git(seed, 'commit', '-m', 'competing writer'); git(seed, 'push', 'origin', 'HEAD:refs/heads/race-object');
  const raceSha = git(seed, 'rev-parse', 'HEAD');
  pushed = run('race', { PATH: dirname(shim) + ':' + process.env.PATH, RACE_REMOTE: remote, RACE_SHA: raceSha });
  assert.notEqual(pushed.status, 0); assert.match(pushed.stderr, /stale info/);
  assert.equal(git(scratch, '--git-dir=' + remote, 'rev-parse', branch), raceSha); assertions += 3;
  pushed = run('retry'); assert.equal(pushed.status, 0, pushed.stderr); assertions++;
  console.log(`Preview promotion: ${assertions} assertions passed (producer contract, review-only isolation, malformed artifacts, initial/existing/racing/retried branch pushes).`);
} finally { rmSync(scratch, { recursive: true, force: true }); }
