// #104 (E5 slice 3) — the shared, persisted ad-requirements read cache. Same driver-split shape as
// eligibility.ts (InMemory + Pg + …FromEnv), but keyed differently on purpose: an eligibility fact
// is per SESSION (asked of a person); a read advert is a property of the ADVERT ITSELF, keyed by
// adId alone, because every session that sees a given job shares the same read (#86: "nobody pays
// twice for the same advert"). The stored `version` (adReader.ts's AD_READER_VERSION) is what lets
// a prompt/contract bump re-read every advert on its next request, while an ordinary read at the
// SAME version reuses the record and makes no model call — the store decides nothing about that
// policy itself, it just remembers what version produced what it's holding (mirrors eligibility.ts:
// storage stays dumb, the caller decides what to do with what it finds).
import type { Pool } from "pg";
import { AdRequirementsV1 } from "@jobcrush/contracts";
import { getPool } from "./db.js";

/** Per-advert model cost, captured once at read time — real measured numbers, replacing #86's
 *  estimates. Token counts are null, never estimated, when the driver that produced this read
 *  couldn't report usage (llm.ts's completeWithUsage is optional). */
export interface AdReadCost {
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  readAt: string; // ISO timestamp
}

export interface AdRequirementsRecord {
  requirements: AdRequirementsV1;
  version: string;
  cost: AdReadCost;
}

export interface AdRequirementsStore {
  init(): Promise<void>;
  /** The stored read for `adId`, at whatever version it was read under, or null if never read. */
  get(adId: string): Promise<AdRequirementsRecord | null>;
  /** Upsert — a re-read (e.g. after a version bump) replaces the prior record for the same adId. */
  put(adId: string, record: AdRequirementsRecord): Promise<void>;
}

export class InMemoryAdRequirementsStore implements AdRequirementsStore {
  private byAdId = new Map<string, AdRequirementsRecord>();

  async init(): Promise<void> {}

  async get(adId: string): Promise<AdRequirementsRecord | null> {
    const found = this.byAdId.get(adId);
    if (!found) return null;
    // Re-validate on read, same as the Pg driver below — a row the CURRENT schema rejects (e.g.
    // after a contract bump) is unusable and must read as a cache miss, not throw (#104 review
    // finding 3). In normal operation this is a no-op: put() only ever receives already-validated
    // AdRequirementsV1 values; it only bites a test that deliberately stores a stale-shape payload.
    const parsed = AdRequirementsV1.safeParse(found.requirements);
    return parsed.success ? structuredClone({ ...found, requirements: parsed.data }) : null;
  }

  async put(adId: string, record: AdRequirementsRecord): Promise<void> {
    this.byAdId.set(adId, structuredClone(record));
  }
}

const AD_REQUIREMENTS_TABLE = `
CREATE TABLE IF NOT EXISTS ad_requirements (
  ad_id        text PRIMARY KEY,
  requirements jsonb NOT NULL,
  version      text NOT NULL,
  cost         jsonb NOT NULL
)`;

/** jsonb columns come back as an object on real pg but as a string on pg-mem (used by the store
 *  contract test) — parse defensively, same pattern sessions.ts already uses for its jsonb columns. */
function parseJsonbColumn<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

export class PgAdRequirementsStore implements AdRequirementsStore {
  constructor(private pool: Pool) {}

  async init(): Promise<void> {
    await this.pool.query(AD_REQUIREMENTS_TABLE);
  }

  async get(adId: string): Promise<AdRequirementsRecord | null> {
    const { rows } = await this.pool.query(
      `SELECT requirements, version, cost FROM ad_requirements WHERE ad_id = $1`,
      [adId],
    );
    if (!rows[0]) return null;
    // A stored row the CURRENT schema rejects (e.g. a contract bump since this row was written)
    // must read as a cache miss, not throw — the version check the caller does next is exactly the
    // mechanism that's supposed to catch a stale row, and it can't fire if parsing already blew up
    // first (#104 review finding 3: this used to throw here, escape makeAdReader uncaught, and land
    // in the route's blanket catch with nothing counted).
    const parsed = AdRequirementsV1.safeParse(parseJsonbColumn(rows[0].requirements));
    if (!parsed.success) return null;
    return {
      requirements: parsed.data,
      version: rows[0].version as string,
      cost: parseJsonbColumn<AdReadCost>(rows[0].cost),
    };
  }

  async put(adId: string, record: AdRequirementsRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO ad_requirements (ad_id, requirements, version, cost)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (ad_id) DO UPDATE SET
         requirements = EXCLUDED.requirements, version = EXCLUDED.version, cost = EXCLUDED.cost`,
      [adId, JSON.stringify(record.requirements), record.version, JSON.stringify(record.cost)],
    );
  }
}

/** Postgres when DATABASE_URL is set, in-memory otherwise — same convention as the other stores. */
export function adRequirementsStoreFromEnv(databaseUrl?: string): AdRequirementsStore {
  return databaseUrl ? new PgAdRequirementsStore(getPool(databaseUrl)) : new InMemoryAdRequirementsStore();
}
