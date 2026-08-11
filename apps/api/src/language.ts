// #103 (E5 slice 2) — the language gate. Every posting gets a language label the moment it enters
// the pool (apps/api/src/preview.ts's loadPostings(), the ingest point — #86 decision 2), decided
// HERE, locally and deterministically, no model call. This module is also the ONE place the
// eligibility rule lives (#86 AC4): the detector, the session's reading-languages accessor, the
// product's served-languages default, and the predicate that decides whether a posting is eligible
// to be shown, all live here. No "=== 'en'" check exists anywhere else in the app — every route or
// pipeline step that reads the pool goes through preview.ts's eligiblePostings(), which is built on
// top of the functions below.
import type { SessionRecord } from "./sessions.js";

// Script-range detection is PROPORTIONAL, not first-match-wins (#103 code review finding 4): a
// single non-Latin character no longer flips an otherwise-English advert. The target market is
// APAC, where a genuinely English Hong Kong/Singapore advert may legitimately quote a Chinese
// company name, a local address, or one loanword — that must not hide the whole advert from every
// English reader, which is exactly the failure this slice exists to prevent. A script only counts
// once it accounts for a clear share of the text's letter-like characters.
//
// Order still matters for one pair: Japanese prose freely mixes kanji (CJK Unified Ideographs) with
// kana, while Chinese prose has no kana at all. Kana is checked FIRST so Japanese text — which
// nearly always carries at least a few kana particles/conjugations — is caught as "ja" before its
// kanji share could be mistaken for Chinese; kanji-only text (no kana) then correctly falls to "zh".
const SCRIPT_RANGES: ReadonlyArray<{ lang: string; pattern: RegExp }> = [
  { lang: "ja", pattern: /[぀-ゟ゠-ヿ]/g }, // Hiragana / Katakana
  { lang: "zh", pattern: /[一-鿿㐀-䶿]/g }, // CJK Unified Ideographs (+ Ext A)
  { lang: "ko", pattern: /[가-힣]/g }, // Hangul syllables
  { lang: "th", pattern: /[฀-๿]/g }, // Thai
  { lang: "ru", pattern: /[Ѐ-ӿ]/g }, // Cyrillic
  { lang: "ar", pattern: /[؀-ۿ]/g }, // Arabic
  { lang: "hi", pattern: /[ऀ-ॿ]/g }, // Devanagari
];

// Every letter-like character across Latin + all scripts above, used as the denominator for a
// script's share of the text. Kept in sync with SCRIPT_RANGES by construction (built from it).
const ALL_LETTERS_PATTERN = new RegExp(
  `[a-zA-Z${SCRIPT_RANGES.map((s) => s.pattern.source.slice(1, -1)).join("")}]`,
  "g",
);

// A script must account for at least this share of the text's letter-like characters to be
// decisive. Picked well above "a stray proper noun or two" (typically a few percent of a real
// advert) and well below "this text is actually written in that script" (usually 90%+) — not tuned
// to a corpus, just a wide, defensible middle.
const SCRIPT_DOMINANCE_THRESHOLD = 0.3;

// Latin-script text with no dominant non-Latin script: judge by how much it reads like English.
// These are near-universal in genuine English prose (articles, conjunctions, prepositions, common
// pronouns/verb forms) and near-absent in another Latin-script language's text — cheap,
// deterministic, no dependency, and good enough for the corpus this gates (job-advert prose, not
// single words).
const ENGLISH_FUNCTION_WORDS = new Set([
  "the", "and", "of", "to", "a", "in", "is", "you", "for", "with", "on", "are", "this", "that",
  "as", "be", "at", "by", "an", "or", "will", "have", "has", "we", "our", "your", "from", "not",
  "it", "its", "all", "who", "their", "was", "were", "can",
]);

// Latin-script Asian languages need positive labels too (#113): otherwise retained Vietnamese and
// Indonesian adverts accumulate under "und" and opening either language later starts with an empty
// labelled pool. These small job-advert vocabularies are checked before English so an advert that
// also contains borrowed English technology names is not mistaken for English.
const VIETNAMESE_WORDS = new Set([
  "các", "có", "công", "của", "đang", "được", "kinh", "không", "là", "làm", "một", "nghiệm",
  "quản", "tôi", "trong", "tuyển", "và", "việc", "với",
]);
const INDONESIAN_WORDS = new Set([
  "akan", "anda", "atau", "bekerja", "berpengalaman", "dan", "dari", "dalam", "dengan", "departemen",
  "dicari", "digital", "kami", "kemampuan", "kerja", "lintas", "lowongan", "memiliki", "memimpin", "mengelola",
  "pengalaman", "perbankan", "proyek", "sebagai", "serta", "tim", "transformasi", "untuk", "yang",
]);

// English job adverts are not always prose. ATS bullets and recruiter one-liners can contain almost
// no function words, so an explicit English structural marker plus dense recognized advert
// vocabulary is the language evidence. A bare skills blob has no such marker and is accepted only
// when every token is recognized vocabulary.
// There is deliberately no generic density fallback: job jargon is freely borrowed into other
// Latin-script languages and cannot establish that the surrounding text is English.
const ENGLISH_ADVERT_WORDS = new Set([
  "agile", "budget", "cloud", "confluence", "delivery", "engagement", "governance", "hiring",
  "hybrid", "jira", "manage", "management", "manager", "planning", "program", "programme", "project",
  "projectmanagement", "qualifications", "remote", "requirements", "responsibilities", "risk", "scrum",
  "senior", "skills", "stakeholder", "team",
]);
const ENGLISH_ADVERT_MARKER = /\b(?:responsibilities|requirements|qualifications|skills|hiring now)\s*:/i;

