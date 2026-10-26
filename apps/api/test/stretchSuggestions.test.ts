// #417 (ADR-0020 clause 3, ADR-0005 clauses 1-4 and 6): once the draft is written, ONE more model call
// suggests stretches beside it. Tested at the route seam with a fake tailor model and a fake
// suggestion model (tailorDraft.test.ts's idiom): what is stored beside the draft, what is dropped
// in code, what the checkpoint spends, and what "No" does.
import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { tailorRoutes, type TailorRouteDeps } from "../src/routes/tailor.js";
import { buildItProjectDeliveryServer as buildServer } from "./placedServer.js";
import { buildDeckServer, liveIdFor, warmRetrieval } from "./fixtureDeck.js";
import { IT_PROJECT_DELIVERY_PLACEMENT } from "./placedServer.js";
import { InMemoryJobStore, type JobRecord } from "../src/jobs.js";
import { InMemoryPasteRecordStore } from "../src/pasteRecordStore.js";
import { InMemoryPostingStore } from "../src/postingStore.js";
import type { PasteProgress } from "../src/routes/paste.js";
import type { LlmClient } from "../src/llm.js";
import type { Posting } from "../src/preview.js";
import { RESAY_LIMIT, RESAY_LINE, RESAY_PROMPT_HEADING, STRETCH_REQUIREMENT_LINE } from "../src/stretchSuggestions.js";
import { tailorClaimId } from "../src/tailor.js";
import { AdRequirementsV1, type CandidateClaim } from "@jobcrush/contracts";
import { InMemoryTailorDraftStore } from "../src/tailorDraftStore.js";
import { StandInDocumentMaker, type DocumentMaker } from "../src/documentMaker.js";
import type { Mailer } from "../src/mailer.js";
import { fakeJudge, reportingLlm } from "./reportFakes.js";
import type { JudgeFn } from "../src/judge.js";
import { statedClaimId } from "../src/stretchSuggestions.js";

const ROLE = "IT project manager in Paris";
const FIXTURE_AD_ID = "2026-07-05_endava-vietnam_senior-project-manager";
const VALID_AD_ID = liveIdFor(FIXTURE_AD_ID);
const RISKS = "risk-dependency-control";

type App = ReturnType<typeof buildServer>["app"];
const get = (app: App, cookie: string, url: string) => app.inject({ method: "GET", url, headers: { cookie } });
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

type Claims = ReturnType<typeof buildServer>["claims"];
const floorClaim = (itemId: string, text: string, answer: string): CandidateClaim => ({
  id: `discovery-${itemId}`,
  semantic_key: itemId,
  field_key: null,
  field_value: null,
  field_label: null,
  role: "profile",
  text,
  machine_touch: "verbatim",
  classification: "Verified",
  source_quote: answer,
  needs_grill: false,
  grill_hint: null,
});

/** tailorDraft.test.ts's walk: three facts, one "No" (risks), sign in, retrieval, want. #419: `cvLines`
 *  are lines read from the CV (confirmed), seeded before the search so the job's card is found. */
async function reachTailor({ app, claims }: { app: App; claims: Claims }, cookie: string, email: string, cvLines: CandidateClaim[] = []) {
  await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
  const sid = (await get(app, cookie, "/sessions/me")).json().id as string;
  await claims.add(sid, floorClaim("end-to-end-delivery", "Owned delivery from planning through completion.", "Yes"));
  await claims.add(sid, floorClaim("stakeholder-coordination", "Business, engineering, and vendors.", "Business, engineering, and vendors"));
  await claims.answerNegative(
    sid,
    floorClaim(RISKS, "Not applicable — Have you acted on delivery risks, dependencies, timelines, or budgets?", "No"),
  );
  await claims.add(sid, floorClaim("delivery-communication", "Weekly steering updates.", "Weekly steering updates"));
  await claims.seed(sid, cvLines);
  for (const c of cvLines) await claims.confirm(sid, c.id);
  await signIn(app, cookie, email);
  await warmRetrieval(app, cookie);
  await post(app, cookie, `/onboarding/cards/${VALID_AD_ID}/want`);
  return sid;
}

const BULLET_TEXT = "Ran end-to-end delivery for the programme";
/** A used line as the screen shows it: #438 puts a ◆ before a line an accepted suggestion changed —
 *  a line reworded with Edit wording and then used included. */
const onScreen = (text: string) => new RegExp(`<li><button [^>]*>◆</button>${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</li>`);
const SECOND_BULLET = "Reported weekly to the steering committee";

/** The fake tailor model (tailorDraft.test.ts's): two bullets under one role, one skills group. */
function draftingLlm() {
  const prompts: string[] = [];
  const llm: LlmClient = {
    model: "test-fake",
    async complete(prompt: string): Promise<string> {
      prompts.push(prompt);
      const claimsBlock = prompt.split("Claims:\n")[1] ?? "";
      const ids = [...claimsBlock.matchAll(/^- ([a-z0-9][a-z0-9-]*) \[/gm)].map((m) => m[1]!);
      return JSON.stringify({
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
              { text: BULLET_TEXT, claimIds: [ids[0]!], outcome: "" },
              { text: SECOND_BULLET, claimIds: [ids[ids.length - 1]!], outcome: "" },
            ],
            unprinted: ids.length > 2 ? [ids[1]!] : [],
          },
        ],
        skills: [{ label: "Delivery", items: ["Jira"] }],
        certifications: [],
        education: [],
        additional: [],
      });
    },
  };
  return { prompts, llm };
}

type FakeSuggestion = Record<string, unknown>;
/** The fake suggestion model: reads the requirement states back off the prompt (the product-owned
 *  line shape) and answers with `answer(gaps)`; the default suggests one bullet swap for the first
 *  gap and one skill for the second. Records every prompt so the checkpoint is observable. */
function suggestingLlm(answer?: (gapIds: string[]) => FakeSuggestion[]) {
  const prompts: string[] = [];
  const llm: LlmClient = {
    model: "test-fake",
    async complete(prompt: string): Promise<string> {
      prompts.push(prompt);
      const gaps = [...prompt.matchAll(STRETCH_REQUIREMENT_LINE)].filter((m) => m[2] !== "met").map((m) => m[1]!.trim());
      const suggestions = answer
        ? answer(gaps)
        : [
            {
              requirementId: gaps[0],
              slot: { kind: "bullet", role: 0, bullet: 0 },
              lineIn: `Led the whole programme to completion, covering ${gaps[0]}.`,
              why: `The job asks for ${gaps[0]}. Your CV shows end-to-end delivery.`,
              say: "I owned the programme from planning to go-live.",
              intendedClass: "Partially-Supported",
              comparison: "The line in names what this job tests; the line out is the broader claim.",
              better: true,
            },
            {
              requirementId: gaps[1],
              slot: { kind: "skill", group: 0 },
              lineIn: "Scrum ceremonies",
              why: `The job asks for ${gaps[1]}. Your skills line does not name it.`,
              say: "I ran the stand-ups and reviews when the team had no scrum master.",
              intendedClass: "Unsupported-but-Plausible",
              comparison: "A skill joins the line; nothing leaves the CV.",
              better: true,
            },
          ];
      return JSON.stringify({ suggestions });
    },
  };
  return { prompts, llm };
}

async function awaitJob(app: App, cookie: string, jobId: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const job = (await get(app, cookie, `/jobs/${jobId}`)).json();
    if (job.status === "completed" || job.status === "failed") return job;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("draft job never settled");
}

/** Draft + suggestions, end to end: POST, watch the job, read the view. */
async function draftWithSuggestions(app: App, cookie: string) {
  const started = await post(app, cookie, "/onboarding/tailor/draft");
  expect(started.statusCode).toBe(202);
  const job = await awaitJob(app, cookie, started.json().jobId);
  expect(job.status).toBe("completed");
  const read = await get(app, cookie, "/onboarding/tailor/draft");
  expect(read.statusCode).toBe(200);
  return read.json();
}

describe("#417 stretch suggestions are stored beside the finished draft", () => {
  it("each suggestion carries the requirement, why, the line in, the slot-matched line out (none for a skill) and what to say; the claims store is untouched", async () => {
    const tailor = draftingLlm();
    const stretch = suggestingLlm();
    const { app, claims } = buildServer({ tailorLlm: tailor.llm, stretchLlm: stretch.llm });
    const cookie = await anonSession(app);
    const sid = await reachTailor({ app, claims }, cookie, "stretch-happy@example.com");
    const before = await claims.list(sid);
    const state = (await get(app, cookie, "/onboarding/tailor")).json();
    const gaps = state.requirements.filter((r: { state: string }) => r.state !== "met").map((r: { id: string }) => r.id);
    expect(gaps.length).toBeGreaterThanOrEqual(2);

    const view = await draftWithSuggestions(app, cookie);

    expect(stretch.prompts).toHaveLength(1);
    // The step is handed the finished draft with each line's slot, the requirements with the
    // card's verdicts, the facts and the denied list.
    expect(stretch.prompts[0]).toContain(BULLET_TEXT);
    expect(stretch.prompts[0]).toContain("Owned delivery from planning through completion.");
    expect(stretch.prompts[0]).toContain("Have you acted on delivery risks, dependencies, timelines, or budgets?");

    expect(view.stretch.status).toBe("ran");
    const [swap, skill] = view.stretch.suggestions;
    expect(swap).toMatchObject({
      schemaVersion: "2",
      adId: VALID_AD_ID,
      requirementId: gaps[0],
      why: `The job asks for ${gaps[0]}. Your CV shows end-to-end delivery.`,
      claimText: `Led the whole programme to completion, covering ${gaps[0]}.`,
      interviewNarrative: "I owned the programme from planning to go-live.",
      slot: { kind: "bullet", role: 0, bullet: 0 },
      lineOut: BULLET_TEXT, // read from the draft at the slot — the swap shown is the swap made
      state: "pending",
      decidedAt: null,
      scope: null,
    });
    expect(skill).toMatchObject({ requirementId: gaps[1], slot: { kind: "skill", group: 0 }, lineOut: null, state: "pending" });

    // Never a claim (ADR-0005 clause 2) — and the unanswered suggestion never prints on the draft.
    expect(await claims.list(sid)).toEqual(before);
    expect(view.html).not.toContain(swap.claimText);
    expect(view.html).toContain(BULLET_TEXT);
  });
});

