import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {descendingPageNumbers} from './lib/library-pagination-plan.mjs';
const source=readFileSync(new URL('./import-supplemental-city-events.mjs',import.meta.url),'utf8');
const ctx=vm.createContext({});
vm.runInContext(source.slice(source.indexOf('const MONTHS'),source.indexOf('function sleep')),ctx);
vm.runInContext(source.slice(source.indexOf('function clean'),source.indexOf('function absoluteUrl')),ctx);
vm.runInContext(source.slice(source.indexOf('function monthNumber'),source.indexOf('async function fetchHtml')),ctx);
vm.runInContext(source.slice(source.indexOf('function simpleEventCategories'),source.indexOf('function locationPageWhen')),ctx);
vm.runInContext(source.slice(source.indexOf('function libraryWhen'),source.indexOf('function libraryCategories')),ctx);
for(const title of ['Welcome Housing & Support Drop-in Clinic','Starting a Small Business','Research Help','Community Meeting']) assert.deepEqual([...ctx.simpleEventCategories(title)],['Community'],title);
assert.deepEqual([...ctx.simpleEventCategories('Sing Along')],['Music','Arts']);
assert.deepEqual([...ctx.simpleEventCategories('Knitting Circle')],['Arts','Community']);
assert.deepEqual([...ctx.simpleEventCategories('Tea and Conversation')],['Food & Drink','Community']);
assert.deepEqual(JSON.parse(JSON.stringify(ctx.libraryWhen('Friday, October 23 on October 23, 2026 , 3:30pm – 4:30pm'))),{
  startAt:'2026-10-23T18:30:00.000Z',endAt:'2026-10-23T19:30:00.000Z',allDay:false
},'BiblioCommons date markup permits whitespace before the comma following the screen-reader year');
assert.deepEqual(descendingPageNumbers(4,150),[4,3,2,1],'BiblioCommons pages are crawled from the stable tail toward the changing head');
assert.deepEqual(descendingPageNumbers(200,150).slice(0,2),[150,149],'BiblioCommons pagination remains bounded');
const events=readFileSync(new URL('../app-events.js',import.meta.url),'utf8');
vm.runInContext(events.slice(events.indexOf('function eventDisplayTitle'),events.indexOf('function eventSourceButton')),ctx);
const title='Meet Juno, a St. John Ambulance Therapy Dog';
assert.equal(ctx.collapseExactRepeatedWords(`${title} ${title}`),title);
assert.equal(ctx.collapseExactRepeatedWords('Choir! Choir! Choir! presents Landslide'),'Choir! Choir! Choir! presents Landslide');
assert.equal(ctx.eventDisplayTitle({title:`${title} ${title}`}),title);
assert.equal(ctx.eventDisplayTitle({title:'Choir! Choir! Choir! presents Landslide'}),'Choir! Choir! Choir! presents Landslide');
const creature = 'An Afternoon of Creature Connections with the Evergreen Writers Group';
const badged = `${creature} Featured Event. ${creature}`;
for (const [input, expected, imported = expected] of [
  [badged, creature],
  [`${title} Featured Event. ${title}`, title],
  [`${title} featured event. ${title}`, title],
  ['Featured Event. How Curators Choose Programmes', 'Featured Event. How Curators Choose Programmes', 'How Curators Choose Programmes'],
  ['Featured Event. Meet Juno', 'Featured Event. Meet Juno', 'Meet Juno'],
  ['Featured Event. Meet Juno Featured Event. Meet Juno', 'Featured Event. Meet Juno', 'Meet Juno'],
  ['Planning a Featured Event. A Practical Workshop', 'Planning a Featured Event. A Practical Workshop'],
  ['A Full Workshop Featured Event. A Different Workshop', 'A Full Workshop Featured Event. A Different Workshop'],
  ['Choir! Choir! Choir!', 'Choir! Choir! Choir!'],
]) {
  assert.equal(ctx.libraryDisplayTitle(input), imported, 'Importer display cleanup: ' + input);
  const event = { id: 'saved-id', title: input, observedAt: '2026-10-24T11:11:15.996Z' };
  const before = JSON.stringify(event);
  assert.equal(ctx.eventDisplayTitle(event), expected, 'Runtime display cleanup: ' + input);
  assert.equal(JSON.stringify(event), before, 'Display cleanup must not alter source title, ID or observation clock');
}
const accepted = JSON.parse(readFileSync(new URL('../data/build/city-events.json', import.meta.url), 'utf8')).events;
const acceptedBefore = JSON.stringify(accepted);
const creatureEvent = accepted.find(event => event.id === 'halifax-public-libraries-8a7fdff7c67b162a');
// The feed may eventually expire this occurrence; the importer fixture below
// retains the exact published ID regression independently of current coverage.
if (creatureEvent) assert.equal(ctx.eventDisplayTitle(creatureEvent), creature);
for (const event of accepted) ctx.eventDisplayTitle(event);
assert.equal(JSON.stringify(accepted), acceptedBefore, 'Reading all accepted events must preserve raw evidence');
const registry=JSON.parse(readFileSync(new URL('../data/event-source-supplements.json',import.meta.url),'utf8'));
const bedford=registry.sources.find(source=>source.id==='bedford-library-events');
assert.equal(bedford?.mode,'bibliocommons_events','Bedford must use its exhaustive official calendar, not the six-item location widget');
assert.equal(bedford?.url,'https://halifax.bibliocommons.com/v2/events?locations=BED');
assert.deepEqual(bedford?.allowedLocations,{'Bedford Public Library':'Bedford'});
console.log('Event title and categories: word boundaries prevent housing/art substring errors; exact repeated title only.');

await import('./test-library-featured-event-titles.mjs');