// Below this many Latin words there isn't enough signal to trust a frequency check either way —
// falls to "und" (see detectLanguage's doc comment for how "und" is treated downstream).
const MIN_WORDS_TO_JUDGE = 8;

// Genuine English prose runs roughly 30-40% function words; foreign Latin-script prose (with the
// odd English loanword or proper noun mixed in) runs far below this. Picked comfortably under the
// English floor and comfortably over "a couple of stray English words," not tuned to a corpus.
const ENGLISH_FUNCTION_WORD_THRESHOLD = 0.12;

/**
 * Local, deterministic language detection for one posting's text — no model call, no per-advert
 * cost (#86 decision). Returns a BCP-47 primary subtag ("en", "vi", "id", "zh", "ja", "ko", "th",
 * "ru", "ar", "hi") or "und" ("undetermined") when the text is too short, or reads as an
 * unsupported Latin-script language, to classify with confidence.
 *
 * "und" handling is a deliberate, documented choice, not an omission: languageEligible() below
 * treats "und" as NOT eligible for anyone. An advert we can't confidently read is exactly the case
 * this slice exists to hold back rather than guess about — showing it risks a card nobody in the
 * audience can actually act on, and withholding it costs nothing, since the whole point of #86 is
 * that the non-English pool stays stocked (not shown) for when a language opens up. Ingest also
 * counts "und" separately from a real-language skip (preview.ts's loadPostings) — an undetermined
 * label usually means the excerpt was too short to judge, which is a different operational signal
 * from "this is genuinely a Chinese/Japanese/... advert."
 */
export function detectLanguage(text: string): string {
  const letterCount = text.match(ALL_LETTERS_PATTERN)?.length ?? 0;
  if (letterCount > 0) {
    for (const { lang, pattern } of SCRIPT_RANGES) {
      const share = (text.match(pattern)?.length ?? 0) / letterCount;
      if (share >= SCRIPT_DOMINANCE_THRESHOLD) return lang;
    }
  }
  const words: string[] = text.toLowerCase().normalize("NFC").match(/\p{Script=Latin}+/gu) ?? [];
  if (words.length < MIN_WORDS_TO_JUDGE) return "und";
  const vietnameseHits = words.filter((w) => VIETNAMESE_WORDS.has(w)).length;
  if (vietnameseHits >= 3 && vietnameseHits / words.length >= 0.12) return "vi";
  const indonesianHits = words.filter((w) => INDONESIAN_WORDS.has(w)).length;
  if (
    (indonesianHits >= 3 && indonesianHits / words.length >= 0.12) ||
    (words.includes("lowongan") && indonesianHits >= 2)
  ) return "id";
  const hits = words.filter((w) => ENGLISH_FUNCTION_WORDS.has(w)).length;
  const distinctHits = new Set(words.filter((w) => ENGLISH_FUNCTION_WORDS.has(w))).size;
  if (distinctHits >= 2 && hits / words.length >= ENGLISH_FUNCTION_WORD_THRESHOLD) return "en";
  const advertHits = words.filter((w) => ENGLISH_ADVERT_WORDS.has(w)).length;
  if (ENGLISH_ADVERT_MARKER.test(text) && advertHits >= 2 && advertHits / words.length >= 0.6) return "en";
  return advertHits === words.length ? "en" : "und";
}

/**
 * The languages the product currently serves — the same default readingLanguages() returns for any
 * session, but named separately for the one path that has no session at all: preview.ts's
 * pre-signup magic-mirror preview, which still picks and shows a real advert and burns a real LLM
 * tailor call (#103 code review finding 1). One literal, here — the ingest counter and every pool
 * read agree on what "served" means; nothing else in the app may redeclare it.
 */
export const SERVED_LANGUAGES: string[] = ["en"];

/**
 * A session's reading languages — always a LIST, never a single value (#86 AC3): a Hong Kong user
 * may read English and Chinese, and one-language-per-user would silently withhold Chinese roles
 * they could actually take. Defaults to English-only (SERVED_LANGUAGES).
 *
 * #86 decision 4: nothing writes a user's languages yet — no route, no UI — so a persisted column
 * would be dead weight ahead of anything using it. This single accessor is the one place that
 * changes when storage lands; every caller already goes through it rather than reading a field
 * directly, so adding a real store later is a one-function change. The session parameter is
 * intentionally unused today — it's the seam that change lands on, not dead weight.
 */
export function readingLanguages(_session: Pick<SessionRecord, "id">): string[] {
  return [...SERVED_LANGUAGES];
}

/**
 * The one eligibility rule (#86 AC4): is something labelled `contentLanguage` visible to a reader
 * whose languages are `userLanguages`? Applied to a posting's own detected language AND, separately,
 * to its requirement set's stated language (#103 code review finding 5) — same predicate, two call
 * sites, never a second rule. "und" is explicitly never eligible, for anyone — see detectLanguage's
 * doc comment for why an unreadable label is held back rather than guessed at.
 */
export function languageEligible(contentLanguage: string, userLanguages: string[]): boolean {
  if (contentLanguage === "und") return false;
  return userLanguages.includes(contentLanguage);
}
