import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { classifyLifecycleLanguage } from './lib/lifecycle-language.mjs';
import { applyReviewedCorrections } from './lib/reviewed-corrections.mjs';
import integrity from '../source-integrity.js';
import { currentLifecycleCandidates } from './lib/link-health-report.mjs';

const json = async path => JSON.parse(await readFile(new URL('../' + path, import.meta.url), 'utf8'));
const catalog = await json('data/build/catalog.json');
const restaurants = applyReviewedCorrections(catalog.restaurants);
const inactive = new Set(['seasonally_closed', 'temporarily_closed', 'permanently_closed', 'moved', 'replaced']);
const failures = [];
const records = restaurants.map(restaurant => {
  const evidence = restaurant.operatingStatusEvidence || {};
  const problems = [];
  if (inactive.has(restaurant.operatingStatus) && (!evidence.claim || !evidence.sourceUrl || !(evidence.observedAt || evidence.verifiedAt))) problems.push('inactive_without_reviewed_evidence');
  if (problems.length) failures.push({ restaurantId: restaurant.id, problems });
  return { restaurantId: restaurant.id, name: restaurant.name, status: restaurant.operatingStatus || 'unknown', effectiveDate: evidence.effectiveDate || restaurant.closureDate || null, observedAt: evidence.observedAt || evidence.verifiedAt || null, sourceUrl: evidence.sourceUrl || null, reviewState: evidence.reviewState || 'unreviewed', problems };
});
const candidates = [];
const ids = new Set(restaurants.map(item => item.id));
for (const [file, field] of [['official-site-signals', 'results'], ['first-party-sources', 'records'], ['website-feed-signals', 'signals'], ['website-page-intelligence', 'records'], ['recent-social-posts', 'records']]) {
  const payload = await json(`data/build/${file}.json`);
  for (const item of payload[field] || []) {
    if (!ids.has(item.restaurantId)) continue;
    const text = [item.title, item.summary, item.text, item.description, item.excerpt, item.pageTitle, ...(item.candidateLinks || []).map(link => link.text)].filter(Boolean).join(' ');
    const signals = classifyLifecycleLanguage(text);
    if (!Object.values(signals).some(values => values.length)) continue;
    const restaurant = restaurants.find(record => record.id === item.restaurantId);
    const publicationDateState = integrity.publicationState(item.publishedAt).dateState;
    candidates.push({ restaurantId: item.restaurantId, name: restaurant.name, sourceLayer: file, sourceUrl: item.postUrl || item.sourceUrl || item.website || item.resolvedUrl || null, observedAt: item.observedAt || null, publishedAt: publicationDateState === 'valid' ? item.publishedAt : null, publicationDateState, signals, excerpt: text.slice(0, 900), reviewState: inactive.has(restaurant.operatingStatus) ? 'reviewed_inactive' : 'candidate_requires_location_review' });
  }
}
const expectedSha = process.env.SOURCE_COMMIT_SHA || process.env.GITHUB_SHA || null;
let liveSourceAudit = { state: 'not_available', candidates: 0 };
try {
  const links = await json('data/build/source-link-health-report.json');
  const current = Boolean(expectedSha && links.sourceCommitSha === expectedSha && links.complete && integrity.publicationState(links.generatedAt, Date.now(), 1).isRecent);
  liveSourceAudit = { state: current ? 'same_head_complete' : 'not_current_complete', sourceCommitSha: links.sourceCommitSha || null, assessedAt: links.generatedAt || null, candidates: 0 };
  for (const item of current ? currentLifecycleCandidates(links, Date.now(), catalog) : []) for (const id of item.restaurantIds || []) {
    const restaurant = restaurants.find(record => record.id === id);
    if (restaurant) { liveSourceAudit.candidates++; candidates.push({ ...item, restaurantId: id, name: restaurant.name, sourceLayer: 'release_official_page_fetch', reviewState: inactive.has(restaurant.operatingStatus) ? 'reviewed_inactive' : 'candidate_requires_location_review' }); }
  }
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const statusCounts = records.reduce((counts, item) => { counts[item.status] = (counts[item.status] || 0) + 1; return counts; }, {});
const audit = { total: records.length, statusCounts, invalid: failures.length, records };
const report = { version: 3, liveSourceAudit, generatedAt: new Date().toISOString(), sourceCommitSha: process.env.SOURCE_COMMIT_SHA || process.env.GITHUB_SHA || null, policy: { inactiveStatuses: [...inactive], candidateSignals: 'Scans the full catalog and retained official-site/feed/page/post observations. Candidates never change status automatically. Missing or old observations are not represented as a fresh fetch.' }, catalogAudit: audit, curatedAudit: { ...audit, scope: 'Compatibility alias: now the complete published catalog, not ten curated records.' }, candidates, failures };
await mkdir(new URL('../data/build/', import.meta.url), { recursive: true });
await writeFile(new URL('../data/build/restaurant-lifecycle-report.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
await writeFile(new URL('../docs/restaurant-lifecycle-report.md', import.meta.url), `# Restaurant lifecycle review\n\nGenerated ${report.generatedAt}. Source SHA: ${report.sourceCommitSha || 'local, unbound'}.\n\n${records.length} catalog records checked; ${records.filter(item => inactive.has(item.status)).length} archived/inactive; ${candidates.filter(item => item.reviewState === 'candidate_requires_location_review').length} source-language candidates require review. Source observation dates remain separate from this report build date.\n`);
if (failures.length) { console.error(JSON.stringify(failures, null, 2)); process.exit(1); }
console.log(`Lifecycle evidence checked across ${records.length} catalog records; ${candidates.length} retained-source language matches.`);
