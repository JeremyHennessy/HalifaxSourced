import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {deflateRawSync} from 'node:zlib';
import vm from 'node:vm';
import {loadNewsHealth,projectNewsHealth,newsArtifactFiles} from './lib/news-health-receipt.mjs';
import {payloadDigest,finalReceipt} from './lib/news-run-lineage.mjs';
import {buildCatalog,buildFromDisk} from './build-source-catalog.mjs';
const root=new URL('../',import.meta.url),json=async p=>JSON.parse(await readFile(new URL(p,root),'utf8'));
const manifest=await json('news-evidence/current.json'),registry=await json('data/news-source-registry.json'),files={};
for(const name of Object.keys(manifest.files))files[name]=await readFile(new URL(`news-evidence/runs/${manifest.runId}/${name}`,root));
const fresh=()=>({manifest:structuredClone(manifest),registry:structuredClone(registry),files:Object.fromEntries(Object.entries(files).map(([n,b])=>[n,Buffer.from(b)]))});
let checks=0;const test=(name,fn)=>{fn();checks++;console.log(`ok ${checks} - ${name}`);};
function rebind(f,name,object){f.files[name]=Buffer.from(JSON.stringify(object));f.manifest.files[name]=payloadDigest(f.files[name]);}
// Fixture writer only; no collector or publisher network dependency.
function zipEntries(entries){
 const locals=[],central=[];let offset=0;
 for(const [name,bytes] of Object.entries(entries)){
  const n=Buffer.from(name),compressed=deflateRawSync(bytes),local=Buffer.alloc(30),header=Buffer.alloc(46);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(n.length,26);
  header.writeUInt32LE(0x02014b50);header.writeUInt16LE(20,6);header.writeUInt16LE(8,10);header.writeUInt32LE(compressed.length,20);header.writeUInt32LE(bytes.length,24);header.writeUInt16LE(n.length,28);header.writeUInt32LE(offset,42);
  locals.push(local,n,compressed);central.push(header,n);offset+=local.length+n.length+compressed.length;
 }
 const c=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(5,8);end.writeUInt16LE(5,10);end.writeUInt32LE(c.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,c,end]);
}
function mutateEntry(f,name,change,{receipt=false}={}){
 const entries=newsArtifactFiles(f.files['artifact.zip']),value=JSON.parse(entries[name]);change(value);entries[name]=Buffer.from(JSON.stringify(value));
 if(receipt){const identity=JSON.parse(entries['news-preview-final.json']).identity;entries['news-preview-final.json']=Buffer.from(JSON.stringify(finalReceipt(identity,entries['news-preview.json'])));const collected=JSON.parse(entries['news-preview-collected.json']);collected.payloadSha256=payloadDigest(entries['news-preview.json']);entries['news-preview-collected.json']=Buffer.from(JSON.stringify(collected));}
 f.files['artifact.zip']=zipEntries(entries);f.manifest.files['artifact.zip']=payloadDigest(f.files['artifact.zip']);
 const artifact=JSON.parse(f.files['artifact.json']);artifact.digest='sha256:'+f.manifest.files['artifact.zip'];artifact.size_in_bytes=f.files['artifact.zip'].length;rebind(f,'artifact.json',artifact);
}
const health=await loadNewsHealth(root),inputs={'data/news-source-registry.json':registry,'news-evidence/verified-health':health,'data/update-policy.json':{lanes:[{id:'regional-news',targetHours:6}]}};
test('actual scheduled evidence produces health-only source clocks',()=>{
 assert.equal(health.run.id,'40693348332');assert.equal(health.run.event,'schedule');assert.equal(health.sources.length,13);
 const row=buildCatalog(inputs).sources.find(r=>r.sourceId==='global-halifax');
 assert.equal(row.lastAttemptAt,'2026-10-28T13:06:02.058Z');assert.equal(row.lastSuccessAt,row.lastAttemptAt);assert.equal(row.contentAt,null);assert.equal(row.newsHealth.status,'pending_review');
 assert.equal(row.enabled,true);assert.equal(row.held,false);assert.equal(row.failing,false);
 for(const disabled of buildCatalog(inputs).sources.filter(r=>r.sourceId!=='global-halifax')){assert.equal(disabled.lastAttemptAt,null);assert.equal(disabled.lastSuccessAt,null);assert.equal(disabled.contentAt,null);assert.equal(disabled.enabled,false);}
 assert.ok(!/"(?:candidates|title|canonicalUrl|observedAt|publishedAt|etag|lastModified)"/.test(JSON.stringify(health)));
});
test('projection is immutable and plain/unverified injected JSON is rejected',()=>{
 assert.throws(()=>{health.sources[0].lastSuccessAt='2099-01-01T00:00:00.000Z';});
 assert.throws(()=>buildCatalog({...inputs,'news-evidence/verified-health':structuredClone(health)}),/Unverified/);
});
test('missing receipt preserves unknown clocks, never infers success from registry enabled',()=>{
 const rows=buildCatalog({'data/news-source-registry.json':registry}).sources;for(const row of rows){assert.equal(row.lastSuccessAt,null);assert.equal(row.lastAttemptAt,null);assert.equal(row.contentAt,null);}
});
for(const name of Object.keys(files))test(`corrupt ${name} rejected before projection`,()=>{const f=fresh();f.files[name][0]^=1;assert.throws(()=>projectNewsHealth(f));});
for(const [name,change] of [
 ['run ID',r=>r.id++],['run SHA',r=>r.head_sha='a'.repeat(40)],['workflow ID',r=>r.workflow_id++],['workflow path',r=>r.path='.github/workflows/other.yml'],['branch',r=>r.head_branch='other'],['repository',r=>r.repository.full_name='other/repo'],['event',r=>r.event='workflow_dispatch'],['run attempt',r=>r.run_attempt=2],['run failure',r=>r.conclusion='failure'],['run incomplete',r=>r.status='in_progress']
])test(`metadata ${name} mismatch rejects even after digest is repinned`,()=>{const f=fresh(),r=JSON.parse(f.files['run.json']);change(r);rebind(f,'run.json',r);assert.throws(()=>projectNewsHealth(f));});
for(const [name,change] of [['run',a=>a.workflow_run.id++],['SHA',a=>a.workflow_run.head_sha='a'.repeat(40)],['name',a=>a.name='other'],['archive digest',a=>a.digest='sha256:'+'0'.repeat(64)]])test(`artifact ${name} mismatch`,()=>{const f=fresh(),a=JSON.parse(f.files['artifact.json']);change(a);rebind(f,'artifact.json',a);assert.throws(()=>projectNewsHealth(f));});
test('failed final cache verification cannot be presented as healthy',()=>{const f=fresh(),j=JSON.parse(f.files['jobs.json']);j.jobs[0].steps.find(s=>s.name==='Verify exact final receipt cache exists after save').conclusion='failure';rebind(f,'jobs.json',j);assert.throws(()=>projectNewsHealth(f));});
for(const [name,entry,change,receipt] of [
 ['receipt digest','news-preview-final.json',r=>r.payloadSha256='0'.repeat(64),false],
 ['receipt identity','news-preview-final.json',r=>r.identity.runId='123',false],
 ['collection identity','news-preview-collected.json',r=>r.identity.sha='a'.repeat(40),false],
 ['plan identity','news-preview-lineage-plan.json',r=>r.current.runNumber=99,false],
 ['current cache key','news-preview-lineage-plan.json',r=>r.cacheKey+='-wrong',false],
 ['predecessor cache key','news-preview-lineage-plan.json',r=>r.predecessorCacheKey+='-wrong',false],
 ['predecessor event','news-preview-lineage-plan.json',r=>r.events.predecessor='push',false],
 ['predecessor repository','news-preview-lineage-plan.json',r=>r.predecessor.repository='other/repo',false],
 ['predecessor workflow','news-preview-lineage-plan.json',r=>r.predecessor.workflowId='123',false],
 ['predecessor branch','news-preview-lineage-plan.json',r=>r.predecessor.ref='refs/heads/other',false],
 ['predecessor attempt','news-preview-lineage-plan.json',r=>r.predecessor.runAttempt=2,false],
 ['predecessor run number','news-preview-lineage-plan.json',r=>r.predecessor.runNumber=1,false],
 ['predecessor receipt identity','news-preview-predecessor.json',r=>r.identity.runId='123',false],
 ['predecessor receipt kind','news-preview-predecessor.json',r=>r.kind='other',false],
 ['predecessor receipt cache key','news-preview-predecessor.json',r=>r.cacheKey+='-wrong',false],
 ['predecessor receipt digest schema','news-preview-predecessor.json',r=>r.payloadSha256='not-a-digest',false],
 ['predecessor receipt undrained','news-preview-predecessor.json',r=>r.transportDecisionsDrained=false,false],
 ['predecessor receipt unverified cache','news-preview-predecessor.json',r=>r.payloadCacheVerified=false,false],
 ['source ID','news-preview.json',p=>p.diagnostics[0].sourceId='unregistered',true],
 ['source config','news-preview.json',p=>p.diagnostics[0].configHash='0'.repeat(64),true],
 ['source host','news-preview.json',p=>p.diagnostics[0].sourceHost='wrong.test',true],
 ['source future clock','news-preview.json',p=>p.diagnostics.find(d=>d.sourceId==='global-halifax').lastSuccessAt='2099-01-01T00:00:00.000Z',true],
 ['false success clock','news-preview.json',p=>p.diagnostics.find(d=>d.sourceId==='global-halifax').lastSuccessAt=null,true],
 ['source hold','news-preview.json',p=>p.diagnostics.find(d=>d.sourceId==='global-halifax').accessHeld=true,true]
])test(`semantic ${name} mismatch rejected beyond archive digest`,()=>{const f=fresh();mutateEntry(f,entry,change,{receipt});assert.throws(()=>projectNewsHealth(f));});
test('changed current source configuration cannot reuse historic health',()=>{const f=fresh();f.registry.sources.find(s=>s.id==='global-halifax').feedUrl='https://globalnews.ca/changed/';assert.throws(()=>projectNewsHealth(f));assert.throws(()=>buildCatalog({...inputs,'data/news-source-registry.json':f.registry}));});
test('consumer rejects enabled-state changes and changed source sets after verified load',()=>{for(const change of [r=>{r.sources.find(s=>s.id==='global-halifax').enabled=false;},r=>r.sources.pop(),r=>r.sources.push({...r.sources[0],id:'extra'}),r=>r.sources.push(r.sources[0])]){const changed=structuredClone(registry);change(changed);assert.throws(()=>buildCatalog({...inputs,'data/news-source-registry.json':changed}));}});
test('duplicate ZIP entries/traversal/unbounded sizes rejected in memory',()=>{for(const modify of [b=>b.writeUInt32LE(0xffffffff, b.readUInt32LE(b.length-6)+24),b=>b.writeUInt16LE(6,b.length-12),b=>b.fill(0,0,4)]){const bytes=Buffer.from(files['artifact.zip']);modify(bytes);assert.throws(()=>newsArtifactFiles(bytes));}});
test('ZIP traversal and unexpected entries cannot enter projection',()=>{const entries=newsArtifactFiles(files['artifact.zip']);entries['../news-preview.json']=entries['news-preview.json'];delete entries['news-preview.json'];assert.throws(()=>newsArtifactFiles(zipEntries(entries)));});
test('candidate content clocks and retained review data stay byte-identical through projection',()=>{
 const before=Buffer.from(files['artifact.zip']),candidates=JSON.parse(newsArtifactFiles(before)['news-preview.json']).candidates;
 projectNewsHealth(fresh());assert.deepEqual(files['artifact.zip'],before);assert.equal(candidates.length,10);
 assert.ok(candidates.every(c=>c.observedAt==='2026-10-28T02:47:06.001Z' && c.reviewStatus==='pending'));
 assert.deepEqual(JSON.parse(newsArtifactFiles(files['artifact.zip'])['news-preview.json']).candidates,candidates);
});
const sandbox={window:{location:{href:'https://example.test/'}},URL,Date,console};vm.createContext(sandbox);vm.runInContext(await readFile(new URL('app-admin-status.js',root),'utf8'),sandbox);
test('admin labels receipt snapshot and separates content clock, no candidate promotion',()=>{
 const row=buildCatalog(inputs).sources.find(r=>r.sourceId==='global-halifax'),html=sandbox.renderCatalogRow(row);
 assert.match(html,/Published receipt snapshot, not live monitoring/);assert.match(html,/Last successful collection/);assert.match(html,/Latest content publication\/change/);assert.match(html,/No candidate publication is implied/);assert.match(html,/40693348332/);
 assert.equal(sandbox.catalogNewsHealthMetadata({...row,newsHealth:null}),'');
 assert.equal(sandbox.catalogCurrentState({...row,lastSuccessAt:'2020-01-01',targetHours:6}),'stale');
 assert.equal(sandbox.catalogCurrentState({...row,held:true}),'held');
});
const temp=await mkdtemp(join(tmpdir(),'news-health-absent-'));try{assert.equal(await loadNewsHealth(pathToFileURL(temp+'/')),null);checks++;}finally{await rm(temp,{recursive:true,force:true});}
const retained=['data/news.js','data/build/news.json','data/reviewed-news-decisions.json','data/news-source-registry.json'];const before=await Promise.all(retained.map(p=>readFile(new URL(p,root))));
await buildFromDisk();const catalogue=await readFile(new URL('data/build/source-catalog.json',root));await buildFromDisk();assert.deepEqual(await readFile(new URL('data/build/source-catalog.json',root)),catalogue);checks++;
for(let i=0;i<retained.length;i++)assert.deepEqual(await readFile(new URL(retained[i],root)),before[i],retained[i]+' must stay byte-identical');checks++;
assert.equal((await json('data/build/news.json')).items.length,55);
console.log(`${checks} news health receipt checks passed; offline, no candidate promotion, accepted content unchanged.`);
