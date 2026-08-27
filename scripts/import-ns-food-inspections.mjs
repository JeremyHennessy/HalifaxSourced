import { mkdir, readFile, writeFile } from "node:fs/promises";

const baseUrl = "https://novascotia.ca/nse/food-protection/reports/";
const cities = (process.env.NS_FOOD_CITIES ?? "Halifax,Dartmouth,Bedford").split(",").map((city) => city.trim()).filter(Boolean);

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hiddenValue(html, name) {
  return html.match(new RegExp(`name="${name}"[^>]*value="([^"]*)"`))?.[1] ?? "";
}

async function searchCity(city) {
  const form = await (await fetch(baseUrl, { headers: { "User-Agent": "HalifaxSourced/0.1 (+https://github.com/JeremyHennessy/HalifaxSourced)" } })).text();
  const body = new URLSearchParams({
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    __VIEWSTATE: hiddenValue(form, "__VIEWSTATE"),
    __VIEWSTATEGENERATOR: hiddenValue(form, "__VIEWSTATEGENERATOR"),
    __EVENTVALIDATION: hiddenValue(form, "__EVENTVALIDATION"),
    TxtEstablishmentName: "",
    TxtEstablishmentStreetNo: "",
    TxtEstablishmentStreet: "",
    TxtCity: city,
    DropFromMonth: "",
    DropFromDay: "",
    DropFromYear: "",
    DropToMonth: "",
    DropToDay: "",
    DropToYear: "",
    BttnSubmit: "Submit"
  });

  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "HalifaxSourced/0.1 (+https://github.com/JeremyHennessy/HalifaxSourced)"
    },
    body
  });
  if (!response.ok) throw new Error(`Nova Scotia food inspection search returned ${response.status} for ${city}`);

  const html = await response.text();
  const currentAsOf = decodeHtml(html.match(/Search Results will be current as of[^<]*<span[^>]*>(.*?)<\/span>/is)?.[1]);
  const records = [];
  const pattern = /<td id="FACILITYNAME"[^>]*>\s*<a href="([^"]+)"[^>]*>(.*?)<\/a>\s*<\/td>\s*<td id="ADDRESS"[^>]*>(.*?)<\/td>/gis;
  for (const match of html.matchAll(pattern)) {
    const href = new URL(match[1], baseUrl).href;
    const id = href.match(/Id1=(\d+)/)?.[1] ?? null;
    records.push({
      id: `ns-food-${id}`,
      facilityId: id,
      name: decodeHtml(match[2]),
      address: decodeHtml(match[3]),
      city,
      detailUrl: href,
      source: "Government of Nova Scotia Food Establishment Inspection Reports",
      currentAsOf
    });
  }
  return records;
}

const records = [];
for (const city of cities) records.push(...await searchCity(city));

const seen = new Set();
const unique = records.filter((record) => {
  const key = record.facilityId ?? `${record.name}|${record.address}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}).sort((a, b) => a.name.localeCompare(b.name) || a.address.localeCompare(b.address));

const generatedAt = new Date().toISOString();
const payload = {
  generatedAt,
  source: "Government of Nova Scotia Food Establishment Inspection Reports",
  sourceUrl: baseUrl,
  cities,
  count: unique.length,
  records: unique
};

await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(new URL("../data/build/ns-food-inspections.json", import.meta.url), JSON.stringify(payload, null, 2));
await writeFile(
  new URL("../data/ns-food-inspections.js", import.meta.url),
  `window.HALIFAX_NS_FOOD_INSPECTIONS = ${JSON.stringify(payload, null, 2)};\n`
);
console.log(`Imported ${unique.length} Nova Scotia food inspection records for ${cities.join(", ")}.`);
