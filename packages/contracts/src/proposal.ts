// Contract 3 — enrichment proposal / inbox. Zod port of oracle/validate_proposal.mjs (frozen seam).
// In v0.1 hosted this same shape carries onboarding *candidate claims* awaiting the confirm deck.
import { z } from "zod";
import { SLUG } from "./claimGraph.js";

export const STRETCH_CLASSES = ["Partially-Supported", "Unsupported-but-Plausible"] as const;
export const PROPOSAL_SOURCES = ["tailor_gap", "enricher_scan"] as const;
export const PROPOSAL_STATES = ["pending", "approved", "declined"] as const;

export const Proposal = z
  .object({
    id: z.string().regex(SLUG),
    claimText: z.string().min(1),
    intendedClass: z.enum(STRETCH_CLASSES),
    interviewNarrative: z.string().min(1),
    source: z.enum(PROPOSAL_SOURCES),
    originOffer: z.string().nullable(),
    tags: z.array(z.string().min(1)).min(1),
    state: z.enum(PROPOSAL_STATES),
    createdAt: z.string().min(1),
    decidedAt: z.string().nullable(),
    targetContextFile: z.string().nullable(),
    narrativeAnchor: z.string().regex(SLUG),
  })
  .superRefine((p, ctx) => {
    // (7) decided proposals record decidedAt
    if ((p.state === "approved" || p.state === "declined") && !p.decidedAt)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `state "${p.state}" requires a non-null decidedAt`,
      });
  });

export const Inbox = z
  .object({
    schemaVersion: z.string().min(1),
    proposals: z.array(Proposal),
  })
  .superRefine((inbox, ctx) => {
    const seen = new Set<string>();
    for (const p of inbox.proposals) {
      if (seen.has(p.id))
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate proposal id "${p.id}"` });
      seen.add(p.id);
    }
  });

export type Proposal = z.infer<typeof Proposal>;
export type Inbox = z.infer<typeof Inbox>;

// ---------------------------------------------------------------------------------------------
// #417 (ADR-0020 clause 3) — the stretch proposal v2, versioned BESIDE Contract 3 above (which stays
// frozen as the ported shape). Zod port of oracle/validate_stretch_proposal_v2.mjs. One suggestion
// beside one job's finished draft, stored with that draft and never in the claim graph (ADR-0005
// clause 2). ADR-0005's four changes, plus the line out:
//   - no graph reference at all (no narrativeAnchor, no tags, no targetContextFile);
//   - `adId` is required — a stretch belongs to its job (clause 7);
//   - a decline carries its scope, "this-job" only until the mute list exists (clause 9 as
//     ADR-0020 amends it); an approval says this job or every job (ADR-0020 clause 4);
//   - `derivedFrom` names the proposal this one came from (clause 8: an edited wording is a new
//     record pointing back).
// The slot addresses the draft line the suggestion would take (preview.ts's Draft): a bullet under a
// role, the summary line, or a skills group. A bullet or summary slot pushes `lineOut` out, in full
// (clause 4 step 4); a skill slot pushes nothing out.
// ---------------------------------------------------------------------------------------------

export const STRETCH_PROPOSAL_SCHEMA_VERSION = "2";
export const STRETCH_SCOPES = ["this-job", "every-job"] as const;

export const StretchSlot = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bullet"), role: z.number().int().nonnegative(), bullet: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal("summary") }).strict(),
  z.object({ kind: z.literal("skill"), group: z.number().int().nonnegative() }).strict(),
]);

export const StretchProposalV2 = z
  .object({
    schemaVersion: z.literal(STRETCH_PROPOSAL_SCHEMA_VERSION),
    id: z.string().regex(SLUG),
    adId: z.string().min(1),
    requirementId: z.string().min(1),
    /** Why it fired — what the job asks, what the CV shows (ADR-0005 clause 3). */
    why: z.string().min(1),
    /** The line in, written once and printed verbatim if used (ADR-0005 clause 6). */
    claimText: z.string().min(1),
    intendedClass: z.enum(STRETCH_CLASSES),
    /** What to say if asked — the interview line that defends that exact sentence. */
    interviewNarrative: z.string().min(1),
    slot: StretchSlot,
    lineOut: z.string().min(1).nullable(),
    derivedFrom: z.string().regex(SLUG).nullable(),
    createdAt: z.string().min(1),
    state: z.enum(PROPOSAL_STATES),
    decidedAt: z.string().min(1).nullable(),
    scope: z.enum(STRETCH_SCOPES).nullable(),
  })
  .strict()
  .superRefine((p, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (p.slot.kind === "skill") {
      if (p.lineOut !== null) issue("a skill slot pushes nothing out (lineOut must be null)");
    } else if (p.lineOut === null) issue(`a ${p.slot.kind} slot pushes a line out, shown in full`);
    if (p.state === "pending") {
      if (p.decidedAt !== null) issue("a pending proposal has no decidedAt");
      if (p.scope !== null) issue("a pending proposal has no scope");
    } else {
      if (p.decidedAt === null) issue(`state "${p.state}" requires a non-null decidedAt`);
      if (p.scope === null || (p.state === "declined" && p.scope !== "this-job"))
        issue(`state "${p.state}" requires a scope${p.state === "declined" ? ' of "this-job"' : ""}`);
    }
  });

export type StretchSlot = z.infer<typeof StretchSlot>;
export type StretchProposalV2 = z.infer<typeof StretchProposalV2>;
