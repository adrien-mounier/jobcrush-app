// #336 — the CV's languages in structured form: the language, plus the CV's OWN level word, kept as
// written. ADR-0016 clause 1: the languages question pre-ticks a language only where that word says
// the person already works in it; anything else is shown unticked with the word beside it, and the
// person decides.
//
// The level word is never turned into a ladder rung (ADR-0008 clause 6: "fluent" does not answer a
// situation) — pre-ticking only proposes a DECLARATION, and nothing is stored until the person
// submits the question (ADR-0013 clause 3: a proposal on the screen they are looking at is not silent).
//
// Parsed on read from the stored `lang-` claim (the miner's own contract: one claim per language,
// with level), so every CV already imported gets the structure too, with no claim-schema change.
import type { ClaimRecord } from "./claims.js";

export interface CvLanguage {
  language: string;
  /** The CV's own level word ("Native", "B2", "conversational"), or null when the CV gives none. */
  level: string | null;
  /** True only when `level` says the person works in the language — a proposal, never a stored fact. */
  preTicked: boolean;
}

/** Level words that mean "I can work in this language". A list that grows (golden rule) — add a
 *  word here, never a branch. Matched as a whole word anywhere in the CV's level text, so
 *  "Professional working proficiency" and "native speaker" count. */
const WORKING_LEVEL_WORDS: readonly string[] = ["native", "fluent", "professional", "bilingual", "mother tongue"];
/** Words that pull a level back below working: "limited professional", "semi-fluent", "not fluent". */
const BELOW_WORKING_WORDS: readonly string[] = ["limited", "semi", "not", "non", "basic", "elementary"];
/** Every word that can carry a level in a sentence-style line ("fluent in English", "Native Polish
 *  speaker"), where no separator splits language from level. Also a list that grows. */
const LEVEL_WORDS: readonly string[] = [
  ...WORKING_LEVEL_WORDS,
  ...BELOW_WORKING_WORDS,
  "conversational", "intermediate", "advanced", "beginner", "proficient", "working", "some",
  "a1", "a2", "b1", "b2", "c1", "c2",
];
/** Glue around a level in a sentence, dropped from the language name: "speaker", "fluent IN". */
const FILLER_WORDS: readonly string[] = ["speaker", "in", "of", "knowledge", "proficiency", "level"];

const wordRe = (w: string, flags = "i") => new RegExp(`\\b${w}\\b`, flags);
const hasWord = (text: string, words: readonly string[]) => words.some((w) => wordRe(w).test(text));
const working = (level: string | null): boolean =>
  level !== null && hasWord(level, WORKING_LEVEL_WORDS) && !hasWord(level, BELOW_WORKING_WORDS);

/** "Polish (Native)", "English - Fluent", "French: B2", "Spanish, conversational", "Italian" — the
 *  language is the text before the first separator, and everything after it is the CV's level, kept
 *  as written ("Portuguese (Brazilian) – Fluent" reads as Portuguese, "Brazilian – Fluent").
 *  A sentence-style line with no separator ("fluent in English", "Native Polish speaker") is read by
 *  its level words instead: those are the level, and what is left once they and their glue are
 *  gone is the language. */
export function parseCvLanguage(text: string): { language: string; level: string | null } {
  const m = /^\s*([^(:,–—]+?)\s*(?:\s-\s|[(:,–—])(.*)$/.exec(text);
  const split = m && m[2]!.replace(/[()]/g, " ").replace(/^[\s:,–—-]+/, "").replace(/\s+/g, " ").trim();
  if (m && split) return { language: m[1]!, level: split };
  const levels = LEVEL_WORDS.flatMap((w) => [...text.matchAll(wordRe(w, "gi"))]).sort((x, y) => x.index! - y.index!);
  if (levels.length === 0) return { language: (m?.[1] ?? text).trim(), level: null };
  let language = text;
  for (const w of [...LEVEL_WORDS, ...FILLER_WORDS]) language = language.replace(wordRe(w, "gi"), " ");
  language = language.replace(/[^\p{L}\s]/gu, " ").replace(/\s+/g, " ").trim();
  return { language: language || text.trim(), level: levels.map((l) => l[0]).join(" ") };
}

/** Every language the CV lists, in CV order, once each — a rejected claim is the person's own "not
 *  this", so it is left out; a language with no level word is kept, unticked, never dropped. */
export function cvLanguages(claims: readonly ClaimRecord[]): CvLanguage[] {
  const seen = new Set<string>();
  const out: CvLanguage[] = [];
  for (const c of claims) {
    if (!c.id.startsWith("lang-") || c.decision === "rejected") continue;
    const { language, level } = parseCvLanguage(c.text);
    const key = language.toLowerCase();
    if (!language || seen.has(key)) continue;
    seen.add(key);
    out.push({ language, level, preTicked: working(level) });
  }
  return out;
}
