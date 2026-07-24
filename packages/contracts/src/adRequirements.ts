// ad_requirements v0 — NEW schema (not frozen; drafted from onboarding-reward-design.md §9).
// The per-ad ranked requirement list doing triple duty: scores the instant match tick, renders
// as the card's "where you don't fit yet", and chooses Tailor's next question. Array order IS
// rank order.
import { z } from "zod";
import { CvSection } from "./familyFloor.js";

export const RequirementBand = z.enum(["must", "should", "nice"]);

export const AdRequirement = z.object({
  id: z.string().min(1),
  band: RequirementBand,
  requirement: z.string().min(1), // human-readable; renders as "where you don't fit yet"
  cvSection: CvSection.optional(), // reuse the CvSection enum from familyFloor.ts
});

export const AdRequirements = z.object({
  schemaVersion: z.literal("0"),
  adId: z.string().min(1),
  requirements: z.array(AdRequirement).min(1), // ranked; array order = rank order
});

export type RequirementBand = z.infer<typeof RequirementBand>;
export type AdRequirement = z.infer<typeof AdRequirement>;
export type AdRequirements = z.infer<typeof AdRequirements>;
