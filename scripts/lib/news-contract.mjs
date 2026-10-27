import { createHash } from 'node:crypto';
import { feedEntryBlocks } from './first-party-feed-safety.mjs';
export const NEWS_MAX_BYTES = 1024 * 1024;
export const NEWS_MAX_ITEMS = 100;
export const NEWS_TYPES = ['newsroom', 'official_public_notice', 'library_notice'];
const text = (x, max = 500) => typeof x === 'string' && x.trim() === x && x.length > 0 && x.length <= max && !/[<>\u0000-\u001f]/.test(x);
export const validNewsDate = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export const validNewsDay = value => typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00.000Z')) && new Date(value + 'T00:00:00.000Z').toISOString().slice(0,10) === value;
export function canonicalNewsUrl(value, hosts) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !hosts.includes(url.hostname) || /[\u0000-\u0020<>]/.test(value)) throw new Error('unsafe_news_url');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.href;
}
export const newsId = url => `news-${createHash('sha256').update(url).digest('hex').slice(0, 24)}`;
export function validateNewsRegistry(registry) {
  if (registry?.version !== 1 || !Array.isArray(registry.sources) || registry.sources.length > 20) throw new Error('invalid_news_registry');
  const ids = new Set();
  for (const s of registry.sources) {
    if (!text(s.id, 80) || ids.has(s.id) || !text(s.name, 150) || !NEWS_TYPES.includes(s.source_type) || !Array.isArray(s.allowedHosts) || !s.allowedHosts.length || s.allowedHosts.some(h => !/^[a-z0-9.-]+$/.test(h)) || typeof s.enabled !== 'boolean' || !['proposed', 'admitted'].includes(s.status)) throw new Error('invalid_news_source');
    ids.add(s.id);
    canonicalNewsUrl(s.homeUrl, s.allowedHosts);
    if (s.feedUrl !== null) canonicalNewsUrl(s.feedUrl, s.allowedHosts);
    if (s.enabled && (s.status !== 'admitted' || !s.feedUrl)) throw new Error('news_source_not_admitted');
    if (s.status === 'admitted' && (!validNewsDate(s.admission?.reviewedAt) || !text(s.admission?.reviewer) || !['accessEvidence','schemaEvidence','dateEvidence','rightsEvidence'].every(k => text(s.admission[k], 1500)))) throw new Error('news_source_not_admitted');
  }
  return registry;
}
function decodeXml(value) {
  return value.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, token) => token[0] === '#' ? String.fromCodePoint(parseInt(token.slice(token[1].toLowerCase() === 'x' ? 2 : 1), token[1].toLowerCase() === 'x' ? 16 : 10)) : ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[token.toLowerCase()]));
}
function field(fields, name) {
  const matching = fields.filter(v => new RegExp(`^<${name}(?:\\s|>)`).test(v));
  if (matching.length > 1) throw new Error('ambiguous_news_field');
  const match = matching[0]?.match(new RegExp(`^<${name}(?:\\s[^>]*)?>([\\s\\S]*)<\\/${name}>$`));
  return match ? decodeXml(match[1]).trim() : null;
}
function feedDate(value) {
  // Accept explicit ISO or RFC feed clocks only. Validate the original calendar
  // before Date.parse can silently normalize February 30 or a 24:00 clock.
  const iso = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:?\d{2})$/);
  const rfc = typeof value === 'string' && value.match(/^(?:(Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*)?(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+(GMT|UTC|[+-]\d{4})$/);
  if (!iso && !rfc) throw new Error('invalid_news_date');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [year,month,day,hour,minute,second,zone] = iso ? iso.slice(1) : [rfc[4],String(months.indexOf(rfc[3])+1).padStart(2,'0'),rfc[2].padStart(2,'0'),rfc[5],rfc[6],rfc[7],rfc[8]];
  const calendar = `${year}-${month}-${day}`;
  if (Number(year) < 1000 || !validNewsDay(calendar) || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) throw new Error('invalid_news_date');
  if (/^[+-]/.test(zone)) { const offset = zone.replace(':',''); if(Number(offset.slice(1,3)) > 23 || Number(offset.slice(3)) > 59) throw new Error('invalid_news_date'); }
  if (rfc?.[1] && ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(calendar+'T00:00:00.000Z').getUTCDay()] !== rfc[1]) throw new Error('invalid_news_date');
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('invalid_news_date');
  return new Date(parsed).toISOString();
}
export function parseNewsFeed(xml, source, observedAt) {
  if (!validNewsDate(observedAt) || Buffer.byteLength(xml) > NEWS_MAX_BYTES || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('invalid_news_feed');
  const blocks = feedEntryBlocks(xml);
  if (blocks.length > NEWS_MAX_ITEMS) throw new Error('news_item_limit');
  const rows = blocks.map(fields => {
    let link = field(fields, 'link');
    if (!link) {
      const links = fields.filter(v => /^<link\s/.test(v)).filter(v => !/\brel=/.test(v) || /\brel=["']alternate["']/.test(v));
      if (links.length !== 1) throw new Error('ambiguous_news_link');
      link = decodeXml(links[0].match(/\bhref=["']([^"']+)["']/)?.[1] || '');
    }
    const canonicalUrl = canonicalNewsUrl(link, source.allowedHosts);
    const title = field(fields, 'title');
    if (!text(title, 300)) throw new Error('invalid_news_title');
    const publishedAt = feedDate(field(fields, 'pubDate') || field(fields, 'published') || field(fields, 'dc:date'));
    const modifiedRaw = field(fields, 'updated');
    const modifiedAt = modifiedRaw ? feedDate(modifiedRaw) : null;
    if (Date.parse(publishedAt) > Date.parse(observedAt) + 300000 || (modifiedAt && (modifiedAt < publishedAt || Date.parse(modifiedAt) > Date.parse(observedAt) + 300000))) throw new Error('future_or_inverted_news_date');
    const sourceGUID = field(fields, 'guid') || field(fields, 'id') || canonicalUrl;
    if (!text(sourceGUID, 1000)) throw new Error('invalid_news_guid');
    return {id:newsId(canonicalUrl), canonicalUrl, sourceId:source.id, sourceName:source.name, sourceGUID, source_type:source.source_type, title, publishedAt, publishedPrecision:'instant', modifiedAt, observedAt, reviewStatus:'pending'};
  });
  // Exact URL identity is cross-source. Stable ordering removes feed-order churn.
  const sorted = rows.sort((a,b) => a.canonicalUrl.localeCompare(b.canonicalUrl) || JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return [...new Map(sorted.map(row => [row.canonicalUrl, row])).values()];
}
const allowedKeys = ['id','canonicalUrl','sourceId','sourceName','sourceGUID','source_type','title','region','regionEvidence','topics','publishedAt','publishedPrecision','modifiedAt','observedAt','reviewStatus','correctionStatus','summary','summaryKind','reviewedAt','reviewer','rightsBasis'];
export function validateNewsItem(row, registry) {
  const source = registry.sources.find(s => s.id === row?.sourceId);
  if (!source || source.status !== 'admitted' || Object.keys(row).some(k => !allowedKeys.includes(k)) || allowedKeys.some(k => !Object.hasOwn(row,k))) throw new Error('invalid_accepted_news_shape');
  if (row.canonicalUrl !== canonicalNewsUrl(row.canonicalUrl, source.allowedHosts) || row.id !== newsId(row.canonicalUrl) || row.sourceName !== source.name || row.source_type !== source.source_type || !text(row.title,300) || !text(row.sourceGUID,1000) || !text(row.region,80) || !text(row.regionEvidence,1000) || !Array.isArray(row.topics) || row.topics.length > 8 || row.topics.some(t => !text(t,50)) || !((row.publishedPrecision === 'day' && validNewsDay(row.publishedAt)) || (row.publishedPrecision === 'instant' && validNewsDate(row.publishedAt))) || !validNewsDate(row.observedAt) || !validNewsDate(row.reviewedAt) || (row.modifiedAt !== null && (!validNewsDate(row.modifiedAt) || row.modifiedAt < row.publishedAt)) || row.reviewStatus !== 'approved' || !['none','corrected'].includes(row.correctionStatus) || !text(row.reviewer,150) || !text(row.rightsBasis,1500)) throw new Error('invalid_accepted_news');
  if (row.publishedAt > row.observedAt || row.reviewedAt < row.observedAt || (row.modifiedAt && row.modifiedAt > row.observedAt)) throw new Error('invalid_news_clock_order');
  if (!((row.summary === null && row.summaryKind === 'none') || (text(row.summary,600) && row.summaryKind === 'reviewed_original'))) throw new Error('unreviewed_news_summary');
  return row;
}
export function buildNews(decisions, registry) {
  validateNewsRegistry(registry);
  if (decisions?.version !== 1 || !Array.isArray(decisions.decisions)) throw new Error('invalid_news_decisions');
  const ids = new Set();
  const items = [];
  for (const decision of decisions.decisions) {
    if (!text(decision.id,80) || ids.has(decision.id) || !['approved','rejected','withdrawn'].includes(decision.status)) throw new Error('invalid_or_duplicate_news_decision');
    ids.add(decision.id);
    if (decision.status === 'approved') {
      const row = validateNewsItem(decision.record, registry);
      if (decision.id !== row.id) throw new Error('news_decision_identity_mismatch');
      items.push(row);
    }
  }
  if (new Set(items.map(r => r.canonicalUrl)).size !== items.length) throw new Error('duplicate_news_url');
  items.sort((a,b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
  return {version:1, items};
}
export function newsScript(payload) { return `window.HALIFAX_NEWS = ${JSON.stringify(payload, null, 2).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029')};\n`; }
