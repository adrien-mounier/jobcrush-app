// #338 — "Your CV, reviewed" (ADR-0016 clauses 2, 5 and 6): the CV as read, on paper, before any
// jobs. This module assembles the screen and owns its writes; routes/review.ts is the thin entry.
// What #338 built is the state the person sees when the AI review has not run or has failed: every
// line as read, ticked, and the questions reading the CV itself raises (a missing end date, an
// import conflict). #341 lays the AI's first marks on that same paper — spelling and grammar fixes
// (applied, each undoable) and untick suggestions (shown, never applied) — read off the run's
// checkpoints (cvReviewStore.ts), with the progress of a run still going. #342 adds the drafted lines
// (clause 4): a draft is a claim the run stored under the job (origin `drafted`, state `drafted`),
// so it sits on the paper like any line and prints nowhere until the person ticks it; its source and
// flags are read off the run's checkpoints. #343 adds each draft's word choices, read off the same
// checkpoints — stored with the review, so tapping a phrase never waits on the AI.
//
// Four stores meet here, one of them new: the lines are the claims (ticked/kept is #335's line
// state on the claim; a fix is the claim's own text, #341), the jobs' dates are the job-block
// records (#162), the letterhead is the contact store's five fields (#190/#381),
// and the review run is cvReviewStore.ts. The review adds ONE fact of its own to the session,
// `reviewCompletedAt`, and that is what the jobs gate reads. #385: a re-upload with new items clears
// it (sessions.ts reopenReview) and records `reviewSince`, where its new items start — check mode
// then shows those alone (`newItems`).
import type { ClaimRecord, ClaimStore, LineState } from "./claims.js";
import { CONTACT_FIELDS, type ContactField, type ContactStore, type ContactValue } from "./contact.js";
import { SUGGESTION_KINDS, unitOf, type CvReviewStore, type DraftFlag, type DraftVague, type ResolvedDraft, type ResolvedFix, type ResolvedSuggestion, type ReviewRunRecord } from "./cvReviewStore.js";
import type { ReviewRunner } from "./cvReviewRun.js";
import type { EligibilityStore } from "./eligibility.js";
import { kindTag } from "./graph.js";
import type { JobBlockStore, JobBlockView } from "./jobBlockStore.js";
import { SECTIONS } from "./rootcv.js";
import { skillGroups } from "./skillsSplit.js";
import type { SessionRecord, SessionStore } from "./sessions.js";
import { answerJobDateHole, dateHoleQuestions, JOB_DATE_ITEM_PREFIX, type JobDateAnswerResult } from "./yearsWorked.js";
import { unansweredMarkets, workRightsRows, type WorkRightsRow } from "./workRightsCard.js";
import { declaredLanguages } from "./languageLevel.js";
import { languagesUnion } from "./eligibilityDiscovery.js";
import type { MinedDate, MinedEndValue } from "@jobcrush/contracts";

const KINDS: ReadonlySet<string> = new Set(SUGGESTION_KINDS);

/** A fix as the screen shows it: the line's text before and after, and whether the line currently
 *  reads the corrected text. `applied: false` is the person's undo; the sheet then offers "Use fix". */
export interface ReviewFix {
  original: string;
  corrected: string;
  applied: boolean;
}
export interface ReviewSuggestion {
  kind: ResolvedSuggestion["kind"];
  reason: string;
}
/** #342: a drafted line's source and flags, shown under it without a tap. A draft wears this
 *  whatever its state: unticked (`drafted`), ticked by the person, or kept after that. */