const SECOND_FIXTURE_AD_ID = "2026-07-05_manulife_senior-it-project-manager-delivery-manager";

describe("#417 what the code drops from the model's answer", () => {
  it("a suggestion naming a denied capability is dropped — the same word check the page runs", async () => {
    const tailor = draftingLlm();
    // The session's "No" is about delivery risks, dependencies, timelines, or budgets (reachTailor).
    const stretch = suggestingLlm((gaps) => [
      {
        requirementId: gaps[0],
        slot: { kind: "bullet", role: 0, bullet: 0 },
        lineIn: "Acted on delivery risks, dependencies, timelines and budgets across the programme.",
        why: "The job asks for risk oversight. Your CV shows delivery.",
        say: "I tracked the risks weekly.",
        intendedClass: "Partially-Supported",
        comparison: "The line in names the risks the job tests.",
        better: true,
      },
      {
        requirementId: gaps[1],
        slot: { kind: "bullet", role: 0, bullet: 1 },
        lineIn: "Ran Scrum ceremonies for the delivery team.",
        why: "The job asks for Scrum ceremonies. Your CV shows steering updates.",
        say: "I ran the stand-ups and reviews.",
        intendedClass: "Unsupported-but-Plausible",
        comparison: "The line in names the ceremonies; the line out is a reporting line.",
        better: true,
      },
    ]);
    const { app, claims } = buildServer({ tailorLlm: tailor.llm, stretchLlm: stretch.llm });
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "stretch-denied@example.com");
    const view = await draftWithSuggestions(app, cookie);
    expect(view.stretch.status).toBe("ran");
    // The denied one is gone; the clean one got through (the guard lets the right value pass).
    expect(view.stretch.suggestions.map((s: { claimText: string }) => s.claimText)).toEqual([
      "Ran Scrum ceremonies for the delivery team.",
    ]);
  });

  it("a suggestion for a requirement the CV already meets, or a slot the draft does not print, is dropped", async () => {
    const tailor = draftingLlm();
    let metId = "";
    const stretch = suggestingLlm((gaps) => [
      {
        requirementId: metId,
        slot: { kind: "bullet", role: 0, bullet: 0 },
        lineIn: "Already covered by the CV.",
        why: "The job asks for it. The CV already shows it.",
        say: "I did this.",
        intendedClass: "Partially-Supported",
        comparison: "Nothing to compare.",
        better: true,
      },
      {
        requirementId: gaps[0],
        slot: { kind: "bullet", role: 0, bullet: 7 }, // the draft prints two bullets
        lineIn: "A line for a slot that does not exist.",
        why: "The job asks for it.",
        say: "I did this.",
        intendedClass: "Partially-Supported",
        comparison: "The line in names what the job tests.",
        better: true,
      },
      {
        requirementId: gaps[1],
        slot: { kind: "skill", group: 0 },
        lineIn: "Scrum ceremonies",
        why: "The job asks for Scrum ceremonies.",
        say: "I ran the stand-ups.",
        intendedClass: "Unsupported-but-Plausible",
        comparison: "A skill joins the line.",
        better: true,
      },
    ]);
    // fakeJudge reads the first requirement as met, the rest as gaps.
    const { app, claims } = buildServer({ tailorLlm: tailor.llm, stretchLlm: stretch.llm, judge: fakeJudge() });
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "stretch-met@example.com");
    const state = (await get(app, cookie, "/onboarding/tailor")).json();
    metId = state.requirements.find((r: { state: string }) => r.state === "met").id;
    const view = await draftWithSuggestions(app, cookie);
    expect(view.stretch.suggestions.map((s: { claimText: string }) => s.claimText)).toEqual(["Scrum ceremonies"]);
  });

  it("a suggestion whose explicit comparison says 'not better' yields no suggestion (ADR-0005 clause 4 step 3)", async () => {
    const tailor = draftingLlm();
    const stretch = suggestingLlm((gaps) => [
      {
        requirementId: gaps[0],
        slot: { kind: "bullet", role: 0, bullet: 0 },
        lineIn: "Led the whole programme to completion.",
        why: "The job asks for leading delivery. Your CV shows it in other words.",
        say: "I owned the programme.",
        intendedClass: "Partially-Supported",
        comparison: "The line out already says this, with the programme's scope; the line in adds nothing.",
        better: false,
      },
      {
        requirementId: gaps[1],
        slot: { kind: "skill", group: 0 },
        lineIn: "Scrum ceremonies",
        why: "The job asks for Scrum ceremonies. Your skills line does not name it.",
        say: "I ran the stand-ups and reviews.",
        intendedClass: "Unsupported-but-Plausible",
        comparison: "A skill joins the line; nothing leaves the CV.",
        better: true,
      },
    ]);
    const { app, claims } = buildServer({ tailorLlm: tailor.llm, stretchLlm: stretch.llm });
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "stretch-not-better@example.com");
    const view = await draftWithSuggestions(app, cookie);
    expect(view.stretch.suggestions.map((s: { claimText: string }) => s.claimText)).toEqual(["Scrum ceremonies"]);
  });
});

describe("#417 the checkpoint, and the three states of the step", () => {
  it("reading twice spends the step once; a redraft with a changed input spends it again", async () => {
    const tailor = draftingLlm();
    const stretch = suggestingLlm();
    const { app, claims } = buildServer({ tailorLlm: tailor.llm, stretchLlm: stretch.llm });
    const cookie = await anonSession(app);
    const sid = await reachTailor({ app, claims }, cookie, "stretch-checkpoint@example.com");
    await draftWithSuggestions(app, cookie);
    expect(stretch.prompts).toHaveLength(1);

    const again = await post(app, cookie, "/onboarding/tailor/draft");
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ ready: true });
    expect((await get(app, cookie, "/onboarding/tailor/draft")).json().stretch.status).toBe("ran");
    expect(stretch.prompts).toHaveLength(1);
    expect(tailor.prompts).toHaveLength(1);

    // A new fact changes the draft's input, so the draft and the suggestions are both fresh.
    await claims.add(sid, { ...floorClaim("vendor-tender", "Ran the vendor tender end to end.", "Yes"), id: tailorClaimId(VALID_AD_ID, "vendor-tender") });
    await draftWithSuggestions(app, cookie);
    expect(tailor.prompts).toHaveLength(2);
    expect(stretch.prompts).toHaveLength(2);
  });

  it("'ran, found none' is an empty list; a step that never ran is null — never the same thing", async () => {
    const tailor = draftingLlm();
    const none = suggestingLlm(() => []);
    const ran = buildServer({ tailorLlm: tailor.llm, stretchLlm: none.llm });
    const cookie = await anonSession(ran.app);
    await reachTailor(ran, cookie, "stretch-none@example.com");
    const view = await draftWithSuggestions(ran.app, cookie);
    expect(none.prompts).toHaveLength(1);
    expect(view.stretch).toEqual({ status: "ran", suggestions: [] });

    // No client wired: the draft is written, the step did not run, and the view says so.
    const unwired = buildServer({ tailorLlm: draftingLlm().llm });
    const cookie2 = await anonSession(unwired.app);
    await reachTailor(unwired, cookie2, "stretch-unwired@example.com");
    const view2 = await draftWithSuggestions(unwired.app, cookie2);
    expect(view2.stretch).toBeNull();
  });

  it("a step that fails twice is recorded as failed — the draft shows, and the next read looks again without redrafting", async () => {
    const tailor = draftingLlm();
    let broken = true;
    const prompts: string[] = [];
    const flaky: LlmClient = {
      model: "test-fake",
      async complete(prompt) {
        prompts.push(prompt);
        if (broken) return "not json at all";
        return JSON.stringify({ suggestions: [] });
      },
    };
    const { app, claims } = buildServer({ tailorLlm: tailor.llm, stretchLlm: flaky });
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "stretch-failed@example.com");
    const view = await draftWithSuggestions(app, cookie);
    expect(prompts).toHaveLength(2); // one retry, then failed honestly
    expect(view.stretch).toEqual({ status: "failed" });
    expect(view.html).toContain(BULLET_TEXT); // the draft itself is safe

    broken = false;
    const retry = await post(app, cookie, "/onboarding/tailor/draft");
    expect(retry.statusCode).toBe(202); // not ready: the suggestions are looked for again
    const job = await awaitJob(app, cookie, retry.json().jobId);
    expect(job.status).toBe("completed");
    expect(tailor.prompts).toHaveLength(1); // the draft was not re-spent
    expect(prompts).toHaveLength(3);
    expect((await get(app, cookie, "/onboarding/tailor/draft")).json().stretch).toEqual({ status: "ran", suggestions: [] });
  });
});

describe("#417 'No' closes the suggestion for this job only", () => {
  it("No records a decline scoped to this job; the suggestion stays listed, answered; an unknown id is a 404", async () => {
    const tailor = draftingLlm();
    const stretch = suggestingLlm();
    const { app, claims } = buildServer({ tailorLlm: tailor.llm, stretchLlm: stretch.llm });
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "stretch-no@example.com");
    const view = await draftWithSuggestions(app, cookie);
    const [first, second] = view.stretch.suggestions;

    const res = await post(app, cookie, `/onboarding/tailor/suggestions/${first.id}`, { answer: "no" });
    expect(res.statusCode).toBe(200);
    const answered = res.json().stretch;
    expect(answered.status).toBe("ran");
    expect(answered.suggestions[0]).toMatchObject({ id: first.id, state: "declined", scope: "this-job" });
    expect(answered.suggestions[0].decidedAt).not.toBeNull();
    expect(answered.suggestions[1]).toMatchObject({ id: second.id, state: "pending" });
    // Durable: the next read says the same.
    expect((await get(app, cookie, "/onboarding/tailor/draft")).json().stretch).toEqual(answered);
    expect(stretch.prompts).toHaveLength(1); // answering spends nothing

    const unknown = await post(app, cookie, "/onboarding/tailor/suggestions/no-such-suggestion", { answer: "no" });
    expect(unknown.statusCode).toBe(404);
  });

  it("another job's run may suggest the same line again", async () => {
    const tailor = draftingLlm();
    const stretch = suggestingLlm((gaps) => [
      {
        requirementId: gaps[0],
        slot: { kind: "skill", group: 0 },
        lineIn: "Scrum ceremonies",
        why: `The job asks for ${gaps[0]}.`,
        say: "I ran the stand-ups.",
        intendedClass: "Unsupported-but-Plausible",
        comparison: "A skill joins the line.",
        better: true,
      },
    ]);
    const { app, claims } = buildServer({ tailorLlm: tailor.llm, stretchLlm: stretch.llm });
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "stretch-other-job@example.com");
    const view = await draftWithSuggestions(app, cookie);
    await post(app, cookie, `/onboarding/tailor/suggestions/${view.stretch.suggestions[0].id}`, { answer: "no" });

    await post(app, cookie, `/onboarding/cards/${liveIdFor(SECOND_FIXTURE_AD_ID)}/want`);
    const other = await draftWithSuggestions(app, cookie);
    expect(other.stretch.suggestions).toHaveLength(1);
    expect(other.stretch.suggestions[0]).toMatchObject({ claimText: "Scrum ceremonies", state: "pending", adId: liveIdFor(SECOND_FIXTURE_AD_ID) });
  });
});

