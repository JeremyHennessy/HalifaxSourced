import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const root = await mkdtemp(join(tmpdir(), "halifax-special-model-"));
const scriptsDir = join(root, "scripts");
const buildDir = join(root, "data", "build");
await mkdir(scriptsDir, { recursive: true });
await mkdir(buildDir, { recursive: true });
await copyFile(new URL("./build-structured-specials.mjs", import.meta.url), join(scriptsDir, "build-structured-specials.mjs"));
const recent = new Date().toISOString();
const catalog = {
  restaurants: [{
    id: "fixture-restaurant",
    name: "Fixture Restaurant",
    freshnessDate: recent.slice(0, 10),
    sources: [{ url: "https://fixture.example/" }],
    specials: [
      {
        title: "Happy Hour",
        cadence: "Mon-Fri 4 pm - 6 pm",
        price: null,
        sourceUrl: "https://fixture.example/happy-hour",
        sourceStatus: "verified"
      },
      {
        title: "Wing Night",
        cadence: "Tue 5 pm - 10 pm",
        price: "12",
        sourceUrl: "https://fixture.example/wing-night",
        sourceStatus: "verified",
        observedAt: recent
      }
    ]
  }]
};
await writeFile(join(buildDir, "catalog.json"), JSON.stringify(catalog, null, 2));
await writeFile(join(buildDir, "first-party-sources.json"), JSON.stringify({ records: [] }, null, 2));
await writeFile(join(buildDir, "verified-source-pages.json"), JSON.stringify({ menuSources: [], specialSources: [] }, null, 2));
await writeFile(join(root, "data", "discovery-overrides.json"), JSON.stringify({ approved: [{
  id: "fixture-discovered",
  name: "Fixture Discovery",
  freshnessDate: recent.slice(0, 10),
  specials: [{ title: "Daily Feature", cadence: "Daily 5 pm - 7 pm", sourceUrl: "https://discovered.example/specials", sourceStatus: "verified", observedAt: recent }],
  sources: [{ url: "https://discovered.example/" }]
}] }, null, 2));

const result = await new Promise((resolve) => {
  const child = spawn(process.execPath, [join(scriptsDir, "build-structured-specials.mjs")], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("close", (code) => resolve({ code, stdout, stderr }));
});
if (result.code !== 0) throw new Error(`Structured-special fixture builder failed (${result.code}): ${result.stderr || result.stdout}`);
const output = JSON.parse(await readFile(join(buildDir, "structured-specials.json"), "utf8"));
const happy = output.records.find((item) => item.title === "Happy Hour");
const wings = output.records.find((item) => item.title === "Wing Night");
const discovered = output.records.find((item) => item.restaurantId === "fixture-discovered");
function assert(condition, message) { if (!condition) throw new Error(message); }
assert(happy, "Happy Hour fixture record missing.");
assert(wings, "Wing Night fixture record missing.");
assert(discovered, "Approved discovery special must enter the canonical structured-special output.");
assert(output.orphanSourceCount === 0, `Approved discovery special must not be orphaned, got ${output.orphanSourceCount}.`);
assert(happy.price === null, `Missing price must remain null, got ${happy.price}.`);
assert(happy.verifiedAt === null, `General restaurant freshness must not become special verification, got ${happy.verifiedAt}.`);
assert(happy.status === "stale", `Source-marked verified special without its own verification timestamp must be stale, got ${happy.status}.`);
assert(wings.price === 12, `Explicit numeric special price should normalize to 12, got ${wings.price}.`);
assert(wings.status === "verified_current", `Recently observed source-verified special should be verified_current, got ${wings.status}.`);
assert(Array.isArray(happy.dayOfWeek) && happy.dayOfWeek.length === 5, "Mon-Fri cadence should normalize to five weekdays.");
console.log("Structured-special model regression passed: missing prices remain unknown and current verification requires special-specific evidence.");
await rm(root, { recursive: true, force: true });
