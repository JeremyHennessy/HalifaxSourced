import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {mediaPermitted,referenceProblems} from './lib/media-rights-contract.mjs';
const load=async(path,key)=>{const c={window:{}};vm.runInNewContext(await readFile(new URL('../'+path,import.meta.url),'utf8'),c);return JSON.parse(JSON.stringify(c.window[key]));};
const refs=(await load('data/restaurant-media-references.js','HALIFAX_MEDIA_SOURCE_REFERENCES')).records;
const media=(await load('data/restaurant-media.js','HALIFAX_RESTAURANT_MEDIA')).records;
assert.equal(refs.length,99);assert.equal(media.length,7);
const preservation=JSON.parse(await readFile(new URL('./fixtures/media-preservation.json',import.meta.url),'utf8'));
const claims=JSON.parse(await readFile(new URL('../data/audit/media-rights-reclassification.json',import.meta.url),'utf8')).previousClaims;
assert.deepEqual(media,preservation.licensedRecords);assert.equal(claims.length,preservation.archivedClaimsCount);assert.equal(createHash('sha256').update(JSON.stringify(claims)).digest('hex'),preservation.archivedClaimsSha256);
for(const record of refs){const prior=claims.find(r=>r.restaurantId===record.restaurantId&&r.url===record.url);assert(prior);for(const key of ['restaurantId','url','sourceUrl','alt','creator'])assert.equal(record[key],prior[key]);}
for(const record of refs){assert.deepEqual(referenceProblems(record),[]);assert.equal(mediaPermitted(record),false);for(const conflict of [{permission:'licensed'},{permissionConfirmed:true},{ownerApproved:true},{license:'CC BY-SA 4.0'},{licence:'CC BY-SA 4.0'},{rightsStatus:'production_approved'},{reviewStatus:'approved'},{renderable:true},{url:'javascript:alert(1)'},{sourceUrl:'broken'},{restaurantId:''},{creator:''},{alt:''},{rightsBasis:'Owner grants reuse'},{permissionSource:'licensed'},{rightsNote:'Licensed media'}])assert(referenceProblems({...record,...conflict}).length,JSON.stringify(conflict));}
for(const record of media){assert(mediaPermitted(record));for(const conflict of [{quarantined:true},{rightsStatus:'unverified'},{permissionConfirmed:false},{creator:''},{license:''},{reviewStatus:'denied'},{rights:'restricted'},{url:'assets/../outside.jpg'},{attribution:''},{alt:'short'},{url:'assets/logo.jpg'},{url:'http://example.test/photo.jpg'},{thumbnailUrl:'assets/logo.jpg'},{url:'https://user:password@example.test/photo.jpg'},{sourceUrl:'https://user:password@example.test/source'}])assert.equal(mediaPermitted({...record,...conflict}),false,JSON.stringify(conflict));}
assert(mediaPermitted({...media[0],sourceType:'restaurant_owner_submission',permission:'owner_submitted',rightsState:'owner_authorized',license:'Fixture owner written grant',rightsBasis:'Specific fixture owner permission',ownerApproved:true}));
const candidates=(await load('data/thumbnail-candidates.js','HALIFAX_THUMBNAIL_CANDIDATES')).candidates;
const normalizedReferences=candidates.filter(r=>r.sourceKind==='retained_media_reference');assert.equal(normalizedReferences.length,84);
for(const record of normalizedReferences){assert.equal(record.eligibleForProduction,false);assert.equal(record.permissionConfirmed,false);assert.equal(record.rightsState,'unverified');assert.equal(record.rightsStatus,'requires_rights_review');assert.equal(mediaPermitted(record),false);assert(refs.some(r=>r.restaurantId===record.restaurantId&&r.url===record.thumbnailUrl));}
const approved=candidates.filter(r=>r.eligibleForProduction);assert.equal(approved.length,6);for(const record of approved)assert(mediaPermitted(record));
console.log('Paired contract checks passed: 99 references accepted only as non-renderable; 7 licensed records valid; malformed/conflicting reference and approved claims rejected.');
