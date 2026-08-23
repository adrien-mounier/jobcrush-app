import { z } from "zod";
import { SLUG } from "./claimGraph.js";
import { PlacementConfidence } from "./familyPlacement.js";

/** #281 (spec #279, ADR-0014 decision 2 as amended) — the SEVENTH fact's contract: which industry
 *  a dated job was in. Deliberately the family placement's twin, at its own version: the two axes
 *  are placed by different labelers against different vocabularies, gated by different grids, and
 *  a version bump on one must never invalidate the other's stored answers.
 *
 *  Two outcomes, and there is no third. `needs_clarification` never existed here and never will —
 *  nobody is asked which industry their employer was in (a person cannot be expected to know
 *  whether their employer meets OUR definition, and an answer we cannot trust is worse than no
 *  answer). Correction is the only lever, and it is enough. */
/** v2 (#282): confidence moved from the PLACEMENT onto each industry. The two evidence sources
 *  answer different halves at different strengths — a web lookup can make the employer's own
 *  industry `certain` while the served industry, read off the person's own lines, is only
 *  `possible` — and one number for both would let the weaker ride on the stronger. That matters
 *  downstream, not just here: #285 attenuates a card's score by this confidence, so a shaky second
 *  industry carried at the first one's certainty would durably over-score. Version bumped rather
 *  than added beside, because a v1 reader would see the old field missing and a v2 reader would
 *  see a per-industry one absent — there is no shape that means the same thing in both. */
export const INDUSTRY_PLACEMENT_SCHEMA_VERSION = "2";

export const IndustryVersionReference = z
  .object({
    industryId: z.string().regex(SLUG),
    version: z.number().int().positive(),
    /** How sure the labeler is about THIS industry, not about the job. See the version note above. */
    confidence: PlacementConfidence,
  })
  .strict();

export const IndustryPlacement = z
  .discriminatedUnion("outcome", [
    z
      .object({
        schemaVersion: z.literal(INDUSTRY_PLACEMENT_SCHEMA_VERSION),
        outcome: z.literal("confirmed"),
        // TWO is the ordinary plural case, not an edge case: the employer's own industry, and the
        // industry the work was served into. A consultant at a consultancy who spent six years on
        // bank projects is honestly both, and the years count in full toward each.
        //
        // No upper bound, for the same reason the family placement has none (ADR-0014 amendment 1
        // decision 3): the instruction to the labeler holds the line at two and the grid measures
        // it. A refused write would hide the signal a cap exists to catch — if three industries are
        // named often, our industries are drawn too narrow, and that has to be visible.
        industries: z.array(IndustryVersionReference).min(1),
      })
      .strict(),
    z
      .object({
        schemaVersion: z.literal(INDUSTRY_PLACEMENT_SCHEMA_VERSION),
        outcome: z.literal("unmapped"),
      })
      .strict(),
  ])
  .superRefine((placement, ctx) => {
    if (placement.outcome !== "confirmed") return;
    // Keyed on id@version alone, NOT on the confidence — a job named as banking twice is two of
    // the same thing whether or not the labeler was equally sure both times.
    const refs = placement.industries.map((industry) => `${industry.industryId}@${industry.version}`);
    if (new Set(refs).size !== refs.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["industries"],
        message: "a placement must reference distinct industry versions",
      });
    }
  });

export type IndustryVersionReference = z.infer<typeof IndustryVersionReference>;
export type IndustryPlacement = z.infer<typeof IndustryPlacement>;
