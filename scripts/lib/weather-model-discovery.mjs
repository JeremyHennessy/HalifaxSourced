// Offline-only discovery for the two reviewed distribution paths. No requests,
// guessed cycles, executable website content, alternative hosts, or publication.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {listingAnchorUrls, extractReviewedListing} from './weather-ecmwf-adapter.mjs';
import {digest} from './weather-aggregation.mjs';

const HOUR = 3600000;
const GFS_ROOT = 'https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl';
const IFS_ROOT = 'https://data.ecmwf.int/forecasts/';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const GFS_FIXED_PARAMETERS = Object.freeze({lev_2_m_above_ground:'on',var_TMP:'on',subregion:'',leftlon:'-63.75',rightlon:'-63.5',toplat:'44.75',bottomlat:'44.5'});
export const REFRESH_SOURCE_CONTRACTS = Object.freeze({
  noaa: Object.freeze({sourceId:'noaa',modelId:'gfs',rootUrl:GFS_ROOT,robotsUrl:'https://nomads.ncep.noaa.gov/robots.txt',listingByteLimit:256*1024,indexByteLimit:0,fieldByteLimit:1024*1024,maxListingPages:4,maxReferenceAgeHours:18,maxLeadHours:48,minRequestSpacingMs:10000}),
  ecmwf: Object.freeze({sourceId:'ecmwf',modelId:'ecmwf_ifs',rootUrl:IFS_ROOT,robotsUrl:'https://data.ecmwf.int/robots.txt',listingByteLimit:1024*1024,indexByteLimit:256*1024,fieldByteLimit:4*1024*1024,maxListingPages:6,maxReferenceAgeHours:24,maxLeadHours:48,minRequestSpacingMs:10000})
});
const clock = value => {
  assert.equal(typeof value,'string','clock required');
  assert.match(value,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/,'explicit UTC clock required');
  const n=Date.parse(value);assert.ok(Number.isFinite(n));
  assert.equal(new Date(n).toISOString(),value.replace(/Z$/,value.includes('.')?'Z':'.000Z'),'invalid calendar clock');
  return n;
};
const canonicalUrl = value => {
  const u=new URL(value);assert.equal(u.href,value,'noncanonical URL');
  assert.equal(u.username,'');assert.equal(u.password,'');assert.equal(u.hash,'');return u;
};
function gfsDirectory(value) {
  const u=canonicalUrl(value);assert.equal(u.origin,'https://nomads.ncep.noaa.gov');assert.equal(u.pathname,'/cgi-bin/filter_gfs_0p25.pl');
  if(!u.search)return '';
  assert.deepEqual([...u.searchParams.keys()],['dir'],'only one explicit directory parameter');
  const dir=u.searchParams.get('dir');assert.match(dir,/^\/gfs\.\d{8}(?:\/(?:00|06|12|18)(?:\/atmos)?)?$/,'unreviewed GFS directory');return dir;
}
function ifsPath(value) {
  const u=canonicalUrl(value);assert.equal(u.origin,'https://data.ecmwf.int');assert.equal(u.search,'');
  assert.match(u.pathname,/^\/forecasts\/(?:\d{8}\/(?:(?:00|06|12|18)z\/(?:ifs\/(?:0p25\/(?:oper\/)?)?)?)?)?$/,'unreviewed IFS listing path');return u.pathname;
}
export function isReviewedListingUrl(sourceId,url) {
  try{if(sourceId==='noaa')gfsDirectory(url);else if(sourceId==='ecmwf')ifsPath(url);else return false;return true;}catch{return false;}
}
function pageBody(page,limit,now) {
  assert.ok(page&&typeof page==='object');assert.equal(page.status,200,'discovery needs complete retained 200 body, not a 304 body');
  const attempted=clock(page.attemptedAt),headers=clock(page.headersReceivedAt),completed=clock(page.completedAt);
  assert.ok(attempted<=headers&&headers<=completed&&completed<=clock(now),'metadata clock order');
  assert.ok(Buffer.isBuffer(page.body)||page.body instanceof Uint8Array,'original metadata bytes required');
  const body=Buffer.from(page.body);assert.ok(body.length>0&&body.length<=limit,'metadata byte budget');
  assert.equal(page.bodyBytes,body.length);assert.equal(page.bodySha256,sha(body),'metadata hash mismatch');
  return new TextDecoder('utf-8',{fatal:true}).decode(body);
}
function reference(date,hour) {
  assert.match(date,/^\d{8}$/);assert.match(hour,/^(00|06|12|18)$/);
  const result=`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6)}T${hour}:00:00.000Z`;clock(result);return result;
}
const unavailable=(sourceId,reason,extra={})=>({kind:'unavailable',sourceId,reason,...extra});
function freshness(sourceId,ref,now) {
  const age=clock(now)-clock(ref),max=REFRESH_SOURCE_CONTRACTS[sourceId].maxReferenceAgeHours*HOUR;
  if(age<0)return 'newest_listed_reference_is_future';
  if(age>=max)return 'newest_listed_reference_is_stale';
  return null;
}
function nextLink(sourceId,page,urls,match,key,now) {
  const candidates=[...new Set(urls)].filter(url=>isReviewedListingUrl(sourceId,url)&&match(url));
  if(!candidates.length)return unavailable(sourceId,'newest_listing_has_no_reviewed_child',{listingUrl:page.url});
  candidates.sort((a,b)=>key(b).localeCompare(key(a)));
  const url=candidates[0],date=key(url).slice(0,8);
  if(clock(reference(date,'00'))>clock(now))return unavailable(sourceId,'newest_listed_date_is_future',{listingUrl:page.url});
  return {kind:'listing',sourceId,url,parentUrl:page.url,parentBodySha256:page.bodySha256};
}