describe("#417 approving with suggestions unanswered approves the draft without them", () => {
  it("the document that leaves carries the draft's own lines, never a pending line in", async () => {
    const tailor = draftingLlm();
    const stretch = suggestingLlm();
    const printed: string[] = [];
    const capturingMaker: DocumentMaker = {
      async printCv(html) {
        printed.push(html);
        return new StandInDocumentMaker().printCv(html);
      },
    };
    const sent: string[] = [];
    const mailer: Mailer = {
      live: false,
      async sendLoginLink() {},
      async sendFamilyReady() {},
      async sendTailoredCv(_email, doc) {
        sent.push(doc.text);
      },
    };
    const { app, claims } = buildServer({
      tailorLlm: tailor.llm,
      stretchLlm: stretch.llm,
      judge: fakeJudge(), // the report refuses an unjudged card (reportGate)
      reportLlm: reportingLlm().llm,
      documentMaker: capturingMaker,
      mailer,
      tailorDrafts: new InMemoryTailorDraftStore(),
    });
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "stretch-approve@example.com");
    const view = await draftWithSuggestions(app, cookie);
    expect(view.stretch.suggestions.every((s: { state: string }) => s.state === "pending")).toBe(true);

    const res = await post(app, cookie, "/onboarding/tailor/approve", { draftedAt: view.draftedAt });
    expect(res.statusCode).toBe(202);
    const job = await awaitJob(app, cookie, res.json().jobId);
    expect(job.status, JSON.stringify(job)).toBe("completed");
    expect(printed[0]).toContain(BULLET_TEXT);
    for (const s of view.stretch.suggestions) expect(printed[0]).not.toContain(s.claimText);
    expect(sent).toHaveLength(1);
  });
});

describe("#417 the draft previews the open suggestion in place", () => {
  it("GET ?open=<id> strikes the line out and marks the line in at its slot; the others are margin numerals; without ?open the page is plain", async () => {
    const tailor = draftingLlm();
    const stretch = suggestingLlm();
    const { app, claims } = buildServer({ tailorLlm: tailor.llm, stretchLlm: stretch.llm });
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "stretch-preview@example.com");
    const plain = await draftWithSuggestions(app, cookie);
    const [swap, skill] = plain.stretch.suggestions;
    expect(plain.html).not.toContain("<del");
    expect(plain.html).not.toContain("<ins");
    expect(plain.html).not.toContain('class="pin');

    const open = (await get(app, cookie, `/onboarding/tailor/draft?open=${swap.id}`)).json();
    // The open one, in place: the line out struck, the line in marked, numbered 1.
    expect(open.html).toContain(`<del>${BULLET_TEXT}</del>`);
    expect(open.html).toContain(`<ins>${swap.claimText}</ins>`);
    expect(open.html).toMatch(/<span class="pin open"><span class="sr">Suggestion <\/span><span class="n">1<\/span>/);
    // The other shows as a margin numeral on its slot (the skills group), not as text.
    expect(open.html).toMatch(/<span class="pin"><span class="sr">Suggestion <\/span><span class="n">2<\/span>/);
    expect(open.html).not.toContain(skill.claimText);
    expect(open.html).toContain(SECOND_BULLET); // every other line prints as it is

    // Opening the skill: its line in joins the group, nothing is struck.
    const openSkill = (await get(app, cookie, `/onboarding/tailor/draft?open=${skill.id}`)).json();
    expect(openSkill.html).toContain(`<ins>${skill.claimText}</ins>`);
    expect(openSkill.html).not.toContain("<del");
    expect(openSkill.html).toContain(BULLET_TEXT);
    // An unknown id previews nothing and is not an error.
    expect((await get(app, cookie, "/onboarding/tailor/draft?open=nope")).json().html).not.toContain("<ins");
  });

  it("an answered suggestion leaves no mark — only the pending ones are numbered", async () => {
    const tailor = draftingLlm();
    const stretch = suggestingLlm();
    const { app, claims } = buildServer({ tailorLlm: tailor.llm, stretchLlm: stretch.llm });
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "stretch-preview-answered@example.com");
    const view = await draftWithSuggestions(app, cookie);
    const [swap, skill] = view.stretch.suggestions;
    await post(app, cookie, `/onboarding/tailor/suggestions/${swap.id}`, { answer: "no" });
    const open = (await get(app, cookie, `/onboarding/tailor/draft?open=${skill.id}`)).json();
    expect(open.html).toContain(`<ins>${skill.claimText}</ins>`);
    expect(open.html).not.toContain("<del");
    expect(open.html).not.toMatch(/<span class="pin"><span class="sr">Suggestion <\/span><span class="n">1<\/span>/); // the declined one is gone from the margin
    expect(open.html).toMatch(/<span class="pin open"><span class="sr">Suggestion <\/span><span class="n">2<\/span>/); // numbering stays stable
  });
});

describe("#418 'Use for this job' swaps the line on this CV only (ADR-0020 clause 4; ADR-0005 clauses 1, 4, 6)", () => {
  it("Use puts the line in where the line out was, word for word; a skill joins its group; Undo restores the line out; the claims store never moves", async () => {
    const tailor = draftingLlm();
    const stretch = suggestingLlm();
    const { app, claims } = buildServer({ tailorLlm: tailor.llm, stretchLlm: stretch.llm });
    const cookie = await anonSession(app);
    const sid = await reachTailor({ app, claims }, cookie, "stretch-use@example.com");
    const before = await claims.list(sid);
    const view = await draftWithSuggestions(app, cookie);
    const [swap, skill] = view.stretch.suggestions;

    const used = await post(app, cookie, `/onboarding/tailor/suggestions/${swap.id}`, { answer: "use" });
    expect(used.statusCode).toBe(200);
    expect(used.json().stretch.suggestions[0]).toMatchObject({ id: swap.id, state: "approved", scope: "this-job" });
    expect(used.json().stretch.suggestions[0].decidedAt).not.toBeNull();

    // The swap shown is the swap made: the line in prints at the slot, the line out is gone, every
    // other line is as it was. Nothing was re-drafted and nothing was spent.
    const after = (await get(app, cookie, "/onboarding/tailor/draft")).json();
    expect(after.html).toMatch(onScreen(swap.claimText));
    expect(after.html).not.toContain(BULLET_TEXT);
    expect(after.html).toContain(SECOND_BULLET);
    expect(tailor.prompts).toHaveLength(1);
    expect(stretch.prompts).toHaveLength(1);
    expect(await claims.list(sid)).toEqual(before); // never a claim (ADR-0005 clause 2)
    // The other suggestion still previews in place beside the used line.
    const open = (await get(app, cookie, `/onboarding/tailor/draft?open=${skill.id}`)).json();
    expect(open.html).toMatch(onScreen(swap.claimText));
    expect(open.html).toContain(`<ins>${skill.claimText}</ins>`);

    // A skill joins its group and pushes nothing out.
    await post(app, cookie, `/onboarding/tailor/suggestions/${skill.id}`, { answer: "use" });
    const both = (await get(app, cookie, "/onboarding/tailor/draft")).json();
    expect(both.html).toContain(`Jira, ${skill.claimText}</p>`);
    expect(both.html).toMatch(onScreen(swap.claimText));

    // Undo: the suggestion is pending again and the line out is back.
    const undone = await post(app, cookie, `/onboarding/tailor/suggestions/${swap.id}`, { answer: "undo" });
    expect(undone.statusCode).toBe(200);
    expect(undone.json().stretch.suggestions[0]).toMatchObject({ id: swap.id, state: "pending", decidedAt: null, scope: null });
    const restored = (await get(app, cookie, "/onboarding/tailor/draft")).json();
    expect(restored.html).toContain(BULLET_TEXT);
    expect(restored.html).not.toContain(swap.claimText);
    expect(restored.html).toContain(`Jira, ${skill.claimText}</p>`); // the other answer stands
    expect(await claims.list(sid)).toEqual(before);
  });
});

