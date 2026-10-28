// Hosted gate: replay every actually packaged GRIB, not a future-release fixture pin.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {loadPublicModelProjection} from './lib/weather-model-publication.mjs';
import {replayGribCaptures} from './lib/weather-grib-replay.mjs';
globalThis.fetch=()=>assert.fail('Raw replay cannot request weather sources');
const {archive}=await loadPublicModelProjection(),locations=JSON.parse(await readFile(new URL('../data/weather-locations.json',import.meta.url))),python=process.env.WEATHER_GRIB_PYTHON;
assert.ok(python,'Reviewed isolated ecCodes interpreter is mandatory, never skip this gate');
await replayGribCaptures(archive.captures,{locations,python});
const bad=structuredClone(archive.captures[0]);bad.decoded.points[0].valueC+=1;await assert.rejects(()=>replayGribCaptures([bad],{locations,python}),/replay differs/);
for(const name of ['test-gfs-decoder.py','test-ecmwf-decoder.py']){const r=await promisify(execFile)(python,['-I',fileURLToPath(new URL('weather/'+name,import.meta.url))],{timeout:15000,maxBuffer:1024*1024});process.stdout.write(r.stdout);}
console.log(`All ${archive.captures.length} actual packaged GRIB bodies reproduced their accepted point values/clocks; tamper rejected; no weather requests.`);
