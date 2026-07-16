// onboarding_session v0 — NEW schema (not frozen; drafted from onboarding-init-design.md §2/§8).
// Tracks a user's (or anonymous visitor's) progress through the onboarding stages.
import { z } from "zod";

export const ONBOARDING_STAGES = [
  "intake", // target titles + eligibility
  "import", // door chosen, upload/paste in progress
  "parsing", // extraction + mining jobs running
  "preview", // watermarked draft shown; signup ask lives here
  "deck", // confirm deck + interleaved grill
  "review", // draft CV review + audit sign-off
  "ready", // quality gate passed; first hunt triggered
] as const;

export const OnboardingSession = z.object({
  schemaVersion: z.literal("0"),
  id: z.string().min(1),
  anonymous: z.boolean(),
  userId: z.string().nullable(), // set on anon->account merge (JC-19)
  stage: z.enum(ONBOARDING_STAGES),
  targetTitles: z.array(z.string()),
  importDoor: z.enum(["linkedin", "upload", "email", "scratch", "paste"]).nullable(),
  createdAt: z.string(),
  lastSeenAt: z.string(), // drives the 48h anonymous auto-purge (JC-20)
  completeness: z
    .object({ ready: z.boolean(), missing: z.array(z.string()) })
    .default({ ready: false, missing: [] }),
});

export type OnboardingSession = z.infer<typeof OnboardingSession>;
