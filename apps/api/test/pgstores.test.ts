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
      expect(s.tailorFloorPct).toBe(0);
      expect(s.sourceEntry).toBeNull();
      expect(s.importProof).toBeNull();
      expect(s.importResolutions).toEqual({});
      expect(s.intent).toEqual({ targetRole: null, searchArea: null });
      expect(await store.getByToken(s.token)).toMatchObject({
        id: s.id,
        token: s.token,
        stage: "deck",
        tailorAdId: null,
        tailorFloorPct: 0,
        sourceEntry: null,
      });
      expect(await store.getById(s.id)).toMatchObject({ id: s.id });
      expect(await store.getByToken("nope")).toBeNull();
    });

    it("persists import proof and user resolutions", async () => {
      const s = await store.create();
      const proof = {
        outcome: "success" as const,
        usefulFactCount: 2,
        skippedQuestionCount: 2,
        representativeFacts: [
          { id: "role-acme", text: "Led Acme delivery", provenance: "cv" as const },
        ],
        conflict: null,
      };
      await store.setImportProof(s.id, proof);
      await store.setImportResolution(s.id, "role-acme", "Led global Acme delivery");

      expect(await store.getById(s.id)).toMatchObject({
        importProof: proof,
        importResolutions: { "role-acme": "Led global Acme delivery" },
      });
    });

    it("persists and restores no_useful_facts terminal proof", async () => {
      const s = await store.create();
      const proof = {
        outcome: "no_useful_facts" as const,
        usefulFactCount: 0,
        skippedQuestionCount: 0,
        representativeFacts: [],
        conflict: null,
      };
      await store.setImportProof(s.id, proof);
      expect((await store.getById(s.id))?.importProof).toEqual(proof);
    });

    it("does not lose concurrent import resolutions", async () => {
      const s = await store.create();
      await Promise.all([
        store.setImportResolution(s.id, "role-title", "Project Manager"),
        store.setImportResolution(s.id, "search-area", "Bangkok"),
      ]);
      expect((await store.getById(s.id))?.importResolutions).toEqual({
        "role-title": "Project Manager",
        "search-area": "Bangkok",
      });
    });

    it("persists a resolution and replacement proof as one store operation", async () => {
      const s = await store.create();
      const proof = {
        outcome: "success" as const,
        usefulFactCount: 1,
        skippedQuestionCount: 1,
        representativeFacts: [
          { id: "role-title", text: "Programme Manager", provenance: "cv" as const },
        ],
        conflict: null,
      };
      await store.setImportProof(s.id, proof);
      await store.resolveImport(s.id, "role-title", "Programme Manager");
      expect(await store.getById(s.id)).toMatchObject({
        importProof: proof,
        importResolutions: { "role-title": "Programme Manager" },
      });
    });

    it("merges concurrent proof overlays from current locked state", async () => {
      const s = await store.create();
      await store.setImportProof(s.id, {
        outcome: "success",
        usefulFactCount: 2,
        skippedQuestionCount: 0,
        representativeFacts: [
          { id: "role-title", text: "PM", provenance: "cv" },
          { id: "search-area", text: "London", provenance: "cv" },
        ],
        conflict: null,
      });
      await Promise.all([
        store.resolveImport(s.id, "role-title", "Programme Manager"),
        store.resolveImport(s.id, "search-area", "Bangkok"),
      ]);
      expect((await store.getById(s.id))?.importProof?.representativeFacts).toEqual([
        { id: "role-title", text: "Programme Manager", provenance: "cv" },
        { id: "search-area", text: "Bangkok", provenance: "cv" },
      ]);
    });

    it("rolls back a resolution when no current proof can be replaced", async () => {
      const s = await store.create();
      await expect(store.resolveImport(s.id, "role-title", "Programme Manager")).rejects.toThrow(
        /proof not ready/,
      );
      expect((await store.getById(s.id))?.importResolutions).toEqual({});
      expect((await store.getById(s.id))?.importProof).toBeNull();
    });

    it("persists intent atomically and merges partial updates", async () => {
      const s = await store.create();
      const both = await store.setIntent(s.id, {
        targetRole: "Programme Manager",
        searchArea: "Bangkok",
      });
      expect(both).toEqual({ targetRole: "Programme Manager", searchArea: "Bangkok" });
      expect((await store.getById(s.id))?.intent).toEqual(both);

      const merged = await store.setIntent(s.id, { searchArea: "Remote in Thailand" });
      expect(merged).toEqual({
        targetRole: "Programme Manager",
        searchArea: "Remote in Thailand",
      });
      expect((await store.getById(s.id))?.intent).toEqual(merged);

      const preserved = await store.setIntent(s.id, { targetRole: undefined });
      expect(preserved).toEqual({
        targetRole: "Programme Manager",
        searchArea: "Remote in Thailand",
      });
    });

    it("setSourceEntry persists last-write-wins", async () => {
      const s = await store.create();
      await store.setSourceEntry(s.id, { checkpoint: "invited", choice: null });
      expect((await store.getById(s.id))?.sourceEntry).toEqual({
        checkpoint: "invited",
        choice: null,
      });
      await store.setSourceEntry(s.id, { checkpoint: "source_selected", choice: "cv" });
      expect((await store.getById(s.id))?.sourceEntry).toEqual({
        checkpoint: "source_selected",
        choice: "cv",
      });
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

    // #23 — the monotonic re-score floor: raises only, never lowers.
    it("raiseTailorFloor raises the floor but never lowers it", async () => {
      const s = await store.create();
      await store.setTailorTarget(s.id, "ad-1");
      await store.raiseTailorFloor(s.id, 40);
      expect((await store.getById(s.id))?.tailorFloorPct).toBe(40);
      await store.raiseTailorFloor(s.id, 25); // lower — must not regress
      expect((await store.getById(s.id))?.tailorFloorPct).toBe(40);
      await store.raiseTailorFloor(s.id, 60);
      expect((await store.getById(s.id))?.tailorFloorPct).toBe(60);
    });

    it("setTailorTarget resets the floor to 0 — a new job starts fresh", async () => {
      const s = await store.create();
      await store.setTailorTarget(s.id, "ad-1");
      await store.raiseTailorFloor(s.id, 50);
      await store.setTailorTarget(s.id, "ad-2");
      expect((await store.getById(s.id))?.tailorFloorPct).toBe(0);
    });

    // D2 (QA-observed regression: drop + re-swipe the same card showed 29% -> 12%): re-targeting the
    // SAME ad must keep its floor — only a genuinely different ad resets it.
    it("setTailorTarget re-targeting the SAME ad keeps its floor (drop + re-swipe never regresses)", async () => {
      const s = await store.create();
      await store.setTailorTarget(s.id, "ad-1");
      await store.raiseTailorFloor(s.id, 29);
      await store.setTailorTarget(s.id, "ad-1"); // e.g. drop() then /want the same card again
      expect((await store.getById(s.id))?.tailorFloorPct).toBe(29);
      await store.setTailorTarget(s.id, "ad-2"); // a genuinely different ad still resets it
      expect((await store.getById(s.id))?.tailorFloorPct).toBe(0);
    });

    it("clearTailorTarget drops back to deck with no ad targeted", async () => {
      const s = await store.create();
      await store.setTailorTarget(s.id, "ad-1");
      await store.clearTailorTarget(s.id);
      const got = await store.getById(s.id);
      expect(got?.stage).toBe("deck");
      expect(got?.tailorAdId).toBeNull();
    });

    // #31 — drop() nulls tailorAdId, but the floor is keyed to tailorFloorAdId (the ad it was earned
    // on), not to tailorAdId — so a drop + re-swipe of the SAME card must not zero the floor either.
    it("drop + re-swipe the SAME ad keeps its floor (#31)", async () => {
      const s = await store.create();
      await store.setTailorTarget(s.id, "ad-1");
      await store.raiseTailorFloor(s.id, 65);
      await store.clearTailorTarget(s.id);
      expect((await store.getById(s.id))?.tailorAdId).toBeNull(); // 409-after-drop still depends on this
      await store.setTailorTarget(s.id, "ad-1");
      expect((await store.getById(s.id))?.tailorFloorPct).toBe(65);
    });

    it("drop then swiping a DIFFERENT ad still starts that ad fresh, no floor carried over (#31)", async () => {
      const s = await store.create();
      await store.setTailorTarget(s.id, "ad-1");
      await store.raiseTailorFloor(s.id, 65);
      await store.clearTailorTarget(s.id);
      await store.setTailorTarget(s.id, "ad-2");
      expect((await store.getById(s.id))?.tailorFloorPct).toBe(0);
    });

    it("touch doesn't throw and keeps the row", async () => {
      const s = await store.create();
      await store.touch(s.id);
      expect(await store.getById(s.id)).toBeTruthy();
    });

    // #33 — the profile badge's monotonic floor: raises only, never lowers. Same shape as #23's
    // raiseTailorFloor, unkeyed (there's only ever one factCount per session, no #31-style ad key).
    it("raiseFactFloor raises the floor but never lowers it", async () => {
      const s = await store.create();
      expect((await store.getById(s.id))?.factFloor).toBe(0);
      await store.raiseFactFloor(s.id, 3);
      expect((await store.getById(s.id))?.factFloor).toBe(3);
      await store.raiseFactFloor(s.id, 1); // lower — must not regress
      expect((await store.getById(s.id))?.factFloor).toBe(3);
      await store.raiseFactFloor(s.id, 5);
      expect((await store.getById(s.id))?.factFloor).toBe(5);
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

    it("preserves semantic_key through seed and correction upserts (#59)", async () => {
      await store.seed(sid, [claim({ id: "source-a", semantic_key: "requirement-one" })]);
      expect((await store.list(sid))[0]?.semantic_key).toBe("requirement-one");

      await store.add(sid, claim({ id: "source-a", semantic_key: "requirement-two" }));
      expect((await store.confirmed(sid))[0]?.semantic_key).toBe("requirement-two");

      await store.answerNegative(sid, claim({ id: "source-a", semantic_key: "requirement-three" }));
      expect((await store.negatives(sid))[0]?.semantic_key).toBe("requirement-three");
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

    // #28 — tailor.ts's ledger replays confirmed()+negatives() as one merged answer order via `seq`,
    // so both drivers must agree: it's a plain number, strictly increasing in the order each record
    // was FIRST created (add/answerNegative/seed), and a later correction must NOT bump it.
    describe("seq — the monotonic answer-order ordinal (#28)", () => {
      it("is a number, strictly increasing across add() calls in call order", async () => {
        await store.add(sid, claim({ id: "a" }));
        await store.add(sid, claim({ id: "b" }));
        const [a, b] = (await store.list(sid)).sort((x, y) => x.id.localeCompare(y.id));
        expect(typeof a.seq).toBe("number");
        expect(typeof b.seq).toBe("number");
        expect(b.seq!).toBeGreaterThan(a.seq!);
      });

      it("interleaves confirmed and negative answers in the order they actually landed", async () => {
        await store.add(sid, claim({ id: "yes-1" })); // lands 1st
        await store.answerNegative(sid, claim({ id: "no-1" })); // lands 2nd
        await store.add(sid, claim({ id: "yes-2" })); // lands 3rd
        const merged = [...(await store.confirmed(sid)), ...(await store.negatives(sid))].sort(
          (x, y) => x.seq! - y.seq!,
        );
        expect(merged.map((c) => c.id)).toEqual(["yes-1", "no-1", "yes-2"]);
      });

      it("confirmed() still follows creation seq, not decision order (#37)", async () => {
        await store.seed(sid, [claim({ id: "mined-a" }), claim({ id: "mined-b" })]);
        await store.add(sid, claim({ id: "tailor-answer" })); // decided first, created after the mined rows
        await store.confirm(sid, "mined-b"); // decided later, but created earlier

        expect((await store.list(sid)).map((c) => c.id)).toEqual(["mined-a", "mined-b", "tailor-answer"]);
        const confirmed = await store.confirmed(sid);
        expect(confirmed.map((c) => c.id)).toEqual(["mined-b", "tailor-answer"]);
        expect(
          [...confirmed]
            .sort((a, b) => (a.decisionSeq ?? 0) - (b.decisionSeq ?? 0))
            .map((c) => c.id),
        ).toEqual(["tailor-answer", "mined-b"]);
      });

      it("a correction (re-answer of the same id) keeps its ORIGINAL seq, not a bumped one", async () => {
        await store.answerNegative(sid, claim({ id: "grill-1" }));
        const before = (await store.negatives(sid))[0]!.seq;
        await store.add(sid, claim({ id: "other" })); // a later, unrelated answer — bumps the counter
        await store.add(sid, claim({ id: "grill-1" })); // corrects grill-1: negative -> confirmed
        const after = (await store.confirmed(sid)).find((c) => c.id === "grill-1")!.seq;
        expect(after).toBe(before); // unchanged — the correction didn't move it to "just now"
      });
    });
  });
}
