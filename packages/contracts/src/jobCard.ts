import { z } from "zod";
import { RequirementBand } from "./adRequirements.js";

const Count = z.number().int().nonnegative();
const BandBreakdown = z.object({ met: Count, total: Count }).superRefine((value, ctx) => {
  if (value.met > value.total) {
    ctx.addIssue({ code: "custom", message: "met must not exceed total" });
  }
});

export const JobCardV1 = z.object({
  schemaVersion: z.literal("1"),
  adId: z.string().min(1),
  title: z.string(),
  company: z.string(),
  place: z.string(),
  salary: z.string().nullable(),
  pattern: z.string().nullable(),
  matchPct: z.number().min(0).max(100),
  breakdown: z.object({ essential: BandBreakdown, desirable: BandBreakdown }),
  bubble: z.object({ hit: z.string(), open: z.string() }),
  fit: z.array(z.object({ id: z.string(), text: z.string() })),
  dontYet: z.array(
    z.object({ id: z.string(), band: RequirementBand, requirement: z.string() }),
  ),
  askedClosed: z.array(z.object({ id: z.string(), text: z.string() })),
  adExcerpt: z.string(),
});

export type JobCardV1 = z.infer<typeof JobCardV1>;
