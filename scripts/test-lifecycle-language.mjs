import { classifyLifecycleLanguage } from "./lib/lifecycle-language.mjs";

const cases = [
  ["After ten years, our final service is April 29.", "closures"],
  ["We are closing our doors at this address.", "closures"],
  ["We moved to 123 Portland Street.", "moves"],
  ["Our team is relocating to Dartmouth Crossing.", "moves"]
];
for (const [text, kind] of cases) {
  const result = classifyLifecycleLanguage(text);
  if (!result[kind]?.length) throw new Error(`Expected ${kind} classification for: ${text}`);
}
const neutral = classifyLifecycleLanguage("Open tonight with our seasonal dinner menu.");
if (neutral.closures.length || neutral.moves.length) throw new Error("Neutral operating language created a lifecycle signal.");
console.log("Lifecycle closure and move language regression passed.");
