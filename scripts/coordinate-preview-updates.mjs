import { appendFile, readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { LANES, planPreviewUpdates, validateRun, laneForPath } from './lib/preview-coordinator.mjs';

// Network orchestration uses GET requests only and the existing Actions token.
// All external mutations remain in the canonical workflow under its writer lock.
const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const apiRoot = 'https://api.github.com';
async function get(path, optional = false) {
  const response = await fetch(`${apiRoot}/repos/${repository}/${path}`, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
  if (optional && response.status === 404) return null;
  if (!response.ok) throw new Error(`GET ${path}: ${response.status} ${await response.text()}`);
  return response.json();
}
async function pages(path, key, maximum = 5) {
  const rows = [];
  for (let page = 1; page <= maximum; page++) {
    const payload = await get(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    const items = key ? payload[key] : payload;
    rows.push(...items);
    if (items.length < 100) return rows;
  }
  throw new Error(`Read bound reached for ${path}; refusing to assume unseen reservations or history are absent.`);
}
async function jsonAt(path, ref) {
  const result = await get(`contents/${path}?ref=${encodeURIComponent(ref)}`, true);
  if (!result) return null;
  if (result.encoding !== 'base64') throw new Error(`Unsupported receipt encoding: ${path}`);
  return JSON.parse(Buffer.from(result.content, 'base64').toString('utf8'));
}
async function collect({ manual = null } = {}) {
  if (!repository || !token) throw new Error('GITHUB_REPOSITORY and GH_TOKEN/GITHUB_TOKEN are required.');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Invalid repository.');
  if (manual && (!LANES.some(lane => lane.artifact === manual.artifact) || !/^\d+$/.test(String(manual.runId)))) throw new Error('Manual promotion requires an allowlisted artifact and an exact numeric run ID.');
  const now = new Date().toISOString();
  const main = await get('git/ref/heads/main');
  const openPulls = await pages('pulls?state=open&base=main', null);
  for (const pull of openPulls) {
    const files = await pages(`pulls/${pull.number}/files`, null);
    pull.reservedGroups = [...new Set(files.map(file => laneForPath(file.filename)).filter(Boolean))];
  }
  const state = { repository, now, mainSha: main.object.sha, lanes: {}, openPulls, attempts: [], manual };
  const legacyMain = await jsonAt('data/build/preview-promotion-metadata.json', main.object.sha);
  for (const lane of LANES) {
    const receiptPath = `data/build/promotion-receipts/${lane.artifact}.json`;
    let acceptedReceipt = await jsonAt(receiptPath, main.object.sha);
    if (!acceptedReceipt && legacyMain?.artifactName === lane.artifact) acceptedReceipt = { ...legacyMain, reviewedAt: null, publishedAt: null };
    if (acceptedReceipt?.artifactRunId && !acceptedReceipt.sourceRunCreatedAt) {
      const acceptedRun = await get(`actions/runs/${acceptedReceipt.artifactRunId}`, true);
      if (acceptedRun) acceptedReceipt.sourceRunCreatedAt = acceptedRun.created_at;
    }
    const retiredBranchConflicts=[];
    for(const retired of lane.retiredBranches) {
      const oldRef=await get(`git/ref/heads/${retired.branch}`,true);
      if(oldRef?.object?.sha!==retired.sha) retiredBranchConflicts.push({branch:retired.branch,expectedSha:retired.sha,actualSha:oldRef?.object?.sha||null});
    }
    const ref = await get(`git/ref/heads/${lane.branch}`, true);
    let branch = null;
    if (ref) {
      const comparison = await get(`compare/${main.object.sha}...${ref.object.sha}`);
      branch = { sha: ref.object.sha, aheadBy: comparison.ahead_by,
        receipt: await jsonAt(receiptPath, ref.object.sha), metadata: await jsonAt('data/build/preview-promotion-metadata.json', ref.object.sha) };
      if (branch.aheadBy > 0) {
        const closedPulls = await pages(`pulls?state=closed&base=main&head=${encodeURIComponent(repository.split('/')[0] + ':' + lane.branch)}`, null);
        const merged = closedPulls.find(pull => pull.merged_at && pull.head?.sha === branch.sha);
        if (merged) branch.mergedHeadSha = merged.head.sha;
      }
    }
    const runs = [];
    let readBlocker = null;
    if ((!lane.manualOnly && !manual) || manual?.artifact === lane.artifact) {
      if (manual) {
        const run = await get(`actions/runs/${manual.runId}`);
        run.artifacts = await pages(`actions/runs/${run.id}/artifacts`, 'artifacts');
        runs.push(run);
      } else {
        // GitHub returns newest first. Search retained successes without falling
        // selecting a failed, untrusted or expired artifact.
        let found = false;
        for (let page = 1; page <= 3 && !found; page++) {
          const payload = await get(`actions/workflows/${lane.file}/runs?branch=main&status=success&per_page=100&page=${page}`);
          for (const run of payload.workflow_runs) {
            if (run.name !== lane.workflow || run.head_repository?.full_name !== repository || ['pull_request', 'pull_request_target'].includes(run.event)) continue;
            run.artifacts = await pages(`actions/runs/${run.id}/artifacts`, 'artifacts');
            runs.push(run);
            if (!validateRun(run, lane, repository, now)) { found = true; break; }
          }
          if (payload.workflow_runs.length < 100) break;
          if (page === 3 && !found) readBlocker = 'retained-run-search-exhausted';
        }
      }
    }
    state.lanes[lane.artifact] = { retiredBranchConflicts, acceptedReceipt, branch, runs, readBlocker };
  }
  // Retry counters survive runners in retained Actions job history. At most
  // three attempts per candidate within the last 30 days; no background sleep.
  const ready = planPreviewUpdates(state).matrix.include;
  if (!ready.length) return state;
  const oldestCandidate = Math.min(...ready.map(item => Date.parse(item.source_run_created_at)));
  const cutoff = new Date(Math.max(oldestCandidate, Date.now() - 30 * 86400_000)).toISOString();
  const coordinatorRuns = await pages(`actions/workflows/promote-preview-artifacts.yml/runs?created=%3E%3D${encodeURIComponent(cutoff)}`, 'workflow_runs');
  for (const run of coordinatorRuns) {
    if (String(run.id) === process.env.GITHUB_RUN_ID) continue;
    const jobs = await pages(`actions/runs/${run.id}/jobs?filter=all`, 'jobs');
    for (const job of jobs) {
      const match = job.name.match(/^Promote (city-events-preview|source-expansion-preview|social-source-preview|weather-preview) \(source (\d+)\)$/);
      if (match && ready.some(item => item.artifact_name === match[1] && item.run_id === match[2]) && job.status === 'completed' && (job.conclusion !== 'success' || job.steps?.some(step => step.name === 'Promote allowlisted data files' && step.conclusion === 'success'))) state.attempts.push({ artifact: match[1], runId: match[2], conclusion: job.conclusion, completedAt: job.completed_at, baseSha: run.head_sha });
    }
  }
  return state;
}
async function main() {
  const fixture = process.argv.includes('--fixture');
  const guard = process.argv.includes('--guard');
  const manual = process.env.REQUESTED_RUN_ID ? { runId: process.env.REQUESTED_RUN_ID, artifact: process.env.REQUESTED_ARTIFACT } : null;
  const state = fixture ? JSON.parse(await readFile(process.argv[process.argv.indexOf('--fixture') + 1], 'utf8')) : await collect({ manual });
  const plan = planPreviewUpdates(state);
  if (process.env.PLAN_PATH) await writeFile(process.env.PLAN_PATH, JSON.stringify(plan, null, 2) + '\n');
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(plan.matrix)}\nhas_work=${plan.hasWork}\nmain_sha=${plan.mainSha}\n`);
    if (guard) await appendFile(process.env.GITHUB_OUTPUT, `allowed=${plan.hasWork}\nexpected_sha=${plan.matrix.include[0]?.expected_sha || ''}\nreleased_sha=${plan.matrix.include[0]?.released_sha || ''}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `\n## Preview reconciliation\n\n${plan.decisions.map(item => `- ${item.artifact}, source ${item.runId || 'none'}: ${item.status} (${item.reason})${item.url ? ` ${item.url}` : ''}${item.blocker ? ` ${item.blocker}` : ''}`).join('\n')}\n\nNo repository settings, credentials, source restrictions or permissions were changed.\n`);
  console.log(JSON.stringify(plan, null, 2));
  if (manual && !plan.hasWork && plan.decisions.some(item => ['requested-run-not-found', 'wrong-producer-workflow', 'producer-not-successful', 'untrusted-producer', 'artifact-not-retained', 'missing-source-run-time'].includes(item.reason))) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
