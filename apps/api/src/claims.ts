// JC-21 confirmed-claims store. Holds each session's mined candidate claims plus the deck/grill
// decisions made on them; the E4 spine reads back only the CONFIRMED subset (buildClaimGraph +
// the JC-31 gate). Same shape as sessions.ts: a record type, an async interface, an in-memory
// implementation (the Postgres driver lands with JC-6/JC-26 persistence). The store records
// decisions; it never bakes deck policy (which claims auto-approve) — that is the deck's job.
import type { CandidateClaim } from "@jobcrush/contracts";

export type ClaimDecision = "pending" | "confirmed" | "rejected";
// mined = straight from the CV; user-authored = the user edited it (deck) or typed it (grill).
export type ClaimOrigin = "mined" | "user-authored";

export interface ClaimRecord extends CandidateClaim {
  decision: ClaimDecision;
  origin: ClaimOrigin;
}

export interface ClaimStore {
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
}

export class InMemoryClaimStore implements ClaimStore {
  private bySession = new Map<string, Map<string, ClaimRecord>>();

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
    for (const c of claims) m.set(c.id, { ...c, decision: "pending", origin: "mined" });
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
}
