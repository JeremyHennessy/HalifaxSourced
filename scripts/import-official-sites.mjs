import { mkdir, readFile, writeFile } from "node:fs/promises";

const catalog = JSON.parse(await readFile(new URL("../data/build/catalog.json", import.meta.url), "utf8"));
const targets = catalog.restaurants.filter((restaurant) => restaurant.website).slice(0, Number(process.env.OFFICIAL_SITE_LIMIT ?? 50));
const keywords = ["happy hour", "special", "specials", "event", "events", "live music", "menu", "brunch", "wine", "cocktail"];
const results = [];

function linksFromHtml(html, baseUrl) {
  const links = [];
  const pattern = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis;
  for (const match of html.matchAll(pattern)) {
    try {
      const href = new URL(match[1], baseUrl).href;
      const text = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const haystack = `${href} ${text}`.toLowerCase();
      if (keywords.some((keyword) => haystack.includes(keyword))) links.push({ text, href });
    } catch {}
  }
  return links.slice(0, 12);
}

for (const restaurant of targets) {
  try {
    const response = await fetch(restaurant.website, { headers: { "User-Agent": "HalifaxSourced/0.1 (+https://github.com/JeremyHennessy/HalifaxSourced)" } });
    const html = await response.text();
    const lower = html.toLowerCase();
    results.push({
      restaurantId: restaurant.id,
      name: restaurant.name,
      website: restaurant.website,
      status: response.status,
      observedAt: new Date().toISOString(),
      keywordHits: keywords.filter((keyword) => lower.includes(keyword)),
      candidateLinks: linksFromHtml(html, restaurant.website),
      reviewState: "needs-review"
    });
  } catch (error) {
    results.push({ restaurantId: restaurant.id, name: restaurant.name, website: restaurant.website, error: error.message, observedAt: new Date().toISOString(), reviewState: "needs-review" });
  }
}

await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(new URL("../data/build/official-site-signals.json", import.meta.url), JSON.stringify({ generatedAt: new Date().toISOString(), count: results.length, results }, null, 2));
console.log(`Checked ${results.length} official websites for menu/special/event signals.`);
