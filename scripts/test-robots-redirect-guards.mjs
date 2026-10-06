import assert from 'node:assert/strict';
import {copyFile,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const root=await mkdtemp(join(tmpdir(),'halifax-robots-redirect-'));
try {
  await mkdir(join(root,'scripts','lib'),{recursive:true});await mkdir(join(root,'data','build'),{recursive:true});
  for(const file of ['scripts/verify-official-source-pages.mjs','scripts/import-structured-events.mjs','scripts/lib/fetch-public-source.mjs','source-integrity.js'])await copyFile(new URL('../'+file,import.meta.url),join(root,file));
  const venue={id:'fixture',name:'Fixture Local',website:'https://fixture.example/menu'};
  await writeFile(join(root,'data','restaurants.js'),`window.HALIFAX_RESTAURANTS = ${JSON.stringify([venue])};`);
  await writeFile(join(root,'data','osm-restaurants.js'),'window.HALIFAX_OSM_RESTAURANTS = [];');
  await writeFile(join(root,'data','build','official-site-signals.json'),JSON.stringify({results:[{restaurantId:venue.id,name:venue.name,website:venue.website,signalMatches:{events:['event']},candidateLinks:[{href:venue.website,text:'Menu',signalMatches:{menu:['menu']}}]}]}));
  for(const script of ['verify-official-source-pages.mjs','import-structured-events.mjs']) {
    const log=join(root,script+'.requests.json');
    await writeFile(join(root,'runner.mjs'),`import {writeFile} from 'node:fs/promises';const requests=[];globalThis.fetch=async(input)=>{const url=String(input);requests.push(url);if(url!=='https://fixture.example/robots.txt')throw new Error('network-disabled:'+url);return new Response(null,{status:302,headers:{location:'https://glitterbeancafe.com./robots.txt'}});};try{await import(${JSON.stringify(pathToFileURL(join(root,'scripts',script)).href)});}finally{await writeFile(${JSON.stringify(log)},JSON.stringify(requests));}`);
    const result=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(root,'runner.mjs')],{cwd:root,env:{...process.env,SOURCE_VERIFY_DELAY_MS:'0',STRUCTURED_EVENT_DELAY_MS:'0'},stdio:['ignore','pipe','pipe']});let error='';child.stderr.on('data',chunk=>error+=chunk);child.stdout.resume();child.on('error',reject);child.on('close',code=>resolve({code,error}));});
    assert.equal(result.code,0,script+': '+result.error);
    assert.deepEqual(JSON.parse(await readFile(log,'utf8')),['https://fixture.example/robots.txt']);
    const outputName=script.startsWith('verify-')?'verified-source-pages':'structured-events';
    const output=JSON.parse(await readFile(join(root,'data','build',outputName+'.json'),'utf8'));
    assert.equal(output.failures[0].reason,'robots_disallow');
  }
  console.log('Robots redirect guards passed offline: verifier/event importer reject dotted quarantined redirect before destination or page request.');
} finally {await rm(root,{recursive:true,force:true});}
