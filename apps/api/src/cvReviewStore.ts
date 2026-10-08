// #341 — the review run's checkpoint store (ADR-0016 clauses 2 and 7). One run per session, made
// of units: every job on the paper, with the letterhead and the non-job sections riding on the first
// one. Each unit keeps its own attempts count and, once the model has answered for it, its own
// validated answer — so a retry, or a run resumed after the process restarted mid-way, re-spends
// only the units with no answer yet, and a second request never re-calls the writer for a finished
// one. Same driver-split shape as tailorDraftStore.ts (InMemory + Pg + …FromEnv); session-keyed CV
// content, so both tables join purge.ts's sweep.
//
// The person's one piece of state about a fix — applied or undone — is NOT here: it is the line's
// own text (claims.ts setText). A fix is applied when the line reads `corrected`, undone when it
// reads `original`; a line that reads neither has moved on and wears no fix.
import type { Pool } from "pg";
import { getPool } from "./db.js";

export type ReviewRunOutcome = "done" | "failed";

/** A fix resolved against the line it names at the moment it landed: whole-line before and after,
 *  so undo can restore the exact original even when the model named only the misspelt words. */
export interface ResolvedFix {
  line: string;
  original: string;
  corrected: string;
}

/** The only reasons the review may suggest an untick: quality, never fit (ADR-0016 clause 3). */
export const SUGGESTION_KINDS = ["weak", "duplicate", "aim-without-result"] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

/** An untick suggestion resolved against a line that exists. */
export interface ResolvedSuggestion {
  line: string;
  kind: SuggestionKind;
  reason: string;
}

export const DRAFT_FLAGS = ["OPTIONAL", "INDUSTRY GUESS"] as const;
export type DraftFlag = (typeof DRAFT_FLAGS)[number];

/** #342: a drafted line as it landed, by the claim id it was stored under (claims.ts seedDrafted) —
 *  its source (the must-have it covers, in the family's own words, and/or the verbatim CV words it
 *  came from; never neither) and its flags. The wording itself is the claim's text, which the person
 *  may edit; the model's original stays in `answer`. */
export interface ResolvedDraft {
  line: string;
  mustHave: string | null;
  quote: string | null;
  flags: DraftFlag[];
  /** #343: the vague phrases in the line and the choices for each, CV-sourced first. Absent on a
   *  result stored before #343. */
  vague?: DraftVague[];
}

/** #343: a vague phrase in a drafted line, with the options the person can tap to replace it. */
export const VAGUE_SOURCES = ["CV", "TYPICAL"] as const;
export interface DraftVague {
  phrase: string;
  options: Array<{ text: string; from: (typeof VAGUE_SOURCES)[number]; quote: string | null }>;
}

export interface ReviewUnitResult {
  /** The model's validated answer for this unit (cvReviewRun.ts's ReviewAnswer), stored whole so a
   *  later ticket (word choices, #343) reads it from here, never re-generates. */
  answer: unknown;
  fixes: ResolvedFix[];
  suggestions: ResolvedSuggestion[];
  /** #342: the label of the family the job was drafted from; null for a job in no published family
   *  (which gets no drafts and no "complete" stamp). Absent on a result stored before #342. */
  family?: string | null;
  /** #342: every must-have of the job's family is shown by the job's own lines, by the model's own
   *  account (`mustHaves[].shownBy`) — the COMPLETE stamp. Absent on a result stored before #342. */
  complete?: boolean;
  /** #342: absent on a result stored before #342. */
  drafts?: ResolvedDraft[];
}

export interface ReviewUnit {
  unit: string;
  /** Attempts started — every one a paid call may have been made for. */
  attempts: number;
  /** #363: attempts the process saw fail. An attempt started and never failed was cut by a process
   *  stop mid-call (Fly's auto-stop), and does not count against the unit. */
  failures: number;
  result: ReviewUnitResult | null;
}

