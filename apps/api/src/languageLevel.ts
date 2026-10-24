// #165 — a language and its level are two facts (ADR-0008 clause 6), and the level is a LADDER
// (ADR-0003 clause 8a): ordered rungs written as concrete things a person can do, placed by the
// person, asked once per language ever, and — the clause's own words — "being below the bar never
// withdraws a job".
//
// This module owns the ladder end to end: its rungs, how a stored eligibility value is read back as
// one, the advert-triggered question, and that question's write path. withdrawal.ts owns exactly one
// line of it (which value is an explicit "no"); nothing else in the app may re-declare a rung.
//
// 🚨 What this replaces, and why the replacement is the whole point. Before #165 the languages
// question was a binary multi-select: ticked wrote "professional", UNTICKED WROTE "none", and
// withdrawal.ts reads "none" as an explicit "I don't speak this" — so one mistap on a checkbox
// silently removed every posting that required that language. The ladder dissolves that failure
// STRUCTURALLY rather than by being more careful: nothing a person can leave alone writes a value at
// all, the only value that withdraws is a rung they must deliberately tap ("not-at-all"), and every
// legacy value from the old shape reads as UNKNOWN here (levelOf below) — which as a level never
// withdraws, and which is what makes the four already-answered languages get re-asked on the new
// ladder. (#425: a language on neither the CV nor the profile does withdraw a job requiring it — as
// "not on your profile", named on the reveal with a one-tap "I speak it", never as a silent no.)
import type { AdRequirementV1, AdRequirementsV1, LanguageLevel } from "@jobcrush/contracts";
import type { EligibilityFact, EligibilityStore } from "./eligibility.js";
import { cvLanguages, isKnownLanguageName, type LanguageClaim } from "./cvLanguages.js";

/** The rungs, lowest first. The wording is the contract with the person: every rung is a SITUATION
 *  they can picture themselves in, never a code ("B2"), never an adjective ("fluent") — ADR-0008
 *  clause 6's reason is that "fluent" does not answer a situation, so taking it at face value grades
 *  someone at a level they never placed themselves at.
 *
 *  The rungs are #125 decision 3's, verbatim and complete — *native · can negotiate a contract · can
 *  run a meeting · gets by day to day · a few words · none* — ascending here because that is what a
 *  level means. Worded as situations rather than as its bare nouns (ADR-0003 clause 8a), including
 *  "native", which is a label rather than a situation until it says what the person can do.
 *
 *  One token deliberately differs from #125's prose: its bottom rung is called `none`, and the STORED
 *  value here is `not-at-all`. It has to be. #123's tick-list already wrote the literal string "none"
 *  for every language a person left UNTICKED, and those facts still sit in the store — naming the new
 *  deliberate answer "none" would make a mistap indistinguishable from a considered one and rebuild
 *  the exact bug this ticket removes. The rung is #125's; only its spelling in the database is ours. */
export const LANGUAGE_LADDER: ReadonlyArray<{ value: LanguageLevel; situation: string }> = [
  { value: "not-at-all", situation: "I don't speak this one" },
  { value: "a-few-words", situation: "I know a few words" },
  { value: "gets-by", situation: "I get by day to day" },
  { value: "meetings", situation: "I can run a meeting in it" },
  { value: "negotiate", situation: "I can negotiate a contract in it" },
  { value: "native", situation: "I speak it like my first language" },
];

/** Said before the rungs, never after (#125 decision 4: "the screen must say so BEFORE she answers,
 *  not after"). It names the one answer with a cost and, just as importantly, says that the others
 *  have none — a person who cannot tell which taps are safe answers defensively, and answering
 *  defensively about your own ability is how a winnable job gets lost. */
export const LANGUAGE_LEVEL_CONSEQUENCE =
  "Only the last one takes jobs out of your deck — every other answer keeps them all, even if this job" +
  " wants more than you picked.";

/** The one value that means an explicit "I don't speak this" — the ONLY thing that may ever withdraw
 *  a posting (#125 / ticket #165 point 4). Named here, imported by withdrawal.ts, so the rule and the
 *  vocabulary can never drift into "the withdrawal check tests a value nothing writes". */
export const LANGUAGE_NOT_AT_ALL: LanguageLevel = "not-at-all";

