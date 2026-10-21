// #313 — approving is sending, observed through the API boundary and through the injected
// document maker (#312's stand-in), so the whole chain — approve → lint → document → email —
// runs on every push with no browser and no provider. The gates are server-side (repo rule):
// a draft that fails the lint or does not carry this person's approval cannot be emailed.
import { describe, expect, it } from "vitest";
import { buildItProjectDeliveryServer as buildServer } from "./placedServer.js";
import { liveIdFor, warmRetrieval } from "./fixtureDeck.js";
import { loadAdRequirements } from "../src/e5stub.js";
import { StandInDocumentMaker, type DocumentMaker } from "../src/documentMaker.js";
import type { Mailer } from "../src/mailer.js";
import type { LlmClient } from "../src/llm.js";
import { InMemoryTailorDraftStore } from "../src/tailorDraftStore.js";
import { exportGate, PAGE_NOTICES, tightenedBulletBudget } from "../src/tailorExport.js";
import { REPORT_LINES } from "../src/applicationReport.js";
import { fakeJudge, reportingLlm } from "./reportFakes.js";
import type { DraftInputs } from "../src/tailorDraft.js";
import type { Draft } from "../src/preview.js";
import type { CandidateClaim } from "@jobcrush/contracts";

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

type Claims = ReturnType<typeof buildServer>["claims"];
/** One discovery answer exactly as the pre-#339 answer route wrote it: id `discovery-<item>`,
 *  semantic_key the bare item id, the visitor's own words as the line. */
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

/** Discovery → sign in → retrieval → want: tailorDraft.test.ts's walk, verbatim. #339: the floor
 *  answers are planted in the claims store — discovery no longer asks them, the deck no longer waits
 *  on them, but the draft still needs facts to cite and the RISKS "No" to keep off the page. */
async function reachTailor({ app, claims }: { app: App; claims: Claims }, cookie: string, email: string) {
  await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
  const sid = (await get(app, cookie, "/sessions/me")).json().id as string;
  await claims.add(sid, floorClaim(END_TO_END, "Owned delivery from planning through completion.", "Yes"));
  await claims.add(sid, floorClaim(STAKEHOLDERS, "Business, engineering, and vendors.", "Business, engineering, and vendors"));
  await claims.answerNegative(
    sid,
    floorClaim(RISKS, "Not applicable — Have you acted on delivery risks, dependencies, timelines, or budgets?", "No"),
  );
  await claims.add(sid, floorClaim(COMMUNICATION, "Weekly steering updates.", "Weekly steering updates"));
  await signIn(app, cookie, email);
  await warmRetrieval(app, cookie);
  await post(app, cookie, `/onboarding/cards/${VALID_AD_ID}/want`);
}

/** The tailorDraft.test.ts fake model: cites real claim ids from the prompt's own Claims: block. */
function draftingLlm(additional: { label: string; value: string }[] = []): LlmClient {
  return {
    model: "test-fake",
    async complete(prompt: string): Promise<string> {
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
              { text: "Ran end-to-end delivery for the programme", claimIds: [ids[0]!], outcome: "" },
            ],
            unprinted: [],
          },
        ],
        skills: [{ label: "Delivery", items: ["Jira"] }],
        certifications: [],
        education: [],
        additional,
      });
    },
  };
}

type ServerOpts = NonNullable<Parameters<typeof buildServer>[0]>;
/** The export tests' server: a judged card and a report model by default, overridable. */
const exportServer = (opts: ServerOpts = {}) =>
  buildServer({ judge: fakeJudge(), reportLlm: reportingLlm().llm, ...opts });

interface SentMail {
  email: string;
  subject: string;
  text: string;
  filename: string;
  pdf: Buffer;
}
/** A mailer that records instead of sending — the test's view of "the mail is away". */
function recordingMailer() {
  const sent: SentMail[] = [];
  const mailer: Mailer = {
    live: false,
    async sendLoginLink() {},
    async sendFamilyReady() {},
    async sendTailoredCv(email, doc) {
      sent.push({ email, ...doc });
    },
  };
  return { sent, mailer };
}

async function awaitJob(app: App, cookie: string, jobId: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const res = await get(app, cookie, `/jobs/${jobId}`);
    const job = res.json();
    if (job.status === "completed" || job.status === "failed") return job;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("export job never settled");
}