export interface ReviewRunRecord {
  startedAt: string;
  finishedAt: string | null;
  /** null while the run is going; `done` when every unit answered; `failed` when one ran out of
   *  attempts — the screen then shows that job's lines as read, and says nothing. */
  outcome: ReviewRunOutcome | null;
  units: ReviewUnit[];
}

export interface CvReviewStore {
  init(): Promise<void>;
  get(sessionId: string): Promise<ReviewRunRecord | null>;
  /** Opens a run with its units, no attempts spent. Replaces any earlier run for the session. */
  create(sessionId: string, startedAt: string, units: string[]): Promise<void>;
  recordAttempt(sessionId: string, unit: string): Promise<void>;
  recordFailure(sessionId: string, unit: string): Promise<void>;
  /** The checkpoint. Each unit's own row, so parallel units landing together never overwrite each
   *  other's answer. */
  recordResult(sessionId: string, unit: string, result: ReviewUnitResult): Promise<void>;
  finish(sessionId: string, outcome: ReviewRunOutcome, finishedAt: string): Promise<void>;
}

export class InMemoryCvReviewStore implements CvReviewStore {
  private runs = new Map<string, ReviewRunRecord>();

  async init(): Promise<void> {}

  async get(sessionId: string): Promise<ReviewRunRecord | null> {
    const run = this.runs.get(sessionId);
    return run ? structuredClone(run) : null;
  }

  async create(sessionId: string, startedAt: string, units: string[]): Promise<void> {
    this.runs.set(sessionId, {
      startedAt,
      finishedAt: null,
      outcome: null,
      units: units.map((unit) => ({ unit, attempts: 0, failures: 0, result: null })),
    });
  }

  private unit(sessionId: string, unit: string): ReviewUnit | undefined {
    return this.runs.get(sessionId)?.units.find((u) => u.unit === unit);
  }

  async recordAttempt(sessionId: string, unit: string): Promise<void> {
    const u = this.unit(sessionId, unit);
    if (u) u.attempts += 1;
  }

  async recordFailure(sessionId: string, unit: string): Promise<void> {
    const u = this.unit(sessionId, unit);
    if (u) u.failures += 1;
  }

  async recordResult(sessionId: string, unit: string, result: ReviewUnitResult): Promise<void> {
    const u = this.unit(sessionId, unit);
    if (u) u.result = structuredClone(result);
  }

  async finish(sessionId: string, outcome: ReviewRunOutcome, finishedAt: string): Promise<void> {
    const run = this.runs.get(sessionId);
    if (run) {
      run.outcome = outcome;
      run.finishedAt = finishedAt;
    }
  }
}

const CV_REVIEWS_TABLE = `
CREATE TABLE IF NOT EXISTS cv_reviews (
  session_id  text PRIMARY KEY,
  started_at  timestamptz NOT NULL,
  finished_at timestamptz,
  outcome     text
)`;
// One row per unit, keyed with the run: a parallel landing is one UPDATE of one row, never a
// read-modify-write of a shared jsonb blob.
const CV_REVIEW_UNITS_TABLE = `
CREATE TABLE IF NOT EXISTS cv_review_units (
  session_id text NOT NULL,
  unit       text NOT NULL,
  position   integer NOT NULL,
  attempts   integer NOT NULL DEFAULT 0,
  failures   integer NOT NULL DEFAULT 0,
  result     jsonb,
  PRIMARY KEY (session_id, unit)
)`;

/** #363: additive migration for a units table created before `failures` existed (auth.ts's idiom:
 *  idempotent, best-effort so it never blocks startup; the fresh CREATE TABLE already has the
 *  column). Exported for the test that runs it against the old shape — pg-mem cannot re-run the
 *  CREATE TABLE IF NOT EXISTS on an existing table, so the test cannot go through init(). */
