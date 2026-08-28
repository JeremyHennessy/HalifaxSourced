const userAgent = "HalifaxSourced/0.9 (+https://github.com/JeremyHennessy/HalifaxSourced)";
const groupUrl = "https://www.tixr.com/groups/alderneylanding";
function decode(value) {
  return String(value ?? "").replace(/<[^>]+>/g, " ").replace(/&amp;/gi, "&").replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"').replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}
function absolute(value, base) { try { return new URL(value, base).href; } catch { return null; } }
const response = await fetch(groupUrl, { headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(12000) });
if (!response.ok) throw new Error(`group_http_${response.status}`);
const html = await response.text();
const events = [];
for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']*\/groups\/alderneylanding\/events\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
  const url = absolute(match[1], response.url || groupUrl);
  const title = decode(match[2]);
  if (!url || !title || events.some((item) => item.url === url)) continue;
  events.push({ title, url });
}
console.log(`Tixr Alderney group: status=${response.status}, eventLinks=${events.length}`);
for (const event of events.slice(0, 12)) console.log(`- ${event.title} | ${event.url}`);
if (events.length < 3) throw new Error(`tixr_alderney_too_thin:${events.length}`);
let detailOk = 0;
for (const event of events.slice(0, 5)) {
  const detail = await fetch(event.url, { headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(12000) });
  const body = await detail.text();
  const text = decode(body);
  const dateLike = text.match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}\b/i)?.[0] || null;
  console.log(`DETAIL ${detail.status} ${event.title} date=${dateLike || "none"} chars=${text.length}`);
  if (detail.ok && text.length > 100 && dateLike) detailOk += 1;
}
if (detailOk < 1) throw new Error(`tixr_detail_parse_unproven:${detailOk}`);
console.log(`Tixr Alderney diagnostic passed: group and ${detailOk} dated event detail pages are fetchable from GitHub Actions.`);
