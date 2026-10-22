import { sourceAccessState } from './lib/source-access-state.mjs';
import { accessUrl, accessHost, validClock, digest } from './lib/link-access-policy.mjs';
import { createRobotsAllows } from "./lib/robots-policy.mjs";
import { fetchPublicSource } from "./lib/fetch-public-source.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { LIFECYCLE_SIGNAL_GROUPS } from "./lib/lifecycle-language.mjs";

const catalog = JSON.parse(await readFile(new URL("../data/build/catalog.json", import.meta.url), "utf8"));
const targets = (catalog.restaurants || []).filter((restaurant) => restaurant.website).slice(0, Number(process.env.OFFICIAL_SITE_LIMIT ?? 9999));
const delayMs = Number(process.env.OFFICIAL_SITE_DELAY_MS ?? 120);
const timeoutMs = Number(process.env.OFFICIAL_SITE_TIMEOUT_MS ?? 12000);
const concurrency = Math.max(1, Math.min(16, Number(process.env.OFFICIAL_SITE_CONCURRENCY ?? 8)));
const userAgent = "HalifaxSourced/0.3 (+https://github.com/JeremyHennessy/HalifaxSourced)";
const robotsAllows = createRobotsAllows({ userAgent, timeoutMs });
const signalGroups = {
  menu: ["menu", "food menu", "drink menu", "cocktail", "wine list"],
  specials: ["happy hour", "special", "specials", "daily feature", "features", "deal", "offers", "promo"],
  events: ["event", "events", "live music", "trivia", "dj", "calendar", "ticket", "show", "karaoke"],
  patio: ["patio", "rooftop", "terrace", "outdoor seating", "beer garden", "sidewalk"],
  openings: ["now open", "opening soon", "grand opening", "soft opening", "new location", "coming soon", "newly opened"],
  ...LIFECYCLE_SIGNAL_GROUPS,
  brunch: ["brunch", "breakfast"],
  reservations: ["reservation", "reserve", "book a table", "opentable", "resy"],
  takeout: ["takeout", "take away", "pickup", "pick up", "order online", "delivery"]
};
const keywords = [...new Set(Object.values(signalGroups).flat())];
const previous = JSON.parse(await readFile(new URL('../data/build/official-site-signals.json',import.meta.url),'utf8').catch(error=>{if(error.code==='ENOENT')return '{"results":[]}';throw error;}));
const results = new Array(targets.length), assessments = new Array(targets.length), sourceHistory=[...(previous.sourceHistory||[])];
function priorAssociation(row,website) {
  if(typeof website!=='string' || typeof row.website!=='string' || (Object.hasOwn(row,'sourceAssociation') && typeof row.sourceAssociation!=='string'))return false;
  try { return accessUrl(Object.hasOwn(row,'sourceAssociation')?row.sourceAssociation:row.website)===accessUrl(website); }
  catch { return false; }
}
function priorDisqualification(prior) {
  const current=(catalog.restaurants||[]).filter(row=>typeof prior?.restaurantId==='string' && row.id===prior.restaurantId);
  if(current.length!==1)return 'identity_not_current';
  const restaurant=current[0];
  if(!priorAssociation(prior,restaurant.website))return 'source_association_changed';
  try { if(accessHost(accessUrl(prior.website))!==accessHost(accessUrl(restaurant.website)))return 'invalid_prior_evidence'; }
  catch { return 'invalid_prior_evidence'; }
  // Legacy successful observations have no attempted/state marker. Contradictory
  // root markers are not old content evidence; latestAssessment is separate and
  // deliberately does not change the qualification of the genuine observation.
  if(prior.sourceKind!=='official_website' || prior.error || !Number.isInteger(prior.status) || prior.status<200 || prior.status>=300 || !validClock(prior.observedAt) ||
    (Object.hasOwn(prior,'attempted') && prior.attempted!==true) ||
    (Object.hasOwn(prior,'state') && !['ok','observed'].includes(prior.state)) ||
    Object.hasOwn(prior,'accessHold') || Object.hasOwn(prior,'holdTarget') || prior.reusedObservation===true || prior.reviewState==='restricted')return 'invalid_prior_evidence';
  return null;
}
function archivePrior(prior,reason) {
  const evidenceId=digest(prior);
  if(!sourceHistory.some(entry=>entry.evidenceId===evidenceId))sourceHistory.push({evidenceId,reason,record:prior});
}
// Qualify every prior record before either refreshed retention or bounded-batch
// carry-forward. Being outside today's selected prefix is not admission evidence.
const qualifiedPrior=[];
for(const prior of previous.results||[]) {
  const reason=priorDisqualification(prior);
  if(reason)archivePrior(prior,reason);else qualifiedPrior.push(prior);
}
function retainOrFail(index,restaurant,website,assessment) {
  assessments[index]=assessment;
  const prior=qualifiedPrior.find(row=>row.restaurantId===restaurant.id && priorAssociation(row,website));
  results[index]=prior?{...prior,latestAssessment:assessment}:{restaurantId:restaurant.id,name:restaurant.name,website,sourceKind:'official_website',reviewState:assessment.state==='held'||/^(robots_disallow|http_(401|403|429))$/.test(assessment.error)?'restricted':'cross-check',...assessment};
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function safeUrl(value, base) {
  try {
    const url = new URL(String(value ?? ""), base);
    return ["http:", "https:"].includes(url.protocol) ? url : null;
  } catch { return null; }
}
function hostKey(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return "invalid"; }
}
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
  return Object.fromEntries(Object.entries(signalGroups).map(([group, groupKeywords]) => [group, groupKeywords.filter((keyword) => haystack.includes(keyword))]));
}
function linksFromHtml(html, baseUrl) {
  const links = [];
  const pattern = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis;
  for (const match of html.matchAll(pattern)) {
    const url = safeUrl(match[1], baseUrl);
    if (!url) continue;
    const text = cleanText(match[2]);
    const signalMatches = classifySignal(`${url.href} ${text}`);
    if (Object.values(signalMatches).some((hits) => hits.length)) links.push({ text: text || url.href, href: url.href, signalMatches });
  }
  return uniqueLinks(links).slice(0, 24);
}
async function scanRestaurant(item) {
  const { restaurant, index, website } = item;
  let attempted=false, httpObservation=null;
  const fail=(reason,accessHold=null)=>retainOrFail(index,restaurant,website,{restaurantId:restaurant.id,website,assessedAt:new Date().toISOString(),attempted,observedAt:null,state:accessHold?'held':'failed',error:reason,...(accessHold?{accessHold}:{}),...(httpObservation?{httpObservation}:{})});
  const hold=sourceAccessState().access.find(website);
  if(hold){fail('source_access_hold',hold);return;}
  try {
    const signal=AbortSignal.timeout(timeoutMs);
    const response = await fetchPublicSource(website, { headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml" }, redirect: "manual", signal }, robotsAllows, {
      beforeRequest(){attempted=true;}, afterResponse(url,response,receipt){httpObservation={url,status:response.status,observedAt:receipt.observedAt};}
    });
    if(!response.ok){fail(`http_${response.status}`);return;}
    const contentType = response.headers.get("content-type") || "";
    if (!/html|xhtml/i.test(contentType)) {fail('not_html');return;}
    const html = await response.text();
    signal.throwIfAborted();
    const pageText = cleanText(html), resolvedWebsite = response.url || website;
    const signalMatches = classifySignal(`${resolvedWebsite} ${pageText}`);
    const observedAt=httpObservation.observedAt;
    assessments[index]={restaurantId:restaurant.id,website,assessedAt:new Date().toISOString(),attempted:true,observedAt,state:'observed'};
    results[index] = {
      restaurantId: restaurant.id, name: restaurant.name, website: resolvedWebsite, sourceAssociation:website,
      status: response.status, observedAt,
      keywordHits: keywords.filter((keyword) => `${resolvedWebsite} ${pageText}`.toLowerCase().includes(keyword)),
      signalMatches, candidateLinks: linksFromHtml(html, resolvedWebsite),
      sourceKind: "official_website", reviewState:"cross-check"
    };
  } catch (error) { fail(error.name === "TimeoutError" ? "timeout" : error.message,error.accessHold); }
}

