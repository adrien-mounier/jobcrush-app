// #341 — the QA stack's answer for the CV review prompt, shared by qa-main.ts's stage-aware fake and
// the HTTP tests' fake writer (test/cvReviewRun.test.ts), for the same reason qaFamilyAnswer.ts
// exists: one dialect, parsed by the real parser in a test, so a change to the prompt's shape breaks
// a test instead of going dark on the QA stack.
//
// It reads the prompt the way the model would — JOBS TO REVIEW, then each job's "- [id] text" lines
// under its "### … (jN)" heading, the non-job sections under their "## heading" — and derives every
// mark from the text it is handed, never from a canned id: a line containing "accross" gets a fix
// for that word alone (the model may name just the misspelt words), a line containing "Projcet"
// gets a whole-line fix (it may name the whole line), a line containing "intended to" gets an
// aim-without-result untick suggestion, every other line is kept.

/** cv-review.md's own opening line — what the stage-aware fake matches on. */
export const REVIEW_PROMPT_OPENING = "You review a candidate's CV, job by job";

interface Line {
  id: string;
  text: string;
}

export function parseReviewPrompt(prompt: string): { toReview: string[]; jobs: Map<string, Line[]>; sections: Map<string, Line[]> } {
  const toReview = (/=== JOBS TO REVIEW ===\n(.+)/.exec(prompt) ?? [, ""])[1]!.split(",").map((s) => s.trim()).filter(Boolean);
  const cv = prompt.slice(prompt.indexOf("=== THE CANDIDATE'S CV ==="));
  const jobs = new Map<string, Line[]>();
  const sections = new Map<string, Line[]>();
  let job: string | null = null;
  let section = "letterhead";
  for (const raw of cv.split("\n")) {
    const heading = /^### .* \((j\d+)\)$/.exec(raw);
    if (heading) {
      job = heading[1]!;
      jobs.set(job, []);
      continue;
    }
    const sec = /^## (.+)$/.exec(raw);
    if (sec) {
      section = sec[1]!.toLowerCase();
      job = null;
      continue;
    }
    const line = /^- \[([^\]]+)\] (.*)$/.exec(raw);
    if (!line) continue;
    const entry = { id: line[1]!, text: line[2]! };
    if (job) jobs.get(job)!.push(entry);
    else sections.set(section, [...(sections.get(section) ?? []), entry]);
  }
  return { toReview, jobs, sections };
}

const fixesOf = (lines: Line[]) =>
  lines.flatMap((l) =>
    l.text.includes("accross")
      ? [{ line: l.id, original: "accross", corrected: "across" }]
      : l.text.includes("Projcet")
        ? [{ line: l.id, original: l.text, corrected: l.text.replace("Projcet", "Project") }]
        : [],
  );
const judgementsOf = (lines: Line[]) =>
  lines.map((l) =>
    l.text.includes("intended to")
      ? { line: l.id, verdict: "untick", kind: "aim-without-result", reason: "States an aim and no delivered result." }
      : { line: l.id, verdict: "keep" },
  );

/** The answer, as JSON text, for exactly the jobs the prompt asks for (and the sections when it asks
 *  for them). `bogus` also names a line the model was never shown, so a test can watch the guard
 *  against that. */
export function qaReviewAnswer(prompt: string, opts: { bogus?: boolean } = {}): string {
  const { toReview, jobs, sections } = parseReviewPrompt(prompt);
  const withSections = toReview.includes("sections");
  return JSON.stringify({
    letterhead: withSections ? { checks: [] } : null,
    sections: withSections
      ? [...sections].map(([section, lines]) => ({ section, fixes: fixesOf(lines), judgements: judgementsOf(lines) }))
      : null,
    jobs: toReview
      .filter((id) => id !== "sections")
      .map((id) => {
        const lines = jobs.get(id) ?? [];
        const fixes = fixesOf(lines);
        const judgements = judgementsOf(lines);
        if (opts.bogus && lines[0]) {
          fixes.push({ line: lines[0].id, original: "nope", corrected: "never" });
          judgements.push({ line: "ghost", verdict: "untick", kind: "weak", reason: "A line that is not there." });
        }
        return { job: id, family: null, complete: false, fixes, judgements, mustHaves: [], drafted: [], endDateMissing: false, conflicts: [] };
      }),
    refused: [],
  });
}
