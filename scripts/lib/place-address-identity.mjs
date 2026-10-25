// Only compare a clearly leading civic number. A first number found anywhere
// may instead be a phone number, unit, civic range or postal code. Those cases
// stay ambiguous rather than manufacturing either a match or a conflict.
export function unambiguousCivicNumber(value) {
  const address = String(value ?? "").trim();
  if (/^\d+[a-z]?\s*(?:[-/]|to\b)\s*\d/i.test(address)) return "";
  return address.match(/^(\d{1,5}[a-z]?)\s+(?=[a-z])/i)?.[1]?.toUpperCase() || "";
}
