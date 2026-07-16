// role_cluster v0 — NEW schema (not frozen; drafted from onboarding-init-design.md §8-2).
// The generalized shape of CLAUDE.md §7's decision rules: additive signals tallied per cluster.
import { z } from "zod";
import { SLUG } from "./claimGraph.js";

export const ClusterSignal = z.object({
  signal: z.string().min(1),
  weight: z.number().int().min(1).default(1),
  evidenceCount: z.number().int().min(0).default(0), // postings seen mentioning it (0 = LLM-drafted)
  vetoed: z.boolean().default(false), // user veto — survives re-grounding
});

export const RoleCluster = z.object({
  schemaVersion: z.literal("0"),
  id: z.string().regex(SLUG),
  version: z.number().int().min(1),
  targetTitles: z.array(z.string().min(1)).min(1),
  grounding: z.enum(["ungrounded", "grounded"]),
  groundedFrom: z.number().int().min(0), // postings mined; 0 while ungrounded
  clusters: z
    .array(
      z.object({
        name: z.string().min(1),
        signals: z.array(ClusterSignal).min(1),
      }),
    )
    .min(1),
  sharedBaselineIgnores: z.array(z.string()),
  confirmedAt: z.string().nullable(), // user confirmed the cluster card
});

export type RoleCluster = z.infer<typeof RoleCluster>;
