import { mkdir, readFile, writeFile } from "node:fs/promises";

const catalog = JSON.parse(await readFile(new URL("../data/build/catalog.json", import.meta.url), "utf8"));
const firstParty = JSON.parse(await readFile(new URL("../data/build/first-party-sources.json", import.meta.url), "utf8"));
const verifiedPages = JSON.parse(await readFile(new URL("../data/build/verified-source-pages.json", import.meta.url), "utf8").catch(() => "{}"));
const limit = Number(process.env.STRUCTURED_PLACE_FACT_LIMIT ?? 9999);
const delayMs = Number(process.env.STRUCTURED_PLACE_FACT_DELAY_MS ?? 120);
const timeoutMs = Number(process.env.STRUCTURED_PLACE_FACT_TIMEOUT_MS ?? 10000);
const concurrency = Math.max(1, Math.min(12, Number(process.env.STRUCTURED_PLACE_FACT_CONCURRENCY ?? 8)));
const userAgent = "HalifaxSourced/0.8 (+https://github.com/JeremyHennessy/HalifaxSourced)";
const DAY_MAP = new Map([
  ["monday", "monday"], ["mon", "monday"], ["mo", "monday"],
  ["tuesday", "tuesday"], ["tue", "tuesday"], ["tu", "tuesday"],
  ["wednesday", "wednesday"], ["wed", "wednesday"], ["we", "wednesday"],
  ["thursday", "thursday"], ["thu", "thursday"], ["th", "thursday"],
  ["friday", "friday"], ["fri", "friday"], ["fr", "friday"],
  ["saturday", "saturday"], ["sat", "saturday"], ["sa", "saturday"],
  ["sunday", "sunday"], ["sun", "sunday"], ["su", "sunday"]
]);
const DAYS = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
const reservationProviders = [
  ["opentable", /opentable\./i], ["resy", /resy\.com/i], ["tock", /exploretock\.com/i],
  ["sevenrooms", /sevenrooms\.com/i], ["bookenda", /bookenda\.com/i], ["touchbistro", /touchbistro\.com/i]
];
const orderingProviders = [
  ["restaurant_owned", /^(?!.*(?:doordash|ubereats|skipthedishes|ritual|toasttab|chownow|order\.online|square\.site)).*$/i],
  ["toast", /toasttab\.com/i], ["doordash", /doordash\.com/i], ["uber_eats", /ubereats\.com/i],
  ["skip", /skipthedishes\.com/i], ["ritual", /ritual\.co/i], ["chownow", /chownow\.com/i], ["square", /square\.site/i]
];
const featurePatterns = [
  ["patio", /\bpatio\b/i], ["rooftop", /\brooftop\b/i], ["outdoor_seating", /\boutdoor seating\b/i],
  ["waterfront", /\bwaterfront\b/i], ["water_view", /\bwater view\b|\bharbour view\b|\bharbor view\b/i],
  ["live_music", /\blive music\b/i], ["karaoke", /\bkaraoke\b/i], ["trivia", /\btrivia\b/i],
  ["brunch", /\bbrunch\b/i], ["breakfast", /\bbreakfast\b/i], ["late_night", /\blate[- ]night\b/i],
  ["private_dining", /\bprivate dining\b/i], ["catering", /\bcatering\b/i], ["takeout", /\btakeout\b|\btake[- ]out\b/i],
  ["delivery", /\bdelivery\b/i], ["wheelchair_entrance", /\bwheelchair accessible entrance\b|\bwheelchair[- ]accessible entrance\b/i],
  ["accessible_seating", /\baccessible seating\b/i], ["accessible_washroom", /\baccessible washroom\b|\baccessible restroom\b/i],
  ["step_free", /\bstep[- ]free\b/i], ["elevator", /\belevator\b|\blift access\b/i]
];
const robotsCache = new Map();

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function safeUrl(value, base) { try { const u = new URL(String(value ?? ""), base); return ["http:","https:"].includes(u.protocol) ? u.href : null; } catch { return null; } }
function cleanText(value) { return String(value ?? "").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&amp;/gi,"&").replace(/&nbsp;/gi," ").replace(/&#39;|&apos;/gi,"'").replace(/&quot;/gi,'"').replace(/\s+/g," ").trim(); }
function flattenJsonLd(value, out=[]) { if (Array.isArray(value)) for (const x of value) flattenJsonLd(x,out); else if (value && typeof value === "object") { out.push(value); if (value["@graph"]) flattenJsonLd(value["@graph"],out); } return out; }
function validTime(value) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || "")); }
function normalizeTime(value) {
  const raw = String(value ?? "").trim().toUpperCase();
  if (validTime(raw)) return raw;
  const m = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/);
  if (!m) return null;
  let h = Number(m[1]) % 12; if (m[3] === "PM") h += 12;
  return `${String(h).padStart(2,"0")}:${m[2] || "00"}`;
}
function dayName(value) {
  const raw = String(value ?? "").split("/").at(-1).toLowerCase().replace(/[^a-z]/g,"");
  return DAY_MAP.get(raw) || null;
}
function emptyWeekly() { return Object.fromEntries(DAYS.map((d)=>[d,[]])); }
function addInterval(weekly, day, open, close, sourceForm) {
  if (!day || !validTime(open) || !validTime(close)) return;
  weekly[day].push({ open, close, overnight: close <= open && close !== "00:00", sourceForm });
}
function parseOpeningHoursSpecification(specs) {
  const weekly = emptyWeekly(); let count = 0;
  for (const spec of Array.isArray(specs) ? specs : [specs]) {
    if (!spec || typeof spec !== "object") continue;
    const open = normalizeTime(spec.opens); const close = normalizeTime(spec.closes);
    const days = Array.isArray(spec.dayOfWeek) ? spec.dayOfWeek : [spec.dayOfWeek];
    if (!open || !close) continue;
    for (const d of days) { const day = dayName(d); if (day) { addInterval(weekly, day, open, close, "schema_openingHoursSpecification"); count += 1; } }
  }
  return count ? weekly : null;
}
function rangeDays(start, end) {
  const a = DAYS.indexOf(start), b = DAYS.indexOf(end); if (a<0 || b<0) return [];
  const result=[]; let i=a; for(let n=0;n<7;n+=1){ result.push(DAYS[i]); if(i===b) break; i=(i+1)%7; } return result;
}
function parseOpeningHoursStrings(values) {
  const weekly = emptyWeekly(); let count=0;
  for (const value of Array.isArray(values) ? values : [values]) {
    const text=String(value||"").trim();
    const m=text.match(/^([A-Za-z]{2,9})(?:\s*-\s*([A-Za-z]{2,9}))?\s+([^\s]+)\s*-\s*([^\s]+)$/);
    if(!m) continue;
    const start=dayName(m[1]), end=dayName(m[2]||m[1]); const open=normalizeTime(m[3]), close=normalizeTime(m[4]);
    if(!start||!end||!open||!close) continue;
    for(const day of rangeDays(start,end)){ addInterval(weekly,day,open,close,"schema_openingHours"); count+=1; }
  }
  return count ? weekly : null;
}
function structuredAddress(node) {
  const address=node?.address; if (!address) return null;
  if (typeof address === "string") return address.trim() || null;
  if (typeof address !== "object") return null;
  const parts=[address.streetAddress,address.addressLocality,address.addressRegion,address.postalCode,address.addressCountry].filter(Boolean).map(String);
  return parts.length ? parts.join(", ") : null;
}
function provider(url, list) { for (const [name,re] of list) if (re.test(String(url||""))) return name; return null; }
function menuType(label,url) {
  const h=`${label||""} ${url||""}`.toLowerCase();
  if(/happy[- ]?hour/.test(h)) return "happy_hour"; if(/brunch/.test(h)) return "brunch"; if(/breakfast/.test(h)) return "breakfast";
  if(/lunch/.test(h)) return "lunch"; if(/dinner/.test(h)) return "dinner"; if(/cocktail|drinks?/.test(h)) return "drinks";
  if(/wine/.test(h)) return "wine"; if(/dessert/.test(h)) return "dessert"; if(/cater/.test(h)) return "catering"; if(/takeout|take-out/.test(h)) return "takeout";
  return "general";
}
async function robotsAllows(url) {
  const u=new URL(url); if(!robotsCache.has(u.origin)) robotsCache.set(u.origin,(async()=>{try{const r=await fetch(new URL('/robots.txt',u.origin),{headers:{"User-Agent":userAgent},signal:AbortSignal.timeout(Math.min(timeoutMs,7000))}); if(r.status===401||r.status===403)return ['/']; if(!r.ok)return []; let active=false; const dis=[]; for(const raw of (await r.text()).split(/\r?\n/)){const line=raw.replace(/#.*$/,"").trim(); if(/^user-agent\s*:/i.test(line)){active=/^user-agent\s*:\s*\*\s*$/i.test(line);continue;} if(active){const m=line.match(/^disallow\s*:\s*(.*)$/i); if(m?.[1])dis.push(m[1].trim());}} return dis;}catch{return [];}})()); const dis=await robotsCache.get(u.origin); return !dis.some((p)=>p==='/'||(p&&u.pathname.startsWith(p)));
}
async function fetchHtml(url) {
  if(!(await robotsAllows(url))) return {error:"robots_disallow",url};
  try { const r=await fetch(url,{headers:{"User-Agent":userAgent,Accept:"text/html,application/xhtml+xml"},redirect:"follow",signal:AbortSignal.timeout(timeoutMs)}); if(!r.ok)return {error:`http_${r.status}`,url}; const ct=r.headers.get('content-type')||''; if(!/html|xhtml/i.test(ct))return {error:"not_html",url}; return {html:await r.text(),url:r.url||url}; } catch(e){ return {error:e.name==='TimeoutError'?"timeout":e.message,url}; }
}

const placesById=new Map((catalog.restaurants||[]).map((p)=>[p.id,p]));
const verifiedRecords=Array.isArray(verifiedPages.records)?verifiedPages.records:Array.isArray(verifiedPages.pages)?verifiedPages.pages:[];
const verifiedByRestaurant=new Map();
for(const page of verifiedRecords){ const id=page.restaurantId; if(!id)continue; if(!verifiedByRestaurant.has(id))verifiedByRestaurant.set(id,[]); verifiedByRestaurant.get(id).push(page); }
const targets=(firstParty.records||[]).filter((r)=>placesById.has(r.restaurantId)&&safeUrl(r.resolvedUrl||r.website)).slice(0,limit);
const output=new Array(targets.length); const failures=[]; let cursor=0;
async function worker(){ while(true){ const i=cursor++; if(i>=targets.length)return; const source=targets[i]; const place=placesById.get(source.restaurantId); const observedAt=new Date().toISOString(); const fetched=await fetchHtml(source.resolvedUrl||source.website); if(!fetched.html){failures.push({restaurantId:source.restaurantId,sourceUrl:source.resolvedUrl||source.website,reason:fetched.error}); continue;} const nodes=[]; for(const m of fetched.html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{flattenJsonLd(JSON.parse(m[1].trim()),nodes);}catch{}} const fact={restaurantId:source.restaurantId,name:place.name,sourceUrl:fetched.url,observedAt,lastVerifiedAt:observedAt,sourceKind:"official_website_structured_facts",reviewState:"verified_source",hours:null,phone:null,email:null,address:null,features:[],menus:[],reservations:[],ordering:[]};
      for(const node of nodes){ if(!fact.phone && node.telephone) fact.phone=String(node.telephone).trim(); if(!fact.email && node.email) fact.email=String(node.email).replace(/^mailto:/i,"").trim(); if(!fact.address) fact.address=structuredAddress(node); if(!fact.hours){ fact.hours=parseOpeningHoursSpecification(node.openingHoursSpecification)||parseOpeningHoursStrings(node.openingHours); } }
      if(!fact.phone){ const tel=fetched.html.match(/href\s*=\s*["']tel:([^"']+)["']/i); if(tel)fact.phone=cleanText(tel[1]); }
      const text=cleanText(fetched.html); for(const [feature,re] of featurePatterns){ const match=text.match(re); if(match)fact.features.push({feature,evidencePhrase:match[0],sourceUrl:fetched.url,observedAt,lastVerifiedAt:observedAt,confidence:"official_source_explicit_text"}); }
      for(const page of verifiedByRestaurant.get(source.restaurantId)||[]){ const url=safeUrl(page.url||page.sourceUrl); if(!url)continue; const kind=String(page.kind||page.type||"").toLowerCase(); if(/menu/.test(kind)||/menu/i.test(`${page.label||""} ${url}`)) fact.menus.push({menuType:menuType(page.label,url),title:page.label||"Menu",url,format:/\.pdf(?:$|\?)/i.test(url)?"pdf":"html",locationSpecific:true,verifiedAt:page.verifiedAt||page.observedAt||observedAt,source:"verified_restaurant_owned_page",status:"verified"}); }
      for(const link of source.relatedLinks||[]){ const url=safeUrl(link.url); if(!url)continue; if(link.kind==='reservations')fact.reservations.push({provider:provider(url,reservationProviders)||"restaurant_owned",url,locationSpecific:true,observedAt:link.observedAt||observedAt,verifiedAt:link.lastVerifiedAt||link.observedAt||observedAt,status:"verified_link"}); if(link.kind==='ordering')fact.ordering.push({provider:provider(url,orderingProviders)||"restaurant_owned",url,locationSpecific:true,mode:/doordash|ubereats|skipthedishes/i.test(url)?"third_party_delivery":"first_party_or_direct",observedAt:link.observedAt||observedAt,verifiedAt:link.lastVerifiedAt||link.observedAt||observedAt,status:"verified_link"}); if(link.kind==='menu' && !fact.menus.some((m)=>m.url===url))fact.menus.push({menuType:menuType(link.label,url),title:link.label||"Menu",url,format:/\.pdf(?:$|\?)/i.test(url)?"pdf":"html",locationSpecific:true,verifiedAt:link.lastVerifiedAt||link.observedAt||observedAt,source:"official_website_link",status:"verified_link"}); }
      const dedupe=(arr,key)=>arr.filter((x,j,a)=>a.findIndex((y)=>key(y)===key(x))===j); fact.features=dedupe(fact.features,(x)=>x.feature); fact.menus=dedupe(fact.menus,(x)=>x.url); fact.reservations=dedupe(fact.reservations,(x)=>x.url); fact.ordering=dedupe(fact.ordering,(x)=>x.url);
      if(fact.hours||fact.phone||fact.email||fact.address||fact.features.length||fact.menus.length||fact.reservations.length||fact.ordering.length)output[i]=fact;
      if(delayMs>0)await sleep(delayMs);
  }}
await Promise.all(Array.from({length:Math.min(concurrency,targets.length||1)},()=>worker()));
const records=output.filter(Boolean); const counts={records:records.length,hours:records.filter(r=>r.hours).length,phone:records.filter(r=>r.phone).length,email:records.filter(r=>r.email).length,address:records.filter(r=>r.address).length,features:records.filter(r=>r.features.length).length,menus:records.filter(r=>r.menus.length).length,reservations:records.filter(r=>r.reservations.length).length,ordering:records.filter(r=>r.ordering.length).length};
const payload={version:1,generatedAt:new Date().toISOString(),checkedPlaces:targets.length,failures:failures.slice(0,200),counts,records};
await mkdir(new URL("../data/build",import.meta.url),{recursive:true}); await writeFile(new URL("../data/build/structured-place-facts.json",import.meta.url),JSON.stringify(payload,null,2)+"\n"); await writeFile(new URL("../data/structured-place-facts.js",import.meta.url),`window.HALIFAX_STRUCTURED_PLACE_FACTS = ${JSON.stringify(payload,null,2)};\n`); console.log(JSON.stringify({checkedPlaces:targets.length,failures:failures.length,...counts},null,2));
