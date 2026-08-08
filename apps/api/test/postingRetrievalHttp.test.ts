import { describe, expect, it, vi } from "vitest";
import type { CandidateClaim } from "@jobcrush/contracts";
import { initialProductionFamilyFloors } from "../src/familyFloors.js";
import { makePostingRetriever } from "../src/postingRetrieval.js";
import { InMemoryPostingStore } from "../src/postingStore.js";
import { buildServer } from "../src/server.js";
import { RETRIEVAL_CLAIM_LEASE_MS } from "../src/sessions.js";

const claim = (id: string, text: string, fieldLabel: string): CandidateClaim => ({
  id,
  semantic_key: id,
  field_key: "skill",
  field_value: fieldLabel,
  field_label: fieldLabel,
  role: "profile",
  text,
  machine_touch: "verbatim",
  classification: "Verified",
  source_quote: text,
  needs_grill: false,
  grill_hint: null,
});

describe("#101 GET /onboarding/cards retrieval seam", () => {
  async function authorizedSession(built: ReturnType<typeof buildServer>) {
    const created = await built.app.inject({ method: "POST", url: "/sessions/anonymous" });
    const id = created.json().id as string;
    await built.sessions.setIntent(id, { targetRole: "Programme Manager", searchArea: "Hong Kong" });
    await built.sessions.reconcileDiscoveryState(
      id,
      { familyId: "it-project-delivery", version: 1 },
      ["end-to-end-delivery"],
      true,
    );
    return {
      id,
      cookie: `jc_session=${created.cookies.find((item) => item.name === "jc_session")!.value}`,
    };
  }

  it("uses only session/server state, persists the result, and ignores client override fields", async () => {
    const retrievePostings = vi.fn(async () => ({
      schemaVersion: "4" as const,
      outcome: "provider_unavailable" as const,
      coverage: { providersQueried: [], providersUnavailable: ["techmap"], complete: false },
      reason: "test outage",
      retryable: true,
    }));
    const { app, sessions, claims } = buildServer({ retrievePostings });
    const created = await app.inject({ method: "POST", url: "/sessions/anonymous" });
    const sessionId = created.json().id as string;
    const cookie = `jc_session=${created.cookies.find((item) => item.name === "jc_session")!.value}`;
    await sessions.setIntent(sessionId, { targetRole: "Programme Manager", searchArea: "Hong Kong" });
    await sessions.reconcileDiscoveryState(
      sessionId,
      { familyId: "it-project-delivery", version: 1 },
      ["end-to-end-delivery"],
      true,
    );
    await claims.seed(sessionId, [
      {
        ...claim("banking-delivery", "raw secret claim text", "Banking delivery"),
        field_value: "SECRET-FIELD-VALUE",
      },
    ]);
    await claims.confirm(sessionId, "banking-delivery");

    const response = await app.inject({
      method: "GET",
      url: "/onboarding/cards?targetRole=Attacker&searchArea=Atlantis&familyId=fake",
      headers: { cookie, "content-type": "application/json" },
      payload: {
        targetRole: "Attacker",
        searchArea: "Atlantis",
        family: { familyId: "fake", version: 99 },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(retrievePostings).toHaveBeenCalledOnce();
    expect(retrievePostings.mock.calls[0]![0]).toEqual({
      targetRole: "Programme Manager",
      searchArea: "Hong Kong",
      family: { familyId: "it-project-delivery", version: 1 },
      checkpoint: "essential_floor_covered",
      confirmedEvidence: [
        { semanticKey: "banking-delivery", fieldLabel: "Banking delivery" },
      ],
      explicitNegatives: [],
    });
    expect(JSON.stringify(retrievePostings.mock.calls[0]![0])).not.toContain("raw secret claim text");
    expect(JSON.stringify(retrievePostings.mock.calls[0]![0])).not.toContain("SECRET-FIELD-VALUE");
    expect(response.json().retrieval).toMatchObject({
      outcome: "provider_unavailable",
      reason: "posting retrieval is in progress",
    });
    await vi.waitFor(async () =>
      expect((await sessions.getById(sessionId))?.retrieval).toMatchObject({
        result: { outcome: "provider_unavailable", reason: "test outage" },
      }),
    );
  });

  it("defaults to a provider_unavailable result rather than fixture retrieval", async () => {
    const { app } = buildServer();
    const created = await app.inject({ method: "POST", url: "/sessions/anonymous" });
    const cookie = `jc_session=${created.cookies.find((item) => item.name === "jc_session")!.value}`;
    const response = await app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json().retrieval).toMatchObject({
      schemaVersion: "4",
      outcome: "provider_unavailable",
      retryable: true,
    });
  });

  it("reuses an unchanged fresh snapshot without another provider call", async () => {
    const retrievePostings = vi.fn(async () => ({
      schemaVersion: "4" as const,
      outcome: "empty_pool" as const,
      coverage: { providersQueried: ["curated-pool"], providersUnavailable: [], complete: true },
      retrievedAt: new Date().toISOString(),
    }));
    const built = buildServer({ retrievePostings });
    const { id, cookie } = await authorizedSession(built);
    const first = await built.app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } });
    await vi.waitFor(async () =>
      expect((await built.sessions.getById(id))?.retrieval?.result.outcome).toBe("empty_pool"),
    );
    const second = await built.app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } });
    expect(first.json().retrieval.outcome).toBe("provider_unavailable");
    expect(second.json().retrieval.outcome).toBe("empty_pool");
    expect(retrievePostings).toHaveBeenCalledOnce();
  });

  it("briefly reuses an unavailable snapshot instead of spending again on every reload", async () => {
    const retrievePostings = vi.fn(async () => ({
      schemaVersion: "4" as const,
      outcome: "provider_unavailable" as const,
      coverage: { providersQueried: [], providersUnavailable: ["techmap"], complete: false },
      reason: "techmap: provider unavailable",
      retryable: true,
    }));
    const built = buildServer({ retrievePostings });
    const { cookie } = await authorizedSession(built);
    await built.app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } });
    const repeated = await built.app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } });
    expect(repeated.json().retrieval.outcome).toBe("provider_unavailable");
    expect(retrievePostings).toHaveBeenCalledOnce();
  });

  it("redacts an arbitrary error thrown by the injected retrieval seam", async () => {
    const retrievePostings = vi.fn(async () => {
      throw new Error("database password=secret-123");
    });
    const built = buildServer({ retrievePostings });
    const logError = vi.spyOn(built.app.log, "error");
    const { id, cookie } = await authorizedSession(built);
    const first = await built.app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } });
    expect(JSON.stringify(first.json().retrieval)).not.toContain("secret-123");
    await vi.waitFor(async () =>
      expect((await built.sessions.getById(id))?.retrieval?.result).toMatchObject({
        outcome: "provider_unavailable",
        reason: "posting retrieval is temporarily unavailable",
      }),
    );
    const repeated = await built.app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } });
    expect(JSON.stringify(repeated.json().retrieval)).not.toContain("secret-123");
    expect(retrievePostings).toHaveBeenCalledOnce();
    expect(logError).toHaveBeenCalledWith({ category: "retrieval_failed" }, "posting retrieval failed");
    expect(JSON.stringify(logError.mock.calls)).not.toContain("secret-123");
  });

  it("coalesces duplicate in-flight reads so they spend once", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const retrievePostings = vi.fn(async () => {
      await held;
      return {
        schemaVersion: "4" as const,
        outcome: "empty_pool" as const,
        coverage: { providersQueried: ["curated-pool"], providersUnavailable: [], complete: true },
        retrievedAt: new Date().toISOString(),
      };
    });
    const built = buildServer({ retrievePostings });
    const { cookie } = await authorizedSession(built);
    const first = built.app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } });
    await vi.waitFor(() => expect(retrievePostings).toHaveBeenCalledOnce());
    const second = built.app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } });
    await Promise.resolve();
    expect(retrievePostings).toHaveBeenCalledOnce();
    release();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(retrievePostings).toHaveBeenCalledOnce();
  });

  it("takes over a locally hung retrieval after the durable lease and rejects its late result", async () => {
    const startedAt = Date.parse("2026-08-09T12:00:00.000Z");
    const now = vi.spyOn(Date, "now").mockReturnValue(startedAt);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const retrievePostings = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        await held;
        return {
          schemaVersion: "4" as const,
          outcome: "provider_unavailable" as const,
          coverage: { providersQueried: [], providersUnavailable: ["old-owner"], complete: false },
          reason: "old owner result",
          retryable: true,
        };
      }
      return {
        schemaVersion: "4" as const,
        outcome: "empty_pool" as const,
        coverage: { providersQueried: ["curated-pool"], providersUnavailable: [], complete: true },
        retrievedAt: new Date().toISOString(),
      };
    });
    const built = buildServer({ retrievePostings });
    const { id, cookie } = await authorizedSession(built);
    await built.app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } });
    await vi.waitFor(() => expect(retrievePostings).toHaveBeenCalledOnce());

    now.mockReturnValue(startedAt + RETRIEVAL_CLAIM_LEASE_MS + 1);
    await built.app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } });
    await vi.waitFor(() => expect(retrievePostings).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () =>
      expect((await built.sessions.getById(id))?.retrieval?.result.outcome).toBe("empty_pool"),
    );

    release();
    await vi.waitFor(async () =>
      expect((await built.sessions.getById(id))?.retrieval?.result.outcome).toBe("empty_pool"),
    );
    expect((await built.sessions.getById(id))?.retrieval?.result).not.toMatchObject({ reason: "old owner result" });
    now.mockRestore();
  });

  it("does not persist an old in-flight result after intent changes", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const retrievePostings = vi.fn(async () => {
      await held;
      return {
        schemaVersion: "4" as const,
        outcome: "empty_pool" as const,
        coverage: { providersQueried: ["curated-pool"], providersUnavailable: [], complete: true },
        retrievedAt: new Date().toISOString(),
      };
    });
    const built = buildServer({ retrievePostings });
    const { id, cookie } = await authorizedSession(built);
    const oldRequest = built.app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } });
    await vi.waitFor(() => expect(retrievePostings).toHaveBeenCalledOnce());
    await built.sessions.setIntent(id, { searchArea: "Singapore" });
    release();
    await oldRequest;
    expect((await built.sessions.getById(id))?.retrieval).toBeNull();
  });

  it.each([
    {
      name: "missing intent",
      arrange: async () => undefined,
      code: "missing_intent",
    },
    {
      name: "unpublished or fixture family",
      arrange: async (sessions: ReturnType<typeof buildServer>["sessions"], id: string) => {
        await sessions.setIntent(id, { targetRole: "Programme Manager", searchArea: "Hong Kong" });
        await sessions.reconcileDiscoveryState(id, { familyId: "fixture-only", version: 1 }, [], true);
      },
      code: "family_not_published",
    },
    {
      name: "incomplete production floor",
      arrange: async (sessions: ReturnType<typeof buildServer>["sessions"], id: string) => {
        await sessions.setIntent(id, { targetRole: "Programme Manager", searchArea: "Hong Kong" });
        await sessions.reconcileDiscoveryState(
          id,
          { familyId: "it-project-delivery", version: 1 },
          ["end-to-end-delivery"],
          false,
        );
      },
      code: "floor_not_covered",
    },
    {
      name: "uncovered search area",
      arrange: async (sessions: ReturnType<typeof buildServer>["sessions"], id: string) => {
        await sessions.setIntent(id, { targetRole: "Programme Manager", searchArea: "Atlantis" });
        await sessions.reconcileDiscoveryState(
          id,
          { familyId: "it-project-delivery", version: 1 },
          ["end-to-end-delivery"],
          true,
        );
      },
      code: "search_area_not_covered",
    },
  ])("fails closed over HTTP for $name", async ({ arrange, code }) => {
    const productionFamilyFloors = initialProductionFamilyFloors();
    const retrievePostings = makePostingRetriever({
      registry: [],
      providers: [],
      store: new InMemoryPostingStore(),
      productionFamilyFloors,
    });
    const built = buildServer({ productionFamilyFloors, retrievePostings });
    const created = await built.app.inject({ method: "POST", url: "/sessions/anonymous" });
    const id = created.json().id as string;
    await arrange(built.sessions, id);
    const cookie = `jc_session=${created.cookies.find((item) => item.name === "jc_session")!.value}`;
    const response = await built.app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json().retrieval).toMatchObject({
      outcome: "provider_unavailable",
      reason: "posting retrieval is in progress",
    });
    await vi.waitFor(async () =>
      expect((await built.sessions.getById(id))?.retrieval?.result).toEqual({
        schemaVersion: "4",
        outcome: "invalid_request",
        code,
      }),
    );
    const completed = await built.app.inject({
      method: "GET",
      url: "/onboarding/cards",
      headers: { cookie },
    });
    expect(completed.json().retrieval).toEqual({
      schemaVersion: "4",
      outcome: "invalid_request",
      code,
    });
  });
});
