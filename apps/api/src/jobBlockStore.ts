// #161 job-block store — durable, correctable work-history records. Two drivers (same convention as
// claims.ts): in-memory (dev/tests) and Postgres (JC-6, `DATABASE_URL` set).
//
// Shape decided by the owner 2026-08-11 (issue #161, comment 4): the RICH record, built plainly.
// One record per atomic machine decision (employer, title, start, end, kind) — never one per
// quoted line. `needs_grill`/`grill_hint` never appear here (computed per application, at render
// time — ADR-0005, ADR-0007). The model's raw output + a schema version are persisted beside the
// parsed blocks so the shape can evolve by VERSIONING, never by re-parsing (which could destroy a
// person's earlier corrections).
//
// Review round 1 fixes (2026-08-11): every mining run gets its OWN row (never overwritten by a
// re-upload, so a surviving block's raw backing is never lost); a run is only ever recorded AFTER
// its blocks have landed, atomically, so a crash mid-ingest can never manufacture a false
// found-nothing/found-N read state; matching now requires employer+title+overlap for an automatic
// recognition, with employer+overlap-only surfaced as an ambiguous candidate list the person
// resolves explicitly; an id collision is a skip (never an overwrite) on BOTH drivers.
import type { Pool, PoolClient } from "pg";
import type {
  DecisionKey,
  DecisionView,
  DeckSummary,
  FamilyPlacement,
  JobBlockView,
  Kind,
  MatchState,
  MinedJobBlock,
  ReadStatus,
} from "@jobcrush/contracts";
import { countsTowardExperience, FamilyPlacement as FamilyPlacementContract } from "@jobcrush/contracts";
import { getPool } from "./db.js";

// #163: the view shapes moved to @jobcrush/contracts (jobBlockView.ts) so the web client stops
// hand-mirroring them; re-exported here so existing importers keep working unchanged.
export type { DecisionKey, DecisionOrigin, DecisionView, DeckSummary, JobBlockView, MatchState, ReadStatus } from "@jobcrush/contracts";

export type MatchResolution = { type: "same"; matchedBlockId: string } | { type: "different" };

/** The five decisions the MINER produces. `family` (#221) is the sixth fact on the view but is not
 *  one of these — nothing in the CV states it, so it is worked out afterwards and stored beside the
 *  mined block rather than inside it. */
type MinedKey = Exclude<DecisionKey, "family">;

interface StoredBlock {
  block: MinedJobBlock;
  corrections: Partial<Record<DecisionKey, unknown>>; // superseded-by-value marker; presence flips origin
  /** #221 — the labeler's answer for this block. null = not labeled yet (never run, or its call
   *  failed), which reads as unmapped. A correction lives in `corrections.family` and supersedes
   *  this without erasing it, so a re-run of the labeler can never overwrite a person's pick. */
  placement: FamilyPlacement | null;
  confirmed: boolean;
  matchState: MatchState;
  candidateBlockIds: string[];
  seq: number;
}

interface RunRecord {
  status: "ok" | "failed";
  rawOutput: string | null;
  schemaVersion: string | null;
  blocksFound: number | null;
  ranAt: string;
}

