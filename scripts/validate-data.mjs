import { readFile } from "node:fs/promises";
import { Script, createContext } from "node:vm";

const source = await readFile(new URL("../data/restaurants.js", import.meta.url), "utf8");
const context = createContext({ window: {} });
new Script(source).runInContext(context);

const restaurants = context.window.HALIFAX_RESTAURANTS;
const errors = [];
const ids = new Set();
const requiredFields = ["id", "name", "neighborhood", "cuisines", "vibe", "qualityScore", "freshnessDate", "evidenceStatus", "sources"];
const statuses = new Set(["verified", "needs-review", "restricted"]);

if (!Array.isArray(restaurants)) {
  errors.push("HALIFAX_RESTAURANTS must be an array.");
} else {
  for (const [index, restaurant] of restaurants.entries()) {
    for (const field of requiredFields) {
      if (!(field in restaurant)) errors.push(`Restaurant ${index} is missing ${field}.`);
    }

    if (ids.has(restaurant.id)) errors.push(`Duplicate id: ${restaurant.id}`);
    ids.add(restaurant.id);

    if (!statuses.has(restaurant.evidenceStatus)) {
      errors.push(`${restaurant.id} has invalid evidenceStatus: ${restaurant.evidenceStatus}`);
    }

    if (!Number.isFinite(restaurant.qualityScore) || restaurant.qualityScore < 0 || restaurant.qualityScore > 100) {
      errors.push(`${restaurant.id} qualityScore must be 0-100.`);
    }

    if (!Array.isArray(restaurant.sources) || restaurant.sources.length === 0) {
      errors.push(`${restaurant.id} must have at least one source.`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Validated ${restaurants.length} restaurants.`);
