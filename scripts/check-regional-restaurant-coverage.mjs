import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import identity from '../app-restaurant-identity.js';
import { localRestaurantPolicyDecision } from './lib/local-restaurant-policy.mjs';
const json = async file => JSON.parse(await readFile(new URL('../'+file,import.meta.url),'utf8'));
const [catalog,review,matrix,directory] = await Promise.all(['data/build/catalog.json','data/reviewed-regional-restaurants.json','data/regional-restaurant-coverage.json','data/build/directory-restaurant-leads.json'].map(json));
assert.equal(matrix.districts.length,16,'All 16 HRM district audit lanes must remain represented');
assert.equal(new Set(matrix.districts.map(d=>d.district)).size,16);
assert(matrix.districts.every(d=>d.subcommunityAuditChecklist.length&&d.sourcePlan&&d.status!=='complete'),'A checklist is not a completed census');
const enrichment = await json("data/reviewed-regional-enrichment.json");
assert.equal(enrichment.records.length, review.accepted.length);
const enrichmentById = new Map(enrichment.records.map(row => [row.id,row]));
const known=new Map(catalog.restaurants.map(r=>[r.id,r]));
const failures=[];
for(const item of review.accepted){
 const r=known.get(item.id);
 if(!r||r.address!==item.address||!item.sourceUrls.length||!item.ownershipEvidence||!item.operationEvidence) failures.push({id:item.id,reason:'missing_exact_reviewed_identity_or_evidence'});
 if(r&&localRestaurantPolicyDecision(r).excluded) failures.push({id:item.id,reason:'excluded_by_local_policy'});
 const fields=enrichmentById.get(item.id)?.fields;
 if(!fields || Object.keys(fields).length!==5) failures.push({id:item.id,reason:'missing_enrichment_disposition'});
 for(const [key,field] of Object.entries(fields||{})) if(field.status==='verified' && (!field.freshContentReceived || !field.successfulSourceReceipts?.length || !field.successfulSourceReceipts.some(receipt=>receipt.sha256) || field.successfulSourceReceipts.some(receipt=>receipt.httpStatus!==200))) failures.push({id:item.id,field:key,reason:'missing_successful_content_receipt'});
 if(r?.coordinates && (fields?.coordinates.status!=='verified' || JSON.stringify(r.coordinates)!==JSON.stringify(fields.coordinates.value))) failures.push({id:item.id,reason:'unreviewed_coordinates'});
 if(r?.openingHours && (fields?.hours.status!=='verified' || r.openingHours!==fields.hours.publishedText)) failures.push({id:item.id,reason:'unreviewed_hours'});
 if(r?.operatingStatus==='seasonally_closed'&&!r.operatingStatusEvidence?.claim) failures.push({id:item.id,reason:'seasonal_status_missing_evidence'});
}
const normalize = identity.nameKey;
const heldNames=new Map(review.held.map(item=>[normalize(item.name),item]));
const dispositions=(directory.records||[]).map(item=>{
 const policy=localRestaurantPolicyDecision(item);
 if(policy.excluded)return {id:item.id,name:item.name,sourceId:item.sourceId,sourceUrl:item.sourceUrl,observedAt:item.observedAt,state:'excluded_non_local_policy',reason:policy.reason};
 const held=heldNames.get(normalize(item.name));
 if(held)return {id:item.id,name:item.name,sourceId:item.sourceId,sourceUrl:item.sourceUrl,observedAt:item.observedAt,state:'held_reviewed_evidence',reason:held.decision||held.disposition||held.recommendation||'unresolved_source_evidence'};
 // The directory's broad city labels (e.g. Halifax Metro) are not municipalities.
 const decision=identity.find(catalog.restaurants,{...item,city:undefined});
 return {id:item.id,name:item.name,sourceId:item.sourceId,sourceUrl:item.sourceUrl,observedAt:item.observedAt,state:decision.state==='match'?'canonical_location_present':decision.state==='review'?'held_location_identity':'unreviewed_ownership_operation_or_location',matchedRestaurantId:decision.record?.id||null,candidateIds:decision.candidateIds||[],reason:decision.reason};
});
const counts={};for(const row of dispositions)counts[row.state]=(counts[row.state]||0)+1;
assert.equal(dispositions.length,(directory.records||[]).length);
assert.equal(Object.values(counts).reduce((a,b)=>a+b,0),dispositions.length);
const byCommunity={};for(const row of review.accepted){byCommunity[row.community]||=[];byCommunity[row.community].push(row.id);}
const snapshot={version:1,generatedAt:new Date().toISOString(),reviewedAt:review.reviewedAt,sourceCommitSha:process.env.SOURCE_COMMIT_SHA||process.env.GITHUB_SHA||null,scope:review.scope,completeCensus:false,counts:{canonicalLocations:catalog.restaurants.length,baselineCanonicalLocations:review.baselineCanonicalRecords,acceptedRegionalLocations:review.accepted.length,netCanonicalIncrease:catalog.restaurants.length-review.baselineCanonicalRecords,seasonallyClosedAccepted:review.accepted.filter(row=>known.get(row.id)?.operatingStatus==='seasonally_closed').length,heldReviewEntries:review.held.length,directoryObservations:dispositions.length,directoryDispositions:counts},byCommunity,districtAuditLanes:matrix.districts,identityReviewQueue:catalog.identityReviewQueue||[],enrichmentSummary:enrichment.summary,sourceGaps:matrix.sourceGaps,remainingEvidence:review.held,dispositions,failures};
await writeFile(new URL('../data/build/regional-restaurant-coverage-report.json',import.meta.url),JSON.stringify(snapshot,null,2)+'\n');
await writeFile(new URL('../docs/regional-restaurant-coverage.md',import.meta.url),`# Regional restaurant coverage\n\nReviewed ${review.reviewedAt}. This is a bounded, source-reviewed expansion, not an exhaustive census.\n\n${review.accepted.length} reviewed regional locations are represented; the canonical catalog has ${catalog.restaurants.length} locations, compared with ${review.baselineCanonicalRecords} before this batch. ${snapshot.counts.seasonallyClosedAccepted} new location is closed for the season, not permanently closed. No new coordinates or hours were guessed.\n\n## Accepted locations by community\n\n${Object.entries(byCommunity).sort((a,b)=>a[0].localeCompare(b[0])).map(([area,ids])=>`- ${area}: ${ids.length}`).join('\n')}\n\n## Existing source queue\n\nAll ${dispositions.length} directory observations were reconciled, not automatically published. These are observations, not unique restaurants.\n\n${Object.entries(counts).map(([state,count])=>`- ${state}: ${count}`).join('\n')}\n\n## What remains\n\n${review.held.length} reviewed hold entries retain source-specific uncertainty. In particular, inland Musquodoboit Valley, Waverley proper and the airport/northern boundary still need exact-location, ownership or current-operation evidence. Morris East Bedford is not duplicated or relocated from proximity alone. Watermark is independently verified at the former Rhubarb site; the former operators' Hazel's is a separate Liverpool business. No old Rhubarb menu, hours, images or identity are transferred.\n\nAll 16 HRM district audit lanes and their practical subcommunity checklists remain partial. Existing neighborhood labels understate rural coverage, so zero accepted additions in an area is not proof that no restaurant is present there. Nearby Hubbards is included as a labeled surrounding community, not automatically assigned to HRM.\n\n${matrix.sourceGaps.map(item=>`- ${item.source}: ${item.state}. ${item.action}`).join('\n')}\n\n## Evidence and maintenance\n\nAll 47 regional locations have per-field dispositions in [the enrichment ledger](../data/reviewed-regional-enrichment.json), with successful direct source receipts for published additions. Service-specific hours are labeled and uncertain fields remain unknown. Location-specific sources and field caveats are retained in [the reviewed batch](../data/reviewed-regional-restaurants.json). The [source matrix](../data/regional-restaurant-coverage.json) defines the finite audit baseline and residual source work. The [full reconciliation report](../data/build/regional-restaurant-coverage-report.json) accounts for every directory observation. Names, shared websites and shared building numbers are not sufficient to merge restaurants; ambiguous cases stay in review.\n`);
if(failures.length){console.error(failures);process.exit(1);}
console.log(JSON.stringify(snapshot.counts,null,2));
