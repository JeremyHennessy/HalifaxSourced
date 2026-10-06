import { readFile, writeFile, readdir } from 'node:fs/promises';
import vm from 'node:vm';
import integrity from '../source-integrity.js';
const root = new URL('../data/', import.meta.url);
const india = 'osm-node-13141377001-india-paradise';
const glitter = 'osm-node-4416774495-glitter-bean-cafe';
const replacements = { [india]: 'https://www.indiaparadise.ca/halifax/downtown/home', [glitter]: 'https://www.glitterbeancafe.com/contact' };
const quarantine = [];
const previousQuarantine = JSON.parse(await readFile(new URL('source-quarantine.json',root),'utf8').catch(()=>'{}')).records || [];
function suspect(row, parentId) {
  const id = row.restaurantId || parentId;
  const urls = ['url','sourceUrl','postUrl','resolvedUrl','href','feedUrl'].map(k=>row[k]).filter(Boolean);
  if (urls.some(u=>!integrity.safeSource(u))) return 'unsafe_or_wrong_entity_domain';
  if (id === india && urls.length && urls.some(u=>/indiaparadise\.ca/i.test(u) && !/\/halifax\/downtown\//i.test(u))) return 'location_not_halifax_downtown';
  if (id === india && row.locationValidated === false) return 'location_validation_failed';
  return null;
}
function clean(value, file, parentId = null) {
  if (Array.isArray(value)) return value.flatMap(row=>{
    if (row && typeof row === 'object') { const reason=suspect(row,parentId); if(reason) {quarantine.push({file,reason,record:row}); return [];}}
    return [clean(row,file,parentId)];
  });
  if (!value || typeof value !== 'object') return value;
  const id=value.restaurantId || value.id || parentId;
  const out={};
  for(const [key,child] of Object.entries(value)) out[key]=clean(child,file,id);
  if (replacements[id] && out.website) out.website=replacements[id];
  // Brand homepage and quarantined source intelligence do not migrate into local evidence.
  if (id===glitter && out.resolvedUrl && !integrity.safeSource(out.resolvedUrl)) out.resolvedUrl=null;
  return out;
}
for (const dir of ['', 'build/']) {
  for(const name of await readdir(new URL(dir,root))) {
    if (!/\.(json|js)$/.test(name) || /source-quarantine|integrity-repair|decisions|rejected|contract|report/.test(name)) continue;
    const path=new URL(dir+name,root);const source=await readFile(path,'utf8');
    let payload,globalName;
    if(name.endsWith('.json')) {try{payload=JSON.parse(source);}catch{continue;}}
    else { const match=source.match(/^window\.(\w+)\s*=/);if(!match || (source.match(/window\.\w+\s*=/g)||[]).length!==1)continue; globalName=match[1];const context={window:{}};vm.runInNewContext(source,context);payload=context.window[globalName]; }
    const repaired=clean(payload,dir+name);
    if(JSON.stringify(payload)===JSON.stringify(repaired))continue;
    await writeFile(path,globalName ? `window.${globalName} = ${JSON.stringify(repaired,null,2)};\n` : JSON.stringify(repaired,null,2)+'\n');
  }
}
const retainedQuarantine = [...new Map([...previousQuarantine,...quarantine].map(row=>[JSON.stringify(row),row])).values()];
await writeFile(new URL('source-quarantine.json',root),JSON.stringify({version:1,reason:'Local integrity repair; historical evidence is retained here and never fetched.',replacementSources:replacements,rightsState:'public_reference_not_media_licence',records:retainedQuarantine},null,2)+'\n');
console.log(`Quarantined ${quarantine.length} source associations. Retrieval and verification timestamps were not advanced.`);
