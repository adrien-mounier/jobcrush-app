// #335 — every CV line is ticked (prints) or kept (never prints, never deleted), and the print gate
// is server-side: the master CV, the tailored draft and the export render ticked lines only. Driven
// over HTTP (the spec's main seam) with a fake miner, a fake drafting model and a recording mailer.
// Each output test plants a line that WOULD print, unticks it, and asserts it is gone — so removing
// the gate (the `prints` rule behind claims.confirmed()) turns every one of them red.
import { describe, expect, it } from "vitest";
import type { CandidateClaim } from "@jobcrush/contracts";
import { buildItProjectDeliveryServer as buildServer } from "./placedServer.js";
import { liveIdFor, warmRetrieval } from "./fixtureDeck.js";
import { isTerminal } from "../src/jobs.js";
import { StandInDocumentMaker, type DocumentMaker } from "../src/documentMaker.js";
import type { LlmClient } from "../src/llm.js";
import type { Mailer } from "../src/mailer.js";
import { InMemoryClaimStore } from "../src/claims.js";
import { holdContradictingSentences } from "../src/heldSentences.js";

type Server = ReturnType<typeof buildServer>;
type App = Server["app"];

const claim = (over: Partial<CandidateClaim>): CandidateClaim => ({
  id: "acme-led-migration",
  semantic_key: over.id ?? "acme-led-migration",
  field_key: null,
  field_value: null,
  field_label: null,
  role: "Acme — PM",
  text: "Led the checkout replatform, delivered 2 months early.",
  machine_touch: "verbatim",
  classification: "Verified",
  source_quote: "Led checkout replatform",
  needs_grill: false,
  grill_hint: null,
  ...over,
});

const LINE = "acme-led-migration";
const LINE_TEXT = "Led the checkout replatform";
const MINED: CandidateClaim[] = [
  claim({ id: LINE }),
  claim({ id: "acme-ran-steering", text: "Ran the monthly steering committee for 12 stakeholders." }),
];
const fakePipeline = () => ({ mine: async () => ({ doc: null, claims: MINED, roles: 1, needsGrill: 0 }) });

const get = (app: App, cookie: string, url: string) => app.inject({ method: "GET", url, headers: { cookie } });
const post = (app: App, cookie: string, url: string, payload?: unknown) =>
  app.inject({ method: "POST", url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });
const put = (app: App, cookie: string, url: string, payload: unknown) =>
  app.inject({ method: "PUT", url, headers: { cookie }, payload });
const setLine = (app: App, cookie: string, id: string, state: string) => put(app, cookie, `/cv/lines/${id}`, { state });

