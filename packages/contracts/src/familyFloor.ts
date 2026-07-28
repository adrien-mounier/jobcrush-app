// family_floor v0 — NEW schema (not frozen; drafted from onboarding-reward-design.md §6.2).
// The job family's ranked floor: E5's offline research output, a checklist not a discriminator
// tally (that's tailoring-reasoning.md §4). Array order IS rank order; the essential band alone
// is the discovery gate — not the whole list, and not a count.
import { z } from "zod";
import { SLUG } from "./claimGraph.js";

export const RankBand = z.enum(["essential", "standard", "nice-to-have"]); // this IS the discovery gate
export const CvSection = z.enum(["summary", "experience", "skills", "education"]); // stand-in core-CV structure

export const FloorItem = z.object({
  id: z.string().min(1),
  rankBand: RankBand,
  question: z.string().min(1), // a lazy person answers in seconds
  options: z.array(z.string().min(1)), // tappable answers; MAY be empty (free-text item)
  cvSection: CvSection, // which CV section the answer writes into
  noIsFatal: z.boolean(), // whether a "no" is fatal or fine
  // #18: the id of the item whose POSITIVE answer surfaces this one (e.g. "which job / roughly
  // when" only makes sense once its parent achievement is confirmed). Optional — most items are
  // always askable; a "no" on the trigger does NOT surface it (see discoveryState()).
  triggeredBy: z.string().min(1).optional(),
});

export const FamilyFloor = z.object({
  schemaVersion: z.literal("0"),
  family: z.string().min(1),
  items: z.array(FloorItem).min(1), // ranked; array order = rank order
});

export type RankBand = z.infer<typeof RankBand>;
export type CvSection = z.infer<typeof CvSection>;
export type FloorItem = z.infer<typeof FloorItem>;
export type FamilyFloor = z.infer<typeof FamilyFloor>;

const FamilyFloorV1Question = z
  .object({
    prompt: z.string().min(1),
    form: z.enum(["single_select", "multi_select", "free_text"]),
    options: z.array(
      z
        .object({
          value: z.string().min(1),
          label: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((question, ctx) => {
    const needsOptions = question.form !== "free_text";
    if (needsOptions === (question.options.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["options"],
        message: needsOptions
          ? "select questions require answer options"
          : "free-text questions must not define answer options",
      });
    }
  });

export const FamilyFloorV1 = z
  .object({
    schemaVersion: z.literal("1"),
    familyId: z.string().regex(SLUG),
    version: z.number().int().positive(),
    source: z.literal("test_fixture"),
    productionRewardEligible: z.literal(false),
    essentialItems: z
      .array(
        z
          .object({
            id: z.string().regex(SLUG),
            priority: z.number().int().positive(),
            question: FamilyFloorV1Question,
            evidenceDestination: z
              .object({
                document: z.literal("root_cv"),
                section: CvSection,
              })
              .strict(),
            negativeSemantics: z.literal("records_explicit_negative"),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((floor, ctx) => {
    const ids = floor.essentialItems.map((item) => item.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["essentialItems"],
        message: "essential item ids must be unique",
      });
    }

    const priorities = floor.essentialItems.map((item) => item.priority);
    if (
      new Set(priorities).size !== priorities.length ||
      priorities.some((priority, index) => priority !== index + 1)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["essentialItems"],
        message: "essential items must have unique contiguous priorities in rank order",
      });
    }
  });

export type FamilyFloorV1 = z.infer<typeof FamilyFloorV1>;