export interface ReviewDraft {
  /** The must-have it covers, in the family's own words. */
  mustHave: string | null;
  /** The verbatim CV words it came from. */
  quote: string | null;
  /** #368: where those words sit on the CV — "<employer>, <title>" for a job (its own job too), the
   *  section's heading for a quote from outside any job. Null with no quote, or when no line holds it. */
  source: string | null;
  flags: DraftFlag[];
  /** #343: the vague phrases in the line, each with its choices — CV-sourced first, then typical. */
  vague: DraftVague[];
}
export interface ReviewLine {
  id: string;
  text: string;
  state: LineState;
  fix: ReviewFix | null;
  /** The review's untick suggestion, with its one-sentence reason. The line stays ticked until the
   *  person acts (ADR-0016 clause 3). */
  suggestion: ReviewSuggestion | null;
  draft: ReviewDraft | null;
  /** #371: where the review moved this line from ("your summary"), worn as a tag; null otherwise. */
  movedFrom: string | null;
  /** #383: present only on a copy — a tool taken from an achievement that stays under its job
   *  ("Taken from <job>"); a line that moved ("Moved from <job>") has none. */
  copied?: true;
}
export interface ReviewJob {
  /** The job-block id when the lines matched a dated record, else the role heading's own key. */
  id: string;
  blockId: string | null;
  title: string;
  employer: string;
  /** As the paper prints them: "Mar 2021" / "2021"; `end` null when the CV gives no end (the
   *  question below is then asked on this job). "now" for a job the person is still in. */
  dates: { start: string; end: string | null } | null;
  /** "When did you leave {employer}?" — present only while this job's end date is unknown. */
  endDateQuestion: string | null;
  /** #341: true while the review run is going and this job's answer has not landed yet — the
   *  screen greys the job and says it is still being checked. */
  checking: boolean;
  /** #342: the label of the family this job was reviewed as, once its answer landed; null before
   *  that and for a job in no published family (no drafts — and nothing says why). */
  family: string | null;
  lines: ReviewLine[];
}
export type ReviewSection =
  | { tag: "experience"; heading: string; jobs: ReviewJob[] }
  /** #382: `groups` on the Skills section only — its lines as named groups, by line id, in the
   *  order each group first appears. Grouping is never an item to answer. */
  | { tag: string; heading: string; lines: ReviewLine[]; groups?: Array<{ name: string; ids: string[] }> };
export interface ReviewLetterheadField {
  value: string;
  origin: ContactValue["origin"];
}
/** #341: the run while it is still going. Null once it has finished — or failed, which the person
 *  is never told (the "never show the kitchen" rule): both read the same here. A failed run a
 *  later read reopens (#362) is going again, and reads as such. */
export interface ReviewProgress {
  done: number;
  total: number;
  minutesLeft: number;
}
export interface ReviewState {
  completed: boolean;
  /** #381: Your details — the letterhead's five fields, each null when the CV has none. */
  letterhead: Record<ContactField, ReviewLetterheadField | null>;
  /** #323: a field the CV gave two values for, asked once here. Null once settled or when none. */
  conflict: { fieldId: string; question: string; values: string[] } | null;
  progress: ReviewProgress | null;
  /** #362: some part of the CV has no review answer — the run is still going, it gave up on a part,
   *  or there is no run. The screen then never reads as a finished check ("0 to check"); nothing says why. */
  unchecked: boolean;
  /** #371 (ADR-0018 clause 5): About you — the person's saved text once they kept or edited it, else
   *  the one the review wrote from the whole CV — and the CV's own summary as it read ("See what your
   *  CV said"; null when the CV had none). Null until the review's sections answer lands with one,
   *  and when it never does: the screen then shows the summary lines as read. */
  about: { text: string; original: string | null } | null;
  /** The paper, in the master CV's own print order (rootcv.ts's SECTIONS). */
  sections: ReviewSection[];
  /** #376: "Where you can work" — one row per target market, the card on the last screen. Empty
   *  when the session names no covered market: nothing can be asked, and nothing holds the jobs. */
  workRights: WorkRightsRow[];
  /** #376: the languages the person said they speak (the eligibility store's declarations) — what
   *  the Languages screen's card shows when the CV lists none. */
  languages: string[];
  /** #376: the languages the card completes from as the person types — the product's own list
   *  (languages-by-market.json), so it grows with the data. Anything else typed is kept as written. */
  languageOptions: string[];
  /** #385 (ADR-0018 clause 3): check mode brought back by a re-upload shows only these items — the
   *  ones the re-upload brought, and the suggestions made on them. Empty when a target market with
   *  no work-rights answer brought a finished check mode back (ADR-0018 clause 7): only that card
   *  shows. Null for the first check mode, which shows every item. */
  newItems: string[] | null;
}

