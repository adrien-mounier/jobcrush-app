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
  type CandidateClaims,
} from "@jobcrush/contracts";
import { completeWithCost } from "./adReader.js";
import type { TailorRequirement } from "./deck.js";
import type { LlmClient } from "./llm.js";
import { phraseStated, textTokens } from "./matchtick.js";
import { extractJson } from "./miner.js";
import type { Draft, Posting, StretchMarks } from "./preview.js";
import type { DraftInputs } from "./tailorDraft.js";

const PROMPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "prompts", "stretch-suggestions.md");
let cachedPrompt: string | null = null;
export function stretchPrompt(): string {
  if (!cachedPrompt) cachedPrompt = readFileSync(PROMPT_PATH, "utf8").replace(/^<!--[\s\S]*?-->\s*/, "");
  return cachedPrompt;
}

/** The prompt's own section heading — qa-main routes on this (a structural line, never the opening
 *  sentence: lessons.md "QA-stack fixture traps"). */
export const STRETCH_PROMPT_HEADING = "## Suggesting stretches beside a finished draft";

/** One requirement in the input — the fakes read states back off it, so the product owns the regex
 *  (CODING_STANDARDS "tests read product-owned ids and vocabulary"). */
export const STRETCH_REQUIREMENT_LINE = /^- id: (.+)\n  state: (\w+)/gm;

const oneLine = (text: string) => text.replace(/[\r\n]+/g, " ").trim();
const noBlockMarkers = (text: string) => text.replace(/^=+/gm, "");

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
  const factLines = claims.claims.map((c) => `- ${c.id} [${c.role}] ${oneLine(c.text)}`).join("\n");
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
 * The one model call: one attempt plus one retry with the validation error appended (the report's
 * shape), the answer gated by zod and then by gateSuggestions. Throws after a second bad answer — the
 * caller records "failed", which the screen tells apart from "ran, found none" (ADR-0005's negative
 * test warning). Cost is logged from the driver's own usage; the metered client's ledger row under
 * "stretch-suggestions" is the measured per-CV figure.
 */
export async function suggestStretches(
  llm: LlmClient,
  input: string,
  draft: Draft,
  requirements: TailorRequirement[],
  denied: string[],
  adId: string,
): Promise<StretchProposalV2[]> {
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt =
      attempt === 0
        ? input
        : `${input}\n===RETRY===\nYour previous output failed validation:\n${lastError}\nOutput the corrected JSON object and nothing else.\n`;
    const { text, cost } = await completeWithCost(llm, prompt);
    console.log(
      `[ops] stretch suggestions call: model ${cost.model}, ` +
        (cost.inputTokens === null ? "usage unmeasured" : `${cost.inputTokens} in / ${cost.outputTokens} out tokens`),
    );
    try {
      const doc = SuggestionAnswer.parse(extractJson(text));
      return gateSuggestions(doc.suggestions, draft, requirements, denied, adId, new Date().toISOString());
    } catch (err) {
      lastError = err instanceof Error ? err.message.slice(0, 2000) : String(err);
    }
  }
  throw new Error(`stretch suggestions failed validation twice: ${lastError.slice(0, 500)}`);
}

/** The answers a suggestion takes (ADR-0020 clause 4). #417 built "no"; #418 adds "use" (this job
 *  only) and "undo" (back to pending — the Ready-to-send summary's per-answer Undo); "true" (#419,
 *  every job) joins here. */
export const STRETCH_ANSWERS = ["no", "use", "undo"] as const;
export type StretchAnswer = (typeof STRETCH_ANSWERS)[number];

/** One answer on one suggestion, pure. "no" declines it for THIS job only (ADR-0005 clause 9 as
 *  ADR-0020 amends it — another job's run may suggest the same line again, because the record is
 *  keyed by (person, job)); "use" approves it for this job only (clause 1: the line prints on this
 *  CV and nowhere else); "undo" puts it back to pending, as if never answered. Every answer may
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
      : { ...target, state: answer === "no" ? "declined" : "approved", decidedAt, scope: "this-job" },
  );
  return { ...checkpoint, suggestions: checkpoint.suggestions.map((s) => (s.id === id ? decided : s)) };
}

/** The suggestions the person approved for this CV — whatever their scope (#419's every-job
 *  approval prints here the same way). Empty when the step did not run or ran dry. */
export function usedStretches(checkpoint: StretchCheckpoint | undefined): StretchProposalV2[] {
  return checkpoint?.status === "ran" ? checkpoint.suggestions.filter((s) => s.state === "approved") : [];
}

/**
 * #418 — the mechanical swap, applied at READ TIME to the stored draft (never persisted into it):
 * each used suggestion's line in replaces the draft line at its slot, word for word (ADR-0005
 * clause 4: the swap shown is the swap made; clause 6: written once, printed verbatim); a skill
 * joins its group and pushes nothing out. A used bullet carries the proposal id where a fact line
 * carries claim ids — never a claim id, so nothing about it can be read back as a fact.
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
      if (role?.bullets[s.slot.bullet]) role.bullets[s.slot.bullet] = { text: s.claimText, claimIds: [], outcome: "", stretchId: s.id };
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