/** A language the person has DECLARED (it is theirs, it goes on the CV, adverts may ask about it) but
 *  whose level they have not placed yet. Deliberately not a rung: the ladder is asked when an advert
 *  makes it matter, not at the moment of declaring — declaring costs one word, and a level costs a
 *  question, so charging the second for the first is what makes people abandon sign-up (ADR-0011
 *  clause 1). Never withdraws: it is not "not-at-all", and it is not a level at all. */
export const LANGUAGE_DECLARED = "declared";

const RUNGS = new Set<string>(LANGUAGE_LADDER.map((r) => r.value));

/** The order the ladder is OFFERED in, which is deliberately not the order it is ranked in.
 *  LANGUAGE_LADDER ascends because that is what a level means; the question offers it descending, so
 *  the explicit "I don't speak this one" sits LAST. The top of a list is where a distracted thumb
 *  lands, and this is the one answer that can cost a person jobs — #165 exists because a mistap used
 *  to do exactly that, and putting the same tap back at the top of the new question would rebuild the
 *  bug in a new shape. Composed once, here, so no client re-derives it (or gets it backwards). */
const ASK_ORDER: ReadonlyArray<{ value: LanguageLevel; situation: string }> = [...LANGUAGE_LADDER].reverse();

/** The rung a stored eligibility value places the person on, or null when it places them on none.
 *
 *  Null covers three genuinely different situations that all mean the SAME thing to every caller —
 *  we do not know this person's level:
 *    - no fact at all (the caller never found one to pass here);
 *    - `declared` — they told us they speak it, and no advert has asked how well yet;
 *    - a PRE-#165 value ("professional", "none", "conversational"). These came from the binary
 *      tick-list and are the wrong shape — "professional" is an adjective, not a situation, and
 *      "none" could be a mistap. Reading them as unknown is ticket #165 point 6 ("the four already
 *      answered languages are re-asked on the new ladder") implemented by construction rather than by
 *      a migration: the ask fires because the level is unknown, and the old answer stops being read
 *      as a level anywhere. */
export function levelOf(value: string | undefined): LanguageLevel | null {
  return value !== undefined && RUNGS.has(value) ? (value as LanguageLevel) : null;
}

/** Whether a stored value means "this language is mine" — true for every rung above not-at-all, for
 *  `declared`, and for the legacy positives ("professional", "conversational") so a person who
 *  answered the old tick-list does not watch their languages vanish from their profile while the
 *  ladder re-asks the level. Legacy "none" is deliberately NOT declared: it is the mistap value, and
 *  the person may never have meant to say anything at all. */
export function isDeclaredValue(value: string): boolean {
  if (value === LANGUAGE_NOT_AT_ALL || value === "none") return false;
  return value === LANGUAGE_DECLARED || RUNGS.has(value) || value === "professional" || value === "conversational";
}

/** The languages this session has declared, in stored order — the profile's own list, and the set the
 *  declaring question pre-fills from. Reads the store's canonical scope word, never a CV claim. */
export function declaredLanguages(facts: readonly EligibilityFact[]): string[] {
  return facts.filter((f) => f.dimension === "language" && isDeclaredValue(f.value)).map((f) => f.familyId);
}

// #425 — the language-name rules every match between a JOB's language and the person's goes
// through: the withdrawal predicate, the ladder's ask, and the card's language bar. (A person's word
// against their own stored rows — answerLanguageLevel, languageDeclarationPlan — stays a plain
// case-folded match: one spelling space.) Lists that grow (golden rule): add a name, never a branch.
/** Two names for one language: the other name, and the one it is matched and shown as. */
const SAME_LANGUAGE: Readonly<Record<string, string>> = { putonghua: "Mandarin", "mandarin chinese": "Mandarin" };
/** A name that covers several languages: a job asking for it is met by any one of them. Never the
 *  reverse — "Chinese" on a CV does not say which one the person speaks. */
const COVERS: Readonly<Record<string, readonly string[]>> = { chinese: ["mandarin", "cantonese"] };

const spelled = (name: string): string => {
  const word = name.trim().replace(/\s+/g, " ");
  return SAME_LANGUAGE[word.toLowerCase()] ?? word;
};
const languageKey = (name: string): string => spelled(name).toLowerCase();

/** True when a language the person has (`have`) meets the language a job names (`need`). */
export function meetsLanguage(have: string, need: string): boolean {
  const h = languageKey(have);
  const n = languageKey(need);
  return h === n || (COVERS[n]?.includes(h) ?? false);
}

