// candidate_claims v0 — NEW schema (drafted for JC-13; Contract-3-shaped per the dev plan).
// The claim miner's output: a raw CV read into candidate claims — one per printed bullet, compound
// bullets kept whole and split at writing time (#208) — each tagged with
// how much the machine touched it and pre-classified on the 5-level scale (only the top three
// levels may be emitted — the miner never invents; see the prompt).
import { z } from "zod";

export const MACHINE_TOUCH = ["verbatim", "reworded", "inferred"] as const;
export const MINEABLE_CLASSIFICATIONS = ["Verified", "Derived", "Partially-Supported"] as const;

export const MinedRole = z.object({
  employer: z.string().min(1),
  title: z.string().min(1),
  dates_as_written: z.string(),
  dates_missing: z.boolean(),
});

export const CandidateClaim = z
  .object({
      id: z
      .string()
        .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "claim id must be a kebab-case slug"),
      semantic_key: z
        .string()
        .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "semantic_key must be a kebab-case slug"),
      field_key: z
        .string()
        .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "field_key must be a kebab-case slug")
        .nullable(),
      field_value: z.string().trim().min(1).nullable(),
      field_label: z.string().trim().min(1).nullable(),
    role: z.string().min(1), // employer+title as written, or "profile"
    text: z.string().min(1),
    machine_touch: z.enum(MACHINE_TOUCH),
    classification: z.enum(MINEABLE_CLASSIFICATIONS),
    source_quote: z.string().min(1).max(200),
    needs_grill: z.boolean(),
    grill_hint: z.string().nullable(),
  })
  .superRefine((claim, ctx) => {
    // Invariant (JC-2): every inference must be grillable.
    if (claim.machine_touch === "inferred" && !claim.needs_grill) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `claim ${claim.id}: inferred claims must set needs_grill`,
      });
    }
    if (claim.needs_grill && !claim.grill_hint) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `claim ${claim.id}: needs_grill without a grill_hint`,
      });
    }
    const fieldParts = [claim.field_key, claim.field_value, claim.field_label];
    if (!fieldParts.every((value) => value === null) && !fieldParts.every((value) => value !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `claim ${claim.id}: field_key, field_value, and field_label must all be null or non-empty`,
      });
    }
  });

export const CandidateClaims = z.object({
  schemaVersion: z.literal("1"),
  roles: z.array(MinedRole),
  claims: z.array(CandidateClaim).min(1),
  parser_flags: z.array(z.string()),
});

export type MinedRole = z.infer<typeof MinedRole>;
export type CandidateClaim = z.infer<typeof CandidateClaim>;
export type CandidateClaims = z.infer<typeof CandidateClaims>;

/**
 * Deck-budget accounting (§8-4): `verbatim` claims batch-approve as one decision; everything
 * the machine touched (`reworded`/`inferred`) costs an individual confirm card. The JC-13 eval
 * asserts a typical CV stays ≤ 15 individual cards.
 */
export function individualCardCount(doc: Pick<CandidateClaims, "claims">): number {
  return doc.claims.filter((c) => c.machine_touch !== "verbatim").length;
}
