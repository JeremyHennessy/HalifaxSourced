export const LIFECYCLE_SIGNAL_GROUPS = Object.freeze({
  closures: Object.freeze(["permanently closed", "final service", "last day of service", "closing our doors", "will close", "has closed", "is now closed", "decision to close", "decided to close", "end of lockside canteen", "temporarily closed", "will be closed", "closed for the season"]),
  moves: Object.freeze(["we moved", "has moved", "moving to", "relocated", "relocating", "new location"])
});

export function lifecycleText(value) {
  // Bounded fetches can end inside a script; remaining code is not venue prose.
  return String(value || '').replace(/<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1>|$)/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
}

export function classifyLifecycleLanguage(value) {
  const text = lifecycleText(value).toLowerCase();
  const relevant = phrase => [...text.matchAll(new RegExp(`\\b${phrase}\\b`, 'g'))].some(match => {
    const before = text.slice(Math.max(0, match.index - 300), match.index);
    const after = text.slice(match.index + phrase.length, match.index + phrase.length + 100);
    // Personal biographies and hypothetical customer reviews are not venue moves.
    if (/^(relocating|relocated|moving to)$/.test(phrase) && ((/\bbefore\s*$/.test(before) && /\b(?:chef|career|worked|born)\b/.test(before)) || /\b(?:i|i'd|i would)\b[^.!?]*\bconsider\s*$/.test(before))) return false;
    // Filter explicit other-city expansion, not a Halifax business moving away.
    if (phrase === 'new location' && /\b(?:soft opening|opening|opened|expanding)\b[^.!?]*$/.test(before) && /^[^.!?]{0,70}\b(?:mississauga|toronto|ottawa|brampton|london ontario)\b/.test(after)) return false;
    return true;
  });
  return Object.fromEntries(Object.entries(LIFECYCLE_SIGNAL_GROUPS).map(([kind, phrases]) => [kind, phrases.filter(relevant)]));
}
