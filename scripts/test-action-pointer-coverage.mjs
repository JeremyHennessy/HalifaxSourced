import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { rejectedOrderingPrimaryIds } from './lib/action-pointer-coverage.mjs';
const id = 'osm-node-11552234300-sushi-nami-royale';
const wrong = 'https://sushinami.ca/downtown-halifax/take-out/';
const valid = 'https://sushinami.ca/bayers-lake/lunch-menu/';
const generic = 'https://www.ubereats.com/';
const firstParty = { records: [
  {restaurantId:id, relatedLinks:[{kind:'ordering',url:wrong},{kind:'ordering',url:generic}]},
  {restaurantId:'valid', relatedLinks:[{kind:'ordering',url:valid},{kind:'reservations',url:'https://fixture.example/reserve'}]},
] };
const facts = { records: [
  {restaurantId:id, sourceUrl:'https://sushinami.ca/', ordering:[{url:generic}], observedAt:'2026-09-04'},
  {restaurantId:'valid', sourceUrl:'https://fixture.example/', ordering:[{url:valid}], reservations:[{url:'https://fixture.example/reserve'}]}
] };
assert.deepEqual([...rejectedOrderingPrimaryIds(firstParty.records, facts.records)], [id]);
assert.deepEqual([...rejectedOrderingPrimaryIds([], [{restaurantId:id,ordering:[{url:wrong}]}])], [id], 'Structured-only wrong-branch primary is also rejected');
assert.deepEqual([...rejectedOrderingPrimaryIds([], [{restaurantId:id,ordering:[{url:'javascript:alert(1)'},{url:valid}]}])], [], 'Do not reinterpret the existing structured-addition safeUrl filter');
assert.deepEqual([...rejectedOrderingPrimaryIds([], [{restaurantId:id,sourceUrl:'https://glitterbeancafe.com/',ordering:[{url:wrong}]}])], [], 'Quarantined roots never supply a browser primary');
const raw = JSON.stringify({firstParty, facts});
const root = await mkdtemp(join(tmpdir(),'halifax-action-coverage-'));
try {
  for (const file of ['scripts/build-content-coverage-report.mjs','scripts/reconcile-structured-coverage.mjs','scripts/lib/coverage-values.mjs','scripts/lib/action-pointer-coverage.mjs','scripts/lib/reviewed-corrections.mjs','restaurant-corrections.js','scripts/lib/media-rights-contract.mjs','source-integrity.js','app-media.js']) {
    await mkdir(dirname(join(root,file)),{recursive:true});
    await copyFile(new URL('../'+file,import.meta.url),join(root,file));
  }
  await mkdir(join(root,'data/build'),{recursive:true});
  const save=(name,value)=>writeFile(join(root,'data/build',name+'.json'),JSON.stringify(value));
  await save('catalog',{restaurants:[{id,name:'Bayers'},{id:'valid',name:'Valid'}]});
  await save('first-party-sources',firstParty);
  await save('structured-place-facts',facts);
  await writeFile(join(root,'data/reviewed-place-resolutions.js'),'window.HALIFAX_REVIEWED_PLACE_RESOLUTIONS={records:[]};');
  await writeFile(join(root,'data/reviewed-restaurant-corrections.js'),'window.HALIFAX_RESTAURANT_CORRECTIONS={};');
  for (const script of ['build-content-coverage-report','reconcile-structured-coverage']) {
    execFileSync(process.execPath,[join(root,'scripts',script+'.mjs')],{cwd:root,stdio:'pipe'});
    const report=JSON.parse(await readFile(join(root,'data/build/content-coverage-report.json')));
    assert.equal(report.restaurantCoverage.withOnlineOrderingLink,1,script+': wrong primary cannot promote secondary/raw history into coverage');
    assert.equal(report.restaurantCoverage.withReservationLink,1,script+': unrelated reservation count remains');
    assert.equal(report.restaurantCoveragePercent.ordering,50);
  }
  assert.equal(await readFile(join(root,'data/build/first-party-sources.json'),'utf8'),JSON.stringify(firstParty));
  assert.equal(await readFile(join(root,'data/build/structured-place-facts.json'),'utf8'),JSON.stringify(facts));
  assert.equal(JSON.stringify({firstParty,facts}),raw);
} finally { await rm(root,{recursive:true,force:true}); }
console.log('Action coverage passed: original-primary holds survive base/structured union; valid actions, reservation semantics and raw evidence remain.');
