import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../app-news.js', import.meta.url), 'utf8');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const context = { URL, URLSearchParams, Intl, Date, window: {}, escapeHtml };
vm.createContext(context); vm.runInContext(source, context);
const filters = context.newsStateFromParams(new URLSearchParams('q=library&region=Halifax&type=library_notice&page=2'));
assert.equal(context.newsHash(filters), '#news?q=library&region=Halifax&type=library_notice&page=2');
for (const bad of ['0','-1','1.2','NaN','Infinity']) assert.equal(context.newsStateFromParams(new URLSearchParams('page='+bad)).page,1);
const record = {id:'one',title:'Local <script>notice</script>',canonicalUrl:'https://example.org/story',sourceName:'Example & source',source_type:'official_public_notice',region:'Halifax',topics:['Community'],publishedAt:'2026-10-27',publishedPrecision:'day',summary:'Reviewed text',summaryKind:'reviewed_original',reviewStatus:'approved'};
assert.equal(context.acceptedNewsItems({version:1,items:[record,{...record,reviewStatus:'pending'},{...record,canonicalUrl:'javascript:alert(1)'}]}).length,1);
assert.equal(context.filteredNewsItems([record],{query:'community',region:'all',topic:'all',type:'all'}).length,1);
assert.equal(context.filteredNewsItems([record],{query:'',region:'Nova Scotia',topic:'all',type:'all'}).length,0);
assert.match(context.newsDateLabel(record),/27/);
const card=context.newsCard(record);
assert.ok(card.includes('&lt;script&gt;'));assert.ok(!card.includes('<script>'));
assert.ok(card.includes('Official announcement'));assert.ok(card.includes('noopener noreferrer'));
assert.ok(!context.newsCard({...record,summaryKind:'feed_description',summary:'Unreviewed copied description'}).includes('Unreviewed'));
assert.equal(context.newsExternalUrl('https://user:secret@example.org/'),'');
assert.equal(context.acceptedNewsItems({version:2,items:[record]}).length,0);
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
assert.ok(html.includes('data-route-link="news"'));assert.ok(html.includes('app-news.js'));

