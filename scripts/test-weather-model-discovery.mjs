// Synthetic discovery fixtures only. Never a source admission or acquisition.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import {syncBuiltinESMExports} from 'node:module';
import {REFRESH_SOURCE_CONTRACTS, GFS_FIXED_PARAMETERS, nextGfsListing, nextIfsListing, selectMatchingTargets, buildGfsFieldRequest, buildIfsRangeRequest, isReviewedListingUrl} from './lib/weather-model-discovery.mjs';
const deny=()=>assert.fail('network forbidden in discovery tests');globalThis.fetch=deny;http.request=http.get=https.request=https.get=net.connect=net.createConnection=deny;syncBuiltinESMExports();
const hash=b=>createHash('sha256').update(b).digest('hex');
const now='2026-10-28T04:45:00.000Z',groot=REFRESH_SOURCE_CONTRACTS.noaa.rootUrl,eroot=REFRESH_SOURCE_CONTRACTS.ecmwf.rootUrl;
const gd='/gfs.20261028/00/atmos',glink=dir=>groot+'?dir='+encodeURIComponent(dir),epath=eroot+'20261027/18z/ifs/0p25/oper/';
const page=(url,html,{at='2026-10-28T04:00:00.000Z'}={})=>{const body=Buffer.from(html);return{url,status:200,attemptedAt:at,headersReceivedAt:at,completedAt:at,bodyBytes:body.length,bodySha256:hash(body),body};};
const a=(url,label='entry')=>`<a href="${url}">${label}</a>`;
const form=(files=[6,9,12,15,18,21,24],dir=gd)=>`<form action="${groot}" method="get"><select name="file">${files.map(n=>`<form action="${groot}" method="get"><option value="gfs.t00z.pgrb2.0p25.f${String(n).padStart(3,'0')}">file`).join('')}</select><input type="hidden" name="dir" value="${dir}">${Object.keys(GFS_FIXED_PARAMETERS).map(name=>`<input ${name==='lev_2_m_above_ground'||name==='var_TMP'?'type="checkbox"':'value=""'} name="${name}">`).join('')}</form>`;
const efile=lead=>`20261027180000-${lead}h-oper-fc.index`;
const gp=()=>page(glink(gd),form());const ep=(steps=[12,15,18,21,24,27,30])=>page(epath,steps.map(n=>a(efile(n))).join(''));
const gfiles=()=>nextGfsListing(gp(),{now}),efiles=()=>nextIfsListing(ep(),{now});
const indexRow={param:'2t',levtype:'sfc',stream:'oper',type:'fc',date:'20261027',time:'1800',step:'12',_offset:24183180,_length:315359};
const index=(rows=[indexRow])=>page(epath+efile(12),rows.map(x=>JSON.stringify(x)).join('\n'),{at:'2026-10-28T04:01:00.000Z'});
let count=0;const test=(name,fn)=>{fn();console.log(`ok ${++count} - ${name}`);};
test('only exact admitted listing paths and fixed finite budgets',()=>{
 assert.equal(REFRESH_SOURCE_CONTRACTS.noaa.maxListingPages,4);assert.equal(REFRESH_SOURCE_CONTRACTS.ecmwf.maxListingPages,6);
 assert.equal(REFRESH_SOURCE_CONTRACTS.ecmwf.fieldByteLimit,4*1024*1024);
 for(const url of [groot,glink('/gfs.20261028'),glink(gd)])assert.equal(isReviewedListingUrl('noaa',url),true);
 for(const url of [groot+'?foo=1',groot+'?dir=%2Fgfs.20261028&dir=%2Fgfs.20261027',groot.replace('https:','http:'),'https://nomads.ncep.noaa.gov.evil.test/cgi-bin/filter_gfs_0p25.pl',groot+'#x'])assert.equal(isReviewedListingUrl('noaa',url),false);
 for(const url of [eroot,epath])assert.equal(isReviewedListingUrl('ecmwf',url),true);
 for(const url of [epath.replace('0p25','0p1'),epath.replace('ifs','aifs-single'),epath+'?sort=desc',epath+'../',eroot.replace('data.ecmwf.int','example.com')])assert.equal(isReviewedListingUrl('ecmwf',url),false);
});
test('newest actual NOAA date/cycle selected, not clock-guessed 06Z',()=>{
 const root=nextGfsListing(page(groot,a(glink('/gfs.20261027'))+a(glink('/gfs.20261028'))),{now});assert.equal(root.url,glink('/gfs.20261028'));
 const date=nextGfsListing(page(root.url,a(glink('/gfs.20261028/00'))),{now});assert.equal(date.url,glink('/gfs.20261028/00'));
 const cycle=nextGfsListing(page(date.url,a(glink(gd))),{now});assert.equal(cycle.url,glink(gd));
});
test('no older cycle/date fallback when newest listed path incomplete',()=>{
 const latest=nextGfsListing(page(groot,a(glink('/gfs.20261027'))+a(glink('/gfs.20261028'))),{now});
 const missing=nextGfsListing(page(latest.url,a(glink('/gfs.20261027/18'))),{now});assert.equal(missing.kind,'unavailable');assert.equal(missing.reason,'newest_listing_has_no_reviewed_child');
});
test('scripts, comments and attribute-embedded fake anchors are not discovery',()=>{
 const html=`<script>${a(glink('/gfs.20261029'))}</script><!--${a(glink('/gfs.20261030'))}--><div data-fake='${a(glink('/gfs.20261031'))}'></div>${a(glink('/gfs.20261028'))}`;
 assert.equal(nextGfsListing(page(groot,html),{now}).url,glink('/gfs.20261028'));
});
test('receipt byte/hash/UTF8/clock/status limits are enforced',()=>{
 for(const change of [p=>p.bodySha256='0'.repeat(64),p=>p.bodyBytes++,p=>p.status=304,p=>p.completedAt='2026-10-28T05:00:00Z',p=>p.headersReceivedAt='2026-10-28T03:59:00Z',p=>p.attemptedAt='2026-02-30T00:00:00Z']){const p=gp();change(p);assert.throws(()=>nextGfsListing(p,{now}));}
 assert.throws(()=>nextGfsListing(page(glink(gd),'x'.repeat(256*1024+1)),{now}));
 const p=gp();p.body=Buffer.from([0xff]);p.bodyBytes=1;p.bodySha256=hash(p.body);assert.throws(()=>nextGfsListing(p,{now}));
});
test('known actual repeated identical nested GFS forms retain paired directory/files',()=>{
 const result=gfiles();assert.equal(result.kind,'files');assert.equal(result.fields.length,7);assert.equal(result.modelReferenceTime,'2026-10-28T00:00:00.000Z');
 assert.equal(result.fields[0].file,'gfs.t00z.pgrb2.0p25.f006');assert.equal(result.fields[0].directory,gd);assert.equal(result.fields[0].sourceIssuedAt,null);assert.equal(result.fields[0].firstAvailableAt,null);
});
test('GFS fields outside actual form, cross-form dir and altered nested action are rejected',()=>{
 assert.throws(()=>nextGfsListing(page(glink(gd),form().replaceAll('name="dir"','name="other"')+`<form action="${groot}"><input name="dir" value="${gd}"></form>`),{now}));
 assert.throws(()=>nextGfsListing(page(glink(gd),form().replace('<select name="file"><form action="'+groot+'"','<select name="file"><form action="https://evil.test/"')),{now}));
 assert.throws(()=>nextGfsListing(page(glink(gd),`<script>${form()}</script>`),{now}));
});
test('GFS malformed duplicate field, duplicate options, mismatched cycles and hidden inert fields rejected',()=>{
 for(const text of [form().replace('</form>','<input name="var_TMP"></form>'),form([6,6]),form().replace('gfs.t00z.pgrb2.0p25.f006','gfs.t06z.pgrb2.0p25.f006'),form().replace('name="var_TMP"','name="var_TMP" name="unused"'),form().replace('name="var_TMP"','name="unused"')+`<template><input name="var_TMP"></template>`])assert.throws(()=>nextGfsListing(page(glink(gd),text),{now}));
});
test('future latest date is unavailable rather than selecting older date',()=>{
 const r=nextGfsListing(page(groot,a(glink('/gfs.20261028'))+a(glink('/gfs.20261029'))),{now});assert.equal(r.kind,'unavailable');assert.equal(r.reason,'newest_listed_date_is_future');
});
test('GFS exact 18h reference age becomes unavailable, no stale file request',()=>{
 assert.equal(nextGfsListing(gp(),{now:'2026-10-28T18:00:00Z'}).kind,'unavailable');
 assert.throws(()=>buildGfsFieldRequest(gfiles().fields[0],{now:'2026-10-28T18:00:00Z'}));
});
test('GFS request has exact tiny Halifax bbox, 2m TMP and one listed file only',()=>{
 const request=buildGfsFieldRequest(gfiles().fields[0],{now}),u=new URL(request.url);
 assert.equal(request.expectedStatus,200);assert.equal(request.maximumBytes,1024*1024);assert.deepEqual([...u.searchParams.keys()],['file',...Object.keys(GFS_FIXED_PARAMETERS),'dir']);
 for(const[k,v]of Object.entries(GFS_FIXED_PARAMETERS))assert.equal(u.searchParams.get(k),v);
 assert.equal(u.searchParams.get('dir'),gd);assert.equal(request.sourceIssuedAt,null);
 assert.throws(()=>buildGfsFieldRequest({...gfiles().fields[0],directory:'/gfs.20261028/06/atmos'},{now}));
});
test('GFS past, analysis, non3h and beyond48h files are not selected',()=>{
 const r=nextGfsListing(page(glink(gd),form([0,3,5,6,9,48,51])),{now});assert.deepEqual(r.fields.map(f=>f.leadHours),[6,9]);
 assert.throws(()=>buildGfsFieldRequest(gfiles().fields[0],{now:'2026-10-28T06:00:00Z'}));
});
test('IFS follows six exact listed pages without choosing unlisted current date',()=>{
 let r=nextIfsListing(page(eroot,a('20261027/')),{now});assert.equal(r.url,eroot+'20261027/');
 r=nextIfsListing(page(r.url,a('00z/')+a('18z/')),{now});assert.equal(r.url,eroot+'20261027/18z/');
 for(const child of ['ifs/','0p25/','oper/']){const next=nextIfsListing(page(r.url,a(child)),{now});assert.equal(next.url,r.url+child);r=next;}
 assert.equal(r.url,epath);assert.equal(efiles().fields.length,7);
});
test('IFS partial newest cycle does not use older cycle, higher resolution or AIFS',()=>{
 const r=nextIfsListing(page(eroot+'20261027/',a('12z/')+a('18z/')),{now});assert.equal(r.url,eroot+'20261027/18z/');
 assert.equal(nextIfsListing(page(r.url,a('aifs-single/')+a('../12z/ifs/')),{now}).kind,'unavailable');
 assert.equal(nextIfsListing(page(r.url+'ifs/',a('0p1/')),{now}).kind,'unavailable');
});
test('IFS exact24h reference stale and forged file cycle/index rejected',()=>{
 assert.equal(nextIfsListing(ep(),{now:'2026-10-28T18:00:00Z'}).kind,'unavailable');
 for(const filename of ['20261027120000-12h-oper-fc.index','20261027180000-12h-enfo-fc.index'])assert.throws(()=>nextIfsListing(page(epath,a(filename)),{now}));
});
test('IFS final listing exports only factual index anchor proof, never website JS',()=>{
 const p=ep();p.body=Buffer.concat([p.body,Buffer.from('<script>privateWebsiteCode()</script>')]);p.bodyBytes=p.body.length;p.bodySha256=hash(p.body);
 const r=nextIfsListing(p,{now});assert.equal(r.listingProof.kind,'reviewed_listing_anchor_extract');assert.equal(r.listingProof.sourceBodySha256,p.bodySha256);
 assert.equal(JSON.stringify(r).includes('privateWebsiteCode'),false);assert.equal(Object.hasOwn(r.listingProof,'bodyBase64'),false);
});
test('different actual reference cycles match five future UTC3h valid instants',()=>{
 const r=selectMatchingTargets({gfs:gfiles(),ifs:efiles(),now});assert.equal(r.status,'complete');assert.equal(r.targets.length,5);
 assert.deepEqual(r.targets.map(t=>t.validTime.slice(11,13)),['06','09','12','15','18']);assert.notEqual(r.targets[0].gfs.modelReferenceTime,r.targets[0].ifs.modelReferenceTime);
});
test('missing nearest target remains explicit partial, not replaced by farther or older field',()=>{
 const r=selectMatchingTargets({gfs:gfiles(),ifs:nextIfsListing(ep([15,18,21,24,27,30]),{now}),now});assert.equal(r.status,'partial');assert.equal(r.targets.length,4);assert.equal(r.missingTargets[0].validTime,'2026-10-28T06:00:00.000Z');assert.deepEqual(r.missingTargets[0].missingSourceIds,['ecmwf']);
});
test('no future shared targets is explicit partial, duplicate targets and oversized requests rejected',()=>{
 const r=selectMatchingTargets({gfs:{kind:'unavailable',sourceId:'noaa',reason:'newest_listing_has_no_reviewed_child'},ifs:efiles(),now});assert.equal(r.status,'partial');assert.equal(r.targets.length,0);assert.equal(r.reason,'no_shared_future_targets_in_newest_cycles');
 assert.throws(()=>selectMatchingTargets({gfs:gfiles(),ifs:efiles(),now,maxTargets:6}));const g=gfiles();g.fields.push(g.fields[0]);assert.throws(()=>selectMatchingTargets({gfs:g,ifs:efiles(),now}));
});
test('range selection needs one actual indexed2t field and exact206 request',()=>{
 const e=efiles(),f=e.fields[0],r=buildIfsRangeRequest(index(),f,{now,listingProof:e.listingProof});assert.equal(r.rangeHeader,'bytes=24183180-24498538');assert.equal(r.maximumBytes,315359);assert.equal(r.expectedStatus,206);assert.equal(r.url,epath+efile(12).replace('.index','.grib2'));assert.equal(r.sourceIssuedAt,null);
});
test('index hash, chronology, proof mutation and unlisted URL are rejected',()=>{
 const e=efiles(),f=e.fields[0];const p=index();p.bodySha256='0'.repeat(64);assert.throws(()=>buildIfsRangeRequest(p,f,{now,listingProof:e.listingProof}));
 assert.throws(()=>buildIfsRangeRequest(page(p.url,JSON.stringify(indexRow),{at:'2026-10-28T03:59:00Z'}),f,{now,listingProof:e.listingProof}));
 const proof=structuredClone(e.listingProof);proof.anchorUrls.push(epath+'not-listed.index');assert.throws(()=>buildIfsRangeRequest(index(),f,{now,listingProof:proof}));
 assert.throws(()=>buildIfsRangeRequest(index(),{...f,indexUrl:epath+efile(15)},{now,listingProof:e.listingProof}));
});
test('index record date/cycle/step/member and offset/length byte limits enforced',()=>{
 const e=efiles(),f=e.fields[0];for(const changes of [{date:'20261028'},{time:'1200'},{step:'15'},{number:'1'},{_offset:-1},{_offset:Number.MAX_SAFE_INTEGER},{_length:0},{_length:4*1024*1024+1},{_length:1.5}])assert.throws(()=>buildIfsRangeRequest(index([{...indexRow,...changes}]),f,{now,listingProof:e.listingProof}));
 assert.throws(()=>buildIfsRangeRequest(index([indexRow,indexRow]),f,{now,listingProof:e.listingProof}));
 assert.throws(()=>buildIfsRangeRequest(index([{...indexRow,param:'10u'}]),f,{now,listingProof:e.listingProof}));
});
test('range builder will not request expired target or stale cycle',()=>{
 const e=efiles(),f=e.fields[0];assert.throws(()=>buildIfsRangeRequest(index(),f,{now:'2026-10-28T06:00:00Z',listingProof:e.listingProof}));
 assert.throws(()=>buildIfsRangeRequest(index(),f,{now:'2026-10-28T18:00:00Z',listingProof:e.listingProof}));
});
console.log(`Weather model discovery: ${count} groups passed; synthetic fixtures, no source requests.`);
