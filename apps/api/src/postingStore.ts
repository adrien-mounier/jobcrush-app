// #100 — persists ONE provider's raw ProviderPostingRecordV1 rows (§2.1), keyed by
// (providerId, providerPostingId). Re-fetching the same posting upserts, never duplicates, and
// follows §2.6's date semantics on the merge: capturedAt is preserved as the EARLIEST time this
// exact provider record was ever stored ("when JobCrush first retrieved this record"), while
// verifiedLiveAt always advances to the fresh fetch's value ("last time liveness was positively
// re-confirmed") — every other field is replaced with the fresh fetch (a job's title/excerpt/expiry
// can genuinely change between fetches). Same driver-split shape as adRequirementsStore.ts
// (InMemory + Pg + …FromEnv): storage stays dumb, keyed persistence only — cross-provider dedup
// (postings.ts's dedupePostings, #99) and multi-provider fan-out (#101) are callers of this store,
// not this file's job.
//
// Deliberately CROSS-SESSION, not the session-scoped RetrievalSnapshot §2.8 describes: this table is
// keyed on (providerId, providerPostingId) — one row per raw provider record, shared by every session
// that happens to search an overlapping region — because "did we already fetch THIS posting" is a
// fact about the posting, not about any one visitor's search. §2.8's snapshot is a different, later
// concern (#101's): the last RESULT a given session saw, for intent-change invalidation. Cross-fetch
// dedup cannot be session-scoped by construction: two different sessions' fetches of the same region
// must land on the SAME stored row, which only a shared, provider-keyed table gives you — and that
// is exactly this ticket's own AC ("re-fetching the same posting does not duplicate it").
import type { Pool } from "pg";
import { ProviderPostingRecordV1, type ProviderPostingRecordV1 as ProviderPostingRecordV1Value } from "@jobcrush/contracts";
import { earliest, latest } from "./postings.js";
import { languageEligible, SERVED_LANGUAGES } from "./language.js";
import { incrementCounter } from "./counters.js";
import { getPool, iso } from "./db.js";

/** #100 review MF6: counted exactly once per posting, at the moment it is FIRST persisted here —
 *  never per fetch/normalize call (postingProvider.ts no longer counts at all), which would inflate
 *  postings.language_skipped/undetermined with every re-fetch of an already-known posting. Mirrors
 *  preview.ts's loadPostings() convention (counted once, at the pool's one-time ingest); moved to
 *  THIS boundary because a live provider's "ingest" now happens on every fetch, not once per process,
 *  so only the store — the one place that actually knows "is this posting new to us" — can tell a
 *  genuinely new posting from a repeat sighting of one already counted. */
function countLanguageAtIngest(language: string): void {
  if (language === "und") incrementCounter("postings.language_undetermined");
  else if (!languageEligible(language, SERVED_LANGUAGES)) incrementCounter("postings.language_skipped");
}

export interface PostingStore {
  readonly durable: boolean;
  init(): Promise<void>;
  /** Upsert one provider's raw record. Returns the STORED record, which is `record` verbatim on a
   *  first insert, or `record` with capturedAt/verifiedLiveAt resolved per §2.6 on a re-fetch. */
  upsert(record: ProviderPostingRecordV1Value): Promise<ProviderPostingRecordV1Value>;
  get(providerId: string, providerPostingId: string): Promise<ProviderPostingRecordV1Value | null>;
  /** Every record currently stored for one provider — the input a caller doing cross-provider dedup
   *  (postings.ts's dedupePostings) or #101's retrieval reads from. */
  listByProvider(providerId: string): Promise<ProviderPostingRecordV1Value[]>;
  /** Atomically consumes one provider call in the named calendar month, but never increments past
   *  `limit`. False means the month is already exhausted. */
  reserveMonthlyCall(providerId: string, yearMonth: string, limit: number): Promise<boolean>;
  getMonthlyCallCount(providerId: string, yearMonth: string): Promise<number>;
}

function keyOf(providerId: string, providerPostingId: string): string {
  return `${providerId}:${providerPostingId}`;
}

export class InMemoryPostingStore implements PostingStore {
  readonly durable = false;
  private byKey = new Map<string, ProviderPostingRecordV1Value>();
  private monthlyCalls = new Map<string, number>();

  async init(): Promise<void> {}

  async upsert(record: ProviderPostingRecordV1Value): Promise<ProviderPostingRecordV1Value> {
    const key = keyOf(record.providerId, record.providerPostingId);
    const existing = this.byKey.get(key);
    if (!existing) countLanguageAtIngest(record.language); // genuinely new — count once, here only
    const merged: ProviderPostingRecordV1Value = existing
      ? {
          ...record,
          capturedAt: earliest(existing.capturedAt, record.capturedAt),
          verifiedLiveAt: latest(existing.verifiedLiveAt, record.verifiedLiveAt),
        }
      : record;
    this.byKey.set(key, structuredClone(merged));
    return structuredClone(merged);
  }

