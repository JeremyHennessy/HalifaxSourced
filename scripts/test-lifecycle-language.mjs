import { classifyLifecycleLanguage } from "./lib/lifecycle-language.mjs";
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const cases = [
  ["After ten years, our final service is April 29.", "closures"],
  ["We are closing our doors at this address.", "closures"],
  ["We moved to 123 Portland Street.", "moves"],
  ["Our team is relocating to Dartmouth Crossing.", "moves"]
];
for (const [text, kind] of cases) {
  const result = classifyLifecycleLanguage(text);
  if (!result[kind]?.length) throw new Error(`Expected ${kind} classification for: ${text}`);
}
const neutral = classifyLifecycleLanguage("Open tonight with our seasonal dinner menu.");
if (neutral.closures.length || neutral.moves.length) throw new Error("Neutral operating language created a lifecycle signal.");
console.log("Lifecycle closure and move language regression passed.");

for (const text of [
  'Executive Chef Philip has over 20 years experience. He worked in hotels across Japan before relocating to Canada.',
  'We are soft opening our new location on 8th Jan in Mississauga.',
  "I'd consider moving to Halifax for the firecracker rolls.",
  '<p>Open tonight.</p><script>specs.events.ui.RelocatedPagesModal=true; we moved',
  'specs.events.ui.RelocatedPagesModal'
]) assert.deepEqual(classifyLifecycleLanguage(text), {closures:[], moves:[]}, text);
for (const text of ['Our new location is in Dartmouth.', 'We are relocating to Toronto.', 'Our chef worked in Japan before relocating to Canada. Our restaurant is relocating to Dartmouth.']) assert(classifyLifecycleLanguage(text).moves.length, text);
assert(classifyLifecycleLanguage('We will be closed on Mondays beginning October 26.').closures.length);

// Exercise the actual report entrypoint: a same-head fresh observation must
// reach the report, while old-run input and impossible dates must not.
const root = await mkdtemp(join(tmpdir(), 'halifax-lifecycle-'));
try {
  for (const file of ['scripts/check-restaurant-lifecycle.mjs','scripts/lib/lifecycle-language.mjs','scripts/lib/reviewed-corrections.mjs','restaurant-corrections.js','source-integrity.js']) {
    await mkdir(dirname(join(root,file)), {recursive:true});
    await copyFile(new URL('../'+file,import.meta.url),join(root,file));
  }
  await mkdir(join(root,'data/build'),{recursive:true}); await mkdir(join(root,'docs'));
  await writeFile(join(root,'data/reviewed-restaurant-corrections.js'),'window.HALIFAX_RESTAURANT_CORRECTIONS={records:[],aliases:[],additions:[]};');
  await writeFile(join(root,'data/reviewed-place-resolutions.js'),'window.HALIFAX_REVIEWED_PLACE_RESOLUTIONS={records:[]};');
  const save = (file,value) => writeFile(join(root,'data/build',file+'.json'),JSON.stringify(value));
  await save('catalog',{restaurants:[{id:'venue',name:'Venue'}]});
  for(const name of ['official-site-signals','first-party-sources','website-feed-signals','recent-social-posts']) await save(name,{});
  await save('website-page-intelligence',{records:[{restaurantId:'venue',title:'We are closing our doors.',publishedAt:'4545-01-01T00:00:00Z'}]});
  const links={sourceCommitSha:'fixture-head',complete:true,generatedAt:new Date().toISOString(),lifecycleCandidates:[{restaurantIds:['venue'],sourceUrl:'https://example.com/location',observedAt:'2026-10-19T12:00:00Z',phrase:'we moved'}]};
  await save('source-link-health-report',links);
  const run=async()=>{execFileSync(process.execPath,[join(root,'scripts/check-restaurant-lifecycle.mjs')],{env:{...process.env,SOURCE_COMMIT_SHA:'fixture-head'}});return JSON.parse(await readFile(join(root,'data/build/restaurant-lifecycle-report.json')));};
  let report=await run();
  assert.equal(report.liveSourceAudit.state,'same_head_complete');
  assert.equal(report.liveSourceAudit.candidates,1);
  assert.equal(report.candidates.find(x=>x.sourceLayer==='release_official_page_fetch').sourceUrl,links.lifecycleCandidates[0].sourceUrl);
  assert.equal(report.candidates.find(x=>x.sourceLayer==='website-page-intelligence').publishedAt,null);
  assert.equal(report.candidates.find(x=>x.sourceLayer==='website-page-intelligence').publicationDateState,'future');
  await save('source-link-health-report',{...links,sourceCommitSha:'old-head'}); report=await run();
  assert.equal(report.liveSourceAudit.state,'not_current_complete');
  assert(!report.candidates.some(x=>x.sourceLayer==='release_official_page_fetch'));
  console.log('Lifecycle report consumes same-head fresh-page candidates and rejects stale-run/future-date evidence.');
} finally { await rm(root,{recursive:true,force:true}); }