describe("#418 the requirement counts as met by a stretch on THIS job's card only", () => {
  // A second job SHARING the stretched requirement: the paste-door describe below.
  it("Use raises this job's % and marks the requirement 'stretched'; another job's % stays; its draft never carries the line; Undo restores the number", async () => {
    const tailor = draftingLlm();
    const stretch = suggestingLlm();
    // fakeJudge: the first requirement met, every other 0.4 — a judged card, as on the real stack.
    const { app, claims } = buildServer({ tailorLlm: tailor.llm, stretchLlm: stretch.llm, judge: fakeJudge() });
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "stretch-score@example.com");
    const second = liveIdFor(SECOND_FIXTURE_AD_ID);
    // The other job's number, read before anything is used anywhere.
    await post(app, cookie, `/onboarding/cards/${second}/want`);
    const otherBefore = (await get(app, cookie, "/onboarding/tailor")).json();
    await post(app, cookie, `/onboarding/cards/${VALID_AD_ID}/want`);

    const before = (await get(app, cookie, "/onboarding/tailor")).json();
    const view = await draftWithSuggestions(app, cookie);
    const [swap] = view.stretch.suggestions;
    expect(before.requirements.find((r: { id: string }) => r.id === swap.requirementId).state).toBe("gap");

    await post(app, cookie, `/onboarding/tailor/suggestions/${swap.id}`, { answer: "use" });
    const after = (await get(app, cookie, "/onboarding/tailor")).json();
    expect(after.card.matchPct).toBeGreaterThan(before.card.matchPct);
    expect(after.requirements.find((r: { id: string }) => r.id === swap.requirementId).state).toBe("stretched");
    // The card's own fit row says so too — the label every surface reads (Tailor screen, job page).
    expect(after.card.fit).toContainEqual(expect.objectContaining({ id: swap.requirementId, stretched: true }));
    expect(before.card.fit.map((f: { id: string }) => f.id)).not.toContain(swap.requirementId);
    // Met is met: the breakdown counts it, and the gap list no longer names it.
    expect(after.card.breakdown.essential.met + after.card.breakdown.desirable.met).toBe(
      before.card.breakdown.essential.met + before.card.breakdown.desirable.met + 1,
    );
    expect(after.card.dontYet.map((r: { id: string }) => r.id)).not.toContain(swap.requirementId);
    // The deck list agrees with the Tailor screen: the same %, the row met by a stretch.
    const listCard = (await get(app, cookie, "/onboarding/cards")).json().cards.find((c: { adId: string }) => c.adId === VALID_AD_ID);
    expect(listCard.matchPct).toBe(after.card.matchPct);
    expect(listCard.fit).toContainEqual(expect.objectContaining({ id: swap.requirementId, stretched: true }));

    // The other job: the same number, nothing stretched, and its own draft never carries the line.
    await post(app, cookie, `/onboarding/cards/${second}/want`);
    const otherAfter = (await get(app, cookie, "/onboarding/tailor")).json();
    expect(otherAfter.card.matchPct).toBe(otherBefore.card.matchPct);
    expect(otherAfter.requirements.every((r: { state: string }) => r.state !== "stretched")).toBe(true);
    const otherDraft = await draftWithSuggestions(app, cookie);
    expect(otherDraft.html).not.toContain(swap.claimText);
    expect(otherDraft.html).toContain(BULLET_TEXT);

    // Back on this job: Undo restores the previous number and the requirement reads as before.
    await post(app, cookie, `/onboarding/cards/${VALID_AD_ID}/want`);
    await post(app, cookie, `/onboarding/tailor/suggestions/${swap.id}`, { answer: "undo" });
    const undone = (await get(app, cookie, "/onboarding/tailor")).json();
    expect(undone.card.matchPct).toBe(before.card.matchPct);
    expect(undone.requirements).toEqual(before.requirements);
  });
});

describe("#418 a used stretch counts only while the draft it was used on is the draft that would print", () => {
  it("Use, then a changed fact makes the draft stale: the Tailor screen and the deck list drop met by a stretch and the higher %", async () => {
    const tailor = draftingLlm();
    const stretch = suggestingLlm();
    // The judge reads each job once: the new fact below changes the draft, never the verdicts, so
    // the number it leaves is the number without the stretch.
    const judged = fakeJudge();
    const verdicts = new Map<string, ReturnType<JudgeFn>>();
    const judge: JudgeFn = (adReq, facts) => verdicts.get(adReq.adId) ?? verdicts.set(adReq.adId, judged(adReq, facts)).get(adReq.adId)!;
    const { app, claims } = buildServer({ tailorLlm: tailor.llm, stretchLlm: stretch.llm, judge });
    const cookie = await anonSession(app);
    const sid = await reachTailor({ app, claims }, cookie, "stretch-stale@example.com");
    const before = (await get(app, cookie, "/onboarding/tailor")).json();
    const view = await draftWithSuggestions(app, cookie);
    const [swap] = view.stretch.suggestions;
    await post(app, cookie, `/onboarding/tailor/suggestions/${swap.id}`, { answer: "use" });
    expect((await get(app, cookie, "/onboarding/tailor")).json().card.matchPct).toBeGreaterThan(before.card.matchPct);

    // A new fact the job's requirements do not read: the stored draft is no longer the one that
    // would print (it reads as no draft), and nothing else about the card moves.
    await claims.add(sid, { ...floorClaim("meetups", "Speaks at local meetups.", "Yes"), id: tailorClaimId(VALID_AD_ID, "meetups") });
    expect((await get(app, cookie, "/onboarding/tailor/draft")).statusCode).toBe(404);
    const stale = (await get(app, cookie, "/onboarding/tailor")).json();
    expect(stale.card.matchPct).toBe(before.card.matchPct);
    expect(stale.requirements.find((r: { id: string }) => r.id === swap.requirementId).state).toBe("gap");
    expect(stale.card.fit.some((f: { stretched?: boolean }) => f.stretched)).toBe(false);
    const listCard = (await get(app, cookie, "/onboarding/cards")).json().cards.find((c: { adId: string }) => c.adId === VALID_AD_ID);
    expect(listCard.matchPct).toBe(before.card.matchPct);
    expect(listCard.fit.some((f: { stretched?: boolean }) => f.stretched)).toBe(false);
  });
});

/** broughtJobs.test.ts's shape: every pasted advert the injected reader reads into the SAME two
 *  requirements — the fake judge meets slot 0, so the gap a suggestion answers sits in slot 1
 *  ("vendor-governance"), on every job pasted. A signed-in person with a reviewed CV. */
async function pastedJobs(email: string) {
  const tailor = draftingLlm();
  const stretch = suggestingLlm((gaps) => [
    {
      requirementId: gaps[0],
      slot: { kind: "bullet", role: 0, bullet: 0 },
      lineIn: "Governed three vendor teams against one programme budget.",
      why: "The job asks for vendor governance. Your CV shows the programme.",
      say: "I ran the vendor reviews myself.",
      intendedClass: "Partially-Supported",
      comparison: "The line in names what this job tests.",
      better: true,
    },
  ]);
  const readPastedAdvert = async (text: string) => ({
    title: text.split("\n")[0]!.trim(), titleSource: "stated" as const, company: "Gradion", location: "Hong Kong", closingDate: null,
  });
  const readAd = async (posting: Posting): Promise<AdRequirementsV1> =>
    AdRequirementsV1.parse({
      schemaVersion: "1", adId: posting.id, curated: false, language: "en",
      familyFit: { family: "it-project-delivery", confidence: 0.9 },
      requirements: [
        { id: "stakeholders", band: "essential", kind: "ordinary", requirement: "Coordinate business and technical stakeholders", sourceSpan: "coordinate" },
        { id: "vendor-governance", band: "essential", kind: "ordinary", requirement: "Govern vendor teams against one budget", sourceSpan: "vendor" },
      ],
    });
  const built = buildDeckServer({
    readPastedAdvert, readAd, postings: new InMemoryPostingStore(), pasteRecords: new InMemoryPasteRecordStore(), store: new InMemoryJobStore(),
    placeFamily: async () => IT_PROJECT_DELIVERY_PLACEMENT,
    judge: fakeJudge(), tailorLlm: tailor.llm, stretchLlm: stretch.llm,
  });
  const { app, claims } = built;
  const cookie = await anonSession(app);
  await post(app, cookie, "/onboarding/discovery/start", { role: "IT project manager in Hong Kong" });
  const sid = (await get(app, cookie, "/sessions/me")).json().id as string;
  await claims.add(sid, floorClaim("end-to-end-delivery", "Owned delivery from planning through completion.", "Yes"));
  await claims.add(sid, floorClaim("delivery-communication", "Weekly steering updates.", "Weekly steering updates"));
  await built.sessions.setImportProof(sid, { outcome: "success", usefulFactCount: 1, representativeFacts: [], conflict: null });
  await post(app, cookie, "/review/complete");
  await signIn(app, cookie, email);
  /** Pastes one advert under `title` and returns its job's id once the paste door has read it. */
  const paste = async (title: string): Promise<string> => {
    const started = await post(app, cookie, "/onboarding/paste", { text: `${title}\nGradion — Hong Kong\n\nRun a portfolio of technology programmes across APAC; coordinate business and technical stakeholders; govern vendor teams against one budget.` });
    expect(started.statusCode).toBe(202);
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const job = (await get(app, cookie, `/jobs/${started.json().jobId}`)).json() as JobRecord;
      if (job.status === "completed" || job.status === "failed") return (job.progress as { paste?: PasteProgress }).paste!.result!.adId;
      await new Promise((r) => setImmediate(r));
    }
    throw new Error("paste never settled");
  };
  /** The job's own screen's card. */
  const screen = async (adId: string) => (await get(app, cookie, `/onboarding/jobs/${encodeURIComponent(adId)}`)).json().card;
  return { app, claims, cookie, sid, paste, screen };
}

describe("#418 the job's own screen reads the same answer (a job he brought, through the paste door)", () => {
  it("GET /onboarding/jobs/:adId counts the used stretch as met, flags the fit row, and its % rises", async () => {
    const { app, claims, cookie, sid, paste, screen } = await pastedJobs("stretch-job-screen@example.com");
    const adId = await paste("Senior Project Manager");
    const before = await screen(adId);
    expect(before.scored).toBe("judged");
    expect(before.fit.map((f: { id: string }) => f.id)).toEqual(["stakeholders"]);

    await post(app, cookie, `/onboarding/cards/${encodeURIComponent(adId)}/want`);
    const view = await draftWithSuggestions(app, cookie);
    const [swap] = view.stretch.suggestions;
    expect(swap.requirementId).toBe("vendor-governance");
    await post(app, cookie, `/onboarding/tailor/suggestions/${swap.id}`, { answer: "use" });

    const after = await screen(adId);
    expect(after.fit).toContainEqual(expect.objectContaining({ id: "vendor-governance", stretched: true }));
    expect(after.matchPct).toBeGreaterThan(before.matchPct);
    expect(after.dontYet).toEqual([]);

    // A changed fact makes that draft stale: the job page stops counting the stretch.
    await claims.add(sid, floorClaim("meetups", "Speaks at local meetups.", "Yes"));
    expect((await screen(adId)).fit.some((f: { stretched?: boolean }) => f.stretched)).toBe(false);
  });

  it("a second job sharing the stretched requirement keeps its %: nothing on it reads met by a stretch", async () => {
    const { app, cookie, paste, screen } = await pastedJobs("stretch-shared-requirement@example.com");
    const used = await paste("Senior Project Manager");
    const other = await paste("Programme Delivery Lead");
    const otherBefore = await screen(other);
    // The two jobs ask for the same thing, and neither CV meets it yet.
    expect(otherBefore.dontYet.map((r: { id: string }) => r.id)).toEqual(["vendor-governance"]);
    expect((await screen(used)).dontYet.map((r: { id: string }) => r.id)).toEqual(["vendor-governance"]);

    await post(app, cookie, `/onboarding/cards/${encodeURIComponent(used)}/want`);
    const [swap] = (await draftWithSuggestions(app, cookie)).stretch.suggestions;
    expect(swap.requirementId).toBe("vendor-governance");
    await post(app, cookie, `/onboarding/tailor/suggestions/${swap.id}`, { answer: "use" });
    expect((await screen(used)).fit).toContainEqual(expect.objectContaining({ id: "vendor-governance", stretched: true }));

    // The other job's own screen and its Tailor screen: the same %, the requirement still a gap.
    const otherAfter = await screen(other);
    expect(otherAfter.matchPct).toBe(otherBefore.matchPct);
    expect(otherAfter.fit.some((f: { stretched?: boolean }) => f.stretched)).toBe(false);
    expect(otherAfter.dontYet.map((r: { id: string }) => r.id)).toEqual(["vendor-governance"]);
    await post(app, cookie, `/onboarding/cards/${encodeURIComponent(other)}/want`);
    const otherTailor = (await get(app, cookie, "/onboarding/tailor")).json();
    expect(otherTailor.card.matchPct).toBe(otherBefore.matchPct);
    expect(otherTailor.requirements.find((r: { id: string }) => r.id === "vendor-governance").state).toBe("gap");
  });
});

