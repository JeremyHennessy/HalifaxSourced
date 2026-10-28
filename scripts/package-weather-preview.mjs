import {readFile} from 'node:fs/promises';
import {packageWeather} from './lib/weather-publication.mjs';
const plan=JSON.parse(await readFile('artifacts/weather-preview-lineage-plan.json','utf8'));
const packaged=await packageWeather({root:process.cwd(),output:'artifacts/weather-publication',payloadBytes:await readFile('artifacts/weather-preview.json','utf8'),receipt:JSON.parse(await readFile('artifacts/weather-preview-final.json','utf8')),identity:plan.current});
console.log(packaged?'Validated weather-only review artifact prepared.':'No accepted source refresh for publication; private continuity/evidence only. No public artifact prepared.');