/** The languages one requirement subject names, in groups: every group must be met, and a group is
 *  met by any one of its languages. "Cantonese and English" is [["Cantonese"], ["English"]],
 *  "English or Mandarin" is [["English", "Mandarin"]], "Putonghua" is [["Mandarin"]]. A note in
 *  brackets is not a language. The reader is asked for one concrete language (ad-reader.md); this
 *  only has to survive what it writes anyway: joins, and a word around the language ("fluent
 *  English", "written and spoken Chinese") — a name that is no language reads as the language names
 *  inside it, and a part naming none is dropped while another part names one. A subject naming no
 *  language a list knows ("Hokkien") is kept as written. Also splits a CV line naming two languages. */
export function languagesNamed(subject: string): string[][] {
  const groups = subject
    .replace(/\([^)]*\)/g, " ")
    .replace(/\band\s*\/\s*or\b/gi, " or ")
    .split(/,|;|&|\+|\band\b|\bplus\b/i)
    .map((group) =>
      group
        .split(/\/|\bor\b/i)
        .map(spelled)
        .filter(Boolean)
        .flatMap((name) => (isLanguageName(name) ? [name] : languageWordsIn(name).length > 0 ? languageWordsIn(name) : [name])),
    )
    .filter((group) => group.length > 0);
  const real = groups.filter((group) => group.some(isLanguageName));
  return real.length > 0 ? real : groups;
}

/** True when one of `have` meets one language of `group` (a group from languagesNamed). */
export const groupMet = (group: readonly string[], have: readonly string[]): boolean =>
  group.some((need) => have.some((h) => meetsLanguage(h, need)));

/** The stored language facts about any language of `group`. */
export const languageFactsFor = (group: readonly string[], facts: readonly EligibilityFact[]): EligibilityFact[] =>
  facts.filter((f) => f.dimension === "language" && group.some((need) => meetsLanguage(f.familyId, need)));

/** A real language name: the runtime's own list (#337), or one of ours CLDR does not carry (Mandarin). */
function isLanguageName(name: string): boolean {
  return isKnownLanguageName(spelled(name)) || Object.values(SAME_LANGUAGE).some((v) => v.toLowerCase() === languageKey(name));
}

/** The real language names among the words of free text: "fluent English" → ["English"]. */
function languageWordsIn(text: string): string[] {
  return [...new Set(text.split(/[^\p{L}]+/u).filter(isLanguageName).map(spelled))];
}

/** Each CV language line (cvLanguages: any line not rejected) as the languages it names, and whether
 *  its level word says the person works in them. Every real language name on the line counts, so a
 *  line the parser cannot split ("Fluent in English, French and German" parses as the language
 *  "Fluent in English") or one with a variety in brackets ("Chinese (Mandarin) – Native") names them
 *  all; a word no list knows ("Hokkien (Native)") is kept as written. */
function cvLines(claims: readonly LanguageClaim[]): Array<{ names: string[]; working: boolean; text: string }> {
  return claims.flatMap((claim) => {
    const [line] = cvLanguages([claim]);
    if (!line) return [];
    const parsed = languagesNamed(line.language).flat();
    const named = [...new Set([...parsed.filter(isLanguageName), ...languageWordsIn(claim.text)])];
    return [{ names: named.length > 0 ? named : parsed, working: line.preTicked, text: claim.text.trim() }];
  });
}

/** #425 (owner decision 1) — the languages that count as the person's: every language declared or
 *  placed on the ladder, and every language the CV lists (any line not rejected) unless they
 *  answered "I don't speak this one" for it. An explicit answer beats the CV, both ways. */
export function spokenLanguages(facts: readonly EligibilityFact[], claims: readonly LanguageClaim[]): string[] {
  const saidNo = new Set(
    facts.filter((f) => f.dimension === "language" && f.value === LANGUAGE_NOT_AT_ALL).map((f) => languageKey(f.familyId)),
  );
  const fromCv = cvLines(claims)
    .flatMap((l) => l.names)
    .filter((name) => !saidNo.has(languageKey(name)));
  return [...declaredLanguages(facts), ...fromCv];
}

