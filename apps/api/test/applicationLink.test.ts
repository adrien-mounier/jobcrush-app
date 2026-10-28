// #306 — the apply row's server half: the link an advert carried, and the one way a link reaches an
// advert that carried none.
//
// Driven through the same seams the screen drives, for the reason the spec's own test rule gives:
// paste an advert, open the job, press the control, open it again. Nothing here asserts that a store
// method was called — every claim is "what the job's own screen is handed afterwards".
//
// What a test here CANNOT prove is that any of it reaches a person: these are payload assertions, and
// a payload assertion passes perfectly well while the screen renders nothing. The render proof is
// apps/web/e2e/job-screen-journey.mjs.
import { describe, expect, it, vi } from "vitest";
import { AdRequirementsV1 } from "@jobcrush/contracts";
import { buildDeckServer } from "./fixtureDeck.js";
import { InMemoryJobStore } from "../src/jobs.js";
import { InMemoryPasteRecordStore } from "../src/pasteRecordStore.js";
import { InMemoryPostingStore } from "../src/postingStore.js";
import { makeBroughtJobs } from "../src/broughtJobs.js";
import type { JobRecord } from "../src/jobs.js";
import type { PasteProgress } from "../src/routes/paste.js";
import type { Posting } from "../src/preview.js";

const ROLE = "IT project manager in Hong Kong";
const LINK = "https://careers.gradion.example/apply/1";
const OTHER_LINK = "https://jobs.example.org/roles/9";

const advert = (title: string) =>
  [
    title,
    "Gradion — Hong Kong",
    "",
    "We are looking for a delivery lead to run a portfolio of technology programmes across APAC.",
    "You will coordinate business and technical stakeholders, hold the plan, and report to the",
    "steering committee every fortnight.",
  ].join("\n");

const PASTED = advert("Senior Project Manager");

function linkServer() {
  const readPastedAdvert = vi.fn(async (text: string) => ({
    title: text.split("\n")[0]!.trim(),
    titleSource: "stated" as const,
    company: "Gradion",
    location: "Hong Kong",
    closingDate: null,
  }));
  const readAd = vi.fn(
    async (posting: Posting): Promise<AdRequirementsV1> =>
      AdRequirementsV1.parse({
        schemaVersion: "1",
        adId: posting.id,
        curated: false,
        language: "en",
        familyFit: { family: "it-project-delivery", confidence: 0.9 },
        requirements: [
          {
            id: "stakeholders",
            band: "essential",
            kind: "ordinary",
            requirement: "Coordinate business and technical stakeholders",
            sourceSpan: "coordinate business and technical stakeholders",
          },
        ],
      }),
  );
  const postings = new InMemoryPostingStore();
  const pasteRecords = new InMemoryPasteRecordStore();
  const built = buildDeckServer({ readPastedAdvert, readAd, postings, pasteRecords, store: new InMemoryJobStore() });
  return { ...built, postings, pasteRecords };
}

type App = ReturnType<typeof linkServer>["app"];

