// E2/JC-20 — purge deletes only unclaimed anonymous sessions/claims past the TTL, plus spent/expired
// tokens and DISUSED judgement records (#105 — swept on last_used_at, not judged_at, so a stable
// number an active user keeps looking at is never re-rolled just because time passed); claimed data
// and fresh/active data survive. #118 adds the other half of that "survives" list: the usage ledger
// is retained indefinitely regardless of TTL, so this same run must leave a ledger row for the purged
// visitor untouched. Verified against Postgres (pg-mem).
import { describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import { PgSessionStore } from "../src/sessions.js";
import { PgClaimStore } from "../src/claims.js";
import { PgAuthStore } from "../src/auth.js";
import { PgJudgementStore } from "../src/judgementStore.js";
import { PgUsageLedgerStore } from "../src/usageLedgerStore.js";
import { runPurge } from "../src/purge.js";

describe("JC-20 runPurge", () => {
  it("removes stale unclaimed sessions/claims + spent tokens + stale judgements, keeps claimed + fresh", async () => {
    const { Pool } = newDb().adapters.createPg();
    const pool = new Pool();
    await new PgSessionStore(pool).init();
    await new PgClaimStore(pool).init();
    await new PgAuthStore(pool).init();
    await new PgJudgementStore(pool).init();
    await new PgUsageLedgerStore(pool).init();

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
    // #105 review round 2 — the property that matters: swept by DISUSE (last_used_at), not by age
    // since first judged (judged_at). A row nobody has looked at in 30 days is cold and purged, no
    // matter how recently it happened to be judged. A row judged 30 days ago that a claimed user keeps
    // actively viewing (last_used_at bumped forward on every read past a day stale — judgementStore.ts)
    // is NOT cold and must survive — this is the exact "unmoved by time alone" scenario the age-based
    // sweep got wrong: a returning user with unchanged facts must never come back to a re-judged number.
    const judgement = {
      verdicts: [{ requirementId: "r1", fit: 1, supportingFactId: null, reason: "x" }],
      version: "v1",
    };
    const cost = (judgedAt: string) => JSON.stringify({ model: "m", inputTokens: null, outputTokens: null, judgedAt });
    // Cold: judged long ago, never touched again → purged.
    await pool.query(
      `INSERT INTO card_judgements (ad_id, facts_fingerprint, verdicts, version, cost, judged_at, last_used_at)
       VALUES ('ad-cold', 'fp-cold', $1, $2, $3, $4, $4)`,
      [JSON.stringify(judgement.verdicts), judgement.version, cost(old), old],
    );
    // Actively used: judged long ago too, but recently touched (an active user still looking at it)
    // → must survive, even though it's just as OLD as the cold row above by judged_at alone.
    await pool.query(
      `INSERT INTO card_judgements (ad_id, facts_fingerprint, verdicts, version, cost, judged_at, last_used_at)
       VALUES ('ad-active', 'fp-active', $1, $2, $3, $4, now())`,
      [JSON.stringify(judgement.verdicts), judgement.version, cost(old), old],
    );
    // Fresh: judged and used just now → survives trivially.
    await pool.query(
      `INSERT INTO card_judgements (ad_id, facts_fingerprint, verdicts, version, cost, judged_at, last_used_at)
       VALUES ('ad-fresh', 'fp-fresh', $1, $2, $3, now(), now())`,
      [JSON.stringify(judgement.verdicts), judgement.version, cost(new Date().toISOString())],
    );
    // #118: a usage-ledger row attributed to the SAME visitor as the stale, about-to-be-purged
    // session — the property that matters is that this survives untouched. runPurge deletes the
    // content-bearing session/claims for 'stale', but the owner's #118 decision is to retain spend
    // indefinitely: the ledger is a different table this function must never reach into.
    await pool.query(
      `INSERT INTO llm_usage_ledger (visitor_id, stage, model, input_tokens, output_tokens, measured, cost_usd, created_at)
       VALUES ('stale', 'judging', 'claude-sonnet-5', 900, 150, true, 0.0057, $1)`,
      [old],
    );

    const { sessions } = await runPurge(pool, 14);
    expect(sessions).toBe(1); // only 'stale' deleted

    const surviving = (await pool.query(`SELECT id FROM sessions ORDER BY id`)).rows.map((r) => r.id);
    expect(surviving).toEqual(["fresh", "owned"]);
    expect((await pool.query(`SELECT count(*)::int AS n FROM claims`)).rows[0].n).toBe(0);
    expect((await pool.query(`SELECT token_hash FROM login_tokens`)).rows.map((r) => r.token_hash)).toEqual(["h2"]);
    const survivingJudgements = (await pool.query(`SELECT ad_id FROM card_judgements ORDER BY ad_id`)).rows.map((r) => r.ad_id);
    expect(survivingJudgements).toEqual(["ad-active", "ad-fresh"]); // ad-cold gone; ad-active survives despite being judged just as long ago

    // #118: the ledger row survives intact — same visitor id, same cost — even though the session it
    // was attributed to is now gone. Content purged, spend retained; runPurge never touched this row.
    const ledgerRows = (await pool.query(`SELECT visitor_id, cost_usd FROM llm_usage_ledger`)).rows;
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]!.visitor_id).toBe("stale");
    expect(Number(ledgerRows[0]!.cost_usd)).toBeCloseTo(0.0057, 8);
  });
});