export interface JobBlockStore {
  init(): Promise<void>;
  /** Ingests a mining run: matches each incoming block against what's already stored for this
   *  session (employer + title + overlapping period = automatic recognition, never duplicated;
   *  employer + overlap with a DIFFERENT title is recorded ambiguous — a candidate list the person
   *  must resolve, never guessed). An incoming block whose id collides with an already-stored id is
   *  skipped outright (never overwrites — same on both drivers). Atomic: the run is only ever
   *  recorded as having landed AFTER its blocks are durably stored. */
  ingest(sessionId: string, doc: { blocks: MinedJobBlock[]; schemaVersion: string }, rawOutput: string): Promise<void>;
  /** The miner failed validation twice (an unreadable history) — records a run that RAN and
   *  FAILED, distinct from both "never run" and "ran, found none". Never throws into the caller;
   *  the rest of onboarding proceeds regardless. */
  recordFailedRun(sessionId: string): Promise<void>;
  list(sessionId: string): Promise<JobBlockView[]>;
  summary(sessionId: string): Promise<DeckSummary>;
  /** Returns false when blockId is unknown for this session — callers surface that as 404, never a
   *  silently-swallowed ok:true. */
  confirm(sessionId: string, blockId: string): Promise<boolean>;
  /** #157 Design A — "no action in this flow is irreversible without a visible undo." The reverse
   *  of confirm(): sets confirmed back to false. Returns false when blockId is unknown. */
  unconfirm(sessionId: string, blockId: string): Promise<boolean>;
  /** A person's correction to one decision — origin becomes "corrected", pointing at what it
   *  superseded (ADR-0004 clause 1a). machine_touch/classification are AI-only judgements and are
   *  cleared, never fabricated for a person-supplied value. Returns false when blockId is unknown. */
  correct(sessionId: string, blockId: string, key: DecisionKey, value: unknown): Promise<boolean>;
  /** #221 — records the labeler's family placement for one block. Writes ONLY the machine's answer:
   *  a correction sitting in `corrections.family` keeps winning at the view, so re-labeling can
   *  never overwrite what a person told us. Returns false when blockId is unknown. */
  label(sessionId: string, blockId: string, placement: FamilyPlacement): Promise<boolean>;
  /** ADR-0004 clause 7 — detaches, never deletes; the block's sentences (claims) are untouched.
   *  Returns false when blockId is unknown. */
  detach(sessionId: string, blockId: string): Promise<boolean>;
  /** The person's answer to an ambiguous match: "same job as X" (the ambiguous row is retired, the
   *  target absorbs recognition and keeps every confirmation/correction it already carried) or
   *  "different job" (the ambiguous row stands alone as its own recognised job). Returns false when
   *  blockId is unknown, or (for "same") when matchedBlockId isn't one of the offered candidates. */
  resolveMatch(sessionId: string, blockId: string, resolution: MatchResolution): Promise<boolean>;
}

const overlaps = (a: MinedJobBlock, b: MinedJobBlock): boolean => {
  const startYear = (blk: MinedJobBlock) => blk.start.value.year;
  const endYear = (blk: MinedJobBlock) =>
    blk.end.value.state === "ended" ? blk.end.value.date.year : Number.POSITIVE_INFINITY;
  return startYear(a) <= endYear(b) && startYear(b) <= endYear(a);
};

const sameEmployer = (a: MinedJobBlock, b: MinedJobBlock): boolean =>
  a.employer.value.trim().toLowerCase() === b.employer.value.trim().toLowerCase();

const sameTitle = (a: MinedJobBlock, b: MinedJobBlock): boolean =>
  a.title.value.trim().toLowerCase() === b.title.value.trim().toLowerCase();

type MatchVerdict =
  | { kind: "recognized" }
  | { kind: "new" }
  | { kind: "ambiguous"; candidateBlockIds: string[] };

/** Shared by both drivers so "pick one behaviour, implement in both" can't silently drift apart
 *  again. `priorBlocks` must be a snapshot taken BEFORE the current ingest's own inserts — two
 *  blocks freshly mined in the SAME run (e.g. a promotion's two rows) must never match each other. */
function classifyIncoming(
  priorBlocks: Array<{ id: string; block: MinedJobBlock }>,
  incoming: MinedJobBlock,
): MatchVerdict {
  const sameEmployerOverlap = priorBlocks.filter((p) => sameEmployer(p.block, incoming) && overlaps(p.block, incoming));
  const exact = sameEmployerOverlap.filter((p) => sameTitle(p.block, incoming));
  if (exact.length >= 1) return { kind: "recognized" };
  if (sameEmployerOverlap.length > 0) {
    return { kind: "ambiguous", candidateBlockIds: sameEmployerOverlap.map((p) => p.id) };
  }
  return { kind: "new" };
}

// The per-key value cast is sound: a mined value is contract-validated, and a corrected value is
// validated against the same per-key shape at the correction door (routes/jobBlocks.ts CorrectBody).
function decisionView<T>(blockId: string, key: MinedKey, raw: MinedJobBlock[MinedKey], stored: StoredBlock): DecisionView<T> {
  const corrected = key in stored.corrections;
  return {
    id: `${blockId}:${key}`,
    value: (corrected ? stored.corrections[key] : raw.value) as T,
    origin: corrected
      ? { kind: "corrected", supersededValue: raw.value }
      : { kind: "read", source_quote: (raw as { source_quote: string | null }).source_quote ?? "" },
    machine_touch: corrected ? null : raw.machine_touch,
    classification: corrected ? null : raw.classification,
  };
}

