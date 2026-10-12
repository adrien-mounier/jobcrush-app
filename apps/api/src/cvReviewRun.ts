// #341 — the review run (ADR-0016 clauses 2, 3 and 7): the "review" AI step over the whole CV,
// one call per job, in parallel, checkpointed per job (cvReviewStore.ts). It starts from the
// pipeline the moment the CV is read and its jobs placed (pipeline.ts step 2), so it overlaps the
// questions discovery still asks and needs nothing from their answers. Its prompt is
// prompts/cv-review.md (#340), which answers JSON for exactly the jobs named in JOBS TO REVIEW —
// the letterhead and the non-job sections ride on the first job's call. A unit that fails is
// retried; a unit that runs out of attempts fails the run, and the screen then shows that job's
// lines as read and says nothing (the "never show the kitchen" rule). #362: a failed run is
// reopened by the next read and retried quietly, within the unit's paid-attempt bound; past it,
// the screen just never claims the job was checked. Finished units are never
// re-asked: generated once, stored (clause 7). A run the process left going when it restarted is
// resumed by the first read that finds it, for its unfinished units only.
//
// What #341 reads off the answer: the fixes, applied to the lines' own text (claims.ts setText)
// with the exact original kept for undo, and the untick suggestions, shown and never applied.
// #342 reads the drafted lines (clause 4): each becomes a claim stored under its job — pending,
// origin `drafted`, state `drafted` (claims.ts seedDrafted) — so it shows on the paper and prints
// nowhere until the person ticks it; its source and flags are kept on the checkpoint. #343 keeps
// each draft's vague phrases and their choices on the same checkpoint, so tapping a phrase never
// waits on the AI; the whole validated answer is stored beside them.
// #363: the run lives outside any HTTP request, and Fly's auto-stop (fly.api.toml) stops a machine
// it sees no load on — a request every few seconds is not load to it, a request held open is. So
// while a run is going the process keeps one request to its own public URL in flight, back to
// back (keepAliveOverHttp, /ops/keep-alive). And an attempt the process never saw finish — the
// machine stopped mid-call — is not a failure: the unit counts attempts started (the paid bound)
// and failures seen apart, and gives up on either.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as setTimeoutAsync } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { CandidateClaim } from "@jobcrush/contracts";
import { isUnaddedDraft, type ClaimRecord, type ClaimStore } from "./claims.js";
import type { ContactStore } from "./contact.js";
import { incrementCounter } from "./counters.js";
import { readPaper, running, type Paper, type ReviewJob, type ReviewLine } from "./cvReview.js";
import { slug } from "./discovery.js";
import { kindTag } from "./graph.js";
import { FALLBACK_GROUP, groupOf, splitSkillClaims, splitSkillText, type SkillClaim } from "./skillsSplit.js";
import { SECTIONS } from "./rootcv.js";
import { DRAFT_FLAGS, rerunUnit, SUGGESTION_KINDS, unitOf, type CvReviewStore, type DraftVague, type ResolvedDraft, type ResolvedFix, type ResolvedSuggestion, type ReviewUnit, type ReviewUnitResult, VAGUE_SOURCES } from "./cvReviewStore.js";
import type { ProductionFamilyFloorStore } from "./familyFloors.js";
import type { JobBlockStore } from "./jobBlockStore.js";
import type { LlmClient } from "./llm.js";
import type { SessionStore } from "./sessions.js";

const PROMPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "prompts", "cv-review.md");

let cachedPrompt: string | null = null;
/** The prompt as the model reads it: without the header comment, which is for humans reading the
 *  repo (preview.ts tailorPrompt and familyLabeler.ts strip it the same way). */
export function reviewPrompt(): string {
  if (!cachedPrompt) cachedPrompt = readFileSync(PROMPT_PATH, "utf8").replace(/^<!--[\s\S]*?-->\s*/, "");
  return cachedPrompt;
}

// ---------------------------------------------------------------------------------------------
// The answer, as the prompt's OUTPUT section states it. Non-strict objects on purpose (the
// labeler's rule): a stray key the model adds is dropped, never a reason to fail a read that was
// otherwise good. No `.default()` on any field the prompt says is required (CODING_STANDARDS).
// ---------------------------------------------------------------------------------------------
const Fix = z.object({ line: z.string(), original: z.string(), corrected: z.string() });
// #380: `remove` for an item that belongs nowhere. `untick` is the verdict the prompt gave before
// #380 — still parsed (a stored answer, #340's recordings), resolved to nothing.
const Judgement = z.discriminatedUnion("verdict", [
  z.object({ line: z.string(), verdict: z.literal("keep") }),
  z.object({ line: z.string(), verdict: z.literal("remove"), kind: z.enum(SUGGESTION_KINDS), reason: z.string() }),
  z.object({ line: z.string(), verdict: z.literal("untick"), kind: z.string(), reason: z.string() }),
]);
const VagueOption = z.object({ text: z.string(), from: z.enum(VAGUE_SOURCES), quote: z.string().nullish() });
const DraftedLine = z.object({
  text: z.string(),
  mustHave: z.string().nullable(),
  quote: z.string().nullable(),
  flags: z.array(z.enum(DRAFT_FLAGS)),
  vague: z.array(z.object({ phrase: z.string(), options: z.array(VagueOption) })),
});
// #386 retired the COMPLETE stamp: the prompt no longer asks for it, and a stored answer carrying
// `complete` reads like any other (a stray key is dropped).
const JobReview = z.object({
  job: z.string(),
  family: z.string().nullable(),
  fixes: z.array(Fix),
  judgements: z.array(Judgement),
  mustHaves: z.array(z.object({ id: z.string(), shownBy: z.array(z.string()) })),
  drafted: z.array(DraftedLine),
  endDateMissing: z.boolean(),
  conflicts: z.array(z.object({ what: z.string(), values: z.array(z.string()) })),
  // #383: nullish like `moves` — the answers recorded before #383 have neither. A tool list names
  // its tools (the guard in planTools checks them); a bare id is the answer before that, read and
  // never moved.
  toolLists: z.array(z.union([z.string(), z.object({ line: z.string(), tools: z.array(z.string()) })])).nullish(),
  toolsUsed: z.array(z.object({ line: z.string(), tools: z.array(z.string()) })).nullish(),
});
const SectionReview = z.object({ section: z.string(), fixes: z.array(Fix), judgements: z.array(Judgement) });
export const ReviewAnswer = z.object({
  letterhead: z.object({ checks: z.array(z.string()) }).nullable(),
  sections: z.array(SectionReview).nullable(),
  // #371: on the sections call only. Nullish, not required: the answers recorded before v2 of the
  // prompt (#340's scored runs) have neither, and a missing About you is no reason to pay for a
  // retry — the screen then shows the summary lines as read.
  about: z.object({ text: z.string() }).nullish(),
  moves: z.array(z.object({ line: z.string(), to: z.string() })).nullish(),
  // #382: on the sections call only — names for the skills the CV gave no group. Nullish: the
  // answers recorded before have none, and the fallback group stands.
  skillGroups: z.array(z.object({ name: z.string(), lines: z.array(z.string()) })).nullish(),
  jobs: z.array(JobReview),
  refused: z.array(z.object({ job: z.string(), what: z.string(), rule: z.string() })),
});
export type ReviewAnswer = z.infer<typeof ReviewAnswer>;

