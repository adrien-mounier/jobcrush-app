// #417 (ADR-0020 clause 3; ADR-0005 clauses 1-4 and 6) — the stretch suggestion step. ONE model call
// after the draft is written: handed the finished draft with each line's slot, the job's
// requirements with the card's verdicts, the person's facts and the denied list, it proposes at most
// one stretch per requirement the CV does not fully meet. What comes back is gated here, not trusted:
//   - the line out is read from the DRAFT at the slot the model named (clause 4 step 4: the swap shown
//     is the swap made), never from the answer;
//   - a suggestion whose explicit comparison says "not better" is dropped (clause 4 step 3);
//   - a suggestion stating a denied capability is dropped (tailoring-reasoning.md §8 clause 3), the
//     same word check conservationIssues() runs on the page;
//   - a met requirement, an unknown one, a second suggestion for the same one, or a slot the draft
//     does not print, is dropped.
// The result is stored BESIDE the draft (tailorDraftStore.ts), per person and job, never as a claim
// and never in the claim graph (ADR-0005 clause 2). The checkpoint key is the hash of the exact
// input, so a reload or a re-read never re-spends and a changed draft or verdict runs it again.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  STRETCH_CLASSES,
  STRETCH_PROPOSAL_SCHEMA_VERSION,
  StretchProposalV2,
  StretchSlot,
  type CandidateClaim,
  type CandidateClaims,
} from "@jobcrush/contracts";
import { completeWithCost } from "./adReader.js";
import type { TailorRequirement } from "./deck.js";
import type { JudgementRecord } from "./judgementStore.js";
import type { LlmClient } from "./llm.js";
import { phraseStated, textTokens } from "./matchtick.js";
import { extractJson } from "./miner.js";
import type { Draft, Posting, StretchMarks } from "./preview.js";
import type { DraftInputs } from "./tailorDraft.js";

const PROMPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "prompts");
/** One prompt file, read once and cached, its leading HTML comment (the file's own notes) dropped. */
const promptFile = (name: string) => {
  let cached: string | null = null;
  return (): string => (cached ??= readFileSync(join(PROMPTS_DIR, name), "utf8").replace(/^<!--[\s\S]*?-->\s*/, ""));
};
export const stretchPrompt = promptFile("stretch-suggestions.md");

/** The step's one call in either mode: one attempt plus one retry with the validation error
 *  appended (the report's shape); `read` parses and gates the answer. Cost is logged from the
 *  driver's own usage. Throws after a second bad answer — the caller stores nothing. */
async function completeChecked<T>(llm: LlmClient, input: string, mode: string, read: (doc: unknown) => T): Promise<T> {
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt =
      attempt === 0
        ? input
        : `${input}\n===RETRY===\nYour previous output failed validation:\n${lastError}\nOutput the corrected JSON object and nothing else.\n`;
    const { text, cost } = await completeWithCost(llm, prompt);
    console.log(
      `[ops] stretch ${mode} call: model ${cost.model}, ` +
        (cost.inputTokens === null ? "usage unmeasured" : `${cost.inputTokens} in / ${cost.outputTokens} out tokens`),
    );
    try {
      return read(extractJson(text));
    } catch (err) {
      lastError = err instanceof Error ? err.message.slice(0, 2000) : String(err);
    }
  }
  throw new Error(`stretch ${mode} failed validation twice: ${lastError.slice(0, 500)}`);
}

/** The prompt's own section heading — qa-main routes on this (a structural line, never the opening
 *  sentence: lessons.md "QA-stack fixture traps"). */
export const STRETCH_PROMPT_HEADING = "## Suggesting stretches beside a finished draft";

/** One requirement in the input — the fakes read states back off it, so the product owns the regex
 *  (CODING_STANDARDS "tests read product-owned ids and vocabulary"). */
export const STRETCH_REQUIREMENT_LINE = /^- id: (.+)\n  state: (\w+)/gm;