/** #231 — a stored placement the CURRENT contract accepts, or null. One written under an earlier
 *  version reads as NOT PLACED, so the labeler simply places it again — the already-handled "never
 *  run yet" path — and a stale row self-heals instead of reaching a screen that expects a shape it
 *  does not have. Chosen over a migration deliberately: v1 placements only ever existed on staging
 *  (#221 shipped the same day #231 changed it), and a migration would be more code than the thing
 *  it protects.
 *
 *  Parsed, not cast: this is a read out of jsonb, which is a trust boundary like any other, and the
 *  contract is the only thing that actually knows what a valid placement is. A row that is stamped
 *  v2 but malformed is refused here rather than asserted onto the client. */
function placementIfCurrentVersion(placement: unknown): FamilyPlacement | null {
  return FamilyPlacementContract.safeParse(placement).data ?? null;
}

/** #221 — the sixth fact's own view. Not decisionView's shape: there is no source quote to fall back
 *  on (nothing in a CV states a job family) and machine_touch/classification are judgements about
 *  QUOTED text, so both stay null here rather than being invented for a decision that quotes nothing. */
function familyView(blockId: string, stored: StoredBlock): DecisionView<FamilyPlacement | null> {
  // A stale CORRECTION reads as no correction at all, rather than as a corrected null: the block is
  // simply unplaced again and the machine re-places it. Say the cost plainly — a #221-era
  // correction is DISCARDED, and #231 removed the screen that would have asked again, so nothing
  // invites the person to restate it. Accepted because such rows only ever existed on staging
  // (#221 shipped the same day this changed); it would not be acceptable against real visitors.
  const correction = placementIfCurrentVersion(stored.corrections.family);
  const placement = placementIfCurrentVersion(stored.placement);
  return {
    id: `${blockId}:family`,
    value: correction ?? placement,
    origin: correction ? { kind: "corrected", supersededValue: placement } : { kind: "worked_out" },
    machine_touch: null,
    classification: null,
  };
}

function toView(id: string, stored: StoredBlock): JobBlockView {
  const b = stored.block;
  const kindValue = (stored.corrections.kind ?? b.kind.value) as Kind;
  return {
    id,
    kind: kindValue,
    countsTowardExperience: countsTowardExperience(kindValue),
    employer: decisionView(id, "employer", b.employer, stored),
    title: decisionView(id, "title", b.title, stored),
    start: decisionView(id, "start", b.start, stored),
    end: decisionView(id, "end", b.end, stored),
    kindDecision: decisionView(id, "kind", b.kind, stored),
    family: familyView(id, stored),
    confirmed: stored.confirmed,
    matchState: stored.matchState,
    candidateBlockIds: stored.candidateBlockIds,
  };
}

export class InMemoryJobBlockStore implements JobBlockStore {
  private blocksBySession = new Map<string, Map<string, StoredBlock>>();
  private runsBySession = new Map<string, RunRecord[]>();
  private seqCounters = new Map<string, number>();

  async init(): Promise<void> {}

  private forSession(sessionId: string): Map<string, StoredBlock> {
    let m = this.blocksBySession.get(sessionId);
    if (!m) {
      m = new Map();
      this.blocksBySession.set(sessionId, m);
    }
    return m;
  }

  private nextSeq(sessionId: string): number {
    const n = (this.seqCounters.get(sessionId) ?? 0) + 1;
    this.seqCounters.set(sessionId, n);
    return n;
  }

