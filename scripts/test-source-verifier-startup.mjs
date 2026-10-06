import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = await mkdtemp(join(tmpdir(), 'halifax-source-startup-'));
try {
  await mkdir(join(root,'scripts','lib'),{recursive:true});
  await mkdir(join(root,'data','build'),{recursive:true});
  for (const file of ['scripts/verify-official-source-pages.mjs','scripts/lib/fetch-public-source.mjs','source-integrity.js']) {
    await copyFile(new URL('../'+file,import.meta.url),join(root,file));
  }
  const venue={id:'fixture-local',name:'Fixture Local',website:'https://fixture.example/',address:'1537 Barrington Street, Halifax'};
  await writeFile(join(root,'data','restaurants.js'),`window.HALIFAX_RESTAURANTS = ${JSON.stringify([venue])};\n`);
  await writeFile(join(root,'data','osm-restaurants.js'),'window.HALIFAX_OSM_RESTAURANTS = [];\n');
  await writeFile(join(root,'data','build','official-site-signals.json'),JSON.stringify({results:[{restaurantId:venue.id,name:venue.name,website:venue.website,observedAt:'2026-10-06T00:00:00Z',candidateLinks:[
    {href:'https://fixture.example/menu',text:'Menu',signalMatches:{menu:['menu']}},
    {href:'https://justitalymentone.com/menu',text:'Unsafe menu',signalMatches:{menu:['menu']}},
    {href:'file:///untrusted/catalog.js',text:'Untrusted file',signalMatches:{menu:['menu']}}
  ]}]}));
  const networkLog=join(root,'network-log.json');
  await writeFile(join(root,'runner.mjs'),`
    import {writeFile} from 'node:fs/promises';
    const requests=[];
    globalThis.fetch=async (input,options)=>{
      const url=String(input);requests.push(url);
      if(!url.startsWith('https://fixture.example/'))throw new Error('network-disabled:'+url);
      if(url.endsWith('/robots.txt'))return new Response('User-agent: *\\nDisallow: /private\\n');
      if(url.endsWith('/menu'))return new Response('<html><h1>Fixture Local menu</h1></html>',{headers:{'content-type':'text/html'}});
      throw new Error('network-disabled:'+url);
    };
    try {await import(${JSON.stringify(pathToFileURL(join(root,'scripts','verify-official-source-pages.mjs')).href)});}
    finally {await writeFile(${JSON.stringify(networkLog)},JSON.stringify(requests));}
  `);
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[join(root,'runner.mjs')],{cwd:root,env:{...process.env,SOURCE_VERIFY_DELAY_MS:'0'},stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
    child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));
  });
  const requests=JSON.parse(await readFile(networkLog,'utf8'));
  assert.equal(result.code,0,`Collector startup failed. Requests=${JSON.stringify(requests)}\n${result.stderr}`);
  const output=JSON.parse(await readFile(join(root,'data','build','verified-source-pages.json'),'utf8'));
  assert.equal(output.menuSources.length,1);
  assert.equal(output.menuSources[0].restaurantId,venue.id);
  assert.deepEqual(requests,['https://fixture.example/robots.txt','https://fixture.example/menu']);
  assert.equal(output.failures.length,1);
  assert.equal(output.failures[0].reason,'quarantined_identity_or_location');
  console.log('Verifier startup passed: trusted local catalogs load, remote fetch is stubbed, unsafe/file URLs never fetched.');
} finally { await rm(root,{recursive:true,force:true}); }
