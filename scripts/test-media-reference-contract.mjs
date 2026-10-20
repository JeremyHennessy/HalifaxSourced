import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import { AUTOMATIC_THUMBNAIL_POLICY } from './lib/automatic-thumbnail-approval.mjs';
import {mediaPermitted,referenceProblems} from './lib/media-rights-contract.mjs';
const load=async(path,key)=>{const c={window:{}};vm.runInNewContext(await readFile(new URL('../'+path,import.meta.url),'utf8'),c);return JSON.parse(JSON.stringify(c.window[key]));};
const refs=(await load('data/restaurant-media-references.js','HALIFAX_MEDIA_SOURCE_REFERENCES')).records;
const media=(await load('data/restaurant-media.js','HALIFAX_RESTAURANT_MEDIA')).records;
assert.equal(refs.length,99);
const preservation=JSON.parse(await readFile(new URL('./fixtures/media-preservation.json',import.meta.url),'utf8'));
const claims=JSON.parse(await readFile(new URL('../data/audit/media-rights-reclassification.json',import.meta.url),'utf8')).previousClaims;
const mediaKey=record=>JSON.stringify([record.restaurantId,String(record.url || record.thumbnailUrl).replace(/^\.\//,'')]);
const preservedKeys=new Set(preservation.licensedRecords.map(mediaKey));
assert.equal(preservation.licensedRecords.length,7);
assert.deepEqual(media.filter(record=>preservedKeys.has(mediaKey(record))),preservation.licensedRecords);
const automaticMedia=media.filter(record=>record.approvalMethod===AUTOMATIC_THUMBNAIL_POLICY);
const addedMedia=media.filter(record=>!preservedKeys.has(mediaKey(record))&&record.approvalMethod!==AUTOMATIC_THUMBNAIL_POLICY);
assert.deepEqual(addedMedia.map(({restaurantId,sourceUrl,reviewedAt})=>({restaurantId,sourceUrl,reviewedAt})),[
  {restaurantId:'osm-way-96322798-wooden-monkey',sourceUrl:'https://commons.wikimedia.org/wiki/File:Wooden_Monkey_Restaurant,_Halifax,_Nova_Scotia_(25274647981).jpg',reviewedAt:'2026-10-20'},
  {restaurantId:'osm-node-886747513-trident-booksellers-and-cafe',sourceUrl:'https://commons.wikimedia.org/wiki/File:DSC07401_(7172975247).jpg',reviewedAt:'2026-10-20'}
]);
assert.equal(media.length,preservation.licensedRecords.length+2+automaticMedia.length);
for(const record of automaticMedia){assert(mediaPermitted(record));assert(/^[a-f0-9]{64}$/.test(record.assetSha256));assert(record.assessmentId&&record.assessedAt&&record.rightsEvidenceUrl);}
assert.equal(claims.length,preservation.archivedClaimsCount);assert.equal(createHash('sha256').update(JSON.stringify(claims)).digest('hex'),preservation.archivedClaimsSha256);
for(const record of refs){const prior=claims.find(r=>r.restaurantId===record.restaurantId&&r.url===record.url);assert(prior);for(const key of ['restaurantId','url','sourceUrl','alt','creator'])assert.equal(record[key],prior[key]);}
for(const record of refs){assert.deepEqual(referenceProblems(record),[]);assert.equal(mediaPermitted(record),false);for(const conflict of [{permission:'licensed'},{permissionConfirmed:true},{ownerApproved:true},{license:'CC BY-SA 4.0'},{licence:'CC BY-SA 4.0'},{rightsStatus:'production_approved'},{reviewStatus:'approved'},{renderable:true},{url:'javascript:alert(1)'},{sourceUrl:'broken'},{restaurantId:''},{creator:''},{alt:''},{rightsBasis:'Owner grants reuse'},{permissionSource:'licensed'},{rightsNote:'Licensed media'}])assert(referenceProblems({...record,...conflict}).length,JSON.stringify(conflict));}
for(const record of media){assert(mediaPermitted(record));for(const conflict of [{quarantined:true},{rightsStatus:'unverified'},{permissionConfirmed:false},{creator:''},{license:''},{reviewStatus:'denied'},{rights:'restricted'},{url:'assets/../outside.jpg'},{attribution:''},{alt:'short'},{url:'assets/logo.jpg'},{url:'http://example.test/photo.jpg'},{thumbnailUrl:'assets/logo.jpg'},{url:'https://user:password@example.test/photo.jpg'},{sourceUrl:'https://user:password@example.test/source'}])assert.equal(mediaPermitted({...record,...conflict}),false,JSON.stringify(conflict));}
assert(mediaPermitted({...media[0],sourceType:'restaurant_owner_submission',permission:'owner_submitted',rightsState:'owner_authorized',license:'Fixture owner written grant',rightsBasis:'Specific fixture owner permission',ownerApproved:true}));
const candidatePayload=await load('data/thumbnail-candidates.js','HALIFAX_THUMBNAIL_CANDIDATES');
const candidates=candidatePayload.candidates;
// Candidate snapshots retain their own restaurant scope. Do not compare an old
// accepted snapshot against today's catalog or replace identity checks with totals.
const snapshotRestaurantIds=new Set([...candidates,...candidatePayload.missingAnyCandidate].map(record=>record.restaurantId));
assert.equal(snapshotRestaurantIds.size,candidatePayload.counts.restaurants);
const sortedKeys=records=>records.map(mediaKey).sort();
const normalizedReferences=candidates.filter(r=>r.sourceKind==='retained_media_reference');assert.deepEqual(sortedKeys(normalizedReferences),sortedKeys(refs.filter(record=>snapshotRestaurantIds.has(record.restaurantId))));assert.equal(normalizedReferences.length,candidatePayload.counts.sourceKindCounts.retained_media_reference);
for(const record of normalizedReferences){assert.equal(record.eligibleForProduction,false);assert.equal(record.permissionConfirmed,false);assert.equal(record.rightsState,'unverified');assert.equal(record.rightsStatus,'requires_rights_review');assert.equal(mediaPermitted(record),false);assert(refs.some(r=>r.restaurantId===record.restaurantId&&r.url===record.thumbnailUrl));}
const approved=candidates.filter(r=>r.eligibleForProduction);
// The accepted October 6 snapshot predates the two October 20 reviewed additions.
// A rebuilt snapshot must include every permitted in-scope addition, not merely
// preserve a minimum count or a nonempty approved set.
const snapshotTime=Date.parse(candidatePayload.generatedAt);assert(Number.isFinite(snapshotTime));
const expectedApproved=[...preservation.licensedRecords,...addedMedia.filter(record=>Date.parse(record.reviewedAt)<=snapshotTime),...automaticMedia.filter(record=>Date.parse(record.assessedAt)<=snapshotTime)].filter(record=>snapshotRestaurantIds.has(record.restaurantId));
assert.deepEqual(sortedKeys(approved),sortedKeys(expectedApproved));
assert.equal(new Set(approved.map(record=>record.restaurantId)).size,candidatePayload.counts.restaurantsWithApprovedThumbnail);
for(const record of approved)assert(mediaPermitted(record));
console.log(`Paired contract checks passed: ${refs.length} non-renderable references; ${preservation.licensedRecords.length} archived licensed records preserved; ${addedMedia.length} reviewed additions and exact snapshot eligibility sets validated.`);
