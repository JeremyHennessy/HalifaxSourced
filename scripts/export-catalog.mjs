import { readFile, writeFile, mkdir } from "node:fs/promises";
import { Script, createContext } from "node:vm";

const context = createContext({ window: {} });
for (const file of ["../data/restaurants.js", "../data/osm-restaurants.js"]) {
  const source = await readFile(new URL(file, import.meta.url), "utf8");
  new Script(source, { filename: file }).runInContext(context);
}

const curated = context.window.HALIFAX_RESTAURANTS ?? [];
const osm = context.window.HALIFAX_OSM_RESTAURANTS ?? [];
const meta = context.window.HALIFAX_OSM_META ?? null;

function keyForName(name) {
  return String(name ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "").trim();
}

function mergeSources(a = [], b = []) {
  const seen = new Set();
  return [...a, ...b].filter((source) => {
    const key = `${source.type}|${source.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const byName = new Map();
const restaurants = curated.map((restaurant) => ({ ...restaurant, sourceLayer: "curated" }));
restaurants.forEach((restaurant) => byName.set(keyForName(restaurant.name), restaurant));

for (const restaurant of osm) {
  const match = byName.get(keyForName(restaurant.name));
  if (!match) {
    restaurants.push({ ...restaurant, sourceLayer: "openstreetmap" });
    continue;
  }
  match.category ??= restaurant.category;
  match.address ??= restaurant.address;
  match.phone ??= restaurant.phone;
  match.website ??= restaurant.website;
  match.openingHours ??= restaurant.openingHours;
  match.coordinates ??= restaurant.coordinates;
  match.sources = mergeSources(match.sources, restaurant.sources);
  match.osm ??= restaurant.osm;
}

const catalog = {
  generatedAt: new Date().toISOString(),
  sourceMeta: { openStreetMap: meta },
  counts: {
    curated: curated.length,
    openStreetMap: osm.length,
    merged: restaurants.length
  },
  restaurants
};

await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(new URL("../data/build/catalog.json", import.meta.url), JSON.stringify(catalog, null, 2));
console.log(`Exported ${restaurants.length} merged records to data/build/catalog.json.`);
