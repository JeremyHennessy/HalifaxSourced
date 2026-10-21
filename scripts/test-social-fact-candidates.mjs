import assert from 'node:assert/strict';
import vm from 'node:vm';
import integrity from '../source-integrity.js';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { extractSocialFactCandidate, factOnlyPost, validSocialReviewState } from './lib/social-fact-candidates.mjs';
const context = { platform:'instagram', restaurantId:'fixture', postUrl:'https://www.instagram.com/p/example/', observedAt:'2026-10-21T12:00:00Z', publishedAt:'2026-10-21T10:00:00Z', signalMatches:{specials:['special'],events:['trivia']} };
const caption='Creative caption must never be retained. Trivia special October 23, 2026 at 7pm. $12 CAD dine-in only, plus tax. Tonight while supplies last. Cancelled.';
const facts=extractSocialFactCandidate(caption,context);
assert.deepEqual(facts.dateMentions,['October 23, 2026']);assert.deepEqual(facts.timeMentions,['7pm']);assert.deepEqual(facts.priceMentions,['$12 CAD']);
assert.equal(facts.status,'possible_cancellation');assert.equal(facts.publishable,false);assert.equal(facts.startsAt,null);assert.equal(facts.expiresAt,null);assert.equal(facts.currency,null);
assert(facts.conditionSignals.includes('dine_in_only'));assert(facts.relativeDateMentions.includes('Tonight'));
assert(!JSON.stringify(factOnlyPost(caption,context)).includes('Creative caption'));
assert.deepEqual(extractSocialFactCandidate('$1,200 CAD $12.5 $123456',context).priceMentions,['$1,200 CAD','$12.5','$123456']);
assert.equal(extractSocialFactCandidate('Nothing here', {...context, signalMatches:{}}),null);
assert.equal(extractSocialFactCandidate('Special tomorrow at 7pm',context).startsAt,null);
const pending={...context,...factOnlyPost(caption,context),publishedAt:new Date().toISOString()};
assert.equal(integrity.currentPost(pending),false);
const restaurant={id:'fixture',orderingLinks:[],sources:[]};
const browser={window:{HALIFAX_SOCIAL_SIGNALS:{signals:[pending],posts:[pending]},HALIFAX_RECENT_SOCIAL_POSTS:{records:[pending]}},restaurants:[restaurant],HalifaxDataIntegrity:integrity,safeUrl:value=>value||null,isRestaurantActive:()=>true,mergeSources:(a,b)=>[...(a||[]),...b]};
vm.createContext(browser);vm.runInContext(await readFile(new URL('../app-source-signals.js',import.meta.url),'utf8'),browser);
assert.equal(restaurant.hasSpecial,false);assert.equal(restaurant.hasEvent,false);assert.equal(restaurant.currentSourceSignals.length,0);assert.equal(restaurant.officialUpdates.length,0);
const root=await mkdtemp(join(tmpdir(),'halifax-social-facts-'));
try {
 await mkdir(join(root,'scripts/lib'),{recursive:true});await mkdir(join(root,'data/build'),{recursive:true});
 for(const file of ['scripts/import-meta-social.mjs','scripts/lib/social-fact-candidates.mjs','scripts/lib/source-run-health.mjs','scripts/build-reviewed-social-posts.mjs','source-integrity.js'])await copyFile(new URL('../'+file,import.meta.url),join(root,file));
 const profile=(platform,handle,extra={})=>({platform,handle,url:`https://www.${platform}.com/${handle}/`,reviewState:'verified_link',status:'active',...extra});
 await writeFile(join(root,'data/build/first-party-sources.json'),JSON.stringify({records:[{restaurantId:'fixture',name:'Fixture',socialProfiles:[profile('instagram','fixture'),profile('facebook','fixture'),profile('instagram','shared',{sharedBrandProfile:true}),profile('facebook','stale',{status:'stale'})]}]}));
 const runner=`import assert from 'node:assert/strict';import {writeFile} from 'node:fs/promises';let calls=0;globalThis.fetch=async(url,options)=>{calls++;assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer fixture-secret');assert(!String(url).includes('fixture-secret'));const u=new URL(url);const fields=u.searchParams.get('fields');assert(!/media_url|thumbnail_url|full_picture/.test(fields));const post={id:'post',message:${JSON.stringify(caption)},created_time:new Date().toISOString(),permalink_url:'https://www.facebook.com/fixture/posts/1'};if(u.pathname.endsWith('/posts'))return Response.json({data:[post,{...post,id:'future',created_time:'2999-01-01T00:00:00Z'}]});if(u.pathname.endsWith('/caller'))return Response.json({business_discovery:{id:'account',media:{data:[{id:'media',caption:${JSON.stringify(caption)},timestamp:new Date().toISOString(),permalink:'https://www.instagram.com/p/fixture/'}]}}});return Response.json({id:'account'});};await import('./scripts/import-meta-social.mjs');await writeFile('calls.json',JSON.stringify(calls));`;
 await writeFile(join(root,'runner.mjs'),runner);
 const env={...process.env,META_FB_ACCESS_TOKEN:'fixture-secret',META_IG_ACCESS_TOKEN:'fixture-secret',META_IG_USER_ID:'caller',SOCIAL_PULL_DELAY_MS:'0'};
 const result=spawnSync(process.execPath,['runner.mjs'],{cwd:root,env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
 const raw=await readFile(join(root,'data/build/social-signals.json'),'utf8');const output=JSON.parse(raw);
 assert.equal(output.runHealth.state,'success_fresh_data');assert.equal(output.refreshObservations.length,2);assert.equal(output.posts.length,2);assert.equal(output.profilesAttempted,2);assert.equal(JSON.parse(await readFile(join(root,'calls.json'),'utf8')),3);
 assert(!raw.includes('Creative caption'));assert(!raw.includes('fixture-secret'));assert(!raw.includes('mediaUrl'));assert.equal(output.storyCoverage,'not_supported_no_story_endpoint_or_archive');
 for(const post of output.posts){assert.equal(post.reviewState,'needs_fact_review');assert.equal(post.factCandidate.publishable,false);assert(validSocialReviewState(post));assert(!validSocialReviewState({...post,mediaUrl:'https://fixture.example/image.jpg'}));assert(!validSocialReviewState({...post,factCandidate:{...post.factCandidate,publishable:true}}));}
 await writeFile(join(root,'data/build/recent-social-posts.json'),JSON.stringify({records:[{...output.posts[0],id:'approved-before',dateState:'valid'},{...output.posts[0],id:'malformed',dateState:'valid',factCandidate:{}}]}));
 await writeFile(join(root,'data/reviewed-social-post-decisions.json'),JSON.stringify({records:['approved-before','malformed'].map(id=>({id,decision:'approve_post',approvedAt:new Date().toISOString()}))}));
 const review=spawnSync(process.execPath,['scripts/build-reviewed-social-posts.mjs'],{cwd:root,env,encoding:'utf8'});assert.equal(review.status,0,review.stderr);
 assert.equal(JSON.parse(await readFile(join(root,'data/build/reviewed-social-posts.json'),'utf8')).records.length,0,'Old approval cannot qualify unresolved extracted facts');
 // A denied profile keeps last-good evidence while the successful profile is refreshed.
 const partialRunner=runner.replace('calls++;',`calls++;if(new URL(url).pathname.endsWith('/caller'))return Response.json({error:{code:190,message:'secret details must not enter output'}},{status:403});`);
 await writeFile(join(root,'partial.mjs'),partialRunner);
 const partialResult=spawnSync(process.execPath,['partial.mjs'],{cwd:root,env,encoding:'utf8'});assert.equal(partialResult.status,0,partialResult.stderr);
 const partialRaw=await readFile(join(root,'data/build/social-signals.json'),'utf8');const partial=JSON.parse(partialRaw);
 assert.equal(partial.runHealth.state,'partial_failure');assert.equal(partial.failures[0].attempted,true);assert(partial.failures[0].checkedAt);assert.equal(partial.posts.length,2);assert.equal(partial.retainedPosts,1);assert.equal(partial.profilesCompleted,1);assert.equal(partial.posts.find(post=>post.platform==='instagram').observedAt,output.posts.find(post=>post.platform==='instagram').observedAt);assert(!partialRaw.includes('secret details'));
 // Missing access must perform no requests; no scrape fallback or false success.
 const missing=spawnSync(process.execPath,['runner.mjs'],{cwd:root,env:{...env,META_FB_ACCESS_TOKEN:'',META_IG_ACCESS_TOKEN:'',META_IG_USER_ID:''},encoding:'utf8'});assert.equal(missing.status,0,missing.stderr);
 const empty=JSON.parse(await readFile(join(root,'data/build/social-signals.json'),'utf8'));assert.equal(empty.runHealth.state,'no_access');assert(empty.failures.every(row=>row.attempted===false));assert.equal(empty.profilesAttempted,0);assert.equal(empty.posts.length,2);assert.equal(empty.retainedPosts,2);assert.equal(empty.posts[0].observedAt,partial.posts[0].observedAt);assert.equal(empty.posts[0].observationState,'retained_not_refreshed');assert.equal(empty.credentialState.facebook,'missing');assert.equal(JSON.parse(await readFile(join(root,'calls.json'),'utf8')),0);
 const legacy={...output.posts[0],summary:caption,title:'Creative caption must never be retained',mediaUrl:'https://fixture.example/unlicensed.jpg',thumbnailUrl:'https://fixture.example/thumb.jpg'};
 delete legacy.factCandidate;delete legacy.contentPolicy;legacy.reviewState='api_observed';
 await writeFile(join(root,'data/build/social-signals.json'),JSON.stringify({posts:[legacy]}));
 const legacyRun=spawnSync(process.execPath,['runner.mjs'],{cwd:root,env:{...env,META_FB_ACCESS_TOKEN:'',META_IG_ACCESS_TOKEN:'',META_IG_USER_ID:''},encoding:'utf8'});assert.equal(legacyRun.status,0,legacyRun.stderr);
 const legacyRaw=await readFile(join(root,'data/build/social-signals.json'),'utf8');const migrated=JSON.parse(legacyRaw).posts[0];
 assert(!legacyRaw.includes('Creative caption'));assert(!legacyRaw.includes('unlicensed.jpg'));assert(!legacyRaw.includes('thumb.jpg'));assert.equal(migrated.observedAt,legacy.observedAt);assert.equal(migrated.factCandidate.publishable,false);assert(migrated.factCandidate.priceMentions.includes('$12 CAD'));
 console.log('Social facts: factual candidates, unresolved dates/branches, no captions/media, API-only access, future-date and shared-profile guards passed.');
} finally {await rm(root,{recursive:true,force:true});}
