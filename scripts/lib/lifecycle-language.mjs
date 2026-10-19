export const LIFECYCLE_SIGNAL_GROUPS = Object.freeze({
  closures: Object.freeze(["permanently closed", "final service", "last day of service", "closing our doors", "will close", "has closed", "is now closed", "decision to close", "decided to close", "end of lockside canteen", "temporarily closed", "will be closed", "closed for the season"]),
  moves: Object.freeze(["we moved", "has moved", "moving to", "relocated", "relocating", "new location"])
});

export function classifyLifecycleLanguage(value) {
  const text = String(value || "").toLowerCase();
  return Object.fromEntries(Object.entries(LIFECYCLE_SIGNAL_GROUPS).map(([kind, phrases]) => [kind, phrases.filter((phrase) => text.includes(phrase))]));
}
