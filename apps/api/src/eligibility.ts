// #86 decisions 4 + 5 — the eligibility-fact store.
//
// An "eligibility fact" (CONTEXT.md) is a fact adverts test as a GATE rather than as evidence of
// capability: right to work, language fluency, length of experience, a mandatory certification. It
// is a different object from a source-supported fact and deliberately does NOT live in the claims
// table:
//
//   - it is ASKED once, not mined from a CV;
//   - it is reused across every posting, because it does not vary by advert;
//   - its value must be COMPARABLE ("is 5 at least 8?"), not prose — the claims table stores
//     sentences, which is exactly why "3 years" and "10 years" score identically today;
//   - length of experience is scoped to a JOB FAMILY. "8 years" is meaningless on its own: eight
//     years of IT project delivery is a different fact from eight years of employment. Owner
//     decision 2026-08-02.
//
// Storage only. Asking the questions, deriving WHICH dimensions are worth asking from the corpus,
// and consuming these while scoring are #96 and #89 respectively.
import type { Pool } from "pg";
import { getPool } from "./db.js";

/** The dimensions adverts gate on. Which of these we actually ask is #96's decision, earned from
 *  the APAC corpus rather than guessed — this type is the storage vocabulary, not the question set. */
export const ELIGIBILITY_DIMENSIONS = [
  "years-experience",
  "work-rights",
  "language",
  "certification",
  "degree",
] as const;
export type EligibilityDimension = (typeof ELIGIBILITY_DIMENSIONS)[number];

/** Dimensions whose value is a canonical decimal string, so a shortfall can be scored
 *  proportionately (#86 decision 5) instead of being invisible or fatal. */
const NUMERIC_DIMENSIONS = new Set<EligibilityDimension>(["years-experience"]);

/** Family scope. A family id for anything family-scoped; `ANY_FAMILY` for dimensions that hold
 *  regardless of the job family — your right to work does not change with the role.
 *
 *  Not NULL: in Postgres two NULLs are never equal, so a nullable column in the primary key would
 *  silently stop enforcing uniqueness for exactly the global rows. `"*"` also matches the
 *  convention already used for "serves anywhere" in the provider registry (#85 §2.2). */
export const ANY_FAMILY = "*";

export interface EligibilityFact {
  dimension: EligibilityDimension;
  /** A published family id, or `ANY_FAMILY`. #182: for `work-rights` this column instead carries the
   *  PLACE the question was asked about (a city, e.g. "Hong Kong") — the same generic "scope" slot
   *  years-experience already uses for a job family, reused rather than duplicated (ADR-0003 §7's
   *  "every fact is a fact about a place" applied to the one dimension the question is already worded
   *  around — see eligibilityDiscovery.ts's buildQuestion). `ANY_FAMILY` remains the fallback when no
   *  place is known yet. */
  familyId: string;
  /** Canonical value. For a numeric dimension this is a plain decimal string ("8"), never prose. */
  value: string;
  /** Human-readable, for rendering back to the user ("Years in IT project delivery"). */
  label: string;
}

/** A value a `put()` correction replaced. #182 / ADR-0003 §7: a correction supersedes, it never
 *  deletes — the old value stays reachable via `EligibilityStore.history()`, tagged with when it
 *  stopped being current. Never returned by `get()`/`list()`/`numeric()`, which only ever see the
 *  current value, so every pre-#182 read behaviour is unchanged. */
export interface SupersededEligibilityFact {
  value: string;
  label: string;
  supersededAt: string;
}

