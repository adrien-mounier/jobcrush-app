// #390 (ADR-0019) — Preview as CV: the master CV tailored to the person's own job, observed
// through the API boundary. The engine (preview.ts) and its binding to a job ad (tailorDraft.ts)
// stay covered by their own files; what this file pins is the profile door's hold lines, the
// choice of the person's own job, the one-call checkpoint, the letterhead on the page, and the
// download's server-side gate.
import { describe, expect, it } from "vitest";
import type { CandidateClaim, MinedJobBlock } from "@jobcrush/contracts";
import { buildServer } from "../src/server.js";
import { IT_PROJECT_DELIVERY_PLACEMENT } from "./placedServer.js";
import { InMemoryJobBlockStore } from "../src/jobBlockStore.js";
import { InMemoryTailorDraftStore } from "../src/tailorDraftStore.js";
import { StandInDocumentMaker } from "../src/documentMaker.js";
import { InMemoryJobStore, type JobStore } from "../src/jobs.js";
import type { LlmClient } from "../src/llm.js";
import { CV_PREVIEW_AD_ID, ownJob } from "../src/cvPreview.js";

type App = ReturnType<typeof buildServer>["app"];
const get = (app: App, cookie: string, url: string) => app.inject({ method: "GET", url, headers: { cookie } });
const post = (app: App, cookie: string, url: string, payload?: unknown) =>
  app.inject({ method: "POST", url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });

async function anonSession(app: App): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/sessions/anonymous" });
  return `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
}

const decision = (value: string) => ({ value, source_quote: value, machine_touch: "verbatim" as const, classification: "Verified" as const });
/** A dated job record, as cvReview.test.ts seeds them. */
function block(
  id: string,
  employer: string,
  title: string,
  start: { year: number; month: number | null },
  end: MinedJobBlock["end"]["value"],
): MinedJobBlock {
  return {
    id,
    employer: decision(employer),
    title: decision(title),
    start: {
      value: { ...start, precision: start.month === null ? "year" : "month" },
      source_quote: String(start.year),
      machine_touch: "verbatim",
      classification: "Verified",
    },
    end:
      end.state === "unknown"
        ? { value: end, source_quote: null, machine_touch: "inferred", classification: "Derived" }
        : { value: end, source_quote: "x", machine_touch: "verbatim", classification: "Verified" },
    kind: decision("job") as MinedJobBlock["kind"],
  };
}
const ended = (year: number, month = 6) => ({ state: "ended" as const, date: { year, month, precision: "month" as const } });
const ONGOING = { state: "ongoing" as const };

const claim = (id: string, text: string): CandidateClaim => ({
  id,
  semantic_key: null,
  field_key: null,
  field_value: null,
  field_label: null,
  role: "profile",
  text,
  machine_touch: "verbatim",
  classification: "Verified",
  source_quote: text,
  needs_grill: false,
  grill_hint: null,
});

/** A fake tailor model: cites the first claim id read off the prompt, carries the letterhead's
 *  name through as the real tailor must (preview-tailor.md rule 3), and counts its calls. */
function tailorFake() {
  const prompts: string[] = [];
  const llm: LlmClient = {
    model: "test-fake",
    async complete(prompt: string): Promise<string> {
      prompts.push(prompt);
      const claimsBlock = prompt.split("Claims:\n")[1] ?? "";
      const ids = [...claimsBlock.matchAll(/^- ([a-z0-9][a-z0-9-]*) \[/gm)].map((m) => m[1]!);
      const header = (/===CANDIDATE-HEADER===\n([\s\S]*?)\n\n/.exec(prompt) ?? [, ""])[1]!.trim();
      const [name = "Test Person", ...rest] = header === "(none captured)" ? [] : header.split("\n");
      // The role as the stored job record states it (the prompt's own Roles: block) — a fake that
      // hardcoded one would trip the lint's role check the moment a test corrects the job.
      const role = /^Roles:\n- (.+?) at (.+?) \(/m.exec(prompt);
      return JSON.stringify({
        name,
        headline: "IT Project Manager",
        contact: rest.join(" · "),
        summary: "Delivery-accountable project manager.",
        experience: [
          {
            role: role?.[1] ?? "IT Project Manager",
            employer: role?.[2] ?? "Nordic Retail Group",
            location: "",
            dates: "2021 - Present",
            bullets: [{ text: "Ran end-to-end delivery for the programme", claimIds: [ids[0]!], outcome: "" }],
            // Every other claim held back by name, as the real tailor must — an uncited claim is
            // a silent drop the lint would send round the retry (a second, counted call).
            unprinted: ids.slice(1),
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

async function awaitJob(app: App, cookie: string, jobId: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const job = (await get(app, cookie, `/jobs/${jobId}`)).json();
    if (job.status === "completed" || job.status === "failed") return job;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("preview job never settled");
}

/** Asks for the preview and waits it out — what the screen does over SSE. */
async function makePreview(app: App, cookie: string) {
  const started = await post(app, cookie, "/profile/cv-preview");
  if (started.statusCode === 202) await awaitJob(app, cookie, started.json().jobId);
  return started;
}

/** A session with facts and the given job records (no CV brought, so check mode never applies). */
async function withJobs(blocks: MinedJobBlock[], placements: Record<string, typeof IT_PROJECT_DELIVERY_PLACEMENT> = {}, store?: JobStore) {
  const fake = tailorFake();
  const jobBlocks = new InMemoryJobBlockStore();
  const tailorDrafts = new InMemoryTailorDraftStore();
  const server = buildServer({ store, jobBlocks, tailorDrafts, tailorLlm: fake.llm, documentMaker: new StandInDocumentMaker() });
  const { app, claims } = server;
  const cookie = await anonSession(app);
  const sessionId = (await get(app, cookie, "/sessions/me")).json().id as string;
  await claims.add(sessionId, claim("delivery", "Owned delivery from planning through completion."));
  if (blocks.length > 0) await jobBlocks.ingest(sessionId, { schemaVersion: "1", blocks }, "{}");
  for (const [blockId, placement] of Object.entries(placements)) await jobBlocks.label(sessionId, blockId, placement);
  return { ...server, cookie, sessionId, jobBlocks, tailorDrafts, prompts: fake.prompts };
}

describe("#390 the profile's Preview as CV door — held, with one line saying why", () => {
  it("with no job on the profile the door is held and the preview refused", async () => {
    const { app, cookie } = await withJobs([]);
    expect((await get(app, cookie, "/profile")).json().cvPreviewHold).toBe("Your profile has no job yet.");
    const refused = await post(app, cookie, "/profile/cv-preview");
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe("no_job");
    expect((await get(app, cookie, "/profile/cv-preview")).statusCode).toBe(409);
  });

  it("with a job the door is open", async () => {
    const { app, cookie } = await withJobs([block("nrg", "Nordic Retail Group", "IT Project Manager", { year: 2021, month: 3 }, ONGOING)]);
    expect((await get(app, cookie, "/profile")).json().cvPreviewHold).toBeNull();
  });
});

describe("#390 ownJob — the person's own job: current first, then the most recent", () => {
  /** The records as the store serves them (JobBlockView), never a hand-shaped view. */
  async function views(blocks: MinedJobBlock[]) {
    const store = new InMemoryJobBlockStore();
    await store.init();
    await store.ingest("s", { schemaVersion: "1", blocks }, "{}");
    return store.list("s");
  }

  it("a current job beats every past one, however recent the past one ended", async () => {
    const past = block("p", "Past Co", "Head of Delivery", { year: 2022, month: 1 }, ended(2025, 9));
    const current = block("c", "Now Co", "IT Project Manager", { year: 2019, month: 1 }, ONGOING);
    expect(ownJob(await views([past, current]))?.id).toBe("c");
  });

  it("of two current jobs, the one started latest wins", async () => {
    const older = block("o", "Old Co", "Coordinator", { year: 2019, month: 5 }, ONGOING);
    const newer = block("n", "New Co", "IT Project Manager", { year: 2023, month: 2 }, ONGOING);
    expect(ownJob(await views([older, newer]))?.id).toBe("n");
    // Same year: the month decides; a month-less date reads as January.
    const jan = block("j", "Jan Co", "A", { year: 2023, month: null }, ONGOING);
    const may = block("m", "May Co", "B", { year: 2023, month: 5 }, ONGOING);
    expect(ownJob(await views([jan, may]))?.id).toBe("m");
  });

  it("with no current job, the one that ended last wins; an unknown end counts after every known one", async () => {
    const early = block("e", "Early Co", "A", { year: 2015, month: 1 }, ended(2018));
    const late = block("l", "Late Co", "B", { year: 2010, month: 1 }, ended(2020));
    const unknown = block("u", "Unknown Co", "C", { year: 2021, month: 1 }, { state: "unknown" });
    expect(ownJob(await views([early, unknown, late]))?.id).toBe("l");
    expect(ownJob(await views([unknown]))?.id).toBe("u");
  });

  it("education and other non-job records are never the person's job", async () => {
    const degree = { ...block("d", "Uni", "MSc", { year: 2010, month: 9 }, ended(2012)), kind: decision("education") as MinedJobBlock["kind"] };
    expect(ownJob(await views([degree]))).toBeNull();
    expect(ownJob([])).toBeNull();
  });
});

describe("#390 check mode holds the door until it is finished", () => {
  it("a brought CV whose check mode is open holds the door; finishing it opens the door", async () => {
    const jobBlocks = new InMemoryJobBlockStore();
    const { app, claims } = buildServer({
      jobBlocks,
      tailorLlm: tailorFake().llm,
      pipeline: { mine: async () => ({ doc: null, claims: [claim("delivery", "Owned delivery.")], roles: 1, needsGrill: 0 }) },
    });
    const cookie = await anonSession(app);
    const sessionId = (await get(app, cookie, "/sessions/me")).json().id as string;
    const cvText = [
      "Jane Doe",
      "IT Project Manager, Nordic Retail Group, Mar 2021 - Present",
      "- Owned delivery from planning through completion.",
      "- Weekly steering updates.",
    ].join("\n");
    const { jobId } = (await post(app, cookie, "/cv/paste", { text: cvText })).json();
    await awaitJob(app, cookie, jobId);
    await claims.add(sessionId, claim("delivery-2", "Owned delivery from planning through completion."));
    await jobBlocks.ingest(sessionId, { schemaVersion: "1", blocks: [block("nrg", "Nordic Retail Group", "IT Project Manager", { year: 2021, month: 3 }, ONGOING)] }, "{}");

    expect((await get(app, cookie, "/profile")).json().cvPreviewHold).toBe("Finish checking your CV first.");
    const refused = await post(app, cookie, "/profile/cv-preview");
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe("check_mode_open");

    expect((await post(app, cookie, "/review/complete")).json()).toEqual({ completed: true });
    expect((await get(app, cookie, "/profile")).json().cvPreviewHold).toBeNull();
    expect((await post(app, cookie, "/profile/cv-preview")).statusCode).toBe(202);
  });
});

describe("#390 the preview is made once, kept, and remade only when its inputs change", () => {
  const NRG = block("nrg", "Nordic Retail Group", "IT Project Manager", { year: 2021, month: 3 }, ONGOING);
  const BSH = block("bsh", "Baltic Software House", "Project Coordinator", { year: 2017, month: 1 }, ended(2020));

  it("one model call makes it; opening it again makes none; the page names the job it was tailored for", async () => {
    const s = await withJobs([BSH, NRG]);
    expect((await get(s.app, s.cookie, "/profile/cv-preview")).statusCode).toBe(404);
    expect((await makePreview(s.app, s.cookie)).statusCode).toBe(202);
    expect(s.prompts).toHaveLength(1);
    // The current job, not the past one, is the one applied for.
    expect(s.prompts[0]).toContain("===JOB-POSTING===\nIT Project Manager at Nordic Retail Group");

    expect((await post(s.app, s.cookie, "/profile/cv-preview")).json()).toEqual({ ready: true });
    const page = (await get(s.app, s.cookie, "/profile/cv-preview")).json();
    expect(page.job).toEqual({ title: "IT Project Manager", employer: "Nordic Retail Group" });
    expect(page.html).toContain("<h1>");
    expect(page.html).not.toContain("DRAFT");
    expect(s.prompts).toHaveLength(1);
  });

  it("a change to the profile's facts remakes it once; the saved letterhead and the job change it too", async () => {
    const s = await withJobs([NRG]);
    await makePreview(s.app, s.cookie);
    expect(s.prompts).toHaveLength(1);

    await s.claims.add(s.sessionId, claim("budget", "Managed a budget of EUR 1.2M."));
    expect((await get(s.app, s.cookie, "/profile/cv-preview")).statusCode).toBe(404); // outgrown
    await makePreview(s.app, s.cookie);
    await makePreview(s.app, s.cookie);
    expect(s.prompts).toHaveLength(2);

    await s.app.inject({ method: "PUT", url: "/contact", headers: { cookie: s.cookie }, payload: { field: "name", value: "Jane Dubois" } });
    await makePreview(s.app, s.cookie);
    expect(s.prompts).toHaveLength(3);

    await s.jobBlocks.correct(s.sessionId, "nrg", "title", "Head of Delivery");
    await makePreview(s.app, s.cookie);
    expect(s.prompts).toHaveLength(4);
    expect(s.prompts[3]).toContain("===JOB-POSTING===\nHead of Delivery at Nordic Retail Group");
  });

  it("a second ask while the first is still being made joins it — one call, not two", async () => {
    const s = await withJobs([NRG]);
    const [a, b] = await Promise.all([post(s.app, s.cookie, "/profile/cv-preview"), post(s.app, s.cookie, "/profile/cv-preview")]);
    expect(a.json().jobId).toBe(b.json().jobId);
    await awaitJob(s.app, s.cookie, a.json().jobId);
    expect(s.prompts).toHaveLength(1);
  });

  it("a job store that fails to open the run leaves the next ask free to try again — never a reservation that fails for ever", async () => {
    const store = new InMemoryJobStore();
    const create = store.create.bind(store);
    let failOnce = true;
    store.create = async (...args) => {
      if (failOnce) {
        failOnce = false;
        throw new Error("the job store is away");
      }
      return create(...args);
    };
    const s = await withJobs([NRG], {}, store);
    expect((await post(s.app, s.cookie, "/profile/cv-preview")).statusCode).toBe(500);
    expect((await makePreview(s.app, s.cookie)).statusCode).toBe(202);
    expect(s.prompts).toHaveLength(1);
    expect((await post(s.app, s.cookie, "/profile/cv-preview")).json()).toEqual({ ready: true });
  });

  it("the job's family must-haves are the advert tests; a job placed in no family is tailored to its title alone", async () => {
    const placed = await withJobs([NRG], { nrg: IT_PROJECT_DELIVERY_PLACEMENT });
    await makePreview(placed.app, placed.cookie);
    expect(placed.prompts[0]).toContain("===ADVERT-TESTS===");
    // ADR-0019 clause 5: the must-haves ARE the requirements — the family's scope sentence is a
    // labeler description, not a job ad, and never reaches the tailor as one.
    expect(placed.prompts[0]).not.toContain("Running the delivery of technology work");
    const unplaced = await withJobs([NRG]);
    await makePreview(unplaced.app, unplaced.cookie);
    expect(unplaced.prompts[0]).not.toContain("===ADVERT-TESTS===");
    expect(unplaced.prompts[0]).toContain("===JOB-POSTING===\nIT Project Manager at Nordic Retail Group");
  });
});

describe("#390 the letterhead and the download", () => {
  const NRG = block("nrg", "Nordic Retail Group", "IT Project Manager", { year: 2021, month: 3 }, ONGOING);

  it("the page prints the letterhead from the saved Your details fields", async () => {
    const s = await withJobs([NRG]);
    await s.app.inject({
      method: "PUT",
      url: "/contact",
      headers: { cookie: s.cookie },
      payload: { fields: { name: "Jane Dubois", location: "Lyon, France", email: "jane@example.com", phone: "+33 6 00 00 00 00" } },
    });
    await makePreview(s.app, s.cookie);
    expect(s.prompts[0]).toContain("===CANDIDATE-HEADER===\nJane Dubois\nLyon, France · +33 6 00 00 00 00 · jane@example.com\n");
    const { html } = (await get(s.app, s.cookie, "/profile/cv-preview")).json();
    expect(html).toContain("<h1>Jane Dubois</h1>");
    expect(html).toContain("jane@example.com");
    expect(html).toContain("+33 6 00 00 00 00");
  });

  it("Download PDF hands back the document maker's PDF, named after the person", async () => {
    const s = await withJobs([NRG]);
    await s.app.inject({ method: "PUT", url: "/contact", headers: { cookie: s.cookie }, payload: { field: "name", value: "Jane Dubois" } });
    await makePreview(s.app, s.cookie);
    const res = await get(s.app, s.cookie, "/profile/cv-preview/pdf");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="CV - Jane Dubois.pdf"');
    expect(res.body.startsWith("%PDF-")).toBe(true);
  });

  it("the download is refused when the stored document states a denied capability (the conservation gate)", async () => {
    const s = await withJobs([NRG]);
    await s.claims.answerNegative(s.sessionId, claim("discovery-budget", "Not applicable — Have you owned a project budget?"));
    await makePreview(s.app, s.cookie);
    expect((await get(s.app, s.cookie, "/profile/cv-preview/pdf")).statusCode).toBe(200);
    // The shape only store corruption can produce: the engine never checkpoints a fatal draft.
    const stored = (await s.tailorDrafts.get(s.sessionId, CV_PREVIEW_AD_ID))!;
    await s.tailorDrafts.put(s.sessionId, CV_PREVIEW_AD_ID, {
      ...stored,
      draft: { ...stored.draft, summary: `${stored.draft.summary} Have you owned a project budget?` },
    });
    const refused = await get(s.app, s.cookie, "/profile/cv-preview/pdf");
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe("lint_failed");
  });

  it("no preview yet means nothing to download — a 404, never an empty file", async () => {
    const s = await withJobs([NRG]);
    const res = await get(s.app, s.cookie, "/profile/cv-preview/pdf");
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("no_preview");
  });
});
