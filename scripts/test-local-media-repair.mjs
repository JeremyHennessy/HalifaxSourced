import assert from 'node:assert/strict';
import {copyFile,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import vm from 'node:vm';
const root=await mkdtemp(join(tmpdir(),'halifax-local-media-'));
try {
  await mkdir(join(root,'scripts'),{recursive:true});await mkdir(join(root,'data','build'),{recursive:true});await mkdir(join(root,'assets','restaurants'),{recursive:true});
  for(const file of ['scripts/repair-source-integrity.mjs','scripts/check-restaurant-media-rights.mjs','source-integrity.js'])await copyFile(new URL('../'+file,import.meta.url),join(root,file));
  const local={url:'assets/restaurants/fixture.jpg',alt:'Fixture licensed restaurant exterior for this isolated test',sourceUrl:'https://commons.example/fixture',sourceType:'licensed',creator:'Fixture creator',license:'Fixture CC BY-SA 4.0',rightsBasis:'Fixture explicit licence',permission:'licensed',permissionConfirmed:true,attribution:'Fixture creator CC BY-SA 4.0',reviewState:'approved'};
  const licensed=Array.from({length:25},(_,index)=>({...local,restaurantId:'fixture-'+index}));
  const bad=[{...local,restaurantId:'traversal',url:'assets/restaurants/../../outside.jpg'},{...local,restaurantId:'quarantined',url:'https://justitalymentone.com/image.jpg'}];
  await writeFile(join(root,'data','restaurant-media.js'),`window.HALIFAX_RESTAURANT_MEDIA = ${JSON.stringify({records:[...licensed,...bad]})};\n`);
  await writeFile(join(root,'data','restaurant-media-priority.json'),JSON.stringify({targetCount:26,records:[...licensed.map(row=>({restaurantId:row.restaurantId,status:'approved'})),{restaurantId:'quarantined',status:'source_check'}]}));
  await writeFile(join(root,'assets','restaurants','fixture.jpg'),'isolated fixture; validator tests access/metadata, not pixels');
  const run=script=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(root,'scripts',script)],{cwd:root,stdio:['ignore','pipe','pipe']});let error='';child.stderr.on('data',chunk=>error+=chunk);child.stdout.resume();child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(`${script}: ${error}`)));});
  await run('repair-source-integrity.mjs');
  const context={window:{}};vm.runInNewContext(await readFile(join(root,'data','restaurant-media.js'),'utf8'),context);
  assert.equal(context.window.HALIFAX_RESTAURANT_MEDIA.records.length,25);
  assert.equal(JSON.stringify(context.window.HALIFAX_RESTAURANT_MEDIA.records),JSON.stringify(licensed));
  const quarantine=JSON.parse(await readFile(join(root,'data','source-quarantine.json'),'utf8'));
  assert.deepEqual(quarantine.records.map(row=>row.record.restaurantId).sort(),['quarantined','traversal']);
  await run('check-restaurant-media-rights.mjs');
  console.log('Local media repair passed: licensed repository assets unchanged, traversal and remote quarantine rejected, priority/manifest consistent.');
} finally {await rm(root,{recursive:true,force:true});}
