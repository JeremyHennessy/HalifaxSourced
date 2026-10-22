import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateAccessPolicy, createAccessHolds, holdForObservation, digest } from './lib/link-access-policy.mjs';

// All log/job identities below are synthetic fixtures, not externally verified
// GitHub evidence. Operational admission still requires independent retrieval.
const clone = value => structuredClone(value);
const committed = JSON.parse(await readFile(new URL('../data/source-link-access-holds.json',import.meta.url),'utf8'));
validateAccessPolicy(committed);
const root = await mkdtemp(join(tmpdir(),'halifax-reviewed-log-policy-'));
let rejected = 0;
try {
  for (const path of ['scripts/lib/source-access-state.mjs','scripts/lib/link-access-policy.mjs','scripts/lib/deny-source-network.mjs','source-integrity.js','data/source-link-access-holds.json']) {
    await mkdir(dirname(join(root,path)),{recursive:true});
    await copyFile(new URL('../'+path,import.meta.url),join(root,path));
  }
  await writeFile(join(root,'runner.mjs'), `
import { sourceAccessState } from './scripts/lib/source-access-state.mjs';
globalThis.fetch=()=>{throw Error('No transport is permitted by this fixture');};
const state=sourceAccessState();
for(const status of [401,403,429]) {
  const request=state.start('https://status-'+status+'.fixture.example/source','https://status-'+status+'.fixture.example/source');
  state.response(request,new Response('restricted',{status,headers:{'content-type':'text/html','retry-after':'5'}}),status===429);
}
`);
  const env = {...process.env,SOURCE_COMMIT_SHA:'a'.repeat(40),GITHUB_RUN_ID:'12345',GITHUB_RUN_ATTEMPT:'2',GITHUB_JOB:'audit'};
  const run = spawnSync(process.execPath,['--import',join(root,'scripts/lib/deny-source-network.mjs'),join(root,'runner.mjs')],{cwd:root,env,encoding:'utf8',timeout:10000});
  assert.equal(run.error,undefined); assert.equal(run.signal,null); assert.equal(run.status,1,run.stderr);
  const lines = run.stderr.trim().split('\n');
  assert.equal(lines.length,3);
  const prefix='HALIFAX_SOURCE_ACCESS_DIAGNOSTIC ';
  assert(lines.every(line=>line.startsWith(prefix)));
  const diagnostics=lines.map(line=>JSON.parse(line.slice(prefix.length)));
  const persisted=(await readFile(join(root,'artifacts/source-access-diagnostics.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(persisted,diagnostics);
  const logSha256=createHash('sha256').update(run.stderr).digest('hex');
  const groupFor = diagnostic => ({
    provenance:{kind:'reviewed_workflow_log',repository:'JeremyHennessy/HalifaxSourced',sourceCommitSha:diagnostic.sourceCommitSha,workflowRunId:diagnostic.sourceWorkflowRunId,workflowRunAttempt:diagnostic.sourceWorkflowRunAttempt,workflowJob:diagnostic.workflowJob,workflowJobId:98765,accessPolicySha256:diagnostic.accessPolicySha256,logSha256,diagnosticSha256:digest(diagnostic),receiptSha256:digest(diagnostic.evidence.receipt),loggedAt:diagnostic.loggedAt,diagnostic:clone(diagnostic)},
    observations:[clone(diagnostic.evidence.hold.evidence)]
  });
  const groups=diagnostics.map(groupFor);
  const baseline={version:1,policy:'link_qa_access_holds',resume:'reviewed_evidence_required',...groups[0],historicalEvidence:groups.slice(1)};
  validateAccessPolicy(baseline);
  const holds=createAccessHolds(baseline);
  assert(holds.find('https://status-401.fixture.example/source'));
  assert.equal(holds.find('https://status-401.fixture.example/other'),null);
  assert(holds.find('https://www.status-429.fixture.example./other'));
  validateAccessPolicy({...clone(committed),historicalEvidence:[...(committed.historicalEvidence||[]),...groups]});
  for (const group of groups) validateAccessPolicy({version:1,policy:'link_qa_access_holds',resume:'reviewed_evidence_required',...clone(group)});

  // Rehashing after hostile mutations proves validation checks cross-field
  // semantics, not merely the presence of self-consistent supplied digests.
  function reject(label, mutate, rehash=true) {
    const candidate=clone(baseline), p=candidate.provenance;
    mutate(candidate,p,p.diagnostic);
    if(rehash && p.diagnostic?.evidence?.receipt) {p.receiptSha256=digest(p.diagnostic.evidence.receipt);p.diagnosticSha256=digest(p.diagnostic);}
    assert.throws(()=>validateAccessPolicy(candidate),undefined,label); rejected++;
  }
  reject('unknown provenance kind',(_,p)=>{p.kind='other';});
  reject('absent variant',(_,p)=>{delete p.kind;});
  reject('unknown override',(_,p)=>{p.resume='automatic';});
  for(const key of ['repository','sourceCommitSha','workflowRunId','workflowRunAttempt','workflowJob','workflowJobId','accessPolicySha256','logSha256','diagnosticSha256','receiptSha256','loggedAt','diagnostic']) reject('missing '+key,(_,p)=>{delete p[key];},false);
  for(const key of ['logSha256','diagnosticSha256','receiptSha256','accessPolicySha256']) reject('malformed '+key,(_,p)=>{p[key]='not-a-hash';},false);
  for(const key of ['sourceCommitSha','sourceWorkflowRunId','sourceWorkflowRunAttempt','accessPolicySha256','repository','workflowJob','loggedAt']) reject('diagnostic context '+key,(_,p,d)=>{d[key]=key==='loggedAt'?'2001-01-01T00:00:00.000Z':'mismatch';});
  for(const key of ['sourceCommitSha','workflowRunId','workflowRunAttempt','workflowJob','repository','accessPolicySha256']) reject('provenance context '+key,(_,p)=>{p[key]='mismatch';});
  for(const value of [null,0,-1,'98765',1.5,Number.MAX_SAFE_INTEGER+1]) reject('invalid numeric job ID '+value,(_,p)=>{p.workflowJobId=value;});
  for(const kind of ['unsettled_transport','other','']) reject('not genuine HTTP restriction '+kind,(_,p,d)=>{d.kind=kind;});
  reject('missing version',(_,p,d)=>{delete d.version;});
  reject('publishable diagnostic',(_,p,d)=>{d.disposition='publishable';});
  reject('extra diagnostic override',(_,p,d)=>{d.release=true;});
  reject('late flag mismatch',(_,p,d)=>{d.evidence.late=true;});
  reject('normal response with suspension',(_,p,d)=>{d.evidence.suspensionId='b'.repeat(64);});
  reject('receipt status mismatch',(_,p,d)=>{d.evidence.receipt.status=429;});
  reject('receipt URL mismatch',(_,p,d)=>{d.evidence.receipt.url='https://status-401.fixture.example/other';});
  reject('receipt timestamp mismatch',(_,p,d)=>{d.evidence.receipt.observedAt='2001-01-01T00:00:00.000Z';});
  reject('receipt request ID mismatch',(_,p,d)=>{d.evidence.receipt.requestId='2';});
  reject('forged status200',(_,p,d)=>{d.evidence.receipt.status=d.evidence.hold.evidence.status=200;});
  reject('forged statusnull',(_,p,d)=>{d.evidence.receipt.status=d.evidence.hold.evidence.status=null;});
  reject('altered receipt hash',(_,p)=>{p.receiptSha256='b'.repeat(64);},false);
  reject('altered diagnostic hash',(_,p)=>{p.diagnosticSha256='b'.repeat(64);},false);
  reject('altered hold ID',(_,p,d)=>{d.evidence.hold.id='b'.repeat(64);});
  reject('broaden exact URL to host',(_,p,d)=>{d.evidence.hold.scope='host';});
  reject('hold source SHA mismatch',(_,p,d)=>{d.evidence.hold.provenance.sourceCommitSha='b'.repeat(40);});
  reject('hold policy mismatch',(_,p,d)=>{d.evidence.hold.provenance.accessPolicySha256='b'.repeat(64);});
  reject('hold run mismatch',(_,p,d)=>{d.evidence.hold.provenance.sourceWorkflowRunId='22';});
  reject('hold attempt mismatch',(_,p,d)=>{d.evidence.hold.provenance.sourceWorkflowRunAttempt='22';});
  reject('hold request ID mismatch',(_,p,d)=>{d.evidence.hold.provenance.requestId='22';});
  reject('hold kind mismatch',(_,p,d)=>{d.evidence.hold.provenance.kind='committed_policy';});
  reject('selected observation differs',candidate=>{candidate.observations[0].url='https://status-401.fixture.example/other';});
  reject('extra selected observation',candidate=>{candidate.observations.push(clone(candidate.historicalEvidence[0].observations[0]));});
  reject('missing selected observation',candidate=>{candidate.observations=[];});
  reject('duplicate cross-group observation',candidate=>{candidate.historicalEvidence.push({provenance:clone(candidate.provenance),observations:clone(candidate.observations)});});
  reject('attempt after observation',(_,p,d)=>{d.evidence.receipt.attemptedAt=new Date(Date.parse(d.evidence.receipt.observedAt)+1).toISOString();});
  reject('observation after loggedAt',(_,p,d)=>{p.loggedAt=d.loggedAt=new Date(Date.parse(d.evidence.receipt.observedAt)-1).toISOString();});
  for(const value of [null,'2026-02-31T00:00:00.000Z','2026-10-22T00:00:00','2026-10-22T00:00:00Z','nonsense']) {
    reject('malformed loggedAt '+value,(_,p,d)=>{p.loggedAt=d.loggedAt=value;});
    reject('malformed attemptedAt '+value,(_,p,d)=>{d.evidence.receipt.attemptedAt=value;});
  }
  reject('future loggedAt',(_,p,d)=>{p.loggedAt=d.loggedAt='2099-01-01T00:00:00.000Z';});
  reject('future entire receipt', (candidate,p,d)=>{
    p.loggedAt=d.loggedAt='2099-01-01T00:00:01.000Z';
    d.evidence.receipt.attemptedAt=d.evidence.receipt.observedAt=d.evidence.hold.evidence.observedAt='2099-01-01T00:00:00.000Z';
    d.evidence.hold=holdForObservation(d.evidence.hold.evidence,d.evidence.hold.provenance);candidate.observations=[clone(d.evidence.hold.evidence)];
  });
  reject('missing retry provenance',(_,p,d)=>{delete d.evidence.receipt.retryNotBefore;});
  reject('altered retry provenance',(_,p,d)=>{d.evidence.receipt.retryNotBefore=null;});
  reject('unknown historical provenance',candidate=>{candidate.historicalEvidence[0].provenance.kind='unreviewed_log';});
  assert.throws(()=>validateAccessPolicy({...clone(committed),provenance:{...clone(committed.provenance),kind:'artifact_report'}}));rejected++;
  function rejectArtifact(label,mutate) {
    const candidate=clone(committed);mutate(candidate.provenance,candidate);
    assert.throws(()=>validateAccessPolicy(candidate),undefined,label);rejected++;
  }
  for(const key of Object.keys(committed.provenance)) {
    rejectArtifact('missing artifact '+key,p=>{delete p[key];});
    rejectArtifact('array coercion artifact '+key,p=>{p[key]=[p[key]];});
  }
  for(const key of ['workflowRunId','artifactId']) for(const value of [12345,0,'0','01','-1',null]) rejectArtifact('nonpositive/nonstring artifact '+key,p=>{p[key]=value;});
  rejectArtifact('unsupported artifact override',p=>{p.expiresAt='2099-01-01T00:00:00.000Z';});
  rejectArtifact('unknown historical artifact override',(p,candidate)=>{candidate.historicalEvidence[0].provenance.release=true;});
  for(const value of ['2099-01-01T00:00:00.000Z','2026-02-31T00:00:00.000Z','2026-10-22T12:00:00','2026-10-22T12:00:00Z','not-a-clock']) rejectArtifact('invalid artifact clock '+value,p=>{p.reportGeneratedAt=value;});
  for(const value of [null,[],{},'2026-02-31T00:00:00.000Z','2026-10-22T01:00:00','2026-10-22T01:00:00Z','not-a-clock']) {
    rejectArtifact('malformed artifact observation '+JSON.stringify(value),(_,candidate)=>{candidate.observations[0].observedAt=value;});
    rejectArtifact('malformed historical observation '+JSON.stringify(value),(_,candidate)=>{candidate.historicalEvidence[0].observations[0].observedAt=value;});
  }
  const local=spawnSync(process.execPath,['--import',join(root,'scripts/lib/deny-source-network.mjs'),join(root,'runner.mjs')],{cwd:root,env:{...env,GITHUB_JOB:''},encoding:'utf8',timeout:10000});
  assert.equal(local.error,undefined);assert.equal(local.signal,null);assert.equal(local.status,1);
  const localDiagnostic=JSON.parse(local.stderr.trim().split('\n')[0].slice(prefix.length));
  assert.equal(localDiagnostic.workflowJob,null);
  assert.throws(()=>validateAccessPolicy({version:1,policy:'link_qa_access_holds',resume:'reviewed_evidence_required',...groupFor(localDiagnostic)}));rejected++;
  console.log('Reviewed workflow-log policy provenance passed: '+rejected+' hostile variants rejected; legacy artifact, exact401/403, host429 and late HTTP fixtures accepted; diagnostic emission verified offline. External log authenticity is not asserted.');
} finally { await rm(root,{recursive:true,force:true}); }
