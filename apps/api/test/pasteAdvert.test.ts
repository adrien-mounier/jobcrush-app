// #303/#304 — the paste door, driven through the API the way the web client drives it (spec #301's
// primary seam). Everything a person can perceive is observable here: an advert pasted and read, a
// reading reused on the second paste, two people sharing one reading, a closing date kept, the deck
// unchanged by a paste, and the landing being that job's own screen.
//
// #304 made the read a JOB. The route answers 202 with a job id and the work runs behind it,
// because three named steps can only be watched by a screen that is told about them WHILE the read
// happens. Every test below therefore drives the paste through `paste()`, which drains that job to
// its end — and the step sequence itself is observable because the server is built on a job store
// that records every progress write (`recordingJobs`).
//
// What is deliberately NOT here, because it belongs to a later slice: the deck stitching, pinning,
// freshness exemptions and ageing line (#305), the job screen's own four changes (#306). The SCREEN
// side of #304 — that the steps and the failure lines actually reach a rendered page — is
// apps/web/e2e/paste-wait-journey.mjs, because a payload assertion here passes while the screen
// stays blank.
import { describe, expect, it, vi } from "vitest";
import { AdRequirementsV1 } from "@jobcrush/contracts";
import { buildDeckServer, injectSettled } from "./fixtureDeck.js";
import { InMemoryJobStore, type JobRecord, type JobStore } from "../src/jobs.js";
import type { PasteProgress } from "../src/routes/paste.js";
import { advertFingerprint, linkInText, makePastedAdvertReader } from "../src/pastedAdvert.js";
import { PASTED_SOURCE_PROVIDER_ID } from "../src/postingRetrieval.js";
import { InMemoryPostingStore } from "../src/postingStore.js";
import { InMemoryPasteRecordStore } from "../src/pasteRecordStore.js";
import type { Posting } from "../src/preview.js";
import type { LlmClient } from "../src/llm.js";

const ADVERT = [
  "Senior Project Manager — Gradion",
  "Hong Kong",
  "",
  "We are looking for a delivery lead to run a portfolio of technology programmes across APAC.",
  "You will coordinate business and technical stakeholders, hold the plan, and report to the",
  "steering committee. Applications close 15 October 2026.",
].join("\n");

/** A second, genuinely different advert — same shape, different words, so it fingerprints apart. */
const OTHER_ADVERT = ADVERT.replace("Senior Project Manager", "Delivery Manager").replace(
  "Gradion",
  "Northwind",
);

const HEADER = {
  title: "Senior Project Manager",
  company: "Gradion",
  location: "Hong Kong",
  closingDate: "2026-10-15",
};

/** Parsed through the real contract on the way out, deliberately. QA found this fixture carrying
 *  `band: "desirable"` — a value `RankBand` does not have ("essential" | "standard" |
 *  "nice-to-have"; "desirable" is the word the CARD prints) — and every test here still passed,
 *  because a hand-built object handed straight to `readAd` is never validated. A fixture the
 *  product would reject is a test proving nothing; this makes that failure loud and immediate. */
function requirementsFor(posting: Posting): AdRequirementsV1 {
  return AdRequirementsV1.parse({
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
      {
        id: "steering",
        band: "standard",
        kind: "ordinary",
        requirement: "Report to a steering committee",
        sourceSpan: "report to the steering committee",
      },
    ],
  });
}

/** A job store that keeps every `progress.paste` it is ever handed, in order.
 *
 *  Delegating by hand rather than spreading the instance: InMemoryJobStore's methods live on its
 *  prototype, so `{ ...store, update }` would produce an object with no `create` and no
 *  `subscribe`. The recording is the only reason this exists — #304's whole claim is about the
 *  ORDER things are published in, and polling the job cannot see a step that came and went.  */
function recordingJobs(): { store: JobStore; writes: PasteProgress[] } {
  const inner = new InMemoryJobStore();
  const writes: PasteProgress[] = [];
  const store: JobStore = {
    create: (type, sessionId) => inner.create(type, sessionId),
    get: (id) => inner.get(id),
    subscribe: (id, listener) => inner.subscribe(id, listener),
    update: (id, patch) => {
      const paste = (patch.progress as { paste?: PasteProgress } | undefined)?.paste;
      if (paste) writes.push(structuredClone(paste));
      return inner.update(id, patch);
    },
  };
  return { store, writes };
}

