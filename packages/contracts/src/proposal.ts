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