export interface ReviewDeps {
  claims: ClaimStore;
  sessions: Pick<SessionStore, "completeReview" | "resolveImport">;
  jobBlocks: JobBlockStore;
  eligibility: EligibilityStore;
  contact: Pick<ContactStore, "get" | "getRecord">;
  reviews: CvReviewStore;
  /** #341: the run, when one is wired (main.ts, qa-main.ts, tests). Absent — a build with no
   *  review model — the paper shows the lines as read, exactly as #338 shipped it. */
  runner?: Pick<ReviewRunner, "ensure" | "retry">;
  now?: () => number;
}

/** The whole-CV review measured 3.5–5 minutes on the product model (#340, 2026-10-06); the
 *  per-job calls this run makes overlap, so a run is about as long as its slowest job. "About N
 *  minutes left" counts down from here and never reaches zero while the run is going. */
export const EXPECTED_RUN_MINUTES = 5;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateText = (d: MinedDate): string =>
  d.precision === "month" && d.month !== null ? `${MONTHS[d.month - 1]} ${d.year}` : String(d.year);
const endText = (end: MinedEndValue): string | null =>
  end.state === "ongoing" ? "now" : end.state === "ended" ? dateText(end.date) : null;

/** The lines a person can see on the paper: everything read or said, minus what they rejected or
 *  answered "no" to — the same cut the profile makes. In CV order (seq). */
const onPaper = (c: ClaimRecord) => c.decision === "pending" || c.decision === "confirmed";
const toLine = (c: ClaimRecord): ReviewLine => ({ id: c.id, text: c.text, state: c.lineState, fix: null, suggestion: null, draft: null, movedFrom: c.movedFrom ?? null, ...(c.copied ? { copied: true as const } : {}) });

const norm = (s: string) => s.trim().toLowerCase();

/** The dated record a role heading ("IT Project Manager - Nordic Retail Group") belongs to. The
 *  miner names a role by employer + title as written and the job-block miner reads the same CV, so
 *  both names appear in the heading on a clean read; employer alone is accepted when the title was
 *  reworded, title alone as the last resort. Null when nothing fits — the job still shows, undated. */
function matchBlock(role: string, blocks: readonly JobBlockView[], taken: Set<string>): JobBlockView | null {
  const heading = norm(role);
  const free = blocks.filter((b) => !taken.has(b.id));
  const has = (b: JobBlockView, key: "employer" | "title") => {
    const value = norm(b[key].value);
    return value.length > 1 && heading.includes(value);
  };
  return (
    free.find((b) => has(b, "employer") && has(b, "title")) ??
    free.find((b) => has(b, "employer")) ??
    free.find((b) => has(b, "title")) ??
    null
  );
}

/** The jobs on the paper, each with the role heading its lines are filed under — the role a drafted
 *  line for that job is stored with (#342), so it lands in the same job on the next read. A dated
 *  job with no lines gets the heading the miner would have written for it. */
function jobsOf(experience: ClaimRecord[], blocks: readonly JobBlockView[]): { jobs: ReviewJob[]; roles: Map<string, string> } {
  const holes = new Map(dateHoleQuestions(blocks).map((q) => [q.itemId.slice(JOB_DATE_ITEM_PREFIX.length), q.question]));
  const byRole = new Map<string, ClaimRecord[]>();
  for (const c of experience) byRole.set(c.role, [...(byRole.get(c.role) ?? []), c]);
  // A block's own values win over the heading, because a correction the person made on the
  // work-history check lives on the block.
  const datedJob = (block: JobBlockView, lines: ReviewLine[]): ReviewJob => ({
    id: block.id,
    blockId: block.id,
    title: block.title.value,
    employer: block.employer.value,
    dates: { start: dateText(block.start.value), end: endText(block.end.value) },
    endDateQuestion: holes.get(block.id) ?? null,
    checking: false,
    family: null,
    lines,
  });
  const taken = new Set<string>();
  const jobs: ReviewJob[] = [];
  const roles = new Map<string, string>();
  for (const [role, lines] of byRole) {
    const block = matchBlock(role, blocks, taken);
    if (block) {
      taken.add(block.id);
      jobs.push(datedJob(block, lines.map(toLine)));
      roles.set(block.id, role);
      continue;
    }
    // "Title - Employer" is how the miner writes the heading.
    const [title = role, employer = ""] = role.split(/\s+[-–—]\s+/, 2);
    jobs.push({ id: role, blockId: null, title, employer, dates: null, endDateQuestion: null, checking: false, family: null, lines: lines.map(toLine) });
    roles.set(role, role);
  }
  // A dated job the lines did not name is still on the paper, with its own date question when its
  // end is unknown: the hole is on the record, not on the lines, and the review is the one place it
  // is asked now. It stays after the answer, so the paper does not lose a job the person just dated.
  for (const block of blocks) {
    if (block.countsTowardExperience && !taken.has(block.id)) {
      jobs.push(datedJob(block, []));
      roles.set(block.id, `${block.title.value} - ${block.employer.value}`);
    }
  }
  return { jobs, roles };
}

