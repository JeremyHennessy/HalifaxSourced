import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, Script } from 'node:vm';
const context = createContext({ window: {} });
for (const file of ['app-inspection-matching.js', 'data/ns-food-inspections.js']) {
  new Script(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'), { filename: file }).runInContext(context);
}
const match = context.window.HalifaxInspectionMatching.matches;
const records = context.window.HALIFAX_NS_FOOD_INSPECTIONS.records;
const ids = (restaurant, candidates = records) => Array.from(match(restaurant, candidates), r => r.id);
assert.deepEqual(ids({ name: 'JUKAI Japanese & Thai', address: '49 Kings Wharf Place, Dartmouth' }), ['ns-food-2494999']);
assert.deepEqual(ids({ name: 'Jukai', address: '1715 Barrington Street, Halifax' }), ['ns-food-3662941']);
const wooden = ids({ name: 'The Wooden Monkey', address: '1707 Grafton Street, Halifax' });
assert.ok(wooden.length > 0);
assert.ok(wooden.every(id => records.find(r => r.id === id).address.includes('1707')));
assert.deepEqual(ids({ name: 'The Wooden Monkey', address: '40 Alderney Drive, Dartmouth' }), []);
const record = { id: 'test', name: 'Example Cafe', address: '123 MAIN, HALIFAX', city: 'Halifax' };
const cases = [
  ['123 Main Street, Halifax', true], ['123 Main St., Halifax', true],
  ['123 Main Road, Dartmouth', false], ['1234 Main Street, Halifax', false],
  ['124 Main Street, Halifax', false], ['123 Mainland Street, Halifax', false],
  ['123 Main North Street, Halifax', false], ['', false], ['Main Street, Halifax', false],
  ['12-123 Main Street, Halifax', false], ['123-125 Main Street, Halifax', false]
];
for (const [address, expected] of cases) assert.equal(ids({ name: 'Example Cafe', address }, [record]).length > 0, expected, address);
assert.deepEqual(ids({ name: '', address: record.address }, [record]), []);
assert.deepEqual(ids({ name: 'Unrelated Restaurant', address: record.address }, [record]), []);
assert.deepEqual(ids({ name: record.name, address: record.address }, [{ ...record, address: '' }]), []);
assert.deepEqual(ids({ name: record.name, address: record.address }, [record, record]), ['test']);

for (const [name, address] of [
  ["Tarek's Cafe", '3045 Robie Street, Halifax'],
  ["Your Father's Moustache", '5686 Spring Garden Road, Halifax'],
  ['Tokyo Roll', '1598 Argyle Street, Halifax'],
  ['Café Good Luck', '145 Portland Street, Dartmouth'],
  ["Jim's Family Restaurant", '243 Bedford Highway, Halifax'],
  ['Great Wall Restaurant', '1649 Bedford Row, Halifax'],
  ['Kanpai Izakaya', '1535 Dresden Row, Halifax'],
  ['Canton Garden', '30 Farnham Gate Road, Halifax'],
  ['Stillwell', '1672 Barrington Street, Halifax'],
  ["Cow's", '1479 Lower Water Street, Halifax']
]) assert.ok(ids({ name, address }).length, `Preserve corroborated match: ${name}`);
assert.deepEqual(ids({ name: record.name, address: '123 Main Street, Dartmouth', city: 'Halifax' }, [record]), []);
assert.deepEqual(ids({ name: record.name, address: '123 Main Road, Halifax' }, [{ ...record, address: '123 MAIN STREET, HALIFAX' }]), []);

const core = await readFile(new URL('../app-core.js', import.meta.url), 'utf8');
const exporter = await readFile(new URL('./export-catalog.mjs', import.meta.url), 'utf8');
assert.match(core, /window\.HalifaxInspectionMatching\.matches\(restaurant, inspectionRecords\)/);
assert.match(exporter, /context\.window\.HalifaxInspectionMatching\.matches\(restaurant, nsRecords\)/);
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
assert.ok(html.indexOf('src="./app-inspection-matching.js') >= 0);
assert.ok(html.indexOf('src="./app-inspection-matching.js') < html.indexOf('src="./app-core.js'));
console.log('Inspection location matching regressions passed: real branch isolation, civic/street/city evidence, missing evidence, shared runtime/export implementation.');