describe("#418 the export prints the used line and the report carries its interview line", () => {
  it("the exported bullet is the stored line in, word for word; section 4 of the email holds the line and what to say, verbatim", async () => {
    const tailor = draftingLlm();
    const stretch = suggestingLlm();
    const printed: string[] = [];
    const capturingMaker: DocumentMaker = {
      async printCv(html) {
        printed.push(html);
        return new StandInDocumentMaker().printCv(html);
      },
    };
    const sent: string[] = [];
    const mailer: Mailer = {
      live: false,
      async sendLoginLink() {},
      async sendFamilyReady() {},
      async sendTailoredCv(_email, doc) {
        sent.push(doc.text);
      },
    };
    const report = reportingLlm();
    const { app, claims } = buildServer({
      tailorLlm: tailor.llm,
      stretchLlm: stretch.llm,
      judge: fakeJudge(),
      reportLlm: report.llm,
      documentMaker: capturingMaker,
      mailer,
      tailorDrafts: new InMemoryTailorDraftStore(),
    });
    const cookie = await anonSession(app);
    const sid = await reachTailor({ app, claims }, cookie, "stretch-export@example.com");
    const before = await claims.list(sid);
    const view = await draftWithSuggestions(app, cookie);
    const [swap, skill] = view.stretch.suggestions;
    await post(app, cookie, `/onboarding/tailor/suggestions/${swap.id}`, { answer: "use" });

    const res = await post(app, cookie, "/onboarding/tailor/approve", { draftedAt: view.draftedAt });
    expect(res.statusCode).toBe(202);
    const job = await awaitJob(app, cookie, res.json().jobId);
    expect(job.status, JSON.stringify(job)).toBe("completed");
    // The document that left: the line in at the slot, the line out gone, the unanswered one absent.
    expect(printed[0]).toContain(`<li>${swap.claimText}</li>`);
    expect(printed[0]).not.toContain(BULLET_TEXT);
    expect(printed[0]).toContain(SECOND_BULLET);
    expect(printed[0]).not.toContain(skill.claimText);
    // The report: the model was told the state and wrote nothing for it; section 4 carries the
    // used line and the interview line exactly as stored.
    expect(report.prompts[0]).toContain(`- id: ${swap.requirementId}\n  state: stretched`);
    expect(sent).toHaveLength(1);
    const section4 = sent[0]!.split("4. Be ready to explain")[1]!.split("5. Salary")[0]!;
    expect(section4).toContain(swap.claimText);
    expect(section4).toContain(swap.interviewNarrative);
    expect(sent[0]!.split("2. Where you are strong")[1]!.split("3. Where you are not")[0]).not.toContain(swap.requirementId);
    expect(await claims.list(sid)).toEqual(before); // the used line never became a claim
  });
});

// ---------------------------------------------------------------------------------------------
// #419 (ADR-0020 clause 4, second row; ADR-0005 clause 5 as amended; ADR-0008; ADR-0018 clause 9):
// "It's true: keep it on my CV for every job" — the person states the line as their own fact.
// ---------------------------------------------------------------------------------------------

/** A job's own line, read from the CV: its role is the employer and title as written — the job the
 *  profile heads a block with. Seeded last, so the fake draft cites it from the role's second bullet. */
const JOB_ROLE = "Endava Vietnam — IT Project Manager";
const JOB_LINE: CandidateClaim = {
  ...floorClaim("vendor-teams", "Coordinated three vendor teams on the payments release.", "Coordinated three vendor teams"),
  id: "coordinated-three-vendor-teams",
  semantic_key: "coordinated-three-vendor-teams",
  role: JOB_ROLE,
};
const reachTailorWithJob = (server: { app: App; claims: Claims }, cookie: string, email: string) =>
  reachTailor(server, cookie, email, [JOB_LINE]);
/** sample-postings.json's own title and company for FIXTURE_AD_ID. */
const ADDED_FOR = "Senior Project Manager at Endava Vietnam";

