import assert from 'node:assert/strict';
import {copyFile,mkdir,mkdtemp,readFile,rm,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const root=await mkdtemp(join(tmpdir(),'halifax-scheduled-guard-'));
try {
  await mkdir(join(root,'scripts','lib'),{recursive:true});await mkdir(join(root,'data','build'),{recursive:true});
  for(const file of ['scripts/check-source-links.mjs','scripts/build-thumbnail-candidates.mjs','scripts/lib/fetch-public-source.mjs','source-integrity.js'])await copyFile(new URL('../'+file,import.meta.url),join(root,file));
  const venues=[{id:'unsafe',name:'Unsafe venue',website:'https://www.glitterbeancafe.com/contact'},{id:'unsafe-dot',name:'Unsafe dotted venue',website:'https://glitterbeancafe.com./contact'},{id:'redirect',name:'Redirect venue',website:'https://fixture.example/contact'}];
  for(const [name,payload] of [['catalog',{restaurants:venues}],['first-party-sources',{records:[]}],['structured-place-facts',{records:[]}],['city-events',{events:[]}]])await writeFile(join(root,'data','build',name+'.json'),JSON.stringify(payload));
  const requests=[];
  for(const script of ['check-source-links.mjs','build-thumbnail-candidates.mjs']) {
    const log=join(root,script+'.requests.json');
    await writeFile(join(root,'runner.mjs'),`import {writeFile} from 'node:fs/promises';const requests=[];globalThis.fetch=async(input,options)=>{const url=String(input);requests.push(url);if(!url.startsWith('https://fixture.example/'))throw new Error('network-disabled:'+url);return new Response(null,{status:302,headers:{location:'https://bowtiecreamery.com/'}});};try{await import(${JSON.stringify(pathToFileURL(join(root,'scripts',script)).href)});}finally{await writeFile(${JSON.stringify(log)},JSON.stringify(requests));}`);
    const result=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(root,'runner.mjs')],{cwd:root,env:{...process.env,LINK_HEALTH_LIMIT:'20',LINK_HEALTH_CONCURRENCY:'1',THUMBNAIL_DISCOVERY_FETCH:'1',THUMBNAIL_IMAGE_PROBE:'0',THUMBNAIL_DISCOVERY_PAGE_LIMIT:'10',THUMBNAIL_DISCOVERY_DELAY_MS:'0'},stdio:['ignore','pipe','pipe']});let error='';child.stderr.on('data',chunk=>error+=chunk);child.stdout.resume();child.on('error',reject);child.on('close',code=>resolve({code,error}));});
    assert.equal(result.code,0,script+': '+result.error);
    const fetched=JSON.parse(await readFile(log,'utf8'));requests.push(...fetched);
    assert(fetched.length>0,script+' must exercise a permitted source before a blocked redirect');
    assert(fetched.every(url=>url.startsWith('https://fixture.example/')),script+' fetched a quarantined source/destination: '+JSON.stringify(fetched));
  }
  // Catalogue-source consumers must keep the shared wrapper; API-only imports
  // use fixed endpoints and are outside this source-URL test.
  for(const name of await readdir(new URL('./',import.meta.url))) {
    if(!name.endsWith('.mjs')||name.startsWith('test-')||['import-meta-social.mjs','import-google-places.mjs','import-ns-food-inspections.mjs','import-osm-restaurants.mjs'].includes(name))continue;
    const source=await readFile(new URL(name,import.meta.url),'utf8');
    if(/\bfetch\(/.test(source))assert(source.includes('import { fetchGuardedSource as fetch }'),name+' has an unguarded source request');
  }
  console.log('Scheduled source guards passed offline: link checks and thumbnail discovery never request quarantined URLs or redirect destinations.');
} finally {await rm(root,{recursive:true,force:true});}
