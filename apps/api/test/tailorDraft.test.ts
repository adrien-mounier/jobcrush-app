// #310 — the CV brain's caller, observed through the API boundary (spec #301's primary seam):
// the draft is bound to the job being tailored, checkpointed so nothing re-spends, redrafted when
// a supported answer changes the facts, and the card's negatives/open points ride into the input
// as context — never as material. The engine itself (lint, retry, notices, render) is preview.ts's
// and stays covered by preview.test.ts; what this file pins is the BINDING.
import { describe, expect, it } from "vitest";
import { buildItProjectDeliveryServer as buildServer } from "./placedServer.js";
import { liveIdFor, warmRetrieval } from "./fixtureDeck.js";
import { loadAdRequirements } from "../src/e5stub.js";
import type { LlmClient } from "../src/llm.js";
import { tailorClaimId } from "../src/tailor.js";

const ROLE = "IT project manager in Paris";
const FIXTURE_AD_ID = "2026-07-05_endava-vietnam_senior-project-manager";
const VALID_AD_ID = liveIdFor(FIXTURE_AD_ID);
const END_TO_END = "end-to-end-delivery";
const STAKEHOLDERS = "stakeholder-coordination";
const RISKS = "risk-dependency-control";
const COMMUNICATION = "delivery-communication";

type App = ReturnType<typeof buildServer>["app"];
const get = (app: App, cookie: string, url: string) =>
  app.inject({ method: "GET", url, headers: { cookie } });
const post = (app: App, cookie: string, url: string, payload?: unknown) =>
  app.inject({ method: "POST", url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });

