// #220 (labeler slice 1) — the job labeler's target-role half, tested at the API surface with the
// fake LLM injected at the seam production uses (buildServer's placeFamily, wired through
// makeFamilyPlacer exactly as main.ts wires it). No new injection points: a test that wants a
// particular placement makes the FAKE MODEL say it, so the assembly, the closed-vocabulary check,
// the retry and the degradation are all under test rather than stepped over.
//
// The measurement grid (the accuracy bars ADR-0014 gates trusting the labeler on) is deliberately
// NOT here — it costs real model calls and runs as a separate eval: eval/familyLabeler.eval.ts.
import { beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import type { LlmClient } from "../src/llm.js";
import {
  makeFamilyPlacer,
  placeTargetRole,
  publishedFamilies,
  type PublishedFamily,
} from "../src/familyLabeler.js";
import { initialProductionFamilyFloors } from "../src/familyFloors.js";
import { readCounters, recentUnmappedLabelsList, resetCountersForTest } from "../src/counters.js";

/** Answers with each queued reply in turn, recording every prompt it was given. A queue shorter
 *  than the number of calls repeats its last entry — a "the model keeps saying the same wrong
 *  thing" fake, which is what the degrade-to-unmapped path needs. */
function fakeLlm(replies: string[]) {
  const prompts: string[] = [];
  const llm: LlmClient = {
    async complete(prompt: string) {
      prompts.push(prompt);
      return replies[Math.min(prompts.length - 1, replies.length - 1)] ?? "";
    },
  };
  return { llm, prompts };
}

const PUBLISHED = publishedFamilies(initialProductionFamilyFloors());

// A second family exists nowhere in production yet (exactly one is published), so the ambiguity
// path is exercised against a two-family vocabulary handed to the labeler directly — the closed
// list is a parameter, which is what makes a newly published family need no code change.
// Its own fixture, NOT eval/harness.ts's synthetic family, and the difference is deliberate: this
// one is published at version 2 so the tests below prove the placement carries the version off the
// REGISTRY rather than a hardcoded 1. Don't "fix" the two into agreement.
const TWO_FAMILIES: PublishedFamily[] = [
  ...PUBLISHED,
  {
    familyId: "product-management",
    version: 2,
    label: "Product management",
    scope: "Deciding what a product should be and why.",
    exampleTitles: ["Product Manager"],
    coreWork: ["Have you owned a product's direction?"],
  },
];

beforeEach(() => resetCountersForTest());

describe("#220 placing a target role in a job family", () => {
  it("confirms a role in a published family, carrying that family's id AND version", async () => {
    const { llm } = fakeLlm(['{"outcome":"confirmed","familyId":"it-project-delivery","why":"delivery"}']);

    expect(await placeTargetRole("IT project manager", PUBLISHED, llm)).toEqual({
      schemaVersion: "1",
      outcome: "confirmed",
      family: { familyId: "it-project-delivery", version: 1 },
    });
    expect(readCounters()["familyLabeler.confirmed"]).toBe(1);
  });

  it("offers the choices on a genuine two-family fit and picks none of them itself", async () => {
    const { llm } = fakeLlm([
      '{"outcome":"needs_clarification","familyIds":["it-project-delivery","product-management"]}',
    ]);

    expect(await placeTargetRole("technical product delivery lead", TWO_FAMILIES, llm)).toEqual({
      schemaVersion: "1",
      outcome: "needs_clarification",
      // Labels are the PUBLISHED display names, not whatever the model might have called them.
      choices: [
        { familyId: "it-project-delivery", version: 1, label: "IT project delivery" },
        { familyId: "product-management", version: 2, label: "Product management" },
      ],
    });
    expect(readCounters()["familyLabeler.needs_clarification"]).toBe(1);
  });

  it("stays unmapped for a role no family covers, and records it as vocabulary feed", async () => {
    const { llm } = fakeLlm(['{"outcome":"unmapped","why":"no family covers nursing"}']);

    expect(await placeTargetRole("paediatric nurse practitioner", PUBLISHED, llm)).toEqual({
      schemaVersion: "1",
      outcome: "unmapped",
    });
    expect(readCounters()["familyLabeler.unmapped"]).toBe(1);
    expect(recentUnmappedLabelsList().map((entry) => entry.role)).toEqual([
      "paediatric nurse practitioner",
    ]);
  });

  it("re-prompts once with the validation error and accepts the corrected answer", async () => {
    const { llm, prompts } = fakeLlm([
      '{"outcome":"confirmed","familyId":"delivery-leadership"}', // not a published family
      '{"outcome":"confirmed","familyId":"it-project-delivery"}',
    ]);

    const placement = await placeTargetRole("delivery manager", PUBLISHED, llm);

    expect(placement).toMatchObject({ outcome: "confirmed" });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("unknown family id: delivery-leadership");
  });

  it("degrades to unmapped after two bad answers — never a guess at the nearest family", async () => {
    const { llm, prompts } = fakeLlm(['{"outcome":"confirmed","familyId":"something-invented"}']);

    expect(await placeTargetRole("delivery manager", PUBLISHED, llm)).toEqual({
      schemaVersion: "1",
      outcome: "unmapped",
    });
    expect(prompts).toHaveLength(2); // exactly one retry, then it stops paying
    expect(readCounters()["familyLabeler.output_invalid"]).toBe(1);
    expect(recentUnmappedLabelsList()[0].reason).toContain("failed validation twice");
  });

  it("never shows a choice between one family twice", async () => {
    const { llm } = fakeLlm([
      '{"outcome":"needs_clarification","familyIds":["it-project-delivery","it-project-delivery"]}',
    ]);

    expect(await placeTargetRole("delivery manager", PUBLISHED, llm)).toMatchObject({
      outcome: "unmapped",
    });
  });

  it("spends nothing when there is no target role to place", async () => {
    const { llm, prompts } = fakeLlm(['{"outcome":"confirmed","familyId":"it-project-delivery"}']);

    expect(await placeTargetRole("   ", PUBLISHED, llm)).toMatchObject({ outcome: "unmapped" });
    expect(prompts).toEqual([]);
  });
});

// --- the production seam: what a visitor actually reaches -----------------------------------------

const setup = async (llm: LlmClient, targetRole: string | null = "IT project manager") => {
  const built = buildServer({
    placeFamily: makeFamilyPlacer(llm, PUBLISHED),
  });
  const created = await built.app.inject({ method: "POST", url: "/sessions/anonymous" });
  const cookie = `jc_session=${created.cookies.find((value) => value.name === "jc_session")!.value}`;
  if (targetRole) {
    await built.app.inject({
      method: "PUT",
      url: "/sessions/me/intent",
      headers: { cookie },
      payload: { targetRole },
    });
  }
  return { ...built, cookie, sessionId: created.json().id as string };
};

const evaluate = (app: Awaited<ReturnType<typeof setup>>["app"], cookie: string) =>
  app.inject({
    method: "POST",
    url: "/onboarding/discovery/production/evaluate",
    headers: { cookie },
  });

describe("#220 production discovery, with the real labeler wired", () => {
  it("opens for a confirmed visitor — floor and checkpoint are written", async () => {
    const { llm } = fakeLlm(['{"outcome":"confirmed","familyId":"it-project-delivery"}']);
    const { app, sessions, cookie, sessionId } = await setup(llm);

    const response = await evaluate(app, cookie);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      floor: { familyId: "it-project-delivery", version: 1 },
      checkpoint: "family_confirmed",
    });
    expect((await sessions.getById(sessionId))?.discovery).toMatchObject({
      floor: { familyId: "it-project-delivery", version: 1 },
      checkpoint: "family_confirmed",
    });
  });

  it("hands an ambiguous visitor the choices instead of a family", async () => {
    const { llm } = fakeLlm([
      '{"outcome":"needs_clarification","familyIds":["it-project-delivery","product-management"]}',
    ]);
    const built = buildServer({ placeFamily: makeFamilyPlacer(llm, TWO_FAMILIES) });
    const created = await built.app.inject({ method: "POST", url: "/sessions/anonymous" });
    const cookie = `jc_session=${created.cookies.find((v) => v.name === "jc_session")!.value}`;
    await built.app.inject({
      method: "PUT",
      url: "/sessions/me/intent",
      headers: { cookie },
      payload: { targetRole: "technical delivery product lead" },
    });

    const response = await evaluate(built.app, cookie);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: "placement_needs_clarification" },
      choices: [
        { familyId: "it-project-delivery", version: 1, label: "IT project delivery" },
        { familyId: "product-management", version: 2, label: "Product management" },
      ],
      rewardEligible: false,
    });
  });

  it("offers family research to an unmapped visitor, never the nearest family", async () => {
    const { llm } = fakeLlm(['{"outcome":"unmapped"}']);
    const { app, sessions, cookie, sessionId } = await setup(llm, "paediatric nurse practitioner");

    const response = await evaluate(app, cookie);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: "placement_not_confirmed" },
      familyResearch: { path: "/family-learning/candidates" },
      rewardEligible: false,
    });
    // Nothing was pinned on an unconfirmed placement.
    expect((await sessions.getById(sessionId))?.discovery.floor).toBeNull();
  });

  it("does not block the visitor when the model is unavailable, and authorizes nothing", async () => {
    const llm: LlmClient = {
      async complete() {
        throw new Error("anthropic api 529: overloaded");
      },
    };
    const { app, cookie } = await setup(llm);

    const response = await evaluate(app, cookie);

    expect(response.statusCode).toBe(409); // an honest "not yet", never a 500
    expect(response.json()).toMatchObject({ rewardEligible: false });
    expect(readCounters()["familyLabeler.call_failed"]).toBe(1);

    // The rest of onboarding is untouched by a labeler outage.
    const discovery = await app.inject({
      method: "GET",
      url: "/onboarding/discovery",
      headers: { cookie },
    });
    expect(discovery.statusCode).toBe(200);
  });

  it("does not pay twice for the same visitor's same role, and places again when they change it", async () => {
    const { llm, prompts } = fakeLlm(['{"outcome":"confirmed","familyId":"it-project-delivery"}']);
    const { app, cookie } = await setup(llm);

    await evaluate(app, cookie);
    await evaluate(app, cookie);
    expect(prompts).toHaveLength(1);

    await app.inject({
      method: "PUT",
      url: "/sessions/me/intent",
      headers: { cookie },
      payload: { targetRole: "delivery manager" },
    });
    await evaluate(app, cookie);
    expect(prompts).toHaveLength(2);
  });

  it("never remembers an answer a failing model produced", async () => {
    let failing = true;
    const llm: LlmClient = {
      async complete() {
        if (failing) throw new Error("anthropic api 529: overloaded");
        return '{"outcome":"confirmed","familyId":"it-project-delivery"}';
      },
    };
    const { app, cookie } = await setup(llm);

    expect((await evaluate(app, cookie)).statusCode).toBe(409);
    failing = false;
    expect((await evaluate(app, cookie)).statusCode).toBe(200);
  });

  it("exposes unmapped roles as feed for the vocabulary-growth process, key-gated", async () => {
    const { llm } = fakeLlm(['{"outcome":"unmapped"}']);
    const { app, cookie } = await setup(llm, "harbour pilot");
    await evaluate(app, cookie);

    const open = await app.inject({ method: "GET", url: "/ops/unmapped-labels" });
    expect(open.statusCode).toBe(403);

    process.env.OPS_KEY = "ops-test-key";
    try {
      const gated = await app.inject({ method: "GET", url: "/ops/unmapped-labels?key=ops-test-key" });
      expect(gated.statusCode).toBe(200);
      expect(gated.json().entries).toMatchObject([{ role: "harbour pilot" }]);
    } finally {
      delete process.env.OPS_KEY;
    }
  });
});
