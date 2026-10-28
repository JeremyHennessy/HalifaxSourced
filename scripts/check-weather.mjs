// Semantic parity of the ACTUAL accepted current capture; not a historical date pin.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadCurrentWeather,jsonBytes,weatherBrowserBytes} from './lib/weather-capture.mjs';
const {envelope,manifest}=await loadCurrentWeather();
assert.equal(await readFile(new URL('../data/build/halifax-weather.json',import.meta.url),'utf8'),jsonBytes(envelope));
assert.equal(await readFile(new URL('../data/weather.js',import.meta.url),'utf8'),weatherBrowserBytes(envelope));
console.log(`Accepted weather semantic parity passed: ${manifest.captureSha256}, original retrieval ${envelope.lastKnownGood.retrievedAt}, latest outcome ${envelope.lastAttempt.status}.`);
