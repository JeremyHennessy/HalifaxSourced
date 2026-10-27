import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { buildNews, newsScript } from './lib/news-contract.mjs';
const root = new URL('../', import.meta.url);
const load = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const payload = buildNews(await load('data/reviewed-news-decisions.json'), await load('data/news-source-registry.json'));
// No collection clocks: identical reviewed inputs produce byte-identical outputs.
await mkdir(new URL('data/build/', root), {recursive:true});
for (const [path, body] of [['data/build/news.json',JSON.stringify(payload,null,2)+'\n'],['data/news.js',newsScript(payload)]]) {
  let previous; try { previous = await readFile(new URL(path,root),'utf8'); } catch(e) { if(e.code !== 'ENOENT') throw e; }
  if (previous !== body) await writeFile(new URL(path,root), body);
}
console.log(`Regional news: ${payload.items.length} explicitly reviewed accepted records.`);
