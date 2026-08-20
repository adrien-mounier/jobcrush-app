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
}

export interface UnmappedLabelStore {
  init(): Promise<void>;
  record(entry: Omit<UnmappedLabelRecord, "id" | "recordedAt">): Promise<void>;
  /** Newest first, bounded — this backs an ops screen, never an unbounded table dump.
   *  ponytail: newest-200 only, no paging. The rows past that are durable but unreadable through
   *  this door until #253's harvest reads the table directly — which is the slice that decides what
   *  reading the whole feed should look like. Add paging here only if the ops screen needs it first. */
  recent(limit?: number): Promise<UnmappedLabelRecord[]>;
}

const TEXT_LIMIT = 200;
const RECENT_LIMIT = 200;

/** One normalisation, applied by both drivers, so the bound is a property of the SEAM rather than of
 *  whichever driver happens to be configured (the repo's one-interface-both-drivers rule). */
const normalise = (entry: Omit<UnmappedLabelRecord, "id" | "recordedAt">) => ({
  ...entry,
  label: entry.label.trim().slice(0, TEXT_LIMIT),
  reason: entry.reason.trim().slice(0, TEXT_LIMIT),
});

export class InMemoryUnmappedLabelStore implements UnmappedLabelStore {
  private readonly entries: UnmappedLabelRecord[] = [];

  async init() {}

  async record(entry: Omit<UnmappedLabelRecord, "id" | "recordedAt">) {
    this.entries.push({ ...normalise(entry), id: randomUUID(), recordedAt: new Date().toISOString() });
    // Bounded like the buffer this replaced: this driver is a dev/test process's whole memory, and an
    // unbounded array is how a long-running dev server turns a feed into a leak. The Pg driver needs
    // no equivalent — durability is the point there, and #253 harvests it.
    if (this.entries.length > RECENT_LIMIT) this.entries.shift();
  }

  async recent(limit = RECENT_LIMIT) {
    return this.entries.slice(-limit).reverse().map((entry) => ({ ...entry }));
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
    recorded_at timestamptz NOT NULL
  )
`;

export class PgUnmappedLabelStore implements UnmappedLabelStore {
  constructor(private pool: Pool) {}

  async init() {
    await this.pool.query(UNMAPPED_LABELS_TABLE);
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS unmapped_labels_seq ON unmapped_labels (seq DESC)`,
    );
  }

  async record(entry: Omit<UnmappedLabelRecord, "id" | "recordedAt">) {
    const row = normalise(entry);
    await this.pool.query(
      `INSERT INTO unmapped_labels (id, session_id, source, label, reason, recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [randomUUID(), row.sessionId, row.source, row.label, row.reason, new Date().toISOString()],
    );
  }

  async recent(limit = RECENT_LIMIT) {
    const { rows } = await this.pool.query(
      `SELECT id, session_id, source, label, reason, recorded_at FROM unmapped_labels
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
    }));
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