  async ingest(
    sessionId: string,
    doc: { blocks: MinedJobBlock[]; schemaVersion: string },
    rawOutput: string,
  ): Promise<void> {
    const existing = this.forSession(sessionId);
    // Snapshot before the loop: matching only ever looks at blocks that existed BEFORE this ingest
    // call, so two distinct blocks freshly mined in the SAME run never match each other — only a
    // later re-upload's re-mined blocks match against what is already stored.
    const priorBlocks = [...existing.entries()].map(([id, row]) => ({ id, block: row.block }));
    for (const incoming of doc.blocks) {
      if (existing.has(incoming.id)) continue; // id collision — never overwrite (matches Pg's ON CONFLICT DO NOTHING)
      const verdict = classifyIncoming(priorBlocks, incoming);
      if (verdict.kind === "recognized") continue; // recognised — no duplicate, no clobber
      existing.set(incoming.id, {
        block: incoming,
        corrections: {},
        placement: null, // #221: labeled by its own pipeline step, after mining
        confirmed: false,
        matchState: verdict.kind === "ambiguous" ? "ambiguous" : "new",
        candidateBlockIds: verdict.kind === "ambiguous" ? verdict.candidateBlockIds : [],
        seq: this.nextSeq(sessionId),
      });
    }
    // Recorded LAST, after every block from this run has landed: a run is never visible as "ran"
    // until its blocks actually are (mirrors the Pg driver's transaction boundary).
    const runs = this.runsBySession.get(sessionId) ?? [];
    runs.push({
      status: "ok",
      rawOutput,
      schemaVersion: doc.schemaVersion,
      blocksFound: doc.blocks.length,
      ranAt: new Date().toISOString(),
    });
    this.runsBySession.set(sessionId, runs);
  }

  async recordFailedRun(sessionId: string): Promise<void> {
    const runs = this.runsBySession.get(sessionId) ?? [];
    runs.push({ status: "failed", rawOutput: null, schemaVersion: null, blocksFound: null, ranAt: new Date().toISOString() });
    this.runsBySession.set(sessionId, runs);
  }

  async list(sessionId: string): Promise<JobBlockView[]> {
    return [...this.forSession(sessionId).entries()]
      .sort((a, b) => a[1].seq - b[1].seq)
      .map(([id, row]) => toView(id, row));
  }

  async summary(sessionId: string): Promise<DeckSummary> {
    const blocks = [...this.forSession(sessionId).values()];
    const runs = this.runsBySession.get(sessionId) ?? [];
    const latest = runs[runs.length - 1];
    const read: ReadStatus = !latest
      ? { status: "not_run" }
      : latest.status === "failed"
        ? { status: "failed" }
        : { status: "ok", blocksFound: latest.blocksFound ?? 0 };
    return {
      totalBlocks: blocks.length,
      confirmedBlocks: blocks.filter((b) => b.confirmed).length,
      read,
    };
  }

  async confirm(sessionId: string, blockId: string): Promise<boolean> {
    const row = this.forSession(sessionId).get(blockId);
    if (!row) return false;
    row.confirmed = true;
    return true;
  }

  async unconfirm(sessionId: string, blockId: string): Promise<boolean> {
    const row = this.forSession(sessionId).get(blockId);
    if (!row) return false;
    row.confirmed = false;
    return true;
  }

  async correct(sessionId: string, blockId: string, key: DecisionKey, value: unknown): Promise<boolean> {
    const row = this.forSession(sessionId).get(blockId);
    if (!row) return false;
    row.corrections[key] = value;
    return true;
  }

  async label(sessionId: string, blockId: string, placement: FamilyPlacement): Promise<boolean> {
    const row = this.forSession(sessionId).get(blockId);
    if (!row) return false;
    row.placement = placement;
    return true;
  }

  async detach(sessionId: string, blockId: string): Promise<boolean> {
    return this.forSession(sessionId).delete(blockId);
  }

  async resolveMatch(sessionId: string, blockId: string, resolution: MatchResolution): Promise<boolean> {
    const m = this.forSession(sessionId);
    const row = m.get(blockId);
    if (!row) return false;
    if (resolution.type === "different") {
      row.matchState = "new";
      row.candidateBlockIds = [];
      return true;
    }
    if (!row.candidateBlockIds.includes(resolution.matchedBlockId)) return false;
    const target = m.get(resolution.matchedBlockId);
    if (!target) return false;
    target.matchState = "matched";
    target.candidateBlockIds = [];
    m.delete(blockId); // the ambiguous row WAS this job — never duplicated; target's own
    // corrections/confirmation are untouched.
    return true;
  }
}