/** The model's text → the validated answer. A code fence around the JSON is tolerated (the
 *  blind-test renderer does the same); anything else that is not the one JSON object fails. */
export function parseReviewAnswer(text: string): ReviewAnswer {
  return ReviewAnswer.parse(JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "")));
}

// ---------------------------------------------------------------------------------------------
// The input: the four blocks the prompt names, built from the paper the screen shows.
// ---------------------------------------------------------------------------------------------
export interface ReviewFamily {
  familyId: string;
  label: string;
  scope: string;
  mustHaves: Array<{ id: string; meaning: string }>;
}

/** The job's own placement (ADR-0016 clause 4: each job is drafted from its OWN family, never the
 *  target role), at the version it was placed under (ADR-0014 decision 7), falling back to the
 *  active version when that one is no longer held. A family nothing can describe reads as `none`. */
function familiesOf(paper: Paper, floors: Pick<ProductionFamilyFloorStore, "get" | "active">) {
  const families = new Map<string, ReviewFamily>();
  const placements = new Map<string, string[]>();
  for (const { job, block } of paper.jobs) {
    const placement = block?.family.value;
    const ids: string[] = [];
    if (placement?.outcome === "confirmed") {
      for (const { familyId, version } of placement.families) {
        const publication = floors.get(familyId, version) ?? floors.active(familyId);
        if (!publication) continue;
        const floor = publication.floor;
        families.set(familyId, {
          familyId,
          label: floor.label,
          scope: floor.scope,
          mustHaves: floor.essentialItems.map((item) => ({ id: item.id, meaning: item.question.prompt })),
        });
        ids.push(familyId);
      }
    }
    placements.set(job.id, ids);
  }
  return { families: [...families.values()], placements };
}

/** The prompt names jobs by short ids (`j1`, `j2`, …) in paper order; a block id or a role heading
 *  would be an awkward id for the model to echo back. The map is rebuilt from the paper on each
 *  call and the answer is translated back to the paper's own ids before it is stored. */
const promptJobIds = (paper: Paper) => new Map(paper.jobs.map(({ job }, i) => [job.id, `j${i + 1}`]));

/** #382: the heading the input gives the skills the CV left ungrouped — the ones SKILL GROUPS names. */
export const NO_GROUP = "(no group)";

