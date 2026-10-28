// Synthetic source receipt/archive contract tests, never evidence of live access.
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {hash} from './lib/eccc-weather.mjs';
import {digest} from './lib/weather-aggregation.mjs';
import {aggregateIssuedArchive,normalizeGfsDecoded} from './lib/weather-model-archive.mjs';
import {replayGribCaptures} from './lib/weather-grib-replay.mjs';
globalThis.fetch=()=>assert.fail('Archive tests must not fetch');
const locations=JSON.parse(await readFile(new URL('../data/weather-locations.json',import.meta.url))),original=JSON.parse(await readFile(new URL('../data/weather-model-registry.json',import.meta.url)));
const registry=structuredClone(original),noaa=registry.sources.find(s=>s.id==='noaa');noaa.enabled=true;noaa.accessState='admitted_review_only';noaa.acceptedAdmissionReviewIds=['synthetic-only'];noaa.acceptedDecoderIds=['gfs-temperature-eccodes-v1'];registry.models.find(m=>m.id==='gfs').enabled=true;
const body=Buffer.from('GRIB synthetic contract fixture - not source data 7777'),id=hash(body),issuedAt='2026-10-28T03:00:00Z',validAt='2026-10-28T06:00:00Z';
const decoded={version:1,kind:'decoded_gfs_temperature_points',sourceBodySha256:id,bodyBytes:body.length,modelReferenceTime:'2026-10-28T00:00:00Z',validAt,leadHours:6,centre:7,generatingProcessIdentifier:81,gridType:'regular_ll',numberOfDataPoints:4,variable:'temperature_2m',sourceUnit:'K',unit:'C',projection:'nearest_grid_point',points:[{locationId:'halifax_peninsula',latitude:44.6488,longitude:-63.5752,valueC:10,gridLatitude:44.75,gridLongitude:-63.5,distanceKm:12,gridIndex:1}]};
const receipt={version:1,kind:'reviewed_model_source_capture',sourceId:'noaa',url:'https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl?file=gfs.t00z.pgrb2.0p25.f006&dir=%2Fgfs.20261028%2F00%2Fatmos&var_TMP=on&lev_2_m_above_ground=on&subregion=&leftlon=-63.75&rightlon=-63.50&toplat=44.75&bottomlat=44.50',attemptedAt:'2026-10-28T02:00:00Z',headersReceivedAt:'2026-10-28T02:00:01Z',completedAt:'2026-10-28T02:00:02Z',status:200,bodySha256:id,bodyBytes:body.length,admissionReviewId:'synthetic-only',decoderId:'gfs-temperature-eccodes-v1',decoderResultSha256:digest(decoded)};
const rows=normalizeGfsDecoded(decoded,receipt,{locations}),target={locationId:'halifax_peninsula',variable:'temperature_2m',unit:'C',validStart:validAt,validEnd:validAt,eventDefinition:null};
const archive={version:1,kind:'review_only_halifax_model_archive',issuedAt,registrySha256:digest(registry),locationsSha256:digest(locations),targets:[target],captures:[{id,sourceId:'noaa',bodyBase64:body.toString('base64'),receipt,decoded}],outcomes:[{modelId:'gfs',target,status:'complete',latestKnownModelReferenceTime:decoded.modelReferenceTime,knownAt:receipt.completedAt,captureIds:[id],rows,reason:'synthetic_only'}],minFamilies:2};
let count=0;function test(name,fn){fn();console.log(`ok ${++count} - ${name}`);}
test('NOAA mapping retains exact clocks, percent-independent units, grid support and unknown model version',()=>{assert.equal(rows[0].value,10);assert.equal(rows[0].firstAvailableAt,null);assert.equal(rows[0].firstRetrievedAt,receipt.completedAt);assert.equal(rows[0].modelVersion,'unknown');assert.equal(rows[0].support.method,'nearest_grid_point');});
test('one family never masquerades as multi-model aggregate or authorizes publication',()=>{const out=aggregateIssuedArchive(archive,{registry,locations});assert.equal(out.outputs[0].prediction,null);assert.equal(out.publicationAuthorized,false);assert.equal(out.accuracyImprovementEstablished,false);});
test('raw hash, decoded value, request cycle, provider and receipt times reject mutation',()=>{for(const edit of [a=>a.captures[0].bodyBase64=Buffer.from('changed').toString('base64'),a=>a.outcomes[0].rows[0].value=11,a=>a.captures[0].receipt.completedAt='2026-10-29T00:00:00Z',a=>a.captures[0].receipt.url=a.captures[0].receipt.url.replace('f006','f009'),a=>a.captures[0].receipt.admissionReviewId='unreviewed',a=>a.captures[0].receipt.url=a.captures[0].receipt.url.replace('nomads.ncep.noaa.gov','example.org')]){const a=structuredClone(archive);edit(a);assert.throws(()=>aggregateIssuedArchive(a,{registry,locations}));}});
test('omitted newest outcomes cannot silently pick old target or member rows',()=>{for(const edit of [a=>a.outcomes=[],a=>a.outcomes[0].latestKnownModelReferenceTime='2026-10-28T02:00:00Z',a=>a.outcomes[0].status='partial',a=>a.outcomes[0].rows.push({...a.outcomes[0].rows[0]})]){const a=structuredClone(archive);edit(a);assert.throws(()=>aggregateIssuedArchive(a,{registry,locations}));}const missing=structuredClone(archive);missing.captures=[];Object.assign(missing.outcomes[0],{status:'held',rows:[],captureIds:[],reason:'retained original body elsewhere; never reuse old row'});assert.equal(aggregateIssuedArchive(missing,{registry,locations}).outputs[0].prediction,null);});
test('all declared target cells need a status, including missing/held/failed',()=>{const a=structuredClone(archive);a.targets.push({...target,locationId:'bedford'});assert.throws(()=>aggregateIssuedArchive(a,{registry,locations}),/every admitted/);a.outcomes.push({...a.outcomes[0],target:a.targets[1],status:'missing',rows:[],captureIds:[],reason:'not supplied'});assert.equal(aggregateIssuedArchive(a,{registry,locations}).outputs.length,2);});
test('actual packaged registry disabled; no accidental source activation',()=>{assert.ok(original.sources.every(s=>!s.enabled)&&original.models.every(m=>!m.enabled));assert.equal(original.liveCollectionEnabled,false);assert.throws(()=>aggregateIssuedArchive({...archive,registrySha256:digest(original)},{registry:original,locations}),/unreviewed admission/);});
// Raw replay is mandatory for captured bytes, but a held/empty archive needs no Python.
await replayGribCaptures([], {locations});
await assert.rejects(replayGribCaptures(archive.captures, {locations}), /WEATHER_GRIB_PYTHON/);
await assert.rejects(replayGribCaptures(archive.captures, {locations, python: 'python3'}), /WEATHER_GRIB_PYTHON/);
// An absolute executable alone cannot certify decoded data. This parses the fixed Python
// decoder as JS and must fail; no downloaded runtime, helper, or source request is involved.
await assert.rejects(replayGribCaptures(archive.captures, {locations, python: process.execPath}));
console.log(`ok ${++count} - nonempty capture requires explicit working raw decoder; empty held archive does not`);