// The actual NOMADS form repeats identical nested <form> starts for each option.
// Treat those as browser-style ignored repeats; a different nested action/method,
// duplicate attribute, or cross-form field borrowing fails closed.
function entity(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi,(all,name)=>{
    if(name[0]==='#'){const n=name[1].toLowerCase()==='x'?parseInt(name.slice(2),16):Number(name.slice(1));assert.ok(n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff));return String.fromCodePoint(n);}
    return {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'}[name.toLowerCase()];
  });
}
function htmlTags(html) {
  const tags=[];let cursor=0;
  while(cursor<html.length){
    const start=html.indexOf('<',cursor);if(start<0)break;
    if(html.startsWith('<!--',start)){const end=html.indexOf('-->',start+4);assert.ok(end>=0,'unterminated comment');cursor=end+3;continue;}
    let end=start+1,quote=null;
    for(;end<html.length;end++){const c=html[end];if(quote){if(c===quote)quote=null;}else if(c==='"'||c==="'")quote=c;else if(c==='>')break;}
    assert.ok(end<html.length,'unterminated markup');const raw=html.slice(start+1,end);cursor=end+1;
    if(raw.startsWith('!')||raw.startsWith('?'))continue;
    const name=raw.match(/^(\/)?([a-z][a-z0-9:-]*)(?=[\s/]|$)/i);assert.ok(name,'malformed HTML tag');
    const closing=Boolean(name[1]),tag=name[2].toLowerCase();
    if(!closing&&['plaintext','template'].includes(tag))throw Error('inert template is not a server listing');
    if(!closing&&['script','style','textarea','title','xmp','iframe','noembed','noframes','noscript'].includes(tag)){
      const close=new RegExp(`<\\/${tag}(?=[\\s>])[^>]*>`,'gi');close.lastIndex=cursor;const match=close.exec(html);assert.ok(match,'unclosed raw-text block');cursor=close.lastIndex;continue;
    }
    const attrs=new Map();let offset=name[0].length;
    while(offset<raw.length){
      while(/\s/.test(raw[offset]??'')&&offset<raw.length)offset++;
      if(offset===raw.length||raw.slice(offset).trim()==='/')break;
      const a=raw.slice(offset).match(/^[^\s=\/"'<>`]+/);assert.ok(a,'malformed attribute');const key=a[0].toLowerCase();assert.ok(!attrs.has(key),'duplicate attribute');offset+=a[0].length;
      while(/\s/.test(raw[offset]??'')&&offset<raw.length)offset++;
      let value=null;
      if(raw[offset]==='='){offset++;while(/\s/.test(raw[offset]??'')&&offset<raw.length)offset++;
        if(raw[offset]==='"'||raw[offset]==="'"){const close=raw.indexOf(raw[offset],offset+1);assert.ok(close>=0);value=raw.slice(offset+1,close);offset=close+1;}
        else{const unquoted=raw.slice(offset).match(/^[^\s"'`=<>]+/);assert.ok(unquoted);value=unquoted[0];offset+=value.length;}
      }
      attrs.set(key,value===null?null:entity(value));
    }
    tags.push({tag,closing,attrs});assert.ok(tags.length<=20000,'HTML token budget');
  }
  return tags;
}
function gfsForm(html,directory) {
  const forms=[];let active=null,select=null;
  for(const{tag,closing,attrs}of htmlTags(html)){
    if(tag==='form'){
      if(closing){active=null;select=null;continue;}
      const action=new URL(attrs.get('action')??'',GFS_ROOT).href,method=(attrs.get('method')??'get').toLowerCase();
      if(active){assert.equal(action,active.action,'conflicting nested form action');assert.equal(method,active.method,'conflicting nested form method');continue;}
      active={action,method,fields:new Map()};forms.push(active);continue;
    }
    if(!active)continue;
    if(tag==='select'){if(closing)select=null;else{assert.equal(select,null,'nested select');select=attrs.get('name');}continue;}
    if(closing)continue;
    let key,value;
    if(tag==='input'){key=attrs.get('name');value=attrs.get('value')??((attrs.get('type')??'').toLowerCase()==='checkbox'?'on':'');}
    else if(tag==='option'&&select){key=select;value=attrs.get('value');}
    if(key&&value!==null&&value!==undefined){if(!active.fields.has(key))active.fields.set(key,[]);active.fields.get(key).push(value);}
  }
  const matching=forms.filter(f=>f.action===GFS_ROOT&&f.method==='get'&&f.fields.get('dir')?.length===1&&f.fields.get('dir')[0]===directory);
  assert.equal(matching.length,1,'one exact complete GFS form required');const fields=matching[0].fields;
  for(const key of Object.keys(GFS_FIXED_PARAMETERS)){assert.equal(fields.get(key)?.length,1,`missing/duplicate reviewed form field ${key}`);}
  assert.equal(fields.get('lev_2_m_above_ground')[0],'on');assert.equal(fields.get('var_TMP')[0],'on');assert.equal(fields.get('subregion')[0],'');
  const files=fields.get('file');assert.ok(files&&files.length>0&&files.length<=1000,'bounded listed file options required');
  assert.equal(new Set(files).size,files.length,'duplicate file options');return files;
}

export function nextGfsListing(page,{now}={}) {
  const dir=gfsDirectory(page.url),html=pageBody(page,REFRESH_SOURCE_CONTRACTS.noaa.listingByteLimit,now);
  const links=listingAnchorUrls(html,page.url);
  if(!dir)return nextLink('noaa',page,links,url=>/^\/gfs\.\d{8}$/.test(gfsDirectory(url)),url=>gfsDirectory(url).slice(5),now);
  if(/^\/gfs\.\d{8}$/.test(dir))return nextLink('noaa',page,links,url=>new RegExp(`^${dir.replace('.','\\.')}/(?:00|06|12|18)$`).test(gfsDirectory(url)),url=>gfsDirectory(url).slice(5).replace('/',''),now);
  if(/^\/gfs\.\d{8}\/(?:00|06|12|18)$/.test(dir))return nextLink('noaa',page,links,url=>gfsDirectory(url)===dir+'/atmos',url=>gfsDirectory(url).slice(5).replaceAll('/',''),now);
  const match=dir.match(/^\/gfs\.(\d{8})\/(00|06|12|18)\/atmos$/),ref=reference(match[1],match[2]);
  const reason=freshness('noaa',ref,now);if(reason)return unavailable('noaa',reason,{modelReferenceTime:ref});
  const files=gfsForm(html,dir),fields=[];
  for(const file of files){
    if(file===`gfs.t${match[2]}z.pgrb2.0p25.anl`)continue;
    const m=file.match(/^gfs\.t(00|06|12|18)z\.pgrb2\.0p25\.f(\d{3})$/);assert.ok(m&&m[1]===match[2],'mismatched listed GFS file');
    const leadHours=Number(m[2]),valid=clock(ref)+leadHours*HOUR;
    if(leadHours<=0||leadHours>48||leadHours%3!==0||valid<=clock(now)||valid>clock(now)+24*HOUR)continue;
    fields.push({sourceId:'noaa',modelId:'gfs',directory:dir,file,modelReferenceTime:ref,validTime:new Date(valid).toISOString(),leadHours,sourceIssuedAt:null,firstAvailableAt:null,listingUrl:page.url,listingBodySha256:page.bodySha256,listedAt:page.completedAt});
  }
  return {kind:'files',sourceId:'noaa',modelReferenceTime:ref,fields:fields.sort((a,b)=>clock(a.validTime)-clock(b.validTime)),listingUrl:page.url,listingBodySha256:page.bodySha256};
}

export function nextIfsListing(page,{now}={}) {
  const path=ifsPath(page.url),html=pageBody(page,REFRESH_SOURCE_CONTRACTS.ecmwf.listingByteLimit,now),links=listingAnchorUrls(html,page.url);
  const parts=path.split('/').filter(Boolean);
  if(parts.length===1)return nextLink('ecmwf',page,links,url=>/^\/forecasts\/\d{8}\/$/.test(new URL(url).pathname),url=>new URL(url).pathname.split('/')[2],now);
  if(parts.length===2)return nextLink('ecmwf',page,links,url=>new RegExp(`^${path}(?:00|06|12|18)z/$`).test(new URL(url).pathname),url=>new URL(url).pathname.split('/').slice(2,4).join(''),now);
  const ref=reference(parts[1],parts[2].slice(0,2)),reason=freshness('ecmwf',ref,now);
  if(reason)return unavailable('ecmwf',reason,{modelReferenceTime:ref});
  if(parts.length<6){const segment={3:'ifs/',4:'0p25/',5:'oper/'}[parts.length];return nextLink('ecmwf',page,links,url=>url===page.url+segment,url=>parts[1]+parts[2],now);}
  const candidates=[...new Set(links)].filter(url=>url.startsWith(page.url)&&url.endsWith('.index'));
  assert.ok(candidates.length<=1000,'index listing budget');const fields=[];
  for(const indexUrl of candidates){
    const u=canonicalUrl(indexUrl);assert.equal(u.origin,'https://data.ecmwf.int');assert.equal(u.search,'');
    const m=u.pathname.match(/^\/forecasts\/(\d{8})\/(00|06|12|18)z\/ifs\/0p25\/oper\/(\d{8})(00|06|12|18)0000-(0|[1-9]\d{0,2})h-oper-fc\.index$/);
    assert.ok(m&&m[1]===parts[1]&&m[2]===parts[2].slice(0,2)&&m[3]===m[1]&&m[4]===m[2],'mismatched listed IFS file');
    const leadHours=Number(m[5]),valid=clock(ref)+leadHours*HOUR;
    if(leadHours<=0||leadHours>48||leadHours%3!==0||valid<=clock(now)||valid>clock(now)+24*HOUR)continue;
    fields.push({sourceId:'ecmwf',modelId:'ecmwf_ifs',indexUrl,modelReferenceTime:ref,validTime:new Date(valid).toISOString(),leadHours,sourceIssuedAt:null,firstAvailableAt:null,listingUrl:page.url,listingBodySha256:page.bodySha256,listedAt:page.completedAt});
  }
  const listingProof=candidates.length?extractReviewedListing({url:page.url,status:200,attemptedAt:page.attemptedAt,headersReceivedAt:page.headersReceivedAt,completedAt:page.completedAt,bodyBase64:Buffer.from(page.body).toString('base64'),bodyBytes:page.bodyBytes,bodySha256:page.bodySha256}):null;
  return {kind:'files',sourceId:'ecmwf',modelReferenceTime:ref,fields:fields.sort((a,b)=>clock(a.validTime)-clock(b.validTime)),listingUrl:page.url,listingBodySha256:page.bodySha256,listingProof};
}

export function selectMatchingTargets({gfs,ifs,now,maxTargets=5}) {
  assert.ok(Number.isInteger(maxTargets)&&maxTargets>0&&maxTargets<=5,'target budget');const start=clock(now);
  const expected=Array.from({length:maxTargets},(_,i)=>new Date((Math.floor(start/(3*HOUR))+1+i)*3*HOUR).toISOString());
  const maps=[gfs,ifs].map((discovery,i)=>{
    const sourceId=i===0?'noaa':'ecmwf';assert.equal(discovery.sourceId,sourceId);
    if(discovery.kind!=='files'||freshness(sourceId,discovery.modelReferenceTime,now))return new Map();
    const map=new Map();for(const field of discovery.fields){assert.equal(field.sourceId,sourceId);assert.equal(field.modelReferenceTime,discovery.modelReferenceTime);assert.ok(!map.has(field.validTime),'duplicate target');map.set(field.validTime,field);}return map;
  });
  const targets=[],missingTargets=[];
  for(const validTime of expected){const g=maps[0].get(validTime),i=maps[1].get(validTime);if(g&&i)targets.push({validTime,gfs:g,ifs:i});else missingTargets.push({validTime,missingSourceIds:[...(!g?['noaa']:[]),...(!i?['ecmwf']:[])]});}
  return {status:missingTargets.length?'partial':'complete',reason:targets.length?'newest_cycles_matched_by_valid_time':'no_shared_future_targets_in_newest_cycles',targets,missingTargets};
}

export function buildGfsFieldRequest(field,{now}={}) {
  assert.equal(field.sourceId,'noaa');assert.equal(field.modelId,'gfs');
  assert.equal(gfsDirectory(field.listingUrl),field.directory);assert.match(field.listingBodySha256,/^[a-f0-9]{64}$/);
  const d=field.directory.match(/^\/gfs\.(\d{8})\/(00|06|12|18)\/atmos$/),f=field.file.match(/^gfs\.t(00|06|12|18)z\.pgrb2\.0p25\.f(\d{3})$/);assert.ok(d&&f&&d[2]===f[1]);
  assert.equal(field.modelReferenceTime,reference(d[1],d[2]));assert.equal(field.leadHours,Number(f[2]));assert.ok(field.leadHours>0&&field.leadHours<=48&&field.leadHours%3===0);
  assert.equal(clock(field.validTime),clock(field.modelReferenceTime)+field.leadHours*HOUR);
  assert.ok(clock(field.validTime)>clock(now)&&clock(field.validTime)<=clock(now)+24*HOUR,'not a bounded future target');assert.equal(freshness('noaa',field.modelReferenceTime,now),null,'stale reference');assert.ok(clock(field.listedAt)<=clock(now));
  const url=new URL(GFS_ROOT);for(const[k,v]of Object.entries({file:field.file,...GFS_FIXED_PARAMETERS,dir:field.directory}))url.searchParams.set(k,v);
  return {...field,url:url.href,expectedStatus:200,maximumBytes:REFRESH_SOURCE_CONTRACTS.noaa.fieldByteLimit,headers:{Accept:'application/octet-stream','Accept-Encoding':'identity'}};
}

export function buildIfsRangeRequest(indexPage,field,{now,listingProof}={}) {
  assert.equal(field.sourceId,'ecmwf');assert.equal(field.modelId,'ecmwf_ifs');assert.equal(indexPage.url,field.indexUrl);
  const u=canonicalUrl(indexPage.url);assert.equal(u.origin,'https://data.ecmwf.int');assert.equal(u.search,'');
  const {proofSha256,...proof}=listingProof??{};assert.equal(proofSha256,digest(proof),'mutated listing proof');
  assert.equal(new URL('./',u).href,field.listingUrl);assert.equal(listingProof?.sourceBodySha256,field.listingBodySha256);assert.equal(listingProof.url,field.listingUrl);assert.ok(listingProof.anchorUrls.includes(indexPage.url),'index was not actually listed');
  assert.ok(clock(field.listedAt)<=clock(indexPage.attemptedAt),'index before discovery');
  const body=pageBody(indexPage,REFRESH_SOURCE_CONTRACTS.ecmwf.indexByteLimit,now);
  const m=u.pathname.match(/^\/forecasts\/(\d{8})\/(00|06|12|18)z\/ifs\/0p25\/oper\/(\d{8})(00|06|12|18)0000-([1-9]\d{0,2})h-oper-fc\.index$/);assert.ok(m&&m[1]===m[3]&&m[2]===m[4]);
  assert.equal(field.modelReferenceTime,reference(m[1],m[2]));assert.equal(field.leadHours,Number(m[5]));assert.ok(field.leadHours<=48&&field.leadHours%3===0);assert.equal(clock(field.validTime),clock(field.modelReferenceTime)+field.leadHours*HOUR);
  assert.ok(clock(field.validTime)>clock(now)&&clock(field.validTime)<=clock(now)+24*HOUR,'not a bounded future target');assert.equal(freshness('ecmwf',field.modelReferenceTime,now),null,'stale reference');
  const lines=body.split(/\r?\n/).filter(line=>line.trim());assert.ok(lines.length>0&&lines.length<=2000,'index record budget');const rows=lines.map(line=>JSON.parse(line));
  const selected=rows.filter(row=>['2t','167',167].includes(row.param)&&row.levtype==='sfc'&&row.stream==='oper'&&row.type==='fc');assert.equal(selected.length,1,'one exact temperature field required');const row=selected[0];
  assert.equal(String(row.date),m[1]);assert.equal(String(row.time).padStart(4,'0'),m[2]+'00');assert.equal(Number(row.step),field.leadHours);assert.ok(row.number===undefined||String(row.number)==='0','unexpected ensemble member');
  assert.ok(Number.isSafeInteger(row._offset)&&row._offset>=0);assert.ok(Number.isSafeInteger(row._length)&&row._length>0&&row._length<=REFRESH_SOURCE_CONTRACTS.ecmwf.fieldByteLimit);
  const end=row._offset+row._length-1;assert.ok(Number.isSafeInteger(end));
  return {...field,url:indexPage.url.replace(/\.index$/,'.grib2'),expectedStatus:206,maximumBytes:row._length,start:row._offset,end,length:row._length,rangeHeader:`bytes=${row._offset}-${end}`,selectedIndexRecord:row,indexBodySha256:indexPage.bodySha256,listingProof,headers:{Accept:'application/octet-stream','Accept-Encoding':'identity',Range:`bytes=${row._offset}-${end}`}};
}
