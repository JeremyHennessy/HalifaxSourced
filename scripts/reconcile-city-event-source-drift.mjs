import { mkdir, readFile, writeFile } from "node:fs/promises";
import { reconcileEventSourceDrift } from "./event-source-drift-lib.mjs";

const previousPath = process.env.CITY_EVENTS_PREVIOUS_PATH || process.argv[2];
if (!previousPath) throw new Error("Set CITY_EVENTS_PREVIOUS_PATH or pass the previous city-events JSON path.");
const currentPath = new URL("../data/build/city-events.json", import.meta.url);
const jsPath = new URL("../data/city-events.js", import.meta.url);
const current = JSON.parse(await readFile(currentPath, "utf8"));
const previous = JSON.parse(await readFile(previousPath, "utf8"));
const result = reconcileEventSourceDrift(current, previous, {
  minimumPriorCount: Number(process.env.CITY_EVENT_ANOMALY_MIN_PRIOR_COUNT || 20),
  maxSnapshotAgeDays: Number(process.env.CITY_EVENT_ANOMALY_MAX_SNAPSHOT_AGE_DAYS || 3),
  maxCarryDays: Number(process.env.CITY_EVENT_ANOMALY_CARRY_DAYS || 7),
  futureDays: Number(current?.range?.futureDays || 400)
});

await writeFile(currentPath, JSON.stringify(result.payload, null, 2) + "\n");
await writeFile(jsPath, `window.HALIFAX_CITY_EVENTS = ${JSON.stringify(result.payload, null, 2)};\n`);
await mkdir(new URL("../artifacts", import.meta.url), { recursive: true });
await writeFile(new URL("../artifacts/city-event-source-drift-report.json", import.meta.url), JSON.stringify({
  generatedAt: new Date().toISOString(),
  previousGeneratedAt: previous.generatedAt || null,
  currentGeneratedAt: current.generatedAt || null,
  anomalyCount: result.anomalies.length,
  carriedForwardCount: result.carried.length,
  skippedReason: result.skippedReason,
  anomalies: result.anomalies
}, null, 2) + "\n");
console.log(JSON.stringify({ anomalyCount: result.anomalies.length, carriedForwardCount: result.carried.length, skippedReason: result.skippedReason, anomalies: result.anomalies }, null, 2));