describe("#419 It's true keeps the line on the master CV, under the job it was suggested for", () => {
  it("no claim is written before the tap; the tap adds a confirmed line under that job's employer, tagged with the job; the line out stays", async () => {
    const tailor = draftingLlm();
    const stretch = suggestingLlm();
    const { app, claims } = buildServer({ tailorLlm: tailor.llm, stretchLlm: stretch.llm });
    const cookie = await anonSession(app);
    const sid = await reachTailorWithJob({ app, claims }, cookie, "stretch-true@example.com");
    const before = await claims.list(sid);
    const view = await draftWithSuggestions(app, cookie);
    const [swap] = view.stretch.suggestions;
    // The suggestion step ran and nothing joined the master CV: a suggestion is never a claim.
    expect(view.stretch.status).toBe("ran");
    expect(await claims.list(sid)).toEqual(before);

    const res = await post(app, cookie, `/onboarding/tailor/suggestions/${swap.id}`, { answer: "true" });
    expect(res.statusCode).toBe(200);
    expect(res.json().stretch.suggestions[0]).toMatchObject({ id: swap.id, state: "approved", scope: "every-job" });
    expect(res.json().keptUnder).toBe(JOB_ROLE);

    // The master CV: the line under the job it was suggested for, the person its origin, tagged.
    const profile = (await get(app, cookie, "/profile")).json();
    const experience = profile.domains.find((d: { tag: string }) => d.tag === "experience");
    expect(experience.facts).toContainEqual(
      expect.objectContaining({ text: swap.claimText, job: JOB_ROLE, source: "told", addedFor: ADDED_FOR }),
    );
    // The line it pushed out on this CV is written from a fact that is still on the master CV.
    const facts = profile.domains.flatMap((d: { facts: { text: string }[] }) => d.facts.map((f) => f.text));
    expect(facts).toContain("Owned delivery from planning through completion.");
    expect((await claims.list(sid)).filter((c) => !before.some((b) => b.id === c.id))).toHaveLength(1);
    for (const c of before) expect(await claims.list(sid)).toContainEqual(c);
  });

  it("this CV prints the line once, where the line out was, with nothing re-drafted or re-suggested; the requirement reads met, not met by a stretch; a second job's draft can print it", async () => {
    const tailor = printingStatedLines(draftingLlm());
    const stretch = suggestingLlm();
    // fakeJudge: the first requirement met, every other 0.4 — a judged card, as on the real stack.
    const { app, claims } = buildServer({ tailorLlm: tailor.llm, stretchLlm: stretch.llm, judge: fakeJudge() });
    const cookie = await anonSession(app);
    await reachTailorWithJob({ app, claims }, cookie, "stretch-true-cv@example.com");
    const before = (await get(app, cookie, "/onboarding/tailor")).json();
    const view = await draftWithSuggestions(app, cookie);
    const [swap] = view.stretch.suggestions;
    expect(before.requirements.find((r: { id: string }) => r.id === swap.requirementId).state).toBe("gap");

    await post(app, cookie, `/onboarding/tailor/suggestions/${swap.id}`, { answer: "true" });
    // The facts changed, yet this draft stands: nothing is re-drafted and nothing re-suggested.
    const again = await post(app, cookie, "/onboarding/tailor/draft");
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ ready: true });
    const after = (await get(app, cookie, "/onboarding/tailor/draft")).json();
    expect(after.html.split(swap.claimText)).toHaveLength(2); // printed once, at the slot
    expect(after.html).toMatch(onScreen(swap.claimText));
    expect(after.html).not.toContain(BULLET_TEXT);
    expect(after.stretch.suggestions[0]).toMatchObject({ id: swap.id, state: "approved", scope: "every-job" });
    expect(tailor.prompts).toHaveLength(1);
    expect(stretch.prompts).toHaveLength(1);

    // The requirement reads plainly met on this job's card, and the number rose.
    const state = (await get(app, cookie, "/onboarding/tailor")).json();
    expect(state.requirements.find((r: { id: string }) => r.id === swap.requirementId).state).toBe("met");
    expect(state.card.fit).toContainEqual(expect.objectContaining({ id: swap.requirementId }));
    expect(state.card.fit.find((f: { id: string }) => f.id === swap.requirementId).stretched).toBeUndefined();
    expect(state.card.matchPct).toBeGreaterThan(before.card.matchPct);

    // A second job's draft is written from the facts, the new line among them, and may print it.
    await post(app, cookie, `/onboarding/cards/${liveIdFor(SECOND_FIXTURE_AD_ID)}/want`);
    const other = await draftWithSuggestions(app, cookie);
    expect(tailor.prompts).toHaveLength(2);
    expect(tailor.prompts[1]).toContain(`] ${swap.claimText}`);
    expect(other.html).toContain(`<li>${swap.claimText}</li>`);
  });

  it("a draft that stands only without its own It's-true line, whose suggestions must be made again, is written again from every fact — never left matching no fact set", async () => {
    const tailor = printingStatedLines(draftingLlm());
    const stretch = suggestingLlm();
    // The judge goes quiet after the answer: the card reads "estimated", so the suggestions' input
    // changes while the facts the draft was written from do not.
    const judged = fakeJudge();
    let judgeDown = false;
    const judge: JudgeFn = async (adReq, facts) => (judgeDown ? null : judged(adReq, facts));
    const { app, claims } = buildServer({ tailorLlm: tailor.llm, stretchLlm: stretch.llm, judge });
    const cookie = await anonSession(app);
    await reachTailorWithJob({ app, claims }, cookie, "stretch-true-stale@example.com");
    const view = await draftWithSuggestions(app, cookie);
    const [swap] = view.stretch.suggestions;
    await post(app, cookie, `/onboarding/tailor/suggestions/${swap.id}`, { answer: "true" });

    judgeDown = true;
    const redraft = await draftWithSuggestions(app, cookie);
    expect(tailor.prompts).toHaveLength(2);
    expect(tailor.prompts[1]).toContain(`] ${swap.claimText}`); // written from every fact
    expect(redraft.html.split(swap.claimText)).toHaveLength(2); // the fact prints once
    expect((await post(app, cookie, "/onboarding/tailor/draft")).json()).toEqual({ ready: true });
    // The answer went with the old draft; the line stays on the master CV, and the profile's own
    // removal is the way to take it off.
    expect(redraft.stretch.suggestions.every((s: { state: string }) => s.state === "pending")).toBe(true);
    const sid = (await get(app, cookie, "/sessions/me")).json().id as string;
    expect((await claims.confirmed(sid)).map((c) => c.id)).toContain(statedClaimId(swap.id));
    expect((await app.inject({ method: "PUT", url: `/cv/lines/${statedClaimId(swap.id)}`, headers: { cookie }, payload: { state: "kept" } })).statusCode).toBe(200);
    expect((await claims.confirmed(sid)).map((c) => c.id)).not.toContain(statedClaimId(swap.id));
  });

  it("Undo takes the line off the master CV and puts this CV's line out and score back, with nothing re-drafted", async () => {
    const tailor = draftingLlm();
    const stretch = suggestingLlm();
    const { app, claims } = buildServer({ tailorLlm: tailor.llm, stretchLlm: stretch.llm, judge: fakeJudge() });
    const cookie = await anonSession(app);
    const sid = await reachTailorWithJob({ app, claims }, cookie, "stretch-true-undo@example.com");
    const view = await draftWithSuggestions(app, cookie);
    const before = (await get(app, cookie, "/onboarding/tailor")).json();
    const confirmedBefore = await claims.confirmed(sid);
    const [swap] = view.stretch.suggestions;
    await post(app, cookie, `/onboarding/tailor/suggestions/${swap.id}`, { answer: "true" });
    expect((await get(app, cookie, "/onboarding/tailor")).json().card.matchPct).toBeGreaterThan(before.card.matchPct);

    const undone = await post(app, cookie, `/onboarding/tailor/suggestions/${swap.id}`, { answer: "undo" });
    expect(undone.statusCode).toBe(200);
    expect(undone.json().stretch.suggestions[0]).toMatchObject({ id: swap.id, state: "pending", scope: null });
    // Off the master CV: the profile no longer lists it, and no draft reads it.
    const profile = (await get(app, cookie, "/profile")).json();
    const texts = profile.domains.flatMap((d: { facts: { text: string }[] }) => d.facts.map((f) => f.text));
    expect(texts).not.toContain(swap.claimText);
    expect(await claims.confirmed(sid)).toEqual(confirmedBefore);
    // This CV: the line out is back, the number and the requirements are as before, nothing re-spent.
    expect((await post(app, cookie, "/onboarding/tailor/draft")).json()).toEqual({ ready: true });
    const restored = (await get(app, cookie, "/onboarding/tailor/draft")).json();
    expect(restored.html).toContain(BULLET_TEXT);
    expect(restored.html).not.toContain(swap.claimText);
    const after = (await get(app, cookie, "/onboarding/tailor")).json();
    expect(after.card.matchPct).toBe(before.card.matchPct);
    expect(after.requirements).toEqual(before.requirements);
    expect(tailor.prompts).toHaveLength(1);
    expect(stretch.prompts).toHaveLength(1);

    // Said again, the line comes back — the same line, not a second one.
    await post(app, cookie, `/onboarding/tailor/suggestions/${swap.id}`, { answer: "true" });
    expect((await claims.confirmed(sid)).filter((c) => c.text === swap.claimText)).toHaveLength(1);
  });

  it("a skill said to be true joins the suggestion's skills group on the master CV, tagged with the job", async () => {
    const tailor = draftingLlm();
    const stretch = suggestingLlm();
    const { app, claims } = buildServer({ tailorLlm: tailor.llm, stretchLlm: stretch.llm });
    const cookie = await anonSession(app);
    await reachTailorWithJob({ app, claims }, cookie, "stretch-true-skill@example.com");
    const view = await draftWithSuggestions(app, cookie);
    const skill = view.stretch.suggestions[1];
    expect(skill.slot.kind).toBe("skill");

    const res = await post(app, cookie, `/onboarding/tailor/suggestions/${skill.id}`, { answer: "true" });
    expect(res.json().keptUnder).toBe("Skills");
    const profile = (await get(app, cookie, "/profile")).json();
    const skills = profile.domains.find((d: { tag: string }) => d.tag === "skill");
    // "Delivery" is the fake draft's own skills group (draftingLlm).
    expect(skills.facts).toContainEqual(expect.objectContaining({ text: skill.claimText, group: "Delivery", addedFor: ADDED_FOR }));
    const after = (await get(app, cookie, "/onboarding/tailor/draft")).json();
    expect(after.html).toContain(`Jira, ${skill.claimText}</p>`);
  });

  it("the document that leaves prints the line; the report reads the requirement met and asks nothing to be ready to explain about it", async () => {
    const tailor = draftingLlm();
    const stretch = suggestingLlm();
    const printed: string[] = [];
    const capturingMaker: DocumentMaker = {
      async printCv(html) {
        printed.push(html);
        return new StandInDocumentMaker().printCv(html);
      },
    };
    const sent: string[] = [];
    const mailer: Mailer = {
      live: false,
      async sendLoginLink() {},
      async sendFamilyReady() {},
      async sendTailoredCv(_email, doc) {
        sent.push(doc.text);
      },
    };
    const report = reportingLlm();
    const { app, claims } = buildServer({
      tailorLlm: tailor.llm,
      stretchLlm: stretch.llm,
      judge: fakeJudge(),
      reportLlm: report.llm,
      documentMaker: capturingMaker,
      mailer,
    });
    const cookie = await anonSession(app);
    await reachTailorWithJob({ app, claims }, cookie, "stretch-true-export@example.com");
    const view = await draftWithSuggestions(app, cookie);
    const [swap] = view.stretch.suggestions;
    await post(app, cookie, `/onboarding/tailor/suggestions/${swap.id}`, { answer: "true" });

    const res = await post(app, cookie, "/onboarding/tailor/approve", { draftedAt: view.draftedAt });
    expect(res.statusCode).toBe(202);
    const job = await awaitJob(app, cookie, res.json().jobId);
    expect(job.status, JSON.stringify(job)).toBe("completed");
    expect(printed[0]).toContain(`<li>${swap.claimText}</li>`);
    expect(printed[0]).not.toContain(BULLET_TEXT);
    expect(report.prompts[0]).toContain(`- id: ${swap.requirementId}\n  state: met`);
    // ADR-0020 clause 4: on this CV the line prints as an ordinary fact — cited by its new claim, so
    // the report reads it from that fact, never as a line chosen for this job, and the lint knows it.
    // The input's own block (the prompt above it names the block too).
    const printedLines = report.prompts[0]!.split("===PRINTED LINES===\n").at(-1)!.split("\n\n===HELD BACK===")[0]!;
    expect(printedLines).toContain(`- ${swap.claimText}\n  from: ${swap.claimText}`);
    expect(printedLines).not.toContain("a line the person chose to add for this job");
    expect(report.prompts[0]!.split("===LINT FINDINGS===")[1]).not.toContain(statedClaimId(swap.id));
    const section4 = sent[0]!.split("4. Be ready to explain")[1]!.split("5. Salary")[0]!;
    expect(section4).not.toContain(swap.interviewNarrative);
    expect(section4).not.toContain(swap.claimText);
  });
});

// #438: a line an accepted suggestion changed keeps a small deep-gold ◆ in the margin on the
// screen, named by its kind of change; it never reaches the document that leaves.
describe("#438 a line changed by an accepted suggestion keeps a ◆ on screen, never in the PDF", () => {
  it("Use and It's true each leave a ◆ on their line, with or without a card open; an unchanged line has none; the printed HTML has no marker", async () => {
    const tailor = draftingLlm();
    const stretch = suggestingLlm();
    const printed: string[] = [];
    const capturingMaker: DocumentMaker = {
      async printCv(html) {
        printed.push(html);
        return new StandInDocumentMaker().printCv(html);
      },
    };
    const mailer: Mailer = { live: false, async sendLoginLink() {}, async sendFamilyReady() {}, async sendTailoredCv() {} };
    const { app, claims } = buildServer({
      tailorLlm: tailor.llm,
      stretchLlm: stretch.llm,
      judge: fakeJudge(),
      reportLlm: reportingLlm().llm,
      documentMaker: capturingMaker,
      mailer,
    });
    const cookie = await anonSession(app);
    await reachTailorWithJob({ app, claims }, cookie, "stretch-diamond@example.com");
    const view = await draftWithSuggestions(app, cookie);
    const [swap, skill] = view.stretch.suggestions;
    await post(app, cookie, `/onboarding/tailor/suggestions/${swap.id}`, { answer: "use" });
    await post(app, cookie, `/onboarding/tailor/suggestions/${skill.id}`, { answer: "true" });

    const used = `<button type="button" class="pin used" data-stretch="${swap.id}" aria-label="Stretch: this job only, suggestion 1" title="Stretch: this job only">◆</button>`;
    const added = `<button type="button" class="pin used" data-stretch="${skill.id}" aria-label="Added to your CV, suggestion 2" title="Added to your CV">◆</button>`;
    for (const url of ["/onboarding/tailor/draft", `/onboarding/tailor/draft?open=${swap.id}`]) {
      const html = (await get(app, cookie, url)).json().html as string;
      expect(html, url).toContain(`<li>${used}${swap.claimText}</li>`);
      expect(html, url).toContain(`<p class="skill-group">${added}<strong>Delivery</strong>`);
      expect(html.match(/◆/g), url).toHaveLength(2); // the line nobody changed carries none
      expect(html, url).toContain(`<li>${SECOND_BULLET}</li>`);
    }

    const res = await post(app, cookie, "/onboarding/tailor/approve", { draftedAt: view.draftedAt });
    expect((await awaitJob(app, cookie, res.json().jobId)).status).toBe("completed");
    expect(printed[0]).toContain(`<li>${swap.claimText}</li>`);
    expect(printed[0]).toContain(skill.claimText);
    expect(printed[0]).not.toContain("◆");
    expect(printed[0]).not.toMatch(/class="pin|data-stretch|<button/);
  });
});

/** #419: the fake tailor model, also printing every line an "It's true" answer added (a tailor-
 *  claim) as a bullet citing it — the way a real draft may use any fact. */
function printingStatedLines({ prompts, llm }: ReturnType<typeof draftingLlm>) {
  return {
    prompts,
    llm: {
      model: llm.model,
      async complete(prompt: string): Promise<string> {
        const doc = JSON.parse(await llm.complete(prompt));
        const claimsBlock = prompt.split("Claims:\n")[1] ?? "";
        for (const [, id, text] of claimsBlock.matchAll(/^- (tailor-[a-z0-9-]+) \[[^\]]*\] (.+)$/gm))
          doc.experience[0].bullets.push({ text, claimIds: [id], outcome: "" });
        return JSON.stringify(doc);
      },
    } satisfies LlmClient,
  };
}

