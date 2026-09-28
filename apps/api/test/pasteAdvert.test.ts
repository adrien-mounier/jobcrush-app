// #303 — the paste door, driven through the API the way the web client drives it (spec #301's
// primary seam). Everything a person can perceive is observable here: an advert pasted and read, a
// reading reused on the second paste, two people sharing one reading, a closing date kept, the deck
// unchanged by a paste, and the landing being that job's own screen.
//
// What is deliberately NOT here, because it belongs to a later slice: the narrated wait and the
// failure screen's copy (#304), the deck stitching, pinning, freshness exemptions and ageing line
// (#305), the job screen's own four changes (#306).
import { describe, expect, it, vi } from "vitest";
import { AdRequirementsV1 } from "@jobcrush/contracts";
import { buildDeckServer, coverEssentialFloor, injectSettled } from "./fixtureDeck.js";
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

/** A server with the paste door wired: a stub advert reader (one call per unread advert, counted)
 *  and the deck's own reader answering for whatever it produces. */
function pasteServer(header: typeof HEADER | null = HEADER) {
  const readPastedAdvert = vi.fn(async () => header);
  const readAd = vi.fn(async (posting: Posting) => requirementsFor(posting));
  const postings = new InMemoryPostingStore();
  const pasteRecords = new InMemoryPasteRecordStore();
  const built = buildDeckServer({ readPastedAdvert, readAd, postings, pasteRecords });
  return { ...built, readPastedAdvert, readAd, postings, pasteRecords };
}

async function anonSession(app: ReturnType<typeof pasteServer>["app"]): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/sessions/anonymous" });
  return `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
}

const paste = (
  app: ReturnType<typeof pasteServer>["app"],
  cookie: string,
  payload: { text: string; applicationUrl?: string | null },
) => app.inject({ method: "POST", url: "/onboarding/paste", headers: { cookie }, payload });

describe("#303 POST /onboarding/paste", () => {
  it("reads a pasted advert and answers with that job's own card", async () => {
    const { app, readPastedAdvert } = pasteServer();
    const cookie = await anonSession(app);

    const res = await paste(app, cookie, { text: ADVERT });
    expect(res.statusCode).toBe(200);
    const body = res.json();
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

    expect(second.statusCode).toBe(200);
    expect(second.json().adId).toBe(first.json().adId);
    expect(second.json().reused).toBe(true);
    expect(readPastedAdvert).toHaveBeenCalledTimes(1); // the second paste never reached the model
  });

  it("two people pasting the same advert share one reading, and each gets their own paste record", async () => {
    const { app, sessions, readPastedAdvert, pasteRecords } = pasteServer();
    const her = await anonSession(app);
    const him = await anonSession(app);

    const hers = await paste(app, her, { text: ADVERT });
    const his = await paste(app, him, { text: ADVERT });

    const adId = hers.json().adId;
    expect(his.json().adId).toBe(adId);
    expect(his.json().reused).toBe(true);
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
    expect(second.json().pastedAt).toBe(first.json().pastedAt);
    expect(records[0]!.pastedAt).toBe(first.json().pastedAt);
  });

  it("refuses a fragment that is not an advert, and never spends on it", async () => {
    const { app, readPastedAdvert } = pasteServer();
    const cookie = await anonSession(app);
    const res = await paste(app, cookie, { text: "About us\n\nWe are a great place to work." });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("too_short");
    expect(readPastedAdvert).not.toHaveBeenCalled();
  });

  it("refuses an advert in a language we cannot read, and refuses it for free", async () => {
    const { app, readPastedAdvert, postings } = pasteServer();
    const cookie = await anonSession(app);
    const chinese = "我們正在尋找一位高級專案經理，負責亞太區的技術專案組合。".repeat(8);
    const res = await paste(app, cookie, { text: chinese });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("unsupported_language");
    // The gate the deck would have applied anyway, applied BEFORE the model call — an advert we
    // were always going to drop must never be read and then lost behind a card that never appears.
    expect(readPastedAdvert).not.toHaveBeenCalled();
    expect(await postings.listByProvider(PASTED_SOURCE_PROVIDER_ID)).toHaveLength(0);
  });

  it("refuses an application link that is not a web address", async () => {
    const { app, postings } = pasteServer();
    const cookie = await anonSession(app);
    const res = await paste(app, cookie, { text: ADVERT, applicationUrl: "javascript:alert(1)" });
    expect(res.statusCode).toBe(400);
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
    const res = await paste(app, cookie, { text: ADVERT });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("read_incomplete");
    expect(res.json().error.message).toContain("Read it again");
    expect(res.json().error.message).not.toContain("you do not have");
  });

  it("an advert the reader cannot read is refused honestly — no posting is invented", async () => {
    const { app, postings } = pasteServer(null);
    const cookie = await anonSession(app);
    const res = await paste(app, cookie, { text: ADVERT });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("unreadable");
    expect(await postings.listByProvider(PASTED_SOURCE_PROVIDER_ID)).toHaveLength(0);
  });

  it("a build with no reader wired says so rather than inventing a posting", async () => {
    const { app } = buildDeckServer({ readAd: async (posting: Posting) => requirementsFor(posting) });
    const cookie = await anonSession(app);
    const res = await paste(app, cookie, { text: ADVERT });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("reader_unavailable");
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

describe("#303 GET /onboarding/jobs/:adId — the job's own screen", () => {
  it("serves the pasted job's card, so pasting lands on the job and not back on the deck", async () => {
    const { app } = pasteServer();
    const cookie = await anonSession(app);
    const { adId } = (await paste(app, cookie, { text: ADVERT })).json();

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
    const { adId } = (await paste(app, her, { text: ADVERT })).json();
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
    const { adId } = (await paste(app, her, { text: ADVERT })).json();

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
