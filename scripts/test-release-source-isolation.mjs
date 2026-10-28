import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const repository = fileURLToPath(new URL("../", import.meta.url));
const workflow = await readFile(join(repository, ".github/workflows/quality-gate.yml"), "utf8");
const snapshots = [
  ["public-special-source-leads", "HALIFAX_PUBLIC_SPECIAL_SOURCE_LEADS", "source-expansion-preview.yml", "import-public-special-source-leads.mjs"],
  ["patio-directory-facts", "HALIFAX_PATIO_DIRECTORY_FACTS", "source-expansion-preview.yml", "import-patio-directory-facts.mjs"],
  ["directory-restaurant-leads", "HALIFAX_DIRECTORY_RESTAURANT_LEADS", "restaurant-discovery-preview.yml", "import-review-directory-restaurants.mjs"]
];
const snapshotPaths = snapshots.flatMap(([name]) => [`data/${name}.js`, `data/build/${name}.json`]);
const weatherManifest = JSON.parse(await readFile(join(repository, "data/weather/current.json"), "utf8"));
assert.match(weatherManifest.capturePath, /^data\/weather\/captures\/[a-f0-9]{64}\.json$/);
snapshotPaths.push("data/weather/current.json",weatherManifest.capturePath,"data/weather.js","data/build/halifax-weather.json");
const newsManifest = JSON.parse(await readFile(join(repository, "news-evidence/current.json"), "utf8"));
snapshotPaths.push("news-evidence/current.json",...Object.keys(newsManifest.files).map(name=>`news-evidence/runs/${newsManifest.runId}/${name}`),"data/news.js","data/build/news.json","data/reviewed-news-decisions.json");
const modelManifest = JSON.parse(await readFile(join(repository, "weather-evidence/current.json"), "utf8"));
assert.match(modelManifest.archivePath, /^weather-evidence\/issuances\/[a-f0-9]{64}\.json$/);
snapshotPaths.push("weather-evidence/current.json", modelManifest.archivePath, "data/weather-models.js", "data/build/halifax-weather-models.json");
assert.match(workflow, /data-integrity:\s*\n\s+needs: weather-model-decoder/);
assert.match(workflow, /node scripts\/test-weather-grib-replay\.mjs/);
// Adding a release entry point requires an explicit classification here. The
// offline entries below are also executed, not merely trusted by their names.
const offlineScripts = new Set([
  "build-regional-news", "check-news", "build-source-catalog", "check-weather", "build-weather-models", "check-weather-models",
  "export-catalog", "check-public-special-source-leads", "check-patio-directory-facts",
  "build-structured-specials", "resolve-place-candidates", "check-place-source-resolution",
  "build-recent-social-posts", "build-reviewed-social-posts", "check-local-restaurant-policy",
  "build-thumbnail-candidates", "approve-eligible-thumbnails", "validate-data", "check-restaurant-lifecycle",
  "check-data-integrity", "check-expanded-sources", "check-thumbnail-candidates",
  "check-restaurant-discovery", "check-restaurant-media-rights", "check-neighbourhood-resolutions",
  "check-city-event-additions", "apply-city-event-additions", "sanitize-city-events",
  "resolve-city-event-entities", "check-city-events", "check-event-entity-resolution",
  "check-structured-place-facts", "check-structured-specials", "build-content-coverage-report",
  "build-thumbnail-coverage-report", "plan-thumbnail-coverage-attack", "reconcile-structured-coverage",
  "check-report-deployment-parity", "render-content-coverage-report", "build-content-quality-report",
  "report-missed-local-restaurants", "build-deployment-metadata", "build-update-ledger", "check-regional-restaurant-coverage"
].map(name => `scripts/${name}.mjs`));
const networkException = new Set(["scripts/check-source-links.mjs", "scripts/check-release-link-health.mjs"]);
const packagingException = "scripts/release-artifact.mjs";
const offlineFlags = ["THUMBNAIL_DISCOVERY_FETCH", "THUMBNAIL_IMAGE_PROBE", "THUMBNAIL_PROMOTION_APPLY"];

