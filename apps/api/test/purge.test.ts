// E2/JC-20 — purge deletes only unclaimed anonymous sessions/claims past the TTL, plus spent/expired
// tokens; claimed data and fresh data survive. Verified against Postgres (pg-mem).
import { describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import { PgSessionStore } from "../src/sessions.js";
import { PgClaimStore } from "../src/claims.js";
import { PgAuthStore } from "../src/auth.js";
import { runPurge } from "../src/purge.js";

describe("JC-20 runPurge", () => {
  it("removes stale unclaimed sessions/claims + spent tokens, keeps claimed + fresh", async () => {
    const { Pool } = newDb().adapters.createPg();
    const pool = new Pool();
    await new PgSessionStore(pool).init();
    await new PgClaimStore(pool).init();
    await new PgAuthStore(pool).init();

    const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
    // stale + unclaimed → purged (and its claim)
    await pool.query(`INSERT INTO sessions (id, token, last_seen_at) VALUES ('stale', 't1', $1)`, [old]);
    await pool.query(
      `INSERT INTO claims (session_id, id, role, text, machine_touch, classification, source_quote, needs_grill, decision, origin)
       VALUES ('stale', 'c1', 'r', 't', 'verbatim', 'Verified', 'q', false, 'confirmed', 'mined')`,
    );
    // stale but CLAIMED → survives
    await pool.query(`INSERT INTO sessions (id, token, last_seen_at, claimed_by_user_id) VALUES ('owned', 't2', $1, 'user-1')`, [old]);
    // fresh unclaimed → survives (not past TTL)
    await pool.query(`INSERT INTO sessions (id, token) VALUES ('fresh', 't3')`);
    // expired token → purged; live token → kept
    await pool.query(`INSERT INTO login_tokens (token_hash, email, expires_at) VALUES ('h1', 'e', $1)`, [old]);
    await pool.query(`INSERT INTO login_tokens (token_hash, email, expires_at) VALUES ('h2', 'e', $1)`, [new Date(Date.now() + 3_600_000).toISOString()]);

    const { sessions } = await runPurge(pool, 14);
    expect(sessions).toBe(1); // only 'stale' deleted

    const surviving = (await pool.query(`SELECT id FROM sessions ORDER BY id`)).rows.map((r) => r.id);
    expect(surviving).toEqual(["fresh", "owned"]);
    expect((await pool.query(`SELECT count(*)::int AS n FROM claims`)).rows[0].n).toBe(0);
    expect((await pool.query(`SELECT token_hash FROM login_tokens`)).rows.map((r) => r.token_hash)).toEqual(["h2"]);
  });
});
