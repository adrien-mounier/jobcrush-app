import { z } from "zod";
import { SLUG } from "./claimGraph.js";

/** #231 — v1 held one family and a third `needs_clarification` outcome. Both are gone: with nobody
 *  asked (ADR-0014 amendment 1 decision 1), "we cannot tell between A and B" and "it is genuinely
 *  both" produce the same arithmetic, so a placement simply carries every family that fits. Bumped
 *  rather than replaced in place because #221's placements are already stored on staging; the
 *  job-block store reads anything not on this version as NOT PLACED, so a stale row is simply
 *  placed again rather than crashing a screen that expects `families`. */
export const PLACEMENT_SCHEMA_VERSION = "2";

export const FamilyVersionReference = z
  .object({
    familyId: z.string().regex(SLUG),
    version: z.number().int().positive(),
  })
  .strict();

/** How sure the labeler is — an ORDINAL, never a float (ADR-0014 amendment 1 decision 5): a float
 *  invites false precision, is badly calibrated coming from a model, drifts with every prompt edit,
 *  and cannot be tested by the eval grid. It rides on the RANKING only: it attenuates a card's
 *  score so a job we are less sure about sinks in the deck, and never touches the years fact, which
 *  stays a whole honest number the product can print. */
export const PlacementConfidence = z.enum(["certain", "likely", "possible"]);

export const FamilyPlacement = z
  .discriminatedUnion("outcome", [
    z
      .object({
        schemaVersion: z.literal(PLACEMENT_SCHEMA_VERSION),
        outcome: z.literal("confirmed"),
        // No upper bound, deliberately (amendment 1 decision 3): the instruction to the labeler
        // holds the line at two and the eval grid measures it. A refused write would hide the
        // signal a hard cap exists to catch — if three families are named often, our families are
        // drawn too narrow, and that has to be visible rather than clamped away.
        families: z.array(FamilyVersionReference).min(1),
        confidence: PlacementConfidence,
      })
      .strict(),
    z
      .object({
        schemaVersion: z.literal(PLACEMENT_SCHEMA_VERSION),
        outcome: z.literal("unmapped"),
      })
      .strict(),
  ])
  .superRefine((placement, ctx) => {
    if (placement.outcome !== "confirmed") return;
    const refs = placement.families.map((family) => `${family.familyId}@${family.version}`);
    if (new Set(refs).size !== refs.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["families"],
        message: "a placement must reference distinct family versions",
      });
    }
  });

export type FamilyVersionReference = z.infer<typeof FamilyVersionReference>;
export type PlacementConfidence = z.infer<typeof PlacementConfidence>;
export type FamilyPlacement = z.infer<typeof FamilyPlacement>;
