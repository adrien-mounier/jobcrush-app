// Contract 1 — grounded-claim graph. Zod port of oracle/validate_graph.mjs (frozen seam).
// The golden test runs the .mjs oracle over the same fixtures; the two must always agree.
import { z } from "zod";

export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const CLASSES = [
  "Verified",
  "Derived",
  "Partially-Supported",
  "Unsupported-but-Plausible",
  "Negative",
] as const;
const PROVENANCE_REQUIRED = new Set(["Verified", "Derived", "Partially-Supported", "Negative"]);
export const RISKS = ["Low", "Med", "High"] as const;

export const ClaimNode = z
  .object({
    id: z.string().regex(SLUG, "id must be a kebab slug"),
    text: z.string().min(1),
    classification: z.enum(CLASSES),
    source_file: z.string().nullable(),
    source_quote: z.string().nullable(),
    inferred_from: z.array(z.string()).nullable(),
    tags: z.array(z.string().min(1)).min(1),
    risk: z.enum(RISKS).nullable(),
    renderable: z.boolean(),
    origin: z.enum(["source", "enrichment"]),
    narrative_ref: z.string().nullable(),
    confirmed_date: z.string().regex(ISO_DATE).nullable(),
  })
  .superRefine((n, ctx) => {
    const add = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    // (5) gaps can never render
    if (n.classification === "Negative" && n.renderable !== false)
      add("Negative node must have renderable=false");
    // (6) UbP: no provenance, carries risk + narrative
    if (n.classification === "Unsupported-but-Plausible") {
      if (n.source_file !== null) add("Unsupported-but-Plausible must have source_file=null");
      if (n.risk === null) add("Unsupported-but-Plausible must carry a risk");
      if (!n.narrative_ref) add("Unsupported-but-Plausible must have a narrative_ref");
    }
    // (7) provenance required for graded/negative classes
    if (PROVENANCE_REQUIRED.has(n.classification) && !n.source_file)
      add(`${n.classification} must have a non-empty source_file`);
    // (8)
    if (n.classification === "Partially-Supported" && n.risk === null)
      add("Partially-Supported must carry a risk");
    // (9) enrichment nodes carry their interview narrative
    if (n.origin === "enrichment" && !n.narrative_ref)
      add("origin=enrichment must have a narrative_ref");
  });

export const ClaimGraph = z
  .object({
    schemaVersion: z.string().min(1),
    graphVersion: z.number().int().min(1),
    built_from_root_cv: z.string().min(1),
    built_at: z.string().optional(),
    sources: z.array(z.string()).optional(),
    nodes: z.array(ClaimNode),
  })
  .superRefine((g, ctx) => {
    const seen = new Set<string>();
    for (const n of g.nodes) {
      if (seen.has(n.id))
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate node id "${n.id}"` });
      seen.add(n.id);
    }
  });

export type ClaimNode = z.infer<typeof ClaimNode>;
export type ClaimGraph = z.infer<typeof ClaimGraph>;
