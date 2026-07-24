// JC-21 confirmed-claims store. Holds each session's mined candidate claims plus the deck/grill
// decisions made on them; the E4 spine reads back only the CONFIRMED subset (buildClaimGraph +
// the JC-31 gate). Two drivers (same as sessions.ts): in-memory (dev/tests) and Postgres (JC-6,
// `DATABASE_URL` set). The store records decisions; it never bakes deck policy — that is the deck's job.
import type { CandidateClaim } from "@jobcrush/contracts";
import type { Pool } from "pg";
import { getPool } from "./db.js";

export type ClaimDecision = "pending" | "confirmed" | "rejected" | "negative";
// mined = straight from the CV; user-authored = the user edited it (deck) or typed it (grill).
export type ClaimOrigin = "mined" | "user-authored";

export interface ClaimRecord extends CandidateClaim {
  decision: ClaimDecision;
  origin: ClaimOrigin;
}

export interface ClaimStore {
  /** Create the backing table if needed (no-op for in-memory). Call once at startup. */
  init(): Promise<void>;
  /** Load the miner's candidate claims for a session as pending (no decisions yet). */
  seed(sessionId: string, claims: CandidateClaim[]): Promise<void>;
  list(sessionId: string): Promise<ClaimRecord[]>;
  /** The graph builder + gate consume exactly this. */
  confirmed(sessionId: string): Promise<ClaimRecord[]>;
  confirm(sessionId: string, id: string): Promise<void>;
  reject(sessionId: string, id: string): Promise<void>;
  /** Deck edit: user retyped the text → user-authored, auto-confirmed (they vouched for it). */
  edit(sessionId: string, id: string, text: string): Promise<void>;
  /** Grill answer: a new confirmed, user-authored claim. */
  add(sessionId: string, claim: CandidateClaim): Promise<void>;
  /** #13: the decision === "negative" subset (persisted "no" answers), in insertion/seq order. */
  negatives(sessionId: string): Promise<ClaimRecord[]>;
  /** #13: a "no" answer — persists as user-authored, decision "negative". Never enters confirmed(). */
  answerNegative(sessionId: string, claim: CandidateClaim): Promise<void>;
  /** #13: correction — flip a mistapped decision (e.g. a "no") back to pending, reopening the gap. */
  reopen(sessionId: string, id: string): Promise<void>;
}

export class InMemoryClaimStore implements ClaimStore {
  private bySession = new Map<string, Map<string, ClaimRecord>>();

  async init(): Promise<void> {}

  private forSession(sessionId: string): Map<string, ClaimRecord> {
    let m = this.bySession.get(sessionId);
    if (!m) {
      m = new Map();
      this.bySession.set(sessionId, m);
    }
    return m;
  }

  async seed(sessionId: string, claims: CandidateClaim[]): Promise<void> {
    const m = this.forSession(sessionId);
    // Idempotent: never clobber an existing claim's decision on re-seed (matches PgClaimStore's
    // ON CONFLICT DO NOTHING — the store-contract test pins the two drivers together).
    for (const c of claims) if (!m.has(c.id)) m.set(c.id, { ...c, decision: "pending", origin: "mined" });
  }

  async list(sessionId: string): Promise<ClaimRecord[]> {
    return [...this.forSession(sessionId).values()];
  }

  async confirmed(sessionId: string): Promise<ClaimRecord[]> {
    return [...this.forSession(sessionId).values()].filter((c) => c.decision === "confirmed");
  }

  async confirm(sessionId: string, id: string): Promise<void> {
    const c = this.forSession(sessionId).get(id);
    if (c) c.decision = "confirmed";
  }

  async reject(sessionId: string, id: string): Promise<void> {
    const c = this.forSession(sessionId).get(id);
    if (c) c.decision = "rejected";
  }

  async edit(sessionId: string, id: string, text: string): Promise<void> {
    const c = this.forSession(sessionId).get(id);
    if (c) {
      c.text = text;
      c.origin = "user-authored";
      c.decision = "confirmed";
    }
  }

  async add(sessionId: string, claim: CandidateClaim): Promise<void> {
    this.forSession(sessionId).set(claim.id, {
      ...claim,
      decision: "confirmed",
      origin: "user-authored",
    });
  }

  async negatives(sessionId: string): Promise<ClaimRecord[]> {
    return [...this.forSession(sessionId).values()].filter((c) => c.decision === "negative");
  }

  async answerNegative(sessionId: string, claim: CandidateClaim): Promise<void> {
    this.forSession(sessionId).set(claim.id, {
      ...claim,
      decision: "negative",
      origin: "user-authored",
    });
  }

  async reopen(sessionId: string, id: string): Promise<void> {
    const c = this.forSession(sessionId).get(id);
    if (c) c.decision = "pending";
  }
}

const CLAIMS_TABLE = `
CREATE TABLE IF NOT EXISTS claims (
  seq            bigserial,
  session_id     text NOT NULL,
  id             text NOT NULL,
  role           text NOT NULL,
  text           text NOT NULL,
  machine_touch  text NOT NULL,
  classification text NOT NULL,
  source_quote   text NOT NULL,
  needs_grill    boolean NOT NULL,
  grill_hint     text,
  decision       text NOT NULL,
  origin         text NOT NULL,
  PRIMARY KEY (session_id, id)
)`;

