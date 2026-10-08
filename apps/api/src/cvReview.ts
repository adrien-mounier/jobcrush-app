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
// records (#162), the letterhead is the contact store's as-read header plus phone/email (#190/#310),
// and the review run is cvReviewStore.ts. The review adds ONE fact of its own to the session,
// `reviewCompletedAt`, and that is what the jobs gate reads.
import type { ClaimRecord, ClaimStore, LineState } from "./claims.js";
import type { ContactStore, ContactValue } from "./contact.js";
import type { CvReviewStore, DraftFlag, DraftVague, ResolvedDraft, ResolvedFix, ResolvedSuggestion, ReviewRunRecord, ReviewUnitResult } from "./cvReviewStore.js";
import type { EligibilityStore } from "./eligibility.js";
import { kindTag } from "./graph.js";
import type { JobBlockStore, JobBlockView } from "./jobBlockStore.js";
import { SECTIONS } from "./rootcv.js";
import type { SessionRecord, SessionStore } from "./sessions.js";
import { answerJobDateHole, dateHoleQuestions, JOB_DATE_ITEM_PREFIX, type JobDateAnswerResult } from "./yearsWorked.js";
import type { MinedDate, MinedEndValue } from "@jobcrush/contracts";

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
   *  that and for a job in no published family (no drafts, no stamp — and nothing says why). */
  family: string | null;
  /** #342: every must-have of the job's family is already shown by its own lines — the stamp. */
  complete: boolean;
  lines: ReviewLine[];
}
export type ReviewSection =
  | { tag: "experience"; heading: string; jobs: ReviewJob[] }
  | { tag: string; heading: string; lines: ReviewLine[] };
export interface ReviewLetterheadField {
  value: string;
  origin: ContactValue["origin"];
}
/** #341: the run while it is still going. Null once it has finished — or failed, which the person
 *  is never told (the "never show the kitchen" rule): both read the same here. */
export interface ReviewProgress {
  done: number;
  total: number;
  minutesLeft: number;
}
export interface ReviewState {
  completed: boolean;
  letterhead: {
    /** The CV's own letterhead block, as read (#310). Null when the read captured none. */
    header: string | null;
    phone: ReviewLetterheadField | null;
    email: ReviewLetterheadField | null;
  };
  /** #323: a field the CV gave two values for, asked once here. Null once settled or when none. */
  conflict: { fieldId: string; question: string; values: string[] } | null;
  progress: ReviewProgress | null;
  /** The paper, in the master CV's own print order (rootcv.ts's SECTIONS). */
  sections: ReviewSection[];
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
  runner?: { ensure(sessionId: string): void };
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
const toLine = (c: ClaimRecord): ReviewLine => ({ id: c.id, text: c.text, state: c.lineState, fix: null, suggestion: null, draft: null });

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
    complete: false,
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
    jobs.push({ id: role, blockId: null, title, employer, dates: null, endDateQuestion: null, checking: false, family: null, complete: false, lines: lines.map(toLine) });
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
}

export interface PaperDeps {
  claims: Pick<ClaimStore, "list">;
  jobBlocks: Pick<JobBlockStore, "list">;
  contact: Pick<ContactStore, "get" | "getRecord">;
}

