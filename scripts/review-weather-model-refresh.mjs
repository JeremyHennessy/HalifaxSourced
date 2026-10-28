// Explicit offline model-only review. Never invoked by preview, cron or release.
import assert from 'node:assert/strict';
import {packageModelRefresh,validateModelRefreshArtifact,applyModelRefreshArtifact} from './lib/weather-model-refresh-publication.mjs';
const [command,directory,output,...extra]=process.argv.slice(2);
assert.ok(['package','verify','apply'].includes(command)&&directory&&output&&extra.length===0,'Usage: WEATHER_GRIB_PYTHON=/reviewed/venv/bin/python node scripts/review-weather-model-refresh.mjs package|verify|apply /absolute/private/store /absolute/new/review-package');
assert.ok(!process.env.GITHUB_EVENT_NAME,'Local private-store review only; no hosted model persistence is activated');
const options={root:process.cwd(),directory,output,python:process.env.WEATHER_GRIB_PYTHON};
if(command==='package'){const result=await packageModelRefresh(options);console.log(`Prepared model-only review package (${result.files.length} files). Nothing accepted, deployed or activated.`);}
else if(command==='verify'){await validateModelRefreshArtifact(options);console.log('Exact private run, licensed evidence, raw decoder replay and model-only package verified.');}
else{const files=await applyModelRefreshArtifact(options);console.log(JSON.stringify({reviewBranchFiles:files,requiresNormalQualityGate:true,deployed:false,collectionActivated:false},null,2));}