const oneLine = (text: string) => text.replace(/[\r\n]+/g, " ").trim();
const noBlockMarkers = (text: string) => text.replace(/^=+/gm, "");
/** The person's facts, one per line with the id and the job each belongs to — the suggestion step
 *  and its re-say mode (#420) read the same block. */
const factLinesOf = (claims: CandidateClaims) => claims.claims.map((c) => `- ${c.id} [${c.role}] ${oneLine(c.text)}`).join("\n");

/** The step's input: the job, the requirements with their verdicts, the draft line by line with
 *  each line's slot address, the facts, the denied list. Exported for the fingerprint and the tests. */
export function buildStretchInput(
  posting: Posting,
  requirements: TailorRequirement[],
  draft: Draft,
  claims: CandidateClaims,
  denied: string[],
): string {
  const requirementLines = requirements
    .map((r) => `- id: ${r.id}\n  state: ${r.state}\n  requirement: ${oneLine(r.text)}`)
    .join("\n");
  const draftLines = [
    ...(draft.summary.trim() ? [`summary: ${oneLine(draft.summary)}`] : []),
    ...draft.experience.flatMap((role, r) => [
      `role ${r}: ${oneLine(role.role)} — ${oneLine(role.employer)}`,
      ...role.bullets.map((b, i) => `- role ${r} bullet ${i}: ${oneLine(b.text)}`),
    ]),
    ...draft.skills.map((g, i) => `skills group ${i}: ${oneLine(g.label)}: ${g.items.map(oneLine).join("; ")}`),
  ].join("\n");
  const factLines = factLinesOf(claims);
  const block = (lines: string) => lines || "(none)";
  return (
    `${stretchPrompt()}title: ${oneLine(posting.title)}\nemployer: ${oneLine(posting.company)}\n` +
    `location: ${oneLine(posting.location)}\n\n${noBlockMarkers(posting.excerpt.trim())}\n\n` +
    `===REQUIREMENTS===\n${block(requirementLines)}\n\n` +
    `===DRAFT===\n${draftLines}\n\n` +
    `===FACTS===\n${block(factLines)}\n\n` +
    `===NEVER-SUGGEST===\n${block(denied.map((d) => `- ${oneLine(d)}`).join("\n"))}\n`
  );
}

export const stretchFingerprint = (input: string): string => createHash("sha256").update(input).digest("hex");

/** The step's input for one stored draft, from the same inputs the draft was written from (the
 *  facts and the denied list ride in DraftInputs). */
export function stretchInputFor(posting: Posting, requirements: TailorRequirement[], draft: Draft, inputs: DraftInputs): string {
  return buildStretchInput(posting, requirements, draft, inputs.claimsDoc, inputs.opts.negatives ?? []);
}

/** The checkpoint hit: the stored suggestions were made from exactly this input and the step
 *  finished. A failed step is never current — the next POST looks again. */
export function stretchIsCurrent(
  record: { draft: Draft; stretch?: StretchCheckpoint },
  posting: Posting,
  requirements: TailorRequirement[],
  inputs: DraftInputs,
): boolean {
  return (
    record.stretch?.status === "ran" &&
    record.stretch.fingerprint === stretchFingerprint(stretchInputFor(posting, requirements, record.draft, inputs))
  );
}

