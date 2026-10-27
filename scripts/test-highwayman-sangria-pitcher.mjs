import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const reviewed = JSON.parse(await readFile(new URL('../data/reviewed-structured-specials.json', import.meta.url), 'utf8'));
const built = JSON.parse(await readFile(new URL('../data/build/structured-specials.json', import.meta.url), 'utf8'));
const script = await readFile(new URL('../data/structured-specials.js', import.meta.url), 'utf8');
assert.deepEqual(JSON.parse(script.trim().replace(/^window\.HALIFAX_STRUCTURED_SPECIALS = /, '').replace(/;$/, '')), built);
const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
for (const rows of [reviewed.records, built.records]) {
  const matches = rows.filter(r => r.restaurantId === 'highwayman' && r.title === 'Sangria by the pitcher');
  assert.equal(matches.length, 1, 'One location-specific pitcher offer, not a duplicate glass');
  const record = matches[0];
  assert.equal(record.price, 38);
  assert.equal(record.currency, 'CAD');
  assert.equal(record.specialType, 'happy_hour');
  assert.deepEqual(record.dayOfWeek, days, 'Sunday operation is not established');
  assert.equal(record.startTime, '16:00');
  assert.equal(record.endTime, '17:00');
  assert.equal(record.validFrom, null);
  assert.equal(record.validTo, null, 'No source-stated expiry may be invented');
  assert.equal(record.sourceUrl, 'https://www.highwaymanhfx.com/happyhour');
  assert.equal(record.observedAt, '2026-10-27T18:59:25Z');
  assert.equal(record.verifiedAt, record.observedAt);
  assert.match(record.description, /Sunday is not confirmed/);
  const glass = rows.find(r => r.restaurantId === 'highwayman' && r.title === 'Sangria by the glass');
  assert.equal(glass.price, 12, 'Existing glass offer is separate');
  assert.equal(glass.observedAt, '2026-10-20T19:04:52.689Z', 'Do not refresh old evidence clocks');
}
assert.equal(built.count, built.records.length);
console.log('Highwayman pitcher passed: owner evidence, distinct $38 pitcher, unchanged glass, conservative days, unknown expiry, paired data.');
