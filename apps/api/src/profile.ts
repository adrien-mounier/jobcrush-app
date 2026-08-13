// #20 profile payload assembly, extracted from routes/onboarding.ts (the ratchet: route entries
// stay thin, logic lives beside its subsystem) — plus #179's search block, the data the profile
// rail's Job family section draws.
//
// Colour law (#20): a fact is gold iff its claim id appears in the rendered root CV's trace. That
// trace derives from the same confirmed renderable facts as /onboarding/build; grey otherwise
// means mined-but-not-yet-confirmed, i.e. still `pending` in the deck. Rejected/negative claims
// are stripped before this module is called (AC5): the profile never lists what the visitor
// lacks, while negatives still count in factCount.
import { buildClaimGraph, kindTag } from "./graph.js";
import { renderRootCv, SECTIONS } from "./rootcv.js";
import type { ClaimRecord } from "./claims.js";
import type { ContactRecord } from "./contact.js";
import type { EligibilityStore } from "./eligibility.js";
import { languagesQuestion, workRightsAnswerLabel, workRightsQuestionFor } from "./eligibilityDiscovery.js";
import { declaredLanguages } from "./languageLevel.js";
import { resolveSearchArea } from "./postingRetrieval.js";
import type { SearchAreaEntry } from "./sessions.js";

// The pinned frontend contract — apps/web/lib/api.ts mirrors these shapes.
export interface ProfileFact {
  id: string;
  text: string;
  colour: "gold" | "grey";
  source: "told" | "read";
  /** #185: the job line this fact belongs to (the claim's own `role` text) for an experience fact;
   *  null for every other fact — kindTag() already tells the two apart (a "profile"-role claim never
   *  tags "experience"), so this is a straight read, never a second lookup. */
  job: string | null;
  /** #193 code-review follow-up: marks a synthetic answer-only language chip (no CV claim behind
   *  it) — explicit and additive so the frontend never keys off the `lang-answer-` id prefix.
   *  Absent/undefined on every other fact, including CV-claim language chips. */
  answerOnly?: true;
}
// #185: the no-job facts group (tag "profile") heads the rail as "About you" and orders first — a
// PROFILE-SCREEN-ONLY heading. rootcv.ts's own SECTIONS ("Professional Summary") stays untouched;
// that heading still prints on the root CV itself.
const PROFILE_TAG = "profile";
const ABOUT_YOU_HEADING = "About you";
export interface ProfileDomain {
  tag: string;
  heading: string;
  facts: ProfileFact[];
}
/** #179: what the profile rail's Job family section draws. Until E5 (#86) places typed roles into
 *  families, `family` is null for EVERYONE — the rail shows the honest empty state (the role as
 *  typed + the "Not the job you meant?" door), never the resolveFamily() stub, which attributes
 *  the same family to every visitor. The stub keeps its internal jobs (floor selection,
 *  eligibility scoping); it must not reach a display again (#179 decision, 2026-08-09).
 *  When E5 lands, this is the seam that lights up: `family` from placement, `siblingTitles` from
 *  the family record (never containing `role` as typed), and `openJobs` from discovery.ts's
 *  promiseCount(family) — the same producer as the onboarding promise count, per #179's third
 *  falsifiable check. */
export interface ProfileSearch {
  role: string | null; // exactly as typed at Q1 (session.targetTitles[0]); null before Q1
  family: string | null;
  siblingTitles: string[];
  openJobs: number | null;
}
/** #190: one field of the profile's contact block — a value plus which kind of origin it has
 *  (ADR-0004 clause 1a), never the value alone, so the screen can render "you told us" vs "read
 *  from your CV" without a second lookup. */
export interface ProfileContactField {
  value: string;
  origin: "read" | "person-said";
}
export interface ProfileContact {
  phone: ProfileContactField | null;
  email: ProfileContactField | null;
}
/** #185: the rail's work-rights line — present only once a search area has resolved to a covered
 *  market (never a placeholder market). `answer` is null when THIS market has no stored answer yet
 *  — an honest "unanswered", never another market's answer (see resolveProfileLocation below).
 *  `questionId`/`question`/`options` (code-review contract extension) let the rail's door RE-OPEN
 *  the original question and its own option strings without ever composing the itemId client-side —
 *  that would duplicate the server's own slug rule (see workRightsQuestionFor). */
