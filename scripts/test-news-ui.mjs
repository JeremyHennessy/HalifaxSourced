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