/** A server with the paste door wired: a stub advert reader (one call per unread advert, counted)
 *  and the deck's own reader answering for whatever it produces. */
function pasteServer(header: typeof HEADER | null = HEADER) {
  const readPastedAdvert = vi.fn(async () => header);
  const readAd = vi.fn(async (posting: Posting) => requirementsFor(posting));
  const postings = new InMemoryPostingStore();
  const pasteRecords = new InMemoryPasteRecordStore();
  // #304: what the employer step really does. Deliberately a counting fake rather than absent —
  // "one cached lookup" is a claim about how many times this is called, and an unwired seam cannot
  // prove a number.
  const employerLookup = vi.fn(async (employer: string) => `${employer} is a fake company.`);
  const { store, writes } = recordingJobs();
  const built = buildDeckServer({ readPastedAdvert, readAd, postings, pasteRecords, employerLookup, store });
  return { ...built, readPastedAdvert, readAd, postings, pasteRecords, employerLookup, writes };
}

async function anonSession(app: ReturnType<typeof pasteServer>["app"]): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/sessions/anonymous" });
  return `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
}

/** What a finished paste produced: the 202 (or whatever refusal came instead of one), the job as it
 *  ended, and the two outcomes the screen reads — one of which is always absent. */
interface PasteRun {
  accepted: number;
  job: JobRecord | null;
  result: NonNullable<PasteProgress["result"]> | null;
  failure: NonNullable<PasteProgress["failure"]> | null;
}

/** Paste an advert and wait for the read behind it to finish.
 *
 *  setImmediate rather than a timer, for fixtureDeck.ts's own reason: nothing in this path sleeps,
 *  it settles on microtasks, so yielding a turn of the event loop is exactly the wait required. */
async function paste(
  app: ReturnType<typeof pasteServer>["app"],
  cookie: string,
  payload: { text: string; applicationUrl?: string | null },
): Promise<PasteRun> {
  const started = await app.inject({ method: "POST", url: "/onboarding/paste", headers: { cookie }, payload });
  if (started.statusCode !== 202) return { accepted: started.statusCode, job: null, result: null, failure: null };
  const { jobId } = started.json();
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const res = await app.inject({ method: "GET", url: `/jobs/${jobId}`, headers: { cookie } });
    const job = res.json() as JobRecord;
    if (job.status === "completed" || job.status === "failed") {
      const progress = (job.progress as { paste?: PasteProgress }).paste ?? null;
      return { accepted: 202, job, result: progress?.result ?? null, failure: progress?.failure ?? null };
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("the paste job never finished");
}

describe("#303 POST /onboarding/paste", () => {
  it("reads a pasted advert and answers with that job's own card", async () => {
    const { app, readPastedAdvert } = pasteServer();
    const cookie = await anonSession(app);

    const run = await paste(app, cookie, { text: ADVERT });
    expect(run.accepted).toBe(202);
    const body = run.result!;
    expect(readPastedAdvert).toHaveBeenCalledTimes(1);
    expect(body.adId).toMatch(/^posting:/);
    expect(body.reused).toBe(false);
    // The card is the deck's card, built by the deck's own pass — not a second shape.
    expect(body.card).toMatchObject({
      adId: body.adId,
      title: "Senior Project Manager",
      company: "Gradion",
      place: "Hong Kong",
    });
    // #294 clause 9: his own text is on the job, so the one record that cannot be re-fetched is
    // still readable.
    expect(body.card.adExcerpt).toBe(ADVERT);
  });

  it("stores the advert under the registered 'pasted by you' source, never a real provider's id", async () => {
    const { app, postings } = pasteServer();
    const cookie = await anonSession(app);
    await paste(app, cookie, { text: ADVERT });

    const stored = await postings.get(PASTED_SOURCE_PROVIDER_ID, advertFingerprint(ADVERT));
    expect(stored).not.toBeNull();
    expect(stored!.excerpt).toBe(ADVERT);
    // #302/#294 clause 5: captured when he pasted it; never confirmed live, and never will be.
    expect(stored!.verifiedLiveAt).toBeNull();
    expect(Date.parse(stored!.capturedAt)).toBeGreaterThan(0);
    expect(await postings.listByProvider("techmap")).toHaveLength(0);
  });

  it("#294 c4: an employer-stated closing date is kept in the provider-stated-expiry field", async () => {
    const { app, postings } = pasteServer();
    const cookie = await anonSession(app);
    await paste(app, cookie, { text: ADVERT });

    const stored = await postings.get(PASTED_SOURCE_PROVIDER_ID, advertFingerprint(ADVERT));
    expect(stored!.expiresAt).toBe("2026-10-15");
  });

  it("an advert with no stated closing date carries none — never an estimate", async () => {
    const { app, postings } = pasteServer({ ...HEADER, closingDate: null });
    const cookie = await anonSession(app);
    await paste(app, cookie, { text: ADVERT });
    expect((await postings.get(PASTED_SOURCE_PROVIDER_ID, advertFingerprint(ADVERT)))!.expiresAt).toBeNull();
  });

  it("the same advert pasted twice reuses the first reading and spends nothing", async () => {
    const { app, readPastedAdvert } = pasteServer();
    const cookie = await anonSession(app);

    const first = await paste(app, cookie, { text: ADVERT });
    // Re-pasted with incidental whitespace differences, which is what a second copy really looks
    // like — the fingerprint normalises those, so it is still ONE advert.
    const second = await paste(app, cookie, { text: `  ${ADVERT.replace(/\n/g, "\n ")}  ` });

    expect(second.accepted).toBe(202);
    expect(second.result!.adId).toBe(first.result!.adId);
    expect(second.result!.reused).toBe(true);
    expect(readPastedAdvert).toHaveBeenCalledTimes(1); // the second paste never reached the model
  });

  it("two people pasting the same advert share one reading, and each gets their own paste record", async () => {
    const { app, sessions, readPastedAdvert, pasteRecords } = pasteServer();
    const her = await anonSession(app);
    const him = await anonSession(app);

    const hers = await paste(app, her, { text: ADVERT });
    const his = await paste(app, him, { text: ADVERT });

    const adId = hers.result!.adId;
    expect(his.result!.adId).toBe(adId);
    expect(his.result!.reused).toBe(true);
    expect(readPastedAdvert).toHaveBeenCalledTimes(1); // one advert, one reading, whoever pasted it

    // …and one record each, both naming the same advert — what keeps #305's ageing line true
    // ("how long ago did YOU paste this") the day two people share one pasted job.
    for (const cookie of [her, him]) {
      const sessionId = (await sessions.getByToken(cookie.split("=")[1]!))!.id;
      const records = await pasteRecords.listBySession(sessionId);
      expect(records.map((r) => r.adId)).toEqual([adId]);
    }
  });

  it("a second paste by the same person does not add a second record", async () => {
    const { app, sessions, pasteRecords } = pasteServer();
    const cookie = await anonSession(app);
    const first = await paste(app, cookie, { text: ADVERT });
    const second = await paste(app, cookie, { text: ADVERT });

    const sessionId = (await sessions.getByToken(cookie.split("=")[1]!))!.id;
    const records = await pasteRecords.listBySession(sessionId);
    expect(records).toHaveLength(1);
    // First write wins: the clock #305 counts from is when he FIRST brought this job in.
    expect(second.result!.pastedAt).toBe(first.result!.pastedAt);
    expect(records[0]!.pastedAt).toBe(first.result!.pastedAt);
  });

  it("refuses a fragment that is not an advert, and never spends on it", async () => {
    const { app, readPastedAdvert } = pasteServer();
    const cookie = await anonSession(app);
    const run = await paste(app, cookie, { text: "About us\n\nWe are a great place to work." });
    expect(run.failure!.code).toBe("too_short");
    expect(run.job!.status).toBe("failed");
    expect(run.result).toBeNull();
    expect(readPastedAdvert).not.toHaveBeenCalled();
  });

  it("refuses an advert in a language we cannot read, and refuses it for free", async () => {
    const { app, readPastedAdvert, postings } = pasteServer();
    const cookie = await anonSession(app);
    const chinese = "我們正在尋找一位高級專案經理，負責亞太區的技術專案組合。".repeat(8);
    const run = await paste(app, cookie, { text: chinese });

    expect(run.failure!.code).toBe("unsupported_language");
    expect(run.result).toBeNull();
    // The gate the deck would have applied anyway, applied BEFORE the model call — an advert we
    // were always going to drop must never be read and then lost behind a card that never appears.
    expect(readPastedAdvert).not.toHaveBeenCalled();
    expect(await postings.listByProvider(PASTED_SOURCE_PROVIDER_ID)).toHaveLength(0);
  });

  it("refuses an application link that is not a web address", async () => {
    const { app, postings } = pasteServer();
    const cookie = await anonSession(app);
    // Refused at the boundary by the body schema, so it never becomes a job at all — there is
    // nothing to narrate about a request that was never accepted.
    const run = await paste(app, cookie, { text: ADVERT, applicationUrl: "javascript:alert(1)" });
    expect(run.accepted).toBe(400);
    expect(await postings.listByProvider(PASTED_SOURCE_PROVIDER_ID)).toHaveLength(0);
  });

  it("first paste wins whole — a later paste's link never overwrites, and never backfills", async () => {
    const { app, postings } = pasteServer();
    const cookie = await anonSession(app);
    await paste(app, cookie, { text: ADVERT }); // no link anywhere in the text
    await paste(app, cookie, { text: ADVERT, applicationUrl: "https://gradion.example/apply/42" });

    // The designed remedy for a job with no link is the apply row's own control on the job's own
    // screen (#300 change 1, built by #306) — never a second, invisible way to set the same field.
    expect((await postings.get(PASTED_SOURCE_PROVIDER_ID, advertFingerprint(ADVERT)))!.applicationUrl).toBeNull();
  });

  it("an advert whose requirements have not been read yet says so — never 'you told us you can't'", async () => {
    // QA D1/D2: the requirements read is a SECOND call after the header read, with its own 15s
    // deadline, and on a slow first read it can miss it. Before this split, a timed-out read and a
    // job the person had genuinely ruled themselves out of arrived as one message — telling
    // somebody qualified that this job "asks for something you have told us you do not have",
    // about an advert nobody had finished reading.
    const readPastedAdvert = vi.fn(async () => HEADER);
    const { app } = buildDeckServer({
      readPastedAdvert,
      readAd: async () => null, // what a timed-out or unusable requirements read looks like here
      postings: new InMemoryPostingStore(),
      pasteRecords: new InMemoryPasteRecordStore(),
    });
    const cookie = await anonSession(app);
    const run = await paste(app, cookie, { text: ADVERT });

    expect(run.failure!.code).toBe("read_incomplete");
    expect(run.failure!.fix).toContain("Read it again");
    expect(`${run.failure!.cameBack} ${run.failure!.fix}`).not.toContain("you do not have");
  });

  it("an advert the reader cannot read is refused honestly — no posting is invented", async () => {
    const { app, postings } = pasteServer(null);
    const cookie = await anonSession(app);
    const run = await paste(app, cookie, { text: ADVERT });
    expect(run.failure!.code).toBe("unreadable");
    expect(await postings.listByProvider(PASTED_SOURCE_PROVIDER_ID)).toHaveLength(0);
  });

  it("a build with no reader wired says so rather than inventing a posting", async () => {
    const { app } = buildDeckServer({ readAd: async (posting: Posting) => requirementsFor(posting) });
    const cookie = await anonSession(app);
    const run = await paste(app, cookie, { text: ADVERT });
    expect(run.failure!.code).toBe("reader_unavailable");
  });

  it("carries the typed application link, and reads one out of the text when he typed none", async () => {
    const { app, postings } = pasteServer();
    const cookie = await anonSession(app);

    await paste(app, cookie, { text: ADVERT, applicationUrl: "https://gradion.example/apply/42" });
    expect((await postings.get(PASTED_SOURCE_PROVIDER_ID, advertFingerprint(ADVERT)))!.applicationUrl).toBe(
      "https://gradion.example/apply/42",
    );

    const withLink = `${OTHER_ADVERT}\n\nApply: https://northwind.example/jobs/7`;
    await paste(app, cookie, { text: withLink });
    expect((await postings.get(PASTED_SOURCE_PROVIDER_ID, advertFingerprint(withLink)))!.applicationUrl).toBe(
      "https://northwind.example/jobs/7",
    );
  });

  it("pasting does not change what the deck looks for", async () => {
    const { app, sessions } = pasteServer();
    const cookie = await anonSession(app);
    await app.inject({
      method: "POST",
      url: "/onboarding/discovery/start",
      headers: { cookie },
      payload: { role: "IT project manager in Hong Kong" },
    });
    const sessionId = (await sessions.getByToken(cookie.split("=")[1]!))!.id;
    const before = await sessions.getById(sessionId);

    await paste(app, cookie, { text: ADVERT });

    const after = await sessions.getById(sessionId);
    // Bringing one job in is not changing career: the search intent and the discovery plan the
    // retrieval fingerprint is built from are byte-identical.
    expect(after!.intent).toEqual(before!.intent);
    expect(after!.discovery).toEqual(before!.discovery);
    expect(after!.targetTitles).toEqual(before!.targetTitles);
  });
});

