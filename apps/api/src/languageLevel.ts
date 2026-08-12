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
// legacy value from the old shape reads as UNKNOWN here (levelOf below) — which never withdraws,
// and which is what makes the four already-answered languages get re-asked on the new ladder.
import { z } from "zod";
import type { AdRequirementV1, AdRequirementsV1, LanguageLevel } from "@jobcrush/contracts";
import type { EligibilityFact, EligibilityStore } from "./eligibility.js";

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

const norm = (s: string): string => s.trim().toLowerCase();

// An ask carries no itemId. The answer is keyed by (session, language) in the eligibility store, and
// "already answered" is read back from that stored rung — there is no question record to name, and a
// synthetic id nothing reads would just be one more thing to keep consistent.
export interface LanguageLevelAsk {
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
 * again, on this advert or any other — #125's "asked once per language ever", kept.
 *
 * Pure: `facts` is whatever the caller already read. Returns the FIRST unknown language in the
 * advert's own rank order — one question per advert, never a stack of them.
 */
export function languageLevelAsk(
  adReq: AdRequirementsV1,
  facts: readonly EligibilityFact[],
): LanguageLevelAsk | null {
  for (const req of adReq.requirements) {
    if (req.eligibilityDimension !== "language" || !req.eligibilitySubject) continue;
    const subject = req.eligibilitySubject.trim();
    const fact = facts.find((f) => f.dimension === "language" && norm(f.familyId) === norm(subject));
    if (levelOf(fact?.value) !== null) continue; // answered — closed for good
    const language = fact?.familyId ?? subject;
    return {
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

/** Attaches each card's own triggered ask, keyed by adId — the deck route's one-liner, kept here so
 *  the spine never learns the ladder's rules (routes/onboarding.ts is a ratchet). A card with nothing
 *  to ask is returned untouched, so the payload only grows where there is a real question.
 *
 *  The ladder is asked at the moment an advert makes it matter (ADR-0011 clause 1), never up front,
 *  and this step is free: it reads facts the deck already fetched against requirements the deck
 *  already resolved, with no IO and no model call of its own. */
export function withLanguageLevelAsks<T extends { adId: string }>(
  cards: T[],
  candidates: ReadonlyArray<{ posting: { id: string }; adReq: AdRequirementsV1 }>,
  facts: readonly EligibilityFact[],
): Array<T & { levelAsk?: LanguageLevelAsk }> {
  const byAdId = new Map(candidates.map((entry) => [entry.posting.id, entry.adReq]));
  return cards.map((card) => {
    const adReq = byAdId.get(card.adId);
    const levelAsk = adReq ? languageLevelAsk(adReq, facts) : null;
    return levelAsk ? { ...card, levelAsk } : card;
  });
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

/** The ladder route's body, beside the handler it feeds. Bounds `language` at the trust boundary. */
export const LanguageLevelBody = z.object({
  language: z.string().min(1).max(MAX_LANGUAGE_WORD),
  level: z.string().max(40),
});