/** Draft first (the real route), then return the view the screen shows — draftedAt included. */
async function draftAndRead(app: App, cookie: string) {
  const started = await post(app, cookie, "/onboarding/tailor/draft");
  if (started.statusCode === 202) await awaitJob(app, cookie, started.json().jobId);
  return (await get(app, cookie, "/onboarding/tailor/draft")).json();
}

describe("#313 POST /onboarding/tailor/approve — guards", () => {
  it("503s honestly when no document maker is wired — never an invented PDF", async () => {
    const { app, claims } = exportServer({ tailorLlm: draftingLlm() });
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "export-no-maker@example.com");
    const view = await draftAndRead(app, cookie);
    const res = await post(app, cookie, "/onboarding/tailor/approve", { draftedAt: view.draftedAt });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("export_unavailable");
  });

  it("refuses an unapproved draft: a press naming a draft he never saw sends nothing", async () => {
    const { sent, mailer } = recordingMailer();
    const tailorDrafts = new InMemoryTailorDraftStore();
    const { app, claims } = exportServer({
      tailorLlm: draftingLlm(),
      documentMaker: new StandInDocumentMaker(),
      mailer,
      tailorDrafts,
    });
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "export-unapproved@example.com");
    await draftAndRead(app, cookie);
    const res = await post(app, cookie, "/onboarding/tailor/approve", {
      draftedAt: "2020-01-01T00:00:00.000Z",
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("not_approved");
    expect(sent).toHaveLength(0);
  });

  it("404s when there is no draft for the current facts — nothing to approve", async () => {
    const { mailer } = recordingMailer();
    const { app, claims } = exportServer({
      tailorLlm: draftingLlm(),
      documentMaker: new StandInDocumentMaker(),
      mailer,
    });
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "export-no-draft@example.com");
    const res = await post(app, cookie, "/onboarding/tailor/approve", { draftedAt: "whenever" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("no_draft");
  });
});

describe("#313 one press: approve → lint → document → email, through the stand-in", () => {
  it("prints the draft, emails the PDF to the signed-in account, and records the approval", async () => {
    const { sent, mailer } = recordingMailer();
    const tailorDrafts = new InMemoryTailorDraftStore();
    // Wraps the stand-in to capture what was handed to the printer — the exported document.
    const printedHtml: string[] = [];
    const capturingMaker: DocumentMaker = {
      async printCv(html) {
        printedHtml.push(html);
        return new StandInDocumentMaker().printCv(html);
      },
    };
    const { app, sessions, claims } = exportServer({
      tailorLlm: draftingLlm(),
      documentMaker: capturingMaker,
      mailer,
      tailorDrafts,
    });
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "export-happy@example.com");
    const view = await draftAndRead(app, cookie);

    const res = await post(app, cookie, "/onboarding/tailor/approve", { draftedAt: view.draftedAt });
    expect(res.statusCode).toBe(202);
    const job = await awaitJob(app, cookie, res.json().jobId);
    expect(job.status).toBe("completed");
    // The narration's final state: the document is made and the mail is away.
    expect(job.progress.tailorExport.step).toBe("sent");
    expect(job.progress.tailorExport.pages).toBe(2);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.email).toBe("export-happy@example.com");
    expect(sent[0]!.pdf.toString("utf8")).toMatch(/^%PDF/);
    expect(sent[0]!.filename).toMatch(/^CV - .+\.pdf$/);
    expect(sent[0]!.text).toContain("2 pages");

    // The approved document is not a draft: the screen's render carries the DRAFT banner and
    // watermark, the printed one must not.
    expect(view.html).toContain("DRAFT");
    expect(printedHtml[0]).not.toContain("DRAFT");

    // The approval record is durable, on the draft row itself.
    const token = cookie.split("=")[1]!;
    const session = (await sessions.getByToken(token))!;
    const stored = await tailorDrafts.get(session.id, VALID_AD_ID);
    expect(stored?.approvedAt).not.toBeNull();
  });

  it("the route refuses a lint-failing draft — a document stating a denial cannot be emailed", async () => {
    // Through the ROUTE, not only the pure gate: a denial is answered, a clean draft is stored,
    // then the stored document is tampered to state the denied requirement (the shape only store
    // corruption can produce — the engine refuses to checkpoint a fatal draft). The press must
    // refuse it, which proves the route hands the gate the session's real denial list.
    const { sent, mailer } = recordingMailer();
    const tailorDrafts = new InMemoryTailorDraftStore();
    const { app, sessions, claims } = exportServer({
      tailorLlm: draftingLlm(),
      documentMaker: new StandInDocumentMaker(),
      mailer,
      tailorDrafts,
    });
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "export-lint@example.com");
    // Deny an advert requirement in the card's own words — the never-print list entry. First one
    // the answer door takes (a profile-owned requirement is refused there, and rightly).
    let denied: { id: string; requirement: string } | undefined;
    for (const requirement of loadAdRequirements(FIXTURE_AD_ID)!.requirements) {
      const answered = await post(app, cookie, "/onboarding/tailor/answer", {
        requirementId: requirement.id,
        answer: "No",
      });
      if (answered.statusCode === 200) {
        denied = requirement;
        break;
      }
    }
    expect(denied).toBeDefined();
    const view = await draftAndRead(app, cookie);

    const token = cookie.split("=")[1]!;
    const session = (await sessions.getByToken(token))!;
    const stored = (await tailorDrafts.get(session.id, VALID_AD_ID))!;
    await tailorDrafts.put(session.id, VALID_AD_ID, {
      ...stored,
      draft: { ...stored.draft, summary: `${stored.draft.summary} ${denied!.requirement}` },
    });

    const res = await post(app, cookie, "/onboarding/tailor/approve", { draftedAt: view.draftedAt });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("lint_failed");
    expect(sent).toHaveLength(0);
  });

  it("the route refuses a draft that lost a language the person holds, and a draft carrying it goes out (#337)", async () => {
    // The person holds German (a confirmed lang- claim). The model prints it, the draft is stored,
    // the press goes out; then the stored document loses the line (store corruption again — the
    // engine itself refuses to checkpoint it) and the same press is refused through the route.
    const { sent, mailer } = recordingMailer();
    const tailorDrafts = new InMemoryTailorDraftStore();
    const { app, sessions, claims } = exportServer({
      tailorLlm: draftingLlm([{ label: "Spoken", value: "German (B1)" }]),
      documentMaker: new StandInDocumentMaker(),
      mailer,
      tailorDrafts,
    });
    const cookie = await anonSession(app);
    const token = cookie.split("=")[1]!;
    const session = (await sessions.getByToken(token))!;
    await claims.add(session.id, {
      id: "lang-german",
      semantic_key: "lang-german",
      role: "profile",
      text: "German (B1)",
      machine_touch: "verbatim",
      classification: "Verified",
      source_quote: "German (B1)",
      needs_grill: false,
      grill_hint: null,
    } as Parameters<typeof claims.add>[1]);
    await reachTailor({ app, claims }, cookie, "export-language@example.com");
    const view = await draftAndRead(app, cookie);
    expect(view.html).toContain("German");

    const stored = (await tailorDrafts.get(session.id, VALID_AD_ID))!;
    await tailorDrafts.put(session.id, VALID_AD_ID, { ...stored, draft: { ...stored.draft, additional: [] } });
    const refused = await post(app, cookie, "/onboarding/tailor/approve", { draftedAt: view.draftedAt });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe("lint_failed");
    expect(sent).toHaveLength(0);

    await tailorDrafts.put(session.id, VALID_AD_ID, stored);
    const sentOk = await post(app, cookie, "/onboarding/tailor/approve", { draftedAt: view.draftedAt });
    expect(sentOk.statusCode).toBe(202);
    expect((await awaitJob(app, cookie, sentOk.json().jobId)).status).toBe("completed");
    expect(sent).toHaveLength(1);
  });

  it("a second press while the first still runs joins it — one email, not two", async () => {
    const { sent, mailer } = recordingMailer();
    // A maker slow enough that the second press lands mid-run.
    const slowMaker: DocumentMaker = {
      async printCv(html) {
        await new Promise((r) => setTimeout(r, 50));
        return new StandInDocumentMaker().printCv(html);
      },
    };
    const { app, claims } = exportServer({
      tailorLlm: draftingLlm(),
      documentMaker: slowMaker,
      mailer,
    });
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "export-double@example.com");
    const view = await draftAndRead(app, cookie);

    const first = await post(app, cookie, "/onboarding/tailor/approve", { draftedAt: view.draftedAt });
    const second = await post(app, cookie, "/onboarding/tailor/approve", { draftedAt: view.draftedAt });
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(second.json().jobId).toBe(first.json().jobId);
    await awaitJob(app, cookie, first.json().jobId);
    expect(sent).toHaveLength(1);
  });

  it("a failed print narrates plain words and the job fails — never a silent hang", async () => {
    const { sent, mailer } = recordingMailer();
    const brokenMaker: DocumentMaker = {
      async printCv() {
        throw new Error("browser died");
      },
    };
    const { app, claims } = exportServer({
      tailorLlm: draftingLlm(),
      documentMaker: brokenMaker,
      mailer,
    });
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "export-broken@example.com");
    const view = await draftAndRead(app, cookie);
    const res = await post(app, cookie, "/onboarding/tailor/approve", { draftedAt: view.draftedAt });
    const job = await awaitJob(app, cookie, res.json().jobId);
    expect(job.status).toBe("failed");
    expect(job.progress.tailorExport.failure.cameBack).toContain("could not");
    expect(sent).toHaveLength(0);
  });
});

