// Isolated diagnostic only; rerun marker 2026-08-28T22:31Z.
const url = "https://novascotia.com/event/festa-italiana-halifax/";
const response = await fetch(url, { headers: { "User-Agent": "HalifaxSourced/0.9 (+https://github.com/JeremyHennessy/HalifaxSourced)", Accept: "text/html" }, signal: AbortSignal.timeout(15000) });
const html = await response.text();
function flatten(value, out=[]) { if (!value) return out; if (Array.isArray(value)) { for (const item of value) flatten(item,out); return out; } if (typeof value !== 'object') return out; if (value['@graph']) flatten(value['@graph'],out); out.push(value); return out; }
const eventNodes=[];
for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
  try {
    const parsed=JSON.parse(match[1].trim());
    for (const item of flatten(parsed)) {
      const types=Array.isArray(item['@type'])?item['@type']:[item['@type']];
      if(types.some(type=>/Event$/i.test(String(type||'')))) eventNodes.push(item);
    }
  } catch {}
}
console.log(`EVENT_NODES=${eventNodes.length}`);
for (const item of eventNodes) {
  console.log(JSON.stringify({
    type:item['@type'], name:item.name, startDate:item.startDate, endDate:item.endDate,
    startStamp:Date.parse(String(item.startDate||'')), endStamp:Date.parse(String(item.endDate||item.startDate||'')),
    url:item.url, id:item['@id'], location:item.location, offers:item.offers
  },null,2));
}
if(!eventNodes.length) throw new Error('no_event_jsonld_nodes');