async function anonSession(app: App): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/sessions/anonymous" });
  return `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
}
async function signIn(app: App, cookie: string, email: string): Promise<void> {
  const link = await post(app, cookie, "/auth/request-link", { email });
  const token = new URL("http://x" + link.json().devLink).searchParams.get("token")!;
  await post(app, cookie, "/auth/verify", { token });
}

/** Discovery → sign in → retrieval → want: the same walk tailor.test.ts makes. */
async function reachTailor(app: App, cookie: string, email: string) {
  await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
  await post(app, cookie, "/onboarding/discovery/answer", { itemId: END_TO_END, answer: "Yes" });
  await post(app, cookie, "/onboarding/discovery/answer", {
    itemId: STAKEHOLDERS,
    answer: "Business, engineering, and vendors",
  });
  await post(app, cookie, "/onboarding/discovery/answer", { itemId: RISKS, answer: "No" });
  await post(app, cookie, "/onboarding/discovery/answer", {
    itemId: COMMUNICATION,
    answer: "Weekly steering updates",
  });
  await signIn(app, cookie, email);
  await warmRetrieval(app, cookie);
  await post(app, cookie, `/onboarding/cards/${VALID_AD_ID}/want`);
}

/** A fake tailor model: cites real claim ids read back out of the prompt's own Claims: block (the
 *  qa-main idiom), holds one claim back so the #154 disclosure has something to say, and records
 *  every prompt so the tests can assert what the engine was actually handed. */
function draftingLlm(overrides: { citeUnknownId?: boolean } = {}) {
  const prompts: string[] = [];
  const llm: LlmClient = {
    model: "test-fake",
    async complete(prompt: string): Promise<string> {
      prompts.push(prompt);
      const claimsBlock = prompt.split("Claims:\n")[1] ?? "";
      const ids = [...claimsBlock.matchAll(/^- ([a-z0-9][a-z0-9-]*) \[/gm)].map((m) => m[1]!);
      const draft = {
        name: "Test Person",
        headline: "IT Project Manager",
        contact: "Hanoi",
        summary: "Delivery-accountable project manager.",
        experience: [
          {
            role: "IT Project Manager",
            employer: "Endava",
            location: "",
            dates: "2021 - Present",
            bullets: [
              {
                text: "Ran end-to-end delivery for the programme",
                claimIds: [overrides.citeUnknownId ? "invented-claim" : ids[0]!],
                outcome: "",
              },
            ],
            unprinted: ids.length > 1 ? [ids[1]!] : [],
          },
        ],
        skills: [{ label: "Delivery", items: ["Jira"] }],
        certifications: [],
        education: [],
        additional: [],
      };
      return JSON.stringify(draft);
    },
  };
  return { prompts, llm };
}

/** The job the 202 named, watched to a terminal state — what the screen does over SSE. */
async function awaitJob(app: App, cookie: string, jobId: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const res = await get(app, cookie, `/jobs/${jobId}`);
    const job = res.json();
    if (job.status === "completed" || job.status === "failed") return job;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("draft job never settled");
}

describe("#310 POST /onboarding/tailor/draft — guards", () => {
  it("409s with no_tailor_target when no job is being tailored", async () => {
    const { app } = buildServer({ tailorLlm: draftingLlm().llm });
    const cookie = await anonSession(app);
    await signIn(app, cookie, "draft-no-target@example.com");
    const res = await post(app, cookie, "/onboarding/tailor/draft");
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("no_tailor_target");
  });

  it("503s honestly when no model client is wired — never an invented draft", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "draft-unwired@example.com");
    const res = await post(app, cookie, "/onboarding/tailor/draft");
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("draft_unavailable");
  });

  it("GET before any draft exists is an honest 404, not an empty document", async () => {
    const { app } = buildServer({ tailorLlm: draftingLlm().llm });
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "draft-none-yet@example.com");
    const res = await get(app, cookie, "/onboarding/tailor/draft");
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("no_draft");
  });
});

describe("#310 the draft is the CV brain's, checkpointed, and the ending can read it", () => {
  it("draft → checkpoint → read: one model call, then reuse for free, exit costs nothing", async () => {
    const { prompts, llm } = draftingLlm();
    const { app } = buildServer({ tailorLlm: llm });
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "draft-happy@example.com");

    const started = await post(app, cookie, "/onboarding/tailor/draft");
    expect(started.statusCode).toBe(202);
    const { jobId } = started.json();
    const job = await awaitJob(app, cookie, jobId);
    expect(job.status).toBe("completed");
    expect(prompts).toHaveLength(1);

    // The engine really was bound to THE JOB BEING TAILORED, not a title-matched lookalike.
    const adReq = loadAdRequirements(FIXTURE_AD_ID);
    expect(prompts[0]).toContain("===JOB-POSTING===");
    expect(prompts[0]).toContain("Endava");
    // …and the advert's essential requirements ride in as the gated dimensions.
    const essential = adReq.requirements.find((r) => r.band === "essential")!;
    expect(prompts[0]).toContain(essential.requirement);

    const read = await get(app, cookie, "/onboarding/tailor/draft");
    expect(read.statusCode).toBe(200);
    const view = read.json();
    // The rendered document carries the draft, and the disclosure says what was held back and why,
    // in the profile's own words (#154, re-homed).
    expect(view.html).toContain("Test Person");
    expect(view.html).toContain("Ran end-to-end delivery for the programme");
    expect(view.conservationNotices).toEqual([]);
    expect(view.disclosure).toHaveLength(1);
    expect(view.disclosure[0].heldBack).toHaveLength(1);

    // The checkpoint: asking again is free — no new job, no new model call (#66's fourth
    // criterion: leaving and coming back costs nothing, and there is no further gate).
    const again = await post(app, cookie, "/onboarding/tailor/draft");
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ ready: true });
    const reread = await get(app, cookie, "/onboarding/tailor/draft");
    expect(reread.statusCode).toBe(200);
    expect(prompts).toHaveLength(1);
  });

  it("a supported answer changes the facts, so the next draft is a fresh one — never the stale checkpoint", async () => {
    const { prompts, llm } = draftingLlm();
    const { app } = buildServer({ tailorLlm: llm });
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "draft-redraft@example.com");

    const first = await post(app, cookie, "/onboarding/tailor/draft");
    await awaitJob(app, cookie, first.json().jobId);
    expect(prompts).toHaveLength(1);

    // A supported answer through the queue's own door.
    const state = (await get(app, cookie, "/onboarding/tailor")).json();
    const advertQuestion = state.questions.find((q: { kind?: string }) => q.kind !== "profile");
    expect(advertQuestion).toBeDefined();
    await post(app, cookie, "/onboarding/tailor/answer", {
      requirementId: advertQuestion.requirementId,
      answer: "Yes",
    });

    const second = await post(app, cookie, "/onboarding/tailor/draft");
    expect(second.statusCode).toBe(202); // not `ready` — the fact set moved, the draft must too
    await awaitJob(app, cookie, second.json().jobId);
    expect(prompts).toHaveLength(2);
    // The new answer's claim is in the material handed to the engine.
    expect(prompts[1]).toContain("Weekly steering updates");
  });

  it("a 'No' and an open gap ride as context — never as claims the engine may render from (#66/#287)", async () => {
    const { prompts, llm } = draftingLlm();
    const { app } = buildServer({ tailorLlm: llm });
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "draft-negative@example.com");

    const state = (await get(app, cookie, "/onboarding/tailor")).json();
    const advertQuestions = state.questions.filter((q: { kind?: string }) => q.kind !== "profile");
    expect(advertQuestions.length).toBeGreaterThanOrEqual(2);
    const denied = advertQuestions[0];
    await post(app, cookie, "/onboarding/tailor/answer", {
      requirementId: denied.requirementId,
      answer: "No",
    });

    const started = await post(app, cookie, "/onboarding/tailor/draft");
    await awaitJob(app, cookie, started.json().jobId);
    const prompt = prompts[0]!;
    const adReq = loadAdRequirements(FIXTURE_AD_ID);
    const deniedText = adReq.requirements.find((r) => r.id === denied.requirementId)!.requirement;
    const openText = adReq.requirements.find((r) => r.id === advertQuestions[1].requirementId)!.requirement;

    expect(prompt).toContain("===CARD-CONTEXT===");
    const context = prompt.split("===CARD-CONTEXT===")[1]!.split("===JOB-POSTING===")[0]!;
    expect(context).toContain(deniedText); // the denial is named, under never-print
    expect(context).toContain(openText); // the unanswered gap is named, never as satisfied
    // The negative is NOT in the claims block — a "No" is structurally not material.
    const claimsBlock = prompt.split("Claims:\n")[1]!.split("===")[0]!;
    expect(claimsBlock).not.toContain(tailorClaimId(adReq.adId, denied.requirementId));
  });

  it("the stored CV letterhead reaches the engine — a real person is never drafted as 'Your name here' (QA D1)", async () => {
    const { prompts, llm } = draftingLlm();
    const server = buildServer({ tailorLlm: llm });
    const cookie = await anonSession(server.app);
    await reachTailor(server.app, cookie, "draft-header@example.com");
    // What the pipeline's extract step persists at mine time (server.ts's persistContact default,
    // extract.ts's extractContact.header) — written directly here because reachTailor's walk has
    // no CV upload in it.
    const sessionId = (await get(server.app, cookie, "/sessions/me")).json().id as string;
    await server.contact.put(sessionId, "header", {
      value: "Jane Dubois\nParis, France\njane@example.com",
      origin: "read",
      sourceText: "Jane Dubois\nParis, France\njane@example.com",
    });

    const started = await post(server.app, cookie, "/onboarding/tailor/draft");
    await awaitJob(server.app, cookie, started.json().jobId);
    // The engine's rule 3 prints name/city from CANDIDATE-HEADER — so the stored letterhead, not
    // "(none captured)", must be what it is handed.
    expect(prompts[0]).toContain("===CANDIDATE-HEADER===\nJane Dubois\nParis, France");
    expect(prompts[0]).not.toContain("(none captured)");
  });

  it("GET never serves a draft the facts have outgrown — a stale checkpoint reads as no draft", async () => {
    const { llm } = draftingLlm();
    const { app } = buildServer({ tailorLlm: llm });
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "draft-stale-get@example.com");

    const started = await post(app, cookie, "/onboarding/tailor/draft");
    await awaitJob(app, cookie, started.json().jobId);
    expect((await get(app, cookie, "/onboarding/tailor/draft")).statusCode).toBe(200);

    // The fact set moves; a direct GET (no POST first — a second tab, a stale client) must not
    // pair the old draft with a disclosure computed from the new claims.
    const state = (await get(app, cookie, "/onboarding/tailor")).json();
    const q = state.questions.find((question: { kind?: string }) => question.kind !== "profile");
    await post(app, cookie, "/onboarding/tailor/answer", { requirementId: q.requirementId, answer: "Yes" });

    const read = await get(app, cookie, "/onboarding/tailor/draft");
    expect(read.statusCode).toBe(404);
    expect(read.json().error.code).toBe("no_draft");
  });

  it("a draft that still fails the lint after its retry ships WITH its plain-words notices", async () => {
    const { prompts, llm } = draftingLlm({ citeUnknownId: true });
    const { app } = buildServer({ tailorLlm: llm });
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "draft-lossy@example.com");

    const started = await post(app, cookie, "/onboarding/tailor/draft");
    await awaitJob(app, cookie, started.json().jobId);
    expect(prompts).toHaveLength(2); // the lint retried once — existing engine behaviour, now reachable

    const view = (await get(app, cookie, "/onboarding/tailor/draft")).json();
    expect(view.conservationNotices.length).toBeGreaterThan(0);
    expect(view.conservationNotices[0]).toMatch(/could not be traced back to your CV/);
  });
});

// --- #311 (#287 c1/c2): every denial rides into the draft input, in its own words ------------------

describe("#311 the never-print list is session-wide, not advert-scoped", () => {
  it("the prompt's never-print block carries the discovery 'No', scaffolding stripped", async () => {
    const { prompts, llm } = draftingLlm();
    const { app } = buildServer({ tailorLlm: llm });
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "denied-in-prompt@example.com"); // records the RISKS discovery "No"
    const res = await post(app, cookie, "/onboarding/tailor/draft");
    expect(res.statusCode).toBe(202);
    await awaitJob(app, cookie, res.json().jobId);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("The candidate has said NO to these");
    // The denial in its OWN words — the floor question he answered "No" to — never only this
    // advert's requirement texts, and never the stored answer scaffolding.
    expect(prompts[0]).toContain("Have you acted on delivery risks, dependencies, timelines, or budgets?");
    expect(prompts[0]).not.toContain("Not applicable —");
  });
});
