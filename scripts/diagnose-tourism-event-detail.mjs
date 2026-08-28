const url = "https://novascotia.com/event/festa-italiana-halifax/";
const response = await fetch(url, {
  headers: { "User-Agent": "HalifaxSourced/0.9 (+https://github.com/JeremyHennessy/HalifaxSourced)", Accept: "text/html,application/xhtml+xml" },
  redirect: "follow",
  signal: AbortSignal.timeout(15000)
});
const html = await response.text();
const clean = String(html)
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<br\s*\/?>/gi, "\n")
  .replace(/<\/(?:p|div|li|h1|h2|h3|h4|h5|h6|article|section|tr)>/gi, "\n")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ")
  .replace(/\n\s+/g, "\n")
  .replace(/\n{2,}/g, "\n")
  .trim();
const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null;
const lines = clean.split(/\n+/).map((line) => line.trim()).filter(Boolean);
const dateIndex = lines.findIndex((line) => /^Date$/i.test(line));
const locationIndex = lines.findIndex((line) => /^Location$/i.test(line));
const jsonLdScripts = [...html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
const jsonLdTypes = [];
for (const match of jsonLdScripts) {
  try {
    const data = JSON.parse(match[1].trim());
    const values = Array.isArray(data) ? data : [data];
    for (const value of values) {
      const graph = value?.["@graph"] || [];
      for (const node of [value, ...(Array.isArray(graph) ? graph : [])]) if (node?.["@type"]) jsonLdTypes.push(node["@type"]);
    }
  } catch {}
}
console.log(JSON.stringify({
  status: response.status,
  finalUrl: response.url,
  bytes: html.length,
  h1,
  containsHalifaxMetro: /Halifax Metro/i.test(clean),
  dateIndex,
  dateNext: dateIndex >= 0 ? lines.slice(dateIndex + 1, dateIndex + 4) : [],
  locationIndex,
  locationNext: locationIndex >= 0 ? lines.slice(locationIndex + 1, locationIndex + 5) : [],
  jsonLdScriptCount: jsonLdScripts.length,
  jsonLdTypes
}, null, 2));
if (!response.ok) throw new Error(`detail_http_${response.status}`);
if (!/Halifax Metro/i.test(clean)) throw new Error("detail_missing_halifax_metro");
if (dateIndex < 0) throw new Error("detail_missing_date_section");
