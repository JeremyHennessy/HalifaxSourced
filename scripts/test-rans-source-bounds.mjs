import assert from "node:assert/strict";
import { fetchBoundedRansSearchIndex, isSourceAccessRestriction } from "./review-directory-sources.mjs";

const headers = (pages = "1", total = "0") => new Headers({
  "x-wp-totalpages": pages,
  "x-wp-total": total
});

for (const error of [
  Object.assign(new Error("source_access_hold"), { code: "SOURCE_ACCESS_HOLD" }),
  new Error("http_401"),
  new Error("http_403"),
  new Error("http_429")
]) assert.equal(isSourceAccessRestriction(error), true);
for (const error of [new Error("http_404"), new Error("http_500"), new Error("robots_disallow")]) {
  assert.equal(isSourceAccessRestriction(error), false);
}

const restrictedCalls = [];
const restrictedFailures = [];
const restricted = await fetchBoundedRansSearchIndex({
  apiBase: "https://rans.example/wp-json/wp/v2",
  terms: ["Halifax", "Dartmouth", "Bedford"],
  getJson: async (url) => {
    restrictedCalls.push(url);
    throw new Error("http_403");
  },
  onFailure: (failure) => restrictedFailures.push(failure)
});
assert.equal(restricted.accessRestricted, true);
assert.equal(restrictedCalls.length, 1, "One access restriction must stop later same-source query URLs");
assert.equal(restrictedFailures.length, 1);
assert.deepEqual(restricted.items, []);

const ordinaryCalls = [];
const ordinaryFailures = [];
const ordinary = await fetchBoundedRansSearchIndex({
  apiBase: "https://rans.example/wp-json/wp/v2",
  terms: ["Halifax", "Dartmouth"],
  getJson: async (url) => {
    ordinaryCalls.push(url);
    if (url.includes("Halifax")) throw new Error("http_500");
    return { json: [{ id: 7, url: "https://rans.example/restaurants/seven", title: "Seven" }], headers: headers("1", "1") };
  },
  onFailure: (failure) => ordinaryFailures.push(failure)
});
assert.equal(ordinary.accessRestricted, false);
assert.equal(ordinaryCalls.length, 2, "A non-access failure may move to the next bounded search term");
assert.equal(ordinaryFailures.length, 1);
assert.deepEqual(ordinary.items, [{ id: 7, url: "https://rans.example/restaurants/seven", title: "Seven" }]);
assert.equal(ordinary.searchHits, 1);

const pagedCalls = [];
const paged = await fetchBoundedRansSearchIndex({
  apiBase: "https://rans.example/wp-json/wp/v2",
  terms: ["Halifax"],
  maxPagesPerTerm: 2,
  getJson: async (url) => {
    pagedCalls.push(url);
    const page = new URL(url).searchParams.get("page");
    return {
      json: [{ id: 9, url: `https://rans.example/restaurants/nine-${page}`, title: `Nine ${page}` }],
      headers: headers("3", "3")
    };
  }
});
assert.equal(pagedCalls.length, 2, "Configured page bound remains enforced");
assert.deepEqual(paged.items, [{ id: 9, url: "https://rans.example/restaurants/nine-2", title: "Nine 2" }]);
assert.equal(paged.searchHits, 6);

console.log("RANS source bounds passed: access restrictions stop later query URLs while bounded ordinary failures and pagination retain their prior behavior.");
