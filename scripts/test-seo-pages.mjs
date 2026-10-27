import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { generateSeoPages } from './generate-seo-pages.mjs';

const base=await mkdtemp(join(tmpdir(),'halifax-seo-'));
const sourceDir=join(base,'source'),siteDir=join(base,'site');
async function put(p,value){const dest=join(sourceDir,p);await mkdir(dirname(dest),{recursive:true});await writeFile(dest,value);}
try{
 const manifest=await readFile(new URL('../data/restaurant-media.js',import.meta.url),'utf8');
 const records=JSON.parse(manifest.trimStart().replace(/^window\.HALIFAX_RESTAURANT_MEDIA = /,'').replace(/;\s*$/,'')).records;
 const approved=records.find(x=>x.permissionConfirmed&&x.reviewState==='approved');
 assert.ok(approved,'Expected an approved fixture');
 await put('data/restaurant-media.js',manifest);
 await put(approved.url,'fixture media bytes');
 const sources=[{label:'Owner site',status:'verified',url:'https://example.org/'}];
 await put('data/build/catalog.json',JSON.stringify({restaurants:[
  {id:approved.restaurantId,name:'Photo venue',address:'12 Main Street, Halifax, NS B3J 1A1',operatingStatus:'active',sourceLayer:'openstreetmap',website:'https://example.org/',sources,summary:'Captured from OpenStreetMap. Needs cross-reference.'},
  {id:'safe',name:'Safe <script>alert(1)</script> Cafe',address:'15 Queen Street, Halifax',operatingStatus:'listed_current',sourceLayer:'local_discovery',website:'https://example.org/',sources,summary:'A local café with published venue details.'},
  {id:'closed',name:'Closed venue',address:'1 Main Street, Halifax',operatingStatus:'seasonally_closed',sourceLayer:'curated',website:'https://example.org/',sources},
  {id:'held',name:'Held venue',address:'1 Main Street, Halifax',operatingStatus:'active',sourceLayer:'openstreetmap',website:'https://example.org/',sources:[{status:'unverified',url:'https://example.org/'}]}
 ]}));
 await put('data/build/city-events.json',JSON.stringify({events:[
  {id:'good',title:'Local concert',startAt:'2026-11-01T23:00:00.000Z',endAt:'2026-11-02T01:00:00.000Z',venueName:'Town Hall',address:'Halifax, NS',city:'Halifax',reviewState:'source-observed',eventUrl:'https://example.org/event'},
  {id:'past',title:'Past concert',startAt:'2026-10-01T23:00:00.000Z',venueName:'Town Hall',address:'Halifax, NS',reviewState:'source-observed',eventUrl:'https://example.org/event'},
  {id:'series',title:'Long-running series',startAt:'2026-11-01T23:00:00.000Z',endAt:'2026-12-01T23:00:00.000Z',venueName:'Town Hall',address:'Halifax, NS',reviewState:'source-observed',eventUrl:'https://example.org/event'},
  {id:'cancelled',title:'Cancelled event',startAt:'2026-11-01T23:00:00.000Z',venueName:'Town Hall',address:'Halifax, NS',reviewState:'source-observed',status:'cancelled',eventUrl:'https://example.org/event'}
 ]}));
 const result=await generateSeoPages({sourceDir,siteDir,now:new Date('2026-10-27T01:00:00Z')});
 assert.deepEqual(result,{restaurants:2,events:1,images:1,urls:6});
 const sitemap=await readFile(join(siteDir,'sitemap.xml'),'utf8');
 assert.equal((sitemap.match(/<url>/g)||[]).length,6);
 assert.ok(!sitemap.includes('closed-venue')&&!sitemap.includes('held-venue'));
 const images=await readFile(join(siteDir,'sitemap-images.xml'),'utf8');
 assert.equal((images.match(/<image:image>/g)||[]).length,1);
 const robots=await readFile(join(siteDir,'robots.txt'),'utf8');
 assert.ok(robots.includes('Sitemap: https://halifaxsourced.com/sitemap.xml'));
 const pages=[];
 for(const match of sitemap.matchAll(/<loc>https:\/\/halifaxsourced\.com\/(restaurants|events)\/([^<]+)<\/loc>/g))pages.push(join(siteDir,match[1],match[2],'index.html'));
 assert.equal(pages.length,3);
 const htmls=await Promise.all(pages.map(p=>readFile(p,'utf8')));
 assert.ok(htmls.some(h=>h.includes('"@type":"Event"')));
 assert.ok(htmls.some(h=>h.includes('"@type":"Restaurant"')));
 assert.ok(htmls.every(h=>h.includes('rel="canonical"')));
 assert.ok(htmls.every(h=>!h.includes('<script>alert(1)</script>')));
 assert.ok(htmls.some(h=>h.includes('Safe &lt;script&gt;alert(1)&lt;/script&gt; Cafe')));
 assert.ok(htmls.every(h=>!h.includes('Needs cross-reference')&&!h.includes('Past concert')));
 assert.ok(htmls.some(h=>h.includes('Image source')));
 const graph=htmls.map(h=>JSON.parse(h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1]||'null'));
 assert.ok(graph.every(g=>g?.['@graph']?.some(x=>x['@type']==='BreadcrumbList')),'Every detail page must include breadcrumbs');
 assert.ok(graph.every(g=>g['@graph'].find(x=>x['@type']==='BreadcrumbList').itemListElement.at(-1).item.startsWith('https://halifaxsourced.com/')),'Breadcrumb links must remain local');
 assert.ok(graph.some(g=>g['@graph'].some(x=>x['@type']==='Restaurant'&&x.address?.['@type']==='PostalAddress'&&x.address.postalCode==='B3J 1A1')),'Use structured address only for fully labelled evidence');
 assert.ok(graph.some(g=>g['@graph'].some(x=>x['@type']==='Restaurant'&&typeof x.address==='string')),'Keep ambiguous addresses as strings');

 console.log('SEO regression passed: approved media, 2 restaurants, 1 dated event, 2 hubs, escaped metadata, excluded holds and sitemap.');
}finally{await rm(base,{recursive:true,force:true});}
