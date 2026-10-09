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
import type { ClaimStore } from "./claims.js";
import type { ContactStore } from "./contact.js";
import { incrementCounter } from "./counters.js";
import { readPaper, running, type Paper, type ReviewLine } from "./cvReview.js";
import { DRAFT_FLAGS, SUGGESTION_KINDS, type CvReviewStore, type DraftVague, type ResolvedDraft, type ResolvedFix, type ResolvedSuggestion, type ReviewUnit, type ReviewUnitResult, VAGUE_SOURCES } from "./cvReviewStore.js";
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
const Judgement = z.discriminatedUnion("verdict", [
  z.object({ line: z.string(), verdict: z.literal("keep") }),
  z.object({ line: z.string(), verdict: z.literal("untick"), kind: z.enum(SUGGESTION_KINDS), reason: z.string() }),
]);
const VagueOption = z.object({ text: z.string(), from: z.enum(VAGUE_SOURCES), quote: z.string().nullish() });
const DraftedLine = z.object({
  text: z.string(),
  mustHave: z.string().nullable(),
  quote: z.string().nullable(),
  flags: z.array(z.enum(DRAFT_FLAGS)),
  vague: z.array(z.object({ phrase: z.string(), options: z.array(VagueOption) })),
});
const JobReview = z.object({
  job: z.string(),
  family: z.string().nullable(),
  complete: z.boolean(),
  fixes: z.array(Fix),
  judgements: z.array(Judgement),
  mustHaves: z.array(z.object({ id: z.string(), shownBy: z.array(z.string()) })),
  drafted: z.array(DraftedLine),
  endDateMissing: z.boolean(),
  conflicts: z.array(z.object({ what: z.string(), values: z.array(z.string()) })),
});
const SectionReview = z.object({ section: z.string(), fixes: z.array(Fix), judgements: z.array(Judgement) });
export const ReviewAnswer = z.object({
  letterhead: z.object({ checks: z.array(z.string()) }).nullable(),
  sections: z.array(SectionReview).nullable(),
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

export function buildReviewInput(
  paper: Paper,
  floors: Pick<ProductionFamilyFloorStore, "get" | "active">,
  jobsToReview: string[],
): string {
  const { families, placements } = familiesOf(paper, floors);
  const ids = promptJobIds(paper);
  const line = (l: ReviewLine) => `- [${l.id}] ${l.text}`;
  const cv: string[] = [];
  if (paper.letterhead.header) {
    const [name, ...rest] = paper.letterhead.header.split("\n");
    cv.push(`# ${name}`, ...rest);
  }
  const contact = [paper.letterhead.phone?.value, paper.letterhead.email?.value].filter(Boolean).join(" · ");
  if (contact) cv.push(contact);
  for (const section of paper.sections) {
    if ("jobs" in section) {
      if (section.jobs.length === 0) continue;
      cv.push("", `## ${section.heading}`);
      for (const job of section.jobs) {
        const dates = job.dates ? `**${job.dates.start} – ${job.dates.end ?? "?"}**` : "**dates not read**";
        cv.push("", `### ${job.title}${job.employer ? ` — ${job.employer}` : ""} (${ids.get(job.id)})`, dates, "", ...job.lines.map(line));
      }
      continue;
    }
    if (section.lines.length === 0) continue;
    cv.push("", `## ${section.heading}`, "", ...section.lines.map(line));
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
 *  stored under the job's own role heading with a deterministic id, so a retry after a crash
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
): { family: string | null; complete: boolean; claims: CandidateClaim[]; drafts: ResolvedDraft[] } {
  const { families, placements } = familiesOf(paper, floors);
  const placed = families.filter((f) => (placements.get(unit) ?? []).includes(f.familyId));
  const job = answer.jobs.find((j) => j.job === unit);
  const role = paper.jobs.find((j) => j.job.id === unit)?.role;
  const none = { family: null, complete: false, claims: [], drafts: [] };
  if (!job || !role) return none;
  if (placed.length === 0) {
    for (const _ of job.drafted) incrementCounter("cvReview.draft_dropped");
    return none;
  }
  const meanings = new Map(placed.flatMap((f) => f.mustHaves.map((m) => [m.id, m.meaning] as const)));
  // Complete by the model's own account: every must-have of the family shown by an existing line —
  // never read off the drafts that survived below, so a dropped draft cannot stamp a job complete.
  const complete = [...meanings.keys()].every((id) => (job.mustHaves.find((m) => m.id === id)?.shownBy.length ?? 0) > 0);
  const slug = unit.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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
    const id = `draft-${slug}-${i + 1}`;
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
  // by the first; give the stamp and the sheet every label if a multi-family job ever shows up.
  return { family: placed[0]!.label, complete, claims, drafts };
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

export function resolveSuggestions(answer: ReviewAnswer, paper: Paper): ResolvedSuggestion[] {
  const lines = linesOf(paper);
  const out: ResolvedSuggestion[] = [];
  for (const j of [...answer.jobs.flatMap((j) => j.judgements), ...(answer.sections ?? []).flatMap((s) => s.judgements)]) {
    if (j.verdict !== "untick") continue;
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
  claims: Pick<ClaimStore, "list" | "setText" | "seedDrafted">;
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

  // Failures are counted per drive, so a run reopened by a later read (#362) gets its own retry;
  // attempts started are counted for good — they are the paid bound across every drive.
  async function runUnit(sessionId: string, unit: string, withSections: boolean, startedBefore: number): Promise<void> {
    let attempts = startedBefore;
    let failures = 0;
    while (failures < maxAttempts && attempts < maxStarts) {
      if (attempts > startedBefore) await sleep(retryDelayMs);
      await deps.reviews.recordAttempt(sessionId, unit);
      attempts += 1;
      try {
        const paper = await readPaper(deps, sessionId);
        const jobs = unit === SECTIONS_UNIT ? [] : [unit];
        if (jobs.length && !paper.jobs.some(({ job }) => job.id === unit)) throw new Error(`job ${unit} is no longer on the paper`);
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
        const drafted = unit === SECTIONS_UNIT ? { family: null, complete: false, claims: [], drafts: [] } : resolveDrafts(translated, paper, deps.floors, unit);
        const result: ReviewUnitResult = {
          answer: translated,
          fixes: resolveFixes(answer, paper),
          suggestions: resolveSuggestions(answer, paper),
          family: drafted.family,
          complete: drafted.complete,
          drafts: drafted.drafts,
        };
        // Applied by default (ADR-0016 clause 5) — to a line that still reads what the model was
        // shown; a line changed meanwhile keeps its new text and wears no fix.
        const current = new Map((await deps.claims.list(sessionId)).map((c) => [c.id, c.text]));
        for (const fix of result.fixes) {
          if (current.get(fix.line) === fix.original) await deps.claims.setText(sessionId, fix.line, fix.corrected);
        }
        // The drafts land on the paper as unticked lines before the checkpoint names them (#342):
        // a crash in between leaves lines the next attempt will not store twice, never marks that
        // point at lines that do not exist.
        await deps.claims.seedDrafted(sessionId, drafted.claims);
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
    const first = run.units[0]?.unit;
    const pending = run.units.filter(retryable);
    const release = pending.length ? deps.keepAlive?.() : undefined;
    try {
      await Promise.all(pending.map((u) => runUnit(sessionId, u.unit, u.unit === first, u.attempts)));
      const final = await deps.reviews.get(sessionId);
      if (!running(final)) return;
      await deps.reviews.finish(sessionId, final.units.every((u) => u.result !== null) ? "done" : "failed", stamp());
    } finally {
      release?.();
    }
  }

  return {
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
        const hasSections = paper.sections.some((s) => !("jobs" in s) && s.lines.length > 0) || paper.letterhead.header !== null;
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
