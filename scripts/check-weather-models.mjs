import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadPublicModelProjection,publicModelBytes} from './lib/weather-model-publication.mjs';
const {projection}=await loadPublicModelProjection();
assert.equal(await readFile(new URL('../data/weather-models.js',import.meta.url),'utf8'),publicModelBytes(projection));
assert.deepEqual(JSON.parse(await readFile(new URL('../data/build/halifax-weather-models.json',import.meta.url))),projection);
assert.equal(projection.accuracyImprovementEstablished,false);
console.log(`Actual accepted model snapshot semantic parity passed: ${projection.archiveSha256}; ${projection.forecasts.length} cells, no fixture-pinned release clock.`);
