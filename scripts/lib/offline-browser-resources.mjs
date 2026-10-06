import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const manifestURL=new URL('../fixtures/offline-resource-manifest.json',import.meta.url);
export async function installOfflineResources(context,appURL,{failedURLs=[],expectedLocal404=[]}={}){
 assert.equal(typeof context.newPage,'function','Install the gate on a browser context before creating pages');
 assert.equal(context.pages().length,0,'The context gate must precede every page and navigation');
 const manifest=JSON.parse(await readFile(manifestURL,'utf8'));
 const key=(url,method,type)=>JSON.stringify([url,method,type]);
 const allowed=new Map(manifest.resources.map(r=>[key(r.url,r.method,r.resourceType),Object.freeze(r)]));
 assert.equal(allowed.size,manifest.resources.length,'Frozen manifest must not contain duplicate request keys');
 const failures=new Set(failedURLs);for(const url of failures)assert(allowed.has(key(url,'GET','image')),'Failure control must be in frozen manifest: '+url);
 const localOrigin=new URL(appURL).origin,local404=new Set(expectedLocal404.map(p=>new URL(p,appURL).href));
 const evidence={manifestSourceHead:manifest.sourceHead,requests:[],unknown:[],console:[],pageErrors:[],responses:[]};
 context.on('console',m=>{if(m.type()==='error')evidence.console.push({text:m.text(),url:m.location().url||null,pageURL:m.page()?.url()||null});});
 context.on('weberror',e=>evidence.pageErrors.push(e.error().message));
 context.on('response',r=>{if(r.status()>=400)evidence.responses.push({url:r.url(),status:r.status()});});
 await context.route('**/*',async route=>{
  const request=route.request(),row={url:request.url(),method:request.method(),resourceType:request.resourceType()};
  if(new URL(row.url).origin===localOrigin){evidence.requests.push({...row,action:'local server'});return route.continue();}
  const resource=allowed.get(key(row.url,row.method,row.resourceType));
  if(!resource){evidence.unknown.push(row);evidence.requests.push({...row,action:'fatal unknown; blocked before transmission'});return route.abort('blockedbyclient');}
  const failed=failures.has(row.url);evidence.requests.push({...row,action:failed?'controlled 503':'frozen local fixture',status:failed?503:200,category:resource.category});
  return route.fulfill({status:failed?503:200,contentType:failed?'text/plain':resource.fixture.endsWith('.png')?'image/png':'image/jpeg',body:failed?'Controlled unavailable resource':await readFile(new URL(resource.fixture,new URL('../fixtures/',import.meta.url)))});
 });
 return {evidence,manifest,assertClean(){
  assert.deepEqual(evidence.unknown,[],'Unknown external request is fatal; no automatic manifest expansion');
  assert.deepEqual(evidence.pageErrors,[],'Unexpected browser script error');
  for(const response of evidence.responses)assert((response.status===503&&failures.has(response.url))||(response.status===404&&local404.has(response.url)),'Unexpected error response: '+JSON.stringify(response));
  for(const error of evidence.console){
   const status=failures.has(error.url)?503:local404.has(error.url)?404:null;
   assert(status&&new RegExp('\\b'+status+'\\b').test(error.text),'Unexpected console error: '+JSON.stringify(error));
  }
  for(const response of evidence.responses)assert(evidence.console.some(e=>e.url===response.url&&e.text.includes(String(response.status))),'Controlled error must be attributed to its exact URL/status');
 }};
}