async function anonSession(app: App): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/sessions/anonymous" });
  return `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
}
async function signIn(app: App, cookie: string, email: string): Promise<void> {
  const link = await post(app, cookie, "/auth/request-link", { email });
  const token = new URL("http://x" + link.json().devLink).searchParams.get("token")!;
  await post(app, cookie, "/auth/verify", { token });
}
async function settled(app: App, cookie: string, jobId: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const job = (await get(app, cookie, `/jobs/${jobId}`)).json();
    if (isTerminal(job.status)) return job;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("job never settled");
}

/** Paste → mine (fake) → seed the deck → confirm both lines: the CV as read, printing today. */
async function readCv(app: App, cookie: string) {
  const created = await post(app, cookie, "/cv/paste", {
    text: "Experience\nPM at Acme 2020 - 2024\n- shipped things\n".repeat(5),
  });
  const { jobId } = created.json();
  await settled(app, cookie, jobId);
  const deck = await post(app, cookie, "/onboarding/deck", { jobId });
  for (const c of MINED) await post(app, cookie, `/onboarding/claims/${c.id}/confirm`);
  return deck.json() as { claims: Array<{ id: string; lineState: string }> };
}

const build = async (app: App, cookie: string) =>
  (await post(app, cookie, "/onboarding/build")).json() as {
    rootCv: { markdown: string; trace: { entries: Array<{ nodeIds: string[] }> } };
  };
const onMasterCv = (cv: Awaited<ReturnType<typeof build>>, id: string, text: string) =>
  cv.rootCv.markdown.includes(text) || cv.rootCv.trace.entries.some((e) => e.nodeIds.includes(id));

interface Fact {
  id: string;
  colour: "gold" | "grey";
  kept?: true;
}
const profileFact = async (app: App, cookie: string, id: string) => {
  const { domains } = (await get(app, cookie, "/profile")).json() as { domains: Array<{ facts: Fact[] }> };
  return domains.flatMap((d) => d.facts).find((f) => f.id === id);
};

async function signedInWithCv(email: string, opts: Parameters<typeof buildServer>[0] = {}) {
  const server = buildServer({ pipeline: fakePipeline(), ...opts });
  const cookie = await anonSession(server.app);
  await signIn(server.app, cookie, email);
  const deck = await readCv(server.app, cookie);
  return { server, app: server.app, cookie, deck };
}

describe("#335 a line's tick, over HTTP", () => {
  it("imported lines arrive ticked, and confirmed content prints on the master CV as before", async () => {
    const { app, cookie, deck } = await signedInWithCv("ticked-arrive@example.com");
    expect(deck.claims.map((c) => c.lineState)).toEqual(["ticked", "ticked"]);
    const cv = await build(app, cookie);
    expect(onMasterCv(cv, LINE, LINE_TEXT)).toBe(true);
    expect(await profileFact(app, cookie, LINE)).toMatchObject({ colour: "gold" });
  });

  it("unticking keeps the line (grey, kept) and re-ticking restores it — both survive a reload", async () => {
    const { app, cookie } = await signedInWithCv("ticked-toggle@example.com");

    const unticked = await setLine(app, cookie, LINE, "kept");
    expect(unticked.statusCode).toBe(200);
    expect(unticked.json()).toEqual({ id: LINE, state: "kept" });
    // A fresh read: what the server stored, not what the response echoed.
    expect(await profileFact(app, cookie, LINE)).toMatchObject({ colour: "grey", kept: true });
    expect(onMasterCv(await build(app, cookie), LINE, LINE_TEXT)).toBe(false);

    expect((await setLine(app, cookie, LINE, "ticked")).statusCode).toBe(200);
    const back = await profileFact(app, cookie, LINE);
    expect(back).toMatchObject({ colour: "gold" });
    expect(back).not.toHaveProperty("kept");
    expect(onMasterCv(await build(app, cookie), LINE, LINE_TEXT)).toBe(true);
  });

  it("a not-yet-confirmed line stays grey without the kept mark — the two greys never merge", async () => {
    const server = buildServer({ pipeline: fakePipeline() });
    const cookie = await anonSession(server.app);
    await signIn(server.app, cookie, "ticked-pending@example.com");
    const created = await post(server.app, cookie, "/cv/paste", {
      text: "Experience\nPM at Acme 2020 - 2024\n- shipped things\n".repeat(5),
    });
    await settled(server.app, cookie, created.json().jobId);
    await post(server.app, cookie, "/onboarding/deck", { jobId: created.json().jobId });
    const pending = await profileFact(server.app, cookie, LINE);
    expect(pending).toMatchObject({ colour: "grey" });
    expect(pending).not.toHaveProperty("kept");
  });

  it("refuses an unknown line, another person's line, and a state that is not a tap", async () => {
    const { app, cookie } = await signedInWithCv("ticked-owner@example.com");
    expect((await setLine(app, cookie, "no-such-line", "kept")).statusCode).toBe(404);
    expect((await setLine(app, cookie, LINE, "drafted")).statusCode).toBe(400);

    const stranger = await anonSession(app);
    expect((await setLine(app, stranger, LINE, "kept")).statusCode).toBe(404);
    expect(await profileFact(app, cookie, LINE)).toMatchObject({ colour: "gold" });
  });

  it("confirming or editing a kept line never forces it onto the master CV", async () => {
    const { app, cookie } = await signedInWithCv("ticked-force-master@example.com");
    await setLine(app, cookie, LINE, "kept");
    await post(app, cookie, `/onboarding/claims/${LINE}/confirm`);
    await put(app, cookie, `/onboarding/claims/${LINE}`, { text: `${LINE_TEXT}, as programme owner.` });
    const cv = await build(app, cookie);
    expect(onMasterCv(cv, LINE, LINE_TEXT)).toBe(false);
    expect(await profileFact(app, cookie, LINE)).toMatchObject({ colour: "grey", kept: true });
  });
});

describe("#335 a kept line still answers to a correction", () => {
  it("a correction holds a kept line carrying the superseded value, so re-ticking it cannot print the stale value", async () => {
    const claims = new InMemoryClaimStore();
    await claims.seed("s", [claim({ id: "acme-since", text: "Led delivery at Acme since 2019." })]);
    await claims.confirm("s", "acme-since");
    await claims.setLineState("s", "acme-since", "kept");

    const held = await holdContradictingSentences(claims, "s", "start", { year: 2019 }, { year: 2020 });
    expect(held.map((h) => h.id)).toEqual(["acme-since"]);

    await claims.setLineState("s", "acme-since", "ticked");
    expect(await claims.confirmed("s")).toEqual([]); // held aside until the person answers
  });
});

// --- the tailored draft and the export ------------------------------------------------------

const ROLE = "IT project manager in Paris";
const VALID_AD_ID = liveIdFor("2026-07-05_endava-vietnam_senior-project-manager");

/** A fake model that prints EVERY claim it is handed, one bullet each — so a kept line reaching it
 *  would reach the page. Records each prompt. */
function echoingLlm(prompts: string[]): LlmClient {
  return {
    model: "test-fake",
    async complete(prompt: string): Promise<string> {
      prompts.push(prompt);
      const claimsBlock = (prompt.split("Claims:\n")[1] ?? "").split("\n\n")[0]!;
      const bullets = [...claimsBlock.matchAll(/^- ([a-z0-9][a-z0-9-]*) \[[^\]]*\] (.+)$/gm)].map((m) => ({
        text: m[2]!,
        claimIds: [m[1]!],
        outcome: "",
      }));
      return JSON.stringify({
        name: "Test Person",
        headline: "IT Project Manager",
        contact: "Paris",
        summary: "Delivery-accountable project manager.",
        experience: [
          { role: "IT Project Manager", employer: "Acme", location: "", dates: "2020 - 2024", bullets, unprinted: [] },
        ],
        skills: [{ label: "Delivery", items: ["Jira"] }],
        certifications: [],
        education: [],
        additional: [],
      });
    },
  };
}

function recordingMailer() {
  const sent: string[] = [];
  const mailer: Mailer = {
    live: false,
    async sendLoginLink() {},
    async sendFamilyReady() {},
    async sendTailoredCv(email) {
      sent.push(email);
    },
  };
  return { sent, mailer };
}

/** Discovery → sign in → read the CV → retrieval → want: tailorExport.test.ts's walk, plus a CV. */
async function tailoringWithCv(email: string, opts: Parameters<typeof buildServer>[0]) {
  const server = buildServer({ pipeline: fakePipeline(), ...opts });
  const { app } = server;
  const cookie = await anonSession(app);
  await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
  await post(app, cookie, "/onboarding/discovery/answer", { itemId: "end-to-end-delivery", answer: "Yes" });
  await post(app, cookie, "/onboarding/discovery/answer", {
    itemId: "stakeholder-coordination",
    answer: "Business, engineering, and vendors",
  });
  await post(app, cookie, "/onboarding/discovery/answer", { itemId: "risk-dependency-control", answer: "Yes" });
  await post(app, cookie, "/onboarding/discovery/answer", {
    itemId: "delivery-communication",
    answer: "Weekly steering updates",
  });
  await signIn(app, cookie, email);
  await readCv(app, cookie);
  await post(app, cookie, "/review/complete"); // #338: a brought CV is reviewed before any job is shown
  await warmRetrieval(app, cookie);
  await post(app, cookie, `/onboarding/cards/${VALID_AD_ID}/want`);
  return { app, cookie, server };
}

async function draft(app: App, cookie: string) {
  const started = await post(app, cookie, "/onboarding/tailor/draft");
  if (started.statusCode === 202) await settled(app, cookie, started.json().jobId);
  return get(app, cookie, "/onboarding/tailor/draft");
}

/** Untick, then let the deck's search catch up with the new fact set (the evidence it searched
 *  with just changed) so the job being tailored still resolves. */
async function untick(app: App, cookie: string, id: string) {
  expect((await setLine(app, cookie, id, "kept")).statusCode).toBe(200);
  await warmRetrieval(app, cookie);
}

describe("#335 the tailored draft and the export print ticked lines only", () => {
  it("a kept line never reaches the tailored draft — not the model's input, not the page", async () => {
    const prompts: string[] = [];
    const { app, cookie } = await tailoringWithCv("ticked-draft@example.com", { tailorLlm: echoingLlm(prompts) });

    const before = await draft(app, cookie);
    expect(before.statusCode).toBe(200);
    expect(before.json().html).toContain(LINE_TEXT); // the fake prints what it is given

    await untick(app, cookie, LINE);
    // Asking to print it anyway: confirming or editing a kept line never re-ticks it.
    await post(app, cookie, `/onboarding/claims/${LINE}/confirm`);
    await put(app, cookie, `/onboarding/claims/${LINE}`, { text: `${LINE_TEXT}, as programme owner.` });
    // The draft made while the line was ticked is no draft for the current facts.
    expect((await get(app, cookie, "/onboarding/tailor/draft")).statusCode).toBe(404);
    const after = await draft(app, cookie);
    expect(after.statusCode).toBe(200);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).not.toContain(LINE_TEXT);
    expect(after.json().html).not.toContain(LINE_TEXT);
    expect(after.json().html).toContain("Ran the monthly steering committee"); // its ticked sibling still prints
  });

  it("approving a draft that carries a since-kept line is refused, and nothing is printed or sent", async () => {
    const { sent, mailer } = recordingMailer();
    const printed: string[] = [];
    const documentMaker: DocumentMaker = {
      async printCv(html) {
        printed.push(html);
        return new StandInDocumentMaker().printCv(html);
      },
    };
    const { app, cookie } = await tailoringWithCv("ticked-export@example.com", {
      tailorLlm: echoingLlm([]),
      documentMaker,
      mailer,
    });
    const view = (await draft(app, cookie)).json();
    expect(view.html).toContain(LINE_TEXT);

    await untick(app, cookie, LINE);
    const res = await post(app, cookie, "/onboarding/tailor/approve", { draftedAt: view.draftedAt });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("no_draft");
    expect(printed).toEqual([]);
    expect(sent).toEqual([]);

    // Redrafted for the current facts, the export goes out — without the kept line.
    const redrafted = (await draft(app, cookie)).json();
    const sentRes = await post(app, cookie, "/onboarding/tailor/approve", { draftedAt: redrafted.draftedAt });
    expect(sentRes.statusCode).toBe(202);
    expect((await settled(app, cookie, sentRes.json().jobId)).status).toBe("completed");
    expect(printed).toHaveLength(1);
    expect(printed[0]).not.toContain(LINE_TEXT);
    expect(sent).toEqual(["ticked-export@example.com"]);
  });
});

// --- #377 check mode: a removed item is the kept state underneath, and prints nowhere ---------

describe("#377 a removed item (check mode's ⊖ = the kept state underneath) reaches no render", () => {
  it("absent from the master CV, the tailored draft's input and page, and the export — present in each while in, and again once put back", async () => {
    const prompts: string[] = [];
    const { sent, mailer } = recordingMailer();
    const printed: string[] = [];
    const documentMaker: DocumentMaker = {
      async printCv(html) {
        printed.push(html);
        return new StandInDocumentMaker().printCv(html);
      },
    };
    const { app, cookie } = await tailoringWithCv("removed-item@example.com", { tailorLlm: echoingLlm(prompts), documentMaker, mailer });

    // In: it prints everywhere (the positive half — the fake tailor prints what it is given).
    expect(onMasterCv(await build(app, cookie), LINE, LINE_TEXT)).toBe(true);
    const before = (await draft(app, cookie)).json();
    expect(prompts[0]).toContain(LINE_TEXT);
    expect(before.html).toContain(LINE_TEXT);

    // Removed, through the door check mode's ⊖ taps. The walk reads it back as a removed item.
    await untick(app, cookie, LINE);
    const walk = (await get(app, cookie, "/review")).json() as { sections: Array<{ jobs?: Array<{ lines: Array<{ id: string; state: string }> }> }> };
    expect(walk.sections.flatMap((s) => s.jobs ?? []).flatMap((j) => j.lines).find((l) => l.id === LINE)).toMatchObject({ state: "kept" });

    expect(onMasterCv(await build(app, cookie), LINE, LINE_TEXT)).toBe(false);
    expect((await get(app, cookie, "/onboarding/tailor/draft")).statusCode).toBe(404); // the old draft carried it
    const after = (await draft(app, cookie)).json();
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).not.toContain(LINE_TEXT);
    expect(after.html).not.toContain(LINE_TEXT);
    expect(after.html).toContain("Ran the monthly steering committee"); // its sibling still prints

    const sentRes = await post(app, cookie, "/onboarding/tailor/approve", { draftedAt: after.draftedAt });
    expect(sentRes.statusCode).toBe(202);
    expect((await settled(app, cookie, sentRes.json().jobId)).status).toBe("completed");
    expect(printed).toHaveLength(1);
    expect(printed[0]).not.toContain(LINE_TEXT);
    expect(printed[0]).toContain("Ran the monthly steering committee");
    expect(sent).toEqual(["removed-item@example.com"]);

    // Put back: it prints again.
    expect((await setLine(app, cookie, LINE, "ticked")).statusCode).toBe(200);
    await warmRetrieval(app, cookie);
    expect(onMasterCv(await build(app, cookie), LINE, LINE_TEXT)).toBe(true);
    expect((await draft(app, cookie)).json().html).toContain(LINE_TEXT);
  });
});

// --- #379 the person's own words on an item, in place (ADR-0018 clause 2) -------------------------

const EDITED = "Replaced the checkout platform, live 2 months early.";
const editLine = (app: App, cookie: string, id: string, text: string) => put(app, cookie, `/cv/lines/${id}/text`, { text });
type WalkLine = { id: string; text: string; state: string };
const walkLine = async (app: App, cookie: string, id: string) => {
  const walk = (await get(app, cookie, "/review")).json() as {
    sections: Array<{ jobs?: Array<{ lines: WalkLine[] }>; lines?: WalkLine[] }>;
  };
  return walk.sections.flatMap((s) => s.jobs?.flatMap((j) => j.lines) ?? s.lines ?? []).find((l) => l.id === id);
};

describe("#379 an item's words edited in place, over HTTP", () => {
  it("before the wall: Save persists across a reload with the first original kept and the words recorded as the person's own; an empty save, an unknown line and another person's line are refused; a removed item stays removed", async () => {
    const server = buildServer({ pipeline: fakePipeline() });
    const { app } = server;
    const cookie = await anonSession(app);
    const created = await post(app, cookie, "/cv/paste", { text: "Experience\nPM at Acme 2020 - 2024\n- shipped things\n".repeat(5) });
    await settled(app, cookie, created.json().jobId);
    const asRead = MINED[0]!.text;
    expect(await walkLine(app, cookie, LINE)).toMatchObject({ text: asRead, state: "ticked" });

    const saved = await editLine(app, cookie, LINE, `  ${EDITED}  `);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ id: LINE, text: EDITED });
    // A fresh read: what the server stored, trimmed, not what the response echoed.
    expect(await walkLine(app, cookie, LINE)).toMatchObject({ text: EDITED, state: "ticked" });
    expect(await profileFact(app, cookie, LINE)).toMatchObject({ source: "told" });

    for (const empty of ["", "   "]) expect((await editLine(app, cookie, LINE, empty)).statusCode).toBe(400);
    // Capped like a draft's own words (PUT /review/drafts/:id): 600 characters go in, 601 do not.
    expect((await editLine(app, cookie, LINE, "x".repeat(601))).statusCode).toBe(400);
    expect((await editLine(app, cookie, "no-such-line", "x")).statusCode).toBe(404);
    const stranger = await anonSession(app);
    expect((await editLine(app, stranger, LINE, "x")).statusCode).toBe(404);
    expect(await walkLine(app, cookie, LINE)).toMatchObject({ text: EDITED });

    // The original is kept once: a second edit keeps the words as read, not the first edit.
    expect((await editLine(app, cookie, LINE, "Third wording.")).statusCode).toBe(200);
    const session = await server.sessions.getByToken(cookie.split("=")[1]!);
    const record = (await server.claims.list(session!.id)).find((c) => c.id === LINE);
    expect(record).toMatchObject({ text: "Third wording.", originalText: asRead, origin: "user-authored", lineState: "ticked" });

    // Editing a removed item rewords it where it is held — it is not put back.
    expect((await setLine(app, cookie, LINE, "kept")).statusCode).toBe(200);
    expect((await editLine(app, cookie, LINE, "Fourth wording.")).statusCode).toBe(200);
    expect(await walkLine(app, cookie, LINE)).toMatchObject({ text: "Fourth wording.", state: "kept" });
  });

  it("the edited words are what the master CV, the tailored draft's input and page, and the export print — the words as read nowhere", async () => {
    const prompts: string[] = [];
    const { sent, mailer } = recordingMailer();
    const printed: string[] = [];
    const documentMaker: DocumentMaker = {
      async printCv(html) {
        printed.push(html);
        return new StandInDocumentMaker().printCv(html);
      },
    };
    const { app, cookie } = await tailoringWithCv("edited-words@example.com", { tailorLlm: echoingLlm(prompts), documentMaker, mailer });

    // As read: the words print everywhere (the positive half — the fake tailor prints what it is given).
    expect(onMasterCv(await build(app, cookie), LINE, LINE_TEXT)).toBe(true);
    const before = (await draft(app, cookie)).json();
    expect(prompts[0]).toContain(LINE_TEXT);
    expect(before.html).toContain(LINE_TEXT);

    expect((await editLine(app, cookie, LINE, EDITED)).statusCode).toBe(200);
    await warmRetrieval(app, cookie);
    const cv = await build(app, cookie);
    expect(cv.rootCv.markdown).toContain(EDITED);
    expect(cv.rootCv.markdown).not.toContain(LINE_TEXT);
    expect((await get(app, cookie, "/onboarding/tailor/draft")).statusCode).toBe(404); // the old draft carried the old words
    const after = (await draft(app, cookie)).json();
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain(EDITED);
    expect(prompts[1]).not.toContain(LINE_TEXT);
    expect(after.html).toContain(EDITED);
    expect(after.html).not.toContain(LINE_TEXT);

    const sentRes = await post(app, cookie, "/onboarding/tailor/approve", { draftedAt: after.draftedAt });
    expect(sentRes.statusCode).toBe(202);
    expect((await settled(app, cookie, sentRes.json().jobId)).status).toBe("completed");
    expect(printed).toHaveLength(1);
    expect(printed[0]).toContain(EDITED);
    expect(printed[0]).not.toContain(LINE_TEXT);
    expect(sent).toEqual(["edited-words@example.com"]);
  });
});
