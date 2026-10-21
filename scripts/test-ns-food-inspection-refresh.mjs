import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const root = await mkdtemp(join(tmpdir(), 'halifax-inspection-guard-'));
const snapshot = join(root, 'data', 'build', 'ns-food-inspections.json');
const browserSnapshot = join(root, 'data', 'ns-food-inspections.js');
const form = '<form><input name="__VIEWSTATE" value="abc"><input value="def" name="__VIEWSTATEGENERATOR"><input name="__EVENTVALIDATION" value="ghi"></form>';
const row = (id, name, address) => '<td id="FACILITYNAME"><a href="Details.aspx?Id1=' + id + '">' + (name ?? ('Venue ' + id)) + '</a></td><td id="ADDRESS">' + (address ?? '1 MAIN, HALIFAX') + '</td>';
const page = rows => 'Search Results will be current as of <span>19 Oct, 2026 1:00 PM</span><table>' + rows.join('') + '</table>';
try {
  await mkdir(join(root, 'scripts'), {recursive:true});
  await mkdir(join(root, 'data', 'build'), {recursive:true});
  await copyFile(new URL('./import-ns-food-inspections.mjs',import.meta.url),join(root,'scripts','import-ns-food-inspections.mjs'));
  await copyFile(new URL('../data/regional-discovery-scope.json',import.meta.url),join(root,'data','regional-discovery-scope.json'));
  await writeFile(join(root, 'runner.mjs'), [
    "import {readFile} from 'node:fs/promises';",
    "const s=JSON.parse(await readFile(new URL('./case.json',import.meta.url)));",
    "globalThis.fetch=async(url,options={})=>{",
    "  const city=options.method==='POST'?new URLSearchParams(options.body).get('TxtCity'):null;",
    "  if(options.method!=='POST')return new Response(s.failGet?'Error':(s.badForm?'Maintenance':s.form),{status:s.failGet?503:200});",
    "  if(s.failPost===city)return new Response('Error',{status:502});",
    "  if(s.badCity===city)return new Response('<h1>Maintenance</h1>',{status:200});",
    "  return new Response(s.pages[city]||'Empty',{status:200});",
    "};",
    "await import('./scripts/import-ns-food-inspections.mjs');"
  ].join('\n'));
  const record = (id,city='Bedford') => ({id:'ns-food-'+id,facilityId:String(id),name:'Old '+id,address:'Old address',city,observedAt:'2026-09-01T12:00:00Z'});
  const save = async(records) => {
    await writeFile(snapshot,JSON.stringify({generatedAt:'2026-09-01T12:00:00Z',cities:['Halifax','Dartmouth','Bedford'],count:records.length,records}));
    await writeFile(browserSnapshot,'OLD-ACCEPTED');
  };
  const pages={Halifax:page([row('11'),row('12')]),Dartmouth:page([row('21')]),Bedford:page([row('31')])};
  const run = async (s={},cities='Halifax,Dartmouth,Bedford') => {
    await writeFile(join(root,'case.json'),JSON.stringify({form,pages,...s}));
    return new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[join(root,'runner.mjs')],{cwd:root,env:{...process.env,NS_FOOD_BATCH:'',NS_FOOD_CITIES:cities,NS_FOOD_TIMEOUT_MS:'3000'},stdio:['ignore','pipe','pipe']});
      let error='';child.stderr.on('data',chunk=>error+=chunk);child.stdout.resume();child.on('error',reject);child.on('close',code=>resolve({code,error}));
    });
  };
  const fail = async (s,cities,message)=>{
    const before=await readFile(snapshot,'utf8'), jsBefore=await readFile(browserSnapshot,'utf8');
    const {code,error}=await run(s,cities);
    assert.notEqual(code,0,'invalid inspection response was accepted');
    assert.match(error,message);
    assert.equal(await readFile(snapshot,'utf8'),before,'invalid response overwrote JSON');
    assert.equal(await readFile(browserSnapshot,'utf8'),jsBefore,'invalid response overwrote browser data');
  };

  await save([record('1','Halifax'),record('31'),record('40','Dartmouth')]);
  await fail({},'Halifax,Dartmouth,Bedford,Hammonds Plains',/at most three/);
  let result=await run();assert.equal(result.code,0,result.error);
  let fresh=JSON.parse(await readFile(snapshot,'utf8'));
  assert.equal(fresh.count,4);
  assert.equal(fresh.refresh.missingFromLatestSearch.length,2);
  assert.equal(fresh.refresh.missingDoesNotEstablishClosure,true);
  assert(fresh.records.every(x=>x.observedAt&&x.currentAsOf));
  assert.match(await readFile(browserSnapshot,'utf8'),/^window\.HALIFAX_NS_FOOD_INSPECTIONS = /);
  await save([record('1','Halifax'),record('31'),record('40','Dartmouth')]);
  await fail({},'Halifax,Dartmouth,Bedford,Hammonds Plains',/at most three/);
  result=await run({},'Halifax');assert.equal(result.code,0,result.error);
  fresh=JSON.parse(await readFile(snapshot,'utf8'));
  assert.equal(fresh.count,4);
  assert.equal(fresh.records.find(x=>x.facilityId==='31').observedAt,'2026-09-01T12:00:00Z');
  assert.deepEqual(fresh.refresh.retainedCities.sort(),['Bedford','Dartmouth']);
  result=await run({pages:{Halifax:page([row('11')]),Dartmouth:page([row('11')])}},'Halifax,Dartmouth');
  assert.equal(result.code,0,result.error);
  fresh=JSON.parse(await readFile(snapshot,'utf8'));
  assert.equal(fresh.records.filter(x=>x.facilityId==='11').length,1);

  await save([record('1','Halifax'),record('31')]);
  await fail({failGet:true},'Halifax',/search form HTTP 503/);
  await fail({badForm:true},'Halifax',/Missing __VIEWSTATE/);
  await fail({failPost:'Halifax'},'Halifax',/search HTTP 502/);
  await fail({badCity:'Halifax'},'Halifax',/unrecognized HTML/);
  await fail({pages:{Halifax:page([])}},'Halifax',/Incomplete inspection results/);
  await fail({pages:{Halifax:page([row('11'),'<td id="FACILITYNAME">broken</td>'])}},'Halifax',/Incomplete inspection results/);
  await fail({pages:{Halifax:page([row('bad')])}},'Halifax',/Invalid inspection facility row/);
  await fail({pages:{Halifax:page([row('11','Venue','')])}},'Halifax',/Invalid inspection facility row/);
  await fail({pages:{Halifax:page([row('11','', 'Street')])}},'Halifax',/Invalid inspection facility row/);
  await fail({badCity:'Dartmouth'},'Halifax,Dartmouth',/unrecognized HTML/);
  await save(Array.from({length:24},(_,i)=>record(1000+i,'Halifax')));
  await fail({pages:{Halifax:page([row('11')])}},'Halifax',/unexpectedly fell/);
  await fail({pages:{Halifax:page(Array.from({length:24},(_,i)=>row('11','Trading alias '+i)))}},'Halifax',/unexpectedly fell/);
  await fail({pages:{Halifax:page([...Array.from({length:17},(_,i)=>row(String(1000+i))),...Array.from({length:7},()=>row('1000','Trading alias'))])}},'Halifax',/unexpectedly fell/);
  result=await run({pages:{Halifax:page([...Array.from({length:18},(_,i)=>row(String(1000+i))),...Array.from({length:6},()=>row('1000','Trading alias'))])}},'Halifax');
  assert.equal(result.code,0,result.error);
  fresh=JSON.parse(await readFile(snapshot,'utf8'));
  assert.equal(fresh.count,18,'exactly 75% unique facilities should remain accepted');
  await writeFile(snapshot,JSON.stringify({count:99,records:[record('1')]}));
  await fail({},'Halifax',/Existing inspection snapshot failed/);
  console.log('Inspection snapshot safety regression passed: valid full/partial refresh, alias-aware de-duplication, 75% boundary and 14 failure modes.');
} finally {await rm(root,{recursive:true,force:true});}
