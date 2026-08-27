import { mkdir, readFile, writeFile } from "node:fs/promises";

const catalog = JSON.parse(await readFile(new URL("../data/build/catalog.json", import.meta.url), "utf8"));
const targets = catalog.restaurants.filter((restaurant) => restaurant.website).slice(0, Number(process.env.OFFICIAL_SITE_LIMIT ?? 9999));
const signalGroups = {
  menu: ["menu", "food menu", "drink menu", "cocktail", "wine list"],
  specials: ["happy hour", "special", "specials", "daily feature", "features", "deal", "offers", "promo"],
  events: ["event", "events", "live music", "trivia", "dj", "calendar", "ticket", "show", "karaoke"],
  patio: ["patio", "rooftop", "terrace", "outdoor seating", "beer garden", "sidewalk"],
  openings: ["now open", "opening soon", "grand opening", "soft opening", "new location", "coming soon", "newly opened"],
  brunch: ["brunch", "breakfast"],
  reservations: ["reservation", "reserve", "book a table", "opentable", "resy"],
  takeout: ["takeout", "take away", "pickup", "pick up", "order online", "delivery"]
};
const keywords = [...new Set(Object.values(signalGroups).flat())];
const results = [];

function cleanText(value) {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueLinks(links) {
  const seen = new Set();
  return links.filter((link) => {
    const key = `${link.href}|${link.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function classifySignal(text) {
  const haystack = text.toLowerCase();
  return Object.fromEntries(
    Object.entries(signalGroups).map(([group, groupKeywords]) => [
      group,
      groupKeywords.filter((keyword) => haystack.includes(keyword))
    ])
  );
}

function linksFromHtml(html, baseUrl) {
  const links = [];
  const pattern = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis;
  for (const match of html.matchAll(pattern)) {
    try {
      const href = new URL(match[1], baseUrl).href;
      const text = cleanText(match[2]);
      const signalMatches = classifySignal(`${href} ${text}`);
      if (Object.values(signalMatches).some((hits) => hits.length)) links.push({ text: text || href, href, signalMatches });
    } catch {}
  }
  return uniqueLinks(links).slice(0, 24);
}

for (const restaurant of targets) {
  const observedAt = new Date().toISOString();
  try {
    const response = await fetch(restaurant.website, { headers: { "User-Agent": "HalifaxSourced/0.1 (+https://github.com/JeremyHennessy/HalifaxSourced)" } });
    const html = await response.text();
    const pageText = cleanText(html);
    const signalMatches = classifySignal(`${restaurant.website} ${pageText}`);
    results.push({
      restaurantId: restaurant.id,
      name: restaurant.name,
      website: restaurant.website,
      status: response.status,
      observedAt,
      keywordHits: keywords.filter((keyword) => `${restaurant.website} ${pageText}`.toLowerCase().includes(keyword)),
      signalMatches,
      candidateLinks: linksFromHtml(html, restaurant.website),
      sourceKind: "official_website",
      reviewState: "cross-check"
    });
  } catch (error) {
    results.push({ restaurantId: restaurant.id, name: restaurant.name, website: restaurant.website, error: error.message, observedAt, sourceKind: "official_website", reviewState: "cross-check" });
  }
}

const kindCounts = Object.fromEntries(
  Object.keys(signalGroups).map((group) => [
    group,
    results.filter((result) => (result.signalMatches?.[group]?.length ?? 0) > 0 || result.candidateLinks?.some((link) => (link.signalMatches?.[group]?.length ?? 0) > 0)).length
  ])
);
const payload = { generatedAt: new Date().toISOString(), count: results.length, kindCounts, signalGroups, results };

await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(new URL("../data/build/official-site-signals.json", import.meta.url), JSON.stringify(payload, null, 2));
await writeFile(new URL("../data/official-site-signals.js", import.meta.url), `window.HALIFAX_OFFICIAL_SITE_SIGNALS = ${JSON.stringify(payload, null, 2)};\n`);
console.log(`Checked ${results.length} official websites for menu/special/event/patio/opening signals.`);
console.log(`Signal counts: ${Object.entries(kindCounts).map(([key, value]) => `${key}=${value}`).join(", ")}`);