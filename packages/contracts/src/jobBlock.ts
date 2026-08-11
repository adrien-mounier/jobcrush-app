// jobBlock.ts — Contract for the job-record miner's output (#161). One dated block from a CV
// decomposes into FIVE atomic machine decisions — employer, title, start, end, kind — never one
// record per quoted line (owner decision, 2026-08-11). Each decision carries its own origin
// (ADR-0004 clause 1a: source_quote = the exact source words) so a person can see and correct any
// one of them independently, and its own machine_touch + classification (AI-judged, never derived
// in ordinary code — the owner explicitly refused string-distance derivation).
//
// needs_grill / grill_hint are deliberately ABSENT. Whether to ask a follow-up depends on the
// advert being applied to, which changes per application — freezing it here would be stale the
// moment the person applies a second time (ADR-0005, ADR-0007, owner decision 2026-08-11).
//
// "Is this work?" is never asked or stored as a yes/no. `kind` names what the block IS (job,
// education, project, client, volunteering); counting toward years-of-experience is DERIVED from
// the kind (countsTowardExperience below), per #157 Design A §2. A client line (ADR-0009) mines as
// kind "client" and therefore never becomes an employment entry.
import { z } from "zod";
import { MACHINE_TOUCH } from "./candidateClaims.js";

const JOB_BLOCK_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const CLASSIFICATIONS = ["Verified", "Derived", "Partially-Supported"] as const;
export const KINDS = ["job", "education", "project", "client", "volunteering"] as const;
export const DATE_PRECISIONS = ["year", "month"] as const;

export const MinedDate = z
  .object({
    year: z.number().int().min(1900).max(2100),
    // null unless precision is "month" — "2021 - 2023" must never invent a month.
    month: z.number().int().min(1).max(12).nullable(),
    precision: z.enum(DATE_PRECISIONS),
  })
  .superRefine((d, ctx) => {
    if (d.precision === "year" && d.month !== null)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "year precision must not carry a month" });
    if (d.precision === "month" && d.month === null)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "month precision requires a month" });
  });

const decisionShape = {
  source_quote: z.string().min(1).max(200),
  machine_touch: z.enum(MACHINE_TOUCH),
  classification: z.enum(CLASSIFICATIONS),
};

export const TextDecision = z.object({ value: z.string().min(1), ...decisionShape });
export const KindDecision = z.object({ value: z.enum(KINDS), ...decisionShape });
export const StartDecision = z.object({ value: MinedDate, ...decisionShape });

// Three end states, explicitly distinct: "ongoing" (still there), "ended" (a known/precise-as-known
// date), "unknown" (no end stated at all — never conflated with "ongoing").
export const MinedEndValue = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ongoing") }),
  z.object({ state: z.literal("ended"), date: MinedDate }),
  z.object({ state: z.literal("unknown") }),
]);

export const EndDecision = z
  .object({
    value: MinedEndValue,
    // null only for "unknown" — there is nothing in the CV to quote for a state that was never stated.
    source_quote: z.string().max(200).nullable(),
    machine_touch: z.enum(MACHINE_TOUCH),
    classification: z.enum(CLASSIFICATIONS),
  })
  .superRefine((d, ctx) => {
    if (d.value.state !== "unknown" && !d.source_quote)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a stated end must carry its source words" });
    if (d.value.state === "unknown" && d.source_quote !== null)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "an unknown end has nothing to quote" });
  });

export const MinedJobBlock = z.object({
  id: z.string().regex(JOB_BLOCK_SLUG, "id must be a kebab slug"),
  employer: TextDecision,
  title: TextDecision,
  start: StartDecision,
  end: EndDecision,
  kind: KindDecision,
});

export const MinedJobBlocks = z.object({
  schemaVersion: z.literal("1"),
  blocks: z.array(MinedJobBlock),
  parser_flags: z.array(z.string()),
});

export type MinedDate = z.infer<typeof MinedDate>;
export type MinedEndValue = z.infer<typeof MinedEndValue>;
export type TextDecision = z.infer<typeof TextDecision>;
export type KindDecision = z.infer<typeof KindDecision>;
export type StartDecision = z.infer<typeof StartDecision>;
export type EndDecision = z.infer<typeof EndDecision>;
export type MinedJobBlock = z.infer<typeof MinedJobBlock>;
export type MinedJobBlocks = z.infer<typeof MinedJobBlocks>;
export type Kind = (typeof KINDS)[number];

/** #157 Design A §2 — the ONLY place "does this count as work?" is decided. Never stored as an
 *  answer; always worked out from the kind, so a rebuild can never overwrite a person's answer. */
export function countsTowardExperience(kind: Kind): boolean {
  return kind === "job";
}
