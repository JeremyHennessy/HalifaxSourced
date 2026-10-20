import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {installOfflineResources} from './lib/offline-browser-resources.mjs';
function fakePage(){return {newPage(){},pages(){return [];},on(){},async route(pattern,handler){assert.equal(pattern,'**/*');this.handler=handler;}};}
const first=JSON.parse(await readFile(new URL('./fixtures/offline-resource-manifest.json',import.meta.url),'utf8')).resources[0];
const reviewedTile = 'https://c.tile.openstreetmap.org/15/10598/11829.png';
for(const mismatch of [{url:'https://unknown.example/unreviewed.jpg',method:'GET',resourceType:'image'},{url:first.url,method:'POST',resourceType:'image'},{url:first.url,method:'GET',resourceType:'fetch'},{url:reviewedTile+'?unreviewed=1',method:'GET',resourceType:'image'}]){
 const page=fakePage(),gate=await installOfflineResources(page,'http://127.0.0.1:5173');let action;
 await page.handler({request:()=>({url:()=>mismatch.url,method:()=>mismatch.method,resourceType:()=>mismatch.resourceType}),abort:async reason=>{action=reason;},continue:async()=>{throw Error('Must not continue unknown request');},fulfill:async()=>{throw Error('Must not fulfill unknown request');}});
 assert.equal(action,'blockedbyclient');assert.deepEqual(gate.evidence.unknown,[mismatch]);assert.throws(()=>gate.assertClean(),/Unknown external request is fatal/);
}
{
 const page=fakePage(),gate=await installOfflineResources(page,'http://127.0.0.1:5173');let response;
 const row=gate.manifest.resources.find(item=>item.url===reviewedTile);
 assert.equal(row.category,'map-tile');assert(row.declarationBasis.includes('118808984411'));
 await page.handler({request:()=>({url:()=>reviewedTile,method:()=> 'GET',resourceType:()=> 'image'}),abort:async()=>{throw Error('Reviewed tile fixture must resolve');},continue:async()=>{throw Error('No external tile request is permitted');},fulfill:async value=>{response=value;}});
 assert.equal(response.status,200);assert.equal(response.contentType,'image/png');assert(response.body.length>20);gate.assertClean();
}
for(const file of ['verify-ui.mjs','test-feed-image-controls.mjs','test-offer-rendering-fixed-clock.mjs','test-map-tile-controls.mjs']){
 const text=await readFile(new URL(file,import.meta.url),'utf8');assert(!/(?:page|context|browserContext)\.route\(/.test(text),file+' must use the single gate');assert(!text.includes('controlFeedImages'),file+' must not add model-derived routes');
}
console.log('Frozen gate rejects unknown URL, wrong method, wrong resource type and prevents later feed route bypass.');
