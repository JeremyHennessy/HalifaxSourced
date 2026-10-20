"use strict";

// Name similarity alone cannot identify a branch. Require a corroborating civic
// address; unresolved relocations (including 40 vs 88 Alderney) stay unmatched.
window.HalifaxInspectionMatching = (() => {
  const words = (value) => String(value ?? "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const nameKey = (value) => words(value).replace(/\bthe\b/g, "").replace(/^bar\s+/, "").replace(/\s+/g, "");
  function addressParts(value, explicitCity) {
    const raw = String(value ?? "");
    const segments = raw.split(",");
    const locality = words(segments.slice(1).join(" "));
    const city = words(explicitCity) || (locality.match(/\b(halifax|dartmouth|bedford)\b/g) || []).at(-1) || "";
    const knownExplicitCity = words(explicitCity).match(/^(halifax|dartmouth|bedford)$/)?.[0];
    const localityCity = (locality.match(/\b(halifax|dartmouth|bedford)\b/g) || []).at(-1);
    if (knownExplicitCity && localityCity && knownExplicitCity !== localityCity) return null;
    // Do not guess at civic ranges or ambiguous unit-first addresses.
    if (/^\s*\d+\s*[-/]/.test(raw)) return null;
    const civic = words(segments[0]).match(/^(\d+[a-z]?)\s+(.+)$/);
    if (!civic) return null;
    let street = civic[2].split(/\b(?:unit|suite)\b/)[0].trim();
    const suffixes = { street: "st", st: "st", avenue: "ave", ave: "ave", road: "rd", rd: "rd", drive: "dr", dr: "dr", boulevard: "blvd", blvd: "blvd", lane: "ln", ln: "ln", place: "pl", pl: "pl", court: "ct", ct: "ct", crescent: "cres", cres: "cres", terrace: "terr", terr: "terr", gate: "gate", row: "row", highway: "hwy", hwy: "hwy", way: "way" };
    const fullStreet = street;
    const ending = street.split(" ").at(-1);
    const suffix = suffixes[ending] || "";
    if (suffix) street = street.slice(0, -ending.length).trim();
    if (!street || /\d/.test(street)) return null;
    return { civic: civic[1], street, fullStreet, suffix, city };
  }
  function sameLocation(a, b) {
    const left = addressParts(a.address, a.city);
    const right = addressParts(b.address, b.city);
    return Boolean(left && right && left.civic === right.civic && ((left.street === right.street && (!left.suffix || !right.suffix || left.suffix === right.suffix))
        || (left.suffix && left.street === right.fullStreet) || (right.suffix && right.street === left.fullStreet))
      && (!left.city || !right.city || left.city === right.city));
  }
  function matches(restaurant, records) {
    const name = nameKey(restaurant?.name);
    if (!name) return [];
    const seen = new Set();
    return (records || []).filter((record) => {
      const other = nameKey(record.name);
      const nameMatch = other && (name === other || (name.length >= 4 && other.startsWith(name)) || (other.length >= 4 && name.startsWith(other)) || (name.length > 8 && other.includes(name)) || (other.length > 8 && name.includes(other)) || (name.length >= 6 && other.length >= 6 && name.slice(0, 6) === other.slice(0, 6)));
      if (!nameMatch || !sameLocation(restaurant, record)) return false;
      const key = record.id || `${other}|${record.address}|${record.detailUrl}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 3);
  }
  return { matches };
})();