/** The paper as read, before any mark: what the screen shows and what the review run reviews. */
export interface Paper {
  letterhead: ReviewState["letterhead"];
  sections: ReviewSection[];
  /** Every job on the paper, with its family placement — the run's units and its JOB PLACEMENTS —
   *  and the role heading its lines are filed under, which a drafted line for it is stored with. */
  jobs: Array<{ job: ReviewJob; block: JobBlockView | null; role: string }>;
  /** The claims behind the lines, as read (on the paper, CV order) — so a caller needs no second read. */
  claims: ClaimRecord[];
}

export interface PaperDeps {
  claims: Pick<ClaimStore, "list">;
  jobBlocks: Pick<JobBlockStore, "list">;
  contact: Pick<ContactStore, "get" | "getRecord">;
}

export async function readPaper(deps: PaperDeps, sessionId: string): Promise<Paper> {
  const [claims, blocks, record] = await Promise.all([
    deps.claims.list(sessionId),
    deps.jobBlocks.list(sessionId),
    deps.contact.getRecord(sessionId),
  ]);
  // list() already returns CV order (seq) on both drivers; the sort only pins it for a hand-built record.
  const visible = claims.filter(onPaper).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const byTag = new Map<string, ClaimRecord[]>();
  for (const c of visible) {
    const tag = kindTag(c);
    byTag.set(tag, [...(byTag.get(tag) ?? []), c]);
  }
  const field = (v: ContactValue | null): ReviewLetterheadField | null =>
    v ? { value: v.value, origin: v.origin } : null;
  const { jobs, roles } = jobsOf(byTag.get("experience") ?? [], blocks);
  return {
    letterhead: Object.fromEntries(CONTACT_FIELDS.map((f) => [f, field(record[f])])) as Paper["letterhead"],
    sections: SECTIONS.map(([tag, heading]) =>
      tag === "experience"
        ? { tag, heading, jobs }
        : tag === "skill"
          ? { tag, heading, lines: (byTag.get(tag) ?? []).map(toLine), groups: skillGroups(byTag.get(tag) ?? []) }
          : { tag, heading, lines: (byTag.get(tag) ?? []).map(toLine) },
    ),
    jobs: jobs.map((job) => ({ job, block: blocks.find((b) => b.id === job.blockId) ?? null, role: roles.get(job.id)! })),
    claims: visible,
  };
}

export const running = (run: ReviewRunRecord | null): run is ReviewRunRecord => run !== null && run.outcome === null;

/** The marks a run's checkpoints lay on a line. A fix wears its mark only while the line reads
 *  the corrected text (applied) or the original (undone): a line that reads neither has been
 *  changed since, and the fix no longer describes it. */
export function fixOf(text: string, fix: ResolvedFix | undefined): ReviewFix | null {
  const wearsFix = fix && (text === fix.corrected || text === fix.original);
  return wearsFix ? { original: fix.original, corrected: fix.corrected, applied: text === fix.corrected } : null;
}

