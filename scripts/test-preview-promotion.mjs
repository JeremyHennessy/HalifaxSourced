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
  const step = name => {
    const section = workflow.split(`      - name: ${name}\n`)[1];
    assert.ok(section, `Missing workflow step: ${name}`);
    return section.split('\n      - name:')[0];
  };
  const values = {
    'github.server_url': 'https://github.com',
    'github.repository': 'JeremyHennessy/HalifaxSourced',
    'steps.preview.outputs.artifact_name': 'city-events-preview',
    'steps.preview.outputs.run_id': '12345',
    'steps.preview.outputs.source_run_url': 'https://github.com/JeremyHennessy/HalifaxSourced/actions/runs/12345',
    'steps.commit.outputs.branch': 'codex/promote-city-events-preview'
  };
  const shellFor = (name, extra = {}) => step(name).split('        run: |\n')[1]
    .split('\n').map(s => s.replace(/^          /, '')).join('\n')
    .replace(/\$\{\{ ([\w.-]+) \}\}/g, (_, key) => {
      assert.ok(Object.hasOwn({ ...values, ...extra }, key), `Unresolved workflow expression: ${key}`);
      return { ...values, ...extra }[key];
    });
  const shell = shellFor('Commit promoted data');
  assert.match(shell, /--force-with-lease="refs\/heads\/\$branch:\$expected_sha"/); assertions++;
  const remote = join(scratch, 'remote.git'); const seed = join(scratch, 'seed');
  mkdirSync(seed); git(seed, 'init', '-b', 'main'); identity(seed);
  put(join(seed, 'data/build/base.json'), '{}'); git(seed, 'add', '.'); git(seed, 'commit', '-m', 'base');
  git(scratch, 'init', '--bare', remote); git(seed, 'remote', 'add', 'origin', remote); git(seed, 'push', 'origin', 'main');
  const branch = 'refs/heads/codex/promote-city-events-preview';
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const shim = join(scratch, 'bin', 'git');
  put(shim, `#!/bin/bash\nif [ "$1" = push ] && [ -n "$RACE_SHA" ]; then\n  "${realGit}" --git-dir="$RACE_REMOTE" update-ref "${branch}" "$RACE_SHA"\nfi\nexec "${realGit}" "$@"\n`); chmodSync(shim, 0o755);
  const run = (label, extra = {}, dataLabel = label) => {
    const cwd = join(scratch, label);
    git(scratch, 'clone', '--depth=1', '--branch=main', `file://${remote}`, cwd);
    put(join(cwd, 'data/change.json'), JSON.stringify({ label: dataLabel }));
    put(join(cwd, 'data/build/preview-promotion-metadata.json'), JSON.stringify({ artifactRunId: label }));
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', shell], {
      cwd, encoding: 'utf8', env: { ...process.env, RUNNER_TEMP: scratch, GITHUB_OUTPUT: join(scratch, 'outputs'), ...extra }
    });
    return { ...result, cwd };
  };
  let pushed = run('initial'); assert.equal(pushed.status, 0, pushed.stderr); assertions++;
  const first = git(scratch, '--git-dir=' + remote, 'rev-parse', branch);
  pushed = run('existing'); assert.equal(pushed.status, 0, pushed.stderr);
  const existing = git(scratch, '--git-dir=' + remote, 'rev-parse', branch);
  assert.notEqual(existing, first); assertions += 2;
  pushed = run('same-data', {}, 'existing');
  assert.equal(pushed.status, 0, pushed.stderr);
  assert.equal(git(scratch, '--git-dir=' + remote, 'rev-parse', branch), existing);
  assert.match(pushed.stdout, /keeping existing branch commit/);
  assert.equal(git(scratch, '--git-dir=' + remote, 'show', `${branch}:data/build/preview-promotion-metadata.json`), '{"artifactRunId":"existing"}');
  assertions += 4;

  // Identical preview data must not preserve stale code when main has advanced.
  put(join(seed, 'app.js'), '// main code update\n'); git(seed, 'add', '.'); git(seed, 'commit', '-m', 'main code update'); git(seed, 'push', 'origin', 'main');
  pushed = run('main-changed', {}, 'existing');
  assert.equal(pushed.status, 0, pushed.stderr);
  assert.notEqual(git(scratch, '--git-dir=' + remote, 'rev-parse', branch), existing);
  assert.equal(git(scratch, '--git-dir=' + remote, 'show', `${branch}:app.js`), '// main code update');
  assertions += 3;
  put(join(seed, 'data/racer.json'), '{}'); git(seed, 'add', '.'); git(seed, 'commit', '-m', 'competing writer'); git(seed, 'push', 'origin', 'HEAD:refs/heads/race-object');
  const raceSha = git(seed, 'rev-parse', 'HEAD');
  pushed = run('race', { PATH: dirname(shim) + ':' + process.env.PATH, RACE_REMOTE: remote, RACE_SHA: raceSha });
  assert.notEqual(pushed.status, 0); assert.match(pushed.stderr, /stale info/);
  assert.equal(git(scratch, '--git-dir=' + remote, 'rev-parse', branch), raceSha); assertions += 3;
  pushed = run('retry'); assert.equal(pushed.status, 0, pushed.stderr); assertions++;

  // Run the real PR and Quality Gate shell with a local gh stub. In particular,
  // invoke the gate shell even on a blocked PR to exercise its fail-closed guard,
  // not just a text assertion about the Actions expression.
  assert.equal(step('Run Quality Gate for promotion branch').match(/^        if: (.+)$/m)[1], "steps.changes.outputs.changed == 'true' && steps.pull-request.outputs.url != ''");
  assert.equal(step('Require promotion pull request').match(/^        if: (.+)$/m)[1], "steps.changes.outputs.changed == 'true' && steps.pull-request.outputs.url == ''");
  assertions += 2;
  const ghShim = join(scratch, 'bin', 'gh');
  put(ghShim, `#!/bin/bash
printf '%s ' "$@" >> "$GH_CALL_LOG"
printf '\\n' >> "$GH_CALL_LOG"
case "$1 $2" in
  "pr list")
    if [ "$GH_SCENARIO" = list-fails ]; then echo "Cannot list PRs" >&2; exit 1; fi
    case "$GH_SCENARIO" in existing-pr|edit-fails|view-fails|view-partial-fails) echo 17 ;; esac
    ;;
  "pr edit")
    if [ "$GH_SCENARIO" = edit-fails ]; then echo "Cannot edit PR" >&2; exit 1; fi
    ;;
  "pr view")
    if [ "$GH_SCENARIO" = view-fails ]; then echo "Cannot view PR" >&2; exit 1; fi
    echo "https://github.com/JeremyHennessy/HalifaxSourced/pull/17"
    if [ "$GH_SCENARIO" = view-partial-fails ]; then exit 1; fi
    ;;
  "pr create")
    if [ "$GH_SCENARIO" = create-blocked ]; then echo "GitHub Actions is not permitted to create or approve pull requests" >&2; exit 1; fi
    if [ "$GH_SCENARIO" = empty-url ]; then exit 0; fi
    if [ "$GH_SCENARIO" = invalid-url ]; then echo "null"; exit 0; fi
    echo "https://github.com/JeremyHennessy/HalifaxSourced/pull/18"
    ;;
  "workflow run") ;;
  *) echo "Unexpected gh invocation: $*" >&2; exit 2 ;;
esac
`);
  chmodSync(ghShim, 0o755);
  const compareUrl = 'https://github.com/JeremyHennessy/HalifaxSourced/compare/main...codex/promote-city-events-preview?expand=1';
  for (const scenario of ['create-blocked', 'existing-pr', 'new-pr', 'list-fails', 'edit-fails', 'view-fails', 'view-partial-fails', 'empty-url', 'invalid-url']) {
    const cwd = join(scratch, `pr-${scenario}`); mkdirSync(cwd);
    const output = join(cwd, 'outputs'); const summary = join(cwd, 'summary'); const calls = join(cwd, 'gh-calls');
    const env = { ...process.env, PATH: dirname(ghShim) + ':' + process.env.PATH, RUNNER_TEMP: cwd, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary, GH_CALL_LOG: calls, GH_SCENARIO: scenario };
    const execute = (script, extra = {}) => spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], { cwd, encoding: 'utf8', env: { ...env, ...extra } });
    result = execute(shellFor('Open or update promotion pull request'));
    assert.equal(result.status, 0, `${scenario}: ${result.stderr}`); assertions++;
    const outputs = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map(line => {
      const separator = line.indexOf('='); return [line.slice(0, separator), line.slice(separator + 1)];
    }));
    assert.equal(outputs.compare_url, compareUrl); assertions++;
    const hasPr = scenario === 'existing-pr' || scenario === 'new-pr';
    assert.equal(outputs.url, hasPr ? `https://github.com/JeremyHennessy/HalifaxSourced/pull/${scenario === 'existing-pr' ? 17 : 18}` : ''); assertions++;
    result = execute(shellFor('Run Quality Gate for promotion branch'), {
      PROMOTION_PR_URL: outputs.url,
      PROMOTION_BRANCH: values['steps.commit.outputs.branch']
    });
    assert.equal(result.status, 0, `${scenario}: ${result.stderr}`); assertions++;
    const ghCalls = readFileSync(calls, 'utf8');
    const dispatches = ghCalls.split('\n').filter(line => line.startsWith('workflow run '));
    assert.equal(dispatches.length, hasPr ? 1 : 0, `${scenario}: ${ghCalls}`); assertions++;
    if (hasPr) {
      assert.equal(dispatches[0].trim(), 'workflow run Quality Gate --ref codex/promote-city-events-preview');
      assert.ok(ghCalls.includes(scenario === 'existing-pr' ? 'pr edit 17 ' : 'pr create '));
      assertions += 2;
    } else {
      const report = readFileSync(summary, 'utf8');
      assert.ok(report.includes(compareUrl));
      assert.match(report, /Quality Gate will not be dispatched/);
      assert.doesNotMatch(report, /Enable repository|configure.*TOKEN/);
      result = execute(shellFor('Require promotion pull request', { 'steps.pull-request.outputs.compare_url': outputs.compare_url }));
      assert.notEqual(result.status, 0, `${scenario}: missing PR must remain an actionable failure`);
      assert.ok(result.stdout.includes(compareUrl)); assertions += 5;
    }
  }
  console.log(`Preview promotion: ${assertions} assertions passed (producer contract, review-only isolation, malformed artifacts, idempotent and leased branch updates, blocked/existing/new PR dispatch guards).`);
} finally { rmSync(scratch, { recursive: true, force: true }); }
