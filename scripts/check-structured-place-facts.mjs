import { mkdir, readFile, writeFile } from "node:fs/promises";
const facts=JSON.parse(await readFile(new URL("../data/build/structured-place-facts.json",import.meta.url),"utf8"));
const catalog=JSON.parse(await readFile(new URL("../data/build/catalog.json",import.meta.url),"utf8"));
const ids=new Set((catalog.restaurants||[]).map(r=>r.id)); const errors=[]; const warnings=[]; const seen=new Set();
const DAYS=["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
function validUrl(v){try{return ["http:","https:"].includes(new URL(String(v||"")).protocol)}catch{return false}}
function validDate(v){return Number.isFinite(Date.parse(String(v||"")))}
function validTime(v){return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v||""))}
for(const r of facts.records||[]){ if(!r.restaurantId||!ids.has(r.restaurantId))errors.push(`unknown_restaurant:${r.restaurantId}`); if(seen.has(r.restaurantId))errors.push(`duplicate_record:${r.restaurantId}`); seen.add(r.restaurantId); if(!validUrl(r.sourceUrl)||!validDate(r.observedAt)||!validDate(r.lastVerifiedAt)||r.sourceKind!=="official_website_structured_facts")errors.push(`invalid_record_provenance:${r.restaurantId}`); if(r.hours){for(const day of DAYS){if(!Array.isArray(r.hours[day]))errors.push(`invalid_hours_day:${r.restaurantId}:${day}`); for(const x of r.hours[day]||[]){if(!validTime(x.open)||!validTime(x.close)||typeof x.overnight!=="boolean")errors.push(`invalid_hours_interval:${r.restaurantId}:${day}`);}}}
 for(const f of r.features||[]){if(!f.feature||!f.evidencePhrase||!validUrl(f.sourceUrl)||!validDate(f.observedAt))errors.push(`invalid_feature:${r.restaurantId}:${f.feature}`)}
 for(const m of r.menus||[]){if(!m.menuType||!validUrl(m.url)||!["html","pdf"].includes(m.format)||!validDate(m.verifiedAt))errors.push(`invalid_menu:${r.restaurantId}`)}
 for(const a of [...(r.reservations||[]),...(r.ordering||[])]){if(!a.provider||!validUrl(a.url)||!validDate(a.verifiedAt))errors.push(`invalid_action:${r.restaurantId}`)} }
if((facts.failures||[]).length)warnings.push(...facts.failures.slice(0,30).map(f=>`source_failure:${f.restaurantId}:${f.reason}`));
const report={generatedAt:new Date().toISOString(),checkedPlaces:facts.checkedPlaces||0,records:(facts.records||[]).length,counts:facts.counts||{},sourceFailures:(facts.failures||[]).length,errors,warnings}; await mkdir(new URL("../artifacts",import.meta.url),{recursive:true}); await writeFile(new URL("../artifacts/structured-place-facts-report.json",import.meta.url),JSON.stringify(report,null,2)+"\n"); console.log(JSON.stringify(report,null,2)); if(errors.length)process.exit(1);
