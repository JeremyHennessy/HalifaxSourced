import { mkdir, readFile, writeFile } from "node:fs/promises";
import { reconcileFutureEventLosses } from "./lib/event-refresh-safety.mjs";
import { REVIEWED_EVENT_QUARANTINE_PATH } from "./lib/reviewed-event-quarantine.mjs";

const previousPath = process.env.CITY_EVENTS_PREVIOUS_PATH || process.argv[2];
if (!previousPath) throw new Error("Set CITY_EVENTS_PREVIOUS_PATH or pass the previous city-events JSON path.");
const currentPath = new URL("../data/build/city-events.json", import.meta.url);
const jsPath = new URL("../data/city-events.js", import.meta.url);
const current = JSON.parse(await readFile(currentPath, "utf8"));
const previous = JSON.parse(await readFile(previousPath, "utf8"));
const reviewedQuarantine = JSON.parse(await readFile(new URL("../" + REVIEWED_EVENT_QUARANTINE_PATH, import.meta.url), "utf8"));
const result = reconcileFutureEventLosses(current, previous, {
  reviewedQuarantine,
  futureDays: Number(current?.range?.futureDays || 400)
});

await mkdir(new URL("../artifacts", import.meta.url), { recursive: true });
const report = {
  generatedAt: new Date().toISOString(),
  previousGeneratedAt: previous.generatedAt || null,
  currentGeneratedAt: current.generatedAt || null,
  blocked: result.blocked,
  retainedAfterFailureCount: result.retained.length,
  heldRemovalCount: result.heldRemovals.length,
  heldRemovals: result.heldRemovals,
  retainedAfterFailure: result.retained.map(event => ({ eventId: event.id, sourceId: event.sourceId, observedAt: event.observedAt, sourceFailure: event.sourceFailure })),
  ignoredPrevious: result.ignoredPrevious,
  reviewedQuarantine: result.reviewedQuarantine
};
await writeFile(new URL("../artifacts/city-event-source-drift-report.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
if (result.blocked) {
  throw new Error(`City-event refresh held for removal review: ${result.heldRemovals.length} accepted unexpired events disappeared; ${result.reviewedQuarantine.previous.mismatchCount + result.reviewedQuarantine.current.mismatchCount} reviewed quarantine guard mismatches. See artifacts/city-event-source-drift-report.json.`);
}
await writeFile(currentPath, JSON.stringify(result.payload, null, 2) + "\n");
await writeFile(jsPath, `window.HALIFAX_CITY_EVENTS = ${JSON.stringify(result.payload, null, 2)};\n`);
