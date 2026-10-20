import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { approveEligibleThumbnails, reconcileAutomaticMediaPriority } from './lib/automatic-thumbnail-approval.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const readJson = async path => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
const context = { window: {} };
vm.runInNewContext(await readFile(new URL('../data/restaurant-media.js', import.meta.url), 'utf8'), context);
const manifest = context.window.HALIFAX_RESTAURANT_MEDIA;
const restaurants = (await readJson('data/build/catalog.json')).restaurants;
const priority = await readJson('data/restaurant-media-priority.json');
const result = await approveEligibleThumbnails({
  candidates: (await readJson('data/build/thumbnail-candidates.json')).candidates,
  assessments: (await readJson('data/thumbnail-assessments.json')).records,
  restaurants,
  media: manifest.records, root,
  decisions: (await readJson('data/reviewed-thumbnail-decisions.json')).records,
  rejections: (await readJson('data/thumbnail-rejected-candidates.json')).records
});
const apply = !process.argv.includes('--assess-only');
const nextPriority = reconcileAutomaticMediaPriority(priority, result.records, restaurants);
if (apply && JSON.stringify(nextPriority) !== JSON.stringify(priority)) await writeFile(new URL('../data/restaurant-media-priority.json', import.meta.url), JSON.stringify(nextPriority, null, 2) + '\n');
if (apply && JSON.stringify(result.records) !== JSON.stringify(manifest.records)) {
  // No wall-clock churn: the exact evidence and bytes determine the output.
  const output = { ...manifest, records: result.records };
  await writeFile(new URL('../data/restaurant-media.js', import.meta.url), `window.HALIFAX_RESTAURANT_MEDIA = ${JSON.stringify(output, null, 2)};\n`);
}
await writeFile(new URL('../data/build/thumbnail-auto-approval-report.json', import.meta.url), JSON.stringify({ ...result.report, mode: apply ? 'apply' : 'assess_only' }, null, 2) + '\n');
console.log(`Automatic thumbnails (${apply ? 'apply' : 'assess only'}): ${JSON.stringify(result.report.counts)}`);
