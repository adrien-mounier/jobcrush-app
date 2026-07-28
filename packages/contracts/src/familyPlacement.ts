import { z } from "zod";
import { SLUG } from "./claimGraph.js";

export const FamilyVersionReference = z
  .object({
    familyId: z.string().regex(SLUG),
    version: z.number().int().positive(),
  })
  .strict();

const ClarificationChoice = FamilyVersionReference.extend({
  label: z.string().min(1),
}).strict();

export const FamilyPlacement = z
  .discriminatedUnion("outcome", [
    z
      .object({
        schemaVersion: z.literal("1"),
        outcome: z.literal("confirmed"),
        family: FamilyVersionReference,
      })
      .strict(),
    z
      .object({
        schemaVersion: z.literal("1"),
        outcome: z.literal("needs_clarification"),
        choices: z.array(ClarificationChoice).min(2),
      })
      .strict(),
    z
      .object({
        schemaVersion: z.literal("1"),
        outcome: z.literal("unmapped"),
      })
      .strict(),
  ])
  .superRefine((placement, ctx) => {
    if (placement.outcome !== "needs_clarification") return;
    const refs = placement.choices.map(
      (choice) => `${choice.familyId}@${choice.version}`,
    );
    if (new Set(refs).size !== refs.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["choices"],
        message: "clarification choices must reference distinct family versions",
      });
    }
  });

export type FamilyVersionReference = z.infer<typeof FamilyVersionReference>;
export type FamilyPlacement = z.infer<typeof FamilyPlacement>;
