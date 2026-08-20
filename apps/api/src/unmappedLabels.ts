// #252 (spec #251, part of #218) — the durable half of the vocabulary-growth feed.
//
// An unmapped placement is the closed vocabulary's gap surfacing (ADR-0014 decisions 1 + 5), and the
// growth process needs the WORDS, not just how many there were: a count says the list has holes,
// this says which holes, whose visit found them, and whether the hole was honest ("no family fits")
// or a labeler that could not answer its own contract twice.
//
// This replaces counters.ts's in-process ring buffer outright — one recording path, not two. That
// buffer's known limit was that a deploy erased it; this survives, on the same driver split every
// other store in the repo uses (in-memory for tests/dev, Postgres when DATABASE_URL is set).
//
// No deletion feature and no purge hook (owner decision 2026-08-20 — build none, file none).
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { getPool, iso } from "./db.js";
import { incrementCounter } from "./counters.js";

/** Which door the words came through — a target role the visitor typed, or a past job title read
 *  off their CV. The growth process treats them differently: one is what a person wants next, the
 *  other is what the labour market already contains. */
export type UnmappedLabelSource = "target_role" | "past_job";

export interface UnmappedLabelRecord {
  id: string;
  /** The person link — the session the placement was made for. Null only where no session owns the
   *  call (the eval harness placing a role with nobody behind it). */
  sessionId: string | null;
  source: UnmappedLabelSource;
  /** The words exactly as typed/read, bounded — the thing the vocabulary is missing a word for. */
  label: string;
  /** Why it went unmapped. This is what keeps an honest "no family fits" distinguishable from a
   *  labeler whose output failed validation twice, which is a fault, not a vocabulary gap. */
  reason: string;
  recordedAt: string; // ISO timestamp
  /** When a vocabulary-growth run consumed this entry. Null while it is still waiting. Marking is
   *  the only thing that ever leaves the waiting count — nothing is deleted (owner decision
   *  2026-08-20), so a harvested entry stays readable forever. */
  harvestedAt: string | null;
}

/** What the owner needs to decide whether a run is worth launching (#253 / spec #251 story 5):
 *  how many labels are waiting, and how many distinct roles they represent — three people hitting
 *  one gap is a different decision from one person retrying three times. */
export interface UnmappedLabelStats {
  unharvested: number;
  distinctRoles: number;
}

/** What a call site supplies: the store owns the id, the recording time and the harvest stamp. */
export type NewUnmappedLabel = Omit<UnmappedLabelRecord, "id" | "recordedAt" | "harvestedAt">;

export interface UnmappedLabelStore {
  init(): Promise<void>;
  record(entry: NewUnmappedLabel): Promise<void>;
  /** Newest first, bounded — this backs an ops screen, never an unbounded table dump.
   *  `unharvestedOnly` is what a vocabulary-growth run reads: answered gaps must not crowd the
   *  waiting ones out of the window, and nothing is ever deleted, so without the filter the newest
   *  200 fill up with already-researched words as runs accumulate (#253 AC3).
   *  ponytail: newest-200 only, no paging — #253 left it that way. Add paging when a run genuinely
   *  has more than 200 waiting labels and needs the tail. */
  recent(limit?: number, unharvestedOnly?: boolean): Promise<UnmappedLabelRecord[]>;
  /** Counts over the WAITING entries only — harvested ones are answered gaps, not pending work.
   *  Postgres counts the true total; the in-memory driver can only count what it still holds (see
   *  its own cap below), which is the dev/test ceiling, not production's number. */
  stats(): Promise<UnmappedLabelStats>;
  /** Stamps every waiting entry as harvested and returns how many were stamped. Repeating it is a
   *  no-op returning 0: already-stamped entries keep their first harvest time.
   *  ponytail: marks everything unharvested AT CALL TIME, not the exact ids a run read. A label
   *  recorded in the seconds between the run's read and its mark is marked without being researched.
   *  The run is owner-triggered and nothing is deleted, so that entry is still readable — take ids
   *  as an argument only if a real run is ever slow enough for the window to bite. */
  markHarvested(): Promise<number>;
}

const TEXT_LIMIT = 200;
const RECENT_LIMIT = 200;

/** One normalisation, applied by both drivers, so the bound is a property of the SEAM rather than of
 *  whichever driver happens to be configured (the repo's one-interface-both-drivers rule). */
const normalise = (entry: NewUnmappedLabel) => ({
  ...entry,
  label: entry.label.trim().slice(0, TEXT_LIMIT),
  reason: entry.reason.trim().slice(0, TEXT_LIMIT),
});

/** "Distinct role" is the words a person meant, not the exact keystrokes — "Harbour Pilot" and
 *  "harbour pilot " are one gap, and counting them as two would inflate the number the owner
 *  launches a run on. Same key both drivers. */
const roleKey = (label: string) => label.trim().toLowerCase();

export class InMemoryUnmappedLabelStore implements UnmappedLabelStore {
  private readonly entries: UnmappedLabelRecord[] = [];

  async init() {}

  async record(entry: NewUnmappedLabel) {
    this.entries.push({
      ...normalise(entry),
      id: randomUUID(),
      recordedAt: new Date().toISOString(),
      harvestedAt: null,
    });
    // Bounded like the buffer this replaced: this driver is a dev/test process's whole memory, and an
    // unbounded array is how a long-running dev server turns a feed into a leak. The Pg driver needs
    // no equivalent — durability is the point there, and #253 harvests it.
    // ponytail: the cap means this driver's stats() saturates at 200 where Postgres counts the true
    // total. Production is Postgres; a dev process that has seen 200 unmapped placements without a
    // database has already told the developer what they needed to know.
    if (this.entries.length > RECENT_LIMIT) this.entries.shift();
  }

