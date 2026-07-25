// JC-27 — root-CV renderer. Turns the confirmed claim graph into the user's master CV, rendering
// ONLY from renderable nodes (the mechanical enforcement of "the root CV renders only confirmed
// facts", spec §8-3 / S2 decision 5). Groups nodes by the kind tag buildClaimGraph stamps, emits
// one bullet per node, and returns a claim trace (bullet → the node behind it) that the JC-31 gate
// verifies. This is the mechanical renderer; LLM polish + PDF reuse the S1 preview renderer later
// (audit — S2 decision 1/6).
import type { ClaimGraph, ClaimNode } from "@jobcrush/contracts";

// kind tag (set by buildClaimGraph) → CV section heading, in render order. A renderable node whose
// tag isn't listed falls into "Additional Information" so nothing confirmed is ever dropped.
// Exported: #20's profile route groups its (wider) claim set into the same section order/headings.
export const SECTIONS: ReadonlyArray<readonly [tag: string, heading: string]> = [
  ["profile", "Professional Summary"],
  ["experience", "Professional Experience"],
  ["skill", "Skills"],
  ["cert", "Certifications"],
  ["edu", "Education"],
  ["lang", "Languages"],
];
const OTHER = "Additional Information";

export interface TraceEntry {
  bullet: string;
  section: string;
  nodeIds: string[];
  classifications: string[];
}
export interface ClaimTrace {
  graphVersion: number;
  cvFile: string;
  entries: TraceEntry[];
  gaps: never[]; // the grill (E3) fills these; the mechanical renderer emits none.
}
export interface RootCv {
  markdown: string;
  trace: ClaimTrace;
}

const headingFor = (n: ClaimNode) => SECTIONS.find(([tag]) => tag === n.tags[0])?.[1] ?? OTHER;

/** Markdown from trace entries (already in render order). The audit reuses this after polishing. */
export function markdownFromEntries(entries: TraceEntry[]): string {
  const lines: string[] = ["# Root CV", ""];
  let current: string | null = null;
  for (const e of entries) {
    if (e.section !== current) {
      if (current !== null) lines.push("");
      lines.push(`## ${e.section}`, "");
      current = e.section;
    }
    lines.push(`- ${e.bullet}`);
  }
  if (entries.length) lines.push("");
  return lines.join("\n");
}

export function renderRootCv(graph: ClaimGraph, cvFile = "root-cv.md"): RootCv {
  const renderable = graph.nodes.filter((n) => n.renderable);

  // Bucket by heading, preserving node order within each section.
  const buckets = new Map<string, ClaimNode[]>();
  for (const n of renderable) {
    const h = headingFor(n);
    const arr = buckets.get(h) ?? [];
    arr.push(n);
    buckets.set(h, arr);
  }

  const order = [...SECTIONS.map(([, h]) => h), OTHER];
  const entries: TraceEntry[] = [];
  for (const heading of order) {
    for (const n of buckets.get(heading) ?? []) {
      entries.push({
        bullet: n.text,
        section: heading,
        nodeIds: [n.id],
        classifications: [n.classification],
      });
    }
  }

  return {
    markdown: markdownFromEntries(entries),
    trace: { graphVersion: graph.graphVersion, cvFile, entries, gaps: [] },
  };
}
