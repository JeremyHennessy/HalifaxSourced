import {fileURLToPath} from 'node:url';
import {loadPublicModelProjection,publicModelBytes} from './lib/weather-model-publication.mjs';
import {writeIfChanged} from './lib/weather-capture.mjs';
const {projection}=await loadPublicModelProjection();
await writeIfChanged(fileURLToPath(new URL('../data/weather-models.js',import.meta.url)),publicModelBytes(projection));
await writeIfChanged(fileURLToPath(new URL('../data/build/halifax-weather-models.json',import.meta.url)),JSON.stringify(projection,null,2)+'\n');
console.log(`Reviewed model snapshot: ${projection.forecasts.length} point/valid-time cells; original aggregate issuance ${projection.issuedAt}; no source requests.`);