  async get(providerId: string, providerPostingId: string): Promise<ProviderPostingRecordV1Value | null> {
    const found = this.byKey.get(keyOf(providerId, providerPostingId));
    if (!found) return null;
    // Re-validate on read, same as PgPostingStore below and the same reason adRequirementsStore.ts
    // does it — a row a CURRENT contract bump would reject must read as absent, not throw.
    const parsed = ProviderPostingRecordV1.safeParse(found);
    return parsed.success ? structuredClone(parsed.data) : null;
  }

  async listByProvider(providerId: string): Promise<ProviderPostingRecordV1Value[]> {
    // #100 review MF8: re-validate here too, same as get() — this used to be the only one of the
    // four read paths that returned a stale row's raw shape verbatim instead of treating it as absent.
    const out: ProviderPostingRecordV1Value[] = [];
    for (const r of this.byKey.values()) {
      if (r.providerId !== providerId) continue;
      const parsed = ProviderPostingRecordV1.safeParse(r);
      if (parsed.success) out.push(structuredClone(parsed.data));
    }
    return out;
  }

  async reserveMonthlyCall(providerId: string, yearMonth: string, limit: number): Promise<boolean> {
    if (limit <= 0) return false;
    const key = keyOf(providerId, yearMonth);
    const count = this.monthlyCalls.get(key) ?? 0;
    if (count >= limit) return false;
    this.monthlyCalls.set(key, count + 1);
    return true;
  }

  async getMonthlyCallCount(providerId: string, yearMonth: string): Promise<number> {
    return this.monthlyCalls.get(keyOf(providerId, yearMonth)) ?? 0;
  }
}

const PROVIDER_POSTINGS_TABLE = `
CREATE TABLE IF NOT EXISTS provider_postings (
  provider_id         text NOT NULL,
  provider_posting_id text NOT NULL,
  record               jsonb NOT NULL,
  captured_at          timestamptz NOT NULL,
  verified_live_at     timestamptz NOT NULL,
  PRIMARY KEY (provider_id, provider_posting_id)
)`;

const PROVIDER_MONTHLY_CALLS_TABLE = `
CREATE TABLE IF NOT EXISTS provider_monthly_calls (
  provider_id        text NOT NULL,
  year_month         text NOT NULL,
  call_count         integer NOT NULL,
  reservation_allowed boolean NOT NULL,
  PRIMARY KEY (provider_id, year_month)
)`;

/** jsonb columns come back as an object on real pg but as a string on pg-mem (used by the store
 *  contract test) — parse defensively, same pattern every jsonb-backed store in this repo uses. */
function parseJsonbColumn<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

/** Row -> the resolved plain object: the capturedAt/verifiedLiveAt COLUMNS win over whatever those
 *  two fields say inside the stored `record` jsonb — the columns are what upsert's SQL merges;
 *  the jsonb blob otherwise carries every other field verbatim. Deliberately NOT validated here —
 *  see rowToValidatedRecord below for why validation is a READ-time concern only. */
function mergedRow(row: { record: unknown; captured_at: unknown; verified_live_at: unknown }): Record<string, unknown> {
  const stored = parseJsonbColumn<Record<string, unknown>>(row.record);
  return { ...stored, capturedAt: iso(row.captured_at), verifiedLiveAt: iso(row.verified_live_at) };
}

/** Row -> ProviderPostingRecordV1, validated. Used by get()/listByProvider() — a row the CURRENT
 *  contract rejects (a bump since the row was written) must read as absent, not throw (same
 *  convention as adRequirementsStore.ts). NOT used by upsert()'s own return value: storage stays
 *  dumb on write (same convention as adRequirementsStore.ts's put(), which never validates its
 *  input either) — validating a value upsert() is about to hand straight back to its OWN caller
 *  would make a malformed write throw at WRITE time instead of surfacing, honestly, as a stale row
 *  the next READ excludes. */
function rowToValidatedRecord(row: { record: unknown; captured_at: unknown; verified_live_at: unknown }): ProviderPostingRecordV1Value {
  return ProviderPostingRecordV1.parse(mergedRow(row));
}

export class PgPostingStore implements PostingStore {
  readonly durable = true;
  constructor(private pool: Pool) {}

  async init(): Promise<void> {
    await this.pool.query(PROVIDER_POSTINGS_TABLE);
    await this.pool.query(PROVIDER_MONTHLY_CALLS_TABLE);
  }