function markLine(line: ReviewLine, fix: ResolvedFix | undefined, suggestion: ResolvedSuggestion | undefined, draft: ResolvedDraft | undefined, source: string | null): ReviewLine {
  return {
    ...line,
    fix: fixOf(line.text, fix),
    suggestion: suggestion ? { kind: suggestion.kind, reason: suggestion.reason } : null,
    draft: draft ? { mustHave: draft.mustHave, quote: draft.quote, source, flags: draft.flags, vague: draft.vague ?? [] } : null,
  };
}

/** #384: the profile reads the same marks, so a fix shows there after check mode. */
export function lineMarks(run: ReviewRunRecord | null) {
  const fixes = new Map<string, ResolvedFix>();
  const suggestions = new Map<string, ResolvedSuggestion>();
  const drafts = new Map<string, ResolvedDraft>();
  for (const unit of run?.units ?? []) {
    for (const fix of unit.result?.fixes ?? []) fixes.set(fix.line, fix);
    // #380: a result stored before the removal kinds carries the old untick kinds (weak,
    // aim-without-result) — read as no suggestion, never a 500 on the wire's enum.
    for (const s of unit.result?.suggestions ?? []) if (KINDS.has(s.kind)) suggestions.set(s.line, s);
    for (const d of unit.result?.drafts ?? []) drafts.set(d.line, d);
  }
  return { fixes, suggestions, drafts };
}

/** #368: where a draft's quote sits on the paper — the first line, in CV order, whose text holds it
 *  (case and spacing aside), named by its job or its section. A draft is never its own source. The
 *  run records no place for a quote, so this reads the lines as stored; a quote reworded by the model
 *  or spanning two lines finds none, and the card then says only "From your CV". #386: nor is About
 *  you (written from the whole CV, so it repeats the jobs' own words) — it is not where the CV said it. */
function quoteSources(paper: Paper, drafts: ReadonlyMap<string, ResolvedDraft>): (quote: string) => string | null {
  const flat = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const places = paper.sections.flatMap((section) =>
    "jobs" in section
      ? section.jobs.map((job) => ({ name: [job.employer, job.title].filter(Boolean).join(", "), lines: job.lines }))
      : [{ name: section.heading, lines: section.lines }],
  );
  const read = places.flatMap(({ name, lines }) =>
    lines.filter((l) => !drafts.has(l.id) && l.id !== ABOUT_YOU_ID).map((l) => ({ name, text: flat(l.text) })),
  );
  return (quote) => read.find((l) => l.text.includes(flat(quote)))?.name ?? null;
}

