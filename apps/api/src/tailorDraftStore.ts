// #310 — the tailored-draft checkpoint. One row per (session, advert): the CV brain's validated
// draft plus the fingerprint of the exact input it was built from, so a reload, a retry, or coming
// back after leaving never re-spends the model call (the spec's "pipeline stages checkpoint" rule),
// while a genuinely changed fact set — a different fingerprint — redrafts and overwrites. Same
// driver-split shape as judgementStore.ts (InMemory + Pg + …FromEnv); rows are session-keyed and
// join purge.ts's sweep of unclaimed anonymous sessions, because a draft is CV content.
import type { Pool } from "pg";
import type { ApplicationReport } from "./applicationReport.js";
import type { StretchCheckpoint } from "./stretchSuggestions.js";
import { Draft } from "./preview.js";
import { getPool } from "./db.js";

export interface TailorDraftRecord {
  draft: Draft;
  /** Plain-words notices when the draft shipped lossy after its retry — empty on a clean draft. */
  conservationNotices: string[];
  /** sha256 of the exact tailor input (prompt + claims + roles + card context + posting), so a
   *  changed fact set — or a prompt bump, which changes the input text itself — reads as a miss. */
  inputFingerprint: string;
  draftedAt: string; // ISO timestamp
  /** #313 — the approval record: when this person pressed Approve on THIS draft (the press that
   *  sends). null until pressed, and a redraft writes a fresh record, so approval never outlives
   *  the document it was given to. */
  approvedAt: string | null;
  /** #315 — the application report, checkpointed with the fingerprint of the exact input it was
   *  written from, so a re-press after a failed send re-spends nothing while a shortened document
   *  (#314) writes a fresh one. Absent until the press writes it; a redraft starts without one. */
  reportCheckpoint?: { fingerprint: string; report: ApplicationReport };
  /** #417 — the stretch suggestions beside this draft (ADR-0005 clause 2: beside, never a claim),
   *  checkpointed with the fingerprint of the exact input they were made from. Absent until the
   *  step runs; `failed` is a step that did not finish, told apart from "ran, found none". A
   *  redraft writes a fresh record, so answers to suggestions that no longer exist drop with it. */
  stretch?: StretchCheckpoint;
}

export interface TailorDraftStore {
  init(): Promise<void>;
  get(sessionId: string, adId: string): Promise<TailorDraftRecord | null>;
  /** Upsert — a redraft for the same (session, advert) replaces the prior record. */
  put(sessionId: string, adId: string, record: TailorDraftRecord): Promise<void>;
}

/** A stored row the CURRENT Draft schema rejects (e.g. after a schema bump) reads as a cache miss,
 *  never a throw — the caller then redrafts, which is exactly the remedy (judgementStore's rule). */
function revalidate(record: TailorDraftRecord): TailorDraftRecord | null {
  const parsed = Draft.safeParse(record.draft);
  return parsed.success ? { ...record, draft: parsed.data } : null;
}

export class InMemoryTailorDraftStore implements TailorDraftStore {
  private byKey = new Map<string, TailorDraftRecord>();
  private key = (sessionId: string, adId: string) => JSON.stringify([sessionId, adId]);

  async init(): Promise<void> {}

  async get(sessionId: string, adId: string): Promise<TailorDraftRecord | null> {
    const found = this.byKey.get(this.key(sessionId, adId));
    return found ? revalidate(structuredClone(found)) : null;
  }

  async put(sessionId: string, adId: string, record: TailorDraftRecord): Promise<void> {
    this.byKey.set(this.key(sessionId, adId), structuredClone(record));
  }
}

const TAILOR_DRAFTS_TABLE = `
CREATE TABLE IF NOT EXISTS tailor_drafts (
  session_id        text NOT NULL,
  ad_id             text NOT NULL,
  draft             jsonb NOT NULL,
  notices           jsonb NOT NULL,
  input_fingerprint text NOT NULL,
  drafted_at        timestamptz NOT NULL,
  approved_at       timestamptz,
  report            jsonb,
  stretch           jsonb,
  PRIMARY KEY (session_id, ad_id)
)`;

/** jsonb comes back as an object on real pg but as a string on pg-mem — parse defensively, same
 *  pattern as judgementStore.ts. */
function parseJsonbColumn<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

export class PgTailorDraftStore implements TailorDraftStore {
  constructor(private pool: Pool) {}

  async init(): Promise<void> {
    await this.pool.query(TAILOR_DRAFTS_TABLE);
    // #313 additive migration for tables created before the approval record. Idempotent;
    // best-effort so it never blocks startup (auth.ts's own pattern — the fresh CREATE TABLE
    // above already has the column).
    await this.pool
      .query(`ALTER TABLE tailor_drafts ADD COLUMN IF NOT EXISTS approved_at timestamptz`)
      .catch(() => {});
    // #315, the same shape: the checkpointed application report.
    await this.pool.query(`ALTER TABLE tailor_drafts ADD COLUMN IF NOT EXISTS report jsonb`).catch(() => {});
    // #417, the same shape: the stretch suggestions beside the draft.
    await this.pool.query(`ALTER TABLE tailor_drafts ADD COLUMN IF NOT EXISTS stretch jsonb`).catch(() => {});
  }

  async get(sessionId: string, adId: string): Promise<TailorDraftRecord | null> {
    const { rows } = await this.pool.query(
      `SELECT draft, notices, input_fingerprint, drafted_at, approved_at, report, stretch FROM tailor_drafts
       WHERE session_id = $1 AND ad_id = $2`,
      [sessionId, adId],
    );
    if (!rows[0]) return null;
    return revalidate({
      draft: parseJsonbColumn<Draft>(rows[0].draft),
      conservationNotices: parseJsonbColumn<string[]>(rows[0].notices),
      inputFingerprint: rows[0].input_fingerprint as string,
      draftedAt: new Date(rows[0].drafted_at as string).toISOString(),
      approvedAt: rows[0].approved_at ? new Date(rows[0].approved_at as string).toISOString() : null,
      ...(rows[0].report
        ? { reportCheckpoint: parseJsonbColumn<NonNullable<TailorDraftRecord["reportCheckpoint"]>>(rows[0].report) }
        : {}),
      ...(rows[0].stretch ? { stretch: parseJsonbColumn<StretchCheckpoint>(rows[0].stretch) } : {}),
    });
  }

  async put(sessionId: string, adId: string, record: TailorDraftRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO tailor_drafts (session_id, ad_id, draft, notices, input_fingerprint, drafted_at, approved_at, report, stretch)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (session_id, ad_id) DO UPDATE SET
         draft = EXCLUDED.draft, notices = EXCLUDED.notices,
         input_fingerprint = EXCLUDED.input_fingerprint, drafted_at = EXCLUDED.drafted_at,
         approved_at = EXCLUDED.approved_at, report = EXCLUDED.report, stretch = EXCLUDED.stretch`,
      [
        sessionId,
        adId,
        JSON.stringify(record.draft),
        JSON.stringify(record.conservationNotices),
        record.inputFingerprint,
        record.draftedAt,
        record.approvedAt,
        record.reportCheckpoint ? JSON.stringify(record.reportCheckpoint) : null,
        record.stretch ? JSON.stringify(record.stretch) : null,
      ],
    );
  }
}

/** Postgres when DATABASE_URL is set, in-memory otherwise — same convention as every other store. */
export function tailorDraftStoreFromEnv(databaseUrl?: string): TailorDraftStore {
  return databaseUrl ? new PgTailorDraftStore(getPool(databaseUrl)) : new InMemoryTailorDraftStore();
}
