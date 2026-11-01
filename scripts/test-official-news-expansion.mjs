import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {buildNews,validateNewsRegistry,newsId} from './lib/news-contract.mjs';
import {collectNews} from './import-regional-news.mjs';
const load=async p=>JSON.parse(await readFile(new URL('../'+p,import.meta.url),'utf8'));
const registry=await load('data/news-source-registry.json'),decisions=await load('data/reviewed-news-decisions.json'),payload=buildNews(decisions,registry);
const frozen={
  "news-81a930d96a2a76a3cbe04cb9": "ed2df10c0b2b2485535756233862c07f9d3574b8f9681f3d35cba4bcd063f0f2",
  "news-c3ab1f08f5c4ffbe39559478": "79298fd6cd566f5fe41fd6f8acdb20c9c908ee8950c5da0c3ec2cf1bd4d361e1",
  "news-8f4e6405f6c6e8856e667bc9": "66a204d14cd3a5fec764ba2d551a52623535411fb8db4d25b46bb8c985930532",
  "news-1fb9284920d1d77fe4f03345": "7a44c7a91547fcc68f7c5a89a8361de3235c0a9b6ebccc24e2fc5940e2ad57e3",
  "news-977c0ec8249d5d55b6e58cf0": "565bc032d687ee786ed547fd7d9782232d3ecfee9f23a6cbcc471568dfeab4c8",
  "news-a718562303b817d0277762d0": "6e316386e9c6afab6c9af1f3f659175e4d3f24e845723e8eaf62ddb0e0cbd9fd",
  "news-e268646611a4077b2c01e2d3": "4cdc6a317302e3659fb2be98579fb6ce59402deea6427e32280ef1c82d497bcd",
  "news-08a8b678e60a3118a41ad9ae": "7f284494d585fc383c11051056c56a9bcdcff0392831cbc4993f1bd496ac912c",
  "news-ad7f15af910c05d9de5b8b62": "31a03e96481ed279f6da64ec5a8c01b2fd00c08b282e7dcfea2a6109301ec5a2",
  "news-32a5904109882638e7e54f5c": "f5b688053fe95ab0e6a1037c5304ba929bed18f497c926146bda660af038c23b",
  "news-f0ba9c95723962946dc570c7": "4c47199d767dc885b16deea7368666a51c0f07d0fd958faebcd36d4c7c820a41",
  "news-80ab169a2031d5ead2b27bad": "1262c5bac2d1521d2b0f23e7c7944ca5a0df0c9f05b4c985bb87bdddef092a4d",
  "news-ea8e74ef9065b32c2bea92ae": "8cfaade88b33e27b22f08bded1520c3e2bc084a4a6914d8d87c52d8fd2716f20",
  "news-a30a5db766e93b1f8424a545": "f1286c884abc24b979de9a482c0cef15e105999d603c6060b53a22a0fc675d49",
  "news-f03f1e5ef2b433c9f9bb2f6b": "38fb97193cbf1f5fd213353a6afa154879f3a03dce217878cc338d7494dfabe2",
  "news-b7bd25a494b4aa2c2500b0ec": "4626e4870f2056ce9a90311dc754236031ec2a74814295536139183a21edfddc",
  "news-47dfbbac0c36896319e3abca": "a8e0e0a76abb76a68b75bc03d2bb89edc36d01e1b4acb4b0929020f9ea2d8234",
  "news-95eb3c4876904c738fdf4f74": "71e10e02c4f80f2388fbb4179e03ff7c1104df1a62a4c15534270c56fbacaaef",
  "news-046734de465c1f924b61a306": "f51f45ea5987aad893e4958f738ee6392115a636d8458f4693a1d3689a6aad04",
  "news-935f9651a08aa343a70c795e": "ea0404c82e169bc2bd258b983c2072ea5691e14a13c48cd65d501f6f25765120",
  "news-5f99735671c7c124d042eb5e": "068751a1d79e659680e4a48614189a6eefa06e6b5d35b20c7892d89d09d28bbe",
  "news-b72438d505cc4def7b8ef1ad": "67723adb73e43df667b2cb28368d51d11fdc9cfa6b5188b2b0c659d22e56b90b",
  "news-343b5e45920ae6a414a8c505": "7f962a227796d227c8d63364742b5281a5b07b513ae6bec5d71ca2c2afb92e38",
  "news-d50375083b52a6d653d1abcf": "90502da8ffb72caaca69f4e340d05b201e29594470c0fca94680029d4957f0b7",
  "news-994336ec0f895d1f0ba4fc37": "824a5ebc75be260ebd19558b34aafb6333a3144f57b83a6f550bc2ff8f0dcc16",
  "news-cd9e7241821dd37e8d1a3aa6": "37aaabf98a7cfd38a699d8e77a25dec28f5f041353881c9bae0d502d94b1e4a9",
  "news-bd2f2db1b0fd61f2a94bae88": "bcef63790a87a14387b375d10481bae3eed1e9375dfc98af245d4fd6bdb85cac",
  "news-0f98b34eb398ab5244f2fd1a": "72b40b58f32c1d4b32bf4cf3de5fc8010282e220772290b15cc9caa9e23cf732",
  "news-a3fe570814935c7d24855edf": "245a9002222875887c4d35e2d5736f19bd485a9f3cb6f2806303a3c4b75ff259",
  "news-5c0b76fa68673914d67dc110": "d6c7d6ad32e457570b257702a58705744b7a7d7e995c6b7c2ac72ae25135534e",
  "news-8c00ada5525e271a0cba891c": "43a8691c0dec8c0e27fed4e75e31b616e943ae0ce931c99fbbac7f29307375e8",
  "news-5c5776928b6b41f489e2e7ab": "0148a91769d923196d4570c9910fe0982d307f69b7944e173065dade48833dbf",
  "news-ac243a65a5a3b1873c5b5396": "51c1f1697a1e014ebc16c2110dcab65eb24c5193bcb9e35f42d8388886aaf060",
  "news-ad7e82fb190df4bd1f822b96": "d9f0a06ba7c9fe2593b93b744d24ec3c90d263c9928ad645afa4a2a83fcbae8e",
  "news-672fe9074c69053f247775fe": "219c6cb814f5e203883bdfb180ab43518f4ea058f3f0eb47c3410f8714d48f7c",
  "news-5d72c6922aa78769d9d059cb": "58ae29c89ba7f83db716f2197eba6dac0e127a7338b367806eaf77c451021c54",
  "news-7337ec58a959c5fba470b452": "75c1e2e3061aa5c2e337830e7c2e2031810e5eca2528204f0ec04dcd1240cdcf",
  "news-16f88bfa326e1d6a439be060": "1dd01d762432abecef78b9c0f9065b134eda0b14f100811ed559dc98a8c47a0e",
  "news-b97b31a4d4e53fcdc8616499": "888a7043e6dd470d909eb29014b1bd738264c60d0ec5f03d814a7691891b4fce",
  "news-364960df50a8c5f225085e8f": "7e3e7ad71eba7b8b0a10ea3492b0b830273fc61faa4518924fdf5aecf38d7616",
  "news-67a6973e8df7f51479ff9767": "f4e5a32d8e26339360b575fd146b3f54067e4084090884cd0762c55125ce334e",
  "news-0e397b4d6b408b7c1890b8b8": "0828dc2298ecef358fee27e8a3a3f450c02b15e3d8b1884175c6ddbbce26a042",
  "news-98ce4ab29bb711b7ae412817": "67f0bfd5dde6fa423e2ac01604e45984d9a74cbb6b8339b9e433a916d32399fb",
  "news-2caae9ef6e642875a81fe845": "29c1c0bdf752739e5ee9b6de5078df4f174e7a6bbccd217fbbb1169bcebdfa80",
  "news-410ba17ed973314980f9c257": "f196dddf889ec22bda892faf197974f9a709c3ebdc343a12522e22fc496e1120",
  "news-0fdaf0f2b9bd4ebadb94aa48": "bc7eba5ab66aede0462db8ab91d1e608d4d27fdc3f61956a2ac60437c70430a6",
  "news-717e5f25c006916b345afd55": "a175eb038a86c88cd300f39331d2a7d859e2c8b9b2e10856498e1fda79bcd806",
  "news-450d9f0b7d98e559b9f70790": "251b560dc544aae23680e0924af7c59f52b7dfb5b95dfab9a2fadba4731403fd",
  "news-895be09c7bf9531cbb444257": "c8188a905b1f980e43de29d4e2be64f961b1766063343fc3da489f13735d3ff1",
  "news-78e18bcd44e76f6538f05ff8": "468f4e6c5737ccc7e29e30ecb829a58b8735195b59bfb9f60b21cc35d49fee06",
  "news-afbcf5b6bb735f09c5e9dddd": "b0f19f48d798bd3d179351332ad69434dd5120286f9dababa42adf29d74b8b20"
};
for(const[id,hash]of Object.entries(frozen)){const row=decisions.decisions.find(x=>x.id===id);assert(row);assert.equal(createHash('sha256').update(JSON.stringify(row)).digest('hex'),hash,'Existing decision changed: '+id);}
assert.equal(payload.items.length,55);assert.equal(Object.keys(frozen).length,51);
assert.deepEqual(registry.sources.filter(x=>x.enabled).map(x=>x.id),['global-halifax']);
for(const id of ['halifax-water','nova-scotia-health']){const source=registry.sources.find(x=>x.id===id);assert.equal(source.enabled,false);assert.equal(source.feedUrl,null);assert.equal(source.source_type,'official_public_notice');let requests=0;await collectNews({version:1,sources:[source]},{now:'2026-10-28T05:00:00.000Z',fetchFeed:async()=>{requests++;throw Error('manual-only source');}});assert.equal(requests,0);assert.throws(()=>validateNewsRegistry({version:1,sources:[{...source,enabled:true}]}));}
const additions=payload.items.filter(x=>!frozen[x.id]);assert.equal(additions.length,4);
for(const r of additions){assert.equal(r.id,newsId(r.canonicalUrl));assert.equal(r.summary,null);assert.equal(r.summaryKind,'none');assert.equal(r.source_type,'official_public_notice');assert.equal(r.publishedPrecision,'day');assert(r.publishedAt<r.observedAt&&r.observedAt<=r.reviewedAt);assert(!['body','image','imageUrl','patientName'].some(k=>k in r));for(const patch of [{body:'copied'},{summary:'unreviewed',summaryKind:'feed_description'},{reviewStatus:'pending'}])assert.throws(()=>buildNews({version:1,decisions:[{id:r.id,status:'approved',record:{...r,...patch}}]},registry));}
const water=additions.find(x=>x.sourceId==='halifax-water');assert.equal(water.publishedAt,'2026-01-14');assert.equal(water.region,'Halifax');
const clinic=additions.find(x=>x.canonicalUrl.includes('mobile-unit'));assert.equal(clinic.publishedAt,'2026-10-23');assert.match(clinic.regionEvidence,/now past/);assert.doesNotMatch(clinic.title,/current|available|today/i);
const south=additions.find(x=>x.canonicalUrl.includes('south-shore'));assert.equal(south.publishedAt,'2026-10-09');assert.equal(south.region,'South Shore');assert.match(south.regionEvidence,/Bridgewater, not Halifax/);
const family=additions.find(x=>x.canonicalUrl.includes('family-practice'));assert.equal(family.publishedAt,'2026-10-14');assert.equal(family.region,'Nova Scotia');
console.log('Official news expansion passed: 51 frozen decisions, four factual links, two disabled manual sources, dates/privacy/regions and no collector activation.');
