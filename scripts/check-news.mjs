import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { buildNews, newsScript } from './lib/news-contract.mjs';
const root = new URL('../', import.meta.url);
const load = async path => JSON.parse(await readFile(new URL(path,root),'utf8'));
const expected = buildNews(await load('data/reviewed-news-decisions.json'), await load('data/news-source-registry.json'));
assert.deepEqual(await load('data/build/news.json'), expected, 'Accepted news differs from reviewed decisions');
assert.equal(await readFile(new URL('data/news.js',root),'utf8'), newsScript(expected), 'News browser/JSON snapshots differ');
console.log(`News check passed: ${expected.items.length} approved; no candidate promotion.`);
