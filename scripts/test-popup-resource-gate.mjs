import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {installOfflineResources} from './lib/offline-browser-resources.mjs';
let playwright;for(const candidate of [process.env.PLAYWRIGHT_MODULE,'file:///C:/Users/JeremyHennessy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs','playwright'].filter(Boolean)){try{playwright=await import(candidate);break;}catch{}}
if(!playwright)throw Error('Playwright required');
const browser=await playwright.chromium.launch({headless:true,executablePath:[process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','/usr/bin/chromium'].filter(Boolean).find(existsSync)});
const unknown='https://unreviewed-popup.example/first-navigation',evidence=[];
try{
 const context=await browser.newContext({serviceWorkers:'block'}),gate=await installOfflineResources(context,'http://127.0.0.1:5173');const page=await context.newPage();
 await page.setContent('<button id="open" onclick="window.open(\''+unknown+'\',\'_blank\')">Open fixture popup</button>');
 const failed=context.waitForEvent('requestfailed',{predicate:r=>r.url()===unknown});const popupEvent=context.waitForEvent('page');await page.locator('#open').click();const popup=await popupEvent;const failedRequest=await failed;
 assert.deepEqual(gate.evidence.unknown,[{url:unknown,method:'GET',resourceType:'document'}]);assert.equal(failedRequest.failure()?.errorText,'net::ERR_BLOCKED_BY_CLIENT');assert.equal(gate.evidence.requests.find(r=>r.url===unknown)?.action,'fatal unknown; blocked before transmission');assert.throws(()=>gate.assertClean(),/Unknown external request is fatal/);
 evidence.push({control:'unknown popup first navigation',blockedBeforeTransmission:true,unknown:gate.evidence.unknown,failure:failedRequest.failure(),fatal:true});await popup.close();await context.close();
 const errorContext=await browser.newContext({serviceWorkers:'block'}),errorGate=await installOfflineResources(errorContext,'http://127.0.0.1:5173'),main=await errorContext.newPage();
 const aboutPopupEvent=errorContext.waitForEvent('page');await main.evaluate(()=>window.open('about:blank','_blank'));const aboutPopup=await aboutPopupEvent;
 await aboutPopup.evaluate(()=>console.error('controlled popup console error'));
 const webErrorEvent=errorContext.waitForEvent('weberror');await aboutPopup.evaluate(()=>setTimeout(()=>{throw Error('controlled popup script error');},0));await webErrorEvent;
 assert(errorGate.evidence.console.some(e=>e.text==='controlled popup console error'));assert(errorGate.evidence.pageErrors.includes('controlled popup script error'));assert.throws(()=>errorGate.assertClean(),/Unexpected browser script error/);
 evidence.push({control:'all-page console and script errors',console:errorGate.evidence.console,pageErrors:errorGate.evidence.pageErrors,fatal:true});await errorContext.close();
 await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true});await writeFile(new URL('../artifacts/popup-resource-controls.json',import.meta.url),JSON.stringify(evidence,null,2));console.log('Context gate blocks unknown popup first navigation and captures errors from every page.');
}finally{await browser.close();}