export interface EligibilityStore {
  init(): Promise<void>;
  /** Record or correct one fact. Upsert on (session, dimension, family) — the PRIOR value at that key,
   *  if any and if different, is kept, not discarded (see history() and SupersededEligibilityFact). */
  put(sessionId: string, fact: EligibilityFact): Promise<void>;
  list(sessionId: string): Promise<EligibilityFact[]>;
  /** One fact, or null when never asked. **Null means UNKNOWN, never "does not have it"** — the
   *  distinction #86 decision 3 rests on: an unknown must never withdraw a card. (#425's one
   *  exception lives in withdrawal.ts: a required language on neither the CV nor the profile.) */
  get(
    sessionId: string,
    dimension: EligibilityDimension,
    familyId?: string,
  ): Promise<EligibilityFact | null>;
  /** The comparable number for a numeric dimension, or null when unknown or unparseable. The whole
   *  point of this store: `years(sid, "it-project-delivery")` answers "is 5 at least 8?". */
  numeric(sessionId: string, dimension: EligibilityDimension, familyId?: string): Promise<number | null>;
  remove(sessionId: string, dimension: EligibilityDimension, familyId?: string): Promise<void>;
  /** Every value `put()` has ever superseded at this (session, dimension, family) key, oldest first.
   *  Empty when the current value was the first ever written. #182 AC5's proof surface: a changed
   *  answer is provably kept, not deleted. */
  history(
    sessionId: string,
    dimension: EligibilityDimension,
    familyId?: string,
  ): Promise<SupersededEligibilityFact[]>;
}

/** Reject anything a numeric dimension could not compare later. Fails at the write, where the caller
 *  can still fix it, rather than silently storing "about 8 years" and degrading to unknown at read. */
function assertStorable(fact: EligibilityFact): void {
  if (!NUMERIC_DIMENSIONS.has(fact.dimension)) return;
  if (!/^\d+(\.\d+)?$/.test(fact.value)) {
    throw new Error(
      `eligibility: ${fact.dimension} must be a canonical decimal string, got ${JSON.stringify(fact.value)}`,
    );
  }
}

const key = (dimension: string, familyId: string) => `${dimension}\0${familyId}`;

export class InMemoryEligibilityStore implements EligibilityStore {
  private bySession = new Map<string, Map<string, EligibilityFact>>();
  // #182 / ADR-0003 §7: superseded values, per session then per (dimension, family) key — never read
  // by get()/list()/numeric(), only by history().
  private historyBySession = new Map<string, Map<string, SupersededEligibilityFact[]>>();

  async init(): Promise<void> {}

  private forSession(sessionId: string): Map<string, EligibilityFact> {
    let m = this.bySession.get(sessionId);
    if (!m) {
      m = new Map();
      this.bySession.set(sessionId, m);
    }
    return m;
  }

  private historyFor(sessionId: string): Map<string, SupersededEligibilityFact[]> {
    let m = this.historyBySession.get(sessionId);
    if (!m) {
      m = new Map();
      this.historyBySession.set(sessionId, m);
    }
    return m;
  }

  private recordSuperseded(sessionId: string, k: string, prior: EligibilityFact): void {
    const h = this.historyFor(sessionId);
    const entries = h.get(k) ?? [];
    entries.push({ value: prior.value, label: prior.label, supersededAt: new Date().toISOString() });
    h.set(k, entries);
  }

  async put(sessionId: string, fact: EligibilityFact): Promise<void> {
    assertStorable(fact);
    const k = key(fact.dimension, fact.familyId);
    const prior = this.forSession(sessionId).get(k);
    if (prior && (prior.value !== fact.value || prior.label !== fact.label)) {
      this.recordSuperseded(sessionId, k, prior);
    }
    this.forSession(sessionId).set(k, { ...fact });
  }

  async list(sessionId: string): Promise<EligibilityFact[]> {
    return [...this.forSession(sessionId).values()].map((f) => ({ ...f }));
  }

  async get(
    sessionId: string,
    dimension: EligibilityDimension,
    familyId: string = ANY_FAMILY,
  ): Promise<EligibilityFact | null> {
    const found = this.forSession(sessionId).get(key(dimension, familyId));
    return found ? { ...found } : null;
  }

  async numeric(
    sessionId: string,
    dimension: EligibilityDimension,
    familyId: string = ANY_FAMILY,
  ): Promise<number | null> {
    return toNumber(await this.get(sessionId, dimension, familyId));
  }