const Sentence = z.string().trim().min(1);
const SuggestionAnswer = z
  .object({
    suggestions: z.array(
      z
        .object({
          requirementId: z.string().min(1),
          slot: StretchSlot,
          lineIn: Sentence,
          why: Sentence,
          say: Sentence,
          intendedClass: z.enum(STRETCH_CLASSES),
          comparison: Sentence,
          better: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();
type SuggestionAnswer = z.infer<typeof SuggestionAnswer>["suggestions"][number];

// ---------------------------------------------------------------------------------------------
// #420 (ADR-0020 clause 3; ADR-0005 clause 6) — an edited wording. The person may change a pending
// suggestion's line in before answering. What to say if asked is then rewritten for the edited
// sentence by one small call of this step in its "re-say" mode (its own prompt and heading, the
// same client — metered under the stretch-suggestions stage), and the two are stored together ON
// the suggestion: the line printed is the line defended, and the old interview line is never kept
// next to an edited sentence. An empty line never gets here (the route refuses it; the screen keeps
// the wording and says so).
// ---------------------------------------------------------------------------------------------

const resayPrompt = promptFile("stretch-resay.md");

/** The re-say prompt's own section heading — qa-main and the tests route on it. */
export const RESAY_PROMPT_HEADING = "## Rewriting what to say for an edited line";
/** The edited line in the re-say input — the fakes read it back off this shape (last match). */
export const RESAY_LINE = /^===LINE===\n(.+)$/gm;
/** Paid rewrites one session may take, across every job and draft (CODING_STANDARDS: spend is
 *  bounded per session, not per request). Every edit that reaches the model counts once, a failed one
 *  too, so at most 2 × RESAY_LIMIT calls with the one retry each (sessions.ts countStretchRewrite). */
export const RESAY_LIMIT = 20;

export function buildResayInput(line: string, claims: CandidateClaims): string {
  return `${resayPrompt()}===LINE===\n${oneLine(line)}\n\n===FACTS===\n${factLinesOf(claims) || "(none)"}\n`;
}

const ResayAnswer = z.object({ say: Sentence }).strict();

/** The one re-say call (completeChecked). Throws after a second bad answer — the caller stores nothing. */
export const resayStretch = (llm: LlmClient, input: string): Promise<string> =>
  completeChecked(llm, input, "re-say", (doc) => ResayAnswer.parse(doc).say);

/** The pending suggestion an edit may change, or undefined (none such, or already answered — an
 *  answer is withdrawn with Undo first). */
export function editableSuggestion(checkpoint: StretchCheckpoint | undefined, id: string): StretchProposalV2 | undefined {
  return checkpoint?.status === "ran" ? checkpoint.suggestions.find((s) => s.id === id && s.state === "pending") : undefined;
}

/** The edited line and the interview line rewritten for it, stored together on one pending
 *  suggestion (pure). Null when the suggestion is not pending any more. The edit outlives an Undo:
 *  the answer goes back to pending, the wording stays. */
export function rewordSuggestion(
  checkpoint: StretchCheckpoint | undefined,
  id: string,
  claimText: string,
  interviewNarrative: string,
): StretchCheckpoint | null {
  if (checkpoint?.status !== "ran" || !editableSuggestion(checkpoint, id)) return null;
  return {
    ...checkpoint,
    suggestions: checkpoint.suggestions.map((s) => (s.id === id ? StretchProposalV2.parse({ ...s, claimText, interviewNarrative }) : s)),
  };
}

/** The draft line at a slot, or undefined when the draft prints no such line. A skill slot pushes
 *  nothing out (null) when the group exists. */
function lineOutAt(draft: Draft, slot: z.infer<typeof StretchSlot>): string | null | undefined {
  if (slot.kind === "bullet") return draft.experience[slot.role]?.bullets[slot.bullet]?.text;
  if (slot.kind === "summary") return draft.summary.trim() || undefined;
  return draft.skills[slot.group] ? null : undefined;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
export const stretchProposalId = (adId: string, requirementId: string): string =>
  `stretch-${slug(adId)}-${slug(requirementId)}`;

/**
 * The code-side gates on one answer (pure, directly tested): at most one per unmet requirement, a
 * printed slot, the comparison's verdict honoured, no denied words. Returns the stored records.
 */
export function gateSuggestions(
  answer: SuggestionAnswer[],
  draft: Draft,
  requirements: TailorRequirement[],
  denied: string[],
  adId: string,
  createdAt: string,
): StretchProposalV2[] {
  const unmet = new Set(requirements.filter((r) => r.state !== "met").map((r) => r.id));
  const taken = new Set<string>();
  const kept: StretchProposalV2[] = [];
  for (const s of answer) {
    if (!unmet.has(s.requirementId) || taken.has(s.requirementId)) continue;
    if (!s.better) continue; // ADR-0005 clause 4 step 3: the explicit comparison decides
    const lineOut = lineOutAt(draft, s.slot);
    if (lineOut === undefined) continue; // a slot the draft does not print
    // §8 clause 3: the line that would PRINT may not state a denied capability — the same word
    // check conservationIssues() runs on the finished page.
    const tokens = textTokens(s.lineIn);
    if (denied.some((phrase) => phraseStated(phrase, tokens))) continue;
    taken.add(s.requirementId);
    kept.push(
      StretchProposalV2.parse({
        schemaVersion: STRETCH_PROPOSAL_SCHEMA_VERSION,
        id: stretchProposalId(adId, s.requirementId),
        adId,
        requirementId: s.requirementId,
        why: s.why,
        claimText: s.lineIn,
        intendedClass: s.intendedClass,
        interviewNarrative: s.say,
        slot: s.slot,
        lineOut,
        derivedFrom: null,
        createdAt,
        state: "pending",
        decidedAt: null,
        scope: null,
      }),
    );
  }
  return kept;
}

/**
 * The one model call (completeChecked), the answer gated by zod and then by gateSuggestions. Throws
 * after a second bad answer — the caller records "failed", which the screen tells apart from "ran,
 * found none" (ADR-0005's negative test warning). The metered client's ledger row under
 * "stretch-suggestions" is the measured per-CV figure.
 */
export const suggestStretches = (
  llm: LlmClient,
  input: string,
  draft: Draft,
  requirements: TailorRequirement[],
  denied: string[],
  adId: string,
): Promise<StretchProposalV2[]> =>
  completeChecked(llm, input, "suggestions", (doc) =>
    gateSuggestions(SuggestionAnswer.parse(doc).suggestions, draft, requirements, denied, adId, new Date().toISOString()),
  );

/**
 * #417 (review): the step redone on a draft that stands keeps the person's word on every suggestion
 * that comes back — the same id (one per job and requirement) at the same slot, pushing out the same
 * line, so the swap he answered is the swap still on offer. That suggestion is kept as he left it:
 * its answer and scope, and any wording he edited with the interview line rewritten for it. Every
 * other one is the fresh run's, and an answer to a suggestion that did not come back is dropped.
 */
export function carryAnswers(fresh: StretchProposalV2[], previous: StretchCheckpoint | undefined): StretchProposalV2[] {
  if (previous?.status !== "ran") return fresh;
  const before = new Map(previous.suggestions.map((s) => [s.id, s]));
  return fresh.map((s) => {
    const was = before.get(s.id);
    return was && was.lineOut === s.lineOut && JSON.stringify(was.slot) === JSON.stringify(s.slot) ? was : s;
  });
}

/** The answers a suggestion takes (ADR-0020 clause 4). #417 built "no"; #418 adds "use" (this job
 *  only) and "undo" (back to pending — the Ready-to-send summary's per-answer Undo); #419 adds "true"
 *  (every job: the line joins the master CV — stretchFact.ts writes it). */
export const STRETCH_ANSWERS = ["no", "use", "undo", "true"] as const;
export type StretchAnswer = (typeof STRETCH_ANSWERS)[number];

/** One answer on one suggestion, pure. "no" declines it for THIS job only (ADR-0005 clause 9 as
 *  ADR-0020 amends it — another job's run may suggest the same line again, because the record is
 *  keyed by (person, job)); "use" approves it for this job only (clause 1: the line prints on this
 *  CV and nowhere else); "true" approves it for every job (#419: the person states it as their
 *  fact); "undo" puts it back to pending, as if never answered. Every answer may
 *  overwrite an earlier one — the record is the person's latest word. Returns null when no such
 *  suggestion exists beside this draft. */
export function answerSuggestion(
  checkpoint: StretchCheckpoint | undefined,
  id: string,
  answer: StretchAnswer,
  decidedAt: string,
): StretchCheckpoint | null {
  if (checkpoint?.status !== "ran") return null;
  const target = checkpoint.suggestions.find((s) => s.id === id);
  if (!target) return null;
  const decided = StretchProposalV2.parse(
    answer === "undo"
      ? { ...target, state: "pending", decidedAt: null, scope: null }
      : { ...target, state: answer === "no" ? "declined" : "approved", decidedAt, scope: answer === "true" ? "every-job" : "this-job" },
  );
  return { ...checkpoint, suggestions: checkpoint.suggestions.map((s) => (s.id === id ? decided : s)) };
}

/** The suggestions the person approved for this CV — whatever their scope (#419's every-job
 *  approval prints here the same way). Empty when the step did not run or ran dry. */
export function usedStretches(checkpoint: StretchCheckpoint | undefined): StretchProposalV2[] {
  return checkpoint?.status === "ran" ? checkpoint.suggestions.filter((s) => s.state === "approved") : [];
}

/**
 * #418 (ADR-0020 clause 4) — the score moves because the CV moved: every requirement the person met
 * by using a stretch reads fit 1 on THIS job's card, marked `stretched` so the fit row, the Tailor
 * screen's sheet and the report all say *met by a stretch*. Applied at READ TIME on top of the
 * record rules (recordBars.ts), never persisted — the cached judgement describes the facts; the
 * answer is a record beside this job's draft, so no other job's card can read it. A null judgement
 * (an estimated card) passes through untouched, exactly as the record rules do.
 * #419: a line the person said is true ("every-job") is their fact — the requirement reads fit 1
 * and plainly met, never *met by a stretch*.
 */
export function withStretchedVerdicts(judgement: JudgementRecord | null, checkpoint: StretchCheckpoint | undefined): JudgementRecord | null {
  const scopes = new Map(usedStretches(checkpoint).map((s) => [s.requirementId, s.scope]));
  if (!judgement || scopes.size === 0) return judgement;
  return {
    ...judgement,
    verdicts: judgement.verdicts.map((v) => {
      const scope = scopes.get(v.requirementId);
      if (!scope) return v;
      return scope === "every-job" ? { ...v, fit: 1 } : { ...v, fit: 1, stretched: true as const };
    }),
  };
}

/** #419: the id an "It's true" line is kept under on the master CV — a tailor id (tailor.ts
 *  isTailorClaimId), so the posting search never reads a fact added while tailoring as new search
 *  evidence, and the job being tailored stays found (postingRetrieval.ts). */
export const statedClaimId = (proposalId: string): string => `tailor-${proposalId}`;

/** #419: an "It's true" line as the fact it is — the person's own statement, the tap its warrant.
 *  stretchFact.ts writes it to the master CV under its job; this CV's line cites it. */
export function statedClaim(s: StretchProposalV2): CandidateClaim {
  const id = statedClaimId(s.id);
  return {
    id,
    semantic_key: id,
    field_key: null,
    field_value: null,
    field_label: null,
    role: "profile",
    text: s.claimText,
    machine_touch: "verbatim",
    classification: "Verified",
    source_quote: s.claimText.slice(0, 200),
    needs_grill: false,
    grill_hint: null,
  };
}

/** #419 (ADR-0020 clause 4): the facts the printed page cites — the draft's own, plus each line said
 *  to be true here, which prints citing its new claim (applyUsedStretches) — so the report and the
 *  lint read that line as the fact it is, never as a line chosen for this job. */
export function printedClaims(claims: CandidateClaims, checkpoint: StretchCheckpoint | undefined): CandidateClaims {
  const have = new Set(claims.claims.map((c) => c.id));
  const stated = usedStretches(checkpoint)
    .filter((s) => s.scope === "every-job")
    .map(statedClaim)
    .filter((c) => !have.has(c.id));
  return stated.length ? { ...claims, claims: [...claims.claims, ...stated] } : claims;
}

/**
 * #418 — the mechanical swap, applied at READ TIME to the stored draft (never persisted into it):
 * each used suggestion's line in replaces the draft line at its slot, word for word (ADR-0005
 * clause 4: the swap shown is the swap made; clause 6: written once, printed verbatim); a skill
 * joins its group and pushes nothing out. A line used for this job carries the proposal id where a
 * fact line carries claim ids — never a claim id, so nothing about it can be read back as a fact.
 * #419: a line said to be true IS a fact — it carries its new claim's id (statedClaimId).
 * Read-time because the stored draft is what the stretch step's checkpoint and the redraft are
 * keyed on: an answer must change what prints without changing what was drafted, or every Use
 * would re-run the step that made the suggestion. Undo is then simply the answer withdrawn.
 * ponytail: applied by slot address, so a draft shortened after approval (#314's one re-tailor)
 * prints the used line at the same address of the new draft; a slot-content check that re-finds
 * the line out is the upgrade if that ever shows on a real document.
 */
export function applyUsedStretches(draft: Draft, checkpoint: StretchCheckpoint | undefined): Draft {
  const used = usedStretches(checkpoint);
  if (used.length === 0) return draft;
  const next: Draft = structuredClone(draft);
  for (const s of used) {
    if (s.slot.kind === "summary") next.summary = s.claimText;
    else if (s.slot.kind === "skill") next.skills[s.slot.group]?.items.push(s.claimText);
    else {
      const role = next.experience[s.slot.role];
      if (role?.bullets[s.slot.bullet])
        role.bullets[s.slot.bullet] =
          s.scope === "every-job"
            ? { text: s.claimText, claimIds: [statedClaimId(s.id)], outcome: "" }
            : { text: s.claimText, claimIds: [], outcome: "", stretchId: s.id };
    }
  }
  return next;
}

/** What is stored beside the draft. `ran` with an empty list is "found none"; `failed` is the step
 *  that did not finish; an absent field is a step that never ran (ADR-0010: three different states). */
export type StretchCheckpoint =
  | { fingerprint: string; status: "ran"; suggestions: StretchProposalV2[] }
  | { fingerprint: string; status: "failed" };

/** The page marks for one read (#417): the pending suggestions numbered in list order (stable —
 *  an answered one keeps its number off the page but holds its place), the one named by `openId`
 *  previewed in place. No `openId` (the plain read, a closed card) marks nothing; an id that is
 *  not a pending suggestion numbers the pending ones and opens none. */
export function stretchMarks(checkpoint: StretchCheckpoint | undefined, openId: string | undefined): StretchMarks | undefined {
  if (checkpoint?.status !== "ran" || openId === undefined) return undefined;
  const pending = checkpoint.suggestions
    .map((s, i) => ({ s, n: i + 1 }))
    .filter(({ s }) => s.state === "pending");
  const open = pending.find(({ s }) => s.id === openId);
  return {
    ...(open ? { open: { slot: open.s.slot, lineIn: open.s.claimText, n: open.n } } : {}),
    numerals: pending.filter(({ s }) => s.id !== openId).map(({ s, n }) => ({ slot: s.slot, n })),
  };
}

/** What the screen reads: the suggestions with their answers, or the honest absence. */
export type StretchView = { status: "ran"; suggestions: StretchProposalV2[] } | { status: "failed" } | null;

export function stretchView(checkpoint: StretchCheckpoint | undefined): StretchView {
  if (!checkpoint) return null;
  return checkpoint.status === "ran" ? { status: "ran", suggestions: checkpoint.suggestions } : { status: "failed" };
}
