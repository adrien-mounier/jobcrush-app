// ad_requirements v0 — frozen as read (not deleted: #102 supersedes it with v1, a new version rather
// than a mutation in place). The per-ad ranked requirement list doing triple duty: scores the instant
// match tick, renders as the card's "where you don't fit yet", and chooses Tailor's next question.
// Array order IS rank order.
import { z } from "zod";
import { CvSection, RankBand } from "./familyFloor.js";

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
  curated: z.boolean().default(false), // old v0 payloads are unreviewed; fixtures decide explicitly
  requirements: z.array(AdRequirement).min(1), // ranked; array order = rank order
});

export type RequirementBand = z.infer<typeof RequirementBand>;
export type AdRequirement = z.infer<typeof AdRequirement>;
export type AdRequirements = z.infer<typeof AdRequirements>;

// ad_requirements v1 (#86 "the requirement contract" / #102) — the whole app (fixture loader, scorer,
// Tailor, card build) reads this shape now; v0 above stays only as the historical, unmutated version.
//
// #86 decision, owner-settled 2026-08-02: the band vocabulary that v0 called must/should/nice is
// accidental, not meaningful, and unifies across every contract that ranks a requirement. Rather than
// re-declare an equal-but-separate enum here, `band` reuses familyFloor.ts's RankBand directly — the
// same zod object, not just the same values — so AdRequirementV1.band, FloorItem.rankBand, and
// JobCardV1.dontYet[].band can never drift apart with nothing to catch it (AC4: no hand-written
// translation survives at a contract boundary). The one place a translation still exists — the card's
// two-bucket essential/desirable breakdown, a deliberate display rollup — is in matchtick.ts, commented
// there as the sanctioned exception.
export const AdRequirementKind = z.enum(["blocking", "ordinary"]);

// A bar five can be compared against ("8+ years" -> {op: ">=", value: 8}), not only a sentence —
// #86 decision 5. Optional: most requirements (a capability, a preference) carry no bar at all.
export const ComparableValue = z
  .object({
    op: z.enum([">=", "<=", "=="]),
    value: z.number(),
  })
  .strict();

// Mirrors apps/api/src/eligibility.ts's ELIGIBILITY_DIMENSIONS exactly — the contract lines up with
// the already-merged eligibility store's vocabulary rather than inventing a second list (ticket #102's
// own instruction). Duplicated, not imported: apps/api depends on this package, never the reverse.
export const EligibilityDimension = z.enum([
  "years-experience",
  "work-rights",
  "language",
  "certification",
  "degree",
]);

export const AdRequirementV1 = z
  .object({
    id: z.string().min(1),
    band: RankBand,
    // Advert-stated mandatoriness only — NOT whether this user is actually blocked (that also needs
    // an explicit "no", session-scoped data no shared per-ad contract can carry; wiring the two
    // together into an actual withdrawal is #107/slice 6). Defaults to "ordinary" so a vague advert
    // ("Mandarin an advantage") never forces a blocking/not-blocking guess — the safe reading is the
    // one you get for free by saying nothing.
    kind: AdRequirementKind.default("ordinary"),
    requirement: z.string().min(1), // human-readable; renders as "where you don't fit yet"
    cvSection: CvSection.optional(),
    comparable: ComparableValue.optional(),
    // Set only when this requirement is really an eligibility gate in disguise (a years bar, a
    // language, a licence) — profile-level, asked once, reused rather than asked per advert.
    eligibilityDimension: EligibilityDimension.optional(),
    // The advert's own words this requirement was drawn from, so it can be shown to be the advert's
    // and not the model's — the provenance pin. A literal excerpt (this codebase's existing
    // source_quote convention), not a character span: reliable for a model to produce, and directly
    // renderable without re-locating an offset into the source text.
    sourceSpan: z.string().min(1),
  })
  .strict();

export const AdRequirementsV1 = z
  .object({
    schemaVersion: z.literal("1"),
    adId: z.string().min(1),
    curated: z.boolean().default(false),
    // The language the requirements were PRODUCED in — never silently translated (#86 decision 13).
    language: z.string().min(1),
    // Posting family fit — which family this posting belongs to, with a confidence — carried
    // alongside the requirements because reading the whole advert already produces it (#86 decision
    // 1). Acting on a weak verdict is the feed's job, not this contract's.
    familyFit: z
      .object({
        family: z.string().min(1),
        confidence: z.number().min(0).max(1),
      })
      .strict(),
    // min(1): an unreadable or empty read cannot parse into a valid AdRequirementsV1 at all — the
    // fail-closed pin. No card can be built from a payload that doesn't validate.
    requirements: z.array(AdRequirementV1).min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = value.requirements.map((r) => r.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requirements"],
        message: "requirement ids must be unique within one ad",
      });
    }
  });

export type AdRequirementKind = z.infer<typeof AdRequirementKind>;
export type ComparableValue = z.infer<typeof ComparableValue>;
export type EligibilityDimension = z.infer<typeof EligibilityDimension>;
export type AdRequirementV1 = z.infer<typeof AdRequirementV1>;
export type AdRequirementsV1 = z.infer<typeof AdRequirementsV1>;