  // #182 QA round 3, small fix: a decline is a retraction, but ADR-0003 §7's "no answer is ever
  // deleted" still applies to the value it retracts — record it superseded before the row goes,
  // exactly like a put() correction. Only get()/list()/numeric() ever stop seeing it; history() does
  // not.
  async remove(
    sessionId: string,
    dimension: EligibilityDimension,
    familyId: string = ANY_FAMILY,
  ): Promise<void> {
    const k = key(dimension, familyId);
    const current = this.forSession(sessionId).get(k);
    if (current) this.recordSuperseded(sessionId, k, current);
    this.forSession(sessionId).delete(k);
  }

  async history(
    sessionId: string,
    dimension: EligibilityDimension,
    familyId: string = ANY_FAMILY,
  ): Promise<SupersededEligibilityFact[]> {
    // Code review (#182): clone each entry, not just the array — matches get()/list()'s own
    // defensiveness against a caller mutating a returned object and corrupting the store's copy.
    return (this.historyFor(sessionId).get(key(dimension, familyId)) ?? []).map((e) => ({ ...e }));
  }
}

function toNumber(fact: EligibilityFact | null): number | null {
  if (!fact) return null;
  const n = Number(fact.value);
  return Number.isFinite(n) ? n : null;
}

const ELIGIBILITY_TABLE = `
CREATE TABLE IF NOT EXISTS eligibility_facts (
  session_id text NOT NULL,
  dimension  text NOT NULL,
  family_id  text NOT NULL,
  value      text NOT NULL,
  label      text NOT NULL,
  PRIMARY KEY (session_id, dimension, family_id)
)`;

// #182 / ADR-0003 §7: superseded values, in their OWN table rather than a column on eligibility_facts
// — code review's must-fix: a column embedded in the current-fact row dies with that row on remove()
// (a decline), which is exactly the "no answer is ever deleted" guarantee this table exists to keep.
// Decoupling the two means remove() (below) can delete the CURRENT row without ever touching this one,
// matching the in-memory driver's own separate historyBySession map. No natural-key uniqueness here —
// many superseded values are expected per (session, dimension, family) over time.
const ELIGIBILITY_HISTORY_TABLE = `
CREATE TABLE IF NOT EXISTS eligibility_fact_history (
  id            SERIAL PRIMARY KEY,
  session_id    text NOT NULL,
  dimension     text NOT NULL,
  family_id     text NOT NULL,
  value         text NOT NULL,
  label         text NOT NULL,
  superseded_at timestamptz NOT NULL DEFAULT now()
)`;

export class PgEligibilityStore implements EligibilityStore {
  constructor(private pool: Pool) {}

  async init(): Promise<void> {
    await this.pool.query(ELIGIBILITY_TABLE);
    await this.pool.query(ELIGIBILITY_HISTORY_TABLE);
  }

  // #182 / ADR-0003 §7: a correction supersedes, never replaces. The prior row (if any) is read; when
  // its value/label actually differ (an identical re-answer is not a correction), it's INSERTed into
  // eligibility_fact_history BEFORE the current row is upserted — two queries, not one jsonb-munging
  // UPDATE, so pg-mem (the test driver, thin jsonb-function support) and any real Postgres agree.
  async put(sessionId: string, fact: EligibilityFact): Promise<void> {
    assertStorable(fact);
    const { rows } = await this.pool.query(
      `SELECT value, label FROM eligibility_facts WHERE session_id = $1 AND dimension = $2 AND family_id = $3`,
      [sessionId, fact.dimension, fact.familyId],
    );
    const prior = rows[0] as { value: string; label: string } | undefined;
    if (prior && (prior.value !== fact.value || prior.label !== fact.label)) {
      await this.pool.query(
        `INSERT INTO eligibility_fact_history (session_id, dimension, family_id, value, label)
         VALUES ($1,$2,$3,$4,$5)`,
        [sessionId, fact.dimension, fact.familyId, prior.value, prior.label],
      );
    }
    await this.pool.query(
      `INSERT INTO eligibility_facts (session_id, dimension, family_id, value, label)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (session_id, dimension, family_id)
       DO UPDATE SET value = EXCLUDED.value, label = EXCLUDED.label`,
      [sessionId, fact.dimension, fact.familyId, fact.value, fact.label],
    );
  }

