// Manual-only private review command. Never imported by builds or release workflows.
import assert from 'node:assert/strict';
import {refreshInputs,bootstrapModelRefresh,collectModelRefresh} from './lib/weather-model-refresh.mjs';
const [command,directory,...extra]=process.argv.slice(2);assert.ok(directory&&extra.length===0&&['bootstrap','collect'].includes(command),'Usage: node scripts/refresh-weather-models.mjs bootstrap|collect /absolute/private/durable/store');
assert.ok(!process.env.GITHUB_EVENT_NAME,'No hosted/scheduled producer adapter is activated');
const inputs=await refreshInputs();
if(command==='bootstrap'){await bootstrapModelRefresh(directory,inputs);console.log('Private review store initialized. No source requests; source collection remains policy-gated.');}
else{const {state,final}=await collectModelRefresh({directory,inputs,python:process.env.WEATHER_GRIB_PYTHON});console.log(JSON.stringify({disposition:state.disposition,lastAttempt:state.lastAttempt,candidate:state.candidate,final},null,2));if(state.disposition==='held')process.exitCode=1;}