const JOB_BLOCKS_TABLE = `
CREATE TABLE IF NOT EXISTS job_blocks (
  seq            bigserial,
  session_id     text NOT NULL,
  block_id       text NOT NULL,
  block          jsonb NOT NULL,
  corrections    jsonb NOT NULL DEFAULT '{}',
  confirmed      boolean NOT NULL DEFAULT false,
  match_state    text NOT NULL,
  candidate_block_ids jsonb NOT NULL DEFAULT '[]',
  placement      jsonb,
  PRIMARY KEY (session_id, block_id)
)`;

// #221 — for databases created before the labeler existed. Same idiom as claims.ts/sessions.ts.
const JOB_BLOCKS_ALTERS = ["ALTER TABLE job_blocks ADD COLUMN IF NOT EXISTS placement jsonb"];

// One row PER RUN (never upserted/overwritten) — a re-upload's raw output must never erase an
// earlier run's, because blocks that earlier run produced can still be sitting in job_blocks.
const JOB_BLOCK_RUNS_TABLE = `
CREATE TABLE IF NOT EXISTS job_block_runs (
  id             bigserial PRIMARY KEY,
  session_id     text NOT NULL,
  status         text NOT NULL,
  raw_output     text,
  schema_version text,
  blocks_found   integer,
  ran_at         timestamptz NOT NULL
)`;

function rowToStored(r: Record<string, unknown>): StoredBlock {
  return {
    block: r.block as MinedJobBlock,
    corrections: (r.corrections as Partial<Record<DecisionKey, unknown>>) ?? {},
    placement: (r.placement as FamilyPlacement | null) ?? null,
    confirmed: r.confirmed as boolean,
    matchState: r.match_state as MatchState,
    candidateBlockIds: (r.candidate_block_ids as string[] | null) ?? [],
    seq: Number(r.seq),
  };
}

export class PgJobBlockStore implements JobBlockStore {
  constructor(private pool: Pool) {}

  async init(): Promise<void> {
    await this.pool.query(JOB_BLOCKS_TABLE);
    for (const alter of JOB_BLOCKS_ALTERS) await this.pool.query(alter);
    await this.pool.query(JOB_BLOCK_RUNS_TABLE);
  }

  async ingest(
    sessionId: string,
    doc: { blocks: MinedJobBlock[]; schemaVersion: string },
    rawOutput: string,
  ): Promise<void> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(`SELECT block_id, block FROM job_blocks WHERE session_id = $1`, [sessionId]);
      const priorBlocks = rows.map((r) => ({ id: r.block_id as string, block: r.block as MinedJobBlock }));
      const existingIds = new Set(priorBlocks.map((p) => p.id));

      for (const incoming of doc.blocks) {
        if (existingIds.has(incoming.id)) continue; // id collision — never overwrite
        const verdict = classifyIncoming(priorBlocks, incoming);
        if (verdict.kind === "recognized") continue; // recognised — no duplicate, no clobber
        const matchState: MatchState = verdict.kind === "ambiguous" ? "ambiguous" : "new";
        const candidateIds = verdict.kind === "ambiguous" ? verdict.candidateBlockIds : [];
        await client.query(
          `INSERT INTO job_blocks (session_id, block_id, block, corrections, confirmed, match_state, candidate_block_ids)
           VALUES ($1, $2, $3, '{}', false, $4, $5)
           ON CONFLICT (session_id, block_id) DO NOTHING`,
          [sessionId, incoming.id, JSON.stringify(incoming), matchState, JSON.stringify(candidateIds)],
        );
        // Deliberately NOT added to priorBlocks: blocks freshly mined in this same run never match
        // each other (a promotion's two rows must both land, not collapse).
      }

      // Recorded LAST, in the SAME transaction: a crash between the block inserts and this line
      // rolls the whole run back, so "ran" can never be observed with zero of its blocks landed.
      await client.query(
        `INSERT INTO job_block_runs (session_id, status, raw_output, schema_version, blocks_found, ran_at)
         VALUES ($1, 'ok', $2, $3, $4, now())`,
        [sessionId, rawOutput, doc.schemaVersion, doc.blocks.length],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async recordFailedRun(sessionId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO job_block_runs (session_id, status, raw_output, schema_version, blocks_found, ran_at)
       VALUES ($1, 'failed', NULL, NULL, NULL, now())`,
      [sessionId],
    );
  }

  async list(sessionId: string): Promise<JobBlockView[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM job_blocks WHERE session_id = $1 ORDER BY seq`,
      [sessionId],
    );
    return rows.map((r) => toView(r.block_id as string, rowToStored(r)));
  }

