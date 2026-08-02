// #105 (E5 slice 4) — the shared judgement cache, run against both drivers like the other stores
// (pg-mem is an in-process Postgres, so the real SQL is exercised without a live DB).
import { beforeEach, describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import {
  InMemoryJudgementStore,
  PgJudgementStore,
  type JudgementRecord,
  type JudgementStore,
} from "../src/judgementStore.js";

function pgPool() {
  const { Pool } = newDb().adapters.createPg();
  return new Pool();
}

const record = (over: Partial<JudgementRecord> = {}): JudgementRecord => ({
  verdicts: [
    { requirementId: "own-budget", fit: 0.9, supportingFactId: "fact-1", reason: "Close match." },
    { requirementId: "certification", fit: 0, supportingFactId: null, reason: "No evidence." },
  ],
  version: "card-judge/1+judge/1",
  cost: { model: "claude-sonnet-5", inputTokens: 900, outputTokens: 180, judgedAt: "2026-08-02T00:00:00.000Z" },
  ...over,
});

const drivers: [string, () => JudgementStore][] = [
  ["in-memory", () => new InMemoryJudgementStore()],
  ["postgres (pg-mem)", () => new PgJudgementStore(pgPool())],
];

for (const [name, make] of drivers) {
  describe(`JudgementStore contract — ${name}`, () => {
    let store: JudgementStore;
    beforeEach(async () => {
      store = make();
      await store.init();
    });

    it("get on an unjudged (adId, fingerprint) is null", async () => {
      expect(await store.get("ad-1", "fp-1")).toBeNull();
    });

    it("put -> get round-trips the verdicts, version, and full cost record", async () => {
      await store.put("ad-1", "fp-1", record());
      expect(await store.get("ad-1", "fp-1")).toEqual(record());
    });

    // #86's cost AC: real measured numbers, never an estimate presented as measured.
    it("a null token count round-trips as null, never a fabricated number", async () => {
      await store.put(
        "ad-1",
        "fp-1",
        record({ cost: { model: "sonnet", inputTokens: null, outputTokens: null, judgedAt: "2026-08-02T00:00:00.000Z" } }),
      );
      const got = await store.get("ad-1", "fp-1");
      expect(got?.cost.inputTokens).toBeNull();
      expect(got?.cost.outputTokens).toBeNull();
    });

    // #105 decision 3: keyed by (adId, factsFingerprint), NOT adId alone — two distinct fact sets
    // for the same ad are two independent rows, never overwriting each other.
    it("the SAME ad at a DIFFERENT fingerprint is an independent record", async () => {
      await store.put("ad-1", "fp-1", record());
      expect(await store.get("ad-1", "fp-2")).toBeNull();
      await store.put("ad-1", "fp-2", record({ verdicts: [{ requirementId: "own-budget", fit: 0.2, supportingFactId: null, reason: "Different facts, different fit." }, record().verdicts[1]!] }));
      expect((await store.get("ad-1", "fp-1"))?.verdicts).toEqual(record().verdicts);
      expect((await store.get("ad-1", "fp-2"))?.verdicts[0]?.fit).toBe(0.2);
    });

    it("a re-judge at the SAME (adId, fingerprint) replaces the prior record, never accumulating a history", async () => {
      await store.put("ad-1", "fp-1", record({ version: "card-judge/1+judge/1" }));
      await store.put("ad-1", "fp-1", record({ version: "card-judge/2+judge/1" }));
      expect((await store.get("ad-1", "fp-1"))?.version).toBe("card-judge/2+judge/1");
    });

    it("different ads are independent even at the same fingerprint", async () => {
      await store.put("ad-1", "fp-1", record());
      expect(await store.get("ad-2", "fp-1")).toBeNull();
    });

    // #104 review finding 3's pattern, applied here too: a row written under a prior contract that
    // the CURRENT schema now rejects must read as a cache miss, never a thrown error, so the version
    // check the caller does next (judge.ts's makeJudge) gets the chance to fire and re-judge.
    it("a stored row the CURRENT schema rejects reads as a cache miss, not a thrown error", async () => {
      await store.put("ad-1", "fp-1", record({ verdicts: [{ requirementId: "own-budget" } as never] }));
      await expect(store.get("ad-1", "fp-1")).resolves.toBeNull();
    });
  });
}

// #105 review round 2 — disuse-based purge (Postgres-only: last_used_at is a real column the
// InMemory driver has no need to track, since in-memory data is wiped on restart and never purged).
// The property that matters: an actively-used row's clock keeps resetting, so it structurally cannot
// go cold under a returning user, while a genuinely idle row is left alone to age normally.
describe("PgJudgementStore — the disuse touch (last_used_at)", () => {
  it("bumps last_used_at forward on a read once it's stale by a day or more", async () => {
    const pool = pgPool();
    const store = new PgJudgementStore(pool);
    await store.init();
    await store.put("ad-1", "fp-1", record());
    const stale = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    await pool.query(
      `UPDATE card_judgements SET last_used_at = $1 WHERE ad_id = 'ad-1' AND facts_fingerprint = 'fp-1'`,
      [stale],
    );

    await store.get("ad-1", "fp-1");

    const row = (
      await pool.query(`SELECT last_used_at FROM card_judgements WHERE ad_id = 'ad-1' AND facts_fingerprint = 'fp-1'`)
    ).rows[0];
    expect(new Date(row.last_used_at as string).getTime()).toBeGreaterThan(new Date(stale).getTime());
  });

  // #105 review: "don't make it a write on every single cache hit if you can cheaply avoid it" — a
  // row already touched within the last day must not be re-written on a further read.
  it("does NOT write on a read when last_used_at is already fresh — not a write on every hit", async () => {
    const pool = pgPool();
    const store = new PgJudgementStore(pool);
    await store.init();
    await store.put("ad-1", "fp-1", record());
    const before = (
      await pool.query(`SELECT last_used_at FROM card_judgements WHERE ad_id = 'ad-1' AND facts_fingerprint = 'fp-1'`)
    ).rows[0].last_used_at as string;

    await store.get("ad-1", "fp-1");

    const after = (
      await pool.query(`SELECT last_used_at FROM card_judgements WHERE ad_id = 'ad-1' AND facts_fingerprint = 'fp-1'`)
    ).rows[0].last_used_at as string;
    expect(after).toEqual(before); // unchanged — no redundant UPDATE fired
  });
});
