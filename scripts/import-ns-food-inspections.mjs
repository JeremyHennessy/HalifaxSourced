import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';

const baseUrl = 'https://novascotia.ca/nse/food-protection/reports/';
const sourceName = 'Government of Nova Scotia Food Establishment Inspection Reports';
const jsonUrl = new URL('../data/build/ns-food-inspections.json', import.meta.url);
const jsUrl = new URL('../data/ns-food-inspections.js', import.meta.url);
const cities = [...new Set((process.env.NS_FOOD_CITIES ?? 'Halifax,Dartmouth,Bedford').split(',').map(city => city.trim()).filter(Boolean))];
const timeoutMs = Number(process.env.NS_FOOD_TIMEOUT_MS || 15000);
const headers = { 'User-Agent': 'HalifaxSourced/0.1 (+https://github.com/JeremyHennessy/HalifaxSourced)' };

if (!cities.length || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid inspection search configuration');

function decodeHtml(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hiddenValue(html, name) {
  return html.match(new RegExp('<input\\b(?=[^>]*\\bname=["\\x27]' + name + '["\\x27])(?=[^>]*\\bvalue=["\\x27]([^"\\x27]*)["\\x27])[^>]*>', 'i'))?.[1] ?? null;
}

async function searchCity(city, observedAt) {
  const formResponse = await fetch(baseUrl, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!formResponse.ok) throw new Error('Inspection search form HTTP ' + formResponse.status + ' for ' + city);
  const form = await formResponse.text();
  const state = {};
  for (const key of ['__VIEWSTATE', '__VIEWSTATEGENERATOR', '__EVENTVALIDATION']) {
    state[key] = hiddenValue(form, key);
    if (!state[key]) throw new Error('Missing ' + key + ' from inspection search form for ' + city);
  }
  const body = new URLSearchParams({
    __EVENTTARGET: '', __EVENTARGUMENT: '', ...state,
    TxtEstablishmentName: '', TxtEstablishmentStreetNo: '', TxtEstablishmentStreet: '', TxtCity: city,
    DropFromMonth: '', DropFromDay: '', DropFromYear: '',
    DropToMonth: '', DropToDay: '', DropToYear: '', BttnSubmit: 'Submit'
  });
  const response = await fetch(baseUrl, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    body, signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error('Inspection search HTTP ' + response.status + ' for ' + city);
  const html = await response.text();
  const currentAsOf = decodeHtml(html.match(/Search Results will be current as of[^<]*<span[^>]*>(.*?)<\/span>/is)?.[1]);
  if (!currentAsOf) throw new Error('Inspection search returned unrecognized HTML for ' + city);
  const rowCount = [...html.matchAll(/<td\s+id=["']FACILITYNAME["']/gi)].length;
  const pattern = /<td\s+id=["']FACILITYNAME["'][^>]*>\s*<a\s+href=["']([^"']+)["'][^>]*>(.*?)<\/a>\s*<\/td>\s*<td\s+id=["']ADDRESS["'][^>]*>(.*?)<\/td>/gis;
  const records = [];
  for (const match of html.matchAll(pattern)) {
    const detailUrl = new URL(match[1], baseUrl);
    const facilityId = detailUrl.searchParams.get('Id1');
    const name = decodeHtml(match[2]);
    const address = decodeHtml(match[3]);
    if (!/^\d+$/.test(facilityId || '') || !name || !address) throw new Error('Invalid inspection facility row for ' + city);
    records.push({
      id: 'ns-food-' + facilityId, facilityId, name, address, city,
      detailUrl: detailUrl.href, source: sourceName, currentAsOf, observedAt
    });
  }
  if (!rowCount || rowCount !== records.length) throw new Error('Incomplete inspection results for ' + city + ': found ' + records.length + '/' + rowCount + ' rows');
  return { records, currentAsOf };
}

const old = await readFile(jsonUrl, 'utf8').then(JSON.parse).catch(error => {
  if (error.code === 'ENOENT') return null;
  throw error;
});
if (old && (!Array.isArray(old.records) || old.count !== old.records.length)) {
  throw new Error('Existing inspection snapshot failed its own count contract');
}
const observedAt = new Date().toISOString();
const fresh = [];
const sourceAsOf = {};
for (const city of cities) {
  const result = await searchCity(city, observedAt);
  const previousCount = (old?.records || []).filter(record => record.city === city).length;
  // The registry can repeat one facility under corporate and trading names.
  // Compare the same unique-facility universe that is actually published.
  const uniqueFacilityCount = new Set(result.records.map(record => record.facilityId)).size;
  if (previousCount >= 20 && uniqueFacilityCount < previousCount * 0.75) {
    throw new Error('Inspection search for ' + city + ' unexpectedly fell from ' + previousCount + ' to ' + uniqueFacilityCount + ' unique facilities; preserving accepted snapshot');
  }
  fresh.push(...result.records);
  sourceAsOf[city] = result.currentAsOf;
}
const retained = (old?.records || []).filter(record => !cities.includes(record.city));
const seen = new Set();
const unique = [...fresh, ...retained].filter(record => {
  const key = record.facilityId || (record.name + '|' + record.address);
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}).sort((a, b) => a.name.localeCompare(b.name) || a.address.localeCompare(b.address));
const seenIds = new Set(fresh.map(record => record.facilityId));
const missingFromLatestSearch = (old?.records || [])
  .filter(record => cities.includes(record.city) && !seenIds.has(record.facilityId))
  .map(record => ({ facilityId: record.facilityId, city: record.city }));
const payload = {
  generatedAt: observedAt, source: sourceName, sourceUrl: baseUrl,
  cities: [...new Set([...(old?.cities || []), ...cities])], count: unique.length,
  refresh: {
    observedAt, refreshedCities: cities, retainedCities: [...new Set(retained.map(record => record.city))],
    sourceAsOf, missingFromLatestSearch, missingDoesNotEstablishClosure: true
  },
  records: unique
};

// Validate all requested cities before writing; failed 200 maintenance pages, truncated
// tables and partial city failures preserve the accepted JSON and browser files.
await mkdir(new URL('../data/build/', import.meta.url), { recursive: true });
const staged = [
  [jsonUrl, JSON.stringify(payload, null, 2) + '\n'],
  [jsUrl, 'window.HALIFAX_NS_FOOD_INSPECTIONS = ' + JSON.stringify(payload, null, 2) + ';\n']
];
const pending = [];
try {
  for (const [target, content] of staged) {
    const temporary = new URL(target.href + '.tmp-' + process.pid);
    await writeFile(temporary, content);
    pending.push([temporary, target]);
  }
  for (const [temporary, target] of pending) await rename(temporary, target);
} finally {
  await Promise.all(pending.map(([temporary]) => rm(temporary, { force: true })));
}
console.log('Imported ' + fresh.length + ' inspections for ' + cities.join(', ') +
  '; retained ' + retained.length + ' other-city records; published ' + unique.length +
  ' unique records (' + missingFromLatestSearch.length + ' previous IDs not returned, not classified as closed).');