export function buildReviewInput(
  paper: Paper,
  floors: Pick<ProductionFamilyFloorStore, "get" | "active">,
  jobsToReview: string[],
): string {
  const { families, placements } = familiesOf(paper, floors);
  const ids = promptJobIds(paper);
  // A draft nobody added (unanswered or dismissed) is a suggestion, not the CV: shown to a later run
  // (#385, a unit retried after another's drafts landed) it would read as a must-have already shown.
  const cvLines = (lines: ReviewLine[]) => lines.filter((l) => !isUnaddedDraft(l.state));
  const line = (l: ReviewLine) => `- [${l.id}] ${l.text}`;
  const cv: string[] = [];
  const { name, title, location, phone, email } = paper.letterhead;
  if (name) cv.push(`# ${name.value}`);
  if (title) cv.push(title.value);
  const contact = [location?.value, phone?.value, email?.value].filter(Boolean).join(" · ");
  if (contact) cv.push(contact);
  for (const section of paper.sections) {
    if ("jobs" in section) {
      if (section.jobs.length === 0) continue;
      cv.push("", `## ${section.heading}`);
      for (const job of section.jobs) {
        const dates = job.dates ? `**${job.dates.start} – ${job.dates.end ?? "?"}**` : "**dates not read**";
        cv.push("", `### ${job.title}${job.employer ? ` — ${job.employer}` : ""} (${ids.get(job.id)})`, dates, "", ...cvLines(job.lines).map(line));
      }
      continue;
    }
    if (cvLines(section.lines).length === 0) continue;
    if (section.groups) {
      // #382: Skills by group, so the model sees which skills the CV left ungrouped (SKILL GROUPS).
      const own = new Map(cvLines(section.lines).map((l) => [l.id, l]));
      cv.push("", `## ${section.heading}`);
      for (const g of section.groups) {
        const ls = g.ids.flatMap((id) => own.get(id) ?? []);
        if (ls.length) cv.push("", `### ${g.name === FALLBACK_GROUP ? NO_GROUP : g.name}`, "", ...ls.map(line));
      }
      continue;
    }
    cv.push("", `## ${section.heading}`, "", ...cvLines(section.lines).map(line));
  }
  return [
    "=== JOB FAMILIES ===",
    ...(families.length
      ? families.map((f) =>
          [
            `- id: ${f.familyId}`,
            `  label: ${f.label}`,
            `  scope: ${f.scope}`,
            "  must-haves:",
            ...f.mustHaves.map((m) => `  - ${m.id}: ${m.meaning}`),
          ].join("\n"),
        )
      : ["(no job on this CV is placed in a published family)"]),
    "",
    "=== JOB PLACEMENTS ===",
    ...(paper.jobs.length
      ? paper.jobs.map(({ job }) => {
          const placed = placements.get(job.id) ?? [];
          return `- ${ids.get(job.id)}: ${job.title}${job.employer ? ` — ${job.employer}` : ""} → ${placed.length ? placed.join(", ") : "none"}`;
        })
      : ["(no jobs)"]),
    "",
    "=== JOBS TO REVIEW ===",
    jobsToReview.map((id) => (id === "sections" ? id : ids.get(id) ?? id)).join(", "),
    "",
    "=== THE CANDIDATE'S CV ===",
    ...cv,
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------------------------
// Resolving the answer against the paper: a fix or a judgement that names a line the paper does
// not have is dropped (and counted) — the model is never allowed to move a line it was not shown.
// ---------------------------------------------------------------------------------------------
const linesOf = (paper: Paper) =>
  new Map(
    paper.sections.flatMap((s) => ("jobs" in s ? s.jobs.flatMap((j) => j.lines) : s.lines)).map((l) => [l.id, l]),
  );

/** Each fix resolved to the whole line, before and after. The model may name the whole line or
 *  just the misspelt words as `original`; several fixes on one line compose into one. A fix whose
 *  `original` is not in the line, or that changes nothing, is dropped. */
export function resolveFixes(answer: ReviewAnswer, paper: Paper): ResolvedFix[] {
  const lines = linesOf(paper);
  const texts = new Map<string, string>();
  for (const fix of [...answer.jobs.flatMap((j) => j.fixes), ...(answer.sections ?? []).flatMap((s) => s.fixes)]) {
    const line = lines.get(fix.line);
    const current = line ? (texts.get(fix.line) ?? line.text) : undefined;
    if (!line || current === undefined || fix.original === fix.corrected || !current.includes(fix.original)) {
      incrementCounter("cvReview.fix_dropped");
      continue;
    }
    texts.set(fix.line, current.replace(fix.original, () => fix.corrected));
  }
  return [...texts].flatMap(([id, corrected]) => {
    const original = lines.get(id)!.text;
    return original === corrected ? [] : [{ line: id, original, corrected }];
  });
}

/** #342: the drafted lines of one job, as the claims to store and the marks to keep. Each is
 *  stored under the job's own role heading with a deterministic id — per unit, so a re-upload's run
 *  (#385, `<job>@rerun-<since>`) never lands on the first run's ids — so a retry after a crash
 *  between the seed and the checkpoint stores nothing twice (seedDrafted is idempotent). The claim's
 *  text drops the [square brackets] the prompt puts round a vague phrase (#343 reads the phrases
 *  off the stored answer): a line the person ticks prints exactly as it reads on the paper.
 *  Dropped, and counted: every draft for a job placed in no family, and a draft citing neither a
 *  must-have nor the CV's words — the prompt forbids both. The must-have is resolved to the
 *  family's own words; an id the family does not have reads as no must-have. */
export function resolveDrafts(
  answer: ReviewAnswer,
  paper: Paper,
  floors: Pick<ProductionFamilyFloorStore, "get" | "active">,
  unit: string,
): { family: string | null; claims: CandidateClaim[]; drafts: ResolvedDraft[] } {
  const { families, placements } = familiesOf(paper, floors);
  const jobId = unitOf(unit).job;
  const placed = families.filter((f) => (placements.get(jobId) ?? []).includes(f.familyId));
  const job = answer.jobs.find((j) => j.job === jobId);
  const role = paper.jobs.find((j) => j.job.id === jobId)?.role;
  const none = { family: null, claims: [], drafts: [] };
  if (!job || !role) return none;
  if (placed.length === 0) {
    for (const _ of job.drafted) incrementCounter("cvReview.draft_dropped");
    return none;
  }
  const meanings = new Map(placed.flatMap((f) => f.mustHaves.map((m) => [m.id, m.meaning] as const)));
  const unitSlug = slug(unit);
  const claims: CandidateClaim[] = [];
  const drafts: ResolvedDraft[] = [];
  for (const [i, d] of job.drafted.entries()) {
    const mustHave = d.mustHave === null ? null : (meanings.get(d.mustHave) ?? null);
    const quote = d.quote?.trim() || null;
    const text = d.text.replace(/\[([^\]]*)\]/g, "$1").trim();
    if ((mustHave === null && quote === null) || !text) {
      incrementCounter("cvReview.draft_dropped");
      continue;
    }
    const id = `draft-${unitSlug}-${i + 1}`;
    claims.push({
      id,
      semantic_key: id,
      field_key: null,
      field_value: null,
      field_label: null,
      role,
      text,
      machine_touch: "reworded",
      classification: quote ? "Derived" : "Partially-Supported",
      source_quote: (quote ?? mustHave!).slice(0, 200),
      needs_grill: false,
      grill_hint: null,
    });
    drafts.push({ line: id, mustHave, quote, flags: d.flags, vague: vagueOf(d, text) });
  }
  // ponytail: a job placed in several families is drafted from all their must-haves and labelled
  // by the first; give the card every label if a multi-family job ever shows up.
  return { family: placed[0]!.label, claims, drafts };
}

/** #343: a draft's vague phrases, as the screen offers them: only a phrase the line actually reads
 *  (brackets dropped, as on the paper), only options with words in them, the CV's options first. A
 *  phrase with no option left still gets the person's own words. */
function vagueOf(d: ReviewAnswer["jobs"][number]["drafted"][number], text: string): DraftVague[] {
  return d.vague.flatMap(({ phrase, options }) => {
    const p = phrase.replace(/^\[|\]$/g, "").trim();
    if (!p || !text.includes(p)) return [];
    const kept = options
      .map((o) => ({ text: o.text.trim(), from: o.from, quote: o.quote?.trim() || null }))
      .filter((o) => o.text && o.text !== p);
    return [{ phrase: p, options: [...kept.filter((o) => o.from === "CV"), ...kept.filter((o) => o.from === "TYPICAL")] }];
  });
}

// ---------------------------------------------------------------------------------------------
// #371 — About you and the summary's moves (ADR-0018 clauses 5 and 6).
// ---------------------------------------------------------------------------------------------
/** What a moved summary line wears ("Moved from your summary"). */
export const FROM_SUMMARY = "your summary";

/** The brain's banned summary shapes (cv-authoring-rules.md "Professional Summary", the tailor's
 *  rule 10), counted on About you as the model wrote it — the eval over the fake writer and over a
 *  real run alike — and, per sentence, what resolveAbout drops. One entry per shape found, in the
 *  order the text has them.
 *  ponytail: a phrase list and one regex; a reworded capability claim slips through — widen the
 *  list from what real runs actually write. */
const CAPABILITY_CLAIMS = ["proven ability to", "expertise in", "strong in", "comfortable bridging", "results-driven"];
export function aboutIssues(text: string): string[] {
  const issues: string[] = [];
  // The identity opener: a first sentence that counts the years ("… with 7+ years of experience").
  if (/^[^.!?]*\b\d+\+?\s*(?:years?|yrs)\b/i.test(text)) issues.push("identity opener");
  const lower = text.toLowerCase();
  issues.push(
    ...CAPABILITY_CLAIMS.filter((c) => lower.includes(c))
      .sort((a, b) => lower.indexOf(a) - lower.indexOf(b))
      .map((c) => `capability claim: ${c}`),
  );
  if (/\bI\b|\b(?:my|me)\b/i.test(text)) issues.push("first person");
  return issues;
}

/** The summary as the CV said it — "See what your CV said" — or null when the CV had none. */
const summaryOf = (paper: Paper): string | null => {
  const section = paper.sections.find((s) => s.tag === "profile");
  const lines = section && "lines" in section ? section.lines : [];
  return lines.length ? lines.map((l) => l.text).join("\n") : null;
};

/** About you as stored, beside the CV's own summary: the model's text without any sentence that
 *  carries an identity opener or a capability claim (#371 AC — dropped and counted; first person is
 *  only counted). Undefined when the answer has none, or no sentence is left — the screen then shows
 *  the CV's own summary to edit. A sentence ends at . ! or ? before a space and a capital, so a
 *  decimal ("EUR 1.2M") never splits one. */
export function resolveAbout(answer: ReviewAnswer, paper: Paper): { text: string; original: string | null } | undefined {
  const written = answer.about?.text.trim();
  if (!written) return undefined;
  for (const _ of aboutIssues(written)) incrementCounter("cvReview.about_issue");
  const kept = written.split(/(?<=[.!?])\s+(?=[A-Z])/).filter((sentence) => {
    const banned = aboutIssues(sentence).some((issue) => issue !== "first person");
    if (banned) incrementCounter("cvReview.about_sentence_dropped");
    return !banned;
  });
  const text = kept.join(" ").trim();
  return text ? { text, original: summaryOf(paper) } : undefined;
}

/** Each move resolved to a summary line and a section the profile has, by the section's own name
 *  (rootcv.ts SECTIONS — a section #373 adds is movable with no change here). A move naming a line
 *  outside the summary, or a section the profile does not have, is dropped and counted. */
export function resolveMoves(answer: ReviewAnswer, paper: Paper): Array<{ line: string; section: string }> {
  const summary = paper.sections.find((s) => s.tag === "profile");
  const ids = new Set(summary && "lines" in summary ? summary.lines.map((l) => l.id) : []);
  const tags = new Map(SECTIONS.filter(([tag]) => tag !== "profile" && tag !== "experience").map(([tag, heading]) => [heading.toLowerCase(), tag]));
  return (answer.moves ?? []).flatMap((m) => {
    const section = tags.get(m.to.trim().toLowerCase());
    if (!ids.has(m.line) || !section) {
      incrementCounter("cvReview.move_dropped");
      return [];
    }
    return [{ line: m.line, section }];
  });
}

// ---------------------------------------------------------------------------------------------
// #383 — a job's tools move to Skills (ADR-0018 clause 6). The job's own call names them; this
// turns its answer into new Skills items. No item's words change: a moved item is a piece of the
// tool list as #382's split cuts it, a copied one the tool's name exactly as the line writes it.
// ---------------------------------------------------------------------------------------------
export interface ToolPlan {
  /** Tool-list lines that leave their job — their items are in `add`. */
  leave: string[];
  /** New Skills items: moved out of a tool list, or copied (a tool an achievement names). */
  add: Array<{ claim: SkillClaim; copied: boolean }>;
}

/** Two spellings of one skill: case, spaces, dots, dashes and underscores aside ("Node.js" =
 *  "NodeJS", "MS-Project" = "ms project"); "C#" and "C++" stay apart. */
const sameSkill = (s: string) => s.toLowerCase().replace(/[\s._-]+/g, "");

/** A Skills item read off a job line: the line's words as its source, filed as a skill. */
const skillFrom = (line: ClaimRecord, id: string, semanticKey: string, text: string): SkillClaim => ({
  id,
  semantic_key: semanticKey,
  field_key: null,
  field_value: null,
  field_label: null,
  role: "profile",
  text,
  machine_touch: line.machine_touch,
  classification: line.classification,
  source_quote: line.text.slice(0, 200),
  needs_grill: false,
  grill_hint: null,
  groupName: FALLBACK_GROUP,
});

/** The job's answer → what moves and what is copied. `lines` are the job's lines still in; a line
 *  the answer names outside them, or a tool its line never says, is dropped and counted.
 *  The model's word alone moves nothing (ADR-0018: nothing is removed silently): a line it names as
 *  a tool list leaves its job only when every item #382's split cuts it into (after an optional
 *  "Label:") is a tool it listed for that line. Any other line stays under its job, unchanged and
 *  counted, and the tools it names are copied like an achievement's.
 *  Duplicates: Skills never gets a second copy of a skill it already lists (in or removed) — the
 *  item already there wins and stays untagged; between two new ones, the first in CV order wins. */
export function planTools(answer: ReviewAnswer["jobs"][number], lines: ClaimRecord[], skills: ClaimRecord[]): ToolPlan {
  const own = new Map(lines.map((c) => [c.id, c]));
  const listed = new Set(skills.map((c) => sameSkill(c.text)));
  const plan: ToolPlan = { leave: [], add: [] };
  const drop = () => incrementCounter("cvReview.tool_dropped");
  const take = (claim: SkillClaim, copied: boolean) => {
    if (listed.has(sameSkill(claim.text))) return;
    listed.add(sameSkill(claim.text));
    plan.add.push({ claim, copied });
  };
  const used = [...(answer.toolsUsed ?? [])];
  for (const entry of answer.toolLists ?? []) {
    const { line: id, tools } = typeof entry === "string" ? { line: entry, tools: [] } : entry;
    const line = own.get(id);
    if (!line || plan.leave.includes(id)) {
      drop();
      continue;
    }
    const named = new Set(tools.map(sameSkill));
    if (!splitSkillText(line.text).items.every((item) => named.has(sameSkill(item)))) {
      incrementCounter("cvReview.tool_list_refused");
      used.push({ line: id, tools });
      continue;
    }
    plan.leave.push(id);
    // #382's split, as at import: one item per tool, the list's own label as the group.
    for (const item of splitSkillClaims([skillFrom(line, `skill-${line.id}`, `skill-${line.semantic_key}`, line.text)])) take(item as SkillClaim, false);
  }
  for (const { line: id, tools } of used) {
    const line = own.get(id);
    for (const tool of tools) {
      const name = tool.trim();
      const at = line && name ? line.text.toLowerCase().indexOf(name.toLowerCase()) : -1;
      if (!line || plan.leave.includes(id) || at < 0) {
        drop();
        continue;
      }
      const text = line.text.slice(at, at + name.length);
      const suffix = slug(text) || String(at);
      take(skillFrom(line, `skill-${line.id}-${suffix}`, `skill-${line.semantic_key}-${suffix}`, text), true);
    }
  }
  return plan;
}

/** The job as the tag names it: its employer as the CV writes it, else its title. */
const jobName = (job: ReviewJob): string => job.employer || job.title;

/** #382 (ADR-0018 clause 6): the model's names for the skills the CV left ungrouped (the fallback
 *  group), resolved against the paper. The CV's own group names always win: a name for a skill in a
 *  named group, a line that is no skill, a second name for one skill, or an empty or over-long name
 *  (the rename door's 60) is dropped and counted. */
export function resolveSkillGroups(answer: ReviewAnswer, paper: Paper): Array<{ line: string; group: string }> {
  const skills = paper.sections.find((s) => s.tag === "skill");
  const ungrouped = new Set(skills && "groups" in skills ? (skills.groups ?? []).filter((g) => g.name === FALLBACK_GROUP).flatMap((g) => g.ids) : []);
  const out: Array<{ line: string; group: string }> = [];
  for (const { name, lines } of answer.skillGroups ?? []) {
    const group = name.trim();
    for (const line of lines) {
      if (!ungrouped.has(line) || !group || group.length > 60) {
        incrementCounter("cvReview.skill_group_dropped");
        continue;
      }
      ungrouped.delete(line);
      out.push({ line, group });
    }
  }
  return out;
}

export function resolveSuggestions(answer: ReviewAnswer, paper: Paper): ResolvedSuggestion[] {
  const lines = linesOf(paper);
  const out: ResolvedSuggestion[] = [];
  for (const j of [...answer.jobs.flatMap((j) => j.judgements), ...(answer.sections ?? []).flatMap((s) => s.judgements)]) {
    if (j.verdict !== "remove") continue;
    if (!lines.has(j.line)) {
      incrementCounter("cvReview.judgement_dropped");
      continue;
    }
    out.push({ line: j.line, kind: j.kind, reason: j.reason });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The run.
// ---------------------------------------------------------------------------------------------
/** The unit that carries the letterhead and the non-job sections — on the first job's call when
 *  there are jobs, on its own when the CV has none. */
export const SECTIONS_UNIT = "sections";

export interface ReviewRunDeps {
  llm: LlmClient;
  reviews: CvReviewStore;
  sessions: Pick<SessionStore, "getById">;
  claims: Pick<ClaimStore, "list" | "setText" | "seedDrafted" | "setLineState" | "move" | "seed" | "reject" | "setGroup">;
  jobBlocks: Pick<JobBlockStore, "list">;
  contact: Pick<ContactStore, "get" | "getRecord">;
  floors: Pick<ProductionFamilyFloorStore, "get" | "active">;
  /** Failures seen per unit, in one drive, before the run gives it up. Two, like the job-block
   *  miner: one retry. Attempts started are bounded at twice this over the unit's whole life — the
   *  paid bound: a process stopped mid-call on every start (#363) cannot spend forever, nor can a
   *  failed run reopened by a later read (#362). */
  maxAttempts?: number;
  /** The pause before a retry — a provider that was overloaded a moment ago usually still is. */
  retryDelayMs?: number;
  now?: () => number;
  /** #363: called when a run starts going in this process; returns what stops it when the run is
   *  done. Production holds a request open through Fly's proxy (keepAliveOverHttp); absent, nothing
   *  holds the machine up. */
  keepAlive?: () => () => void;
}

export interface ReviewRunner {
  /** Opens the run for a session that has none yet and drives it to its end — resolves when every
   *  unit has answered or run out of attempts. A session with a run already is left alone. */
  start(sessionId: string): Promise<void>;
  /** #362: reopens a failed run that still has a unit inside its paid-attempt bound, unless the
   *  person has confirmed the review; true when it did. The read that called it then drives it
   *  (`ensure`), and reads as checking again. */
  retry(sessionId: string): Promise<boolean>;
  /** Resumes a run left going by a restart, for its unfinished units only. A no-op while the run
   *  is active in this process, and for a run that has finished. */
  ensure(sessionId: string): void;
  /** #385: a re-upload brought items past `since` (a claim seq) into a session whose run has
   *  finished: a new run for the jobs holding them — the sections riding on the first, or on their
   *  own when only they changed — added to the run and driven like it. Its answer lands on the new
   *  items only; the items before keep their state and marks. Once per re-upload. */
  rerun(sessionId: string, since: number): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How long one keep-alive request is held open server-side. Well under any proxy's idle limit;
 *  the loop opens the next the moment one returns, so the machine never reads as idle. */
export const KEEP_ALIVE_HOLD_MS = 25_000;

/** #363: the production keep-alive — one request to the API's own public URL (through Fly's proxy,
 *  which is what counts the load) held open for `holdMs`, then the next, until stopped. A request
 *  that fails or returns at once is not retried faster than one per `holdMs`: a misconfigured URL
 *  costs a log line every half minute, never a hammer. The key travels in a header, never the URL:
 *  Fastify logs every request's URL. */
export function keepAliveOverHttp(url: string, opsKey: string, holdMs = KEEP_ALIVE_HOLD_MS): () => () => void {
  return () => {
    const stopped = new AbortController();
    void (async () => {
      while (!stopped.signal.aborted) {
        await Promise.all([
          fetch(`${url}?ms=${holdMs}`, { headers: { "x-ops-key": opsKey }, signal: AbortSignal.any([stopped.signal, AbortSignal.timeout(holdMs * 2)]) })
            .then((res) => {
              if (!res.ok) console.error(`[ops] cv review keep-alive answered ${res.status}`);
            })
            .catch((err) => {
              if (!stopped.signal.aborted) console.error(`[ops] cv review keep-alive failed: ${err instanceof Error ? err.message : String(err)}`);
            }),
          setTimeoutAsync(holdMs, undefined, { signal: stopped.signal }).catch(() => {}),
        ]);
      }
    })();
    return () => stopped.abort();
  };
}

export function makeReviewRunner(deps: ReviewRunDeps): ReviewRunner {
  const maxAttempts = deps.maxAttempts ?? 2;
  const maxStarts = maxAttempts * 2;
  const retryDelayMs = deps.retryDelayMs ?? 2000;
  const stamp = () => new Date(deps.now?.() ?? Date.now()).toISOString();
  // Runs this process is driving right now — the guard against driving one twice (start racing a
  // read's ensure, or two reads racing each other). Added synchronously, before the first await.
  const active = new Set<string>();
  const retryable = (u: ReviewUnit) => u.result === null && u.attempts < maxStarts;
  // #383: the jobs' calls land in parallel; their tool moves run one at a time, so two jobs naming
  // the same tool still give Skills one copy. ponytail: one queue for every session in the process —
  // per-session queues if this ever waits on anything slower than the store.
  let toolQueue: Promise<unknown> = Promise.resolve();
  const oneAtATime = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = toolQueue.then(fn);
    toolQueue = next.catch(() => {});
    return next;
  };
  async function moveTools(sessionId: string, job: ReviewJob, answer: ReviewAnswer["jobs"][number]): Promise<void> {
    if (!answer.toolLists?.length && !answer.toolsUsed?.length) return;
    await oneAtATime(async () => {
      const claims = await deps.claims.list(sessionId);
      const read = new Set(job.lines.map((l) => l.id));
      const lines = claims.filter((c) => read.has(c.id) && c.lineState === "ticked");
      const skills = claims.filter((c) => kindTag(c) === "skill" && (c.decision === "pending" || c.decision === "confirmed") && !isUnaddedDraft(c.lineState));
      const plan = planTools(answer, lines, skills);
      // The items land before the list leaves: a crash in between leaves the list in its job and
      // its items in Skills, and the retry lands the same ids again (seed ignores a stored one).
      await deps.claims.seed(sessionId, plan.add.map((a) => a.claim));
      for (const a of plan.add) await deps.claims.move(sessionId, a.claim.id, "skill", jobName(job), a.copied);
      // The tool list itself leaves every view the way any read line does — rejected, never deleted:
      // its words stay stored, and each of its items carries them as its source.
      for (const id of plan.leave) await deps.claims.reject(sessionId, id);
    });
  }

  // Failures are counted per drive, so a run reopened by a later read (#362) gets its own retry;
  // attempts started are counted for good — they are the paid bound across every drive.
  async function runUnit(sessionId: string, unit: string, withSections: boolean, startedBefore: number): Promise<void> {
    const { job, since } = unitOf(unit);
    let attempts = startedBefore;
    let failures = 0;
    while (failures < maxAttempts && attempts < maxStarts) {
      if (attempts > startedBefore) await sleep(retryDelayMs);
      await deps.reviews.recordAttempt(sessionId, unit);
      attempts += 1;
      try {
        const paper = await readPaper(deps, sessionId);
        const jobs = job === SECTIONS_UNIT ? [] : [job];
        if (jobs.length && !paper.jobs.some((j) => j.job.id === job)) throw new Error(`job ${job} is no longer on the paper`);
        const toReview = withSections ? [SECTIONS_UNIT, ...jobs] : jobs;
        const text = await deps.llm.complete(`${reviewPrompt()}\n\n${buildReviewInput(paper, deps.floors, toReview)}`);
        const answer = parseReviewAnswer(text);
        // Coverage: exactly the jobs asked for, and the sections when they were asked for — an
        // answer for the wrong job is not an answer (the judge's verifyCoverage rule).
        const ids = promptJobIds(paper);
        const asked = jobs.map((id) => ids.get(id)!).sort();
        const got = answer.jobs.map((j) => j.job).sort();
        if (asked.join() !== got.join()) throw new Error(`answered for ${got.join(", ") || "no job"}, asked for ${asked.join(", ") || "no job"}`);
        if (withSections && answer.sections === null) throw new Error("sections were asked for and not answered");
        const back = new Map([...ids].map(([real, prompt]) => [prompt, real]));
        const translated: ReviewAnswer = {
          ...answer,
          jobs: answer.jobs.map((j) => ({ ...j, job: back.get(j.job) ?? j.job })),
          refused: answer.refused.map((r) => ({ ...r, job: back.get(r.job) ?? r.job })),
        };
        const drafted = job === SECTIONS_UNIT ? { family: null, claims: [], drafts: [] } : resolveDrafts(translated, paper, deps.floors, unit);
        const current = new Map((await deps.claims.list(sessionId)).map((c) => [c.id, c]));
        // #385: a re-upload's run marks only the items it brought — the ones before were answered in
        // a check mode already, and keep their state, words and marks.
        const fresh = (line: string) => since === null || (current.get(line)?.seq ?? 0) > since;
        if (since !== null) await settleDrafts(sessionId, job, drafted, current);
        const result: ReviewUnitResult = {
          answer: translated,
          fixes: resolveFixes(answer, paper).filter((f) => fresh(f.line)),
          suggestions: resolveSuggestions(answer, paper).filter((f) => fresh(f.line)),
          family: drafted.family,
          drafts: drafted.drafts,
        };
        // #385: About you is written once, from the first read; a re-upload's run leaves it as it is.
        const about = withSections && since === null ? resolveAbout(answer, paper) : undefined;
        if (about) result.about = about;
        // Applied by default (ADR-0016 clause 5) — to a line that still reads what the model was
        // shown; a line changed meanwhile keeps its new text and wears no fix.
        for (const fix of result.fixes) {
          if (current.get(fix.line)?.text === fix.original) await deps.claims.setText(sessionId, fix.line, fix.corrected);
        }
        // #380: a removal suggestion is the line's own state — out of every render until answered
        // (prints keys on ticked), and what the finish gate counts. Only a line still in moves: one
        // the person already removed while the run went is not asked again.
        for (const s of result.suggestions) {
          if (current.get(s.line)?.lineState === "ticked") await deps.claims.setLineState(sessionId, s.line, "removal-suggested");
        }
        // The drafts land on the paper as unticked lines before the checkpoint names them (#342):
        // a crash in between leaves lines the next attempt will not store twice, never marks that
        // point at lines that do not exist.
        await deps.claims.seedDrafted(sessionId, drafted.claims);
        // #371: a summary fact moves to the section a reader expects, without asking, and says so
        // (ADR-0018 clause 6). Its words are untouched; a retry re-applies the same move.
        for (const m of withSections ? resolveMoves(answer, paper).filter((m) => fresh(m.line)) : []) await deps.claims.move(sessionId, m.line, m.section, FROM_SUMMARY);
        // #382: the skills the CV left ungrouped take the model's group names — only while still in
        // the fallback group (a name the person gave meanwhile wins), and only the new ones on a re-run.
        for (const g of withSections ? resolveSkillGroups(answer, paper) : []) {
          const skill = current.get(g.line);
          if (skill && fresh(g.line) && groupOf(skill) === FALLBACK_GROUP) await deps.claims.setGroup(sessionId, g.line, g.group);
        }
        // #383: a job's tool list moves to Skills and an achievement's tools are copied there — on a
        // re-upload's run (#385), from the new lines only: a line already checked stays where it is.
        const reviewed = paper.jobs.find((j) => j.job.id === job)?.job;
        const tools = translated.jobs[0];
        if (reviewed && tools)
          await moveTools(sessionId, reviewed, {
            ...tools,
            toolLists: tools.toolLists?.filter((e) => fresh(typeof e === "string" ? e : e.line)),
            toolsUsed: tools.toolsUsed?.filter((t) => fresh(t.line)),
          });
        await deps.reviews.recordResult(sessionId, unit, result);
        return;
      } catch (err) {
        // #364: a connection dropped mid-stream reads only "terminated"; its reason is the cause.
        const reason =
          err instanceof Error
            ? `${err.message}${err.cause instanceof Error ? ` (cause: ${err.cause.message})` : ""}`
            : String(err);
        failures += 1;
        // Kept on the unit, capped — a zod error can quote much of the answer back.
        await deps.reviews.recordFailure(sessionId, unit, reason.slice(0, 2000));
        incrementCounter("cvReview.unit_attempt_failed");
        console.error(`[ops] cv review unit ${unit} attempt ${attempts} failed: ${reason}`);
      }
    }
  }

  async function drive(sessionId: string): Promise<void> {
    const run = await deps.reviews.get(sessionId);
    if (!running(run)) return;
    // The sections ride on the first unit of each run: the first run's, and each re-upload's (#385).
    const firsts = new Map<number | null, string>();
    for (const { unit } of run.units) if (!firsts.has(unitOf(unit).since)) firsts.set(unitOf(unit).since, unit);
    const pending = run.units.filter(retryable);
    const release = pending.length ? deps.keepAlive?.() : undefined;
    try {
      await Promise.all(pending.map((u) => runUnit(sessionId, u.unit, firsts.get(unitOf(u.unit).since) === u.unit, u.attempts)));
      const final = await deps.reviews.get(sessionId);
      if (!running(final)) return;
      await deps.reviews.finish(sessionId, final.units.every((u) => u.result !== null) ? "done" : "failed", stamp());
    } finally {
      release?.();
    }
  }

  /** #385: the drafts a re-upload's run brings to a job that had drafts before. An earlier draft
   *  still unanswered is replaced — rejected, so it leaves the paper and the finish gate — by this
   *  run's, which read the new CV. An answered one (added, dismissed, removed after adding) keeps
   *  its state and words, and this run's draft citing the same evidence (the same must-have, the
   *  same CV words) is not made at all: a dismissed suggestion is never proposed again from the
   *  same evidence (ADR-0018 clause 4), and an added one is already in. Matching is within the job. */
  async function settleDrafts(
    sessionId: string,
    job: string,
    drafted: { claims: CandidateClaim[]; drafts: ResolvedDraft[] },
    current: Map<string, ClaimRecord>,
  ): Promise<void> {
    const run = await deps.reviews.get(sessionId);
    const earlier = (run?.units ?? []).filter((u) => unitOf(u.unit).job === job).flatMap((u) => u.result?.drafts ?? []);
    const evidence = (d: ResolvedDraft) => `${d.mustHave ?? ""}\n${(d.quote ?? "").trim().toLowerCase()}`;
    const answered = new Set<string>();
    for (const d of earlier) {
      const line = current.get(d.line);
      if (!line || line.decision === "rejected") continue;
      if (line.lineState === "drafted") await deps.claims.reject(sessionId, d.line);
      else answered.add(evidence(d));
    }
    const kept = new Set(drafted.drafts.filter((d) => !answered.has(evidence(d))).map((d) => d.line));
    drafted.drafts = drafted.drafts.filter((d) => kept.has(d.line));
    drafted.claims = drafted.claims.filter((c) => kept.has(c.id));
  }

  return {
    async rerun(sessionId, since) {
      if (active.has(sessionId)) return;
      active.add(sessionId);
      let driving = false;
      try {
        const run = await deps.reviews.get(sessionId);
        // ponytail: a re-upload while the first run is still going gets no run of its own (its items
        // show as read); extend the going run instead if that ever matters.
        if (!run || run.outcome === null || run.units.some((u) => unitOf(u.unit).since === since)) return;
        const [paper, claims] = await Promise.all([readPaper(deps, sessionId), deps.claims.list(sessionId)]);
        const fresh = new Set(claims.filter((c) => (c.seq ?? 0) > since).map((c) => c.id));
        const changed = paper.jobs.filter(({ job }) => job.lines.some((l) => fresh.has(l.id))).map(({ job }) => job.id);
        const sectionsChanged = paper.sections.some((s) => !("jobs" in s) && s.lines.some((l) => fresh.has(l.id)));
        const jobs = changed.length ? changed : sectionsChanged ? [SECTIONS_UNIT] : [];
        if (jobs.length === 0) return;
        await deps.reviews.extend(sessionId, stamp(), jobs.map((job) => rerunUnit(job, since)));
        driving = true;
        void drive(sessionId)
          .catch((err) => console.error(`[ops] cv review re-run failed: ${err instanceof Error ? err.message : String(err)}`))
          .finally(() => active.delete(sessionId));
      } catch (err) {
        // Like start: nothing the review does may fail the upload that called it. Its own counter —
        // no unit attempt was made.
        incrementCounter("cvReview.rerun_failed");
        console.error(`[ops] cv review re-run failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        if (!driving) active.delete(sessionId);
      }
    },
    async start(sessionId) {
      if (active.has(sessionId)) return;
      active.add(sessionId);
      try {
        if (await deps.reviews.get(sessionId)) return; // generated once, stored
        // A review the person already confirmed, before any run existed (only the wire can do that:
        // the screen waits for the read), is left as they confirmed it — a fix landing on lines
        // they signed off, unseen, is exactly the silent change ADR-0016 forbids.
        if ((await deps.sessions.getById(sessionId))?.reviewCompletedAt) return;
        const paper = await readPaper(deps, sessionId);
        const hasSections = paper.sections.some((s) => !("jobs" in s) && s.lines.length > 0) || Object.values(paper.letterhead).some((v) => v !== null);
        const units = paper.jobs.length ? paper.jobs.map(({ job }) => job.id) : hasSections ? [SECTIONS_UNIT] : [];
        if (units.length === 0) return; // nothing was read, nothing to review
        await deps.reviews.create(sessionId, stamp(), units);
        await drive(sessionId);
      } catch (err) {
        // A store that fails here must never reject into the pipeline that fired this (nothing the
        // review does can fail the upload), nor leave an unhandled rejection to take the process down.
        incrementCounter("cvReview.unit_attempt_failed");
        console.error(`[ops] cv review start failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        active.delete(sessionId);
      }
    },
    async retry(sessionId) {
      const run = await deps.reviews.get(sessionId);
      if (run?.outcome !== "failed" || !run.units.some(retryable)) return false;
      // Never once the person confirmed: a fix landing on lines they signed off is the silent change
      // ADR-0016 forbids (start's own rule).
      if ((await deps.sessions.getById(sessionId))?.reviewCompletedAt) return false;
      await deps.reviews.reopen(sessionId, stamp());
      return true;
    },
    ensure(sessionId) {
      if (active.has(sessionId)) return;
      active.add(sessionId);
      void drive(sessionId)
        .catch((err) => console.error(`[ops] cv review resume failed: ${err instanceof Error ? err.message : String(err)}`))
        .finally(() => active.delete(sessionId));
    },
  };
}