const groups = new Map();
for (const [index, restaurant] of targets.entries()) {
  const website = safeUrl(restaurant.website)?.href;
  if (!website) {
    results[index] = { restaurantId: restaurant.id, name: restaurant.name, website: restaurant.website, error: "invalid_url", assessedAt: new Date().toISOString(), attempted:false, observedAt:null, sourceKind: "official_website", reviewState: "cross-check" };
    continue;
  }
  const host = hostKey(website);
  if (!groups.has(host)) groups.set(host, []);
  groups.get(host).push({ restaurant, index, website });
}

const hostGroups = [...groups.values()];
let nextGroup = 0;
async function worker() {
  while (true) {
    const current = nextGroup++;
    if (current >= hostGroups.length) return;
    for (const item of hostGroups[current]) {
      await scanRestaurant(item);
      if (delayMs > 0) await sleep(delayMs);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, hostGroups.length || 1) }, () => worker()));

const refreshedIds=new Set(results.filter(Boolean).map(row=>row.restaurantId));
const finalResults = [...results.filter(Boolean),...qualifiedPrior.filter(row=>!refreshedIds.has(row.restaurantId))];
const kindCounts = Object.fromEntries(Object.keys(signalGroups).map((group) => [
  group,
  finalResults.filter((result) => (result.signalMatches?.[group]?.length ?? 0) > 0 || result.candidateLinks?.some((link) => (link.signalMatches?.[group]?.length ?? 0) > 0)).length
]));
const payload = { generatedAt: new Date().toISOString(), count: finalResults.length, kindCounts, signalGroups, assessments:assessments.filter(Boolean), checkedWebsites:targets.length, sourceHistory, results: finalResults };
await mkdir(new URL("../data/build", import.meta.url), { recursive: true });
await writeFile(new URL("../data/build/official-site-signals.json", import.meta.url), JSON.stringify(payload, null, 2));
await writeFile(new URL("../data/official-site-signals.js", import.meta.url), `window.HALIFAX_OFFICIAL_SITE_SIGNALS = ${JSON.stringify(payload, null, 2)};\n`);
console.log(`Assessed ${targets.length} official website refreshes across ${hostGroups.length} host groups with concurrency=${concurrency}; retained ${finalResults.length} current-identity records.`);
console.log(`Signal counts: ${Object.entries(kindCounts).map(([key, value]) => `${key}=${value}`).join(", ")}`);
