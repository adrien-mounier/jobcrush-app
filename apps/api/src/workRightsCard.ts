// #376 — "Where you can work" (ADR-0018 clauses 5 and 7): the plain card on check mode's last
// screen, one row per target market, and the gate that holds the jobs until every row is answered.
// The start stopped asking (clause 8), so this is now where work rights are asked.
//
// Nothing new is stored: a row's answer is the eligibility store's own work-rights fact, keyed by the
// market exactly as the answer route keys it (workRightsQuestionFor — the one composition), and an
// answer is written through answerEligibilityItem. The card's display words are the screen's; the
// stored vocabulary stays `eligible` / `needs-sponsorship`.
//
// What the CV implies is proposed, never stored (ADR-0013 clause 3): a line that names the person's
// citizenship of a market's country proposes "yes" there, with the line quoted. Nothing else is
// guessed — living somewhere is not a right to work there — so every other row starts open.
import type { EligibilityFact, EligibilityStore } from "./eligibility.js";
import { answerEligibilityItem, workRightsAnswerLabel, workRightsQuestionFor, type EligibilityAnswerResult } from "./eligibilityDiscovery.js";
import { resolvedMarketsFor, reviewOpensJobs } from "./postingRetrieval.js";
import type { SearchAreaEntry, SessionRecord } from "./sessions.js";

export type WorkRightsAnswer = "eligible" | "needs-sponsorship";
export const WORK_RIGHTS_ANSWERS: readonly [WorkRightsAnswer, WorkRightsAnswer] = ["eligible", "needs-sponsorship"];

export interface WorkRightsRow {
  /** The market's display name ("Australia" for a Sydney chip — visas are national). */
  market: string;
  /** What the card's answer door takes: the same id the answer route looks the market up by. */
  itemId: string;
  /** The person's stored answer; null until they tap one. */
  answer: WorkRightsAnswer | null;
  /** What the CV implies, shown pre-selected and never stored until tapped. */
  proposed: "eligible" | null;
  /** One sentence under the market saying why it is pre-filled; null when it is not. */
  note: string | null;
  /** The CV's own line the proposal rests on, quoted on the card. */
  source: string | null;
}

/** How a CV names a person from a market's country. A list that grows (golden rule): a market with
 *  no entry is never proposed — the card asks, it does not guess. */
const NATIONALS: Readonly<Record<string, readonly string[]>> = {
  Australia: ["Australian"],
  "Hong Kong": ["Hongkonger", "Hong Konger"],
  Singapore: ["Singaporean"],
  Vietnam: ["Vietnamese"],
};
const STATUS = String.raw`citizen(?:ship)?|nationality|national|passport(?: holder)?|permanent resident`;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The CV line saying the person is a citizen of the market's country, or null. Both orders count
 *  ("Nationality: Australian", "Australian citizen"), only inside one clause — "Vietnamese (native);
 *  nationality: French" says nothing about Vietnam. */
function citizenshipLine(market: string, lines: readonly string[]): string | null {
  const nationals = NATIONALS[market];
  if (!nationals) return null;
  const who = [market, ...nationals].map(escape).join("|");
  const re = new RegExp(String.raw`\b(?:${STATUS})\b[^.;,\n]*\b(?:${who})\b|\b(?:${who})\b[^.;,\n]*\b(?:${STATUS})\b`, "i");
  return lines.find((l) => re.test(l)) ?? null;
}

/** The card's rows: one per resolved target market, in chip order, each with the stored answer and
 *  what the CV implies. `lines` is the text of every line the person sees on the walk. */
export async function workRightsRows(
  eligibility: Pick<EligibilityStore, "get">,
  sessionId: string,
  searchAreas: readonly SearchAreaEntry[],
  lines: readonly string[],
): Promise<WorkRightsRow[]> {
  const rows: WorkRightsRow[] = [];
  for (const market of resolvedMarketsFor(searchAreas)) {
    const question = workRightsQuestionFor(market);
    const fact = await eligibility.get(sessionId, "work-rights", question.eligibility!.familyId);
    const source = citizenshipLine(market, lines);
    rows.push({
      market,
      itemId: question.itemId,
      answer: WORK_RIGHTS_ANSWERS.find((a) => a === fact?.value) ?? null,
      proposed: source ? "eligible" : null,
      note: source ? `You're ${NATIONALS[market]![0]}, so I put yes.` : null,
      source,
    });
  }
  return rows;
}

/** The markets with no work-rights answer among the facts already read — what holds the jobs
 *  (ADR-0018 clause 7). A proposal is not an answer: only the person's tap stores one. No market,
 *  nothing to hold. */
export function marketsWithoutWorkRights(
  facts: readonly Pick<EligibilityFact, "dimension" | "familyId" | "value">[],
  searchAreas: readonly SearchAreaEntry[],
): string[] {
  const answered = new Set(
    facts.filter((f) => f.dimension === "work-rights" && WORK_RIGHTS_ANSWERS.some((a) => a === f.value)).map((f) => f.familyId),
  );
  return resolvedMarketsFor(searchAreas).filter((m) => !answered.has(workRightsQuestionFor(m).eligibility!.familyId));
}

export async function unansweredMarkets(
  eligibility: Pick<EligibilityStore, "list">,
  sessionId: string,
  searchAreas: readonly SearchAreaEntry[],
): Promise<string[]> {
  return marketsWithoutWorkRights(await eligibility.list(sessionId), searchAreas);
}

/** ADR-0018 clause 7 — the jobs open when check mode is finished (reviewOpensJobs) AND every target
 *  market has a work-rights answer, read every time, not only at Finish: a market added afterwards
 *  (the profile's location door) or an answer taken back (its work-rights door) holds them again.
 *  The doors that open jobs ask this — the deck, discovery's hand-off, the paste door and the job's
 *  own screen — and so does preview.ts's sessionPostings, the pool every posting reader goes
 *  through: the deck's cards, the want door, the tailor screen (its answers too) and the tailored
 *  draft. A session that brought no CV is never held. */
export function jobsOpen(
  session: Pick<SessionRecord, "importProof" | "reviewCompletedAt" | "intent">,
  facts: readonly Pick<EligibilityFact, "dimension" | "familyId" | "value">[],
): boolean {
  if (!reviewOpensJobs(session)) return false;
  return session.importProof === null || marketsWithoutWorkRights(facts, session.intent.searchAreas).length === 0;
}

/** The person's tap on a row. Only this session's own markets answer here (404 otherwise), and the
 *  write is the answer route's own (answerEligibilityItem), so a card answer and a profile answer
 *  are the same fact. */
export async function answerWorkRights(
  eligibility: EligibilityStore,
  sessionId: string,
  searchAreas: readonly SearchAreaEntry[],
  itemId: string,
  answer: WorkRightsAnswer,
): Promise<EligibilityAnswerResult> {
  const markets = resolvedMarketsFor(searchAreas);
  if (!markets.some((m) => workRightsQuestionFor(m).itemId === itemId))
    return { ok: false, status: 404, code: "unknown_item", message: "no such market on this card" };
  return answerEligibilityItem({ eligibility }, sessionId, markets, itemId, { answer: workRightsAnswerLabel(answer)! });
}