export interface ProfileWorkRights {
  market: string;
  answer: string | null;
  questionId: string;
  question: string;
  options: string[];
}
/** #214: the rail's Location data is now a LIST. `areas` are the selected target locations as
 *  chips — `label` is what the chip displays (the city when a city was typed, else the market),
 *  `text` the words as typed. `workRights` holds one row per UNIQUE covered market (Melbourne +
 *  Sydney chips → one Australia row), each with the #185 re-open contract. Both empty before any
 *  covered area is set. */
export interface ProfileLocation {
  areas: Array<{ text: string; market: string; label: string }>;
  workRights: ProfileWorkRights[];
}
/** #185 code-review contract extension: the SAME re-open contract as ProfileWorkRights, for the
 *  rail's languages door — `answer` reads ONLY the eligibility store (never a CV language claim), so
 *  a save can never silently flip a real eligibility answer. Always present (the languages question
 *  exists for every session, unlike work-rights which needs a resolved market first). */
export interface ProfileLanguagesQuestion {
  questionId: string;
  question: string;
  consequence: string | null;
  options: string[];
  answer: string[] | null;
}
export interface ProfileState {
  domains: ProfileDomain[];
  factCount: number;
  search: ProfileSearch;
  contact: ProfileContact;
  location: ProfileLocation;
  languagesQuestion: ProfileLanguagesQuestion;
}

export function profileSearch(role: string | null): ProfileSearch {
  return { role, family: null, siblingTitles: [], openJobs: null };
}

const toProfileContactField = (v: ContactRecord["phone"]): ProfileContactField | null =>
  v ? { value: v.value, origin: v.origin } : null;

export const EMPTY_PROFILE_CONTACT: ProfileContact = { phone: null, email: null };
export const EMPTY_PROFILE_LOCATION: ProfileLocation = { areas: [], workRights: [] };

/** #214: the rail's Location data, resolved fresh from the session's target locations + the
 *  eligibility store — never a second copy of either. Work-rights rows are per UNIQUE market; the
 *  question is composed ONCE per market by the same buildQuestion branch the answer route uses
 *  (#185's rule), so the store lookup keys on the exact marketKey the question was answered under. */
export async function resolveProfileLocation(
  eligibility: Pick<EligibilityStore, "get">,
  sessionId: string,
  searchAreas: readonly SearchAreaEntry[],
): Promise<ProfileLocation> {
  const areas: ProfileLocation["areas"] = [];
  const markets: string[] = [];
  for (const entry of searchAreas) {
    const resolution = resolveSearchArea(entry.text);
    if (!resolution.covered) continue; // never stored today; a legacy uncovered value just drops
    areas.push({ text: entry.text, market: resolution.market, label: resolution.label });
    if (!markets.includes(resolution.market)) markets.push(resolution.market);
  }
  const workRights: ProfileWorkRights[] = [];
  for (const market of markets) {
    const question = workRightsQuestionFor(market);
    const fact = await eligibility.get(sessionId, "work-rights", question.eligibility!.familyId);
    workRights.push({
      market,
      answer: fact ? workRightsAnswerLabel(fact.value) : null,
      questionId: question.itemId,
      question: question.question,
      options: question.options,
    });
  }
  return { areas, workRights };
}

const composeProfileLanguagesQuestion = (answer: string[] | null): ProfileLanguagesQuestion => {
  const composition = languagesQuestion();
  return {
    questionId: composition.itemId,
    question: composition.question,
    consequence: composition.consequence ?? null,
    options: composition.options,
    answer,
  };
};
export const UNANSWERED_LANGUAGES_QUESTION: ProfileLanguagesQuestion = composeProfileLanguagesQuestion(null);

