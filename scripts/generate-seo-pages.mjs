import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { mediaPermitted } from './lib/media-rights-contract.mjs';

const BASE = 'https://halifaxsourced.com';
const esc = s => String(s ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const json = x => JSON.stringify(x).replaceAll('<','\\u003c').replaceAll('>','\\u003e').replaceAll('&','\\u0026');
const clean = (x,n=220) => String(x ?? '').replace(/\s+/g,' ').trim().slice(0,n);
const url = x => {try{const u=new URL(x);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
const slug = x => clean(x).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,62)||'local';
const hash = x => createHash('sha256').update(String(x)).digest('hex').slice(0,8);
const validDate = x => {const d=typeof x==='string'&&/^\d{4}-\d\d-\d\dT/.test(x)?new Date(x):null;return d&&Number.isFinite(+d)?d:null;};
const style = 'body{margin:0;font:16px/1.6 system-ui;color:#18364e;background:#f4f8fa}a{color:#075b77}.head{background:#062b50;color:white;padding:20px}.head a{color:white}.head img{width:42px;vertical-align:middle}.wrap{max-width:980px;margin:auto;padding:20px}.panel{background:white;border-radius:14px;padding:24px}h1{color:#062b50}.details{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.details div{padding:12px;background:#f2f7f8}.details strong{display:block}.actions a{display:inline-block;margin:8px;padding:10px;background:#0b3a67;color:white}.photo img{max-width:100%;height:auto}.note,figcaption{font-size:.9rem;color:#526579}';
function html(title,description,canonical,body,schema,image=null,alt=null){
 const head='<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title+' | Halifax Sourced')+'</title><meta name="description" content="'+esc(description)+'"><meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="'+esc(canonical)+'"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><meta property="og:site_name" content="Halifax Sourced"><meta property="og:type" content="website"><meta property="og:title" content="'+esc(title)+'"><meta property="og:description" content="'+esc(description)+'"><meta property="og:url" content="'+esc(canonical)+'"><meta property="og:image" content="'+esc(image||BASE+'/assets/brand/app-icon.webp')+'"><meta property="og:image:alt" content="'+esc(alt||'Halifax Sourced')+'"><meta name="twitter:card" content="'+(image?'summary_large_image':'summary')+'"><script type="application/ld+json">'+json(schema)+'</script><style>'+style+'</style>';
 return '<!doctype html>\n<html lang="en-CA"><head>'+head+'</head><body><header class="head"><a href="/"><img src="/assets/brand/logo-emblem.webp" alt="">Halifax Sourced</a></header><main class="wrap"><article class="panel">'+body+'</article></main></body></html>\n';
}
async function put(site,p,s){const file=join(site,p);await mkdir(dirname(file),{recursive:true});await writeFile(file,s);}
function eligible(r){return r&&r.id&&r.name&&r.address&&['active','listed_current'].includes(r.operatingStatus)&&Array.isArray(r.sources)&&r.sources.some(s=>s.status==='verified'&&url(s.url))&&(url(r.website)||r.phone||(r.menuLinks||[]).some(x=>url(x.url)));}
function eligibleEvent(e,now){const d=validDate(e?.startAt),end=validDate(e?.endAt);return d&&d>now&&d<=new Date(+now+90*86400000)&&(!end||(end>=d&&end-d<=86400000))&&clean(e.title)&&clean(e.venueName)&&clean(e.address)&&url(e.eventUrl||e.sourceUrl)&&['source-observed','verified','approved'].includes(e.reviewState)&&!/(cancel|postpon|hold|draft|tentative)/i.test(e.status||'')&&/halifax|dartmouth|bedford|sackville/i.test(String(e.city||'')+' '+String(e.address||''));}
function listing(title,desc,canonical,rows){const body='<h1>'+esc(title)+'</h1><p>'+esc(desc)+'</p><ul>'+rows.map(r=>'<li><a href="'+esc(r.url)+'">'+esc(r.name)+'</a>'+(r.note?' — '+esc(r.note):'')+'</li>').join('')+'</ul><p class="note">Verify details with the venue or organizer before visiting.</p>';return html(title,desc,canonical,body,{'@context':'https://schema.org','@type':'CollectionPage',name:title,url:canonical});}

export async function generateSeoPages({sourceDir,siteDir,now=new Date(),maxRestaurants=30,maxEvents=20,permission=mediaPermitted}){
 const catalog=JSON.parse(await readFile(join(sourceDir,'data/build/catalog.json'),'utf8'));
 const city=JSON.parse(await readFile(join(sourceDir,'data/build/city-events.json'),'utf8'));
 const raw=(await readFile(join(sourceDir,'data/restaurant-media.js'),'utf8')).trimStart();
 const prefix='window.HALIFAX_RESTAURANT_MEDIA = ';
 if(!raw.startsWith(prefix))throw Error('Invalid media manifest');
 const media=JSON.parse(raw.slice(prefix.length).replace(/;\s*$/,'')).records;
 if(!Array.isArray(catalog.restaurants)||!Array.isArray(city.events)||!Array.isArray(media)||!Number.isFinite(+now))throw Error('Invalid SEO inputs');
 const entries=[BASE+'/'],images=[],restRows=[],eventRows=[];
 const approved=id=>media.some(m=>m.restaurantId===id&&permission(m));
 const restaurants=catalog.restaurants.filter(r=>eligible(r)&&(['curated','local_discovery','reviewed_location_correction'].includes(r.sourceLayer)||approved(r.id))).sort((a,b)=>Number(b.sourceLayer==='curated')-Number(a.sourceLayer==='curated')||Number(approved(b.id))-Number(approved(a.id))||(Number(b.qualityScore)||0)-(Number(a.qualityScore)||0)||String(a.id).localeCompare(String(b.id))).slice(0,maxRestaurants);
 const seen=new Set();
 for(const r of restaurants){
  if(seen.has(r.id))throw Error('Duplicate restaurant SEO ID');seen.add(r.id);
  const path='restaurants/'+slug(r.name)+'-'+hash(r.id)+'/',canonical=BASE+'/'+path;
  const summary=/captured from OpenStreetMap|needs cross.reference|unverified/i.test(r.summary||'')?'':r.summary;
  const desc=clean(summary||('Find '+r.name+' in '+(r.neighborhood||'Halifax')+', Nova Scotia, with published restaurant details and source links.'),190);
  let photo=null;
  for(const m of media){if(m.restaurantId!==r.id||!permission(m)||!/^assets\/restaurants\/[a-zA-Z0-9._-]+\.(jpg|jpeg|png|webp)$/.test(m.url||''))continue;try{if(!(await stat(join(sourceDir,m.url))).isFile())continue;}catch{continue;}photo=m;break;}
  const image=photo?BASE+'/'+photo.url:null;
  const schema={'@context':'https://schema.org','@type':'Restaurant',name:r.name,url:canonical,address:clean(r.address)};
  if(r.phone)schema.telephone=clean(r.phone,45);
  if(r.cuisines?.length)schema.servesCuisine=r.cuisines.slice(0,5).map(x=>clean(x,60));
  if(image)schema.image=image;
  const details=[['Address',r.address],['Phone',r.phone],['Hours (as listed)',r.openingHours]].filter(x=>clean(x[1]));
  const menu=(r.menuLinks||[]).map(x=>url(x.url)).find(Boolean);
  const actions=[['Open in Halifax Sourced',BASE+'/#restaurant/'+encodeURIComponent(r.id)],['Restaurant website',url(r.website)],['Menu',menu]].filter(x=>x[1]);
  const sources=r.sources.filter(x=>x.status==='verified'&&url(x.url)).slice(0,5);
  const figure=photo?'<figure class="photo"><img src="'+esc(image)+'" alt="'+esc(photo.alt)+'"><figcaption>'+esc(photo.attribution||photo.creator+', '+photo.license)+' · <a href="'+esc(url(photo.sourceUrl))+'">Image source</a></figcaption></figure>':'';
  const body='<p class="tag">'+esc(r.neighborhood||'Halifax')+' · Restaurant</p><h1>'+esc(r.name)+'</h1><p>'+esc(desc)+'</p>'+figure+'<div class="details">'+details.map(x=>'<div><strong>'+esc(x[0])+'</strong>'+esc(clean(x[1]))+'</div>').join('')+'</div><nav class="actions">'+actions.map(x=>'<a href="'+esc(x[1])+'">'+esc(x[0])+'</a>').join('')+'</nav><h2>Sources</h2><ul>'+sources.map(x=>'<li><a href="'+esc(url(x.url))+'">'+esc(clean(x.label||'Source'))+'</a></li>').join('')+'</ul><p class="note">Published details may change. Confirm hours and availability with the venue.</p>';
  await put(siteDir,path+'index.html',html(r.name+' — '+(r.neighborhood||'Halifax'),desc,canonical,body,schema,image,photo?.alt));
  entries.push(canonical);restRows.push({url:canonical,name:r.name,note:r.neighborhood||'Halifax',neighborhood:r.neighborhood||'Halifax'});if(image)images.push({page:canonical,image});
 }
 const events=city.events.filter(e=>eligibleEvent(e,now)).sort((a,b)=>String(a.startAt).localeCompare(String(b.startAt))||String(a.id).localeCompare(String(b.id))).slice(0,maxEvents);
 const eventSeen=new Set();
 for(const e of events){const id=String(e.id||e.title+e.startAt+e.venueName);if(eventSeen.has(id))throw Error('Duplicate event SEO ID');eventSeen.add(id);
  const path='events/'+slug(e.title)+'-'+e.startAt.slice(0,10)+'-'+hash(id)+'/',canonical=BASE+'/'+path;
  const date=new Date(e.startAt),dateText=date.toLocaleString('en-CA',{dateStyle:'full',timeStyle:'short',timeZone:'America/Halifax'});
  const desc=clean(e.title+' at '+e.venueName+', '+e.address+'. '+dateText+'.',190);
  const schema={'@context':'https://schema.org','@type':'Event',name:e.title,url:canonical,startDate:e.startAt,location:{'@type':'Place',name:e.venueName,address:clean(e.address)}};
  const end=validDate(e.endAt);if(end&&end>date)schema.endDate=e.endAt;
  const body='<p class="tag">Halifax-area event</p><h1>'+esc(e.title)+'</h1><p>'+esc(desc)+'</p><div class="details"><div><strong>Date</strong>'+esc(dateText)+'</div><div><strong>Venue</strong>'+esc(e.venueName)+'</div><div><strong>Address</strong>'+esc(e.address)+'</div></div><nav class="actions"><a href="'+esc(url(e.eventUrl||e.sourceUrl))+'">Original event source</a><a href="'+BASE+'/#events">Explore events</a></nav><p class="note">This page describes one dated occurrence. Check the original source for updates or cancellations.</p>';
  await put(siteDir,path+'index.html',html(e.title+' — '+dateText,desc,canonical,body,schema));entries.push(canonical);eventRows.push({url:canonical,name:e.title,note:e.venueName});
 }
 for(const [name,rows,desc] of [['restaurants',restRows,'Source-backed independent restaurants across Halifax Regional Municipality.'],['events',eventRows,'Dated Halifax-area events from published local sources.']]){await put(siteDir,name+'/index.html',listing(name==='events'?'Halifax events':'Halifax restaurants',desc,BASE+'/'+name+'/',rows));entries.push(BASE+'/'+name+'/');}
 const groups=new Map();for(const r of restRows){if(!groups.has(r.neighborhood))groups.set(r.neighborhood,[]);groups.get(r.neighborhood).push(r);}
 for(const [name,rows] of [...groups].filter(x=>x[1].length>=3).sort((a,b)=>b[1].length-a[1].length||a[0].localeCompare(b[0])).slice(0,2)){const path='neighbourhoods/'+slug(name)+'/',canonical=BASE+'/'+path;await put(siteDir,path+'index.html',listing(name+' restaurants','Source-backed independent restaurants listed in '+name+', Halifax Regional Municipality.',canonical,rows));entries.push(canonical);}
 const xmlHead='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
 await put(siteDir,'sitemap.xml',xmlHead+entries.map(x=>'<url><loc>'+esc(x)+'</loc></url>').join('\n')+'\n</urlset>\n');
 await put(siteDir,'sitemap-images.xml','<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n'+images.map(x=>'<url><loc>'+esc(x.page)+'</loc><image:image><image:loc>'+esc(x.image)+'</image:loc></image:image></url>').join('\n')+'\n</urlset>\n');
 await put(siteDir,'robots.txt','User-agent: *\nAllow: /\nSitemap: '+BASE+'/sitemap.xml\nSitemap: '+BASE+'/sitemap-images.xml\n');
 return {restaurants:restaurants.length,events:events.length,images:images.length,urls:entries.length};
}