const directory = await mkdtemp(join(tmpdir(), 'halifax-model-review-test-'));
try {
 const empty = {version: 1, kind: 'review_only_halifax_model_archive', issuedAt,
  registrySha256: digest(original), locationsSha256: digest(locations), targets: [target],
  captures: [], outcomes: [], minFamilies: 2};
 const input = join(directory, 'archive.json'), output = join(directory, 'review.json');
 const root = fileURLToPath(new URL('../', import.meta.url));
 const cli = fileURLToPath(new URL('./aggregate-weather-models.mjs', import.meta.url));
 await writeFile(input, JSON.stringify(empty));
 const invoke = path => spawnSync(process.execPath, [cli, input, path], {
  cwd: directory, encoding: 'utf8', env: {...process.env, WEATHER_GRIB_PYTHON: ''}
 });
 const run = invoke(output);
 assert.equal(run.status, 0, run.stderr);
 const result = JSON.parse(await readFile(output));
 assert.equal(result.outputs[0].prediction, null);
 assert.equal(result.publicationAuthorized, false);
 const originalBytes = await readFile(output);
 assert.notEqual(invoke(output).status, 0);
 assert.deepEqual(await readFile(output), originalBytes);
 assert.notEqual(invoke(input).status, 0);
 assert.deepEqual(JSON.parse(await readFile(input)), empty);
 console.log(`ok ${++count} - executable review CLI works outside repo cwd and never overwrites input or issuance`);

 const protectedName = basename(directory) + '.json';
 const publicOutput = join(root, 'data', protectedName);
 let denied = invoke(publicOutput);
 assert.notEqual(denied.status, 0);
 assert.match(denied.stderr, /outside repository/);
 await assert.rejects(readFile(publicOutput), {code: 'ENOENT'});
 const link = join(directory, 'public-data-link');
 await symlink(join(root, 'data'), link, 'dir');
 denied = invoke(join(link, protectedName));
 assert.notEqual(denied.status, 0);
 assert.match(denied.stderr, /outside repository/);
 await assert.rejects(readFile(publicOutput), {code: 'ENOENT'});
 console.log(`ok ${++count} - public-data output stays forbidden across changed cwd and directory symlinks`);

 // An existing output symlink is not followed by exclusive creation.
 const prior = join(directory, 'prior-issuance.json'), outputLink = join(directory, 'output-link.json');
 await writeFile(prior, 'immutable prior issuance\n');
 await symlink(prior, outputLink);
 assert.notEqual(invoke(outputLink).status, 0);
 assert.equal(await readFile(prior, 'utf8'), 'immutable prior issuance\n');
 console.log(`ok ${++count} - output file symlink cannot overwrite a retained issuance`);
} finally {
 await rm(directory, {recursive: true, force: true});
}
console.log(`${count} model archive/adapter groups passed offline; no live evidence.`);
