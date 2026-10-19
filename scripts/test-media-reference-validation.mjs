import assert from 'node:assert/strict';
import {cp,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
const root=await mkdtemp(join(tmpdir(),'halifax-media-contract-'));
const run=(script,expected)=>{const result=spawnSync(process.execPath,['--import','data:text/javascript,const OriginalDate=Date;globalThis.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[1791252000000]));}static now(){return 1791252000000;}};','scripts/'+script],{cwd:root,encoding:'utf8',env:{...process.env,THUMBNAIL_DISCOVERY_FETCH:'0',THUMBNAIL_IMAGE_PROBE:'0'}});assert.equal(result.status,expected,result.stdout+result.stderr);};
const read=async file=>{const context={window:{}};vm.runInNewContext(await readFile(join(root,file),'utf8'),context);return context.window;};
try{
 for(const directory of ['scripts','data','assets'])await cp(new URL('../'+directory,import.meta.url),join(root,directory),{recursive:true});
 for(const file of ['app-media.js','source-integrity.js'])await cp(new URL('../'+file,import.meta.url),join(root,file));
 await mkdir(join(root,'artifacts'),{recursive:true});
 for(const script of ['check-data-integrity.mjs','check-restaurant-media-rights.mjs','build-thumbnail-candidates.mjs','check-thumbnail-candidates.mjs','build-content-coverage-report.mjs','build-thumbnail-coverage-report.mjs'])run(script,0);
 const firstBuild=JSON.parse(await readFile(join(root,'data/build/thumbnail-candidates.json'),'utf8'));run('build-thumbnail-candidates.mjs',0);assert.deepEqual(JSON.parse(await readFile(join(root,'data/build/thumbnail-candidates.json'),'utf8')),firstBuild,'Builder must be idempotent for fixed inputs and clock');
 const file='data/restaurant-media.js',original=await readFile(join(root,file),'utf8'),media=(await read(file)).HALIFAX_RESTAURANT_MEDIA;
 media.records[0].permissionConfirmed=false;await writeFile(join(root,file),'window.HALIFAX_RESTAURANT_MEDIA = '+JSON.stringify(media)+';');
 run('check-data-integrity.mjs',1);run('build-thumbnail-candidates.mjs',1);run('build-content-coverage-report.mjs',1);await writeFile(join(root,file),original);
 const referenceFile='data/restaurant-media-references.js',refs=(await read(referenceFile)).HALIFAX_MEDIA_SOURCE_REFERENCES;refs.records[0].permissionConfirmed=true;
 await writeFile(join(root,referenceFile),'window.HALIFAX_MEDIA_SOURCE_REFERENCES = '+JSON.stringify(refs)+';');
 run('check-data-integrity.mjs',1);run('check-restaurant-media-rights.mjs',1);run('build-thumbnail-candidates.mjs',1);
 const candidateFile='data/thumbnail-candidates.js',candidates=(await read(candidateFile)).HALIFAX_THUMBNAIL_CANDIDATES;candidates.candidates.find(record=>record.eligibleForProduction).permission='unknown';
 await writeFile(join(root,candidateFile),'window.HALIFAX_THUMBNAIL_CANDIDATES = '+JSON.stringify(candidates)+';');await writeFile(join(root,'data/build/thumbnail-candidates.json'),JSON.stringify(candidates));run('check-thumbnail-candidates.mjs',1);run('build-thumbnail-coverage-report.mjs',1);
 console.log('Real checker/builder regressions passed: separated references accepted; malformed approved claims and conflicting reference permission rejected.');
}finally{await rm(root,{recursive:true,force:true});}