  async summary(sessionId: string): Promise<DeckSummary> {
    const { rows: blockRows } = await this.pool.query(
      `SELECT confirmed FROM job_blocks WHERE session_id = $1`,
      [sessionId],
    );
    const { rows: runRows } = await this.pool.query(
      `SELECT status, blocks_found FROM job_block_runs WHERE session_id = $1 ORDER BY id DESC LIMIT 1`,
      [sessionId],
    );
    const latest = runRows[0];
    const read: ReadStatus = !latest
      ? { status: "not_run" }
      : latest.status === "failed"
        ? { status: "failed" }
        : { status: "ok", blocksFound: Number(latest.blocks_found ?? 0) };
    return {
      totalBlocks: blockRows.length,
      confirmedBlocks: blockRows.filter((r) => r.confirmed).length,
      read,
    };
  }

  async confirm(sessionId: string, blockId: string): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE job_blocks SET confirmed = true WHERE session_id = $1 AND block_id = $2`,
      [sessionId, blockId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async unconfirm(sessionId: string, blockId: string): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE job_blocks SET confirmed = false WHERE session_id = $1 AND block_id = $2`,
      [sessionId, blockId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async correct(sessionId: string, blockId: string, key: DecisionKey, value: unknown): Promise<boolean> {
    // Read-modify-write rather than a jsonb_build_object/|| merge in SQL: pg-mem (the in-process
    // Postgres the golden tests run against) implements very few native functions, and this path
    // isn't hot enough to need a single round trip.
    const { rows } = await this.pool.query(
      `SELECT corrections FROM job_blocks WHERE session_id = $1 AND block_id = $2`,
      [sessionId, blockId],
    );
    if (rows.length === 0) return false;
    const merged = { ...(rows[0].corrections as Record<string, unknown>), [key]: value };
    await this.pool.query(
      `UPDATE job_blocks SET corrections = $3 WHERE session_id = $1 AND block_id = $2`,
      [sessionId, blockId, JSON.stringify(merged)],
    );
    return true;
  }

  async label(sessionId: string, blockId: string, placement: FamilyPlacement): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE job_blocks SET placement = $3 WHERE session_id = $1 AND block_id = $2`,
      [sessionId, blockId, JSON.stringify(placement)],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async detach(sessionId: string, blockId: string): Promise<boolean> {
    const res = await this.pool.query(`DELETE FROM job_blocks WHERE session_id = $1 AND block_id = $2`, [sessionId, blockId]);
    return (res.rowCount ?? 0) > 0;
  }

  async resolveMatch(sessionId: string, blockId: string, resolution: MatchResolution): Promise<boolean> {
    if (resolution.type === "different") {
      const res = await this.pool.query(
        `UPDATE job_blocks SET match_state = 'new', candidate_block_ids = '[]' WHERE session_id = $1 AND block_id = $2`,
        [sessionId, blockId],
      );
      return (res.rowCount ?? 0) > 0;
    }
    const { rows } = await this.pool.query(
      `SELECT candidate_block_ids FROM job_blocks WHERE session_id = $1 AND block_id = $2`,
      [sessionId, blockId],
    );
    if (rows.length === 0) return false;
    const candidates: string[] = rows[0].candidate_block_ids ?? [];
    if (!candidates.includes(resolution.matchedBlockId)) return false;
    const targetRes = await this.pool.query(
      `UPDATE job_blocks SET match_state = 'matched', candidate_block_ids = '[]' WHERE session_id = $1 AND block_id = $2`,
      [sessionId, resolution.matchedBlockId],
    );
    if ((targetRes.rowCount ?? 0) === 0) return false;
    await this.pool.query(`DELETE FROM job_blocks WHERE session_id = $1 AND block_id = $2`, [sessionId, blockId]);
    return true;
  }
}

/** Postgres when DATABASE_URL is set (JC-6), in-memory otherwise (dev/tests). */
export function jobBlockStoreFromEnv(databaseUrl?: string): JobBlockStore {
  return databaseUrl ? new PgJobBlockStore(getPool(databaseUrl)) : new InMemoryJobBlockStore();
}
