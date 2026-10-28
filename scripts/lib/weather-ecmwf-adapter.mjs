// Offline IFS 0.25-degree 2m-temperature mapping. No source requests or activation.
// Reviewed receipt IDs and source acquisition continuity remain an external trust boundary.
// Hashes bind bytes, not source authorship; consuming CLI must replay raw GRIB decoding.
// Schema alone never admits a source: reviewed actual listing/index/Range receipts are required.
import assert from 'node:assert/strict';
import {hash, stamp} from './eccc-weather.mjs';
import {digest, locationContract} from './weather-aggregation.mjs';

export const ECMWF_DECODER_ID = 'ecmwf-ifs-temperature-eccodes-v1';
export const ECMWF_FIELD_BYTE_LIMIT = 4 * 1024 * 1024;
const INDEX_BYTE_LIMIT = 256 * 1024;
const LISTING_BYTE_LIMIT = 1024 * 1024; // Reviewed portal pages contain ~395KiB non-executed inline script boilerplate.
const time = value => Date.parse(stamp(value));
const exact = (object, fields) => assert.deepEqual(Object.keys(object).sort(), fields.slice().sort(), 'unexpected ECMWF adapter fields');
const sha = value => assert.match(value, /^[a-f0-9]{64}$/);
const clockOrder = receipt => {
  assert.ok(time(receipt.attemptedAt) <= time(receipt.headersReceivedAt));
  assert.ok(time(receipt.headersReceivedAt) <= time(receipt.completedAt));
};
const trustedUrl = value => {
  const url = new URL(value);
  assert.equal(url.origin, 'https://data.ecmwf.int');
  assert.equal(url.username, '');
  assert.equal(url.password, '');
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  assert.equal(url.href, value, 'canonical source URL required');
  return url;
};
function retainedMetadata(evidence, byteLimit) {
  exact(evidence, ['url', 'status', 'attemptedAt', 'headersReceivedAt', 'completedAt', 'bodyBase64', 'bodyBytes', 'bodySha256']);
  trustedUrl(evidence.url);
  assert.equal(evidence.status, 200, 'metadata receipt must be successful');
  clockOrder(evidence);
  assert.ok(typeof evidence.bodyBase64 === 'string' && evidence.bodyBase64.length <= Math.ceil(byteLimit / 3) * 4);
  const body = Buffer.from(evidence.bodyBase64, 'base64');
  assert.ok(body.length > 0 && body.length <= byteLimit, 'metadata byte budget');
  assert.equal(body.toString('base64'), evidence.bodyBase64, 'canonical metadata encoding');
  assert.equal(body.length, evidence.bodyBytes);
  sha(evidence.bodySha256);
  assert.equal(hash(body), evidence.bodySha256, 'metadata body hash mismatch');
  const decoded = new TextDecoder('utf-8', {fatal: true}).decode(body);
  return decoded;
}
// Deliberately constrained, non-executing HTML tokenizer for retained server listings.
// Attribute values are consumed atomically: href-looking text inside another value is not a link.
// Raw-text/inert blocks and comments never contribute anchors; malformed markup fails closed.
export function listingAnchorUrls(html, baseUrl) {
  const links = [];
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf('<', cursor);
    if (start < 0) break;
    if (html.startsWith('<!--', start)) {
      const end = html.indexOf('-->', start + 4);
      if (end < 0) break;
      cursor = end + 3;
      continue;
    }
    let end = start + 1, quote = null;
    for (; end < html.length; end++) {
      const char = html[end];
      if (quote) { if (char === quote) quote = null; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    if (end >= html.length) break;
    const tag = html.slice(start + 1, end);
    cursor = end + 1;
    const nameMatch = tag.match(/^([a-z][a-z0-9:-]*)(?=[\s/]|$)/i);
    if (!nameMatch) continue;
    const name = nameMatch[1].toLowerCase();
    if (name === 'plaintext' || name === 'template') break; // No client-side template discovery.
    if (['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript'].includes(name)) {
      const closing = new RegExp(`<\\/${name}(?=[\\s>])[^>]*>`, 'gi');
      closing.lastIndex = cursor;
      const match = closing.exec(html);
      if (!match) break;
      cursor = closing.lastIndex;
      continue;
    }
    if (name !== 'a') continue;
    const attributes = new Map();
    let offset = nameMatch[0].length, valid = true;
    while (offset < tag.length) {
      while (/\s/.test(tag[offset] ?? '') && offset < tag.length) offset++;
      if (offset === tag.length || tag.slice(offset).trim() === '/') break;
      const attribute = tag.slice(offset).match(/^[^\s=\/"'<>`]+/);
      if (!attribute) { valid = false; break; }
      const key = attribute[0].toLowerCase();
      if (attributes.has(key)) { valid = false; break; }
      offset += attribute[0].length;
      while (/\s/.test(tag[offset] ?? '') && offset < tag.length) offset++;
      let value = null;
      if (tag[offset] === '=') {
        offset++;
        while (/\s/.test(tag[offset] ?? '') && offset < tag.length) offset++;
        const delimiter = tag[offset];
        if (delimiter === '"' || delimiter === "'") {
          const close = tag.indexOf(delimiter, offset + 1);
          if (close < 0) { valid = false; break; }
          value = tag.slice(offset + 1, close);
          offset = close + 1;
        } else {
          const unquoted = tag.slice(offset).match(/^[^\s"'`=<>]+/);
          if (!unquoted) { valid = false; break; }
          value = unquoted[0];
          offset += value.length;
        }
      }
      attributes.set(key, value);
    }
    if (!valid || typeof attributes.get('href') !== 'string') continue;
    try { links.push(new URL(attributes.get('href'), baseUrl).href); } catch { /* Invalid URL is not discovery. */ }
  }
  return links;
}

export function extractReviewedListing(evidence) {
  const html = retainedMetadata(evidence, LISTING_BYTE_LIMIT);
  const anchorUrls = [...new Set(listingAnchorUrls(html, evidence.url).filter(url => url.startsWith(evidence.url) && /\.index$/.test(url)))].sort();
  assert.ok(anchorUrls.length > 0 && anchorUrls.length <= 1000);
  const proof = {kind:'reviewed_listing_anchor_extract',url:evidence.url,status:evidence.status,attemptedAt:evidence.attemptedAt,headersReceivedAt:evidence.headersReceivedAt,completedAt:evidence.completedAt,sourceBodyBytes:evidence.bodyBytes,sourceBodySha256:evidence.bodySha256,extractionPolicy:'non_executing_actual_index_anchors_v1',completeness:'matching_index_links_only_not_complete_source_inventory',anchorUrls};
  return {...proof,proofSha256:digest(proof)};
}
function reviewedListingUrls(evidence) {
  if(evidence.kind !== 'reviewed_listing_anchor_extract')return {urls:listingAnchorUrls(retainedMetadata(evidence,LISTING_BYTE_LIMIT),evidence.url),bodyBytes:evidence.bodyBytes};
  exact(evidence,['kind','url','status','attemptedAt','headersReceivedAt','completedAt','sourceBodyBytes','sourceBodySha256','extractionPolicy','completeness','anchorUrls','proofSha256']);
  const {proofSha256,...proof}=evidence;sha(proofSha256);assert.equal(proofSha256,digest(proof),'mutated reviewed extraction');trustedUrl(evidence.url);clockOrder(evidence);assert.equal(evidence.status,200);sha(evidence.sourceBodySha256);assert.ok(Number.isSafeInteger(evidence.sourceBodyBytes)&&evidence.sourceBodyBytes>0&&evidence.sourceBodyBytes<=LISTING_BYTE_LIMIT);
  assert.equal(evidence.extractionPolicy,'non_executing_actual_index_anchors_v1');assert.equal(evidence.completeness,'matching_index_links_only_not_complete_source_inventory');assert.ok(Array.isArray(evidence.anchorUrls)&&evidence.anchorUrls.length>0&&evidence.anchorUrls.length<=1000);assert.equal(new Set(evidence.anchorUrls).size,evidence.anchorUrls.length);
  for(const url of evidence.anchorUrls){trustedUrl(url);assert.ok(url.startsWith(evidence.url)&&/\.index$/.test(url));}
  return {urls:evidence.anchorUrls,bodyBytes:evidence.sourceBodyBytes};
}

const decimal = value => {
  assert.ok(typeof value === 'string' && /^\d+$/.test(value) || Number.isSafeInteger(value), 'integer index field required');
  const result = Number(value);
  assert.ok(Number.isSafeInteger(result) && result >= 0);
  return result;
};

export function normalizeEcmwfDecoded(decoded, receipt, {locations}) {
  exact(receipt, ['version', 'kind', 'sourceId', 'url', 'attemptedAt', 'headersReceivedAt', 'completedAt', 'status', 'bodySha256', 'bodyBytes', 'admissionReviewId', 'decoderId', 'decoderResultSha256', 'rangeEvidence']);
  assert.equal(receipt.version, 1);
  assert.equal(receipt.kind, 'reviewed_model_source_capture');
  assert.equal(receipt.sourceId, 'ecmwf');
  assert.equal(receipt.status, 206, 'ignored Range or full bundle must not be admitted');
  assert.equal(receipt.decoderId, ECMWF_DECODER_ID);
  assert.match(receipt.admissionReviewId, /^[\w.:-]{1,160}$/);
  sha(receipt.bodySha256);
  sha(receipt.decoderResultSha256);
  assert.ok(Number.isSafeInteger(receipt.bodyBytes) && receipt.bodyBytes > 0 && receipt.bodyBytes <= ECMWF_FIELD_BYTE_LIMIT);
  clockOrder(receipt);

  const url = trustedUrl(receipt.url);
  const match = url.pathname.match(/^\/forecasts\/(\d{8})\/(00|06|12|18)z\/ifs\/0p25\/oper\/(\d{8})(00|06|12|18)0000-([1-9]\d{0,2})h-oper-fc\.grib2$/);
  assert.ok(match, 'unreviewed IFS product/path');
  assert.equal(match[1], match[3]);
  assert.equal(match[2], match[4]);
  const leadHours = Number(match[5]);
  assert.ok(leadHours > 0 && leadHours <= 384, 'analysis or unbounded horizon');
  const modelReferenceTime = `${match[1].slice(0, 4)}-${match[1].slice(4, 6)}-${match[1].slice(6, 8)}T${match[2]}:00:00Z`;
  time(modelReferenceTime);

  const evidence = receipt.rangeEvidence;
  exact(evidence, ['requestedRange', 'contentRange', 'contentEncoding', 'index', 'listing']);
  assert.equal(evidence.contentEncoding, 'identity', 'encoded ranges are not raw GRIB offsets');
  const listing = reviewedListingUrls(evidence.listing);
  const indexBody = retainedMetadata(evidence.index, INDEX_BYTE_LIMIT);
  assert.ok(listing.bodyBytes + evidence.index.bodyBytes <= LISTING_BYTE_LIMIT + INDEX_BYTE_LIMIT, 'cumulative metadata byte budget');
  assert.equal(evidence.index.url, receipt.url.replace(/\.grib2$/, '.index'));
  const parentUrl = new URL('./', evidence.index.url).href;
  assert.equal(evidence.listing.url, parentUrl, 'retain actual final directory listing');
  assert.ok(time(evidence.listing.completedAt) <= time(evidence.index.attemptedAt));
  assert.ok(time(evidence.index.completedAt) <= time(receipt.attemptedAt), 'range chosen before index receipt');
  // A plausible filename alone is not discovery. Require its exact href in the retained listing.
  const links = listing.urls;
  assert.ok(links.includes(evidence.index.url), 'index URL not actually linked by retained listing');

  const lines = indexBody.split(/\r?\n/).filter(line => line.trim());
  assert.ok(lines.length > 0 && lines.length <= 10000);
  const records = lines.map(line => JSON.parse(line));
  const selected = records.filter(record => ['2t', '167', 167].includes(record.param) && record.levtype === 'sfc' && record.stream === 'oper' && record.type === 'fc');
  assert.equal(selected.length, 1, 'one exact 2t surface forecast index record required');
  const field = selected[0];
  assert.equal(decimal(field.date), Number(match[1]));
  assert.equal(decimal(field.time), Number(match[2]) * 100);
  assert.equal(decimal(field.step), leadHours);
  assert.ok(Number.isSafeInteger(field._offset) && field._offset >= 0);
  assert.ok(Number.isSafeInteger(field._length) && field._length > 0 && field._length <= ECMWF_FIELD_BYTE_LIMIT);
  const end = field._offset + field._length - 1;
  assert.ok(Number.isSafeInteger(end));
  assert.equal(receipt.bodyBytes, field._length);
  assert.equal(evidence.requestedRange, `bytes=${field._offset}-${end}`);
  const range = evidence.contentRange.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
  assert.ok(range, 'exact numeric Content-Range required');
  assert.equal(decimal(range[1]), field._offset);
  assert.equal(decimal(range[2]), end);
  assert.ok(decimal(range[3]) > end, 'range outside complete object');

  exact(decoded, ['version', 'kind', 'sourceBodySha256', 'bodyBytes', 'modelReferenceTime', 'validAt', 'leadHours', 'centre', 'generatingProcessIdentifier', 'gridType', 'numberOfDataPoints', 'variable', 'sourceUnit', 'unit', 'projection', 'points']);
  assert.equal(decoded.version, 1);
  assert.equal(decoded.kind, 'decoded_ecmwf_ifs_temperature_points');
  assert.equal(decoded.sourceBodySha256, receipt.bodySha256);
  assert.equal(decoded.bodyBytes, receipt.bodyBytes);
  assert.equal(digest(decoded), receipt.decoderResultSha256, 'decoded output hash mismatch');
  assert.equal(decoded.centre, 98);
  assert.equal(decoded.gridType, 'regular_ll');
  assert.equal(decoded.numberOfDataPoints, 1440 * 721);
  assert.ok(Number.isInteger(decoded.generatingProcessIdentifier) && decoded.generatingProcessIdentifier >= 0 && decoded.generatingProcessIdentifier <= 255);
  assert.equal(decoded.variable, 'temperature_2m');
  assert.equal(decoded.sourceUnit, 'K');
  assert.equal(decoded.unit, 'C');
  assert.equal(decoded.projection, 'nearest_grid_point');
  assert.equal(time(decoded.modelReferenceTime), time(modelReferenceTime));
  assert.equal(decoded.leadHours, leadHours);
  assert.equal(time(decoded.validAt) - time(decoded.modelReferenceTime), leadHours * 3600000);
  assert.ok(time(decoded.modelReferenceTime) <= time(receipt.completedAt));
  assert.ok(Array.isArray(decoded.points) && decoded.points.length > 0 && decoded.points.length <= 6);

  const points = locationContract(locations), seen = new Set();
  return decoded.points.map(point => {
    exact(point, ['locationId', 'latitude', 'longitude', 'valueC', 'gridLatitude', 'gridLongitude', 'distanceKm', 'gridIndex']);
    const expected = points.get(point.locationId);
    assert.ok(expected && !seen.has(point.locationId), 'unknown or duplicate Halifax point');
    seen.add(point.locationId);
    assert.equal(point.latitude, expected.latitude);
    assert.equal(point.longitude, expected.longitude);
    assert.ok(Number.isFinite(point.valueC) && point.valueC >= -100 && point.valueC <= 70);
    assert.ok(Number.isInteger(point.gridIndex) && point.gridIndex >= 0 && point.gridIndex < decoded.numberOfDataPoints);
    assert.ok(Number.isFinite(point.gridLatitude) && point.gridLatitude >= 44.25 && point.gridLatitude <= 45 && Number.isInteger(point.gridLatitude * 4));
    assert.ok(Number.isFinite(point.gridLongitude) && point.gridLongitude >= -64 && point.gridLongitude <= -63.25 && Number.isInteger(point.gridLongitude * 4));
    assert.ok(Number.isFinite(point.distanceKm) && point.distanceKm >= 0 && point.distanceKm <= 30);
    return {
      version: 1, kind: 'model_forecast', modelId: 'ecmwf_ifs', modelVersion: 'unknown', modelVersionStatus: 'unverified',
      sourceId: 'ecmwf', dependencyGroup: 'ecmwf', locationId: expected.id, latitude: expected.latitude, longitude: expected.longitude,
      support: {kind: 'model_at_reviewed_point', locationId: expected.id, method: 'nearest_grid_point', methodEvidenceId: ECMWF_DECODER_ID,
        spatialFootprintId: `ecmwf-ifs-0p25-${point.gridLatitude}-${point.gridLongitude}`, gridLatitude: point.gridLatitude, gridLongitude: point.gridLongitude, distanceKm: point.distanceKm},
      sourceBodySha256: receipt.bodySha256, receiptId: receipt.bodySha256, modelReferenceTime: decoded.modelReferenceTime, sourceIssuedAt: null,
      firstAvailableAt: null, firstRetrievedAt: receipt.completedAt, validStart: decoded.validAt, validEnd: decoded.validAt,
      memberId: null, variable: 'temperature_2m', unit: 'C', eventDefinition: null, value: point.valueC
    };
  });
}
