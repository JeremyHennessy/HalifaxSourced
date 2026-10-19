import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("./refine-dartmouth-directory.mjs", import.meta.url), "utf8");
const start = source.indexOf("function decode(value) {");
const end = source.indexOf("\nfunction safeUrl(value, base) {", start);
assert(start >= 0 && end > start, "Dartmouth decoder and name normalizer must be present");
const context = vm.createContext({});
vm.runInContext(source.slice(start, end) + "\nthis.parseName = value => normalizeDirectoryCafeName(decode(value));", context);
const parseName = context.parseName;

assert.equal(parseName("Caf&amp;eacute; Goodluck"), "Café Goodluck", "Nested named entities should resolve");
assert.equal(parseName("Caf&eacute; Goodluck"), "Café Goodluck", "Named accent should resolve");
assert.equal(parseName("Caf&#233; Goodluck"), "Café Goodluck", "Numeric accent should resolve");
assert.equal(parseName("Caf<strong>e</strong> Goodluck"), "Cafe Goodluck", "A split inline-tag spelling must not create a new identity");
assert.equal(parseName("Caf e Goodluck"), "Cafe Goodluck", "Observed Dartmouth directory malformed cafe spelling should normalize");
assert.equal(parseName("Caf e Marco Polo"), "Cafe Marco Polo", "Second observed malformed cafe spelling should normalize");
assert.equal(parseName("Cafe Goodluck"), "Cafe Goodluck", "Normal source spelling must remain stable");
assert.equal(parseName("Café Goodluck"), "Café Goodluck", "Already correct accent must remain stable");
assert.equal(parseName("Café &amp; Bakery"), "Café & Bakery", "Ampersands must not create names or duplicate identities");
assert.equal(parseName("The Canteen on Portland"), "The Canteen on Portland", "Unrelated restaurant names must not change");
console.log("Dartmouth directory decode tests passed: correct/encoded/split café names and unrelated names preserved.");