/** #425 (owner decision 2) — the CV's languages written with a working level word (cvLanguages.ts's
 *  own list: native, fluent, professional, bilingual). Each one meets a job's language requirement:
 *  the ladder does not ask it, and the card counts it met. A lesser word or none settles nothing. */
function cvWorkingLanguages(claims: readonly LanguageClaim[]): string[] {
  return cvLines(claims)
    .filter((l) => l.working)
    .flatMap((l) => l.names);
}

/** The first language group `subject` names whose level is still unknown — neither placed on the
 *  ladder (a rung, "I don't speak this one" included) nor settled by a working level word on the CV —
 *  or null when every one is settled. The ladder asks it (languageLevelAsk); the application report
 *  lists the requirement as unchecked (applicationReport.ts). One rule, so the question and the
 *  report can never disagree about a language. */
export function unsettledLanguage(
  subject: string,
  facts: readonly EligibilityFact[],
  claims: readonly LanguageClaim[],
): string[] | null {
  const working = cvWorkingLanguages(claims);
  return (
    languagesNamed(subject).find(
      (group) => !languageFactsFor(group, facts).some((f) => levelOf(f.value) !== null) && !groupMet(group, working),
    ) ?? null
  );
}

/** The CV's own lines that meet every language `subject` names at a working level — the evidence the
 *  card prints — or null when one is not met. Null for a subject naming none: a rule over every group
 *  first checks there is one. */
export function cvLinesMeetingLanguages(subject: string, claims: readonly LanguageClaim[]): string[] | null {
  const groups = languagesNamed(subject);
  if (groups.length === 0) return null;
  const working = cvLines(claims).filter((l) => l.working);
  const lines: string[] = [];
  for (const group of groups) {
    const line = working.find((l) => groupMet(group, l.names));
    if (!line) return null;
    if (!lines.includes(line.text)) lines.push(line.text);
  }
  return lines;
}

const norm = (s: string): string => s.trim().toLowerCase();

// The ask is keyed by the advert requirement that raised it (#308: the tailor queue round-trips
// requirementId), but the ANSWER stays keyed by (session, language) in the eligibility store —
// "already answered" is read back from that stored rung, never from a question record.
export interface LanguageLevelAsk {
  /** #308 — the advert requirement this ask answers for. The queue posts it back untouched. (#415:
   *  the graded ask is the only question a language ever raises — no Yes/No twin exists.) */
  requirementId: string;
  /** The language, in the STORE's canonical casing when this session already declared it, else the
   *  advert's own word. Never a normalised token — this string is shown to a person. */
  language: string;
  question: string;
  /** Why THIS advert cares, said aloud (#125 decision 4 / ADR-0011 clause 1). Built from the advert's
   *  own requirement line, so the person can check the claim against the posting they are looking at
   *  rather than taking our word for it. */
  why: string;
  /** What answering costs, said BEFORE the rungs — see LANGUAGE_LEVEL_CONSEQUENCE. */
  consequence: string;
  options: ReadonlyArray<{ value: LanguageLevel; situation: string }>;
  /** A skip is "not now", never "stop asking" — ADR-0011 clause 4 forbids a permanent mute until the
   *  profile surface that undoes one exists. A later advert testing the same language asks again. */
  skipOption: string;
}

export const LANGUAGE_LEVEL_SKIP = "Not now";

/** The advert's own words for why it wants this language, at the rung it named when it named one.
 *  `requirement` is the reader's human-readable line, already drawn from the posting. */
function whyThisAdvertCares(req: AdRequirementV1, language: string): string {
  const rung = req.eligibilityLevel ? LANGUAGE_LADDER.find((r) => r.value === req.eligibilityLevel) : undefined;
  const bar = rung ? ` It wants someone who can do this: ${rung.situation.replace(/^I /, "")}.` : "";
  return `This job asks about ${language}: "${req.requirement}".${bar}`;
}

/**
 * The ladder question this advert triggers, or null when it triggers none.
 *
 * Fires for a language requirement of EITHER kind — blocking or ordinary. The ticket is explicit
 * ("including when the advert names the language only as a plus") and it is the honest reading: a
 * language named as an advantage is exactly where a real level wins a job, and asking only on
 * blocking requirements would tie the question to the withdrawal machinery it is meant to replace.
 *
 * Fires only when the level is genuinely UNKNOWN (levelOf above). An answered language never asks
 * again, on this advert or any other — #125's "asked once per language ever", kept. #425 (owner
 * decision 2): neither does a language the CV lists with a working level word (`claims`, read by
 * cvLanguages) — "English (Fluent)" settles it. "Conversational", "Beginner" or no word still asks.
 *
 * Pure: `facts` and `claims` are whatever the caller already read. Returns the FIRST unknown
 * language in the advert's own rank order — one question per advert, never a stack of them.
 */
