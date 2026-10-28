// Offline accepted-current projection. Immutable regression fixtures are never release inputs.
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {loadCurrentWeather,jsonBytes,weatherBrowserBytes,writeIfChanged} from './lib/weather-capture.mjs';
const root=new URL('../',import.meta.url);
export async function buildWeather(){
  const {envelope}=await loadCurrentWeather(root);
  await mkdir(new URL('data/build/',root),{recursive:true});
  await writeIfChanged(new URL('data/build/halifax-weather.json',root),jsonBytes(envelope));
  await writeIfChanged(new URL('data/weather.js',root),weatherBrowserBytes(envelope));
  return envelope;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){await buildWeather();console.log('Accepted current weather projected offline; no source request or clock advances.');}
