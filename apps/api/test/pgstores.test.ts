// JC-6 — the session + claim stores must behave identically in-memory and on Postgres. One contract,
// run against both drivers (Postgres via pg-mem, an in-process Postgres, so the real SQL is exercised
// in CI without a live DB). If the SQL is wrong, these fail here — before it reaches staging.
import { beforeEach, describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import type { CandidateClaim, ProviderPostingRecordV1 } from "@jobcrush/contracts";
import {
  InMemorySessionStore,
  PgSessionStore,
  RETRIEVAL_CLAIM_LEASE_MS,
  retrievalClaimWindow,
  type SessionStore,
} from "../src/sessions.js";
import { InMemoryClaimStore, PgClaimStore, type ClaimStore } from "../src/claims.js";
import { InMemoryPostingStore, PgPostingStore, type PostingStore } from "../src/postingStore.js";
import { readCounters, resetCountersForTest } from "../src/counters.js";

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
      expect(s.discovery).toEqual({
        floor: null,
        coveredItemIds: [],
        checkpoint: null,
      });
      expect(s.retrieval).toBeNull();
      expect(s.retrievalCoordinationFingerprint).toBeNull();
      expect(s.retrievalGeneration).toBe(0);
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

    it("persists retrieval snapshots and invalidates only retrieval when intent actually changes", async () => {
      const s = await store.create();
      await store.setIntent(s.id, { targetRole: "Programme Manager", searchArea: "Hong Kong" });
      await store.reconcileDiscoveryState(
        s.id,
        { familyId: "it-project-delivery", version: 1 },
        ["end-to-end-delivery"],
        true,
      );
      const snapshot = {
        requestFingerprint: "intent-v1",
        recordedAt: "2026-08-09T00:00:00.000Z",
        result: {
          schemaVersion: "4" as const,
          outcome: "provider_unavailable" as const,
          coverage: {
            providersQueried: [],
            providersUnavailable: ["techmap"],
            complete: false,
          },
          reason: "timeout",
          retryable: true,
        },
      };
      const generation = (await store.getById(s.id))!.retrievalGeneration;
      expect(
        await store.beginRetrievalState(
          s.id,
          generation,
          "intent-v1",
          null,
          "owner-1",
          "2026-08-09T00:00:00.000Z",
          "2026-08-08T23:59:00.000Z",
        ),
      ).toBe(true);
      expect(
        await store.beginRetrievalState(
          s.id,
          generation,
          "intent-v1",
          null,
          "owner-2",
          "2026-08-09T00:00:01.000Z",
          "2026-08-08T23:59:01.000Z",
        ),
      ).toBe(false);
      expect(
        await store.reconcileRetrievalState(s.id, generation, "intent-v1", "owner-1", snapshot),
      ).toBe(true);
      expect(await store.getByToken(s.token)).toMatchObject({
        retrieval: snapshot,
        retrievalCoordinationFingerprint: "intent-v1",
      });
      // A second worker that read retrieval:null before the commit cannot claim after it.
      expect(
        await store.beginRetrievalState(
          s.id,
          generation,
          "intent-v1",
          null,
          "stale-reader",
          "2026-08-09T00:00:02.000Z",
          "2026-08-08T23:59:02.000Z",
        ),
      ).toBe(false);

      await store.setIntent(s.id, { targetRole: "Programme Manager" });
      expect((await store.getById(s.id))?.retrieval).toEqual(snapshot);

      await store.setIntent(s.id, { searchArea: "Singapore" });
      expect(await store.getById(s.id)).toMatchObject({
        intent: { targetRole: "Programme Manager", searchArea: "Singapore" },
        retrieval: null,
        retrievalCoordinationFingerprint: null,
        discovery: {
          floor: { familyId: "it-project-delivery", version: 1 },
          coveredItemIds: ["end-to-end-delivery"],
          checkpoint: "essential_floor_covered",
        },
      });
    });

    it("compare-and-set rejects an old in-flight result after intent changes", async () => {
      const s = await store.create();
      await store.setIntent(s.id, { targetRole: "Programme Manager", searchArea: "Hong Kong" });
      const before = (await store.getById(s.id))!;
      expect(
        await store.beginRetrievalState(
          s.id,
          before.retrievalGeneration,
          "old-request",
          null,
          "owner-old",
          "2026-08-09T00:00:00.000Z",
          "2026-08-08T23:59:00.000Z",
        ),
      ).toBe(true);

      await store.setIntent(s.id, { searchArea: "Singapore" });
      const accepted = await store.reconcileRetrievalState(
        s.id,
        before.retrievalGeneration,
        "old-request",
        "owner-old",
        {
          requestFingerprint: "old-request",
          recordedAt: "2026-08-09T00:00:00.000Z",
          result: { schemaVersion: "4", outcome: "invalid_request", code: "search_area_not_covered" },
        },
      );
      expect(accepted).toBe(false);
      expect((await store.getById(s.id))?.retrieval).toBeNull();
    });

    it("a discovery checkpoint transition invalidates retrieval and rejects the older generation", async () => {
      const s = await store.create();
      await store.setIntent(s.id, { targetRole: "Programme Manager", searchArea: "Hong Kong" });
      await store.reconcileDiscoveryState(
        s.id,
        { familyId: "it-project-delivery", version: 1 },
        ["end-to-end-delivery"],
        false,
      );
      const before = (await store.getById(s.id))!;
      expect(
        await store.beginRetrievalState(
          s.id,
          before.retrievalGeneration,
          "before-checkpoint",
          null,
          "owner-checkpoint",
          "2026-08-09T00:00:00.000Z",
          "2026-08-08T23:59:00.000Z",
        ),
      ).toBe(true);
      await store.reconcileDiscoveryState(
        s.id,
        { familyId: "it-project-delivery", version: 1 },
        ["end-to-end-delivery", "stakeholder-coordination"],
        true,
      );
      expect(
        await store.reconcileRetrievalState(
          s.id,
          before.retrievalGeneration,
          "before-checkpoint",
          "owner-checkpoint",
          {
            requestFingerprint: "before-checkpoint",
            recordedAt: "2026-08-09T00:00:00.000Z",
            result: { schemaVersion: "4", outcome: "invalid_request", code: "floor_not_covered" },
          },
        ),
      ).toBe(false);
      expect(await store.getById(s.id)).toMatchObject({
        retrieval: null,
        discovery: { checkpoint: "essential_floor_covered" },
      });
    });

    it("allows a new owner to recover an abandoned claim after the lease, never before", async () => {
      const s = await store.create();
      expect(
        await store.beginRetrievalState(
          s.id,
          0,
          "request",
          null,
          "owner-abandoned",
          "2026-08-09T00:00:00.000Z",
          "2026-08-08T23:59:00.000Z",
        ),
      ).toBe(true);
      expect(
        await store.beginRetrievalState(
          s.id,
          0,
          "request",
          null,
          "owner-early",
          "2026-08-09T00:00:59.000Z",
          "2026-08-08T23:59:59.000Z",
        ),
      ).toBe(false);
      expect(
        await store.beginRetrievalState(
          s.id,
          0,
          "request",
          null,
          "owner-recovery",
          "2026-08-09T00:01:01.000Z",
          "2026-08-09T00:00:01.000Z",
        ),
      ).toBe(true);
      const snapshot = {
        requestFingerprint: "request",
        recordedAt: "2026-08-09T00:01:01.000Z",
        result: { schemaVersion: "4" as const, outcome: "invalid_request" as const, code: "missing_intent" as const },
      };
      expect(await store.reconcileRetrievalState(s.id, 0, "request", "owner-abandoned", snapshot)).toBe(false);
      expect(await store.reconcileRetrievalState(s.id, 0, "request", "owner-recovery", snapshot)).toBe(true);
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

    it("persists and restores the selected production floor and coverage checkpoint", async () => {
      const s = await store.create();
      await store.reconcileDiscoveryState(
        s.id,
        { familyId: "it-project-delivery", version: 1 },
        ["end-to-end-delivery"],
        false,
      );
      expect((await store.getById(s.id))?.discovery).toEqual({
        floor: { familyId: "it-project-delivery", version: 1 },
        coveredItemIds: ["end-to-end-delivery"],
        checkpoint: "family_confirmed",
      });

      await store.reconcileDiscoveryState(
        s.id,
        { familyId: "it-project-delivery", version: 1 },
        ["stakeholder-coordination"],
        true,
      );
      expect((await store.getByToken(s.token))?.discovery).toEqual({
        floor: { familyId: "it-project-delivery", version: 1 },
        coveredItemIds: ["stakeholder-coordination"],
        checkpoint: "essential_floor_covered",
      });

      await store.reconcileDiscoveryState(
        s.id,
        { familyId: "it-project-delivery", version: 1 },
        [],
        false,
      );
      expect((await store.getById(s.id))?.discovery).toEqual({
        floor: { familyId: "it-project-delivery", version: 1 },
        coveredItemIds: [],
        checkpoint: "family_confirmed",
      });

      await Promise.all([
        store.reconcileDiscoveryState(
          s.id,
          { familyId: "it-project-delivery", version: 1 },
          ["end-to-end-delivery"],
          false,
        ),
        store.reconcileDiscoveryState(
          s.id,
          { familyId: "it-project-delivery", version: 1 },
          ["risk-dependency-control"],
          true,
        ),
      ]);
      const concurrent = (await store.getById(s.id))!.discovery;
      expect(concurrent.floor).toEqual({ familyId: "it-project-delivery", version: 1 });
      expect([
        {
          coveredItemIds: ["end-to-end-delivery"],
          checkpoint: "family_confirmed",
        },
        {
          coveredItemIds: ["risk-dependency-control"],
          checkpoint: "essential_floor_covered",
        },
      ]).toContainEqual({
        coveredItemIds: concurrent.coveredItemIds,
        checkpoint: concurrent.checkpoint,
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

    it("preserves the structured-field trio through seed and both upsert paths (#86)", async () => {
      // pipeline.ts keys local conflict detection on field_key and server.ts resolves import
      // identity by it, but the Pg store dropped all three on write and hardcoded them to null on
      // read — so structured facts worked in-memory and vanished in production. In-memory passed
      // because it spreads the whole claim; only the real SQL exercised here catches it.
      const structured = {
        field_key: "years-experience",
        field_value: "8",
        field_label: "Years in IT project delivery",
      };

      await store.seed(sid, [claim({ id: "yrs", ...structured })]);
      expect((await store.list(sid))[0]).toMatchObject(structured);

      await store.add(sid, claim({ id: "yrs", ...structured, field_value: "9" }));
      expect((await store.confirmed(sid))[0]).toMatchObject({ ...structured, field_value: "9" });

      await store.answerNegative(sid, claim({ id: "yrs", ...structured, field_value: "10" }));
      expect((await store.negatives(sid))[0]).toMatchObject({ ...structured, field_value: "10" });
    });

    it("a claim with no structured field round-trips as null, not undefined", async () => {
      await store.seed(sid, [claim({ id: "plain" })]);
      const [row] = await store.list(sid);
      expect(row.field_key).toBeNull();
      expect(row.field_value).toBeNull();
      expect(row.field_label).toBeNull();
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

// #100 — the provider-posting store's re-fetch semantics (§2.6), proven on both drivers.
function providerRecord(over: Partial<ProviderPostingRecordV1>): ProviderPostingRecordV1 {
  return {
    schemaVersion: "3",
    providerId: "techmap",
    providerPostingId: "tm-1",
    title: "Senior Project Manager",
    company: "BNP Paribas",
    location: "Hong Kong",
    sourceUrl: "https://jobdatafeeds.com/jobs/senior-project-manager",
    excerpt: "Lead delivery of a portfolio of technology programs across APAC.",
    postedAt: "2026-07-28T00:00:00Z",
    capturedAt: "2026-07-29T09:00:00Z",
    verifiedLiveAt: "2026-08-01T09:00:00Z",
    expiresAt: "2026-09-01T00:00:00Z",
    attribution: null,
    skills: [],
    language: "en",
    ...over,
  };
}

const postingDrivers: [string, () => PostingStore][] = [
  ["in-memory", () => new InMemoryPostingStore()],
  ["postgres (pg-mem)", () => new PgPostingStore(pgPool())],
];

for (const [name, make] of postingDrivers) {
  describe(`PostingStore contract — ${name} (#100, §2.6)`, () => {
    let store: PostingStore;
    beforeEach(async () => {
      store = make();
      await store.init();
      resetCountersForTest();
    });

    it("upsert then get round-trips; unknown key is null", async () => {
      const record = providerRecord({});
      await store.upsert(record);
      expect(await store.get("techmap", "tm-1")).toMatchObject({
        providerId: "techmap",
        providerPostingId: "tm-1",
        title: "Senior Project Manager",
      });
      expect(await store.get("techmap", "does-not-exist")).toBeNull();
      expect(await store.get("curated-pool", "tm-1")).toBeNull(); // scoped by providerId too
    });

    it("re-fetching the SAME posting does not duplicate it — listByProvider stays length 1", async () => {
      await store.upsert(providerRecord({}));
      await store.upsert(providerRecord({ title: "Senior Project Manager (Updated)" }));
      expect(await store.listByProvider("techmap")).toHaveLength(1);
    });

    it("§2.6: capturedAt is preserved as the EARLIEST across re-fetches; verifiedLiveAt advances to the LATEST", async () => {
      await store.upsert(
        providerRecord({ capturedAt: "2026-07-29T09:00:00Z", verifiedLiveAt: "2026-07-29T09:00:00Z" }),
      );
      const reFetched = await store.upsert(
        providerRecord({
          capturedAt: "2026-08-01T00:00:00Z", // a later "first captured" claim must NOT win
          verifiedLiveAt: "2026-08-02T00:00:00Z", // a fresher liveness confirmation must win
          title: "Senior Project Manager (Updated)",
        }),
      );
      // Compared by INSTANT, not exact string: Postgres round-trips a timestamptz through
      // Date#toISOString() (always carrying milliseconds, ".000Z"), while the in-memory driver
      // preserves the input string verbatim — both are correct §2.6 semantics, they just format the
      // same instant differently, and this proves the MERGE, not a driver's string formatting.
      const sameInstant = (a: string, b: string) => new Date(a).getTime() === new Date(b).getTime();
      expect(sameInstant(reFetched.capturedAt, "2026-07-29T09:00:00Z")).toBe(true);
      expect(sameInstant(reFetched.verifiedLiveAt, "2026-08-02T00:00:00Z")).toBe(true);
      expect(reFetched.title).toBe("Senior Project Manager (Updated)"); // every other field: fresh wins

      const stored = await store.get("techmap", "tm-1");
      expect(sameInstant(stored!.capturedAt, "2026-07-29T09:00:00Z")).toBe(true);
      expect(sameInstant(stored!.verifiedLiveAt, "2026-08-02T00:00:00Z")).toBe(true);
    });

    it("§2.6: an out-of-order re-fetch (an EARLIER verifiedLiveAt arriving after a LATER one) still keeps the latest, never regresses", async () => {
      await store.upsert(providerRecord({ verifiedLiveAt: "2026-08-05T00:00:00Z" }));
      const result = await store.upsert(providerRecord({ verifiedLiveAt: "2026-08-01T00:00:00Z" }));
      expect(new Date(result.verifiedLiveAt).getTime()).toBe(new Date("2026-08-05T00:00:00Z").getTime());
    });

    it("listByProvider is scoped — does not leak another provider's records", async () => {
      await store.upsert(providerRecord({ providerId: "techmap", providerPostingId: "tm-1" }));
      await store.upsert(providerRecord({ providerId: "curated-pool", providerPostingId: "c-1" }));
      expect((await store.listByProvider("techmap")).map((r) => r.providerPostingId)).toEqual(["tm-1"]);
      expect((await store.listByProvider("curated-pool")).map((r) => r.providerPostingId)).toEqual(["c-1"]);
    });

    it("persists a per-provider/per-region operator refresh marker without cross-region leakage", async () => {
      expect(await store.getRegionRefresh("curated-pool", "HK")).toBeNull();
      await store.markRegionRefreshed("curated-pool", "HK", "2026-08-09T00:00:00.000Z");
      expect(await store.getRegionRefresh("curated-pool", "HK")).toBe("2026-08-09T00:00:00.000Z");
      await store.markRegionRefreshed("curated-pool", "HK", "2026-08-08T23:30:00-01:00");
      expect(await store.getRegionRefresh("curated-pool", "HK")).toBe("2026-08-09T00:30:00.000Z");
      expect(await store.getRegionRefresh("curated-pool", "VN")).toBeNull();
      expect(await store.getRegionRefresh("techmap", "HK")).toBeNull();
    });

    describe("#132 durable monthly provider-call budget", () => {
      it("starts each calendar month at zero and keeps provider/month counts separate", async () => {
        expect(await store.getMonthlyCallCount("techmap", "2026-08")).toBe(0);
        expect(await store.reserveMonthlyCall("techmap", "2026-08", 2)).toBe(true);
        expect(await store.reserveMonthlyCall("techmap", "2026-08", 2)).toBe(true);
        expect(await store.reserveMonthlyCall("techmap", "2026-08", 2)).toBe(false);
        expect(await store.getMonthlyCallCount("techmap", "2026-08")).toBe(2);

        expect(await store.getMonthlyCallCount("techmap", "2026-09")).toBe(0);
        expect(await store.reserveMonthlyCall("techmap", "2026-09", 2)).toBe(true);
        expect(await store.getMonthlyCallCount("techmap", "2026-09")).toBe(1);
        expect(await store.getMonthlyCallCount("curated-pool", "2026-08")).toBe(0);
      });

      it("atomically refuses concurrent reservations beyond the boundary", async () => {
        const reservations = await Promise.all(
          Array.from({ length: 10 }, () => store.reserveMonthlyCall("techmap", "2026-08", 3)),
        );
        expect(reservations.filter(Boolean)).toHaveLength(3);
        expect(await store.getMonthlyCallCount("techmap", "2026-08")).toBe(3);
      });
    });

    // #100 review MF6: language counters move here — counted once, at the moment a posting is FIRST
    // persisted, never per fetch/normalize call (which would inflate with every re-fetch).
    describe("MF6: language counted once, at first persist, never on a re-fetch", () => {
      it("a genuinely new non-served-language posting is counted exactly once, not on a re-fetch", async () => {
        await store.upsert(providerRecord({ language: "zh" }));
        expect(readCounters()["postings.language_skipped"]).toBe(1);
        expect(readCounters()["postings.language_undetermined"]).toBe(0);

        await store.upsert(providerRecord({ language: "zh", title: "Senior Project Manager (Updated)" }));
        expect(readCounters()["postings.language_skipped"]).toBe(1); // unchanged — same posting, re-fetched
      });

      it("a genuinely new undetermined-language posting is counted exactly once, separately from a skip", async () => {
        await store.upsert(providerRecord({ language: "und" }));
        expect(readCounters()["postings.language_undetermined"]).toBe(1);
        expect(readCounters()["postings.language_skipped"]).toBe(0);

        await store.upsert(providerRecord({ language: "und" }));
        expect(readCounters()["postings.language_undetermined"]).toBe(1); // unchanged on re-fetch
      });

      it("an 'en' posting increments neither counter, new or re-fetched", async () => {
        await store.upsert(providerRecord({ language: "en" }));
        await store.upsert(providerRecord({ language: "en" }));
        expect(readCounters()["postings.language_skipped"]).toBe(0);
        expect(readCounters()["postings.language_undetermined"]).toBe(0);
      });

      it("two DIFFERENT genuinely-new postings are counted twice, not folded into one", async () => {
        await store.upsert(providerRecord({ providerPostingId: "tm-1", language: "zh" }));
        await store.upsert(providerRecord({ providerPostingId: "tm-2", language: "zh" }));
        expect(readCounters()["postings.language_skipped"]).toBe(2);
      });
    });

    // #100 review MF8: listByProvider must re-validate against the CURRENT contract, same as get() —
    // this was the one read path that didn't.
    it("listByProvider excludes a stored row the CURRENT schema rejects, same as get() does", async () => {
      await store.upsert(providerRecord({ providerId: "techmap", providerPostingId: "ok-1" }));
      // Deliberately invalid: upsert() doesn't validate on write (same convention as
      // adRequirementsStore.ts/judgementStore.ts's own put()), so a row missing required fields can
      // land here the same way a row written under a PRIOR contract version could.
      await store.upsert({
        providerId: "techmap",
        providerPostingId: "stale-1",
        capturedAt: "2026-08-04T00:00:00Z",
        verifiedLiveAt: "2026-08-04T00:00:00Z",
      } as unknown as ProviderPostingRecordV1);

      const listed = await store.listByProvider("techmap");
      expect(listed.map((r) => r.providerPostingId)).toEqual(["ok-1"]);
      expect(await store.get("techmap", "stale-1")).toBeNull();
    });
  });
}

it("#132 PgPostingStore preserves the month-to-date count across store reconstruction", async () => {
  const pool = pgPool();
  const beforeRestart = new PgPostingStore(pool);
  await beforeRestart.init();
  await beforeRestart.reserveMonthlyCall("techmap", "2026-08", 10);
  await beforeRestart.reserveMonthlyCall("techmap", "2026-08", 10);

  const afterRestart = new PgPostingStore(pool);
  expect(await afterRestart.getMonthlyCallCount("techmap", "2026-08")).toBe(2);
  expect(await afterRestart.reserveMonthlyCall("techmap", "2026-08", 2)).toBe(false);
});

it("#101 retrieval claim lease is bounded, clock-testable, and exceeds the provider attempt window", () => {
  expect(RETRIEVAL_CLAIM_LEASE_MS).toBeGreaterThan(21_000);
  expect(retrievalClaimWindow(Date.parse("2026-08-09T00:01:00.000Z"))).toEqual({
    claimedAt: "2026-08-09T00:01:00.000Z",
    staleBefore: "2026-08-09T00:00:00.000Z",
  });
});

it("#101 PgSessionStore recovers an abandoned claim after store reconstruction", async () => {
  const pool = pgPool();
  const abandonedStore = new PgSessionStore(pool);
  await abandonedStore.init();
  const session = await abandonedStore.create();
  expect(
    await abandonedStore.beginRetrievalState(
      session.id,
      0,
      "request",
      null,
      "abandoned-owner",
      "2026-08-09T00:00:00.000Z",
      "2026-08-08T23:59:00.000Z",
    ),
  ).toBe(true);

  const reconstructedStore = new PgSessionStore(pool);
  expect(
    await reconstructedStore.beginRetrievalState(
      session.id,
      0,
      "request",
      null,
      "recovery-owner",
      "2026-08-09T00:01:01.000Z",
      "2026-08-09T00:00:01.000Z",
    ),
  ).toBe(true);
  const snapshot = {
    requestFingerprint: "request",
    recordedAt: "2026-08-09T00:01:01.000Z",
    result: { schemaVersion: "4" as const, outcome: "invalid_request" as const, code: "missing_intent" as const },
  };
  expect(
    await abandonedStore.reconcileRetrievalState(session.id, 0, "request", "abandoned-owner", snapshot),
  ).toBe(false);
  expect(
    await reconstructedStore.reconcileRetrievalState(session.id, 0, "request", "recovery-owner", snapshot),
  ).toBe(true);
});

it("#101 PgPostingStore preserves the operator refresh marker across store reconstruction", async () => {
  const pool = pgPool();
  const beforeRestart = new PgPostingStore(pool);
  await beforeRestart.init();
  await beforeRestart.markRegionRefreshed("curated-pool", "HK", "2026-08-09T00:00:00.000Z");

  const afterRestart = new PgPostingStore(pool);
  expect(await afterRestart.getRegionRefresh("curated-pool", "HK")).toBe("2026-08-09T00:00:00.000Z");
  expect(await afterRestart.getRegionRefresh("curated-pool", "VN")).toBeNull();
});

it("#101 PgSessionStore can replace an invalid old snapshot using its durable coordination fingerprint", async () => {
  const pool = pgPool();
  const beforeRestart = new PgSessionStore(pool);
  await beforeRestart.init();
  const session = await beforeRestart.create();
  await pool.query(
    "UPDATE sessions SET retrieval = $2, retrieval_fingerprint = $3 WHERE id = $1",
    [session.id, JSON.stringify({ schemaVersion: "old", result: "invalid" }), "old-fingerprint"],
  );

  const afterRestart = new PgSessionStore(pool);
  const reconstructed = await afterRestart.getById(session.id);
  expect(reconstructed?.retrieval).toBeNull();
  expect(reconstructed?.retrievalCoordinationFingerprint).toBe("old-fingerprint");
  expect(
    await afterRestart.beginRetrievalState(
      session.id,
      0,
      "replacement-fingerprint",
      reconstructed!.retrievalCoordinationFingerprint,
      "replacement-owner",
      "2026-08-09T00:00:00.000Z",
      "2026-08-08T23:59:00.000Z",
    ),
  ).toBe(true);
});
