// Synthetic-only ECMWF receipt/index/decoder fixtures. No source access or live evidence.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {syncBuiltinESMExports} from 'node:module';
import {hash} from './lib/eccc-weather.mjs';
import {digest} from './lib/weather-aggregation.mjs';
import {normalizeEcmwfDecoded, extractReviewedListing, ECMWF_DECODER_ID, ECMWF_FIELD_BYTE_LIMIT} from './lib/weather-ecmwf-adapter.mjs';
const deny = () => assert.fail('Network forbidden in offline ECMWF adapter tests');
globalThis.fetch = deny;
http.request = http.get = https.request = https.get = net.connect = net.createConnection = deny;
syncBuiltinESMExports();
const locations = JSON.parse(await readFile(new URL('../data/weather-locations.json', import.meta.url)));
const registry = JSON.parse(await readFile(new URL('../data/weather-model-registry.json', import.meta.url)));
assert.equal(registry.sources.find(source => source.id === 'ecmwf').enabled, false);
assert.ok(registry.models.filter(model => model.sourceId === 'ecmwf').every(model => !model.enabled));
const body = Buffer.from('GRIB synthetic 2t field fixture, not an actual GRIB encoding 7777');
const url = 'https://data.ecmwf.int/forecasts/20261028/00z/ifs/0p25/oper/20261028000000-6h-oper-fc.grib2';
const indexUrl = url.replace(/\.grib2$/, '.index');
const listingUrl = new URL('./', indexUrl).href;
const field = {domain: 'g', date: '20261028', time: '0000', expver: '0001', class: 'od', type: 'fc', stream: 'oper', step: '6', param: '2t', levtype: 'sfc', _offset: 1024, _length: body.length};
function metadata(url, text, minute) {
 const bytes = Buffer.from(text);
 return {url, status: 200, attemptedAt: `2026-10-28T03:${minute}:00Z`, headersReceivedAt: `2026-10-28T03:${minute}:01Z`, completedAt: `2026-10-28T03:${minute}:02Z`, bodyBase64: bytes.toString('base64'), bodyBytes: bytes.length, bodySha256: hash(bytes)};
}
const decoded = {
 version: 1, kind: 'decoded_ecmwf_ifs_temperature_points', sourceBodySha256: hash(body), bodyBytes: body.length,
 modelReferenceTime: '2026-10-28T00:00:00Z', validAt: '2026-10-28T06:00:00Z', leadHours: 6, centre: 98,
 generatingProcessIdentifier: 1, gridType: 'regular_ll', numberOfDataPoints: 1440 * 721,
 variable: 'temperature_2m', sourceUnit: 'K', unit: 'C', projection: 'nearest_grid_point',
 points: locations.points.map((point, i) => ({locationId: point.id, latitude: point.latitude, longitude: point.longitude,
  valueC: 10 + i, gridLatitude: Math.round(point.latitude * 4) / 4, gridLongitude: Math.round(point.longitude * 4) / 4,
  distanceKm: 12, gridIndex: 260000 + i}))
};
const receipt = {
 version: 1, kind: 'reviewed_model_source_capture', sourceId: 'ecmwf', url,
 attemptedAt: '2026-10-28T03:02:00Z', headersReceivedAt: '2026-10-28T03:02:01Z', completedAt: '2026-10-28T03:02:02Z',
 status: 206, bodySha256: hash(body), bodyBytes: body.length, admissionReviewId: 'synthetic-ecmwf-only',
 decoderId: ECMWF_DECODER_ID, decoderResultSha256: digest(decoded),
 rangeEvidence: {requestedRange: `bytes=1024-${1024 + body.length - 1}`, contentRange: `bytes 1024-${1024 + body.length - 1}/4096`, contentEncoding: 'identity',
  listing: metadata(listingUrl, `<html><a href="${indexUrl.split('/').at(-1)}">index</a></html>`, '00'),
  index: metadata(indexUrl, JSON.stringify(field) + '\n', '01')}
};
const run = (d = decoded, r = receipt) => normalizeEcmwfDecoded(d, r, {locations});
function change(edit) {
 const d = structuredClone(decoded), r = structuredClone(receipt);
 edit(d, r);
 return () => run(d, r);
}
function replaceIndex(r, records) {
 const old = r.rangeEvidence.index;
 r.rangeEvidence.index = {...old, ...metadata(old.url, records.map(x => JSON.stringify(x)).join('\n') + '\n', '01')};
}
function rehash(d, r) { r.decoderResultSha256 = digest(d); }
let count = 0;
function test(name, action) { action(); console.log(`ok ${++count} - ${name}`); }
test('retains six exact Halifax supports, reference clock and actual receipt, never invented publication time/version', () => {
 const rows = run();
 assert.equal(rows.length, 6);
 assert.deepEqual(rows.map(row => row.locationId), locations.points.map(point => point.id));
 for (const [i, row] of rows.entries()) {
  assert.equal(row.value, 10 + i); assert.equal(row.unit, 'C'); assert.equal(row.modelId, 'ecmwf_ifs');
  assert.equal(row.dependencyGroup, 'ecmwf'); assert.equal(row.modelVersion, 'unknown');
  assert.equal(row.modelReferenceTime, decoded.modelReferenceTime); assert.equal(row.sourceIssuedAt, null);
  assert.equal(row.firstAvailableAt, null); assert.equal(row.firstRetrievedAt, receipt.completedAt);
  assert.equal(row.validStart, decoded.validAt); assert.equal(row.validEnd, decoded.validAt);
  assert.equal(row.support.method, 'nearest_grid_point'); assert.equal(row.memberId, null);
  assert.equal(Object.hasOwn(row, 'runIssuedAt'), false);
 }
});
test('exact index-selected range required; ignored range, compression and contradictory totals fail', () => {
 for (const edit of [
  (d, r) => r.status = 200,
  (d, r) => r.rangeEvidence.contentEncoding = 'gzip',
  (d, r) => r.rangeEvidence.requestedRange = 'bytes=0-1',
  (d, r) => r.rangeEvidence.contentRange = `bytes 0-${body.length - 1}/4096`,
  (d, r) => r.rangeEvidence.contentRange = `bytes 1024-${1024 + body.length - 1}/*`,
  (d, r) => r.rangeEvidence.contentRange = `bytes 1024-${1024 + body.length - 1}/${1024 + body.length - 1}`,
  (d, r) => r.bodyBytes += 1
 ]) assert.throws(change(edit));
});
test('metadata bytes and SHA-256 are bound, not labels accepted as discovery', () => {
 for (const edit of [
  (d, r) => r.rangeEvidence.index.bodySha256 = 'a'.repeat(64),
  (d, r) => r.rangeEvidence.index.bodyBytes += 1,
  (d, r) => r.rangeEvidence.index.bodyBase64 += '\n',
  (d, r) => r.rangeEvidence.listing = metadata(listingUrl, '<a href="unrelated.index">not this index</a>', '00'),
  (d, r) => r.rangeEvidence.listing = metadata(listingUrl, `<!-- <a href="${indexUrl}">not an actual listing entry</a> -->`, '00'),
  (d, r) => r.rangeEvidence.listing = metadata(listingUrl, `<script>const fake='<a href="${indexUrl}">not an actual listing entry</a>'</script>`, '00'),
  (d, r) => r.rangeEvidence.listing.url = 'https://data.ecmwf.int/forecasts/',
  (d, r) => r.rangeEvidence.index.url = indexUrl.replace('6h', '9h')
 ]) assert.throws(change(edit));
});
test('only actual anchor href attributes count; scripts/styles/inert markup/data strings never discover a source', () => {
 const fake = `<a href="${indexUrl}">not actual directory discovery</a>`;
 for (const html of [
  `<script>const html='${fake}';</script>`,
  `<SCRIPT type="application/javascript">const html='${fake}';</SCRIPT>`,
  `<style>.fake:after{content:'${fake}'}</style>`,
  `<script>const html='${fake}';`,
  `<style>.fake:after{content:'${fake}'}`,
  `<a data-href="${indexUrl}">not href</a>`,
  `<a data-note=' href="${indexUrl}"'>not href</a>`,
  `<div data-note='${fake}'>quoted markup</div>`,
  `<textarea>${fake}</textarea>`,
  `<template>${fake}</template>`,
  `<!-- ${fake} -->`,
  `<a href="unrelated.index" href="${indexUrl}">ambiguous duplicate href</a>`
 ]) assert.throws(change((d, r) => r.rangeEvidence.listing = metadata(listingUrl, html, '00')), /not actually linked/);
 for (const html of [
  `<a href="${indexUrl}">actual link</a>`,
  `<a data-note='not a href' class="file" href='${indexUrl.split('/').at(-1)}'>actual link</a>`,
  `<A HREF=${indexUrl}>actual link</A>`,
  `<script>const irrelevant='<a href="unrelated.index">';</script><a href="${indexUrl}">actual link</a>`
 ]) {
  const r = structuredClone(receipt);
  r.rangeEvidence.listing = metadata(listingUrl, html, '00');
  assert.equal(run(decoded, r).length, 6);
 }
});
test('listing1MiB and index256KiB respect separately reviewed finite budgets', () => {
 assert.throws(change((d, r) => {
  r.rangeEvidence.listing = metadata(listingUrl, `<a href="${indexUrl}">index</a>` + ' '.repeat(1024 * 1024), '00');
 }));
 assert.throws(change((d, r) => {
  r.rangeEvidence.index = metadata(indexUrl, JSON.stringify(field) + '\n' + ' '.repeat(256 * 1024), '01');
 }));
 const r = structuredClone(receipt);
 r.rangeEvidence.listing = metadata(listingUrl, `<a href="${indexUrl}">index</a>` + ' '.repeat(400 * 1024), '00');
 r.rangeEvidence.index = metadata(indexUrl, JSON.stringify(field) + '\n' + ' '.repeat(140 * 1024), '01');
 assert.equal(run(decoded, r).length, 6);
});
test('reviewed factual anchor extraction preserves original source hash without redistributing portal code', () => {
 const r=structuredClone(receipt),original=r.rangeEvidence.listing;
 r.rangeEvidence.listing=extractReviewedListing(original);
 assert.equal(r.rangeEvidence.listing.sourceBodySha256,original.bodySha256);
 assert.equal(r.rangeEvidence.listing.completedAt,original.completedAt);
 assert.equal(r.rangeEvidence.listing.bodyBase64,undefined);
 assert.equal(run(decoded,r).length,6);
 const bad=structuredClone(r);bad.rangeEvidence.listing.anchorUrls[0]+='?forged';assert.throws(()=>run(decoded,bad),/mutated/);
});
test('no guessed mirror, paid endpoint, alternate model, resolution or analysis path', () => {
 for (const replacement of [url.replace('data.ecmwf.int', 'mirror.example.org'), url.replace('/ifs/', '/aifs/'), url.replace('/0p25/', '/0p1/'), url.replace('6h-', '0h-'), url + '#fragment', url + '?download=1', url.replace('https://', 'https://user:secret@')]) {
  assert.throws(change((d, r) => r.url = replacement));
 }
});
test('one exact surface2t forecast record with matching date/time/step; no other variable or ensemble substitute', () => {
 for (const patch of [{param: 't'}, {levtype: 'pl'}, {stream: 'enfo'}, {type: 'cf'}, {date: '20261027'}, {time: '0600'}, {step: '9'}]) {
  assert.throws(change((d, r) => replaceIndex(r, [{...field, ...patch}])));
 }
 assert.throws(change((d, r) => replaceIndex(r, [field, {...field}])));
 assert.throws(change((d, r) => replaceIndex(r, [{...field, _offset: -1}])));
 assert.throws(change((d, r) => replaceIndex(r, [{...field, _offset: Number.MAX_SAFE_INTEGER}])));
 assert.throws(change((d, r) => replaceIndex(r, [{...field, _length: ECMWF_FIELD_BYTE_LIMIT + 1}])));
});
test('parameter167 alias is explicit; matching unrelated indexed fields add no votes', () => {
 const r = structuredClone(receipt);
 replaceIndex(r, [{...field, param: '10u', _offset: 0, _length: 100}, {...field, param: '167'}]);
 assert.equal(run(decoded, r).length, 6);
});
test('metadata must precede range choice and all completion clocks preserve actual order', () => {
 for (const edit of [
  (d, r) => r.rangeEvidence.index.completedAt = '2026-10-28T04:00:00Z',
  (d, r) => r.rangeEvidence.listing.completedAt = '2026-10-28T03:02:00Z',
  (d, r) => r.headersReceivedAt = '2026-10-28T03:01:59Z',
  (d, r) => r.completedAt = '2026-10-28T03:02:00Z',
  (d, r) => r.rangeEvidence.index.status = 403
 ]) assert.throws(change(edit));
});
test('raw hash, decoded hash, known decoder and exact field semantics cannot be substituted', () => {
 for (const edit of [
  (d, r) => d.sourceBodySha256 = 'b'.repeat(64),
  (d, r) => d.points[0].valueC += 1,
  (d, r) => r.decoderId = 'unreviewed-decoder',
  (d, r) => {d.centre = 7; rehash(d, r);},
  (d, r) => {d.sourceUnit = 'C'; rehash(d, r);},
  (d, r) => {d.unit = 'K'; rehash(d, r);},
  (d, r) => {d.variable = 'precipitation_probability'; rehash(d, r);},
  (d, r) => {d.validAt = '2026-10-28T09:00:00Z'; rehash(d, r);},
  (d, r) => {d.modelReferenceTime = '2026-10-28T06:00:00Z'; rehash(d, r);}
 ]) assert.throws(change(edit));
});
test('coarse-grid metadata remains finite bounded actual support, not arbitrary independent points', () => {
 for (const edit of [
  (d, r) => d.numberOfDataPoints = 4,
  (d, r) => d.gridType = 'reduced_gg',
  (d, r) => d.points[0].gridLatitude = 44.6,
  (d, r) => d.points[0].gridLongitude = -60,
  (d, r) => d.points[0].gridIndex = 1440 * 721,
  (d, r) => d.points[0].distanceKm = 31,
  (d, r) => d.points[0].valueC = Infinity,
  (d, r) => d.points[0].locationId = 'moncton',
  (d, r) => d.points[0].latitude = 45,
  (d, r) => d.points[1] = {...d.points[0]},
  (d, r) => d.points = []
 ]) assert.throws(change((d, r) => {edit(d, r); rehash(d, r);}));
});
console.log(`${count} ECMWF adapter groups passed; synthetic metadata only, no source requests or operational admission.`);