  async upsert(record: ProviderPostingRecordV1Value): Promise<ProviderPostingRecordV1Value> {
    // #100 review MF6: a cheap existence pre-check so the language counters below fire ONLY for a
    // genuinely new posting, never on a re-fetch. This reopens a narrow TOCTOU race against the
    // atomic upsert immediately below (two concurrent first-ever upserts of the SAME new key could
    // both see "not existing" and both count) — an accepted limit for an observability counter, same
    // tolerance every other in-process counter in this codebase already carries (counters.ts), NOT
    // extended to the upsert itself, which stays the one atomic, race-free statement.
    const existing = await this.pool.query(
      `SELECT 1 FROM provider_postings WHERE provider_id = $1 AND provider_posting_id = $2`,
      [record.providerId, record.providerPostingId],
    );
    if (existing.rows.length === 0) countLanguageAtIngest(record.language);

    // One atomic statement, not a read-then-write: the CASE expressions resolve §2.6's merge
    // server-side (portable SQL — pg-mem's own function set doesn't cover LEAST/GREATEST on
    // timestamptz, so this is the same comparison spelled out rather than a built-in), so two
    // concurrent upserts of the same record can't race each other into a lost update the way a
    // read-modify-write in application code could.
    const { rows } = await this.pool.query(
      `INSERT INTO provider_postings (provider_id, provider_posting_id, record, captured_at, verified_live_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (provider_id, provider_posting_id) DO UPDATE SET
         record = EXCLUDED.record,
         captured_at = CASE WHEN provider_postings.captured_at <= EXCLUDED.captured_at
                            THEN provider_postings.captured_at ELSE EXCLUDED.captured_at END,
         verified_live_at = CASE WHEN provider_postings.verified_live_at >= EXCLUDED.verified_live_at
                            THEN provider_postings.verified_live_at ELSE EXCLUDED.verified_live_at END
       RETURNING record, captured_at, verified_live_at`,
      [record.providerId, record.providerPostingId, JSON.stringify(record), record.capturedAt, record.verifiedLiveAt],
    );
    return mergedRow(rows[0]) as ProviderPostingRecordV1Value;
  }

  async get(providerId: string, providerPostingId: string): Promise<ProviderPostingRecordV1Value | null> {
    const { rows } = await this.pool.query(
      `SELECT record, captured_at, verified_live_at FROM provider_postings
       WHERE provider_id = $1 AND provider_posting_id = $2`,
      [providerId, providerPostingId],
    );
    if (!rows[0]) return null;
    try {
      return rowToValidatedRecord(rows[0]);
    } catch {
      // A stored row the CURRENT contract rejects (a bump since this row was written) reads as
      // absent, not a throw — same convention as adRequirementsStore.ts's own get().
      return null;
    }
  }

  async listByProvider(providerId: string): Promise<ProviderPostingRecordV1Value[]> {
    const { rows } = await this.pool.query(
      `SELECT record, captured_at, verified_live_at FROM provider_postings WHERE provider_id = $1`,
      [providerId],
    );
    const out: ProviderPostingRecordV1Value[] = [];
    for (const row of rows) {
      try {
        out.push(rowToValidatedRecord(row));
      } catch {
        // Same "stale row reads as absent" rule, applied per-row rather than failing the whole list.
      }
    }
    return out;
  }

  async reserveMonthlyCall(providerId: string, yearMonth: string, limit: number): Promise<boolean> {
    if (limit <= 0) return false;
    // One database statement both decides and consumes the reservation. Both right-hand expressions
    // read the pre-update row, so the returned flag belongs to this caller's attempt even when many
    // callers contend for the same key; call_count itself is clamped at the limit.
    const { rows } = await this.pool.query(
      `INSERT INTO provider_monthly_calls
         (provider_id, year_month, call_count, reservation_allowed)
       VALUES ($1, $2, 1, true)
       ON CONFLICT (provider_id, year_month) DO UPDATE SET
         reservation_allowed = provider_monthly_calls.call_count < $3,
         call_count = CASE WHEN provider_monthly_calls.call_count < $3
                           THEN provider_monthly_calls.call_count + 1
                           ELSE provider_monthly_calls.call_count END
       RETURNING reservation_allowed`,
      [providerId, yearMonth, limit],
    );
    return rows[0]?.reservation_allowed === true;
  }

  async getMonthlyCallCount(providerId: string, yearMonth: string): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT call_count FROM provider_monthly_calls WHERE provider_id = $1 AND year_month = $2`,
      [providerId, yearMonth],
    );
    return Number(rows[0]?.call_count ?? 0);
  }
}

/** Postgres when DATABASE_URL is set, in-memory otherwise — same convention as every other store. */
export function postingStoreFromEnv(databaseUrl?: string): PostingStore {
  return databaseUrl ? new PgPostingStore(getPool(databaseUrl)) : new InMemoryPostingStore();
}