export async function buildReviewState(deps: ReviewDeps, session: SessionRecord): Promise<ReviewState> {
  const [paper, found] = await Promise.all([readPaper(deps, session.id), deps.reviews.get(session.id)]);
  // #362: a failed run is reopened here, quietly, while a unit is inside its paid bound.
  let run = found;
  if (found?.outcome === "failed" && (await deps.runner?.retry(session.id))) run = await deps.reviews.get(session.id);
  // A run left going by a process that restarted mid-way — or just reopened — resumes here, on the
  // first read that finds it, spending only on the units with no answer yet.
  if (running(run)) deps.runner?.ensure(session.id);
  const { fixes, suggestions, drafts } = lineMarks(run);
  const sourceOf = quoteSources(paper, drafts);
  const mark = (line: ReviewLine) => {
    const draft = drafts.get(line.id);
    return markLine(line, fixes.get(line.id), suggestions.get(line.id), draft, draft?.quote ? sourceOf(draft.quote) : null);
  };
  // By job: a re-upload's unit (#385) answers for the same job as the first run's, and the latest wins.
  const results = new Map(run?.units.flatMap((u) => (u.result ? [[unitOf(u.unit).job, u.result] as const] : [])) ?? []);
  const asking = new Set(run?.units.flatMap((u) => (u.result ? [] : [unitOf(u.unit).job])) ?? []);
  const conflict = session.importProof?.conflict ?? null;
  const lineTexts = paper.sections.flatMap((s) => ("jobs" in s ? s.jobs.flatMap((j) => j.lines) : s.lines)).map((l) => l.text);
  const workRights = await workRightsRows(deps.eligibility, session.id, session.intent.searchAreas, lineTexts);
  // A finished check mode that a market with no work-rights answer brought back (jobsOpen holds the
  // jobs) shows no item again — only that card. A re-upload's (#385) shows the items it brought.
  const since = session.reviewSince;
  const newItems =
    session.reviewCompletedAt !== null && workRights.some((r) => r.answer === null)
      ? []
      : since === null
        ? null
        : paper.claims.filter((c) => (c.seq ?? 0) > since).map((c) => c.id);
  // Off the units, not `results`: a re-upload's unit (#385) replaces its job's result and writes none.
  const generated = run?.units.find((u) => u.result?.about)?.result?.about ?? null;
  const summary = paper.sections.find((s) => s.tag === "profile");
  const saved = summary && "lines" in summary ? summary.lines.find((l) => l.id === ABOUT_YOU_ID) : undefined;
  const minutesLeft = (startedAt: string) =>
    Math.max(1, Math.ceil(EXPECTED_RUN_MINUTES - ((deps.now?.() ?? Date.now()) - Date.parse(startedAt)) / 60_000));
  return {
    completed: session.reviewCompletedAt !== null,
    letterhead: paper.letterhead,
    conflict: conflict ? { fieldId: conflict.fieldId, question: conflict.label, values: conflict.values } : null,
    progress: running(run)
      ? { done: run.units.filter((u) => u.result).length, total: run.units.length, minutesLeft: minutesLeft(run.startedAt) }
      : null,
    // No run at all is no check either: a build with no review model, or a run that never opened.
    unchecked: !run || run.units.some((u) => u.result === null),
    about: saved ? { text: saved.text, original: generated?.original ?? null } : generated,
    sections: paper.sections.map((section) =>
      "jobs" in section
        ? {
            ...section,
            jobs: section.jobs.map((job) => {
              const result = results.get(job.id);
              return {
                ...job,
                checking: running(run) && asking.has(job.id),
                family: result?.family ?? null,
                lines: job.lines.map(mark),
              };
            }),
          }
        : { ...section, lines: section.lines.map(mark) },
    ),
    workRights,
    languages: declaredLanguages(await deps.eligibility.list(session.id)),
    languageOptions: [...languagesUnion()],
    newItems,
  };
}

/** The finish gate's refusal codes — check mode (#377) finishes here, and this union is the one
 *  vocabulary it reads. Append, never rename: `suggestions_open` (#378/#380) is a suggestion not yet
 *  answered; #376 `work_rights_unset` is a target market with no work-rights answer. */
export type CompleteReviewResult =
  | { ok: true }
  | { ok: false; code: "review_running" | "suggestions_open" | "work_rights_unset"; message: string };

/** The line states that are a suggestion still waiting for its answer (ADR-0018 clauses 4 and 7:
 *  nothing may be left open when check mode finishes). `drafted` is an add suggestion (#378),
 *  `removal-suggested` a removal one (#380) — one set, one gate. A `dismissed` draft is answered.
 *  Mirrored on the screen by screens.tsx OPEN_SUGGESTION_STATES. */
const OPEN_SUGGESTION_STATES: ReadonlySet<LineState> = new Set<LineState>(["drafted", "removal-suggested"]);
// A draft a re-upload's run replaced (#385) is rejected: off the paper, nothing left to answer.
const isOpenSuggestion = (c: ClaimRecord) => onPaper(c) && OPEN_SUGGESTION_STATES.has(c.lineState);

/** The person reached the end and confirmed. Every line still pending becomes theirs — the review
 *  IS the look at each line the old confirm deck asked for — in the state it is in (a kept line
 *  stays kept, so it still does not print). Two exceptions. An open conflict: "Not sure" stored
 *  nothing, so the two readings stay pending and neither prints until the person picks — the
 *  machine never turns a reading the person left open into a printed line. And a draft the person
 *  said No thanks to (#378): it stays pending and dismissed, held only so it is never proposed
 *  again; nobody vouches for it. Then the one fact the jobs gate reads.
 *
 *  Refused while the review run is still going (#341, layout decision on #338): a fix landing after
 *  the confirm would change a line the person already signed off without their having seen it. The
 *  screen keeps the confirm locked for the same reason; this is the gate behind the lock. And
 *  refused while any suggestion is unanswered (#378, ADR-0018 clause 7, which replaced ADR-0016
 *  clause 6's "undecided drafts do not block"): an add suggestion is answered by Add it, Edit
 *  first or No thanks, and the jobs wait until every one is.
 *
 *  #376 (ADR-0018 clause 7): refused too while a target market has no work-rights answer — the job
 *  search reads it. A proposal from the CV is not an answer; with no target market, nothing holds.
 *  The screen names the markets first, then the suggestions, and so does the order here. */