describe("#304 the narrated wait", () => {
  it("narrates three named steps, in order, over the job record the front door already uses", async () => {
    const { app, writes } = pasteServer();
    const cookie = await anonSession(app);

    const run = await paste(app, cookie, { text: ADVERT });
    expect(run.result).not.toBeNull();
    expect(run.job!.type).toBe("paste-advert");
    // The sequence he watches. Deduped because a step is written more than once — the requirements
    // land inside "reading" — but it may never go backwards or skip one.
    const sequence = writes.map((write) => write.step).filter((step, i, all) => step !== all[i - 1]);
    expect(sequence).toEqual(["reading", "employer", "profile"]);
  });

  it("puts the advert's requirements on the wire BEFORE anything is scored", async () => {
    const { app, writes } = pasteServer();
    const cookie = await anonSession(app);
    await paste(app, cookie, { text: ADVERT });

    const firstWithRequirements = writes.findIndex((write) => write.requirements.length > 0);
    const firstWithCard = writes.findIndex((write) => write.result !== undefined);
    expect(firstWithRequirements).toBeGreaterThanOrEqual(0);
    expect(firstWithCard).toBeGreaterThan(firstWithRequirements);
    // In the advert's own words, which is the whole reason they can be shown before a score exists.
    expect(writes[firstWithRequirements]!.requirements).toEqual([
      "Coordinate business and technical stakeholders",
      "Report to a steering committee",
    ]);
    // And nothing scored has reached the wire at that moment.
    expect(writes[firstWithRequirements]!.result).toBeUndefined();
  });

  it("looks the employer up exactly once, by name, and carries what came back", async () => {
    const { app, employerLookup } = pasteServer();
    const cookie = await anonSession(app);

    const run = await paste(app, cookie, { text: ADVERT });
    expect(employerLookup).toHaveBeenCalledTimes(1);
    expect(employerLookup).toHaveBeenCalledWith("Gradion");
    expect(run.job!.progress.paste.employer).toBe("Gradion is a fake company.");
  });

  it("an advert that yields no requirements fails with both lines — what came back, and the fix", async () => {
    // The state #301 amends #86 for: for a FETCHED advert this is "no card, retry next refresh",
    // and for a PASTED one it is a screen, because he brought this job in deliberately.
    const { app } = buildDeckServer({
      readPastedAdvert: async () => HEADER,
      readAd: async () => null,
      postings: new InMemoryPostingStore(),
      pasteRecords: new InMemoryPasteRecordStore(),
    });
    const cookie = await anonSession(app);

    const run = await paste(app, cookie, { text: ADVERT });
    expect(run.failure).toEqual({
      code: "read_incomplete",
      cameBack: expect.stringContaining("no requirements came out of the advert"),
      fix: expect.stringContaining("Press Read it again"),
    });
    expect(run.result).toBeNull();
  });

  it("the read's own progress is the paster's alone — the whole advert travels in it", async () => {
    // The job record now carries the card, and a pasted card carries the whole pasted text as
    // `adExcerpt` (#294 clause 10 names what that text can contain). A guessable job id must not
    // be a second door onto it beside the one GET /onboarding/jobs/:adId already guards.
    const { app } = pasteServer();
    const cookie = await anonSession(app);
    const stranger = await anonSession(app);

    const started = await app.inject({
      method: "POST",
      url: "/onboarding/paste",
      headers: { cookie },
      payload: { text: ADVERT },
    });
    const { jobId } = started.json();
    const peek = await app.inject({ method: "GET", url: `/jobs/${jobId}`, headers: { cookie: stranger } });
    expect(peek.statusCode).toBe(404);
    const stream = await app.inject({ method: "GET", url: `/jobs/${jobId}/events`, headers: { cookie: stranger } });
    expect(stream.statusCode).toBe(404);
  });
});

