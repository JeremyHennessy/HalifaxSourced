import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {preservePublishedEventIds,assertUniqueEventIds} from './lib/canonical-event-dedupe.mjs';
const previousPath = process.argv[2];
if (!previousPath) throw new Error('Pass the preserved previous city-events JSON snapshot.');
const previous = JSON.parse(await readFile(previousPath,'utf8'));
const current = JSON.parse(await readFile(new URL('../data/build/city-events.json',import.meta.url),'utf8'));
assertUniqueEventIds(current.events);
const expected = preservePublishedEventIds(current.events,previous.events);
assert.equal(expected.length,current.events.length,'Final snapshot contains canonical duplicates');
for (let i=0;i<expected.length;i++) {
  assert.equal(current.events[i].id,expected[i].id,'Published canonical event ID changed');
  const aliases = new Set(current.events[i].duplicateEventIds || []);
  for (const alias of expected[i].duplicateEventIds || []) assert(aliases.has(alias),'Published saved-event alias was lost: '+alias);
}
const context = vm.createContext({window:{}});
vm.runInContext(await readFile(new URL('../data/city-events.js',import.meta.url),'utf8'),context);
assert.equal(JSON.stringify(context.window.HALIFAX_CITY_EVENTS.events),JSON.stringify(current.events),'Runtime and build event identities differ');
console.log(`Final event identity gate passed: ${current.events.length} records, published IDs and aliases preserved, runtime/build aligned.`);