/** #185 code-review contract extension: the profile rail's languages door needs the SAME composed-
 *  question contract work-rights got — a client that re-declares the question/options risks drifting
 *  from the real one, and pre-ticking from CV-mined claim text risks silently flipping a real
 *  eligibility "no" to "yes" on save. `answer` reads ONLY the eligibility store — a CV language claim
 *  never influences it (eligibility facts and claims-store facts are different kinds by design; see
 *  eligibility.ts's own header comment). Null means no language fact is stored at all — true before
 *  the question is ever answered AND after a decline (#123's decline retracts every stored language
 *  fact, so the store's own state is then identical to "never answered" — the same null-means-unknown
 *  semantic eligibility.ts's get()/remove() already document, not a new one; not genuinely ambiguous,
 *  since the store itself keeps no other record of a decline). The answer order matches `options`
 *  (languagesUnion() order), read straight off the composed question rather than a second import. */
export async function resolveLanguagesQuestion(
  eligibility: Pick<EligibilityStore, "list">,
  sessionId: string,
): Promise<ProfileLanguagesQuestion> {
  const stored = await eligibility.list(sessionId);
  const declared = declaredLanguages(stored);
  // #165: the answer is the person's DECLARED languages in their own words — no longer filtered
  // through the question's option list, because the list is now a set of completions rather than the
  // set of legal answers, and a volunteered language outside it ("French") must show on their own
  // profile. Empty reads as unanswered, the same null-means-unknown semantic as before.
  return declared.length === 0
    ? UNANSWERED_LANGUAGES_QUESTION
    : composeProfileLanguagesQuestion(declared);
}

/** Assembles GET /profile's payload: facts grouped by kind tag in SECTIONS order, coloured by the
 *  colour law above. `facts` excludes rejected/negative; `confirmed` is its confirmed subset
 *  (passed in rather than re-filtered so the route's one list() read serves both). */
export function buildProfileState(
  facts: ClaimRecord[],
  confirmed: ClaimRecord[],
  factCount: number,
  role: string | null,
  contact: ContactRecord = { phone: null, email: null },
  location: ProfileLocation = EMPTY_PROFILE_LOCATION,
  languages: ProfileLanguagesQuestion = UNANSWERED_LANGUAGES_QUESTION,
): ProfileState {
  const rootCv = renderRootCv(buildClaimGraph(confirmed));
  const goldIds = new Set(rootCv.trace.entries.flatMap((e) => e.nodeIds));

  const byTag = new Map<string, ProfileFact[]>();
  for (const c of facts) {
    const tag = kindTag(c);
    const bucket = byTag.get(tag) ?? [];
    bucket.push({
      id: c.id,
      text: c.text,
      colour: goldIds.has(c.id) ? "gold" : "grey",
      source: c.origin === "user-authored" ? "told" : "read",
      job: tag === "experience" ? c.role : null,
    });
    byTag.set(tag, bucket);
  }

  // #193: a stored languages answer with zero CV language claims still needs a door. Answer-only
  // languages compose into the SAME "lang" bucket the CV-claim path fills, so an existing claim
  // bucket is never touched (AC "do not change how CV-claim languages compose") and the section
  // draws in its normal SECTIONS slot. Kept-grey, never gold: an answer-only language never appears
  // in the root CV's render trace. Origin is "told" (the person said it), matching #185/#186's own
  // told/read split for the same reason a user-authored claim is "told".
  if (!byTag.has("lang") && languages.answer && languages.answer.length > 0) {
    byTag.set(
      "lang",
      languages.answer.map((lang) => ({
        id: `lang-answer-${lang}`,
        text: lang,
        colour: "grey" as const,
        source: "told" as const,
        job: null,
        answerOnly: true as const,
      })),
    );
  }

  const domains: ProfileDomain[] = SECTIONS.filter(([tag]) => byTag.has(tag)).map(([tag, heading]) => ({
    tag,
    heading: tag === PROFILE_TAG ? ABOUT_YOU_HEADING : heading,
    facts: byTag.get(tag)!,
  }));
  return {
    domains,
    factCount,
    search: profileSearch(role),
    contact: { phone: toProfileContactField(contact.phone), email: toProfileContactField(contact.email) },
    location,
    languagesQuestion: languages,
  };
}