// ---------------------------------------------------------------------------------------------
// #420 (ADR-0020 clause 3; ADR-0005 clause 6) — editing a suggestion's wording. The edited line is
// stored ON the suggestion together with an interview line rewritten for it (the step's re-say
// mode, the same client), so the line printed is the line defended.
// ---------------------------------------------------------------------------------------------

/** The re-say mode on the SAME client as the suggestions: routed on the re-say prompt's own
 *  heading, the interview line derived from the edited line it is handed (read off the
 *  product-owned block shape, the last occurrence). */
function withResay(base: LlmClient, answer?: (line: string) => string) {
  const resays: string[] = [];
  const llm: LlmClient = {
    model: "test-fake",
    async complete(prompt: string): Promise<string> {
      if (!prompt.includes(RESAY_PROMPT_HEADING)) return base.complete(prompt);
      resays.push(prompt);
      const line = [...prompt.matchAll(RESAY_LINE)].pop()![1]!;
      return answer ? answer(line) : JSON.stringify({ say: `I can stand behind it: ${line}` });
    },
  };
  return { resays, llm };
}

const EDITED = "Ran the vendor tenders for the programme, from shortlist to signature";

describe("#420 Edit, then Use: the line printed is the line defended", () => {
  it("the draft prints the edited text word for word; the stored interview line is the one rewritten for it; the original line is stored nowhere", async () => {
    const tailor = draftingLlm();
    const stretch = withResay(suggestingLlm().llm);
    const tailorDrafts = new InMemoryTailorDraftStore();
    const { app, claims } = buildServer({ tailorLlm: tailor.llm, stretchLlm: stretch.llm, tailorDrafts });
    const cookie = await anonSession(app);
    const sid = await reachTailor({ app, claims }, cookie, "stretch-edit-use@example.com");
    const before = await claims.list(sid);
    const view = await draftWithSuggestions(app, cookie);
    const [swap] = view.stretch.suggestions;

    const edited = await post(app, cookie, `/onboarding/tailor/suggestions/${swap.id}/wording`, { text: EDITED });
    expect(edited.statusCode).toBe(200);
    // One re-say call, handed the edited line and the person's facts — never the old interview line.
    expect(stretch.resays).toHaveLength(1);
    expect(stretch.resays[0]).toContain(EDITED);
    expect(stretch.resays[0]).toContain("Owned delivery from planning through completion.");
    expect(stretch.resays[0]).not.toContain(swap.interviewNarrative);
    expect(edited.json().stretch.suggestions[0]).toMatchObject({
      id: swap.id,
      claimText: EDITED,
      interviewNarrative: `I can stand behind it: ${EDITED}`,
      state: "pending",
    });

    const used = await post(app, cookie, `/onboarding/tailor/suggestions/${swap.id}`, { answer: "use" });
    expect(used.statusCode).toBe(200);
    const after = (await get(app, cookie, "/onboarding/tailor/draft")).json();
    expect(after.html).toMatch(onScreen(EDITED));
    expect(after.html).not.toContain(swap.claimText);
    expect(after.html).not.toContain(BULLET_TEXT);
    // What is stored: the edited sentence with the line rewritten for it, and nothing of the original pair.
    const stored = JSON.stringify(await tailorDrafts.get(sid, swap.adId));
    expect(stored).toContain(EDITED);
    expect(stored).toContain(`I can stand behind it: ${EDITED}`);
    expect(stored).not.toContain(swap.interviewNarrative);
    expect(stored).not.toContain(swap.claimText);
    expect(await claims.list(sid)).toEqual(before); // a used stretch never becomes a claim
  });
});

describe("#420 the rewrite is checkpointed, and an edit outlives an Undo", () => {
  it("the same wording again spends nothing; Use then Undo keeps the edited line and its interview line; the preview shows the edited line in place", async () => {
    const tailor = draftingLlm();
    const stretch = withResay(suggestingLlm().llm);
    const { app, claims } = buildServer({ tailorLlm: tailor.llm, stretchLlm: stretch.llm });
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "stretch-edit-undo@example.com");
    const view = await draftWithSuggestions(app, cookie);
    const [swap] = view.stretch.suggestions;

    await post(app, cookie, `/onboarding/tailor/suggestions/${swap.id}/wording`, { text: EDITED });
    expect(stretch.resays).toHaveLength(1);
    // The same line again — spacing aside — is the stored pair's own input: nothing is spent.
    const again = await post(app, cookie, `/onboarding/tailor/suggestions/${swap.id}/wording`, { text: `  ${EDITED.replace(/ /g, "  ")}\n` });
    expect(again.statusCode).toBe(200);
    expect(again.json().stretch.suggestions[0]).toMatchObject({ claimText: EDITED, interviewNarrative: `I can stand behind it: ${EDITED}` });
    expect(stretch.resays).toHaveLength(1);

    // The open preview strikes the line out and marks the EDITED line in.
    const open = (await get(app, cookie, `/onboarding/tailor/draft?open=${swap.id}`)).json();
    expect(open.html).toContain(`<del>${BULLET_TEXT}</del> <ins>${EDITED}</ins>`);

    await post(app, cookie, `/onboarding/tailor/suggestions/${swap.id}`, { answer: "use" });
    const undone = await post(app, cookie, `/onboarding/tailor/suggestions/${swap.id}`, { answer: "undo" });
    expect(undone.json().stretch.suggestions[0]).toMatchObject({
      state: "pending",
      claimText: EDITED,
      interviewNarrative: `I can stand behind it: ${EDITED}`,
    });
    const plain = (await get(app, cookie, "/onboarding/tailor/draft")).json();
    expect(plain.html).toContain(BULLET_TEXT); // the line out is back on the page
    expect(plain.html).not.toContain(EDITED);
    expect(stretch.resays).toHaveLength(1);
  });
});

describe("#420 what an edit cannot do", () => {
  it("an empty line is refused and changes nothing; an answered suggestion takes no edit; a rewrite that fails twice stores nothing", async () => {
    const tailor = draftingLlm();
    let broken = false;
    const stretch = withResay(suggestingLlm().llm, (line) => (broken ? "not json" : JSON.stringify({ say: `Rewritten for: ${line}` })));
    const { app, claims } = buildServer({ tailorLlm: tailor.llm, stretchLlm: stretch.llm });
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "stretch-edit-refused@example.com");
    const view = await draftWithSuggestions(app, cookie);
    const [swap, skill] = view.stretch.suggestions;
    const read = async () => (await get(app, cookie, "/onboarding/tailor/draft")).json().stretch;

    const empty = await post(app, cookie, `/onboarding/tailor/suggestions/${swap.id}/wording`, { text: "  \n " });
    expect(empty.statusCode).toBe(400);
    expect(stretch.resays).toHaveLength(0);
    expect((await read()).suggestions[0]).toMatchObject({ claimText: swap.claimText, interviewNarrative: swap.interviewNarrative });

    // Answered: the edit waits for Undo — nothing is spent, nothing moves.
    await post(app, cookie, `/onboarding/tailor/suggestions/${skill.id}`, { answer: "no" });
    const answered = await post(app, cookie, `/onboarding/tailor/suggestions/${skill.id}/wording`, { text: "Vendor governance" });
    expect(answered.statusCode).toBe(404);
    expect((await read()).suggestions[1]).toMatchObject({ claimText: skill.claimText, state: "declined" });
    // A line the edit does go through for, to show the refusals above are the guard's doing.
    const ok = await post(app, cookie, `/onboarding/tailor/suggestions/${swap.id}/wording`, { text: EDITED });
    expect(ok.statusCode).toBe(200);
    expect(stretch.resays).toHaveLength(1);

    // Two bad answers: the edit is not stored — the suggestion keeps the pair it had, never the new
    // line beside the old interview line.
    broken = true;
    const failed = await post(app, cookie, `/onboarding/tailor/suggestions/${swap.id}/wording`, { text: "Ran three vendor tenders" });
    expect(failed.statusCode).toBe(502);
    expect(stretch.resays).toHaveLength(3); // one retry
    expect((await read()).suggestions[0]).toMatchObject({ claimText: EDITED, interviewNarrative: `Rewritten for: ${EDITED}` });
  });
});

describe("#412 the suggestion routes declare a response for every status they send (CODING_STANDARDS)", () => {
  it("the answer route and the wording route each name every status in their response schema", async () => {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const declared = new Map<string, string[]>();
    app.addHook("onRoute", (route) => {
      if (route.url.includes("/suggestions/")) declared.set(route.url, Object.keys(route.schema?.response ?? {}).sort());
    });
    // Registering reads no dependency; only a request would.
    await app.register(tailorRoutes({} as TailorRouteDeps));
    await app.ready();
    expect(declared.get("/onboarding/tailor/suggestions/:id")).toEqual(["200", "400", "404", "409"]);
    expect(declared.get("/onboarding/tailor/suggestions/:id/wording")).toEqual(["200", "400", "404", "409", "429", "502"]);
    await app.close();
  });
});

