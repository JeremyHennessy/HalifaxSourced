import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const root=new URL('../',import.meta.url);
const scope=JSON.parse(readFileSync(new URL('data/regional-discovery-scope.json',root)));
assert.equal(scope.completeCensus,false);
assert.equal(scope.osm.accessState,'blocked_pending_access_review');
assert.equal(scope.osm.maximumAreasPerRun,1);
assert(scope.inspections.batches.every(batch=>batch.cities.length<=scope.inspections.maximumCitiesPerRun));
assert(scope.osm.areas.find(a=>a.id==='bedford-west-bedford').bbox.north>44.705);
assert(scope.osm.areas.find(a=>a.id==='hammonds-upper-hammonds').bbox.west< -63.69);
const before=readFileSync(new URL('data/osm-restaurants.js',root),'utf8');
const run=(args=[],env={})=>spawnSync(process.execPath,['--input-type=module','-e',`globalThis.fetch=()=>{throw Error('NETWORK_MUST_NOT_BE_ATTEMPTED')};process.argv.push(...${JSON.stringify(args)});await import('./scripts/import-osm-restaurants.mjs');`],{cwd:root,env:{...process.env,...env},encoding:'utf8'});
for(const area of scope.osm.areas){const plan=run(['--plan'],{OSM_DISCOVERY_AREA:area.id});assert.equal(plan.status,0,plan.stderr);assert.equal(JSON.parse(plan.stdout).networkAttempted,false);const blocked=run([],{OSM_DISCOVERY_AREA:area.id});assert.notEqual(blocked.status,0);assert.match(blocked.stderr,/blocked_pending_access_review/);assert(!blocked.stderr.includes('NETWORK_MUST_NOT_BE_ATTEMPTED'));}
assert.equal(readFileSync(new URL('data/osm-restaurants.js',root),'utf8'),before);
const report=spawnSync(process.execPath,['scripts/plan-regional-discovery.mjs'],{cwd:root,encoding:'utf8'});assert.equal(report.status,0,report.stderr);const output=JSON.parse(report.stdout);assert.equal(output.osm.areas.find(a=>a.id==='bedford-west-bedford').withinRetainedFootprint,false);assert.equal(output.networkAttempted,false);
console.log('Regional scope: planned versus retained footprints, bounded locality batches, denied OSM no-network guard and unchanged snapshot passed.');