describe("#313 exportGate — the lint refusal, pure", () => {
  const draft = {
    name: "Test Person",
    headline: "IT Project Manager",
    contact: "Hanoi",
    // States the denied capability verbatim — the fatal finding #311 defined.
    summary: "Leads SAP migration programmes end to end.",
    experience: [
      {
        role: "IT Project Manager",
        employer: "Endava",
        location: "",
        dates: "2021 - Present",
        bullets: [{ text: "Ran delivery", claimIds: ["c1"], outcome: "" }],
        unprinted: [],
      },
    ],
    skills: [],
    certifications: [],
    education: [],
    additional: [],
  } as unknown as Draft;
  const inputs = (denied: string[]): DraftInputs => ({
    claimsDoc: {
      schemaVersion: "1",
      roles: [],
      claims: [{ id: "c1", text: "Ran delivery", role: "experience" }],
      parser_flags: [],
    },
    opts: { jobBlocks: [], advertTests: [], negatives: denied, openPoints: [] },
    headerText: "",
    fingerprint: "fp-1",
  });
  const record = (overrides: Partial<Parameters<typeof exportGate>[0] & object> = {}) => ({
    draft,
    conservationNotices: [],
    inputFingerprint: "fp-1",
    draftedAt: "2026-10-01T08:00:00.000Z",
    approvedAt: null,
    ...overrides,
  });

  it("a draft stating a denied capability is refused — it cannot be emailed at all", async () => {
    const refused = exportGate(record(), inputs(["SAP migration"]), "2026-10-01T08:00:00.000Z");
    expect(refused?.status).toBe(409);
    expect(refused?.code).toBe("lint_failed");
  });

  it("the same draft with nothing denied passes the gate", async () => {
    expect(exportGate(record(), inputs([]), "2026-10-01T08:00:00.000Z")).toBeNull();
  });
});

