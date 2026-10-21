import assert from 'node:assert/strict';
import fs from 'node:fs';
import integrity from '../source-integrity.js';
const audit=JSON.parse(fs.readFileSync(new URL('../data/audit/menu-pointer-requalification-2026-10-21.json',import.meta.url)));
const rules=JSON.parse(fs.readFileSync(new URL('../data/audit/menu-pointer-suppressions.json',import.meta.url)));
assert.equal(audit.records.length,517);assert.equal(audit.scope.completedUniqueUrlAttempts,438);
assert.equal(Object.values(audit.counts).reduce((a,b)=>a+b,0),517);
assert.equal(rules.length,31);
for(const r of rules){assert.equal(integrity.pointerSafe(r.restaurantId,r.kind,r.url),false,r.url);assert.equal(integrity.pointerSafe('different-location',r.kind,r.url),integrity.safeSource(r.url));}
const tako=rules.find(r=>r.restaurantId.includes('tako')&&r.url.endsWith('chefs-special-rolls'));
assert(tako);assert.equal(integrity.pointerSafe(tako.restaurantId,'menu',tako.url),true);assert.equal(integrity.pointerSafe(tako.restaurantId,'special',tako.url),false);
console.log('All 517 pointer dispositions accounted for; 31 exact restaurant/kind/URL suppressions preserve other locations and legitimate menu use.');
const { default: vm } = await import('node:vm');
const context=vm.createContext({window:{},document:{querySelector:()=>({}),querySelectorAll:()=>[]},localStorage:{getItem:()=>null,setItem:()=>{}},console,URL,Date,Intl,Set,Map});
for(const match of fs.readFileSync(new URL('../index.html',import.meta.url),'utf8').matchAll(/<script src="\.\/([^"?]+)[^"]*"><\/script>/g)){
 const file=match[1];if(file.startsWith('vendor/'))continue;
 vm.runInContext(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),context,{filename:file});
 if(file==='app-lifecycle.js')break;
}
const restaurants=JSON.parse(vm.runInContext('JSON.stringify(restaurants)',context));
for(const rule of rules){const r=restaurants.find(r=>r.id===rule.restaurantId);if(!r)continue;const links=rule.kind==='menu'?r.menuLinks:r.specialLinks;assert(!(links||[]).some(x=>x.url===rule.url),'Suppressed pointer returned through later enrichment: '+rule.url);assert(!(r.relatedLinks||[]).some(x=>x.kind===rule.kind&&x.url===rule.url),'Related navigation resurrected pointer: '+rule.url);}
const sushi=restaurants.find(r=>r.id==='osm-node-11552234300-sushi-nami-royale');assert(sushi.menuLinks.every(x=>!x.url.includes('/downtown-halifax/')));
console.log('Final decorated browser state cannot resurrect audited mismatches.');

const branches = {
  'osm-node-11552234300-sushi-nami-royale':'bayers-lake',
  'osm-node-5161526522-sushi-nami-royale':'downtown-halifax',
  'ns-food-2851000':'dartmouth-crossing', 'ns-food-2156028':'bedford-highway'
};
for (const [id, branch] of Object.entries(branches)) {
  for (const target of Object.values(branches)) for (const kind of ['menu','special','specials','image_preview','evidence']) {
    for (const suffix of ['', '/', '/dinner/', '/lunch-menu/?view=all#menu']) {
      assert.equal(integrity.pointerSafe(id,kind,'https://sushinami.ca/'+target+suffix),branch===target,`${id} ${kind} ${target}${suffix}`);
    }
  }
  for (const path of ['/', '/contact-sushi-nami-royale/', '/new-unqualified-branch/dinner/']) {
    for (const kind of ['menu','special','specials','image_preview']) assert.equal(integrity.pointerSafe(id,kind,'https://sushinami.ca'+path),false);
    assert.equal(integrity.pointerSafe(id,'evidence','https://sushinami.ca'+path),true);
  }
}
vm.runInContext(fs.readFileSync(new URL('../app-media.js',import.meta.url),'utf8'),context,{filename:'app-media.js'});
for (const [id,branch] of Object.entries(branches)) {
  const r=restaurants.find(r=>r.id===id); if(!r)continue;
  assert(r.menuLinks.some(link=>new URL(link.url).pathname.startsWith('/'+branch+'/')),'Correct branch menu retained');
  for(const link of [...r.menuLinks,...r.specialLinks]) assert(integrity.pointerSafe(id,'menu',link.url));
  const image=JSON.parse(vm.runInContext(`JSON.stringify(sourcePreviewImageFor(restaurants.find(r=>r.id===${JSON.stringify(id)})))`,context));
  if(image)assert(integrity.pointerSafe(id,'image_preview',image.sourceUrl));
}
console.log('All four branch identities reject cross-branch and unqualified shared consumer pointers, including source-preview photos; historical evidence retained.');