const CLAIM_COLS =
  "session_id, id, role, text, machine_touch, classification, source_quote, needs_grill, grill_hint, decision, origin";

function toClaim(r: Record<string, unknown>): ClaimRecord {
  return {
    id: r.id as string,
    role: r.role as string,
    text: r.text as string,
    machine_touch: r.machine_touch as CandidateClaim["machine_touch"],
    classification: r.classification as CandidateClaim["classification"],
    source_quote: r.source_quote as string,
    needs_grill: r.needs_grill as boolean,
    grill_hint: (r.grill_hint as string) ?? null,
    decision: r.decision as ClaimDecision,
    origin: r.origin as ClaimOrigin,
  };
}

// Insertion order (= CV order) is load-bearing: the deck tiers/sections by it and the grill's cap
// takes the first N gaps. `seq` preserves it across seed + grill-add, so list/confirmed ORDER BY seq.
export class PgClaimStore implements ClaimStore {
  constructor(private pool: Pool) {}

  async init(): Promise<void> {
    await this.pool.query(CLAIMS_TABLE);
  }

  private vals(sessionId: string, c: CandidateClaim, decision: ClaimDecision, origin: ClaimOrigin) {
    return [sessionId, c.id, c.role, c.text, c.machine_touch, c.classification, c.source_quote,
      c.needs_grill, c.grill_hint, decision, origin];
  }

  async seed(sessionId: string, claims: CandidateClaim[]): Promise<void> {
    for (const c of claims) {
      await this.pool.query(
        `INSERT INTO claims (${CLAIM_COLS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (session_id, id) DO NOTHING`,
        this.vals(sessionId, c, "pending", "mined"),
      );
    }
  }

  async list(sessionId: string): Promise<ClaimRecord[]> {
    const { rows } = await this.pool.query(`SELECT * FROM claims WHERE session_id = $1 ORDER BY seq`, [sessionId]);
    return rows.map(toClaim);
  }

  async confirmed(sessionId: string): Promise<ClaimRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM claims WHERE session_id = $1 AND decision = 'confirmed' ORDER BY seq`,
      [sessionId],
    );
    return rows.map(toClaim);
  }

  async confirm(sessionId: string, id: string): Promise<void> {
    await this.pool.query(`UPDATE claims SET decision = 'confirmed' WHERE session_id = $1 AND id = $2`, [sessionId, id]);
  }

  async reject(sessionId: string, id: string): Promise<void> {
    await this.pool.query(`UPDATE claims SET decision = 'rejected' WHERE session_id = $1 AND id = $2`, [sessionId, id]);
  }

  async edit(sessionId: string, id: string, text: string): Promise<void> {
    await this.pool.query(
      `UPDATE claims SET text = $3, origin = 'user-authored', decision = 'confirmed' WHERE session_id = $1 AND id = $2`,
      [sessionId, id, text],
    );
  }

  async add(sessionId: string, claim: CandidateClaim): Promise<void> {
    await this.pool.query(
      `INSERT INTO claims (${CLAIM_COLS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (session_id, id) DO UPDATE SET
         role = EXCLUDED.role, text = EXCLUDED.text, machine_touch = EXCLUDED.machine_touch,
         classification = EXCLUDED.classification, source_quote = EXCLUDED.source_quote,
         needs_grill = EXCLUDED.needs_grill, grill_hint = EXCLUDED.grill_hint,
         decision = EXCLUDED.decision, origin = EXCLUDED.origin`,
      this.vals(sessionId, claim, "confirmed", "user-authored"),
    );
  }

  async negatives(sessionId: string): Promise<ClaimRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM claims WHERE session_id = $1 AND decision = 'negative' ORDER BY seq`,
      [sessionId],
    );
    return rows.map(toClaim);
  }

  async answerNegative(sessionId: string, claim: CandidateClaim): Promise<void> {
    await this.pool.query(
      `INSERT INTO claims (${CLAIM_COLS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (session_id, id) DO UPDATE SET
         role = EXCLUDED.role, text = EXCLUDED.text, machine_touch = EXCLUDED.machine_touch,
         classification = EXCLUDED.classification, source_quote = EXCLUDED.source_quote,
         needs_grill = EXCLUDED.needs_grill, grill_hint = EXCLUDED.grill_hint,
         decision = EXCLUDED.decision, origin = EXCLUDED.origin`,
      this.vals(sessionId, claim, "negative", "user-authored"),
    );
  }

  async reopen(sessionId: string, id: string): Promise<void> {
    await this.pool.query(`UPDATE claims SET decision = 'pending' WHERE session_id = $1 AND id = $2`, [sessionId, id]);
  }
}

/** Postgres when DATABASE_URL is set (JC-6), in-memory otherwise (dev/tests). */
export function claimStoreFromEnv(databaseUrl?: string): ClaimStore {
  return databaseUrl ? new PgClaimStore(getPool(databaseUrl)) : new InMemoryClaimStore();
}
