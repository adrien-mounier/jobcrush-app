// #417 (ADR-0020 clause 3, ADR-0005 clauses 1-4 and 6): once the draft is written, ONE more model call
// suggests stretches beside it. Tested at the route seam with a fake tailor model and a fake
// suggestion model (tailorDraft.test.ts's idiom): what is stored beside the draft, what is dropped
// in code, what the checkpoint spends, and what "No" does.
import { describe, expect, it } from "vitest";
import { buildItProjectDeliveryServer as buildServer } from "./placedServer.js";
import { liveIdFor, warmRetrieval } from "./fixtureDeck.js";
import type { LlmClient } from "../src/llm.js";
import { STRETCH_REQUIREMENT_LINE } from "../src/stretchSuggestions.js";
import { tailorClaimId } from "../src/tailor.js";
import type { CandidateClaim } from "@jobcrush/contracts";
import { InMemoryTailorDraftStore } from "../src/tailorDraftStore.js";
import { StandInDocumentMaker, type DocumentMaker } from "../src/documentMaker.js";
import type { Mailer } from "../src/mailer.js";
import { fakeJudge, reportingLlm } from "./reportFakes.js";

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

/** tailorDraft.test.ts's walk: three facts, one "No" (risks), sign in, retrieval, want. */
async function reachTailor({ app, claims }: { app: App; claims: Claims }, cookie: string, email: string) {
  await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
  const sid = (await get(app, cookie, "/sessions/me")).json().id as string;
  await claims.add(sid, floorClaim("end-to-end-delivery", "Owned delivery from planning through completion.", "Yes"));
  await claims.add(sid, floorClaim("stakeholder-coordination", "Business, engineering, and vendors.", "Business, engineering, and vendors"));
  await claims.answerNegative(
    sid,
    floorClaim(RISKS, "Not applicable — Have you acted on delivery risks, dependencies, timelines, or budgets?", "No"),
  );
  await claims.add(sid, floorClaim("delivery-communication", "Weekly steering updates.", "Weekly steering updates"));
  await signIn(app, cookie, email);
  await warmRetrieval(app, cookie);
  await post(app, cookie, `/onboarding/cards/${VALID_AD_ID}/want`);
  return sid;
}

const BULLET_TEXT = "Ran end-to-end delivery for the programme";
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
    expect(open.html).toMatch(/<span class="pin open"[^>]*>1<\/span>/);
    // The other shows as a margin numeral on its slot (the skills group), not as text.
    expect(open.html).toMatch(/<span class="pin"[^>]*>2<\/span>/);
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
    expect(open.html).not.toMatch(/<span class="pin"[^>]*>1<\/span>/); // the declined one is gone from the margin
    expect(open.html).toMatch(/<span class="pin open"[^>]*>2<\/span>/); // numbering stays stable
  });
});
