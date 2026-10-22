import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';

export const feedKey = row => JSON.stringify([row.restaurantId, row.feedUrl ?? row.url]);
export const postKey = row => JSON.stringify([row.restaurantId, row.postUrl]);
export const hasFeedSignals = row => Object.values(row.signalMatches).some(hits => hits.length > 0);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = value => typeof value === 'string' && value.trim().length > 0;
const date = value => value === null || value === undefined || (string(value) && Number.isFinite(Date.parse(value)));
const url = value => { try { return string(value) && ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } };
const forbidden = ['caption', 'message', 'text', 'description', 'content', 'rawText', 'rawBody', 'html'];

export function validatePreviousFeedSnapshot(payload) {
  const invalid = () => { throw new Error('Invalid previous feed snapshot; refusing to discard evidence'); };
  if (!object(payload) || !Array.isArray(payload.posts) || !Array.isArray(payload.signals)) invalid();
  const keys = new Set();
  const sourceCounts = new Map();
  for (const row of payload.posts) {
    if (!object(row) || !string(row.restaurantId) || !string(row.title) || row.title.length > 220 ||
        !url(row.feedUrl) || !url(row.postUrl) || (row.mediaUrl != null && !url(row.mediaUrl)) ||
        (row.excerpt != null && (typeof row.excerpt !== 'string' || row.excerpt.length > 700)) ||
        row.platform !== 'website_feed' || row.sourceKind !== 'official_feed' ||
        row.associationBasis !== 'unique_feed_link_from_official_website' || !['source_signal', 'needs_date_review'].includes(row.reviewState) ||
        Boolean(row.quarantined) || row.identityValidated === false || row.locationValidated === false || row.locationSpecific === false || row.sharedBrandProfile === true ||
        !string(row.observedAt) || !date(row.observedAt) || !date(row.publishedAt) || !object(row.signalMatches) ||
        Object.values(row.signalMatches).some(hits => !Array.isArray(hits) || hits.some(hit => !string(hit))) ||
        forbidden.some(key => Object.hasOwn(row, key)) || keys.has(postKey(row))) invalid();
    keys.add(postKey(row));
    const key = feedKey(row);
    sourceCounts.set(key, (sourceCounts.get(key) || 0) + 1);
    if (sourceCounts.get(key) > 80) invalid();
  }
  const expected = payload.posts.filter(hasFeedSignals);
  if (!isDeepStrictEqual(payload.signals, expected)) invalid();
  return payload.posts;
}