async function anonSession(app: App): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/sessions/anonymous" });
  return `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
}

const post = (app: App, cookie: string, url: string, payload?: unknown) =>
  app.inject({ method: "POST", url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });

/** Paste an advert and wait out the read behind it (the route answers 202 and narrates — #304). */
async function paste(app: App, cookie: string, text: string, applicationUrl?: string): Promise<string> {
  const started = await post(app, cookie, "/onboarding/paste", {
    text,
    ...(applicationUrl === undefined ? {} : { applicationUrl }),
  });
  expect(started.statusCode).toBe(202);
  const { jobId } = started.json();
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const job = (await app.inject({ method: "GET", url: `/jobs/${jobId}`, headers: { cookie } })).json() as JobRecord;
    if (job.status === "completed" || job.status === "failed") {
      const progress = (job.progress as { paste?: PasteProgress }).paste ?? null;
      if (!progress?.result) throw new Error(`the paste failed: ${JSON.stringify(progress?.failure)}`);
      return progress.result.adId;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("the paste job never finished");
}

/** The card the job's own screen is handed. */
async function jobCard(app: App, cookie: string, adId: string) {
  const res = await app.inject({
    method: "GET",
    url: `/onboarding/jobs/${encodeURIComponent(adId)}`,
    headers: { cookie },
  });
  expect(res.statusCode).toBe(200);
  return res.json().card as { adId: string; applicationUrl?: string };
}

const addLink = (app: App, cookie: string, adId: string, applicationUrl: string) =>
  app.inject({
    method: "PUT",
    url: `/onboarding/jobs/${encodeURIComponent(adId)}/application-link`,
    headers: { cookie },
    payload: { applicationUrl },
  });

async function readyToPaste(app: App): Promise<string> {
  const cookie = await anonSession(app);
  await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
  return cookie;
}

describe("#306 where to apply, on the job's own screen", () => {
  it("carries the link he gave the paste door", async () => {
    const { app } = linkServer();
    const cookie = await readyToPaste(app);
    const adId = await paste(app, cookie, PASTED, LINK);
    expect((await jobCard(app, cookie, adId)).applicationUrl).toBe(LINK);
  });

  it("says nothing at all when the advert carried no link, rather than an empty one", async () => {
    const { app } = linkServer();
    const cookie = await readyToPaste(app);
    const adId = await paste(app, cookie, PASTED);
    // Absent, not "" or null: the field is optional and additive, and its absence is exactly what
    // the apply row's empty state answers with a control.
    expect((await jobCard(app, cookie, adId)).applicationUrl).toBeUndefined();
  });

  it("lets him add one afterwards, and the job's own screen has it from then on", async () => {
    const { app } = linkServer();
    const cookie = await readyToPaste(app);
    const adId = await paste(app, cookie, PASTED);

    const added = await addLink(app, cookie, adId, LINK);
    expect(added.statusCode).toBe(200);
    expect(added.json().applicationUrl).toBe(LINK);
    expect((await jobCard(app, cookie, adId)).applicationUrl).toBe(LINK);
  });

  it("refuses a link that is not a web address", async () => {
    const { app } = linkServer();
    const cookie = await readyToPaste(app);
    const adId = await paste(app, cookie, PASTED);

    for (const bad of ["javascript:alert(1)", "careers.example.com", "ftp://files.example.com", ""]) {
      expect((await addLink(app, cookie, adId, bad)).statusCode).toBe(400);
    }
    expect((await jobCard(app, cookie, adId)).applicationUrl).toBeUndefined();
  });

  it("never replaces a link he already gave — it says so and shows what is there", async () => {
    const { app } = linkServer();
    const cookie = await readyToPaste(app);
    const adId = await paste(app, cookie, PASTED, LINK);

    const second = await addLink(app, cookie, adId, OTHER_LINK);
    expect(second.statusCode).toBe(409);
    expect(second.json().applicationUrl).toBe(LINK); // what is actually there, not just a refusal
    expect((await jobCard(app, cookie, adId)).applicationUrl).toBe(LINK);
  });

  it("refuses to write to an advert this person never brought in", async () => {
    const { app } = linkServer();
    const mine = await readyToPaste(app);
    const adId = await paste(app, mine, PASTED);

    // Somebody else, who happens to know the id — it is a hash of (company, location, title), so
    // anyone who has seen the job can compute it. Reading is scoped; writing has to be too.
    const stranger = await readyToPaste(app);
    expect((await addLink(app, stranger, adId, OTHER_LINK)).statusCode).toBe(404);
    expect((await jobCard(app, mine, adId)).applicationUrl).toBeUndefined();
  });

});

// #448 — each person keeps their own apply link. A copied link often carries a tracking or referral
// code tied to whoever copied it, so one person's link never reaches another person's screen.
describe("#448 each person keeps their own apply link", () => {
  it("two people paste the same advert with two links: each sees their own", async () => {
    const { app } = linkServer();
    const a = await readyToPaste(app);
    const b = await readyToPaste(app);
    const adId = await paste(app, a, PASTED, LINK);
    expect(await paste(app, b, PASTED, OTHER_LINK)).toBe(adId);
    expect((await jobCard(app, a, adId)).applicationUrl).toBe(LINK);
    expect((await jobCard(app, b, adId)).applicationUrl).toBe(OTHER_LINK);
  });

  it("the application email reads the same per-person link: broughtJobs is the one place both read", async () => {
    // applicationReport.ts's reportContext prints `broughtJob.applicationUrl`, the job this resolves.
    const { app, postings, pasteRecords, sessions } = linkServer();
    const a = await readyToPaste(app);
    const b = await readyToPaste(app);
    await paste(app, a, PASTED, LINK);
    await paste(app, b, PASTED, OTHER_LINK);
    const brought = makeBroughtJobs({ postings, pasteRecords });
    const idOf = async (cookie: string) => (await sessions.getByToken(cookie.split("=")[1]!))!.id;
    expect((await brought(await idOf(a)))[0]!.applicationUrl).toBe(LINK);
    expect((await brought(await idOf(b)))[0]!.applicationUrl).toBe(OTHER_LINK);
  });

  it("another person's link is never lent to someone who gave none — they can add their own", async () => {
    const { app } = linkServer();
    const a = await readyToPaste(app);
    const b = await readyToPaste(app);
    const adId = await paste(app, a, PASTED, LINK);
    expect(await paste(app, b, PASTED)).toBe(adId);
    expect((await jobCard(app, b, adId)).applicationUrl).toBeUndefined();

    // The control is offered to B whoever else pasted the job, and writes to B's record only.
    const added = await addLink(app, b, adId, OTHER_LINK);
    expect(added.statusCode).toBe(200);
    expect((await jobCard(app, b, adId)).applicationUrl).toBe(OTHER_LINK);
    expect((await jobCard(app, a, adId)).applicationUrl).toBe(LINK);
  });

  it("a link added on the job's screen is not shared with the next person", async () => {
    const { app } = linkServer();
    const a = await readyToPaste(app);
    const adId = await paste(app, a, PASTED);
    expect((await addLink(app, a, adId, LINK)).statusCode).toBe(200);

    const b = await readyToPaste(app);
    expect(await paste(app, b, PASTED)).toBe(adId);
    expect((await jobCard(app, b, adId)).applicationUrl).toBeUndefined();
  });

  it("the same person pasting again: their latest link wins, and a re-paste with none keeps it", async () => {
    const { app } = linkServer();
    const a = await readyToPaste(app);
    const adId = await paste(app, a, PASTED, LINK);
    await paste(app, a, PASTED, OTHER_LINK);
    expect((await jobCard(app, a, adId)).applicationUrl).toBe(OTHER_LINK);
    await paste(app, a, PASTED, "");
    expect((await jobCard(app, a, adId)).applicationUrl).toBe(OTHER_LINK);
  });
});
