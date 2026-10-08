// #341 — the QA stack's answer for the CV review prompt, shared by qa-main.ts's stage-aware fake and
// the HTTP tests' fake writer (test/cvReviewRun.test.ts), for the same reason qaFamilyAnswer.ts
// exists: one dialect, parsed by the real parser in a test, so a change to the prompt's shape breaks
// a test instead of going dark on the QA stack.
//
// It reads the prompt the way the model would — JOB FAMILIES, JOB PLACEMENTS, JOBS TO REVIEW, then
// each job's "- [id] text" lines under its "### … (jN)" heading, the non-job sections under their
// "## heading" — and derives every mark from the text it is handed, never from a canned id: a line
// containing "accross" gets a fix for that word alone (the model may name just the misspelt words),
// a line containing "Projcet" gets a whole-line fix (it may name the whole line), a line containing
// "intended to" gets an aim-without-result untick suggestion, every other line is kept.
//
// #342 — drafted lines, the same way: a job placed in a family gets one line per must-have none of
// its lines shows (a line "shows" a must-have when it contains the must-have's id with its dashes as
// spaces — "end to end delivery"), each carrying a vague phrase in [brackets] with a CV option and a
// typical one (#343). A job with a must-have missing also gets one OPTIONAL line drawn from another
// job's line (R4: a fact under a different job, with its quote) and one INDUSTRY GUESS line. A job
// whose lines show every must-have gets nothing drafted and reads `complete` when it has no mark
// either. A job placed in `none` gets no drafts, as the prompt says.

/** cv-review.md's own opening line — what the stage-aware fake matches on. */
export const REVIEW_PROMPT_OPENING = "You review a candidate's CV, job by job";

interface Line {
  id: string;
  text: string;
}
interface Family {
  id: string;
  mustHaves: string[];
}

export function parseReviewPrompt(prompt: string): {
  toReview: string[];
  jobs: Map<string, Line[]>;
  sections: Map<string, Line[]>;
  families: Map<string, Family>;
  /** prompt job id → the family ids it was placed in (none → empty). */
  placements: Map<string, string[]>;
} {
  const toReview = (/=== JOBS TO REVIEW ===\n(.+)/.exec(prompt) ?? [, ""])[1]!.split(",").map((s) => s.trim()).filter(Boolean);
  // The instructions name each block marker too; the blocks themselves come last.
  const block = (from: string, to: string) => prompt.slice(prompt.lastIndexOf(from), prompt.lastIndexOf(to));
  const families = new Map<string, Family>();
  let family: Family | null = null;
  for (const raw of block("=== JOB FAMILIES ===", "=== JOB PLACEMENTS ===").split("\n")) {
    const id = /^- id: (.+)$/.exec(raw);
    if (id) {
      family = { id: id[1]!.trim(), mustHaves: [] };
      families.set(family.id, family);
      continue;
    }
    const mustHave = /^ {2}- ([a-z0-9-]+): /.exec(raw);
    if (mustHave && family) family.mustHaves.push(mustHave[1]!);
  }
  const placements = new Map<string, string[]>();
  for (const raw of block("=== JOB PLACEMENTS ===", "=== JOBS TO REVIEW ===").split("\n")) {
    const placed = /^- (j\d+): .* → (.+)$/.exec(raw);
    if (placed) placements.set(placed[1]!, placed[2] === "none" ? [] : placed[2]!.split(",").map((s) => s.trim()));
  }
  const cv = prompt.slice(prompt.lastIndexOf("=== THE CANDIDATE'S CV ==="));
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
  return { toReview, jobs, sections, families, placements };
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

/** #342: a must-have is shown by a line that says it in so many words. */
const shows = (line: Line, mustHave: string) => line.text.toLowerCase().includes(mustHave.replace(/-/g, " "));
const VAGUE = "the business and technical groups";

interface Drafted {
  text: string;
  mustHave: string | null;
  quote: string | null;
  flags: string[];
  vague: Array<{ phrase: string; options: Array<{ text: string; from: string; quote?: string }> }>;
}

function draftedOf(lines: Line[], family: Family, others: Line[]) {
  const mustHaves = family.mustHaves.map((id) => ({ id, shownBy: lines.filter((l) => shows(l, id)).map((l) => l.id) }));
  const missing = mustHaves.filter((m) => m.shownBy.length === 0);
  const cvOption = lines[0] ? [{ text: "the vendor teams", from: "CV", quote: lines[0].text }] : [];
  const drafted: Drafted[] = missing.map((m) => ({
    text: `Owned ${m.id.replace(/-/g, " ")} for [${VAGUE}].`,
    mustHave: m.id,
    quote: null,
    flags: [],
    // Typical first on purpose: the CV-first order the screen shows is the resolver's (#343).
    // Bracketed, and with a phrase the line never says: the resolver strips the one, drops the other.
    vague: [
      { phrase: `[${VAGUE}]`, options: [{ text: "the steering committee", from: "TYPICAL" }, ...cvOption] },
      { phrase: "a phrase the line never says", options: [{ text: "anything", from: "TYPICAL" }] },
    ],
  }));
  if (missing.length && others[0]) {
    const other = others[0].text;
    drafted.push({ text: `Also ${other.charAt(0).toLowerCase()}${other.slice(1)}`, mustHave: null, quote: other, flags: ["OPTIONAL"], vague: [] });
  }
  if (missing.length && lines[0]) {
    drafted.push({ text: "Followed the employer's release calendar.", mustHave: null, quote: lines[0].text, flags: ["INDUSTRY GUESS"], vague: [] });
  }
  return { mustHaves, drafted };
}

/** The answer, as JSON text, for exactly the jobs the prompt asks for (and the sections when it asks
 *  for them). `bogus` also names a line the model was never shown, so a test can watch the guard
 *  against that; `badDrafts` also drafts a line with no source for every job (forbidden on a placed
 *  job, and any draft is forbidden on a job placed in none) and cites a must-have the family does not
 *  have on the last must-have line — the drafts the prompt forbids — so a test can watch the guards. */
export function qaReviewAnswer(prompt: string, opts: { bogus?: boolean; badDrafts?: boolean } = {}): string {
  const { toReview, jobs, sections, families, placements } = parseReviewPrompt(prompt);
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
        const familyId = (placements.get(id) ?? [])[0] ?? null;
        const family = familyId ? families.get(familyId) : undefined;
        const others = [...jobs].filter(([other]) => other !== id).flatMap(([, ls]) => ls);
        const { mustHaves, drafted } = family ? draftedOf(lines, family, others) : { mustHaves: [], drafted: [] };
        if (opts.badDrafts) {
          drafted.push({ text: "A line with no source at all.", mustHave: null, quote: null, flags: [], vague: [] });
          const last = [...drafted].reverse().find((d) => d.mustHave !== null);
          if (last) last.mustHave = "not-a-must-have";
        }
        const complete = !!family && drafted.length === 0 && fixes.length === 0 && judgements.every((j) => j.verdict === "keep");
        return { job: id, family: familyId, complete, fixes, judgements, mustHaves, drafted, endDateMissing: false, conflicts: [] };
      }),
    refused: [],
  });
}
