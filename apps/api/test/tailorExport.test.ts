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
import { exportGate, exportEmailText } from "../src/tailorExport.js";
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
    const { app, claims } = buildServer({ tailorLlm: draftingLlm() });
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
    const { app, claims } = buildServer({
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
    const { app, claims } = buildServer({
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
    const { app, sessions, claims } = buildServer({
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
    const { app, sessions, claims } = buildServer({
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
    const { app, sessions, claims } = buildServer({
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
    const { app, claims } = buildServer({
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
    const { app, claims } = buildServer({
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

  it("ship-and-tell: the lossy draft's notices travel into the email text", () => {
    const text = exportEmailText(
      {
        html: "",
        notices: ["Your languages could not be placed on this draft."],
        posting: { id: "x", title: "PM", company: "Acme", location: "", excerpt: "" },
        email: "x@example.com",
      },
      2,
    );
    expect(text).toContain("Before you send it, check this:");
    expect(text).toContain("Your languages could not be placed on this draft.");
  });
});
