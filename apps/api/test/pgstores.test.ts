// JC-6 — the session + claim stores must behave identically in-memory and on Postgres. One contract,
// run against both drivers (Postgres via pg-mem, an in-process Postgres, so the real SQL is exercised
// in CI without a live DB). If the SQL is wrong, these fail here — before it reaches staging.
import { beforeEach, describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import { canonicalKeyOf, type CandidateClaim, type ProviderPostingRecordV1 } from "@jobcrush/contracts";
import {
  InMemorySessionStore,
  PgSessionStore,
  RETRIEVAL_CLAIM_LEASE_MS,
  retrievalClaimWindow,
  type SessionStore,
} from "../src/sessions.js";
import { InMemoryClaimStore, PgClaimStore, type ClaimStore } from "../src/claims.js";
import { InMemoryPostingStore, PgPostingStore, type PostingStore } from "../src/postingStore.js";
import {
  InMemoryUnmappedLabelStore,
  PgUnmappedLabelStore,
  type UnmappedLabelStore,
} from "../src/unmappedLabels.js";
import {
  InMemoryEmployerLookupStore,
  PgEmployerLookupStore,
  normaliseEmployerKey,
  type EmployerLookupStore,
} from "../src/employerLookup.js";
import {
  InMemoryPasteRecordStore,
  PgPasteRecordStore,
  type PasteRecordStore,
} from "../src/pasteRecordStore.js";
import {
  InMemoryTailorDraftStore,
  PgTailorDraftStore,
  type TailorDraftRecord,
  type TailorDraftStore,
} from "../src/tailorDraftStore.js";
import type { Draft } from "../src/preview.js";
import { readCounters, resetCountersForTest } from "../src/counters.js";

function pgPool() {
  const { Pool } = newDb().adapters.createPg();
  return new Pool();
}

// #214: setIntent takes already-resolved SearchAreaEntry values (the route resolves raw text).
const area = (text: string, marketKey: string, statedAt = "2026-08-09T00:00:00.000Z") => ({
  text,
  marketKey,
  statedAt,
});

// #234: the discovery record holds question floors and a search family separately. Every session in
// this file is a mapped target role, whose plan is the same one family in both slots.
const ITPD = { familyId: "it-project-delivery", version: 1 };
const mappedPlan = { questionFloors: [ITPD], searchFamily: ITPD };

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
      expect(s.sourceEntry).toBeNull();
      expect(s.importProof).toBeNull();
      expect(s.importResolutions).toEqual({});
      expect(s.intent).toEqual({ targetRole: null, searchAreas: [] });
      expect(s.discovery).toEqual({
        questionFloors: [],
        searchFamily: null,
        coveredItemIds: [],
        fallback: { declined: false, family: null },
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

    it("persists intent atomically and merges partial updates (searchAreas replaces the list)", async () => {
      const s = await store.create();
      const both = await store.setIntent(s.id, {
        targetRole: "Programme Manager",
        searchAreas: [area("Hong Kong", "hong-kong")],
      });
      expect(both).toEqual({
        targetRole: "Programme Manager",
        searchAreas: [area("Hong Kong", "hong-kong")],
      });
      expect((await store.getById(s.id))?.intent).toEqual(both);

      // A new searchAreas REPLACES the whole list, and targetRole is preserved when omitted.
      const merged = await store.setIntent(s.id, {
        searchAreas: [area("Singapore", "singapore"), area("Sydney", "australia")],
      });
      expect(merged).toEqual({
        targetRole: "Programme Manager",
        searchAreas: [area("Singapore", "singapore"), area("Sydney", "australia")],
      });
      expect((await store.getById(s.id))?.intent).toEqual(merged);

      const preserved = await store.setIntent(s.id, { targetRole: undefined });
      expect(preserved).toEqual({
        targetRole: "Programme Manager",
        searchAreas: [area("Singapore", "singapore"), area("Sydney", "australia")],
      });
    });

    it("persists retrieval snapshots and invalidates only retrieval when intent actually changes", async () => {
      const s = await store.create();
      await store.setIntent(s.id, {
        targetRole: "Programme Manager",
        searchAreas: [area("Hong Kong", "hong-kong")],
      });
      await store.reconcileDiscoveryState(
        s.id,
        mappedPlan,
        ["end-to-end-delivery"],
        true,
      );
      const snapshot = {
        requestFingerprint: "intent-v1",
        recordedAt: "2026-08-09T00:00:00.000Z",
        result: {
          schemaVersion: "5" as const,
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

      // Re-saving the SAME list is also not a change — retrieval survives.
      await store.setIntent(s.id, { searchAreas: [area("Hong Kong", "hong-kong")] });
      expect((await store.getById(s.id))?.retrieval).toEqual(snapshot);

      await store.setIntent(s.id, { searchAreas: [area("Singapore", "singapore")] });
      expect(await store.getById(s.id)).toMatchObject({
        intent: { targetRole: "Programme Manager", searchAreas: [area("Singapore", "singapore")] },
        retrieval: null,
        retrievalCoordinationFingerprint: null,
        discovery: {
          ...mappedPlan,
          coveredItemIds: ["end-to-end-delivery"],
          checkpoint: "essential_floor_covered",
        },
      });
    });

    it("compare-and-set rejects an old in-flight result after intent changes", async () => {
      const s = await store.create();
      await store.setIntent(s.id, {
        targetRole: "Programme Manager",
        searchAreas: [area("Hong Kong", "hong-kong")],
      });
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

      await store.setIntent(s.id, { searchAreas: [area("Singapore", "singapore")] });
      const accepted = await store.reconcileRetrievalState(
        s.id,
        before.retrievalGeneration,
        "old-request",
        "owner-old",
        {
          requestFingerprint: "old-request",
          recordedAt: "2026-08-09T00:00:00.000Z",
          result: { schemaVersion: "5", outcome: "invalid_request", code: "search_area_not_covered" },
        },
      );
      expect(accepted).toBe(false);
      expect((await store.getById(s.id))?.retrieval).toBeNull();
    });

    it("a discovery checkpoint transition invalidates retrieval and rejects the older generation", async () => {
      const s = await store.create();
      await store.setIntent(s.id, {
        targetRole: "Programme Manager",
        searchAreas: [area("Hong Kong", "hong-kong")],
      });
      await store.reconcileDiscoveryState(
        s.id,
        mappedPlan,
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
        mappedPlan,
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
            result: { schemaVersion: "5", outcome: "invalid_request", code: "floor_not_covered" },
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
        result: { schemaVersion: "5" as const, outcome: "invalid_request" as const, code: "missing_intent" as const },
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
        mappedPlan,
        ["end-to-end-delivery"],
        false,
      );
      expect((await store.getById(s.id))?.discovery).toEqual({
        ...mappedPlan,
        coveredItemIds: ["end-to-end-delivery"],
        checkpoint: "family_confirmed",
        fallback: { declined: false, family: null },
      });

      await store.reconcileDiscoveryState(
        s.id,
        mappedPlan,
        ["stakeholder-coordination"],
        true,
      );
      expect((await store.getByToken(s.token))?.discovery).toEqual({
        ...mappedPlan,
        coveredItemIds: ["stakeholder-coordination"],
        checkpoint: "essential_floor_covered",
        fallback: { declined: false, family: null },
      });

      await store.reconcileDiscoveryState(
        s.id,
        mappedPlan,
        [],
        false,
      );
      expect((await store.getById(s.id))?.discovery).toEqual({
        ...mappedPlan,
        coveredItemIds: [],
        fallback: { declined: false, family: null },
        checkpoint: "family_confirmed",
      });

      await Promise.all([
        store.reconcileDiscoveryState(
          s.id,
          mappedPlan,
          ["end-to-end-delivery"],
          false,
        ),
        store.reconcileDiscoveryState(
          s.id,
          mappedPlan,
          ["risk-dependency-control"],
          true,
        ),
      ]);
      const concurrent = (await store.getById(s.id))!.discovery;
      expect(concurrent.questionFloors).toEqual([ITPD]);
      expect(concurrent.searchFamily).toEqual(ITPD);
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

    // #234: the "floor already pinned" invariant now covers the PAIR — a session's plan does not
    // change under it once chosen, whichever half of the pair the second plan disagrees on.
    it("refuses a second, different discovery plan once one is pinned", async () => {
      const s = await store.create();
      await store.reconcileDiscoveryState(s.id, mappedPlan, ["end-to-end-delivery"], false);

      const other = { familyId: "field-marketing", version: 1 };
      await expect(
        store.reconcileDiscoveryState(s.id, { questionFloors: [other], searchFamily: other }, [], false),
      ).rejects.toThrow(/already pinned/);
      await expect(
        store.reconcileDiscoveryState(s.id, { questionFloors: [ITPD], searchFamily: null }, [], false),
      ).rejects.toThrow(/already pinned/);
      await expect(
        store.reconcileDiscoveryState(s.id, { questionFloors: [ITPD, other], searchFamily: ITPD }, [], false),
      ).rejects.toThrow(/already pinned/);

      // The same plan still reconciles — coverage advances under a pinned plan, as it always did.
      expect(
        await store.reconcileDiscoveryState(s.id, mappedPlan, ["end-to-end-delivery"], true),
      ).toEqual({
        ...mappedPlan,
        coveredItemIds: ["end-to-end-delivery"],
        checkpoint: "essential_floor_covered",
        fallback: { declined: false, family: null },
      });
    });

    it("keeps every pinned family version when a newer version is derived", async () => {
      const s = await store.create();
      const fieldMarketingReference = { familyId: "field-marketing", version: 3 };
      const pinned = { questionFloors: [ITPD, fieldMarketingReference], searchFamily: ITPD };
      await store.reconcileDiscoveryState(s.id, pinned, ["end-to-end-delivery"], true);
      const generation = (await store.getById(s.id))!.retrievalGeneration;
      const deckCanonicalKey = canonicalKeyOf("Live Co", "Hong Kong", "Programme Manager");
      const snapshot = {
        requestFingerprint: "pinned-plan",
        recordedAt: "2026-08-16T00:00:00.000Z",
        result: {
          schemaVersion: "5" as const,
          outcome: "relevant_postings" as const,
          postings: [{
            schemaVersion: "5" as const,
            id: `posting:${deckCanonicalKey}`,
            canonicalKey: deckCanonicalKey,
            title: "Programme Manager",
            company: "Live Co",
            location: "Hong Kong",
            sourceUrl: "https://example.com/pinned-plan",
            applicationUrl: null,
            excerpt: "An advert already open in her deck.",
            postedAt: "2026-08-15T00:00:00.000Z",
            capturedAt: "2026-08-16T00:00:00.000Z",
            verifiedLiveAt: "2026-08-16T00:00:00.000Z",
            expiresAt: null,
            attribution: [],
            sources: [{ providerId: "techmap", providerPostingId: "pinned-plan" }],
            skills: ["Delivery"],
            language: "en",
          }],
          coverage: { providersQueried: ["techmap"], providersUnavailable: [], complete: true },
          retrievedAt: "2026-08-16T00:00:00.000Z",
        },
      };
      expect(
        await store.beginRetrievalState(
          s.id,
          generation,
          "pinned-plan",
          null,
          "owner-pinned-plan",
          "2026-08-16T00:00:00.000Z",
          "2026-08-15T23:59:00.000Z",
        ),
      ).toBe(true);
      expect(
        await store.reconcileRetrievalState(
          s.id,
          generation,
          "pinned-plan",
          "owner-pinned-plan",
          snapshot,
        ),
      ).toBe(true);

      const searchOnly = await store.reconcileDiscoveryState(
        s.id,
        { questionFloors: [ITPD, fieldMarketingReference], searchFamily: { ...ITPD, version: 2 } },
        ["end-to-end-delivery"],
        true,
      );
      expect(searchOnly.searchFamily).toEqual(ITPD);

      const reconciled = await store.reconcileDiscoveryState(
        s.id,
        {
          questionFloors: [
            { ...ITPD, version: 2 },
            fieldMarketingReference,
          ],
          searchFamily: { ...ITPD, version: 2 },
        },
        ["end-to-end-delivery"],
        true,
      );

      expect(reconciled).toMatchObject(pinned);
      expect(reconciled.coveredItemIds).toEqual(["end-to-end-delivery"]);
      expect(reconciled.checkpoint).toBe("essential_floor_covered");
      expect(await store.getById(s.id)).toMatchObject({
        retrievalGeneration: generation,
        retrieval: snapshot,
        retrievalCoordinationFingerprint: "pinned-plan",
      });
    });

    // #235: the ONE exception to the pin — a word plan (no search family) may gain one, the
    // returning visitor whose role has since been published. Never the other direction.
    it("lets a pinned word plan gain a search family, and re-pins it there", async () => {
      const s = await store.create();
      const other = { familyId: "field-marketing", version: 1 };
      await store.reconcileDiscoveryState(
        s.id,
        { questionFloors: [ITPD], searchFamily: null },
        ["end-to-end-delivery"],
        false,
      );

      const upgraded = await store.reconcileDiscoveryState(
        s.id,
        { questionFloors: [other], searchFamily: other },
        [],
        false,
      );
      expect(upgraded).toEqual({
        questionFloors: [other],
        searchFamily: other,
        coveredItemIds: [],
        fallback: { declined: false, family: null },
        checkpoint: "family_confirmed",
      });

      // Once a family plan holds, dropping back to a word plan is refused like any other change.
      await expect(
        store.reconcileDiscoveryState(s.id, { questionFloors: [ITPD], searchFamily: null }, [], false),
      ).rejects.toThrow(/already pinned/);
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

    // #309: the #23/#31 tailor score floor (raiseTailorFloor, tailor_floor_pct/tailor_floor_ad_id)
    // is removed — the score is a pure function of the session's claims, so there is nothing for
    // the store to hold up. Only the badge's factFloor below remains a floor.

    it("clearTailorTarget drops back to deck with no ad targeted", async () => {
      const s = await store.create();
      await store.setTailorTarget(s.id, "ad-1");
      await store.clearTailorTarget(s.id);
      const got = await store.getById(s.id);
      expect(got?.stage).toBe("deck");
      expect(got?.tailorAdId).toBeNull();
    });

    it("touch doesn't throw and keeps the row", async () => {
      const s = await store.create();
      await store.touch(s.id);
      expect(await store.getById(s.id)).toBeTruthy();
    });

    // #33 — the profile badge's monotonic floor: raises only, never lowers. Unkeyed — there's only
    // ever one factCount per session. (Deliberately survives #309: the SCORE floor lied once
    // corrections were honoured; the badge counts facts given, which a correction never un-gives.)
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
    schemaVersion: "4",
    providerId: "techmap",
    providerPostingId: "tm-1",
    title: "Senior Project Manager",
    company: "BNP Paribas",
    location: "Hong Kong",
    sourceUrl: "https://jobdatafeeds.com/jobs/senior-project-manager",
    applicationUrl: null,
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

    // #302 (#294 clause 5) — a record from a source that fetches nothing carries NO liveness
    // confirmation, and the column holds that fact rather than a date-shaped stand-in. Proven on
    // both drivers because the Postgres one needs the column to be nullable at all, and the read
    // path needs to hand back null rather than the string "null".
    it("#302: a never-confirmed-live record round-trips with a null verifiedLiveAt", async () => {
      const pasted = providerRecord({
        providerId: "pasted-by-you",
        providerPostingId: "paste-1",
        verifiedLiveAt: null,
        applicationUrl: "https://careers.example/apply/1",
      });
      const upserted = await store.upsert(pasted);
      expect(upserted.verifiedLiveAt).toBeNull();
      const stored = await store.get("pasted-by-you", "paste-1");
      expect(stored!.verifiedLiveAt).toBeNull();
      expect(stored!.applicationUrl).toBe("https://careers.example/apply/1");
      // A second paste of the same advert still has nothing to confirm — the merge does not
      // invent one, and it does not fall over on the null either.
      const again = await store.upsert(providerRecord({
        providerId: "pasted-by-you",
        providerPostingId: "paste-1",
        verifiedLiveAt: null,
        applicationUrl: "https://careers.example/apply/1",
      }));
      expect(again.verifiedLiveAt).toBeNull();
    });

    // #302: one real confirmation outranks any number of absences, in BOTH directions of arrival.
    // `date >= NULL` is NULL in SQL, so the naive CASE would have let the absence win.
    it("#302: an absent confirmation never erases a real one, whichever arrives second", async () => {
      await store.upsert(providerRecord({ verifiedLiveAt: "2026-08-05T00:00:00Z" }));
      const afterAbsence = await store.upsert(providerRecord({ verifiedLiveAt: null }));
      expect(new Date(afterAbsence.verifiedLiveAt!).getTime()).toBe(
        new Date("2026-08-05T00:00:00Z").getTime(),
      );

      await store.upsert(providerRecord({ providerPostingId: "tm-2", verifiedLiveAt: null }));
      const afterDate = await store.upsert(
        providerRecord({ providerPostingId: "tm-2", verifiedLiveAt: "2026-08-05T00:00:00Z" }),
      );
      expect(new Date(afterDate.verifiedLiveAt!).getTime()).toBe(
        new Date("2026-08-05T00:00:00Z").getTime(),
      );
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
    result: { schemaVersion: "5" as const, outcome: "invalid_request" as const, code: "missing_intent" as const },
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

// #252 — the vocabulary-growth feed, both drivers against one contract.
const unmappedDrivers: [string, () => UnmappedLabelStore][] = [
  ["in-memory", () => new InMemoryUnmappedLabelStore()],
  ["postgres (pg-mem)", () => new PgUnmappedLabelStore(pgPool())],
];

for (const [name, make] of unmappedDrivers) {
  describe(`UnmappedLabelStore contract — ${name}`, () => {
    let store: UnmappedLabelStore;
    beforeEach(async () => {
      store = make();
      await store.init();
    });

    it("records both sources with their words, person link and reason; reads back newest first", async () => {
      await store.record({
        sessionId: "session-1",
        source: "target_role",
        label: "  paediatric nurse practitioner  ",
        reason: "labeler said no family fits",
      });
      await store.record({
        sessionId: "session-2",
        source: "past_job",
        label: "Pastry Chef",
        reason: "output failed validation twice: bad json",
      });

      const entries = await store.recent();
      expect(entries).toMatchObject([
        { sessionId: "session-2", source: "past_job", label: "Pastry Chef" },
        {
          sessionId: "session-1",
          source: "target_role",
          // trimmed on the way in, both drivers alike
          label: "paediatric nurse practitioner",
          reason: "labeler said no family fits",
        },
      ]);
      expect(entries[0]!.reason).toContain("failed validation twice");
      expect(entries.every((entry) => typeof entry.id === "string" && entry.id.length > 0)).toBe(true);
      expect(entries.every((entry) => !Number.isNaN(Date.parse(entry.recordedAt)))).toBe(true);
    });

    it("bounds the visitor-typed words rather than storing whatever was typed", async () => {
      await store.record({
        sessionId: null,
        source: "target_role",
        label: "x".repeat(500),
        reason: "y".repeat(500),
      });
      const [entry] = await store.recent();
      expect(entry!.label).toHaveLength(200);
      expect(entry!.reason).toHaveLength(200);
      expect(entry!.sessionId).toBeNull();
    });

    it("never reads back more than the bound, however many were recorded", async () => {
      for (let i = 0; i < 205; i++) {
        await store.record({ sessionId: "s", source: "target_role", label: `role ${i}`, reason: "no fit" });
      }
      const entries = await store.recent();
      expect(entries).toHaveLength(200);
      expect(entries[0]!.label).toBe("role 204"); // newest first, both drivers alike
    });

    // #253 — harvest semantics, identical on both drivers (AC5).
    it("counts what is waiting and how many distinct roles it represents", async () => {
      for (const label of ["harbour pilot", "Harbour Pilot ", "pastry chef"]) {
        await store.record({ sessionId: "s", source: "target_role", label, reason: "no family fits" });
      }
      // three people hitting two gaps, not three gaps: casing and spacing are not new roles.
      expect(await store.stats()).toEqual({ unharvested: 3, distinctRoles: 2 });
    });

    it("marking harvested empties the waiting count but keeps the entries readable", async () => {
      await store.record({ sessionId: "s", source: "target_role", label: "harbour pilot", reason: "no fit" });

      expect(await store.markHarvested()).toBe(1);
      expect(await store.stats()).toEqual({ unharvested: 0, distinctRoles: 0 });

      const [entry] = await store.recent();
      expect(entry!.label).toBe("harbour pilot");
      expect(entry!.harvestedAt).not.toBeNull();
      expect(Number.isNaN(Date.parse(entry!.harvestedAt!))).toBe(false);
    });

    it("counts labels recorded after a harvest from zero, unmixed with the harvested ones", async () => {
      await store.record({ sessionId: "s", source: "target_role", label: "harbour pilot", reason: "no fit" });
      await store.markHarvested();
      await store.record({ sessionId: "s", source: "past_job", label: "pastry chef", reason: "no fit" });

      expect(await store.stats()).toEqual({ unharvested: 1, distinctRoles: 1 });
      expect(await store.recent()).toMatchObject([
        { label: "pastry chef", harvestedAt: null },
        { label: "harbour pilot" },
      ]);
    });

    it("reads back only what is still waiting when a run asks for its work list", async () => {
      await store.record({ sessionId: "s", source: "target_role", label: "harbour pilot", reason: "no fit" });
      await store.markHarvested();
      await store.record({ sessionId: "s", source: "past_job", label: "pastry chef", reason: "no fit" });

      // answered gaps must not crowd the waiting ones out of the window, ever (#253 AC3)
      expect((await store.recent(200, true)).map((entry) => entry.label)).toEqual(["pastry chef"]);
      expect((await store.recent()).map((entry) => entry.label)).toEqual(["pastry chef", "harbour pilot"]);
    });

    it("is safe to repeat: nothing is double-marked and nothing is lost", async () => {
      await store.record({ sessionId: "s", source: "target_role", label: "harbour pilot", reason: "no fit" });
      await store.markHarvested();
      const [first] = await store.recent();

      expect(await store.markHarvested()).toBe(0);
      const [again] = await store.recent();
      expect(again!.harvestedAt).toBe(first!.harvestedAt); // the FIRST harvest time survives
      expect(await store.recent()).toHaveLength(1);
    });

    it("honours the recent() limit", async () => {
      for (const label of ["one", "two", "three"]) {
        await store.record({ sessionId: "s", source: "target_role", label, reason: "no family fits" });
      }
      expect((await store.recent(2)).map((entry) => entry.label)).toEqual(["three", "two"]);
    });
  });
}

// #252 AC4 — the gap this slice closes: a deploy no longer erases the feed.
it("#252 PgUnmappedLabelStore keeps its entries across store reconstruction", async () => {
  const pool = pgPool();
  const beforeRestart = new PgUnmappedLabelStore(pool);
  await beforeRestart.init();
  await beforeRestart.record({
    sessionId: "session-1",
    source: "target_role",
    label: "harbour pilot",
    reason: "labeler said no family fits",
  });

  const afterRestart = new PgUnmappedLabelStore(pool);
  expect(await afterRestart.recent()).toMatchObject([
    { sessionId: "session-1", source: "target_role", label: "harbour pilot" },
  ]);
});

// #282 — the employer lookup cache, on both drivers. Its whole promise is "a company is paid for
// once, EVER", and "ever" is a property of the Postgres row, not of the in-memory map: if this SQL
// is wrong, every visitor pays for every employer again and only the bill would say so.
const employerLookupDrivers: [string, () => EmployerLookupStore][] = [
  ["in-memory", () => new InMemoryEmployerLookupStore()],
  ["postgres (pg-mem)", () => new PgEmployerLookupStore(pgPool())],
];

for (const [name, make] of employerLookupDrivers) {
  describe(`EmployerLookupStore contract — ${name}`, () => {
    let store: EmployerLookupStore;
    beforeEach(async () => {
      store = make();
      await store.init();
    });

    it("stores one company's answer and reads it back by its normalised key", async () => {
      await store.put({
        key: normaliseEmployerKey("Nordea Bank A/S"),
        employer: "Nordea Bank A/S",
        summary: "Nordea is a Nordic universal bank.",
      });

      const row = await store.get(normaliseEmployerKey("nordea bank"));
      expect(row).toMatchObject({
        key: "nordea bank",
        employer: "Nordea Bank A/S",
        summary: "Nordea is a Nordic universal bank.",
      });
      expect(Date.parse(row!.lookedUpAt)).not.toBeNaN();
    });

    it("answers null for a company nobody has looked up", async () => {
      expect(await store.get("never seen")).toBeNull();
    });

    it("takes a second write for the same company without failing — either answer is correct", async () => {
      // Two workers can look one company up at once. What must never happen is the insert throwing
      // and a lookup that actually succeeded being recorded as a failure.
      await store.put({ key: "acme", employer: "Acme Ltd", summary: "first answer" });
      await store.put({ key: "acme", employer: "ACME Limited", summary: "second answer" });
      expect(await store.get("acme")).toMatchObject({ employer: "ACME Limited", summary: "second answer" });
    });

    it("bounds what one row can hold, on both drivers", async () => {
      await store.put({ key: "acme", employer: "Acme", summary: "x".repeat(50_000) });
      expect((await store.get("acme"))!.summary).toHaveLength(1200);
    });
  });
}

// The promise this cache exists for: a deploy does not make everyone pay again.
it("#282 PgEmployerLookupStore keeps its answers across store reconstruction", async () => {
  const pool = pgPool();
  const beforeRestart = new PgEmployerLookupStore(pool);
  await beforeRestart.init();
  await beforeRestart.put({ key: "nordea bank", employer: "Nordea Bank", summary: "A Nordic bank." });

  // No second init() — pg-mem cannot re-parse a CREATE TABLE IF NOT EXISTS against a table that
  // already exists, which real Postgres treats as the no-op it is. Same shape as #252's own restart
  // test above.
  const afterRestart = new PgEmployerLookupStore(pool);
  expect(await afterRestart.get("nordea bank")).toMatchObject({ summary: "A Nordic bank." });
});

// #303 (#294 clause 11) — the per-person paste record, both drivers against one contract, real SQL
// in CI. Its whole value is FIRST-WRITE-WINS: the ageing line (#305) counts from when THIS person
// brought the job in, and a re-paste is a re-visit, not a new arrival.
const pasteRecordDrivers: [string, () => PasteRecordStore][] = [
  ["in-memory", () => new InMemoryPasteRecordStore()],
  ["postgres (pg-mem)", () => new PgPasteRecordStore(pgPool())],
];

for (const [name, make] of pasteRecordDrivers) {
  describe(`PasteRecordStore contract — ${name} (#303)`, () => {
    let store: PasteRecordStore;
    beforeEach(async () => {
      store = make();
      await store.init();
    });

    it("records person + advert + when, and reads it back", async () => {
      await store.record("session-1", "posting:aaa", "2026-09-28T08:00:00.000Z");
      expect(await store.listBySession("session-1")).toEqual([
        { sessionId: "session-1", adId: "posting:aaa", pastedAt: "2026-09-28T08:00:00.000Z" },
      ]);
      expect(await store.listBySession("session-2")).toEqual([]);
    });

    it("first write wins — pasting the same advert again never resets the clock", async () => {
      const first = await store.record("session-1", "posting:aaa", "2026-09-21T08:00:00.000Z");
      const second = await store.record("session-1", "posting:aaa", "2026-09-28T08:00:00.000Z");
      expect(first).toBe("2026-09-21T08:00:00.000Z");
      expect(second).toBe("2026-09-21T08:00:00.000Z"); // the stored time is handed back, not the new one
      const rows = await store.listBySession("session-1");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.pastedAt).toBe("2026-09-21T08:00:00.000Z");
    });

    it("two people pasting the SAME advert each get their own record", async () => {
      await store.record("session-1", "posting:aaa", "2026-09-21T08:00:00.000Z");
      await store.record("session-2", "posting:aaa", "2026-09-28T08:00:00.000Z");
      expect((await store.listBySession("session-1"))[0]!.pastedAt).toBe("2026-09-21T08:00:00.000Z");
      expect((await store.listBySession("session-2"))[0]!.pastedAt).toBe("2026-09-28T08:00:00.000Z");
    });

    it("one person's adverts read back newest first — the pinned band's own order (#305)", async () => {
      await store.record("session-1", "posting:older", "2026-09-01T08:00:00.000Z");
      await store.record("session-1", "posting:newer", "2026-09-28T08:00:00.000Z");
      expect((await store.listBySession("session-1")).map((r) => r.adId)).toEqual([
        "posting:newer",
        "posting:older",
      ]);
    });
  });
}

// #303 (#294 clause 9) — the pasted advert's OWN TEXT is stored on the job, through the store every
// other posting already uses. It is the first record in this app that cannot be re-fetched, so a
// driver that truncated or dropped `excerpt` would lose it for good; this is the round trip that
// says it does not.
for (const [name, make] of postingDrivers) {
  it(`a pasted advert's full text survives a round trip — ${name} (#303)`, async () => {
    const store = make();
    await store.init();
    // Longer than any excerpt a provider feed sends, with the blank lines and punctuation a real
    // copy-paste carries — an excerpt column that silently clipped would show up here.
    const text = Array.from({ length: 40 }, (_, i) => `Paragraph ${i}: deliver the programme — on time, "properly".`).join("\n\n");
    const pasted = providerRecord({
      providerId: "pasted-by-you",
      providerPostingId: "fp-1",
      sourceUrl: "pasted:fp-1",
      applicationUrl: "https://example.com/apply",
      excerpt: text,
      verifiedLiveAt: null, // never confirmed live and never confirmable (#302)
      expiresAt: "2026-10-15", // the employer's own closing date, read out of the text (#294 c4)
    });
    await store.upsert(pasted);

    const read = await store.get("pasted-by-you", "fp-1");
    expect(read?.excerpt).toBe(text);
    expect(read?.verifiedLiveAt).toBeNull();
    expect(read?.expiresAt).toBe("2026-10-15");
    expect(read?.applicationUrl).toBe("https://example.com/apply");
    // And through the list read the job's own screen resolves an adId against.
    expect((await store.listByProvider("pasted-by-you")).map((r) => r.excerpt)).toEqual([text]);
  });
}

// #310 — the tailored-draft checkpoint: one row per (session, advert), fingerprint-keyed reuse.
const draftFixture: Draft = {
  name: "Maria Kowalski",
  headline: "IT Project Manager",
  contact: "Warsaw · maria@example.com",
  summary: "Delivery-accountable project manager.",
  experience: [
    {
      role: "IT Project Manager",
      employer: "Nordic Retail Group",
      location: "",
      dates: "2021 - Present",
      bullets: [{ text: "Led the checkout replatforming", claimIds: ["nrg-led"], outcome: "" }],
      unprinted: [],
    },
  ],
  skills: [{ label: "Delivery", items: ["Jira"] }],
  certifications: [],
  education: [],
  additional: [],
};
const draftRecord = (fingerprint: string, notices: string[] = []): TailorDraftRecord => ({
  draft: draftFixture,
  conservationNotices: notices,
  inputFingerprint: fingerprint,
  draftedAt: "2026-09-30T08:00:00.000Z",
});

const tailorDraftDrivers: [string, () => TailorDraftStore][] = [
  ["in-memory", () => new InMemoryTailorDraftStore()],
  ["postgres (pg-mem)", () => new PgTailorDraftStore(pgPool())],
];

for (const [name, make] of tailorDraftDrivers) {
  describe(`TailorDraftStore contract — ${name} (#310)`, () => {
    let store: TailorDraftStore;
    beforeEach(async () => {
      store = make();
      await store.init();
    });

    it("a draft round-trips whole — schema, notices, fingerprint, timestamp", async () => {
      await store.put("session-1", "ad-1", draftRecord("fp-1", ["Your languages could not be placed."]));
      const read = await store.get("session-1", "ad-1");
      expect(read).toEqual(draftRecord("fp-1", ["Your languages could not be placed."]));
    });

    it("misses are null: an unknown session, an unknown advert, another person's draft", async () => {
      await store.put("session-1", "ad-1", draftRecord("fp-1"));
      expect(await store.get("session-2", "ad-1")).toBeNull();
      expect(await store.get("session-1", "ad-2")).toBeNull();
    });

    it("a redraft for the same (session, advert) replaces the prior record", async () => {
      await store.put("session-1", "ad-1", draftRecord("fp-1"));
      await store.put("session-1", "ad-1", draftRecord("fp-2"));
      expect((await store.get("session-1", "ad-1"))?.inputFingerprint).toBe("fp-2");
    });

    it("a stored row the current Draft schema rejects reads as a miss, never a throw", async () => {
      const broken = draftRecord("fp-1");
      // A draft with no experience at all fails Draft.parse (min(1)) — the shape a schema bump leaves behind.
      await store.put("session-1", "ad-1", { ...broken, draft: { ...draftFixture, experience: [] } as unknown as Draft });
      expect(await store.get("session-1", "ad-1")).toBeNull();
    });
  });
}
