// JC-6 — the session + claim stores must behave identically in-memory and on Postgres. One contract,
// run against both drivers (Postgres via pg-mem, an in-process Postgres, so the real SQL is exercised
// in CI without a live DB). If the SQL is wrong, these fail here — before it reaches staging.
import { beforeEach, describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import type { CandidateClaim } from "@jobcrush/contracts";
import { InMemorySessionStore, PgSessionStore, type SessionStore } from "../src/sessions.js";
import { InMemoryClaimStore, PgClaimStore, type ClaimStore } from "../src/claims.js";

function pgPool() {
  const { Pool } = newDb().adapters.createPg();
  return new Pool();
}

const sessionDrivers: [string, () => SessionStore][] = [
  ["in-memory", () => new InMemorySessionStore()],
  ["postgres (pg-mem)", () => new PgSessionStore(pgPool())],
];

for (const [name, make] of sessionDrivers) {
  describe(`SessionStore contract — ${name}`, () => {
    let store: SessionStore;
    beforeEach(async () => {
      store = make();
      await store.init();
    });

    it("create → getByToken/getById round-trips; unknown token is null", async () => {
      const s = await store.create();
      expect(s.stage).toBe("deck");
      expect(s.tailorAdId).toBeNull();
      expect(await store.getByToken(s.token)).toMatchObject({
        id: s.id,
        token: s.token,
        stage: "deck",
        tailorAdId: null,
      });
      expect(await store.getById(s.id)).toMatchObject({ id: s.id });
      expect(await store.getByToken("nope")).toBeNull();
    });

    it("setStage + setTargetTitles persist", async () => {
      const s = await store.create();
      await store.setStage(s.id, "ready");
      await store.setTargetTitles(s.id, ["PM", "BA"]);
      const got = await store.getById(s.id);
      expect(got?.stage).toBe("ready");
      expect(got?.targetTitles).toEqual(["PM", "BA"]);
    });

    it("setTailorTarget persists the tailor stage and selected ad id together", async () => {
      const s = await store.create();
      await store.setTailorTarget(s.id, "ad-1");
      const got = await store.getById(s.id);
      expect(got?.stage).toBe("tailor");
      expect(got?.tailorAdId).toBe("ad-1");
    });

    it("touch doesn't throw and keeps the row", async () => {
      const s = await store.create();
      await store.touch(s.id);
      expect(await store.getById(s.id)).toBeTruthy();
    });
  });
}

const claim = (over: Partial<CandidateClaim>): CandidateClaim => ({
  id: "acme-led",
  role: "PM - Acme",
  text: "Led X",
  machine_touch: "verbatim",
  classification: "Verified",
  source_quote: "led x",
  needs_grill: false,
  grill_hint: null,
  ...over,
});

const claimDrivers: [string, () => ClaimStore][] = [
  ["in-memory", () => new InMemoryClaimStore()],
  ["postgres (pg-mem)", () => new PgClaimStore(pgPool())],
];

for (const [name, make] of claimDrivers) {
  describe(`ClaimStore contract — ${name}`, () => {
    let store: ClaimStore;
    const sid = "sess-1";
    beforeEach(async () => {
      store = make();
      await store.init();
    });

    it("seed → list preserves CV order as pending; confirmed is the confirmed subset in order", async () => {
      await store.seed(sid, [claim({ id: "a" }), claim({ id: "b" }), claim({ id: "c" })]);
      const listed = await store.list(sid);
      expect(listed.map((c) => c.id)).toEqual(["a", "b", "c"]);
      expect(listed.every((c) => c.decision === "pending" && c.origin === "mined")).toBe(true);
      await store.confirm(sid, "c");
      await store.confirm(sid, "a");
      expect((await store.confirmed(sid)).map((c) => c.id)).toEqual(["a", "c"]); // still seq order
    });

    it("seed is idempotent — re-seeding never clobbers a decision", async () => {
      await store.seed(sid, [claim({ id: "a" })]);
      await store.confirm(sid, "a");
      await store.seed(sid, [claim({ id: "a" })]);
      expect((await store.list(sid))[0].decision).toBe("confirmed");
    });

    it("reject drops from confirmed; edit → user-authored + confirmed with the new text", async () => {
      await store.seed(sid, [claim({ id: "a" }), claim({ id: "b" })]);
      await store.reject(sid, "a");
      await store.edit(sid, "b", "new text");
      const b = (await store.list(sid)).find((c) => c.id === "b")!;
      expect(b).toMatchObject({ text: "new text", origin: "user-authored", decision: "confirmed" });
      expect((await store.confirmed(sid)).map((c) => c.id)).toEqual(["b"]);
    });

    it("add is a confirmed user-authored claim; re-add upserts (grill re-answer)", async () => {
      await store.add(sid, claim({ id: "grill-1", text: "first" }));
      await store.add(sid, claim({ id: "grill-1", text: "second" }));
      const c = (await store.confirmed(sid)).find((x) => x.id === "grill-1")!;
      expect(c).toMatchObject({ text: "second", origin: "user-authored", decision: "confirmed" });
    });

    it("claims are session-scoped", async () => {
      await store.seed(sid, [claim({ id: "a" })]);
      expect(await store.list("other-session")).toEqual([]);
    });

    // #13 — the "no" write path + fact correction, proven on both drivers.
    it("answerNegative persists a negative — distinct from rejected, absent from confirmed, present in negatives", async () => {
      await store.answerNegative(sid, claim({ id: "grill-1", text: "No PMP certification." }));
      const [c] = await store.list(sid);
      expect(c).toMatchObject({ decision: "negative", origin: "user-authored" });
      expect(await store.confirmed(sid)).toEqual([]);
      expect((await store.negatives(sid)).map((x) => x.id)).toEqual(["grill-1"]);
    });

    it("reopen flips a negative back to pending — leaves negatives() and stays unconfirmed", async () => {
      await store.answerNegative(sid, claim({ id: "grill-1" }));
      await store.reopen(sid, "grill-1");
      expect(await store.negatives(sid)).toEqual([]);
      expect(await store.confirmed(sid)).toEqual([]);
      expect((await store.list(sid))[0].decision).toBe("pending");
    });
  });
}
