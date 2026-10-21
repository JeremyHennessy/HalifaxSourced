import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { sourceRunHealth } from './lib/source-run-health.mjs';
const payload=JSON.parse(await readFile(new URL('../data/build/social-signals.json',import.meta.url),'utf8'));
const report={version:1,generatedAt:payload.generatedAt,workflowSuccessIsNotDataSuccess:true,meta:sourceRunHealth(payload),credentialState:payload.credentialState,profilesAttempted:payload.profilesAttempted||0,retainedPosts:payload.retainedPosts||0,storyCoverage:payload.storyCoverage||'not_supported_no_story_endpoint_or_archive',note:'Website RSS/Atom receipts are a separate source lane, not Facebook or Instagram access.'};
await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true});
await writeFile(new URL('../artifacts/social-collection-health.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
const summary=`Meta collection: ${report.meta.state}. ${report.profilesAttempted} profiles attempted; ${report.meta.postsReceived} posts received; ${report.meta.newOrChangedPosts} new or changed factual candidates; ${report.retainedPosts} older posts retained. A green workflow is not proof of live Meta access, fresh facts, or Stories coverage.\n`;
console.log(summary);
if(process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,summary);
