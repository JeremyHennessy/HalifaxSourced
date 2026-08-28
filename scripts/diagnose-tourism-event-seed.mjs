const url = "https://novascotia.com/explore-nova-scotia/events/?region=29";
const response = await fetch(url, {
  headers: { "User-Agent": "HalifaxSourced/0.9 (+https://github.com/JeremyHennessy/HalifaxSourced)", Accept: "text/html,application/xhtml+xml" },
  redirect: "follow",
  signal: AbortSignal.timeout(15000)
});
if (!response.ok) throw new Error(`seed_http_${response.status}`);
const html = await response.text();
const rawLinks = [];
for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
  let parsed;
  try { parsed = new URL(match[1], response.url || url); } catch { continue; }
  if (parsed.hostname.replace(/^www\./, "") !== "novascotia.com") continue;
  if (!parsed.pathname.startsWith("/event/") || parsed.pathname === "/event/") continue;
  if (!rawLinks.includes(parsed.href)) rawLinks.push(parsed.href);
}
const importerLinks = [];
for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
  let parsed;
  try { parsed = new URL(match[1], response.url || url); } catch { continue; }
  if (parsed.hostname.replace(/^www\./, "") !== "novascotia.com") continue;
  if (!parsed.pathname.startsWith("/event/") || parsed.pathname === "/event/") continue;
  if (!importerLinks.includes(parsed.href)) importerLinks.push(parsed.href);
}
const markers = {
  rawEventLinks: rawLinks.length,
  importerAnchorEventLinks: importerLinks.length,
  containsHalifaxMetro: /Halifax Metro/i.test(html),
  containsLoadMore: /load more/i.test(html),
  containsWpJson: /wp-json|admin-ajax|rest_route/i.test(html),
  bytes: html.length,
  finalUrl: response.url
};
console.log(JSON.stringify(markers, null, 2));
console.log("RAW_EVENT_LINKS");
for (const link of rawLinks.slice(0, 20)) console.log(`- ${link}`);
console.log("IMPORTER_ANCHOR_EVENT_LINKS");
for (const link of importerLinks.slice(0, 20)) console.log(`- ${link}`);
if (!rawLinks.length) throw new Error("tourism_seed_contains_zero_event_hrefs");