describe("#303 GET /onboarding/jobs/:adId — the job's own screen", () => {
  it("serves the pasted job's card, so pasting lands on the job and not back on the deck", async () => {
    const { app } = pasteServer();
    const cookie = await anonSession(app);
    const { adId } = (await paste(app, cookie, { text: ADVERT })).result!;

    const res = await injectSettled(app, {
      method: "GET",
      url: `/onboarding/jobs/${encodeURIComponent(adId)}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().card).toMatchObject({ adId, title: "Senior Project Manager", company: "Gradion" });
    expect(res.json().card.adExcerpt).toBe(ADVERT);
  });

  it("a pasted job is reachable by anyone who pasted it — one advert, one reading", async () => {
    const { app } = pasteServer();
    const her = await anonSession(app);
    const him = await anonSession(app);
    const { adId } = (await paste(app, her, { text: ADVERT })).result!;
    await paste(app, him, { text: ADVERT });

    const res = await app.inject({
      method: "GET",
      url: `/onboarding/jobs/${encodeURIComponent(adId)}`,
      headers: { cookie: him },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().card.adId).toBe(adId);
  });

  it("someone who never pasted it cannot read it, even holding the id", async () => {
    const { app } = pasteServer();
    const her = await anonSession(app);
    const stranger = await anonSession(app);
    const { adId } = (await paste(app, her, { text: ADVERT })).result!;

    // adId is sha256(company|location|title) — computable by anyone who has seen the job — and the
    // card carries the whole pasted text as `adExcerpt`. The shared READING (#294 ruling 1) is not
    // shared permission to open somebody's paste.
    const res = await app.inject({
      method: "GET",
      url: `/onboarding/jobs/${encodeURIComponent(adId)}`,
      headers: { cookie: stranger },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.stringify(res.json())).not.toContain("Gradion");
  });

  it("an unknown job is a 404, not an empty screen", async () => {
    const { app } = pasteServer();
    const cookie = await anonSession(app);
    const res = await app.inject({
      method: "GET",
      url: "/onboarding/jobs/posting:nope",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("unknown_card");
  });

  it("needs a session — the door is not open to nobody", async () => {
    const { app } = pasteServer();
    expect((await app.inject({ method: "GET", url: "/onboarding/jobs/posting:nope" })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: "POST", url: "/onboarding/paste", payload: { text: ADVERT } })).statusCode,
    ).toBe(401);
  });
});

describe("#303 reading one pasted advert", () => {
  it("fingerprints on the text alone — same words, one advert; different words, two", () => {
    expect(advertFingerprint(ADVERT)).toBe(advertFingerprint(`\n  ${ADVERT.replace(/\n/g, "\n\t")}  `));
    expect(advertFingerprint(ADVERT)).not.toBe(advertFingerprint(OTHER_ADVERT));
    // Case and punctuation are NOT normalised: merging two different adverts into one shared
    // reading is the one direction that is unsafe.
    expect(advertFingerprint(ADVERT)).not.toBe(advertFingerprint(ADVERT.toLowerCase()));
  });

  it("finds the link a copied advert brought with it, and leaves trailing punctuation behind", () => {
    expect(linkInText("Apply at https://example.com/jobs/7.")).toBe("https://example.com/jobs/7");
    expect(linkInText("no link here")).toBeNull();
    // Only the web. This value is printed at the top of the application email and rendered as an
    // anchor, so a non-web scheme is a hazard, not a typo.
    expect(linkInText("mail us at javascript:alert(1)")).toBeNull();
  });

  it("retries once with the validation errors, then gives up rather than spending a third time", async () => {
    const answers = ["not json at all", JSON.stringify(HEADER)];
    const complete = vi.fn(async () => answers.shift() ?? "");
    const read = makePastedAdvertReader({ complete } as unknown as LlmClient);
    expect(await read(ADVERT)).toEqual(HEADER);
    expect(complete).toHaveBeenCalledTimes(2);

    const bad = vi.fn(async () => "{}");
    expect(await makePastedAdvertReader({ complete: bad } as unknown as LlmClient)(ADVERT)).toBeNull();
    expect(bad).toHaveBeenCalledTimes(2);
  });

  it("refuses a closing date that is not a date — a guess must never reach the expiry field", async () => {
    const complete = vi.fn(async () => JSON.stringify({ ...HEADER, closingDate: "mid-October" }));
    expect(await makePastedAdvertReader({ complete } as unknown as LlmClient)(ADVERT)).toBeNull();
  });
});