// Adding News must not squeeze the desktop header beyond its containing block.
// This is an offline CSS/geometry contract, not a browser-rendering assertion.
const desktopNav = html.match(/<nav class="desktop-nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1] || '';
assert.deepEqual([...desktopNav.matchAll(/href="(#[^"]+)"/g)].map(match => match[1]),
  ['#explore', '#events', '#news', '#specials', '#menus', '#map', '#saved']);
assert.match(html, /data-mobile-more-sheet[\s\S]*?<a href="#news">/, 'Keep News in mobile More');
const responsiveCss = readFileSync(new URL('../styles-responsive.css', import.meta.url), 'utf8');
const compactHeader = responsiveCss.match(/@media \(max-width:1180px\)\{([\s\S]*?)\n\}/)?.[1] || '';
const header = compactHeader.match(/\.header-inner\{grid-template-columns:(\d+)px minmax\((\d+)px,1fr\) auto;gap:(\d+)px\}/);
const navGap = Number(compactHeader.match(/\.desktop-nav\{gap:(\d+)px\}/)?.[1]);
assert(header, 'Compact desktop header must budget its own grid gaps');
const [brandWidth, searchMinimum, gridGap] = header.slice(1).map(Number);
assert(brandWidth >= 165 && searchMinimum >= 190, 'Keep the existing logo and usable search controls');
// Reserve 360px for the seven labels (Arial Bold 14px needs about 334px), plus
// their gaps. Include classic scrollbar gutters and both compact boundaries.
for (const width of [901, 902, 1024, 1180]) {
  for (const gutter of [0, 15, 17]) {
    const shell = Math.min(1100, width - gutter - 64);
    assert(brandWidth + searchMinimum + 2 * gridGap + 360 + 6 * navGap <= shell,
      `Seven-link header width budget must fit at ${width}px with a ${gutter}px gutter`);
  }
}
console.log('News UI tests passed: separate URL state, filtering, day precision, unsafe links/text, source labels and navigation.');

const core=readFileSync(new URL('../app-core.js',import.meta.url),'utf8');
const routeFunction=core.slice(core.indexOf('function renderRoute()'),core.indexOf('function updateNav('));
const integrated={...context,state:{query:'Cafe',page:3},globalSearch:{value:''},restaurants:[],destroyMap(){},updateNav(){},route:()=>({name:'news',params:new URLSearchParams('q=library&page=2')}),document:{querySelector:()=>null},window:{scrollTo(){}},renderNews(){}};
vm.createContext(integrated);vm.runInContext(routeFunction,integrated);integrated.renderRoute();
assert.equal(integrated.state.query,'Cafe');assert.equal(integrated.state.page,3);assert.equal(integrated.globalSearch.value,'Cafe');
console.log('News route integration preserves restaurant discovery state.');


// Publication-month archives use original dates, not observed/reviewed timestamps.
const archiveFilters = context.newsStateFromParams(new URLSearchParams('q=community&region=Halifax&topic=Community&type=local_business_publication&month=2026-09&page=2'));
assert.equal(context.newsHash(archiveFilters),'#news?q=community&region=Halifax&topic=Community&type=local_business_publication&month=2026-09&page=2');
for (const bad of ['2026-00','2026-13','26-09','2026-9','September','<script>','2026-09-01']) assert.equal(context.newsStateFromParams(new URLSearchParams('month='+bad)).month,'all');
assert.equal(context.newsMonthLabel('2026-03'),'March 2026');
assert.equal(context.newsPublicationMonth({...record,publishedAt:'2026-09-01'}),'2026-09');
assert.equal(context.newsPublicationMonth({...record,publishedPrecision:'instant',publishedAt:'2026-10-01T01:00:00.000Z'}),'2026-09','Halifax date and month agree across UTC boundary');
assert.equal(context.newsPublicationMonth({...record,publishedPrecision:'instant',publishedAt:'2026-10-01T04:00:00.000Z'}),'2026-10');
const business={...record,id:'business',source_type:'local_business_publication',publishedAt:'2026-09-15',observedAt:'2026-10-28T00:00:00.000Z',topics:['Community']};
const defaultFilters={query:'',region:'all',topic:'all',type:'all',month:'all',page:1};
assert.equal(context.acceptedNewsItems({version:1,items:[business]}).length,1);
assert.equal(context.acceptedNewsItems({version:1,items:[{...business,source_type:'aggregator'}]}).length,0);
assert.match(context.newsCard(business),/Local business publication/);
assert.doesNotMatch(context.newsCard(business),/Journalism/);
assert.match(context.newsCard(business),/Published <time datetime="2026-09-15"/);
assert.equal(context.filteredNewsItems([record,business],{...defaultFilters,month:'2026-09'}).length,1);
assert.equal(context.filteredNewsItems([record,business],{...defaultFilters,month:'2026-08'}).length,0);
assert.equal(context.filteredNewsItems([record,business],{...defaultFilters,month:'2026-09',type:'newsroom'}).length,0);
assert.equal(context.filteredNewsItems([record,business],{...defaultFilters,month:'2026-09',type:'local_business_publication',query:'community',topic:'Community',region:'Halifax'}).length,1);
const actualPayload=JSON.parse(readFileSync(new URL('../data/build/news.json',import.meta.url),'utf8'));
const payloadBefore=JSON.stringify(actualPayload);
let submit;
const renderContext={...context,window:{HALIFAX_NEWS:actualPayload},appView:{innerHTML:''},
 route:()=>({params:new URLSearchParams('month=2026-10&page=2')}),
 document:{querySelector:()=>({addEventListener(name,handler){assert.equal(name,'submit');submit=handler;}})},navigate(hash){renderContext.nextHash=hash;}};
vm.createContext(renderContext);vm.runInContext(source,renderContext);
renderContext.renderNews();
assert.match(renderContext.appView.innerHTML,/35 reviewed items · Page 2 of 3/);
assert.equal((renderContext.appView.innerHTML.match(/class="news-card"/g)||[]).length,12);
assert.match(renderContext.appView.innerHTML,/href="#news\?month=2026-10"/);
assert.match(renderContext.appView.innerHTML,/href="#news\?month=2026-10&amp;page=3"/);
assert.match(renderContext.appView.innerHTML,/name="newsMonth"[\s\S]*value="2026-10" selected/);
assert.match(renderContext.appView.innerHTML,/not a complete archive or live news service/);
assert.match(renderContext.appView.innerHTML,/not active alerts or upcoming-event listings/);
submit({preventDefault(){},currentTarget:{elements:{newsQuery:{value:' community '},newsRegion:{value:'Halifax'},newsTopic:{value:'Community'},newsType:{value:'local_business_publication'},newsMonth:{value:'2026-09'}}}});
assert.equal(renderContext.nextHash,'#news?q=community&region=Halifax&topic=Community&type=local_business_publication&month=2026-09','Applying any filters resets pagination');
// A restored bookmark with no selection entries is retained, not silently reset.
renderContext.route=()=>({params:new URLSearchParams('month=2026-05&page=99')});renderContext.renderNews();
assert.match(renderContext.appView.innerHTML,/<option value="2026-05" selected>May 2026<\/option>/);
assert.match(renderContext.appView.innerHTML,/0 reviewed items/);
assert.match(renderContext.appView.innerHTML,/No items match these filters/);
// Restore the prior URL (as Back/Forward does), including selected month/page.
renderContext.route=()=>({params:new URLSearchParams('month=2026-10&page=2')});renderContext.renderNews();
assert.match(renderContext.appView.innerHTML,/35 reviewed items · Page 2 of 3/);
const stable=renderContext.appView.innerHTML;renderContext.renderNews();assert.equal(renderContext.appView.innerHTML,stable);
assert.equal(JSON.stringify(actualPayload),payloadBefore,'Date filters cannot mutate the accepted snapshot');
assert(html.includes('app-news.js?v=20261028-news-archive-1'));
assert(html.includes('styles-news.css?v=20261028-news-archive-1'));
console.log('Archive UI passed: month URL state, exact day/instant boundaries, combined filters, page reset/preservation, empty bookmarks, repeated rendering and distinct business-publication labels.');

const newsCss=readFileSync(new URL('../styles-news.css',import.meta.url),'utf8');
assert.match(newsCss,/\.news-controls\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\);gap:12px/,'The filters form itself must establish a grid, not rely on a nested-form rule');
assert.match(newsCss,/@media\(max-width:1100px\)\{\.news-controls\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}\.news-controls label:first-child\{grid-column:auto\}/);
assert.match(newsCss,/@media\(max-width:650px\).*\.news-controls\{grid-template-columns:minmax\(0,1fr\)\}/);
