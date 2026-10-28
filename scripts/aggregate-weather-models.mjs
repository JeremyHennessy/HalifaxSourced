// Explicit local accepted-input review tool, not a collector or a publication lane.
import assert from 'node:assert/strict';
import {readFile,writeFile,realpath} from 'node:fs/promises';
import {resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {aggregateIssuedArchive} from './lib/weather-model-archive.mjs';
import {replayGribCaptures} from './lib/weather-grib-replay.mjs';
const args=process.argv.slice(2);assert.equal(args.length,2,'usage: node scripts/aggregate-weather-models.mjs input-archive.json output-review.json');
const root=await realpath(fileURLToPath(new URL('../',import.meta.url))),input=await realpath(resolve(args[0])),requestedOutput=resolve(args[1]),output=resolve(await realpath(dirname(requestedOutput)),basename(requestedOutput));assert.notEqual(input,output);assert.ok(output!==root&&!output.startsWith(root+'/'),'review output must be outside repository/public data; parent directory must already exist');
globalThis.fetch=()=>{throw new Error('Review aggregation is offline only');};
const archiveBytes=await readFile(input);assert.ok(archiveBytes.length<=32*1024*1024,'archive byte budget');
const registry=JSON.parse(await readFile(new URL('../data/weather-model-registry.json',import.meta.url))),locations=JSON.parse(await readFile(new URL('../data/weather-locations.json',import.meta.url)));
const archive=JSON.parse(archiveBytes),result=aggregateIssuedArchive(archive,{registry,locations});await replayGribCaptures(archive.captures,{locations,python:process.env.WEATHER_GRIB_PYTHON});await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(`Review-only aggregation written; ${result.outputs.filter(o=>o.candidate).length} derived candidates. Publication and accuracy claims remain disabled.`);