async function optionalText(path) {
  try { return await readFile(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// Read both accepted representations before requests or writes. A missing pair
// is a first run; a missing/bad/mismatched twin is not permission to erase history.
export async function readPreviousFeedPosts(jsonPath, scriptPath) {
  const [json, script] = await Promise.all([optionalText(jsonPath), optionalText(scriptPath)]);
  if (json === null && script === null) return [];
  if (json === null || script === null) throw new Error('Incomplete previous feed snapshot pair');
  const match = script.match(/^\s*window\.HALIFAX_WEBSITE_FEED_SIGNALS\s*=\s*([\s\S]*?)\s*;?\s*$/);
  if (!match) throw new Error('Invalid previous feed script snapshot');
  const payload = JSON.parse(json);
  if (!isDeepStrictEqual(payload, JSON.parse(match[1]))) throw new Error('Previous feed snapshot pair mismatch');
  return validatePreviousFeedSnapshot(payload);
}

// This is a deliberately conservative XML-envelope validator, not an entity
// resolver or a general XML implementation. Never fetch DTDs/external entities.
// Balanced RSS/RDF/Atom wrappers distinguish a valid empty feed from an outage,
// challenge, error document or truncated extraction. Return only direct items.
export function feedEntryBlocks(xml) {
  const bad = () => { throw new Error('invalid_feed_document'); };
  if (typeof xml !== 'string' || !xml.trim() || Buffer.byteLength(xml, 'utf8') > 4 * 1024 * 1024 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/.test(xml)) bad();
  const validText = text => {
    if (text.includes(']]>')) bad();
    const remainder = text.replace(/&(?:amp|lt|gt|quot|apos|#(?:[0-9]+|x[0-9a-fA-F]+));/g, entity => {
      if (entity.startsWith('&#')) {
        const value = entity[2] === 'x' ? parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1));
        if (!(value === 9 || value === 10 || value === 13 || (value >= 32 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) && value !== 0xfffe && value !== 0xffff))) bad();
      }
      return '';
    });
    if (remainder.includes('&')) bad();
  };
  const stack = [];
  const blocks = [];
  let root = null, roots = 0, channels = 0, cursor = 0;
  while (cursor < xml.length) {
    const start = xml.indexOf('<', cursor);
    const text = xml.slice(cursor, start < 0 ? xml.length : start);
    validText(text);
    if (!stack.length && text.trim()) bad();
    if (start < 0) { cursor = xml.length; break; }
    if (xml.startsWith('<!--', start)) {
      const end = xml.indexOf('-->', start + 4);
      if (end < 0 || xml.slice(start + 4, end).includes('--')) bad();
      cursor = end + 3; continue;
    }
    if (xml.startsWith('<![CDATA[', start)) {
      const end = xml.indexOf(']]>', start + 9);
      if (!stack.length || end < 0) bad();
      cursor = end + 3; continue;
    }
    if (xml.startsWith('<?', start)) {
      const end = xml.indexOf('?>', start + 2);
      if (end < 0 || !/^[A-Za-z_][\w.:-]*(?:\s|$)/.test(xml.slice(start + 2, end))) bad();
      cursor = end + 2; continue;
    }
    const token = xml.slice(start).match(/^<(\/?)([A-Za-z_][\w.:-]*)((?:[^<>"']|"[^"<]*"|'[^'<]*')*)>/);
    if (!token) bad();
    const [, close, name, tail] = token;
    cursor = start + token[0].length;
    if (close) {
      if (tail.trim() || stack.at(-1)?.name !== name) bad();
      const node = stack.pop();
      if (node.entry) blocks.push(node.fields);
      else if (stack.at(-1)?.entry) stack.at(-1).fields.push(xml.slice(node.start, cursor));
      continue;
    }
    const selfClosing = /\/\s*$/.test(tail);
    let attributes = selfClosing ? tail.replace(/\/\s*$/, '') : tail;
    const seen = new Set();
    while (attributes.trim()) {
      const attr = attributes.match(/^\s+([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/);
      if (!attr || seen.has(attr[1])) bad();
      seen.add(attr[1]); validText(attr[2] ?? attr[3]); attributes = attributes.slice(attr[0].length);
    }
    if (!stack.length) { root = name; roots++; if (roots !== 1 || !['rss', 'feed', 'rdf:RDF'].includes(root)) bad(); }
    if (stack.length === 1 && name === 'channel') channels++;
    const entry = (root === 'rss' && stack.length === 2 && stack[1].name === 'channel' && name === 'item') ||
      (root === 'rdf:RDF' && stack.length === 1 && name === 'item') ||
      (root === 'feed' && stack.length === 1 && name === 'entry');
    // Nested/wrong-family entries must not masquerade as a successful empty feed.
    if (['item', 'entry'].includes(name) && !entry) bad();
    if (selfClosing) {
      if (entry) blocks.push([]);
      else if (stack.at(-1)?.entry) stack.at(-1).fields.push(token[0]);
    } else stack.push({ name, entry, fields: [], start });
  }
  if (stack.length || roots !== 1 || (root !== 'feed' && channels !== 1)) bad();
  return blocks;
}

// Winner selection is deterministic and signal projection happens afterwards.
// A refreshed non-signal wins over retained signal history for the same post.
export function reconcileFeedPosts(incoming, retained) {
  const sorted = rows => [...rows].sort((a, b) => feedKey(a).localeCompare(feedKey(b)) || postKey(a).localeCompare(postKey(b)));
  const winners = new Map();
  for (const row of [...sorted(incoming), ...sorted(retained)]) if (!winners.has(postKey(row))) winners.set(postKey(row), row);
  return [...winners.values()].sort((a, b) => String(b.publishedAt || b.observedAt || '').localeCompare(String(a.publishedAt || a.observedAt || '')) || postKey(a).localeCompare(postKey(b)));
}
