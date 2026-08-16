import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canonicalKeyOf,
  type AdRequirementsV1,
  type CandidateClaim,
  type PostingProviderPolicyV1,
} from "@jobcrush/contracts";
import { initialProductionFamilyFloors } from "../src/familyFloors.js";
import { makePostingRetriever } from "../src/postingRetrieval.js";
import { InMemoryPostingStore } from "../src/postingStore.js";
import { TechmapPostingProvider } from "../src/postingProvider.js";
import { loadPostings, type Posting } from "../src/preview.js";
import { buildServer } from "../src/server.js";
import { RETRIEVAL_CLAIM_LEASE_MS } from "../src/sessions.js";

// #234: the discovery record holds question floors and a search family separately. Every session
// here is a mapped target role, whose plan is the same one family in both slots.
const mappedPlan = (family: { familyId: string; version: number }) => ({
  questionFloors: [family],
  searchFamily: family,
});

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
  afterEach(() => vi.useRealTimers());

  async function authorizedSession(built: ReturnType<typeof buildServer>) {
    const created = await built.app.inject({ method: "POST", url: "/sessions/anonymous" });
    const id = created.json().id as string;
    const cookie = `jc_session=${created.cookies.find((item) => item.name === "jc_session")!.value}`;
    // #214: intent writes go through the route — `searchArea` is the legacy one-entry alias the
    // route still accepts and resolves server-side into a stored searchAreas entry.
    await built.app.inject({
      method: "PUT",
      url: "/sessions/me/intent",
      headers: { cookie },
      payload: { targetRole: "Programme Manager", searchArea: "Hong Kong" },
    });
    await built.sessions.reconcileDiscoveryState(
      id,
      mappedPlan({ familyId: "it-project-delivery", version: 1 }),
      ["end-to-end-delivery"],
      true,
    );
    return { id, cookie };
  }

  async function signIn(built: ReturnType<typeof buildServer>, cookie: string, email: string) {
    const link = await built.app.inject({
      method: "POST",
      url: "/auth/request-link",
      headers: { cookie },
      payload: { email },
    });
    const token = new URL("http://test" + link.json().devLink).searchParams.get("token")!;
    await built.app.inject({
      method: "POST",
      url: "/auth/verify",
      headers: { cookie },
      payload: { token },
    });
  }

  async function liveSnapshotHarness() {
    const fixturePosting = loadPostings().find((posting) => posting.language === "en")!;
    const canonicalKey = canonicalKeyOf(fixturePosting.company, fixturePosting.location, fixturePosting.title);
    const retrievePostings = vi.fn(async () => {
      const now = new Date().toISOString();
      return {
        schemaVersion: "4" as const,
        outcome: "relevant_postings" as const,
        postings: [{
          schemaVersion: "4" as const,
          id: `posting:${canonicalKey}`,
          canonicalKey,
          title: fixturePosting.title,
          company: fixturePosting.company,
          location: fixturePosting.location,
          sourceUrl: "https://example.com/current-live-posting",
          excerpt: "We are hiring a project manager to lead delivery with our technology team in Hong Kong.",
          postedAt: "2026-08-11T00:00:00.000Z",
          capturedAt: now,
          verifiedLiveAt: now,
          expiresAt: null,
          attribution: [],
          sources: [{ providerId: "techmap", providerPostingId: "current-live-posting" }],
          skills: ["Project management"],
          language: "en",
        }],
        coverage: { providersQueried: ["techmap"], providersUnavailable: [], complete: true },
        retrievedAt: now,
      };
    });
    const readAd = async (posting: Posting): Promise<AdRequirementsV1> => ({
      schemaVersion: "1",
      adId: posting.id,
      curated: false,
      language: posting.language,
      familyFit: { family: "it-project-delivery", confidence: 0.9 },
      requirements: [{
        id: "project-delivery",
        band: "essential",
        kind: "ordinary",
        requirement: "Deliver technology projects",
        sourceSpan: "project manager",
      }],
    });
    const built = buildServer({
      productionFamilyFloors: initialProductionFamilyFloors(),
      retrievePostings,
      readAd,
    });
    const { id, cookie } = await authorizedSession(built);
    await built.app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } });
    await vi.waitFor(async () =>
      expect((await built.sessions.getById(id))?.retrieval?.result.outcome).toBe("relevant_postings"),
    );
    const current = await built.app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } });
    const liveId = current.json().retrieval.postings[0].id as string;
    expect(current.json().cards.map((card: { adId: string }) => card.adId)).toContain(liveId);
    await signIn(built, cookie, `snapshot-${canonicalKey.slice(0, 8)}@example.com`);
    expect((await built.app.inject({
      method: "POST",
      url: `/onboarding/cards/${encodeURIComponent(liveId)}/want`,
      headers: { cookie },
    })).statusCode).toBe(200);
    const requestFingerprint = (await built.sessions.getById(id))!.retrieval!.requestFingerprint;
    return { built, cookie, id, liveId, requestFingerprint, retrievePostings };
  }

  // #235: a session with no search family (the word search) reaches retrieval through the same
  // route, with the same coordinator and the same provider path — never a family refusal.
  it("retrieves and serves a live deck for a word-plan session with no search family", async () => {
    const fixturePosting = loadPostings().find((posting) => posting.language === "en")!;
    const canonicalKey = canonicalKeyOf(fixturePosting.company, fixturePosting.location, fixturePosting.title);
    const retrievePostings = vi.fn(async () => {
      const now = new Date().toISOString();
      return {
        schemaVersion: "4" as const,
        outcome: "relevant_postings" as const,
        postings: [{
          schemaVersion: "4" as const,
          id: `posting:${canonicalKey}`,
          canonicalKey,
          title: fixturePosting.title,
          company: fixturePosting.company,
          location: fixturePosting.location,
          sourceUrl: "https://example.com/word-search-posting",
          excerpt: "We are hiring a project manager to lead delivery in Hong Kong.",
          postedAt: "2026-08-11T00:00:00.000Z",
          capturedAt: now,
          verifiedLiveAt: now,
          expiresAt: null,
          attribution: [],
          sources: [{ providerId: "techmap", providerPostingId: "word-search-posting" }],
          skills: ["Project management"],
          language: "en",
        }],
        coverage: { providersQueried: ["techmap"], providersUnavailable: [], complete: true },
        retrievedAt: now,
      };
    });
    // The live posting needs a readable requirement set to become a card, same as the harness below.
    const readAd = async (posting: Posting): Promise<AdRequirementsV1> => ({
      schemaVersion: "1",
      adId: posting.id,
      curated: false,
      language: posting.language,
      familyFit: { family: "it-project-delivery", confidence: 0.9 },
      requirements: [{
        id: "project-delivery",
        band: "essential",
        kind: "ordinary",
        requirement: "Deliver technology projects",
        sourceSpan: "project manager",
      }],
    });
    const built = buildServer({ retrievePostings, readAd });
    const created = await built.app.inject({ method: "POST", url: "/sessions/anonymous" });
    const id = created.json().id as string;
    const cookie = `jc_session=${created.cookies.find((item) => item.name === "jc_session")!.value}`;
    await built.app.inject({
      method: "PUT",
      url: "/sessions/me/intent",
      headers: { cookie },
      payload: { targetRole: "Orbital Farm Planner", searchArea: "Hong Kong" },
    });
    const floor = { familyId: "it-project-delivery", version: 1 };
    await built.sessions.reconcileDiscoveryState(
      id,
      { questionFloors: [floor], searchFamily: null },
      ["end-to-end-delivery"],
      true,
    );

    await built.app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } });
    await vi.waitFor(async () =>
      expect((await built.sessions.getById(id))?.retrieval?.result.outcome).toBe("relevant_postings"),
    );
    expect(retrievePostings).toHaveBeenCalledWith(
      expect.objectContaining({ family: null, questionFloors: [floor] }),
    );

    const current = await built.app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } });
    const liveId = current.json().retrieval.postings[0].id as string;
    expect(current.json().cards.map((card: { adId: string }) => card.adId)).toContain(liveId);
  });

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
    await app.inject({
      method: "PUT",
      url: "/sessions/me/intent",
      headers: { cookie },
      payload: { targetRole: "Programme Manager", searchArea: "Hong Kong" },
    });
    await sessions.reconcileDiscoveryState(
      sessionId,
      mappedPlan({ familyId: "it-project-delivery", version: 1 }),
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
      searchAreas: ["Hong Kong"],
      family: { familyId: "it-project-delivery", version: 1 },
      questionFloors: [{ familyId: "it-project-delivery", version: 1 }],
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

  it.each([
    {
      id: "ats-bullets",
      format: "ATS bullet list",
      description:
        "Responsibilities:\n- Manage end-to-end delivery\n- Stakeholder engagement\n" +
        "- Budget governance\n- Risk planning\n- Vendor coordination",
    },
    {
      id: "skills-blob",
      format: "bare skills blob",
      description: "Agile Scrum Jira Confluence Stakeholder Management Risk Governance Budget Planning",
    },
    {
      id: "recruiter-one-liner",
      format: "recruiter one-liner",
      description: "Hiring now: Senior IT Project Manager - hybrid Hong Kong. #projectmanagement #agile",
    },
  ])("ingests an English $format through the provider and exposes it through the deck API", async ({ id: caseId, description }) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-11T12:00:00.000Z"));
    const fixturePosting = loadPostings().find((posting) => posting.language === "en")!;
    const providerPolicy: PostingProviderPolicyV1 = {
      schemaVersion: "2",
      providerId: "techmap",
      regionsServed: ["HK"],
      authorityRank: 1,
      permitsStorage: true,
      permitsMatching: true,
      attributionRequired: false,
      attributionTemplate: null,
      rateLimit: { perSecond: null, perMinute: null, perDay: null, perMonth: null },
      retry: { maxAttempts: 1, backoffMs: 0 },
      timeoutMs: 1000,
      costModel: { kind: "operatorHours" },
      freshnessTtlHours: 24,
    };
    const provider = new TechmapPostingProvider({
      apiKey: "test-key",
      policy: providerPolicy,
      now: Date.now,
      fetchImpl: async () => new Response(JSON.stringify({
        result: [{
          title: fixturePosting.title,
          jsonLD: {
            identifier: caseId,
            title: fixturePosting.title,
            description,
            hiringOrganization: fixturePosting.company,
            jobLocation: fixturePosting.location,
            url: `https://example.com/${caseId}`,
            datePosted: "2026-08-11",
            skills: ["Program management"],
          },
        }],
        totalCount: 1,
      }), { status: 200, headers: { "content-type": "application/json" } }),
    });
    const productionFamilyFloors = initialProductionFamilyFloors();
    const retrievePostings = makePostingRetriever({
      registry: [providerPolicy],
      providers: [provider],
      store: new InMemoryPostingStore(),
      productionFamilyFloors,
      now: () => new Date(),
    });
    const readAd = async (posting: Posting): Promise<AdRequirementsV1> => ({
      schemaVersion: "1",
      adId: posting.id,
      curated: false,
      language: posting.language,
      familyFit: { family: "it-project-delivery", confidence: 0.9 },
      requirements: [
        {
          id: "project-delivery",
          band: "essential",
          kind: "ordinary",
          requirement: "Deliver technology projects",
          sourceSpan: "Project Manager",
        },
        {
          id: "risk-management",
          band: "standard",
          kind: "ordinary",
          requirement: "Manage project risks",
          sourceSpan: "Risk planning",
        },
      ],
    });
    const built = buildServer({ productionFamilyFloors, retrievePostings, readAd });
    const { id, cookie } = await authorizedSession(built);

    await built.app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } });
    await vi.waitFor(async () =>
      expect((await built.sessions.getById(id))?.retrieval?.result.outcome).toBe("relevant_postings"),
    );
    const completed = await built.app.inject({
      method: "GET",
      url: "/onboarding/cards",
      headers: { cookie },
    });

    expect(completed.json().retrieval).toMatchObject({
      outcome: "relevant_postings",
      postings: [{ title: fixturePosting.title, language: "en" }],
    });
    const livePosting = completed.json().retrieval.postings[0];
    await signIn(built, cookie, `${caseId}@example.com`);
    const wanted = await built.app.inject({
      method: "POST",
      url: `/onboarding/cards/${encodeURIComponent(livePosting.id)}/want`,
      headers: { cookie },
    });
    expect(wanted.statusCode).toBe(200);
    const tailor = await built.app.inject({ method: "GET", url: "/onboarding/tailor", headers: { cookie } });
    expect(tailor.statusCode).toBe(200);
    expect(tailor.json().card).toMatchObject({ adId: livePosting.id, adExcerpt: description });
    const initialPct = tailor.json().card.matchPct as number;
    const firstRequirementId = tailor.json().questions[0].requirementId as string;
    const firstAnswer = await built.app.inject({
      method: "POST",
      url: "/onboarding/tailor/answer",
      headers: { cookie },
      payload: { requirementId: firstRequirementId, answer: "Yes" },
    });
    expect(firstAnswer.statusCode).toBe(200);
    expect(firstAnswer.json().card.matchPct).toBeGreaterThan(initialPct);

    const resumed = await built.app.inject({ method: "GET", url: "/onboarding/tailor", headers: { cookie } });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json().card.matchPct).toBe(firstAnswer.json().card.matchPct);
    const secondRequirementId = resumed.json().questions[0].requirementId as string;
    expect(secondRequirementId).not.toBe(firstRequirementId);
    const secondAnswer = await built.app.inject({
      method: "POST",
      url: "/onboarding/tailor/answer",
      headers: { cookie },
      payload: { requirementId: secondRequirementId, answer: "No" },
    });
    expect(secondAnswer.statusCode).toBe(200);
    const completedTailor = await built.app.inject({ method: "GET", url: "/onboarding/tailor", headers: { cookie } });
    expect(completedTailor.statusCode).toBe(200);
    expect(completedTailor.json()).toMatchObject({ done: true, closedGaps: { asked: 2 } });

    const sameAdvertCards = completed.json().cards.filter((card: Record<string, unknown>) =>
      card.title === fixturePosting.title &&
      card.company === fixturePosting.company &&
      card.place === fixturePosting.location,
    );
    expect(sameAdvertCards).toEqual([
      expect.objectContaining({ adId: livePosting.id, adExcerpt: description }),
    ]);
  });

  it("holds a stale persisted live posting out of deck, want, and tailor until refresh completes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-11T12:00:00.000Z"));
    const { built, cookie, id, liveId, retrievePostings } = await liveSnapshotHarness();
    vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));

    expect((await built.app.inject({ method: "GET", url: "/onboarding/tailor", headers: { cookie } })).statusCode).toBe(404);
    expect((await built.app.inject({
      method: "POST",
      url: `/onboarding/cards/${encodeURIComponent(liveId)}/want`,
      headers: { cookie },
    })).statusCode).toBe(404);
    const refreshing = await built.app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } });
    expect(refreshing.json().retrieval).toMatchObject({
      outcome: "provider_unavailable",
      reason: "posting retrieval is in progress",
    });
    expect(refreshing.json().cards.map((card: { adId: string }) => card.adId)).not.toContain(liveId);

    await vi.waitFor(() => expect(retrievePostings).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () =>
      expect((await built.sessions.getById(id))?.retrieval?.result.postings?.[0]?.verifiedLiveAt)
        .toBe("2026-08-13T12:00:00.000Z"),
    );
    const current = await built.app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } });
    expect(current.json().cards.map((card: { adId: string }) => card.adId)).toContain(liveId);
    expect((await built.app.inject({ method: "GET", url: "/onboarding/tailor", headers: { cookie } })).statusCode).toBe(200);
    expect((await built.app.inject({
      method: "POST",
      url: `/onboarding/cards/${encodeURIComponent(liveId)}/want`,
      headers: { cookie },
    })).statusCode).toBe(200);
  });

  it("holds a fingerprint-mismatched persisted live posting out of deck, want, and tailor until refresh completes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-11T12:00:00.000Z"));
    const { built, cookie, id, liveId, requestFingerprint, retrievePostings } = await liveSnapshotHarness();
    await built.claims.seed(id, [claim("new-evidence", "New delivery evidence", "Delivery")]);
    await built.claims.confirm(id, "new-evidence");

    expect((await built.app.inject({ method: "GET", url: "/onboarding/tailor", headers: { cookie } })).statusCode).toBe(404);
    expect((await built.app.inject({
      method: "POST",
      url: `/onboarding/cards/${encodeURIComponent(liveId)}/want`,
      headers: { cookie },
    })).statusCode).toBe(404);
    const refreshing = await built.app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } });
    expect(refreshing.json().retrieval).toMatchObject({
      outcome: "provider_unavailable",
      reason: "posting retrieval is in progress",
    });
    expect(refreshing.json().cards.map((card: { adId: string }) => card.adId)).not.toContain(liveId);

    await vi.waitFor(() => expect(retrievePostings).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () =>
      expect((await built.sessions.getById(id))?.retrieval?.requestFingerprint)
        .not.toBe(requestFingerprint),
    );
    const current = await built.app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } });
    expect(current.json().cards.map((card: { adId: string }) => card.adId)).toContain(liveId);
    expect((await built.app.inject({ method: "GET", url: "/onboarding/tailor", headers: { cookie } })).statusCode).toBe(200);
    expect((await built.app.inject({
      method: "POST",
      url: `/onboarding/cards/${encodeURIComponent(liveId)}/want`,
      headers: { cookie },
    })).statusCode).toBe(200);
  });

  it("reuses an unchanged fresh snapshot without another provider call", async () => {
    const retrievePostings = vi.fn(async () => ({
      schemaVersion: "4" as const,
      outcome: "empty_pool" as const,
      coverage: { providersQueried: ["techmap"], providersUnavailable: [], complete: true },
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

  // #174 must-fix 3: surfaced while fixing #174 (the "techmap" swap above needed doing at all because
  // "curated-pool" had stopped being a real provider) — a real, previously untested consequence of
  // isReusableRetrievalSnapshot's own registry lookup (postingRetrieval.ts): a stored empty_pool
  // snapshot naming a provider the CURRENT registry doesn't recognise is never reused. Honest, not a
  // bug — but until now nothing pinned it, so a future registry edit (e.g. retiring a provider id)
  // could silently start re-spending a real provider call on every live session's next read, with
  // nothing going red. That collides with the repo's "retries never re-spend" rule if it ever
  // regresses, which is exactly what this test exists to catch.
  it("#174: a snapshot naming a provider the registry no longer recognises is never reused — the next request re-spends", async () => {
    const retrievePostings = vi.fn(async () => ({
      schemaVersion: "4" as const,
      outcome: "empty_pool" as const,
      coverage: { providersQueried: ["retired-provider"], providersUnavailable: [], complete: true },
      retrievedAt: new Date().toISOString(),
    }));
    const built = buildServer({ retrievePostings });
    const { id, cookie } = await authorizedSession(built);
    await built.app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } });
    await vi.waitFor(async () =>
      expect((await built.sessions.getById(id))?.retrieval?.result.outcome).toBe("empty_pool"),
    );
    const second = await built.app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } });
    expect(second.json().retrieval.outcome).toBe("provider_unavailable"); // re-attempting, not reused
    await vi.waitFor(() => expect(retrievePostings).toHaveBeenCalledTimes(2));
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
        coverage: { providersQueried: ["techmap"], providersUnavailable: [], complete: true },
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
        coverage: { providersQueried: ["techmap"], providersUnavailable: [], complete: true },
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
        coverage: { providersQueried: ["techmap"], providersUnavailable: [], complete: true },
        retrievedAt: new Date().toISOString(),
      };
    });
    const built = buildServer({ retrievePostings });
    const { id, cookie } = await authorizedSession(built);
    const oldRequest = built.app.inject({ method: "GET", url: "/onboarding/cards", headers: { cookie } });
    await vi.waitFor(() => expect(retrievePostings).toHaveBeenCalledOnce());
    await built.app.inject({
      method: "PUT",
      url: "/sessions/me/intent",
      headers: { cookie },
      payload: { searchArea: "Singapore" },
    });
    release();
    await oldRequest;
    expect((await built.sessions.getById(id))?.retrieval).toBeNull();
  });

  const putIntent = async (built: ReturnType<typeof buildServer>, cookie: string) => {
    await built.app.inject({
      method: "PUT",
      url: "/sessions/me/intent",
      headers: { cookie },
      payload: { targetRole: "Programme Manager", searchArea: "Hong Kong" },
    });
  };

  it.each([
    {
      name: "missing intent",
      arrange: async () => undefined,
      code: "missing_intent",
    },
    {
      name: "unpublished or fixture family",
      arrange: async (built: ReturnType<typeof buildServer>, id: string, cookie: string) => {
        await putIntent(built, cookie);
        await built.sessions.reconcileDiscoveryState(id, mappedPlan({ familyId: "fixture-only", version: 1 }), [], true);
      },
      code: "family_not_published",
    },
    {
      name: "incomplete production floor",
      arrange: async (built: ReturnType<typeof buildServer>, id: string, cookie: string) => {
        await putIntent(built, cookie);
        await built.sessions.reconcileDiscoveryState(
          id,
          mappedPlan({ familyId: "it-project-delivery", version: 1 }),
          ["end-to-end-delivery"],
          false,
        );
      },
      code: "floor_not_covered",
    },
    {
      // #214: the intent route now REFUSES an uncovered text outright ("Atlantis" is never stored),
      // so this arm is reached with a stored area the RETRIEVER's registry doesn't cover — this
      // test's retriever runs on an empty registry, so "Hong Kong" is exactly that.
      name: "uncovered search area",
      arrange: async (built: ReturnType<typeof buildServer>, id: string, cookie: string) => {
        await putIntent(built, cookie);
        await built.sessions.reconcileDiscoveryState(
          id,
          mappedPlan({ familyId: "it-project-delivery", version: 1 }),
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
    const cookie = `jc_session=${created.cookies.find((item) => item.name === "jc_session")!.value}`;
    await arrange(built, id, cookie);
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
