import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function windowData(path) {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(await readFile(new URL(`../${path}`, import.meta.url), "utf8"), context, { filename: path, timeout: 20_000 });
  return context.window;
}
const expectedSha = process.env.SOURCE_COMMIT_SHA || process.env.GITHUB_SHA || null;
const coverage = JSON.parse(await readFile(new URL("../data/build/content-coverage-report.json", import.meta.url), "utf8"));
const lifecycle = JSON.parse(await readFile(new URL("../data/build/restaurant-lifecycle-report.json", import.meta.url), "utf8"));
const mediaWindow = await windowData("data/restaurant-media.js");
const mediaCount = mediaWindow.HALIFAX_RESTAURANT_MEDIA?.records?.length || 0;
const failures = [];
if (!expectedSha || !/^[0-9a-f]{40}$/i.test(expectedSha)) failures.push("full deployed/source SHA is required");
if (coverage.sourceCommitSha !== expectedSha) failures.push(`coverage SHA ${coverage.sourceCommitSha || "missing"} differs from ${expectedSha || "missing"}`);
if (coverage.restaurantCoverage?.withUsableMedia !== mediaCount) failures.push(`coverage media ${coverage.restaurantCoverage?.withUsableMedia} differs from manifest ${mediaCount}`);
if (coverage.restaurantCoverage?.archivedLifecyclePlaces !== (lifecycle.curatedAudit?.statusCounts?.permanently_closed || 0) + (lifecycle.curatedAudit?.statusCounts?.temporarily_closed || 0) + (lifecycle.curatedAudit?.statusCounts?.moved || 0)) failures.push("coverage lifecycle counts differ from lifecycle audit");
if (coverage.restaurantCoverage?.withStructuredUpcomingEvents !== coverage.eventCoverage?.canonicalRestaurantsWithStructuredUpcomingEvents) failures.push("distinct restaurant-event count aliases differ");
if (coverage.eventCoverage?.structuredUpcomingRestaurantEvents !== coverage.eventCoverage?.upcomingStructuredRestaurantEventRecords) failures.push("upcoming event-record count aliases differ");
if (coverage.eventCoverage?.upcomingStructuredRestaurantEventRecords < coverage.eventCoverage?.canonicalRestaurantsWithStructuredUpcomingEvents) failures.push("event-record count cannot be smaller than distinct restaurant count");
if (failures.length) { console.error(JSON.stringify({ expectedSha, mediaCount, failures }, null, 2)); process.exit(1); }
console.log(JSON.stringify({ sourceCommitSha: expectedSha, mediaCount, archivedPlaces: coverage.restaurantCoverage.archivedLifecyclePlaces, restaurantsWithUpcomingEvents: coverage.eventCoverage.canonicalRestaurantsWithStructuredUpcomingEvents, upcomingEventRecords: coverage.eventCoverage.upcomingStructuredRestaurantEventRecords }, null, 2));
