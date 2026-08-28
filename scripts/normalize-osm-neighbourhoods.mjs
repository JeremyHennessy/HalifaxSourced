import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";

const file = resolve("data", "osm-restaurants.js");
const source = await readFile(file, "utf8");
const context = { window: {} };
vm.createContext(context);
vm.runInContext(source, context, { filename: file, timeout: 20_000 });

const meta = context.window.HALIFAX_OSM_META ?? {};
const restaurants = Array.isArray(context.window.HALIFAX_OSM_RESTAURANTS) ? context.window.HALIFAX_OSM_RESTAURANTS : [];

function neighborhoodFor(lat, lon, tags) {
  const city = String(tags["addr:city"] ?? tags["is_in:city"] ?? "").trim();
  const suburb = String(tags["addr:suburb"] ?? tags["is_in:neighbourhood"] ?? "").trim();
  const street = String(tags["addr:street"] ?? "").trim();
  if (/dartmouth/i.test(city)) return "Dartmouth";
  if (/bedford/i.test(city)) return "Bedford";
  if (/halifax/i.test(city)) {
    if (lon < -63.64) return "Armdale / Fairview";
    if (/lower water|upper water|hollis/i.test(street) && lon > -63.578) return "Waterfront";
    if (lat < 44.642) return "South End";
    if (lat >= 44.6505 && lon > -63.61) return "North End";
    if (lat >= 44.648 && lon <= -63.595) return "West End";
    if (lat < 44.655 && lon > -63.60) return "Downtown";
    return "Halifax Peninsula";
  }
  if (suburb) {
    if (/woodside|portland estates|russell lake|shannon park/i.test(suburb)) return "Dartmouth";
    if (/south end terminal/i.test(suburb)) return "South End";
    if (/bloomfield|richmond|hydrostone/i.test(suburb)) return "North End";
    if (/westmou?t/i.test(suburb)) return "West End";
    return suburb;
  }
  if (lon < -63.64) return "Armdale / Fairview";
  if (lat < 44.642 && lon < -63.565) return "South End";
  if (lat > 44.665 && lon < -63.57) return "North End";
  if (lat >= 44.648 && lon < -63.595) return "West End";
  if (lon > -63.595 && lon < -63.565 && lat < 44.655) return "Downtown";
  if (lon >= -63.565) return "Dartmouth";
  return "Halifax Peninsula";
}

let changed = 0;
const examples = [];
for (const restaurant of restaurants) {
  const lat = Number(restaurant.coordinates?.lat);
  const lon = Number(restaurant.coordinates?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  const next = neighborhoodFor(lat, lon, restaurant.osm?.rawTags ?? {});
  if (next !== restaurant.neighborhood) {
    if (examples.length < 30) examples.push({ name: restaurant.name, from: restaurant.neighborhood, to: next, address: restaurant.address, coordinates: restaurant.coordinates });
    restaurant.neighborhood = next;
    changed += 1;
  }
}

const output = `window.HALIFAX_OSM_META = ${JSON.stringify(meta, null, 2)};\n\nwindow.HALIFAX_OSM_RESTAURANTS = ${JSON.stringify(restaurants, null, 2)};\n`;
await writeFile(file, output);
console.log(`Normalized neighbourhoods for ${changed} of ${restaurants.length} OSM records.`);
console.log(JSON.stringify(examples, null, 2));