describe("#418 approving freezes the used lines (ADR-0005 clause 6)", () => {
  it("after Approve, an answer, an Undo and an edit are each refused in plain words; nothing is spent and nothing moves", async () => {
    const tailor = draftingLlm();
    const stretch = withResay(suggestingLlm().llm);
    const report = reportingLlm();
    const { app, claims } = buildServer({
      tailorLlm: tailor.llm, stretchLlm: stretch.llm, judge: fakeJudge(), reportLlm: report.llm, documentMaker: new StandInDocumentMaker(),
    });
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "stretch-frozen@example.com");
    const view = await draftWithSuggestions(app, cookie);
    const [swap, skill] = view.stretch.suggestions;
    await post(app, cookie, `/onboarding/tailor/suggestions/${swap.id}`, { answer: "use" });
    const pressed = await post(app, cookie, "/onboarding/tailor/approve", { draftedAt: view.draftedAt });
    expect(pressed.statusCode).toBe(202);
    expect((await awaitJob(app, cookie, pressed.json().jobId)).status).toBe("completed");
    const approved = (await get(app, cookie, "/onboarding/tailor/draft")).json();

    for (const [path, payload] of [
      [`/onboarding/tailor/suggestions/${swap.id}`, { answer: "undo" }],
      [`/onboarding/tailor/suggestions/${skill.id}`, { answer: "use" }],
      [`/onboarding/tailor/suggestions/${skill.id}/wording`, { text: EDITED }],
    ] as const) {
      const refused = await post(app, cookie, path, payload);
      expect(refused.statusCode, path).toBe(409);
      expect(refused.json().error).toEqual({ code: "draft_approved", message: "This CV is approved, so its lines can no longer change." });
    }
    expect(stretch.resays).toHaveLength(0);
    expect((await get(app, cookie, "/onboarding/tailor/draft")).json()).toEqual(approved);
  });
});

describe("#417 a redone suggestion step keeps the answers to the suggestions that come back", () => {
  it("the draft stands and the step's input changes: a suggestion back with the same id and line out keeps its answer, scope and edited wording; one back elsewhere starts again; one not back is dropped", async () => {
    const tailor = draftingLlm();
    // Run 1 suggests four lines; run 2 brings A and B back at the same slots (new wording from the
    // model), C at a different slot, and E not at all. The ids are the product's (job, requirement).
    let run = 0;
    let first: string[] = [];
    const line = (id: string, slot: Record<string, unknown>) => ({
      requirementId: id,
      slot,
      lineIn: `Run ${run}: led the work on ${id}.`,
      why: `The job asks for ${id}.`,
      say: `Run ${run}: I can walk through ${id}.`,
      intendedClass: "Partially-Supported",
      comparison: "The line in names what this job tests.",
      better: true,
    });
    const suggest = suggestingLlm((gaps) => {
      run += 1;
      if (run === 1) first = gaps;
      const [a, b, c, e] = first as [string, string, string, string];
      const bullet = (n: number) => ({ kind: "bullet", role: 0, bullet: n });
      return run === 1
        ? [line(a, bullet(0)), line(b, { kind: "skill", group: 0 }), line(c, bullet(1)), line(e, { kind: "summary" })]
        : [line(a, bullet(0)), line(b, { kind: "skill", group: 0 }), line(c, { kind: "summary" })];
    });
    const stretch = withResay(suggest.llm);
    // The judge later meets a fifth requirement: the suggestions' input changes, the draft's does not.
    const judged = fakeJudge();
    let flipped: string | null = null;
    const judge: JudgeFn = async (adReq, facts) => {
      const j = await judged(adReq, facts);
      return j && flipped ? { ...j, verdicts: j.verdicts.map((v) => (v.requirementId === flipped ? { ...v, fit: 0.9 } : v)) } : j;
    };
    const { app, claims } = buildServer({ tailorLlm: tailor.llm, stretchLlm: stretch.llm, judge });
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "stretch-carry@example.com");
    const [a, b, c, e] = (await draftWithSuggestions(app, cookie)).stretch.suggestions;
    await post(app, cookie, `/onboarding/tailor/suggestions/${a.id}`, { answer: "use" });
    expect((await post(app, cookie, `/onboarding/tailor/suggestions/${b.id}/wording`, { text: EDITED })).statusCode).toBe(200);
    await post(app, cookie, `/onboarding/tailor/suggestions/${c.id}`, { answer: "no" });
    await post(app, cookie, `/onboarding/tailor/suggestions/${e.id}`, { answer: "use" });

    flipped = first[4]!;
    const redone = await draftWithSuggestions(app, cookie);
    expect(tailor.prompts).toHaveLength(1); // the draft stood
    expect(suggest.prompts).toHaveLength(2);
    const byId = new Map(redone.stretch.suggestions.map((s: { id: string }) => [s.id, s]));
    expect([...byId.keys()]).toEqual([a.id, b.id, c.id]); // E did not come back: dropped
    // A: the line he used, still used for this job, still printed.
    expect(byId.get(a.id)).toMatchObject({ state: "approved", scope: "this-job", claimText: a.claimText, decidedAt: expect.any(String) });
    expect(redone.html).toMatch(onScreen(a.claimText));
    // B: still open, with his own wording and the interview line rewritten for it.
    expect(byId.get(b.id)).toMatchObject({ state: "pending", claimText: EDITED, interviewNarrative: `I can stand behind it: ${EDITED}` });
    // C: back at another slot, so another swap — a fresh suggestion, unanswered.
    expect(byId.get(c.id)).toMatchObject({ state: "pending", scope: null, slot: { kind: "summary" }, claimText: `Run 2: led the work on ${c.requirementId}.` });
    expect(redone.html).not.toContain(e.claimText);
  });
});

describe("#420 the paid rewrites one session may spend are bounded (CODING_STANDARDS: per session, not per request)", () => {
  it("every rewrite that reaches the model counts, a failed one too, up to RESAY_LIMIT per session and across jobs; past it the edit is refused before anything is spent", async () => {
    const tailor = draftingLlm();
    let broken = false;
    const stretch = withResay(suggestingLlm().llm, (line) => (broken ? "not json" : JSON.stringify({ say: `Rewritten for: ${line}` })));
    const { app, claims } = buildServer({ tailorLlm: tailor.llm, stretchLlm: stretch.llm });
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "stretch-edit-limit@example.com");
    const [swap, skill] = (await draftWithSuggestions(app, cookie)).stretch.suggestions;
    // Every other rewrite fails twice (502) — paid for all the same, so it counts.
    for (let i = 0; i < RESAY_LIMIT; i++) {
      broken = i % 2 === 1;
      const res = await post(app, cookie, `/onboarding/tailor/suggestions/${i % 4 < 2 ? swap.id : skill.id}/wording`, { text: `Wording number ${i}` });
      expect(res.statusCode).toBe(broken ? 502 : 200);
    }
    broken = false;
    const spent = stretch.resays.length;
    expect(spent).toBe(RESAY_LIMIT / 2 + RESAY_LIMIT); // the failed half made one retry each
    const over = await post(app, cookie, `/onboarding/tailor/suggestions/${swap.id}/wording`, { text: "One wording too many" });
    expect(over.statusCode).toBe(429);
    expect(stretch.resays).toHaveLength(spent);

    // Bounded per session, not per draft: another job's suggestions are past the bound too.
    await post(app, cookie, `/onboarding/cards/${liveIdFor(SECOND_FIXTURE_AD_ID)}/want`);
    const [elsewhere] = (await draftWithSuggestions(app, cookie)).stretch.suggestions;
    const refused = await post(app, cookie, `/onboarding/tailor/suggestions/${elsewhere.id}/wording`, { text: "Another job's wording" });
    expect(refused.statusCode).toBe(429);
    expect(stretch.resays).toHaveLength(spent);
    // Unchanged wording is still free past the bound — it spends nothing.
    const same = await post(app, cookie, `/onboarding/tailor/suggestions/${elsewhere.id}/wording`, { text: elsewhere.claimText });
    expect(same.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------
// #419 + #420: an edited wording flows into "It's true" — the line the person keeps is the line
// they wrote. "It's true" needs no interview line: it is their fact, not a stretch to defend.
// ---------------------------------------------------------------------------------------------

describe("#419 + #420 Edit, then It's true: the master CV keeps the edited line", () => {
  it("the line that joins the master CV is the edited text, word for word, with no interview line; this CV prints it once; another suggestion can still be edited", async () => {
    const tailor = draftingLlm();
    const stretch = withResay(suggestingLlm().llm);
    const { app, claims } = buildServer({ tailorLlm: tailor.llm, stretchLlm: stretch.llm });
    const cookie = await anonSession(app);
    const sid = await reachTailorWithJob({ app, claims }, cookie, "stretch-edit-true@example.com");
    const view = await draftWithSuggestions(app, cookie);
    const [swap, skill] = view.stretch.suggestions;

    expect((await post(app, cookie, `/onboarding/tailor/suggestions/${swap.id}/wording`, { text: EDITED })).statusCode).toBe(200);
    expect((await post(app, cookie, `/onboarding/tailor/suggestions/${swap.id}`, { answer: "true" })).statusCode).toBe(200);

    const kept = (await claims.confirmed(sid)).find((c) => c.id === statedClaimId(swap.id));
    expect(kept).toMatchObject({ text: EDITED, role: JOB_ROLE, addedFor: ADDED_FOR });
    // The line alone joins the master CV: what to say if asked never becomes a fact.
    expect(JSON.stringify(await claims.list(sid))).not.toContain("I can stand behind it");
    const profile = (await get(app, cookie, "/profile")).json();
    const texts = profile.domains.flatMap((d: { facts: { text: string }[] }) => d.facts.map((f) => f.text));
    expect(texts).toContain(EDITED);
    expect(texts).not.toContain(swap.claimText);
    // This CV prints the edited line once, where the line out was.
    const after = (await get(app, cookie, "/onboarding/tailor/draft")).json();
    expect(after.html.split(EDITED)).toHaveLength(2);
    expect(tailor.prompts).toHaveLength(1);

    // The new master CV line never makes this draft read as stale to the other suggestion's edit.
    const other = await post(app, cookie, `/onboarding/tailor/suggestions/${skill.id}/wording`, { text: "Vendor tender management" });
    expect(other.statusCode).toBe(200);
    expect(other.json().stretch.suggestions[1]).toMatchObject({ claimText: "Vendor tender management", state: "pending" });
  });
});
