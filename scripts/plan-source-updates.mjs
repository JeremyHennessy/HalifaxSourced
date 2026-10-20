// Cheap, read-only human review plan. Operational artifact coordination lives in coordinate-preview-updates.mjs.
import {readFile} from 'node:fs/promises';
const read=async path=>JSON.parse(await readFile(new URL(`../${path}`,import.meta.url),'utf8'));
const ledger=await read('data/build/update-ledger.json'), queue=await read('data/update-review-queue.json');
const now=Date.now();
const due=ledger.lanes.filter(lane=>!lane.nextDueAt||Date.parse(lane.nextDueAt)<=now).map(lane=>({lane:lane.id,reason:lane.nextDueAt?'accepted source observation overdue':'observation unknown',workflow:lane.workflowUrl,nextAction:'Inspect latest workflow outcome before collecting or opening a new PR.'}));
console.log(JSON.stringify({readOnly:true,asOf:new Date().toISOString(),due,blocked:queue.items.filter(item=>item.state==='blocked'),review:queue.items.filter(item=>item.state!=='blocked').sort((a,b)=>a.priority-b.priority),noAutomaticRetry:true},null,2));
