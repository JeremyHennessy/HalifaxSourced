import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {sourceEntry,snapshotValue} from './lib/update-consistency.mjs';
const read = async path => JSON.parse(await readFile(new URL(`../${path}`,import.meta.url),'utf8'));
const policy=await read('data/update-policy.json'), queue=await read('data/update-review-queue.json');
const sourceCommitSha=process.env.SOURCE_COMMIT_SHA||process.env.GITHUB_SHA;
if(!/^[a-f0-9]{40}$/.test(sourceCommitSha||'')) throw Error('Full source SHA required for update ledger');
const now=new Date().toISOString(), lanes=[];
for(const lane of policy.lanes) {
 const payload=await read(lane.path);
 lanes.push({...sourceEntry({...lane,payload,now,sourceCommitSha}),workflowUrl:`https://github.com/JeremyHennessy/HalifaxSourced/actions/workflows/${lane.workflow}`});
}
const preview=await read('data/build/preview-promotion-metadata.json');
const corrections=snapshotValue(await readFile(new URL('../data/reviewed-restaurant-corrections.js',import.meta.url),'utf8'));
const reviewedBatches=[{id:'reviewed-restaurant-corrections',reviewedAt:corrections.reviewedAt||null,scope:'Recorded corrections only, not the entire source lane.',path:'data/reviewed-restaurant-corrections.js'}];
if(preview.reviewedAt) reviewedBatches.push({id:preview.artifactName,reviewedAt:preview.reviewedAt,scope:'Recorded preview review; publication timestamp is not inferred.',path:'data/build/preview-promotion-metadata.json'});
const ledger={version:1,releaseBuiltAt:now,sourceCommitSha,qualityWorkflowRunId:process.env.QUALITY_WORKFLOW_RUN_ID||null,
 scope:'This immutable release only. Later attempts and unpublished previews are available in linked workflow runs; unknown dates stay unknown.',
 latestAcceptedPreview:{artifactName:preview.artifactName||null,runId:preview.artifactRunId||null,preparedAt:preview.generatedAt||null,sourceUrl:preview.sourceWorkflowRunUrl||null},
 reviewedBatches,lanes,queue:queue.items,policy:{publicationCoordinator:policy.publicationCoordinator,unchangedPolicy:policy.unchangedPolicy,restrictionPolicy:policy.restrictionPolicy}};
await mkdir(new URL('../data/build/',import.meta.url),{recursive:true});
await writeFile(new URL('../data/build/update-ledger.json',import.meta.url),JSON.stringify(ledger,null,2)+'\n');
console.log(`Update ledger: ${lanes.length} source lanes, ${queue.items.length} review items; source observations remain independent of release time.`);