// #314 — over two pages: tighten once on a real budget, then ship and tell. Through the route and
// the stand-in, with a maker that MEASURES what the fake model printed (the stand-in's declared
// count is the measurement; a real PDF's page count comes from countPdfPages).
describe("#314 over two pages: one re-tailor on a bullet budget, then ship and tell", () => {
  /** A fake model that cites the prompt's claim ids, records every prompt it saw, and prints as
   *  many bullets as the PAGE-BUDGET block allows (or 3 with no block). */
  function budgetAwareLlm() {
    const prompts: string[] = [];
    const llm: LlmClient = {
      model: "test-fake",
      async complete(prompt: string): Promise<string> {
        prompts.push(prompt);
        const claimsBlock = prompt.split("Claims:\n")[1] ?? "";
        const ids = [...claimsBlock.matchAll(/^- ([a-z0-9][a-z0-9-]*) \[/gm)].map((m) => m[1]!);
        const cap = Number(/at most (\d+) experience bullets/.exec(prompt)?.[1] ?? 3);
        // One distinct claim per bullet (the seeded facts give three), so the lint never fires
        // and the only thing that changes between the two calls is the budget.
        const bullets = Array.from({ length: cap }, (_, i) => ({
          text: `Ran delivery, part ${i + 1}`,
          claimIds: [ids[i % ids.length]!],
          outcome: "",
        }));
        return JSON.stringify({
          name: "Test Person",
          headline: "IT Project Manager",
          contact: "Hanoi",
          summary: "",
          experience: [
            { role: "IT Project Manager", employer: "Endava", location: "", dates: "2021 - Present", bullets, unprinted: [] },
          ],
          skills: [{ label: "Delivery", items: ["Jira"] }],
          certifications: [],
          education: [],
          additional: [],
        });
      },
    };
    return { llm, prompts };
  }
  /** A maker whose "measurement" is the bullet count it was handed: 3 bullets ⇒ 3 pages. */
  const bulletCountingMaker = (): DocumentMaker => ({
    async printCv(html) {
      return { pdf: Buffer.from("%PDF-1.4 counted\n"), pages: (html.match(/<li>/g) ?? []).length };
    },
  });

  it("re-tailors once on a numeric budget, prints again, ships the two-page CV and tells him — screen and email", async () => {
    const { sent, mailer } = recordingMailer();
    const { llm, prompts } = budgetAwareLlm();
    const tailorDrafts = new InMemoryTailorDraftStore();
    const { app, sessions, claims } = exportServer({
      tailorLlm: llm,
      documentMaker: bulletCountingMaker(),
      mailer,
      tailorDrafts,
    });
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "export-tighten@example.com");
    const view = await draftAndRead(app, cookie);
    expect(prompts).toHaveLength(1);

    const res = await post(app, cookie, "/onboarding/tailor/approve", { draftedAt: view.draftedAt });
    const job = await awaitJob(app, cookie, res.json().jobId);
    expect(job.status).toBe("completed");
    // Exactly one re-tailor, and its input carries the budget as a number: 3 bullets over 3 pages
    // scale to 2 for two pages.
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("===PAGE-BUDGET===");
    expect(prompts[1]).toMatch(/at most 2 experience bullets/);
    expect(job.progress.tailorExport.pages).toBe(2);
    // Told plainly, on the screen's record and in the email both.
    const notice = PAGE_NOTICES.tightened(3);
    expect(job.progress.tailorExport.notices).toContain(notice);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("2 pages");
    // #401: the notice rides on top, before section 1 — read before the PDF is opened.
    expect(sent[0]!.text).toContain(`Read it, then send it yourself when you are ready.\n\n${REPORT_LINES.checkBeforeSending}\n- ${notice}\n\n1. The job, in short`);
    expect(sent[0]!.text.split("4. Be ready to explain")[1]).not.toContain(REPORT_LINES.checkBeforeSending);
    // The tightened document is the checkpoint now: the screen's next read and a second press
    // both see the two-page CV, and re-spend nothing.
    const token = cookie.split("=")[1]!;
    const session = (await sessions.getByToken(token))!;
    const stored = (await tailorDrafts.get(session.id, VALID_AD_ID))!;
    expect(stored.draft.experience[0]!.bullets).toHaveLength(2);
    expect(stored.conservationNotices).toContain(notice);
    expect(stored.draftedAt).toBe(view.draftedAt);
    expect(stored.approvedAt).not.toBeNull();
  });

  it("still over after the one re-tailor: ships anyway, says so, never a third model call", async () => {
    const { sent, mailer } = recordingMailer();
    const { llm, prompts } = budgetAwareLlm();
    const { app, claims } = exportServer({
      tailorLlm: llm,
      documentMaker: new StandInDocumentMaker(3),
      mailer,
    });
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "export-still-over@example.com");
    const view = await draftAndRead(app, cookie);
    const res = await post(app, cookie, "/onboarding/tailor/approve", { draftedAt: view.draftedAt });
    const job = await awaitJob(app, cookie, res.json().jobId);
    expect(job.status).toBe("completed");
    expect(prompts).toHaveLength(2);
    const notice = PAGE_NOTICES.stillOver(3, 3);
    expect(job.progress.tailorExport.notices).toContain(notice);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("3 pages");
    expect(sent[0]!.text).toContain(notice);
  });

  it("the re-tailor itself failing is not a hard failure: the measured document ships with its notice", async () => {
    const { sent, mailer } = recordingMailer();
    let calls = 0;
    const base = draftingLlm();
    const flakyLlm: LlmClient = {
      model: "test-fake",
      async complete(prompt) {
        if (++calls > 1) return "not json at all";
        return base.complete(prompt);
      },
    };
    const { app, claims } = exportServer({
      tailorLlm: flakyLlm,
      documentMaker: new StandInDocumentMaker(4),
      mailer,
    });
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "export-tighten-failed@example.com");
    const view = await draftAndRead(app, cookie);
    const res = await post(app, cookie, "/onboarding/tailor/approve", { draftedAt: view.draftedAt });
    const job = await awaitJob(app, cookie, res.json().jobId);
    expect(job.status).toBe("completed");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain(PAGE_NOTICES.notTightened(4));
  });

  it("a print crash after the re-tailor: the second press ships the shortened CV WITH its sentence, no model call (QA D1)", async () => {
    const { sent, mailer } = recordingMailer();
    const { llm, prompts } = budgetAwareLlm();
    // Measures 3, then the browser dies on the shortened document, then measures 2.
    const answers: (number | Error)[] = [3, new Error("browser died"), 2];
    const maker: DocumentMaker = {
      async printCv() {
        const next = answers.shift()!;
        if (next instanceof Error) throw next;
        return { pdf: Buffer.from("%PDF-1.4 counted\n"), pages: next };
      },
    };
    const { app, claims } = exportServer({ tailorLlm: llm, documentMaker: maker, mailer });
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "export-crash-then-press@example.com");
    const view = await draftAndRead(app, cookie);
    const first = await post(app, cookie, "/onboarding/tailor/approve", { draftedAt: view.draftedAt });
    expect((await awaitJob(app, cookie, first.json().jobId)).status).toBe("failed");
    expect(prompts).toHaveLength(2);
    const second = await post(app, cookie, "/onboarding/tailor/approve", { draftedAt: view.draftedAt });
    const job = await awaitJob(app, cookie, second.json().jobId);
    expect(job.status).toBe("completed");
    expect(prompts).toHaveLength(2);
    const notice = PAGE_NOTICES.tightened(3);
    expect(job.progress.tailorExport.notices).toEqual([notice]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain(notice);
  });

  it("a second press after a failed send says the page sentence once, not twice (QA D2)", async () => {
    const { sent, mailer } = recordingMailer();
    const { app, claims } = exportServer({
      tailorLlm: draftingLlm(),
      // No tailorLlm wired for the re-tailor would also do; here the model answers but the
      // stand-in always measures 4, and the mailer fails the first time.
      documentMaker: new StandInDocumentMaker(4),
      mailer: {
        ...mailer,
        sendTailoredCv: (() => {
          let calls = 0;
          return async (email: string, doc: Parameters<Mailer["sendTailoredCv"]>[1]) => {
            if (++calls === 1) throw new Error("mail down");
            await mailer.sendTailoredCv(email, doc);
          };
        })(),
      },
    });
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "export-said-once@example.com");
    const view = await draftAndRead(app, cookie);
    const first = await post(app, cookie, "/onboarding/tailor/approve", { draftedAt: view.draftedAt });
    expect((await awaitJob(app, cookie, first.json().jobId)).status).toBe("failed");
    const second = await post(app, cookie, "/onboarding/tailor/approve", { draftedAt: view.draftedAt });
    const job = await awaitJob(app, cookie, second.json().jobId);
    expect(job.status).toBe("completed");
    const pageSentences = (job.progress.tailorExport.notices as string[]).filter((n) => /pages/.test(n));
    expect(pageSentences).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text.split(pageSentences[0]!)).toHaveLength(2);
  });

  it("#315: over two pages, the report is written about the shortened document that ships", async () => {
    const { sent, mailer } = recordingMailer();
    const { llm: reportLlm, prompts: reportPrompts } = reportingLlm();
    const { llm, prompts } = budgetAwareLlm();
    const { app, claims } = exportServer({
      tailorLlm: llm,
      documentMaker: bulletCountingMaker(),
      mailer,
      reportLlm,
    });
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "report-tightened@example.com");
    const view = await draftAndRead(app, cookie);
    const res = await post(app, cookie, "/onboarding/tailor/approve", { draftedAt: view.draftedAt });
    expect((await awaitJob(app, cookie, res.json().jobId)).status).toBe("completed");
    expect(prompts).toHaveLength(2);
    expect(reportPrompts).toHaveLength(1);
    expect(reportPrompts[0]).toContain("- Ran delivery, part 2\n");
    expect(reportPrompts[0]).not.toContain("Ran delivery, part 3");
    expect(sent[0]!.text).toContain(PAGE_NOTICES.tightened(3));
  });

  it("the budget is a number scaled from the measurement, always below what printed", () => {
    const draftWith = (n: number) =>
      ({ experience: [{ bullets: Array.from({ length: n }, () => ({})) }] }) as unknown as Draft;
    expect(tightenedBulletBudget(draftWith(30), 3)).toEqual({ max: 20, printedBullets: 30, measuredPages: 3 });
    expect(tightenedBulletBudget(draftWith(25), 3)).toEqual({ max: 16, printedBullets: 25, measuredPages: 3 });
    expect(tightenedBulletBudget(draftWith(24), 4)).toEqual({ max: 12, printedBullets: 24, measuredPages: 4 });
  });
});

