import assert from "node:assert/strict";
import { assertTasteMemberCompleteness, tasteDetailAddress, tasteDetailOpeningHours, tasteMemberApiUrl, tasteMemberLinksFromApi, tasteRegionId, tasteScopedDetailHtml } from "./lib/taste-ns-member-api.mjs";

const regionId = tasteRegionId([
  { id: 227, slug: "bay-of-fundy-annapolis-valley" },
  { id: 232, slug: "halifax-metro" }
]);
assert.equal(regionId, 232);
assert.throws(() => tasteRegionId([{ id: 232, slug: "south-shore" }]), /taste_region_resolution_0/);
assert.throws(() => tasteRegionId([{ id: 232, slug: "halifax-metro" }, { id: 999, slug: "halifax-metro" }]), /taste_region_resolution_2/);

const apiUrl = new URL(tasteMemberApiUrl({
  apiBase: "https://tasteofnovascotia.com/wp-json/wp/v2",
  categoryId: 238,
  regionId,
  page: 2
}));
assert.equal(apiUrl.pathname, "/wp-json/wp/v2/member");
assert.equal(apiUrl.searchParams.get("member-category[0]"), "238");
assert.equal(apiUrl.searchParams.get("member-region"), "232");
assert.equal(apiUrl.searchParams.get("per_page"), "100");
assert.equal(apiUrl.searchParams.get("page"), "2");

const records = [
  { id: 41420, link: "https://tasteofnovascotia.com/members/larrys-sandwiches-sides/", title: { rendered: "Larry&#8217;s Sandwiches &#038; Sides" }, "member-region": [232], modified: "2026-08-14T11:12:54", status: "publish" },
  { id: 41420, link: "https://tasteofnovascotia.com/members/duplicate/", title: { rendered: "Duplicate ID" }, "member-region": [232] },
  { id: 7, link: "https://tasteofnovascotia.com/members/outside-region/", title: { rendered: "Outside" }, "member-region": [227] },
  { id: 8, link: "https://example.com/members/offsite/", title: { rendered: "Offsite" }, "member-region": [232] },
  { id: 9, link: "http://tasteofnovascotia.com/members/insecure/", title: { rendered: "Insecure" }, "member-region": [232] },
  { id: 10, link: "https://tasteofnovascotia.com/not-a-member/", title: { rendered: "Wrong path" }, "member-region": [232] },
  { id: 11, link: "https://tasteofnovascotia.com/members/draft/", title: { rendered: "Draft" }, "member-region": [232], status: "draft" }
];
assert.deepEqual(tasteMemberLinksFromApi(records, {
  regionId,
  sourceUrl: "https://tasteofnovascotia.com/member-category/restaurants/"
}), [{
  id: 41420,
  name: "Larry&#8217;s Sandwiches &#038; Sides",
  url: "https://tasteofnovascotia.com/members/larrys-sandwiches-sides/",
  modifiedAt: "2026-08-14T11:12:54",
  apiRegionQualified: true
}]);
assert.doesNotThrow(() => assertTasteMemberCompleteness(1, [{ id: 41420 }], [{ id: "taste-ns-larrys" }]));
assert.throws(() => assertTasteMemberCompleteness(2, [{ id: 41420 }], [{ id: "taste-ns-larrys" }]), /taste_api_member_count_mismatch/);
assert.throws(() => assertTasteMemberCompleteness(1, [{ id: 41420 }], []), /taste_detail_incomplete/);

const decodeText = (value) => String(value)
  .replace(/<br\s*\/?>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ")
  .replace(/\s+/g, " ")
  .trim();
const currentDetail = `
  <header><a href="https://example.com/global">Unrelated global link</a></header>
  <main><div class="tast_single_member__content">
    <div class="taste_single_member__meta"><h2>Hours of Operation</h2><div class="taste_single_member__meta__value"><p>Please visit website for hours of operation.</p></div></div>
    <address class="taste_single_mebmer__address">63 Portland St.,<br>Dartmouth, Nova&nbsp;Scotia</address>
  </div><div class="taste_map__results">Other members</div></main><footer>Footer</footer>`;
const scoped = tasteScopedDetailHtml(currentDetail);
assert.doesNotMatch(scoped, /Unrelated global link/);
assert.doesNotMatch(scoped, /Other members/);
assert.equal(tasteDetailAddress(scoped, decodeText), "63 Portland St., Dartmouth, Nova Scotia");
assert.equal(tasteDetailOpeningHours(scoped, decodeText), null);
assert.equal(tasteDetailOpeningHours(`<main><div class="taste_single_member__meta"><h2>Hours of Operation</h2><div class="taste_single_member__meta__value"><p>Mon–Fri 11:00–20:00</p></div></div></main>`, decodeText), "Mon–Fri 11:00–20:00");

console.log("Taste of Nova Scotia member API tests passed.");