export const CV_REVIEW_UNITS_MIGRATION = `ALTER TABLE cv_review_units ADD COLUMN IF NOT EXISTS failures integer NOT NULL DEFAULT 0`;

/** jsonb comes back as an object on real pg but as a string on pg-mem — parse defensively, same
 *  pattern as tailorDraftStore.ts. */
function parseJsonbColumn<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

export class PgCvReviewStore implements CvReviewStore {
  constructor(private pool: Pool) {}

  async init(): Promise<void> {
    await this.pool.query(CV_REVIEWS_TABLE);
    await this.pool.query(CV_REVIEW_UNITS_TABLE);
    await this.pool.query(CV_REVIEW_UNITS_MIGRATION).catch(() => {});
  }

  async get(sessionId: string): Promise<ReviewRunRecord | null> {
    const { rows } = await this.pool.query(
      `SELECT started_at, finished_at, outcome FROM cv_reviews WHERE session_id = $1`,
      [sessionId],
    );
    if (!rows[0]) return null;
    const units = await this.pool.query(
      `SELECT unit, attempts, failures, result FROM cv_review_units WHERE session_id = $1 ORDER BY position`,
      [sessionId],
    );
    return {
      startedAt: new Date(rows[0].started_at as string).toISOString(),
      finishedAt: rows[0].finished_at ? new Date(rows[0].finished_at as string).toISOString() : null,
      outcome: (rows[0].outcome as ReviewRunOutcome | null) ?? null,
      units: units.rows.map((r) => ({
        unit: r.unit as string,
        attempts: Number(r.attempts),
        failures: Number(r.failures),
        result: r.result == null ? null : parseJsonbColumn<ReviewUnitResult>(r.result),
      })),
    };
  }

  async create(sessionId: string, startedAt: string, units: string[]): Promise<void> {
    await this.pool.query(`DELETE FROM cv_review_units WHERE session_id = $1`, [sessionId]);
    await this.pool.query(
      `INSERT INTO cv_reviews (session_id, started_at, finished_at, outcome) VALUES ($1,$2,NULL,NULL)
       ON CONFLICT (session_id) DO UPDATE SET started_at = EXCLUDED.started_at, finished_at = NULL, outcome = NULL`,
      [sessionId, startedAt],
    );
    for (const [position, unit] of units.entries()) {
      await this.pool.query(
        `INSERT INTO cv_review_units (session_id, unit, position, attempts, result) VALUES ($1,$2,$3,0,NULL)`,
        [sessionId, unit, position],
      );
    }
  }

  async recordAttempt(sessionId: string, unit: string): Promise<void> {
    await this.pool.query(
      `UPDATE cv_review_units SET attempts = attempts + 1 WHERE session_id = $1 AND unit = $2`,
      [sessionId, unit],
    );
  }

  async recordFailure(sessionId: string, unit: string): Promise<void> {
    await this.pool.query(
      `UPDATE cv_review_units SET failures = failures + 1 WHERE session_id = $1 AND unit = $2`,
      [sessionId, unit],
    );
  }

  async recordResult(sessionId: string, unit: string, result: ReviewUnitResult): Promise<void> {
    await this.pool.query(
      `UPDATE cv_review_units SET result = $3 WHERE session_id = $1 AND unit = $2`,
      [sessionId, unit, JSON.stringify(result)],
    );
  }

  async finish(sessionId: string, outcome: ReviewRunOutcome, finishedAt: string): Promise<void> {
    await this.pool.query(
      `UPDATE cv_reviews SET outcome = $2, finished_at = $3 WHERE session_id = $1`,
      [sessionId, outcome, finishedAt],
    );
  }
}

/** Postgres when DATABASE_URL is set, in-memory otherwise — same convention as every other store. */
export function cvReviewStoreFromEnv(databaseUrl?: string): CvReviewStore {
  return databaseUrl ? new PgCvReviewStore(getPool(databaseUrl)) : new InMemoryCvReviewStore();
}
