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
// "Date of birth" gets a personal-data removal suggestion (#380), every other line is kept.
//
// #342 — drafted lines, the same way: a job placed in a family gets one line per must-have none of
// its lines shows (a line "shows" a must-have when it contains the must-have's id with its dashes as
// spaces — "end to end delivery"), each carrying a vague phrase in [brackets] with a CV option and a
// typical one (#343). A job with a must-have missing also gets one OPTIONAL line drawn from another
// job's line (R4: a fact under a different job, with its quote) and one INDUSTRY GUESS line. A job
// whose lines show every must-have gets nothing drafted. A job placed in `none` gets no drafts, as
// the prompt says.
//
// #383 — tools, the same way: a job line that opens with "Tools:" (or "Tech stack:",
// "Technologies:") is a tool list, its tools named as #382's split cuts them; a line saying
// "using <Name>" uses that tool.
//
// #382 — the skills the input lists under "### (no group)" in Skills are named QA_SKILL_GROUP.
import { splitSkillText } from "./skillsSplit.js";

/** cv-review.md's own opening line — what the stage-aware fake matches on. */
export const REVIEW_PROMPT_OPENING = "You review a candidate's CV, job by job";
/** The group name the fake gives the skills the CV left ungrouped. */
export const QA_SKILL_GROUP = "Software";
/** #393: the Skills group the fake names for a job's tools. */
export const QA_TOOLS_GROUP = "Tools";
/** cvReviewRun.ts NO_GROUP — the input's heading for those skills (kept literal: this file is the
 *  model's side of the prompt, and must not read the caller's code to answer it). */
const NO_GROUP_HEADING = "### (no group)";

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
  /** #382: the skills listed under the input's "(no group)" heading. */
  ungrouped: Line[];
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
  const ungrouped: Line[] = [];
  let job: string | null = null;
  let section = "letterhead";
  let noGroup = false;
  for (const raw of cv.split("\n")) {
    const heading = /^### .* \((j\d+)\)$/.exec(raw);
    if (heading) {
      job = heading[1]!;
      jobs.set(job, []);
      continue;
    }
    if (raw.startsWith("### ")) {
      noGroup = raw === NO_GROUP_HEADING;
      continue;
    }
    const sec = /^## (.+)$/.exec(raw);
    if (sec) {
      section = sec[1]!.toLowerCase();
      job = null;
      noGroup = false;
      continue;
    }
    const line = /^- \[([^\]]+)\] (.*)$/.exec(raw);
    if (!line) continue;
    const entry = { id: line[1]!, text: line[2]! };
    if (job) jobs.get(job)!.push(entry);
    else sections.set(section, [...(sections.get(section) ?? []), entry]);
    if (!job && noGroup) ungrouped.push(entry);
  }
  return { toReview, jobs, sections, families, placements, ungrouped };
}

const fixesOf = (lines: Line[]) =>
  lines.flatMap((l) =>
    l.text.includes("accross")
      ? [{ line: l.id, original: "accross", corrected: "across" }]
      : l.text.includes("Projcet")
        ? [{ line: l.id, original: l.text, corrected: l.text.replace("Projcet", "Project") }]
        : [],
  );
// #380: removal only for what belongs nowhere — a "Date of birth" line is personal data. A weak
// line ("intended to") is kept: a true but weak item is never suggested for removal.
// #383: a job's tool lists, and the tools its other lines use.
const TOOL_LIST = /^(?:tools|tech stack|technologies)\s*:/i;
const toolListsOf = (lines: Line[]) => lines.filter((l) => TOOL_LIST.test(l.text)).map((l) => ({ line: l.id, tools: splitSkillText(l.text).items }));
const toolsUsedOf = (lines: Line[]) =>
  lines.flatMap((l) => {
    const used = TOOL_LIST.test(l.text) ? null : /\busing ([A-Z][\w.+#-]*)/.exec(l.text);
    return used ? [{ line: l.id, tools: [used[1]!] }] : [];
  });
const judgementsOf = (lines: Line[]) =>
  lines.map((l) =>
    /date of birth/i.test(l.text)
      ? { line: l.id, verdict: "remove", kind: "personal-data", reason: "A date of birth hurts on any CV." }
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
  const { toReview, jobs, sections, families, placements, ungrouped } = parseReviewPrompt(prompt);
  const withSections = toReview.includes("sections");
  // #371: About you from the whole CV — each job's first line, achievements first, whether or not
  // the CV has a summary; a summary line about languages moves to Languages. `bogus` also moves a
  // job line and names a section the profile does not have — the two moves the guard drops.
  const summary = sections.get("professional summary") ?? [];
  const firstLines = [...jobs.values()].flatMap((ls) => ls.slice(0, 1).map((l) => l.text));
  const moves = summary.filter((l) => /\bfluent in\b/i.test(l.text)).map((l) => ({ line: l.id, to: "languages" }));
  if (opts.bogus) {
    const job = [...jobs.values()].flat()[0];
    if (job) moves.push({ line: job.id, to: "skills" });
    if (summary[0]) moves.push({ line: summary[0].id, to: "hobbies" });
  }
  // #382: the ungrouped skills get one name. `bogus` also names a skill the CV grouped and a job
  // line — the two names the guard drops.
  const skillGroups = ungrouped.length ? [{ name: QA_SKILL_GROUP, lines: ungrouped.map((l) => l.id) }] : [];
  if (opts.bogus) {
    const grouped = (sections.get("skills") ?? []).find((l) => !ungrouped.some((u) => u.id === l.id));
    const jobLine = [...jobs.values()].flat()[0];
    skillGroups.push({ name: "Ghost", lines: [grouped?.id, jobLine?.id].filter((id): id is string => !!id) });
  }
  return JSON.stringify({
    letterhead: withSections ? { checks: [] } : null,
    about: withSections ? { text: firstLines.join(" ") || "Delivered the work this CV describes." } : null,
    moves: withSections ? moves : null,
    skillGroups: withSections ? skillGroups : null,
    sections: withSections
      ? [...sections].map(([section, lines]) => ({ section, fixes: fixesOf(lines), judgements: judgementsOf(lines) }))
      : null,
    jobs: toReview
      .filter((id) => id !== "sections")
      .map((id) => {
        const lines = jobs.get(id) ?? [];
        const fixes = fixesOf(lines);
        const judgements = judgementsOf(lines);
        const toolLists = toolListsOf(lines);
        const toolsUsed = toolsUsedOf(lines);
        if (opts.bogus && lines[0]) {
          fixes.push({ line: lines[0].id, original: "nope", corrected: "never" });
          judgements.push({ line: "ghost", verdict: "remove", kind: "duplicate", reason: "A line that is not there." });
          toolLists.push({ line: "ghost", tools: ["Ghost"] });
          toolsUsed.push({ line: lines[0].id, tools: ["Kubernetes"] });
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
        // #393: the tools land in one group; a list's own label ("Tools: …") keeps its label anyway.
        const toolsGroup = toolLists.length || toolsUsed.length ? QA_TOOLS_GROUP : null;
        return { job: id, family: familyId, fixes, judgements, mustHaves, drafted, endDateMissing: false, conflicts: [], toolLists, toolsUsed, toolsGroup };
      }),
    refused: [],
  });
}