export function languageLevelAsk(
  adReq: AdRequirementsV1,
  facts: readonly EligibilityFact[],
  claims: readonly LanguageClaim[],
): LanguageLevelAsk | null {
  for (const req of adReq.requirements) {
    if (req.eligibilityDimension !== "language" || !req.eligibilitySubject) continue;
    const unknown = unsettledLanguage(req.eligibilitySubject, facts, claims);
    if (!unknown) continue;
    const language = languageFactsFor(unknown, facts)[0]?.familyId ?? unknown[0]!;
    return {
      requirementId: req.id,
      language,
      question: `How comfortable are you working in ${language}?`,
      why: whyThisAdvertCares(req, language),
      consequence: LANGUAGE_LEVEL_CONSEQUENCE,
      options: ASK_ORDER,
      skipOption: LANGUAGE_LEVEL_SKIP,
    };
  }
  return null;
}

/** #308 — the queue's answer strings are the rungs' SITUATIONS (the words the person tapped), and
 *  this is the one reverse lookup back to the stored value. Null for anything that is not exactly a
 *  rung's situation — the caller treats that as an unrecognized answer, never a guess. */
export function rungForSituation(situation: string): LanguageLevel | null {
  return LANGUAGE_LADDER.find((r) => r.situation === situation.trim())?.value ?? null;
}

export type LanguageLevelAnswerResult =
  | { ok: true }
  | { ok: false; status: number; code: string; message: string };

/**
 * The ladder's write path. One rung, at that language's own scope, in the SAME eligibility store the
 * declaring question writes to — a level is not a new kind of fact, it is the level slot of a fact
 * that already exists (ADR-0003's level is a shared part).
 *
 * A rung stored here closes this language's question permanently, including "not-at-all", which is
 * the only answer that may ever withdraw a posting. That asymmetry is deliberate and is the whole
 * safety property of #165: withdrawal now requires a person to deliberately tap "I don't speak this
 * one", and no amount of skipping, ignoring, or leaving-alone can produce it.
 *
 * The level never reaches the claims store — #106's must-fix 1 stands unchanged (a real eligibility
 * answer would render as an unconditional assertion or a confirmed gap, and both lie about the
 * visitor).
 *
 * #308: the ONLY door to this function is the Tailor queue's profile-answer route, which calls it
 * directly. The old POST /onboarding/language-level endpoint (the deck ladder's door) was deleted
 * with the ladder's retirement — owner's decision, 2026-09-29: nothing on any screen used it, and
 * a future profile surface that sets levels would rebuild its own door (with its own before/after
 * lines) over this same function.
 */
export async function answerLanguageLevel(
  eligibility: EligibilityStore,
  sessionId: string,
  language: string,
  level: string,
): Promise<LanguageLevelAnswerResult> {
  const rung = levelOf(level);
  const named = language.trim();
  if (!rung || named.length === 0)
    return { ok: false, status: 400, code: "invalid_answer", message: "unrecognized language level" };
  // Write at the scope the person's own declaration already uses when there is one, so a level and a
  // declaration can never end up as two rows for one language differing only in casing.
  const existing = (await eligibility.list(sessionId)).find(
    (f) => f.dimension === "language" && norm(f.familyId) === norm(named),
  );
  await eligibility.put(sessionId, {
    dimension: "language",
    familyId: existing?.familyId ?? named,
    value: rung,
    label: `${existing?.familyId ?? named} — ${LANGUAGE_LADDER.find((r) => r.value === rung)!.situation}`,
  });
  return { ok: true };
}

/** The longest real language name sits comfortably inside this; the cap exists because these words
 *  are untrusted input that becomes an eligibility-store SCOPE KEY, not because any honest answer is
 *  near it. Owned here rather than by the declaring question because both doors into a language fact
 *  — declaring a list, and placing a level — must agree on it. */
export const MAX_LANGUAGE_WORD = 60;
