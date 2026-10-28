// Offline recorded-fixture projection only. Never obtains new source data or refreshes clocks.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {projectEccc,acceptedEnvelope} from './lib/eccc-weather.mjs';
const root=new URL('../',import.meta.url);
export async function buildWeather() {
  const body=await readFile(new URL('scripts/fixtures/weather/eccc-citypage-20261028.json',root),'utf8');
  const receipt=JSON.parse(await readFile(new URL('scripts/fixtures/weather/eccc-citypage-20261028-receipt.json',root),'utf8'));
  const payload=acceptedEnvelope(projectEccc(body,receipt),receipt);
  const json=JSON.stringify(payload,null,2)+'\n';
  await mkdir(new URL('data/build/',root),{recursive:true});
  for(const [path,value] of [['data/build/halifax-weather.json',json],['data/weather.js','// Recorded ECCC evidence. Offline builds preserve all original clocks.\nwindow.HalifaxWeather = '+json.trim()+';\n']]) {
    let before;try{before=await readFile(new URL(path,root),'utf8')}catch(error){if(error.code!=='ENOENT')throw error;}
    if(before!==value)await writeFile(new URL(path,root),value);
  }
  return payload;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){await buildWeather();console.log('Recorded weather projected offline; no clock advances, collection or activation.');}
