// #338 — "Your CV, reviewed" (ADR-0016 clauses 2, 5 and 6): the CV as read, on paper, before any
// jobs. This module assembles the screen and owns its three writes; routes/review.ts is the thin
// entry. The AI's part of the review (fixes, suggestions, drafted lines) arrives with #341/#342 and
// lands on this same payload — what this ticket builds is the state the person sees when the AI
// review has not run or has failed: every line as read, ticked, and the questions reading the CV
// itself raises (a missing end date, an import conflict).
//
// Three stores meet here, none of them new: the lines are the claims (ticked/kept is #335's line
// state on the claim), the jobs' dates are the job-block records (#162), the letterhead is the
// contact store's as-read header plus phone/email (#190/#310). The review adds ONE fact of its own,
// `reviewCompletedAt` on the session, and that is what the jobs gate reads.
import type { ClaimRecord, ClaimStore, LineState } from "./claims.js";
import type { ContactStore, ContactValue } from "./contact.js";
import type { EligibilityStore } from "./eligibility.js";
import { kindTag } from "./graph.js";
import type { JobBlockStore, JobBlockView } from "./jobBlockStore.js";
import { SECTIONS } from "./rootcv.js";
import type { SessionRecord, SessionStore } from "./sessions.js";
import { answerJobDateHole, dateHoleQuestions, JOB_DATE_ITEM_PREFIX, type JobDateAnswerResult } from "./yearsWorked.js";
import type { MinedDate, MinedEndValue } from "@jobcrush/contracts";

export interface ReviewLine {
  id: string;
  text: string;
  state: LineState;
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
  lines: ReviewLine[];
}
export type ReviewSection =
  | { tag: "experience"; heading: string; jobs: ReviewJob[] }
  | { tag: string; heading: string; lines: ReviewLine[] };
export interface ReviewLetterheadField {
  value: string;
  origin: ContactValue["origin"];
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
  /** The paper, in the master CV's own print order (rootcv.ts's SECTIONS). */
  sections: ReviewSection[];
}

export interface ReviewDeps {
  claims: ClaimStore;
  sessions: Pick<SessionStore, "completeReview" | "resolveImport">;
  jobBlocks: JobBlockStore;
  eligibility: EligibilityStore;
  contact: Pick<ContactStore, "get" | "getRecord">;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateText = (d: MinedDate): string =>
  d.precision === "month" && d.month !== null ? `${MONTHS[d.month - 1]} ${d.year}` : String(d.year);
const endText = (end: MinedEndValue): string | null =>
  end.state === "ongoing" ? "now" : end.state === "ended" ? dateText(end.date) : null;

/** The lines a person can see on the paper: everything read or said, minus what they rejected or
 *  answered "no" to — the same cut the profile makes. In CV order (seq). */
const onPaper = (c: ClaimRecord) => c.decision === "pending" || c.decision === "confirmed";
const toLine = (c: ClaimRecord): ReviewLine => ({ id: c.id, text: c.text, state: c.lineState });

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

function jobsOf(experience: ClaimRecord[], blocks: readonly JobBlockView[]): ReviewJob[] {
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
    lines,
  });
  const taken = new Set<string>();
  const jobs: ReviewJob[] = [];
  for (const [role, lines] of byRole) {
    const block = matchBlock(role, blocks, taken);
    if (block) {
      taken.add(block.id);
      jobs.push(datedJob(block, lines.map(toLine)));
      continue;
    }
    // "Title - Employer" is how the miner writes the heading.
    const [title = role, employer = ""] = role.split(/\s+[-–—]\s+/, 2);
    jobs.push({ id: role, blockId: null, title, employer, dates: null, endDateQuestion: null, lines: lines.map(toLine) });
  }
  // A dated job the lines did not name is still on the paper, with its own date question when its
  // end is unknown: the hole is on the record, not on the lines, and the review is the one place it
  // is asked now. It stays after the answer, so the paper does not lose a job the person just dated.
  for (const block of blocks) {
    if (block.countsTowardExperience && !taken.has(block.id)) jobs.push(datedJob(block, []));
  }
  return jobs;
}

export async function buildReviewState(deps: ReviewDeps, session: SessionRecord): Promise<ReviewState> {
  const [claims, blocks, header, record] = await Promise.all([
    deps.claims.list(session.id),
    deps.jobBlocks.list(session.id),
    deps.contact.get(session.id, "header"),
    deps.contact.getRecord(session.id),
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
  const conflict = session.importProof?.conflict ?? null;
  return {
    completed: session.reviewCompletedAt !== null,
    letterhead: { header: header?.value ?? null, phone: field(record.phone), email: field(record.email) },
    conflict: conflict ? { fieldId: conflict.fieldId, question: conflict.label, values: conflict.values } : null,
    sections: SECTIONS.map(([tag, heading]) =>
      tag === "experience"
        ? { tag, heading, jobs: jobsOf(byTag.get(tag) ?? [], blocks) }
        : { tag, heading, lines: (byTag.get(tag) ?? []).map(toLine) },
    ),
  };
}

/** The person reached the end and confirmed. Every line still pending becomes theirs — the review
 *  IS the look at each line the old confirm deck asked for — in the state it is in (a kept line
 *  stays kept, so it still does not print). The one exception is an open conflict: "Not sure" stored
 *  nothing, so the two readings stay pending and neither prints until the person picks — the
 *  machine never turns a reading the person left open into a printed line. Then the one fact the
 *  jobs gate reads. */
export async function completeReview(deps: ReviewDeps, session: Pick<SessionRecord, "id" | "importProof">): Promise<void> {
  const openConflict = session.importProof?.conflict?.fieldId ?? null;
  for (const c of await deps.claims.list(session.id)) {
    if (c.decision !== "pending" || (openConflict !== null && c.field_key === openConflict)) continue;
    await deps.claims.confirm(session.id, c.id);
  }
  await deps.sessions.completeReview(session.id);
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
