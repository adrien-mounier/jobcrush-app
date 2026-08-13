// #214 — the ONE client-side matcher over the server-sent area vocabulary, shared by the front
// door's chips widget and the profile rail's door (code review: the two copies had already
// diverged). Mirrors the server's own rule (exact alias, else a ≥4-char alias appearing inside the
// normalised text); the DATA is always the server's vocabulary, and the server still re-resolves on
// save — this is UX sugar, never the gate.
export interface AreaVocabularyEntry {
  alias: string;
  market: string;
  label: string;
}

export function matchAreaText(
  text: string,
  vocabulary: readonly AreaVocabularyEntry[],
): AreaVocabularyEntry | null {
  const lower = text.trim().replace(/\s+/g, " ").toLowerCase();
  return (
    vocabulary.find((v) => v.alias === lower) ??
    vocabulary.find((v) => v.alias.length >= 4 && lower.includes(v.alias)) ??
    null
  );
}

/** The type-ahead's suggestion list: vocabulary entries matching the query, deduped by label,
 *  minus already-placed chips, capped at 5. */
export function areaSuggestions(
  query: string,
  vocabulary: readonly AreaVocabularyEntry[],
  placedLabels: readonly string[],
): AreaVocabularyEntry[] {
  const lower = query.trim().toLowerCase();
  if (lower.length === 0) return [];
  return vocabulary
    .filter((v) => v.alias.includes(lower) || v.label.toLowerCase().includes(lower))
    .filter((v, index, all) => all.findIndex((o) => o.label === v.label) === index)
    .filter((v) => !placedLabels.includes(v.label))
    .slice(0, 5);
}
