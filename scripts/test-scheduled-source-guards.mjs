import assert from 'node:assert/strict';
import {copyFile,mkdir,mkdtemp,readFile,rm,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const root=await mkdtemp(join(tmpdir(),'halifax-scheduled-guard-'));
try {
  await mkdir(join(root,'scripts','lib'),{recursive:true});await mkdir(join(root,'data','build'),{recursive:true});
  for(const file of ['scripts/check-source-links.mjs','scripts/build-thumbnail-candidates.mjs','scripts/lib/fetch-public-source.mjs','scripts/lib/lifecycle-language.mjs','scripts/lib/media-rights-contract.mjs','scripts/lib/reviewed-corrections.mjs','restaurant-corrections.js','app-media.js','source-integrity.js'])await copyFile(new URL('../'+file,import.meta.url),join(root,file));
  await writeFile(join(root,'data/reviewed-restaurant-corrections.js'),'window.HALIFAX_RESTAURANT_CORRECTIONS={records:[],aliases:[],additions:[]};');
  await writeFile(join(root,'data/reviewed-place-resolutions.js'),'window.HALIFAX_REVIEWED_PLACE_RESOLUTIONS={records:[{restaurantId:"redirect",menuUrl:"https://fixture.example/reviewed-menu"}]};');
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
    if(script==='check-source-links.mjs') assert(fetched.includes('https://fixture.example/reviewed-menu'),'Reviewed menu must exercise the same quarantine/redirect guard');
  }
  // Reproduce Node exit 13 with unreferenced/hung fetch or body promises.
  // The real collector must finish every attempted URL as inconclusive and
  // release a domain's queue for its next URL, never manufacture a success.
  const deadlineVenues = ['fetch', 'read', 'cancel', 'ok'].map(kind => ({id:kind,name:kind,website:`https://${kind}.fixture.example/`}));
  deadlineVenues.push({id:'tail',name:'Same-domain tail',website:'https://read.fixture.example/healthy'});
  await writeFile(join(root,'data/build/catalog.json'),JSON.stringify({restaurants:deadlineVenues}));
  await writeFile(join(root,'deadline-runner.mjs'),`globalThis.fetch=async input=>{
    const url=String(input);
    if(url.includes('/healthy')||url.includes('ok.fixture'))return new Response('<html>Open normally.</html>',{headers:{'content-type':'text/html'}});
    if(url.includes('fetch.fixture'))return new Promise(()=>{});
    if(url.includes('read.fixture'))return {ok:true,status:200,url,headers:new Headers({'content-type':'text/html'}),body:{getReader:()=>({read:()=>new Promise(()=>{}),cancel:async()=>{}})}};
    if(url.includes('cancel.fixture'))return {ok:true,status:200,url,headers:new Headers({'content-type':'application/pdf'}),body:{cancel:()=>new Promise(()=>{})}};
    throw new Error('network-disabled:'+url);
  };await import(${JSON.stringify(pathToFileURL(join(root,'scripts/check-source-links.mjs')).href)});`);
  const deadlineResult=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[join(root,'deadline-runner.mjs')],{cwd:root,env:{...process.env,LINK_HEALTH_SCOPE:'release',LINK_HEALTH_LIMIT:'0',LINK_HEALTH_TIMEOUT_MS:'30',LINK_HEALTH_CONCURRENCY:'5'},stdio:['ignore','pipe','pipe']});
    let error='';child.stderr.on('data',chunk=>error+=chunk);child.stdout.resume();child.on('error',reject);child.on('close',code=>resolve({code,error}));
  });
  assert.equal(deadlineResult.code,0,'Hung source must be classified, not exit 13: '+deadlineResult.error);
  const deadlineReport=JSON.parse(await readFile(join(root,'data/build/source-link-health-report.json')));
  assert.equal(deadlineReport.complete,true);
  assert.equal(deadlineReport.counts.checked,5);
  assert.equal(deadlineReport.counts.transient,3);
  assert.equal(deadlineReport.counts.ok,2);
  assert.equal(deadlineReport.counts.broken,0);
  for(const result of deadlineReport.results.filter(item=>item.state==='transient'))assert.equal(result.error,'timeout');
  console.log('Collector deadline regression passed: hung fetch/read/cancel become explicit timeouts; same-domain tail completes.');
  // Catalogue-source consumers must keep the shared wrapper; API-only imports
  // use fixed endpoints and are outside this source-URL test.
  for(const name of await readdir(new URL('./',import.meta.url))) {
    if(!name.endsWith('.mjs')||name.startsWith('test-')||['import-meta-social.mjs','import-google-places.mjs','import-ns-food-inspections.mjs','import-osm-restaurants.mjs'].includes(name))continue;
    const source=await readFile(new URL(name,import.meta.url),'utf8');
    if(/\bfetch\(/.test(source))assert(source.includes('import { fetchGuardedSource as fetch }'),name+' has an unguarded source request');
  }
  console.log('Scheduled source guards passed offline: link checks and thumbnail discovery never request quarantined URLs or redirect destinations.');
} finally {await rm(root,{recursive:true,force:true});}
