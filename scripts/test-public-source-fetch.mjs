import assert from 'node:assert/strict';
import {fetchPublicSource} from './lib/fetch-public-source.mjs';
const original=globalThis.fetch,requests=[],robots=[];
try {
  globalThis.fetch=async (url,options)=>{requests.push(url);assert.equal(options.redirect,'manual');return new Response(null,{status:301,headers:{location:'https://justitalymentone.com/'}});};
  await assert.rejects(fetchPublicSource('https://local.example/contact',{},async url=>{robots.push(url);return true;}),/quarantined/);
  assert.deepEqual(requests,['https://local.example/contact']);
  requests.length=0;
  await assert.rejects(fetchPublicSource('https://bowtiecreamery.com/',{},async()=>true),/quarantined/);
  assert.equal(requests.length,0);
  globalThis.fetch=async url=>{requests.push(url);return requests.length===1?new Response(null,{status:301,headers:{location:'/contact/'}}):new Response('safe');};
  assert.equal((await fetchPublicSource('https://local.example/contact',{},async()=>true)).status,200);
  requests.length=0;
  await assert.rejects(fetchPublicSource('https://local.example/private',{},async()=>false),/robots_disallow/);
  assert.equal(requests.length,0);
  const controller = new AbortController();
  controller.abort(new DOMException('Already expired', 'TimeoutError'));
  await assert.rejects(fetchPublicSource('https://local.example/',{signal:controller.signal},async()=>true),/Already expired/);
  assert.equal(requests.length,0,'Aborted request never reaches transport');
  const waitingPolicy = new AbortController();
  await assert.rejects(fetchPublicSource('https://local.example/',{signal:waitingPolicy.signal},async()=>{waitingPolicy.abort(new Error('expired policy'));return true;}),/expired policy/);
  assert.equal(requests.length,0,'Policy approval cannot revive an expired operation');
  const waitingFetch = new AbortController();
  globalThis.fetch=async url=>{requests.push(url);waitingFetch.abort(new Error('expired fetch'));return new Response(null,{status:302,headers:{location:'/late'}});};
  await assert.rejects(fetchPublicSource('https://local.example/',{signal:waitingFetch.signal},async()=>true),/expired fetch/);
  assert.deepEqual(requests,['https://local.example/'],'An abort-ignoring response cannot admit another hop');
} finally {globalThis.fetch=original;}
console.log('Public fetch regression passed: cross-entity redirect never fetched, same-host redirects bounded, robots honoured.');
