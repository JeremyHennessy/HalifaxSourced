import assert from 'node:assert/strict';
import {copyFile,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
const root=await mkdtemp(join(tmpdir(),'halifax-event-refresh-'));
try {
  await mkdir(join(root,'scripts','lib'),{recursive:true});await mkdir(join(root,'data','build'),{recursive:true});
  for(const file of ['scripts/sanitize-city-events.mjs','scripts/resolve-city-event-entities.mjs','scripts/lib/canonical-event-dedupe.mjs'])await copyFile(new URL('../'+file,import.meta.url),join(root,file));
  const venue={venueId:'scotiabank-centre-halifax',name:'Scotiabank Centre',address:'1800 Argyle Street, Halifax',city:'Halifax',sourceIds:['team','venue']};
  await writeFile(join(root,'data','venue-registry.json'),JSON.stringify({venues:[venue]}));
  await writeFile(join(root,'data','organizer-registry.json'),JSON.stringify({organizers:[]}));
  await writeFile(join(root,'data','build','catalog.json'),JSON.stringify({restaurants:[]}));
  await writeFile(join(root,'data','event-source-registry.json'),JSON.stringify({sources:['team','venue'].map(id=>({id,kind:'official_sports_schedule',venueName:venue.name,venueAddress:venue.address}))}));
  // A retained resolved team event and a newly fetched unresolved venue event.
  const game={id:'retained',sourceId:'team',title:'Halifax Mooseheads vs Rouyn-Noranda',startAt:'2026-10-08T22:00:00.000Z',venueId:venue.venueId,venueName:venue.name,city:'Halifax',eventUrl:'https://team.example/game'};
  const fresh={...game,id:'fresh',sourceId:'venue',venueId:undefined,title:'Halifax Mooseheads vs Rouyn-Noranda Huskies',eventUrl:'https://venue.example/game'};
  const records=[game,fresh,{...game,id:'other-opponent',title:'Halifax Mooseheads vs Drummondville'},{...game,id:'later-game',startAt:'2026-10-08T23:00:00.000Z'}];
  await writeFile(join(root,'data','build','city-events.json'),JSON.stringify({events:records}));
  const run=script=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(root,'scripts',script)],{cwd:root,stdio:['ignore','pipe','pipe']});let error='';child.stderr.on('data',chunk=>error+=chunk);child.stdout.resume();child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(`${script}: ${error}`)));});
  await run('sanitize-city-events.mjs');await run('resolve-city-event-entities.mjs');
  const output=JSON.parse(await readFile(join(root,'data','build','city-events.json'),'utf8'));
  assert.equal(output.events.length,3,'Refresh must merge resolved/unresolved representations before venue resolution.');
  const retained=output.events.find(event=>event.id==='retained');
  assert.deepEqual(retained.sourceUrls.sort(),['https://team.example/game','https://venue.example/game']);
  assert.equal(retained.venueId,venue.venueId);
  assert(output.events.some(event=>event.id==='other-opponent'));assert(output.events.some(event=>event.id==='later-game'));
  await run('sanitize-city-events.mjs');await run('resolve-city-event-entities.mjs');
  assert.equal(JSON.parse(await readFile(join(root,'data','build','city-events.json'),'utf8')).events.length,3);
  console.log('Refresh pipeline passed: resolved/unresolved venue aliases merge; provenance and distinct same-day games survive.');
} finally {await rm(root,{recursive:true,force:true});}
