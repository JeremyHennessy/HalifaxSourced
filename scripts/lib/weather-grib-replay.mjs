// Optional local decoder replay. Never downloads packages or data and never activates sources.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {digest,locationContract} from './weather-aggregation.mjs';
const execute=promisify(execFile);
export async function replayGribCaptures(captures,{locations,python}){
 if(!captures.length)return;
 assert.ok(typeof python==='string'&&isAbsolute(python),'WEATHER_GRIB_PYTHON must explicitly name the reviewed isolated interpreter for raw GRIB replay');
 const points=locationContract(locations),directory=await mkdtemp(join(tmpdir(),'halifax-grib-replay-'));
 try{
  for(let i=0;i<captures.length;i++){
   const capture=captures[i];const provider={'gfs-temperature-eccodes-v1':'gfs','ecmwf-ifs-temperature-eccodes-v1':'ecmwf_ifs'}[capture.receipt.decoderId];assert.ok(provider,'unimplemented decoder');
   const body=Buffer.from(capture.bodyBase64,'base64');assert.ok(body.length>0&&body.length<=(provider==='gfs'?1024*1024:4*1024*1024));
   const path=join(directory,`${i}.grib2`),pointPath=join(directory,`${i}.points.json`);const selected=capture.decoded.points.map(p=>{const point=points.get(p.locationId);assert.ok(point);return {id:point.id,latitude:point.latitude,longitude:point.longitude};});
   await writeFile(path,body,{flag:'wx',mode:0o600});await writeFile(pointPath,JSON.stringify(selected),{flag:'wx',mode:0o600});
   const result=await execute(python,['-I',fileURLToPath(new URL('../weather/decode-gfs-temperature.py',import.meta.url)),path,pointPath,provider],{timeout:15000,maxBuffer:1024*1024,cwd:directory});
   assert.equal(digest(JSON.parse(result.stdout)),digest(capture.decoded),'raw GRIB decoder replay differs from claimed decoded output');
  }
 }finally{await rm(directory,{recursive:true,force:true});}
}