export async function readPaper(deps: PaperDeps, sessionId: string): Promise<Paper> {
  const [claims, blocks, header, record] = await Promise.all([
    deps.claims.list(sessionId),
    deps.jobBlocks.list(sessionId),
    deps.contact.get(sessionId, "header"),
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
    letterhead: { header: header?.value ?? null, phone: field(record.phone), email: field(record.email) },
    sections: SECTIONS.map(([tag, heading]) =>
      tag === "experience"
        ? { tag, heading, jobs }
        : { tag, heading, lines: (byTag.get(tag) ?? []).map(toLine) },
    ),
    jobs: jobs.map((job) => ({ job, block: blocks.find((b) => b.id === job.blockId) ?? null, role: roles.get(job.id)! })),
  };
}

export const running = (run: ReviewRunRecord | null): run is ReviewRunRecord => run !== null && run.outcome === null;

/** The marks a run's checkpoints lay on a line. A fix wears its mark only while the line reads
 *  the corrected text (applied) or the original (undone): a line that reads neither has been
 *  changed since, and the fix no longer describes it. */
function markLine(line: ReviewLine, fix: ResolvedFix | undefined, suggestion: ResolvedSuggestion | undefined, draft: ResolvedDraft | undefined): ReviewLine {
  const wearsFix = fix && (line.text === fix.corrected || line.text === fix.original);
  return {
    ...line,
    fix: wearsFix ? { original: fix.original, corrected: fix.corrected, applied: line.text === fix.corrected } : null,
    suggestion: suggestion ? { kind: suggestion.kind, reason: suggestion.reason } : null,
    draft: draft ? { mustHave: draft.mustHave, quote: draft.quote, flags: draft.flags, vague: draft.vague ?? [] } : null,
  };
}

function lineMarks(run: ReviewRunRecord | null) {
  const fixes = new Map<string, ResolvedFix>();
  const suggestions = new Map<string, ResolvedSuggestion>();
  const drafts = new Map<string, ResolvedDraft>();
  for (const unit of run?.units ?? []) {
    for (const fix of unit.result?.fixes ?? []) fixes.set(fix.line, fix);
    for (const s of unit.result?.suggestions ?? []) suggestions.set(s.line, s);
    for (const d of unit.result?.drafts ?? []) drafts.set(d.line, d);
  }
  return { fixes, suggestions, drafts };
}

/** #342: the stamp — decided when the answer landed (cvReviewRun.ts resolveDrafts), by the model's
 *  own account of which lines show which must-have. A job in no family is never complete (nor told
 *  why); a result stored before #342 has no stamp. */
const isComplete = (result: ReviewUnitResult): boolean => !!result.family && result.complete === true;

export async function buildReviewState(deps: ReviewDeps, session: SessionRecord): Promise<ReviewState> {
  const [paper, run] = await Promise.all([readPaper(deps, session.id), deps.reviews.get(session.id)]);
  // A run left going by a process that restarted mid-way resumes here, on the first read that
  // finds it — spending only on the units with no answer yet.
  if (running(run)) deps.runner?.ensure(session.id);
  const { fixes, suggestions, drafts } = lineMarks(run);
  const mark = (line: ReviewLine) => markLine(line, fixes.get(line.id), suggestions.get(line.id), drafts.get(line.id));
  const results = new Map(run?.units.flatMap((u) => (u.result ? [[u.unit, u.result] as const] : [])) ?? []);
  const landed = new Set(results.keys());
  const conflict = session.importProof?.conflict ?? null;
  const minutesLeft = (startedAt: string) =>
    Math.max(1, Math.ceil(EXPECTED_RUN_MINUTES - ((deps.now?.() ?? Date.now()) - Date.parse(startedAt)) / 60_000));
  return {
    completed: session.reviewCompletedAt !== null,
    letterhead: paper.letterhead,
    conflict: conflict ? { fieldId: conflict.fieldId, question: conflict.label, values: conflict.values } : null,
    progress: running(run)
      ? { done: landed.size, total: run.units.length, minutesLeft: minutesLeft(run.startedAt) }
      : null,
    sections: paper.sections.map((section) =>
      "jobs" in section
        ? {
            ...section,
            jobs: section.jobs.map((job) => {
              const result = results.get(job.id);
              return {
                ...job,
                checking: running(run) && run.units.some((u) => u.unit === job.id) && !landed.has(job.id),
                family: result?.family ?? null,
                complete: result ? isComplete(result) : false,
                lines: job.lines.map(mark),
              };
            }),
          }
        : { ...section, lines: section.lines.map(mark) },
    ),
  };
}

export type CompleteReviewResult = { ok: true } | { ok: false; code: "review_running"; message: string };

/** The person reached the end and confirmed. Every line still pending becomes theirs — the review
 *  IS the look at each line the old confirm deck asked for — in the state it is in (a kept line
 *  stays kept, so it still does not print). Two exceptions. An open conflict: "Not sure" stored
 *  nothing, so the two readings stay pending and neither prints until the person picks — the
 *  machine never turns a reading the person left open into a printed line. And a drafted line the
 *  person has not ticked (#342): it stays a proposal, on the paper for whenever they come back, and
 *  nobody vouches for it here — only their tick does (ADR-0016 clause 6: undecided drafts do not
 *  block completion; they simply do not print). Then the one fact the jobs gate reads.
 *
 *  Refused while the review run is still going (#341, layout decision on #338): a fix landing after
 *  the confirm would change a line the person already signed off without their having seen it. The
 *  screen keeps the confirm locked for the same reason; this is the gate behind the lock. */
export async function completeReview(deps: ReviewDeps, session: Pick<SessionRecord, "id" | "importProof">): Promise<CompleteReviewResult> {
  if (running(await deps.reviews.get(session.id)))
    return { ok: false, code: "review_running", message: "Your jobs open when the check is finished." };
  const openConflict = session.importProof?.conflict?.fieldId ?? null;
  for (const c of await deps.claims.list(session.id)) {
    if (c.decision !== "pending" || c.lineState === "drafted" || (openConflict !== null && c.field_key === openConflict)) continue;
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