  async recent(limit = RECENT_LIMIT, unharvestedOnly = false) {
    const pool = unharvestedOnly ? this.entries.filter((e) => e.harvestedAt === null) : this.entries;
    return pool.slice(-limit).reverse().map((entry) => ({ ...entry }));
  }

  async stats() {
    const waiting = this.entries.filter((entry) => entry.harvestedAt === null);
    return {
      unharvested: waiting.length,
      distinctRoles: new Set(waiting.map((entry) => roleKey(entry.label))).size,
    };
  }

  async markHarvested() {
    const at = new Date().toISOString();
    let marked = 0;
    for (const entry of this.entries) {
      if (entry.harvestedAt === null) {
        entry.harvestedAt = at;
        marked++;
      }
    }
    return marked;
  }
}

const UNMAPPED_LABELS_TABLE = `
  CREATE TABLE IF NOT EXISTS unmapped_labels (
    id          text PRIMARY KEY,
    -- Insertion order, because timestamps tie: several placements inside one request land on the
    -- same millisecond, and "newest first" has to stay stable rather than fall back to a random id.
    seq         bigserial NOT NULL,
    session_id  text,
    source      text NOT NULL,
    label       text NOT NULL,
    reason      text NOT NULL,
    recorded_at timestamptz NOT NULL,
    harvested_at timestamptz
  )
`;

export class PgUnmappedLabelStore implements UnmappedLabelStore {
  constructor(private pool: Pool) {}

  async init() {
    await this.pool.query(UNMAPPED_LABELS_TABLE);
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS unmapped_labels_seq ON unmapped_labels (seq DESC)`,
    );
    // #253 additive migration for the table #252 already created in production. IF NOT EXISTS makes
    // it idempotent, so it is NOT swallowed: the only errors left are real ones (permissions, a lock
    // timeout), and booting past those would leave every harvest query referencing a column that is
    // not there — a 500 on the ops screen instead of a loud failure at startup.
    await this.pool.query(
      `ALTER TABLE unmapped_labels ADD COLUMN IF NOT EXISTS harvested_at timestamptz`,
    );
  }

  async record(entry: NewUnmappedLabel) {
    const row = normalise(entry);
    await this.pool.query(
      `INSERT INTO unmapped_labels (id, session_id, source, label, reason, recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [randomUUID(), row.sessionId, row.source, row.label, row.reason, new Date().toISOString()],
    );
  }

  async recent(limit = RECENT_LIMIT, unharvestedOnly = false) {
    const { rows } = await this.pool.query(
      `SELECT id, session_id, source, label, reason, recorded_at, harvested_at FROM unmapped_labels
       ${unharvestedOnly ? "WHERE harvested_at IS NULL" : ""}
       ORDER BY seq DESC LIMIT $1`,
      [limit],
    );
    return rows.map((row) => ({
      id: row.id as string,
      sessionId: (row.session_id as string | null) ?? null,
      source: row.source as UnmappedLabelSource,
      label: row.label as string,
      reason: row.reason as string,
      recordedAt: iso(row.recorded_at),
      harvestedAt: row.harvested_at ? iso(row.harvested_at) : null,
    }));
  }

  async stats() {
    // Counted in the database, not read-then-count in JS: the waiting set is unbounded by design
    // (nothing is deleted), and this is the one read that must never be capped like recent() is.
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS unharvested, count(DISTINCT lower(label))::int AS roles
       FROM unmapped_labels WHERE harvested_at IS NULL`, // label is already trimmed on the way in
    );
    return { unharvested: rows[0].unharvested as number, distinctRoles: rows[0].roles as number };
  }

  async markHarvested() {
    const { rowCount } = await this.pool.query(
      `UPDATE unmapped_labels SET harvested_at = $1 WHERE harvested_at IS NULL`,
      [new Date().toISOString()],
    );
    return rowCount ?? 0;
  }
}

/** Postgres when DATABASE_URL is set, in-memory otherwise — same convention as every other store. */
export function unmappedLabelStoreFromEnv(databaseUrl?: string): UnmappedLabelStore {
  return databaseUrl ? new PgUnmappedLabelStore(getPool(databaseUrl)) : new InMemoryUnmappedLabelStore();
}

/** Where an unmapped placement gets recorded from: the store plus who and which door. Optional at
 *  every call site — a test or eval that wires no store still places roles, it just feeds nothing. */
export interface UnmappedLabelFeed {
  store: UnmappedLabelStore;
  sessionId: string | null;
  source: UnmappedLabelSource;
}

/**
 * The ONE recording path. Never throws: a feed write failure degrades to the counter and log line
 * that existed before there was a store, so a database hiccup can never fail a placement (#252 AC7).
 *
 * The LABEL TEXT is deliberately not in the log line. It is visitor-typed / CV-read free text, and
 * CODING_STANDARDS' "no full PII in log lines" applies to Fly's logs exactly as OPS_KEY applies to
 * the /ops/unmapped-labels route — gating one and printing the other into an ungated log would be
 * the same leak through a different door.
 */
export async function recordUnmappedLabel(
  feed: UnmappedLabelFeed | undefined,
  label: string,
  reason: string,
): Promise<void> {
  console.error(`[ops] family placement unmapped (${reason.trim().slice(0, TEXT_LIMIT)})`);
  if (!feed) return;
  try {
    await feed.store.record({
      sessionId: feed.sessionId,
      source: feed.source,
      label,
      reason,
    });
  } catch (err) {
    incrementCounter("familyLabeler.unmapped_feed_failed");
    console.error(
      `[ops] unmapped label feed write failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
