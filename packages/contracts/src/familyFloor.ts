// family_floor v0 — NEW schema (not frozen; drafted from onboarding-reward-design.md §6.2).
// The job family's ranked floor: E5's offline research output, a checklist not a discriminator
// tally (that's tailoring-reasoning.md §4). Array order IS rank order; the essential band alone
// is the discovery gate — not the whole list, and not a count.
import { z } from "zod";

export const RankBand = z.enum(["essential", "standard", "nice-to-have"]); // this IS the discovery gate
export const CvSection = z.enum(["summary", "experience", "skills", "education"]); // stand-in core-CV structure

export const FloorItem = z.object({
  id: z.string().min(1),
  rankBand: RankBand,
  question: z.string().min(1), // a lazy person answers in seconds
  options: z.array(z.string().min(1)), // tappable answers; MAY be empty (free-text item)
  cvSection: CvSection, // which CV section the answer writes into
  noIsFatal: z.boolean(), // whether a "no" is fatal or fine
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