function releaseCommands(source) {
  const dataJob = source.match(/^  data-integrity:\s*\n([\s\S]*?)(?=^  ui-verification:)/m)?.[1];
  assert(dataJob, "The release data-integrity job must remain identifiable.");
  assert(!/\bscripts\/(?:import-|discover-|refresh-|verify-official-source-pages)/.test(source),
    "A live collector was added to the release gate; collect in a source preview instead.");
  for (const flag of offlineFlags) {
    const values = [...dataJob.matchAll(new RegExp(`^\\s+${flag}:\\s*(.+)$`, "gm"))].map(match => match[1].trim());
    const declarations = [...dataJob.matchAll(new RegExp(`\\b${flag}:`, "g"))].length;
    assert(values.length && values.length === declarations && values.every(value => /^["']?0["']?$/.test(value)),
      `${flag} must be explicitly disabled throughout the release job.`);
  }
  const commands = [];
  for (const match of dataJob.matchAll(/^        run: ([^\n]*)(?:\n((?:          [^\n]*\n|[ \t]*\n)*))?/gm)) {
    const lines = match[1] === "|" ? (match[2] || "").split("\n") : [match[1]];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const node = line.match(/^node (scripts\/[\w-]+\.mjs)(?: (build|verify))?$/);
      if (node) {
        const [, script, argument] = node;
        assert(!argument || script === packagingException, `Unexpected release command arguments: ${line}`);
        assert(offlineScripts.has(script) || networkException.has(script) || script === packagingException || /^scripts\/test-[\w-]+\.mjs$/.test(script),
          `Classify and exercise new release entry point before adding it: ${script}`);
        commands.push(script);
      } else {
        assert([
          "for file in app-*.js data/local-restaurant-policy.js scripts/*.mjs scripts/lib/*.mjs; do",
          '[ -e "$file" ] || continue', 'node --check "$file"', "done",
          "python3 scripts/build-sqlite-db.py",
          "python3 scripts/test-sqlite-catalog.py"
        ].includes(line), `Unclassified release command could bypass source isolation: ${line}`);
      }
    }
  }
  assert(commands.includes("scripts/test-release-source-isolation.mjs"), "Quality Gate must run this regression.");
  for (const script of offlineScripts) assert(commands.includes(script), `Required snapshot build/check was removed: ${script}`);
  for (const script of networkException) assert(commands.includes(script), `Keep the release link-health gate: ${script}`);
  for (const script of ["test-reviewed-corrections", "test-reviewed-fact-batch", "test-update-consistency", "test-source-integrity", "test-structured-specials-model", "test-release-artifact"]) {
    assert(commands.includes(`scripts/${script}.mjs`), `Keep the identity, expiry, provenance and receipt regression: ${script}`);
  }
  assert(/LINK_HEALTH_SCOPE:\s*release\b/.test(dataJob));
  assert(/LINK_HEALTH_LIMIT:\s*0\b/.test(dataJob), "Audit all current release URLs, not a sample.");
  assert(/LINK_HEALTH_TIMEOUT_MS:\s*4000\b/.test(dataJob), "Keep the bounded release request deadline.");
  assert(/LINK_HEALTH_CONCURRENCY:\s*16\b/.test(dataJob), "Keep bounded release concurrency.");
  assert(/SOURCE_COMMIT_SHA:/.test(dataJob), "Release evidence must identify its source commit.");
  for (const script of ["test-offer-rendering-fixed-clock", "verify-ui", "verify-iphone-links", "test-rich-discovery"]) {
    assert(source.includes(`node scripts/${script}.mjs`), `Keep responsive and current-offer browser coverage: ${script}`);
  }
  assert(source.includes("name: Verify tested release is unchanged"));
  assert(source.includes("name: tested-site"));
  return commands.filter(script => offlineScripts.has(script));
}

const commands = releaseCommands(workflow);
// Guard the guard: direct collectors, arbitrary shell wrappers, and accidentally
// enabled fetch/probe/promotion modes must all fail before executing any build.
for (const collector of snapshots.map(item => item[3])) {
  assert.throws(() => releaseCommands(workflow.replace("node scripts/export-catalog.mjs",
    `node scripts/${collector}`)), /collector/);
}
assert.throws(() => releaseCommands(workflow.replace("node scripts/export-catalog.mjs", "bash scripts/new-collector.sh")), /Unclassified/);
assert.throws(() => releaseCommands(workflow.replace("node scripts/export-catalog.mjs", "node scripts/new-builder.mjs")), /Classify/);
for (const flag of offlineFlags) {
  assert.throws(() => releaseCommands(workflow.replace(`${flag}: "0"`, `${flag}: "1"`)), /explicitly disabled/);
}
assert.throws(() => releaseCommands(workflow.replace("      - name: Build thumbnail candidates",
  '      - env: { THUMBNAIL_DISCOVERY_FETCH: "1" }\n      - name: Build thumbnail candidates')), /explicitly disabled/);
assert.throws(() => releaseCommands(workflow.replace("node scripts/verify-ui.mjs",
  "node scripts/import-patio-directory-facts.mjs")), /collector/);

async function validateSnapshotPairs(directory) {
  for (const [name, globalName] of snapshots) {
    const payload = JSON.parse(await readFile(join(directory, `data/build/${name}.json`), "utf8"));
    const context = vm.createContext({ window: {} });
    vm.runInContext(await readFile(join(directory, `data/${name}.js`), "utf8"), context, { timeout: 20_000 });
    assert.deepEqual(JSON.parse(JSON.stringify(context.window[globalName])), payload, `${name}: accepted browser/JSON snapshots differ.`);
    assert(Array.isArray(payload.records), `${name}: missing accepted records.`);
    assert(Number.isFinite(Date.parse(payload.generatedAt)), `${name}: missing source snapshot timestamp.`);
  }
}
for (const [name, , sourceWorkflow, collector] of snapshots) {
  const source = await readFile(join(repository, ".github/workflows", sourceWorkflow), "utf8");
  assert(source.includes(`run: node scripts/${collector}`), `${collector} must still run in ${sourceWorkflow}.`);
  assert(/^\s+schedule:/m.test(source), `${sourceWorkflow} must retain scheduled collection.`);
  for (const path of [`data/${name}.js`, `data/build/${name}.json`]) {
    assert(source.includes(path), `${sourceWorkflow} must publish ${path} for review/promotion.`);
  }
}

const root = await mkdtemp(join(tmpdir(), "halifax-release-isolation-"));
try {
  // Fail even when an importer catches a rejected request and writes an empty or
  // partial result. Disable low-level clients and subprocess escape hatches too.
  const guardPath = join(root, "offline-guard.mjs");
  await writeFile(guardPath, `
    import { appendFileSync } from "node:fs";
    import http from "node:http";
    import https from "node:https";
    import net from "node:net";
    import tls from "node:tls";
    import dgram from "node:dgram";
    import childProcess from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    const deny = name => (...args) => {
      appendFileSync(process.env.RELEASE_ISOLATION_ATTEMPTS, name + "\\n");
      throw Error("release_snapshot_network_disabled:" + name);
    };
    globalThis.fetch = deny("fetch");
    globalThis.WebSocket = deny("WebSocket");
    for (const [module, methods] of [
      [http, ["request", "get"]], [https, ["request", "get"]],
      [net, ["connect", "createConnection"]], [net.Socket.prototype, ["connect"]],
      [tls, ["connect"]], [dgram, ["createSocket"]],
      [childProcess, ["exec", "execFile", "execSync", "execFileSync", "spawn", "spawnSync", "fork"]]
    ]) for (const method of methods) module[method] = deny(method);
    syncBuiltinESMExports();
    const RealDate = Date;
    const now = RealDate.parse("2026-10-20T12:00:00.000Z");
    globalThis.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return now; }
    };
  `);
  async function run(directory, script) {
    const attempts = join(directory, "network-attempts.log");
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", pathToFileURL(guardPath).href, script], {
        cwd: directory,
        env: {
          ...process.env, NODE_OPTIONS: "", TZ: "UTC",
          SOURCE_COMMIT_SHA: "a".repeat(40), QUALITY_WORKFLOW_RUN_ID: "snapshot-regression",
          RELEASE_ISOLATION_ATTEMPTS: attempts,
          ...Object.fromEntries(offlineFlags.map(flag => [flag, "0"]))
        },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 60_000
      });
      let output = "";
      child.stdout.on("data", chunk => { output += chunk; });
      child.stderr.on("data", chunk => { output += chunk; });
      child.on("error", reject);
      child.on("close", (code, signal) => resolve({ code, signal, output }));
    });
    const requests = await readFile(attempts, "utf8").catch(error => { if (error.code === "ENOENT") return ""; throw error; });
    assert.equal(requests, "", `${script} attempted collection or a subprocess even if it caught the failure:\n${requests}`);
    assert.equal(result.code, 0, `${script} failed in the offline release copy (${result.signal || "exit"}):\n${result.output}`);
  }
  const digest = async path => createHash("sha256").update(await readFile(path)).digest("hex");
  async function treeHashes(directory, relative = "") {
    const result = {};
    for (const entry of (await readdir(join(directory, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(relative, entry.name);
      if (entry.isDirectory()) Object.assign(result, await treeHashes(directory, path));
      else result[path] = await digest(join(directory, path));
    }
    return result;
  }
  // Capture once, so concurrent local edits cannot give the two runs different
  // inputs. Independent copies avoid mistaking an input-mutating build for a
  // deterministic one. The frozen clock is only a regression fixture.
  const baseline = join(root, "baseline");
  await mkdir(baseline);
  for (const folder of ["data", "scripts", "assets", "weather-evidence", "news-evidence"]) await cp(join(repository, folder), join(baseline, folder), { recursive: true });
  for (const file of await readdir(repository)) {
    if (file.endsWith(".js") || file === "index.html") await cp(join(repository, file), join(baseline, file));
  }
  for (const folder of ["docs", "artifacts"]) await mkdir(join(baseline, folder));
  await validateSnapshotPairs(baseline);
  let first;
  for (const name of ["first", "second"]) {
    const directory = join(root, name);
    await cp(baseline, directory, { recursive: true });
    const before = await Promise.all(snapshotPaths.map(path => digest(join(directory, path))));
    for (const script of commands) await run(directory, script);
    assert.deepEqual(await Promise.all(snapshotPaths.map(path => digest(join(directory, path)))), before,
      "Release projections must never rewrite accepted collector snapshots.");
    const hashes = {};
    for (const folder of ["data", "artifacts", "docs"]) Object.assign(hashes, await treeHashes(directory, folder));
    if (first) assert.deepEqual(hashes, first, "Same accepted inputs and clock must produce byte-identical offline release data/reports.");
    else first = hashes;
  }
  // Prove swallowed network failures cannot quietly pass the runtime guard.
  const probe = join(root, "guard-probe");
  await mkdir(probe);
  await writeFile(join(probe, "probe.mjs"), 'try { await fetch("https://example.invalid/"); } catch {}');
  await assert.rejects(() => run(probe, "probe.mjs"), /attempted collection/);
  console.log(`Release source isolation passed: ${snapshots.length} accepted source pairs, ${commands.length} offline build/check invocations twice, identical outputs, no snapshot mutation or network attempts. Bounded same-head link health remains separate.`);
} finally {
  await rm(root, { recursive: true, force: true });
}
