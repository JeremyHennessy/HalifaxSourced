import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createNewsRecoveryApprovalDescriptor, NEWS_RECOVERY_ANCHOR } from './lib/news-preview-recovery.mjs';
import { payloadDigest } from './lib/news-run-lineage.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const [approvedCommit,expectedRunNumber,checkpointMode]=process.argv.slice(2);
if(!/^[a-f0-9]{40}$/.test(approvedCommit||'')||!/^([1-9][0-9]*)$/.test(expectedRunNumber||'')||!['exact-cache','exact-artifact'].includes(checkpointMode))throw new Error('usage: node scripts/prepare-news-recovery-descriptor.mjs <approved-commit-sha> <expected-run-number> <exact-cache|exact-artifact>');
const evidence=JSON.parse(await readFile(resolve(root,'news-evidence/recovery-gap-history-20261101.json'),'utf8'));
const last=evidence.runs.at(-1);
if(!last||Number(expectedRunNumber)!==last.number+1||evidence.runs.some((run,index)=>run.number!==index+6||run.conclusion!=='failure'||run.attempt!==1))throw new Error('recovery_gap_evidence_not_contiguous');
const registry=JSON.parse(await readFile(resolve(root,'data/news-source-registry.json'),'utf8'));
const policy=await readFile(resolve(root,'data/source-link-access-holds.json'));
const registryBytes=await readFile(resolve(root,'data/news-source-registry.json'));
const normalizedRuns=evidence.runs.map(run=>({run:{id:run.id,runNumber:run.number,attempt:run.attempt,event:run.event,status:run.status,conclusion:run.conclusion,sha:run.headSha}}));
const descriptor=createNewsRecoveryApprovalDescriptor({anchor:NEWS_RECOVERY_ANCHOR,evidence:{current:{run_number:Number(expectedRunNumber)},predecessor:normalizedRuns.at(-1).run,gaps:normalizedRuns},checkpointMode,registry,registrySha256:payloadDigest(registryBytes),accessPolicySha256:payloadDigest(policy),approvedCommit});
process.stdout.write(`${JSON.stringify({descriptor:descriptor.descriptor,sha256:descriptor.sha256},null,2)}\n`);