// #315 — the application report: the email IS the five-section report, written by one call over
// the document that ships, refused on an unjudged card, checkpointed so a re-press re-spends
// nothing. Through the route and the stand-in, like everything above.
describe("#315 the application report", () => {
  it("refuses the press on an unjudged card — nothing slow starts, nothing is sent", async () => {
    const { sent, mailer } = recordingMailer();
    const { llm, prompts } = reportingLlm();
    // No judge wired at all: the card the screen shows is "estimated", the keyword scorer's.
    const { app, claims } = buildServer({
      tailorLlm: draftingLlm(),
      documentMaker: new StandInDocumentMaker(),
      mailer,
      reportLlm: llm,
    });
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "report-unjudged@example.com");
    expect((await get(app, cookie, "/onboarding/tailor")).json().card.scored).toBe("estimated");
    const view = await draftAndRead(app, cookie);
    const res = await post(app, cookie, "/onboarding/tailor/approve", { draftedAt: view.draftedAt });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("card_unjudged");
    expect(sent).toHaveLength(0);
    expect(prompts).toHaveLength(0);
  });

  it("503s honestly when no report model is wired — never an email without its report", async () => {
    const { sent, mailer } = recordingMailer();
    const { app, claims } = buildServer({
      tailorLlm: draftingLlm(),
      documentMaker: new StandInDocumentMaker(),
      mailer,
      judge: fakeJudge(),
    });
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "report-no-model@example.com");
    const view = await draftAndRead(app, cookie);
    const res = await post(app, cookie, "/onboarding/tailor/approve", { draftedAt: view.draftedAt });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("report_unavailable");
    expect(sent).toHaveLength(0);
  });

  it("the email is the five sections in order, from the judged card, the one call and the advert — and the report is checkpointed", async () => {
    const { sent, mailer } = recordingMailer();
    const { llm, prompts } = reportingLlm();
    const tailorDrafts = new InMemoryTailorDraftStore();
    const { app, sessions, claims } = exportServer({
      tailorLlm: draftingLlm(),
      documentMaker: new StandInDocumentMaker(),
      mailer,
      tailorDrafts,
      reportLlm: llm,
    });
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "report-happy@example.com");
    const state = (await get(app, cookie, "/onboarding/tailor")).json();
    expect(state.card.scored).toBe("judged");
    const view = await draftAndRead(app, cookie);

    const res = await post(app, cookie, "/onboarding/tailor/approve", { draftedAt: view.draftedAt });
    expect(res.statusCode).toBe(202);
    const job = await awaitJob(app, cookie, res.json().jobId);
    expect(job.status).toBe("completed");
    expect(sent).toHaveLength(1);
    const text = sent[0]!.text;

    // One call, given the printed line with its source fact and every requirement with a state.
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("- Ran end-to-end delivery for the programme\n  from: Owned delivery from planning through completion.");
    const requirements = loadAdRequirements(FIXTURE_AD_ID)!.requirements;
    for (const r of requirements) expect(prompts[0]).toContain(`- id: ${r.id}\n  state: `);

    // Five sections, in this order; the first opens on the apply line (a found job has none).
    // No notice on this document, so no "Check before you send" heading anywhere (#401).
    expect(text).not.toContain(REPORT_LINES.checkBeforeSending);
    const order = [
      "Read it, then send it yourself when you are ready.\n\n1. The job, in short",
      REPORT_LINES.noLink,
      "Senior Project Manager at Endava Vietnam, Ho Chi Minh City, Vietnam.",
      "2. Where you are strong",
      `${requirements[0]!.requirement} — say: "I have done ${requirements[0]!.id}."`,
      "3. Where you are not, and what to say",
      `${requirements[1]!.requirement} — say: "I have done the nearest thing to ${requirements[1]!.id}."`,
      `${requirements[2]!.requirement} — ${REPORT_LINES.expectIt}`,
      "4. Be ready to explain",
      "The steering line carries two facts.",
      // #292 r9: Vietnam is placeable, the advert does not ask about work rights, he holds no fact.
      REPORT_LINES.market("Vietnam"),
      "5. Salary",
      REPORT_LINES.noSalary,
    ];
    expect(text).not.toContain(REPORT_LINES.locationUnknown);
    const positions = order.map((line) => {
      const i = text.indexOf(line);
      expect(i, line).toBeGreaterThanOrEqual(0);
      return i;
    });
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(text).not.toMatch(/6\. |Verification|Checklist|Keyword coverage/);

    // Checkpointed on the record, so a second press re-spends nothing.
    const token = cookie.split("=")[1]!;
    const session = (await sessions.getByToken(token))!;
    const stored = (await tailorDrafts.get(session.id, VALID_AD_ID))!;
    expect(stored.reportCheckpoint?.report.strong).toHaveLength(1);
    const again = await post(app, cookie, "/onboarding/tailor/approve", { draftedAt: view.draftedAt });
    expect((await awaitJob(app, cookie, again.json().jobId)).status).toBe("completed");
    expect(prompts).toHaveLength(1);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.text).toBe(text);
  });

  it("a denied requirement is a gap with a sentence; its years bars the card could not test are unchecked, with none", async () => {
    const { sent, mailer } = recordingMailer();
    const { llm } = reportingLlm();
    const { app, claims } = exportServer({
      tailorLlm: draftingLlm(),
      documentMaker: new StandInDocumentMaker(),
      mailer,
      reportLlm: llm,
    });
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "report-denied@example.com");
    // The first requirement the answer door takes is denied — the card's own "You told me you
    // don't have this" row, which the report must carry as a gap and never as a strength.
    let denied: { id: string; requirement: string } | undefined;
    for (const requirement of loadAdRequirements(FIXTURE_AD_ID)!.requirements) {
      const answered = await post(app, cookie, "/onboarding/tailor/answer", { requirementId: requirement.id, answer: "No" });
      if (answered.statusCode === 200) {
        denied = requirement;
        break;
      }
    }
    const state = (await get(app, cookie, "/onboarding/tailor")).json();
    expect(state.card.askedClosed).toHaveLength(1);
    // No readable work history in this walk: the advert's two years bars are "not tested".
    expect(state.card.notTested?.length).toBe(2);
    const view = await draftAndRead(app, cookie);
    const res = await post(app, cookie, "/onboarding/tailor/approve", { draftedAt: view.draftedAt });
    expect((await awaitJob(app, cookie, res.json().jobId)).status).toBe("completed");
    const text = sent[0]!.text;
    const strong = text.split("2. Where you are strong")[1]!.split("3. Where you are not")[0]!;
    expect(strong).not.toContain(denied!.requirement);
    expect(text).toContain(`${denied!.requirement} — say: "I have done the nearest thing to ${denied!.id}."`);
    for (const bar of state.card.notTested as { requirement: string }[]) {
      expect(text).toContain(`- ${bar.requirement} — ${REPORT_LINES.unchecked}`);
      expect(text).not.toContain(`${bar.requirement} — say:`);
    }
  });

});