export async function completeReview(
  deps: ReviewDeps,
  session: Pick<SessionRecord, "id" | "importProof" | "intent">,
): Promise<CompleteReviewResult> {
  if (running(await deps.reviews.get(session.id)))
    return { ok: false, code: "review_running", message: "Your jobs open when the check is finished." };
  const unset = await unansweredMarkets(deps.eligibility, session.id, session.intent.searchAreas);
  if (unset.length > 0)
    return { ok: false, code: "work_rights_unset", message: `Tell me if you can work in ${unset.join(" and ")} first.` };
  const claims = await deps.claims.list(session.id);
  if (claims.some(isOpenSuggestion))
    return { ok: false, code: "suggestions_open", message: "Answer every suggestion to finish your profile." };
  const openConflict = session.importProof?.conflict?.fieldId ?? null;
  for (const c of claims) {
    if (c.decision !== "pending" || c.lineState === "dismissed" || (openConflict !== null && c.field_key === openConflict)) continue;
    await deps.claims.confirm(session.id, c.id);
  }
  await deps.sessions.completeReview(session.id);
  return { ok: true };
}

export type SetFixResult = { ok: true; text: string } | { ok: false; code: "not_found"; message: string };

/** #341: the person's undo of a fix, or their "Use fix" after an undo. The fix is found on the run's
 *  checkpoints; the line's text is set to the exact original or the corrected text — nothing else
 *  about the line moves (claims.ts setText). A line with no fix, or one that no longer reads either
 *  text, has nothing to undo. */
export async function setReviewFixApplied(
  deps: ReviewDeps,
  sessionId: string,
  lineId: string,
  applied: boolean,
): Promise<SetFixResult> {
  const run = await deps.reviews.get(sessionId);
  const fix = run ? lineMarks(run).fixes.get(lineId) : undefined;
  const line = fix ? (await deps.claims.list(sessionId)).find((c) => c.id === lineId) : undefined;
  if (!fix || !line || (line.text !== fix.original && line.text !== fix.corrected))
    return { ok: false, code: "not_found", message: "no fix on that line" };
  const text = applied ? fix.corrected : fix.original;
  await deps.claims.setText(sessionId, lineId, text);
  return { ok: true, text };
}

export type DraftResult = { ok: true; text: string } | { ok: false; code: "not_found"; message: string };

/** #342: the person's own wording for a draft they have not ticked yet. The text alone moves
 *  (claims.ts setText); the draft stays a draft until they tick it. A line that is not an unticked
 *  draft — one read from the CV, or a draft already ticked — is not edited here (ADR-0017: that is
 *  the CV chat's). */
export async function setDraftText(deps: ReviewDeps, sessionId: string, lineId: string, text: string): Promise<DraftResult> {
  const line = (await deps.claims.list(sessionId)).find((c) => c.id === lineId);
  if (!line || line.lineState !== "drafted") return { ok: false, code: "not_found", message: "no unticked draft on that line" };
  await deps.claims.setText(sessionId, lineId, text);
  return { ok: true, text };
}

/** #342: the person's tick on a draft. It becomes a confirmed, ticked, user-resolved fact whose
 *  origin records it was drafted and then accepted (claims.ts acceptDraft) — and prints from here on
 *  like any other fact. Unticking it afterwards is the ordinary line door (→ kept). */