  // #182 code review must-fix: reads eligibility_fact_history directly — never the (removable)
  // current-fact row — so a decline (remove(), below) can never take a superseded value down with it.
  async history(
    sessionId: string,
    dimension: EligibilityDimension,
    familyId: string = ANY_FAMILY,
  ): Promise<SupersededEligibilityFact[]> {
    const { rows } = await this.pool.query(
      `SELECT value, label, superseded_at FROM eligibility_fact_history
       WHERE session_id = $1 AND dimension = $2 AND family_id = $3
       ORDER BY id ASC`,
      [sessionId, dimension, familyId],
    );
    return rows.map((r) => ({
      value: r.value as string,
      label: r.label as string,
      supersededAt: r.superseded_at instanceof Date ? r.superseded_at.toISOString() : String(r.superseded_at),
    }));
  }

  async list(sessionId: string): Promise<EligibilityFact[]> {
    const { rows } = await this.pool.query(
      `SELECT dimension, family_id, value, label FROM eligibility_facts
       WHERE session_id = $1 ORDER BY dimension, family_id`,
      [sessionId],
    );
    return rows.map(toFact);
  }

  async get(
    sessionId: string,
    dimension: EligibilityDimension,
    familyId: string = ANY_FAMILY,
  ): Promise<EligibilityFact | null> {
    const { rows } = await this.pool.query(
      `SELECT dimension, family_id, value, label FROM eligibility_facts
       WHERE session_id = $1 AND dimension = $2 AND family_id = $3`,
      [sessionId, dimension, familyId],
    );
    return rows[0] ? toFact(rows[0]) : null;
  }

  async numeric(
    sessionId: string,
    dimension: EligibilityDimension,
    familyId: string = ANY_FAMILY,
  ): Promise<number | null> {
    return toNumber(await this.get(sessionId, dimension, familyId));
  }

  // #182 code review must-fix: deletes ONLY the current-fact row, into a SEPARATE eligibility_fact_
  // history table this query never names, so a decline can retract the current value without ever
  // touching anything history() would return — matching the in-memory driver.
  // #182 QA round 3, small fix: the value being retracted is itself recorded superseded first — a
  // decline is a retraction, but ADR-0003 §7's "no answer is ever deleted" still covers the value it
  // retracts, exactly like a put() correction.
  async remove(
    sessionId: string,
    dimension: EligibilityDimension,
    familyId: string = ANY_FAMILY,
  ): Promise<void> {
    const { rows } = await this.pool.query(
      `SELECT value, label FROM eligibility_facts WHERE session_id = $1 AND dimension = $2 AND family_id = $3`,
      [sessionId, dimension, familyId],
    );
    const current = rows[0] as { value: string; label: string } | undefined;
    if (current) {
      await this.pool.query(
        `INSERT INTO eligibility_fact_history (session_id, dimension, family_id, value, label)
         VALUES ($1,$2,$3,$4,$5)`,
        [sessionId, dimension, familyId, current.value, current.label],
      );
    }
    await this.pool.query(
      `DELETE FROM eligibility_facts WHERE session_id = $1 AND dimension = $2 AND family_id = $3`,
      [sessionId, dimension, familyId],
    );
  }
}

function toFact(r: Record<string, unknown>): EligibilityFact {
  return {
    dimension: r.dimension as EligibilityDimension,
    familyId: r.family_id as string,
    value: r.value as string,
    label: r.label as string,
  };
}

/** Postgres when DATABASE_URL is set, in-memory otherwise — same convention as the other stores. */
export function eligibilityStoreFromEnv(databaseUrl?: string): EligibilityStore {
  return databaseUrl ? new PgEligibilityStore(getPool(databaseUrl)) : new InMemoryEligibilityStore();
}