export async function tickDraft(deps: ReviewDeps, sessionId: string, lineId: string): Promise<DraftResult> {
  if (!(await deps.claims.acceptDraft(sessionId, lineId))) return { ok: false, code: "not_found", message: "no unticked draft on that line" };
  const line = (await deps.claims.list(sessionId)).find((c) => c.id === lineId)!;
  return { ok: true, text: line.text };
}

/** #371: the claim About you is saved as — one per session, filed under the summary (`profile`). */
export const ABOUT_YOU_ID = "about-you";

/** #371 (ADR-0018 clause 5): the person keeps About you (the text unchanged) or saves their own
 *  words — either way it becomes theirs: one confirmed, user-authored profile claim. The profile's
 *  About you shows it and the tailor reads it as one claim line among the rest: source material,
 *  never print-ready — whether a tailored CV prints a summary is preview-tailor.md rule 10's, per
 *  job. Saving again replaces the words; the CV's own summary lines are left exactly as they were
 *  (authored data is never removed behind the person's back). */
export async function saveAbout(deps: Pick<ReviewDeps, "claims">, sessionId: string, text: string): Promise<{ text: string }> {
  await deps.claims.add(sessionId, {
    id: ABOUT_YOU_ID,
    semantic_key: ABOUT_YOU_ID,
    field_key: null,
    field_value: null,
    field_label: null,
    role: "profile",
    text,
    machine_touch: "reworded",
    classification: "Derived",
    source_quote: text.slice(0, 200),
    needs_grill: false,
    grill_hint: null,
  });
  return { text };
}

/** #378: the person's "No thanks" on a draft they have not ticked — it is held as dismissed, never
 *  proposed again from the same evidence (ADR-0018 clause 4), and prints nowhere — or their Undo of
 *  it, which puts the draft back unanswered. Only a draft in the state the move leaves answers
 *  here: a line read from the CV, an added draft, a second No thanks or an undo with nothing to
 *  undo are all "no such draft". */
export async function dismissDraft(deps: ReviewDeps, sessionId: string, lineId: string, dismissed: boolean): Promise<{ ok: true; state: Extract<LineState, "drafted" | "dismissed"> } | { ok: false; code: "not_found"; message: string }> {
  if (!(await deps.claims.dismissDraft(sessionId, lineId, dismissed))) return { ok: false, code: "not_found", message: dismissed ? "no unticked draft on that line" : "no dismissed draft on that line" };
  return { ok: true, state: dismissed ? "dismissed" : "drafted" };
}

export type SettleConflictResult = { ok: true } | { ok: false; status: 404 | 400; code: string; message: string };

/** #323's conflict, settled once: the person's pick is recorded as their import resolution (so a
 *  re-upload keeps it), and of the two lines the read seeded for the field, the picked value stays
 *  and the other is rejected — the drop is theirs, not silent. "Not sure" never reaches here: it
 *  stores nothing and both values stay on the paper as read. */
export async function settleReviewConflict(
  deps: ReviewDeps,
  session: SessionRecord,
  fieldId: string,
  value: string,
): Promise<SettleConflictResult> {
  const conflict = session.importProof?.conflict;
  if (!conflict || conflict.fieldId !== fieldId)
    return { ok: false, status: 404, code: "unknown_conflict", message: "no such open conflict" };
  if (!conflict.values.includes(value))
    return { ok: false, status: 400, code: "invalid_value", message: "pick one of the values the CV gave" };
  await deps.sessions.resolveImport(session.id, fieldId, value);
  for (const c of await deps.claims.list(session.id)) {
    if (c.field_key !== fieldId) continue;
    if (c.field_value === value) await deps.claims.confirm(session.id, c.id);
    else await deps.claims.reject(session.id, c.id);
  }
  return { ok: true };
}

/** The end-date question, answered on the job's own card. Same path as before (#162): the job
 *  record is corrected and the years total re-derived; nothing is stored as a claim. */
export function answerReviewEndDate(
  deps: ReviewDeps,
  sessionId: string,
  blockId: string,
  answer: string,
): Promise<JobDateAnswerResult> {
  return answerJobDateHole(deps.jobBlocks, deps.eligibility, sessionId, `${JOB_DATE_ITEM_PREFIX}${blockId}`, answer);
}
