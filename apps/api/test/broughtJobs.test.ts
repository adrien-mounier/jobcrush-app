// #305 — a job he brought, on his deck, driven through the same seams the web client drives: paste
// the advert, then read GET /onboarding/cards and watch what the deck does with it. Everything this
// ticket promises is observable from here, which is the point — the spec's own test rule is "assert
// that a pasted advert seven days old still shows its card AND carries its ageing line, not that a
// predicate returned true".
//
// The two freshness-gate exemptions are proved in postingRetrieval.test.ts instead, at the gates' own
// seam: they are all-or-nothing rules about a stored snapshot, and the product cannot be made to show
// one from out here (a pasted advert never rides in a retrieval snapshot, which is the whole reason it
// has to be stitched in).
//
// Time is faked throughout, because every rule here is about the passage of days.
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdRequirementsV1, type PostingRetrievalResultV1 } from "@jobcrush/contracts";
import { buildDeckServer, coverEssentialFloor, fixtureRetriever, injectSettled } from "./fixtureDeck.js";
import { IT_PROJECT_DELIVERY_PLACEMENT } from "./placedServer.js";
import { InMemoryJobStore } from "../src/jobs.js";
import { InMemoryPasteRecordStore } from "../src/pasteRecordStore.js";
import { InMemoryPostingStore } from "../src/postingStore.js";
import type { JobRecord } from "../src/jobs.js";
import type { PasteProgress } from "../src/routes/paste.js";
import type { Posting } from "../src/preview.js";
import { LANGUAGE_NOT_AT_ALL } from "../src/languageLevel.js";

const ROLE = "IT project manager in Hong Kong";

/** An advert long enough to be read as one, whose FIRST LINE is its title — so two adverts with
 *  different titles fingerprint apart and get canonical ids of their own. */
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

/** A job WE found that nobody hand-curated, so the same injected reader answers for it as for the
 *  pasted one. It is the control the two "kept" tests below need: one advert, one reader, one verdict
 *  — and the only difference left is who brought it. */
const FOUND: Posting = {
  id: "posting:found-control",
  title: "Delivery Manager",
  company: "Northwind",
  location: "Hong Kong",
  keywords: ["delivery"],
  excerpt: "Run a portfolio of technology programmes and report to the steering committee.",
  language: "en",
};

interface ServerOpts {
  /** Places this session in a family, which is what arms the deck's wrong-family deletion. */
  placed?: boolean;
  /** What the employer stated about applications closing, as the reader reads it off the text. */
  closingDate?: string | null;
  /** The family the reader stamps on a PASTED advert — a different one makes it an off-field job. */
  family?: string;
  /** A blocking language requirement on the pasted advert, so withdrawal has something to fire on. */
  blockingLanguage?: string;
  retrievePostings?: () => Promise<PostingRetrievalResultV1>;
}

function broughtServer(opts: ServerOpts = {}) {
  const readPastedAdvert = vi.fn(async (text: string) => ({
    title: text.split("\n")[0]!.trim(),
    company: "Gradion",
    location: "Hong Kong",
    closingDate: opts.closingDate ?? null,
  }));
  const readAd = vi.fn(
    async (posting: Posting): Promise<AdRequirementsV1> =>
      AdRequirementsV1.parse({
        schemaVersion: "1",
        adId: posting.id,
        curated: false,
        language: "en",
        familyFit: { family: opts.family ?? "it-project-delivery", confidence: 0.9 },
        requirements: [
          {
            id: "stakeholders",
            band: "essential",
            kind: "ordinary",
            requirement: "Coordinate business and technical stakeholders",
            sourceSpan: "coordinate business and technical stakeholders",
          },
          ...(opts.blockingLanguage
            ? [
                {
                  id: "language-bar",
                  band: "essential",
                  kind: "blocking",
                  requirement: `Fluent ${opts.blockingLanguage}`,
                  sourceSpan: `fluent ${opts.blockingLanguage}`,
                  eligibilityDimension: "language",
                  eligibilitySubject: opts.blockingLanguage,
                },
              ]
            : []),
        ],
      }),
  );
  const postings = new InMemoryPostingStore();
  const pasteRecords = new InMemoryPasteRecordStore();
  const built = buildDeckServer({
    readPastedAdvert,
    readAd,
    postings,
    pasteRecords,
    store: new InMemoryJobStore(),
    ...(opts.placed ? { placeFamily: async () => IT_PROJECT_DELIVERY_PLACEMENT } : {}),
    ...(opts.retrievePostings ? { retrievePostings: opts.retrievePostings } : {}),
  });
  return { ...built, postings, pasteRecords, readAd };
}

type App = ReturnType<typeof broughtServer>["app"];

async function anonSession(app: App): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/sessions/anonymous" });
  return `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
}

const post = (app: App, cookie: string, url: string, payload?: unknown) =>
  app.inject({ method: "POST", url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });

async function signIn(app: App, cookie: string, email: string): Promise<void> {
  const link = await post(app, cookie, "/auth/request-link", { email });
  const token = new URL("http://x" + link.json().devLink).searchParams.get("token")!;
  await post(app, cookie, "/auth/verify", { token });
}

/** Paste an advert and wait out the read behind it (the route answers 202 and narrates — #304).
 *  setImmediate rather than a timer: nothing in this path sleeps, and the fake clock here is Date only. */
async function paste(app: App, cookie: string, text: string): Promise<string> {
  const started = await app.inject({
    method: "POST",
    url: "/onboarding/paste",
    headers: { cookie },
    payload: { text },
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

interface DeckCard {
  adId: string;
  title: string;
  ageing?: string;
}

/** His deck, once retrieval has settled. */
async function deck(app: App, cookie: string): Promise<{ cards: DeckCard[]; searching: boolean }> {
  const res = await injectSettled(app, { method: "GET", url: "/onboarding/cards", headers: { cookie } });
  expect(res.statusCode).toBe(200);
  return res.json() as { cards: DeckCard[]; searching: boolean };
}

/** A session that has earned a deck of jobs we found — the state every test here starts from, so the
 *  pasted job is being compared against a real ranked deck rather than an empty one. */
async function readyForDeck(app: App): Promise<string> {
  const cookie = await anonSession(app);
  await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
  await coverEssentialFloor(app, cookie);
  return cookie;
}

const at = (iso: string) => vi.setSystemTime(new Date(iso));
const DAY_ONE = "2026-09-01T09:00:00.000Z";

function useFakeClock(iso = DAY_ONE) {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(iso);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("#305 the deck stitches in a job he brought", () => {
  it("pins it above the ranked jobs and keeps the jobs we found underneath", async () => {
    useFakeClock();
    const { app } = broughtServer();
    const cookie = await readyForDeck(app);
    const ranked = await deck(app, cookie);
    expect(ranked.cards.length).toBeGreaterThan(1); // a real ranked deck to be pinned above

    const adId = await paste(app, cookie, PASTED);
    const withBrought = await deck(app, cookie);
    expect(withBrought.cards[0]!.adId).toBe(adId);
    expect(withBrought.cards).toHaveLength(ranked.cards.length + 1);
  });

  it("pins only the newest three; an older one falls into the ranked deck", async () => {
    useFakeClock();
    const { app } = broughtServer();
    const cookie = await readyForDeck(app);

    const ids: string[] = [];
    for (const [index, title] of ["First job", "Second job", "Third job", "Fourth job"].entries()) {
      at(`2026-09-0${index + 1}T09:00:00.000Z`); // a day apart, so "newest first" means something
      ids.push(await paste(app, cookie, advert(title)));
    }
    const [first, second, third, fourth] = ids;

    const cards = (await deck(app, cookie)).cards;
    expect(cards.slice(0, 3).map((card) => card.adId)).toEqual([fourth, third, second]);
    // The first one he pasted is still in the deck — it simply competes on merit now.
    expect(cards.map((card) => card.adId)).toContain(first);
    expect(cards.slice(3).map((card) => card.adId)).toContain(first);
  });

  it("shows during a provider blackout, as an ordinary deck", async () => {
    useFakeClock();
    const { app } = broughtServer({
      retrievePostings: async () => ({
        schemaVersion: "5",
        outcome: "provider_unavailable",
        coverage: { providersQueried: [], providersUnavailable: ["techmap"], complete: false },
        reason: "provider unavailable",
        retryable: true,
      }),
    });
    const cookie = await readyForDeck(app);
    expect((await deck(app, cookie)).cards).toHaveLength(0); // nothing of ours to show

    const adId = await paste(app, cookie, PASTED);
    const blackout = await deck(app, cookie);
    // A deck, not an apology: the client shows its empty/unavailable screens only on an empty deck.
    expect(blackout.cards.map((card) => card.adId)).toEqual([adId]);
    expect(blackout.searching).toBe(false);
  });

  it("keeps an advert outside his field, which the deck would otherwise delete before spending", async () => {
    useFakeClock();
    // Both adverts read as the SAME wrong family, and the deck this session earned is it-project-
    // delivery — so the only difference between them is who brought which.
    const { app } = broughtServer({
      family: "construction-site-management",
      placed: true, // without a family on the session there is no deletion to be spared
      retrievePostings: fixtureRetriever([FOUND]),
    });
    const cookie = await readyForDeck(app);
    const adId = await paste(app, cookie, PASTED);

    const cards = (await deck(app, cookie)).cards;
    // The one we found was deleted before anything was spent on it. His was not.
    expect(cards.map((card) => card.adId)).toEqual([adId]);
  });

  it("is never withdrawn, on the deck or on the way into tailoring", async () => {
    useFakeClock();
    const { app } = broughtServer({ blockingLanguage: "Mandarin", retrievePostings: fixtureRetriever([FOUND]) });
    const cookie = await readyForDeck(app);
    await signIn(app, cookie, "brought-withdrawal@example.com");
    // He has said, on the ladder, that he does not speak it at all — the one answer that withdraws.
    await post(app, cookie, "/onboarding/language-level", { language: "Mandarin", level: LANGUAGE_NOT_AT_ALL });
    const adId = await paste(app, cookie, PASTED);

    const cards = (await deck(app, cookie)).cards;
    // Same advert, same bar, same answer: the one we found is gone, his stays.
    expect(cards.map((card) => card.adId)).toEqual([adId]);
    // And the card's own actions work — a pinned card whose button 404s would be a trap, not a deck.
    expect((await post(app, cookie, `/onboarding/cards/${encodeURIComponent(adId)}/want`)).statusCode).toBe(200);
    const tailor = await app.inject({ method: "GET", url: "/onboarding/tailor", headers: { cookie } });
    expect(tailor.statusCode).toBe(200);
  });
});

describe("#305 it ages in public", () => {
  it("says nothing in the first days", async () => {
    useFakeClock();
    const { app } = broughtServer();
    const cookie = await readyForDeck(app);
    const adId = await paste(app, cookie, PASTED);

    at("2026-09-04T09:00:00.000Z"); // three days on
    const card = (await deck(app, cookie)).cards.find((entry) => entry.adId === adId)!;
    expect(card.ageing).toBeUndefined();
  });

  it("from day seven, says how long ago HE pasted it and that we cannot check it", async () => {
    useFakeClock();
    const { app } = broughtServer();
    const cookie = await readyForDeck(app);
    const adId = await paste(app, cookie, PASTED);

    at("2026-09-08T09:00:00.000Z"); // a week on
    const weekOld = (await deck(app, cookie)).cards.find((entry) => entry.adId === adId)!;
    expect(weekOld.ageing).toBe("You pasted this 7 days ago. We cannot check whether it is still open.");
    // And the ranked deck is untouched — a week-old paste ages its own card, never the whole deck.
    expect((await deck(app, cookie)).cards.length).toBeGreaterThan(1);

    at("2026-09-20T09:00:00.000Z");
    const older = (await deck(app, cookie)).cards.find((entry) => entry.adId === adId)!;
    expect(older.ageing).toBe("You pasted this 19 days ago. We cannot check whether it is still open.");
  });

  it("says the same thing on the job's own screen as on the deck card", async () => {
    useFakeClock();
    const { app } = broughtServer();
    const cookie = await readyForDeck(app);
    const adId = await paste(app, cookie, PASTED);

    at("2026-09-10T09:00:00.000Z");
    const own = await app.inject({
      method: "GET",
      url: `/onboarding/jobs/${encodeURIComponent(adId)}`,
      headers: { cookie },
    });
    expect(own.statusCode).toBe(200);
    const onDeck = (await deck(app, cookie)).cards.find((entry) => entry.adId === adId)!;
    expect(own.json().card.ageing).toBe(onDeck.ageing);
    expect(own.json().card.ageing).toContain("9 days ago");
  });

  it("shows a stated closing date straight away, without waiting out the silent week", async () => {
    useFakeClock();
    const { app } = broughtServer({ closingDate: "2026-09-04" });
    const cookie = await readyForDeck(app);
    const adId = await paste(app, cookie, PASTED);

    at("2026-09-02T09:00:00.000Z"); // day one, and the advert closes in two
    const card = (await deck(app, cookie)).cards.find((entry) => entry.adId === adId)!;
    // The silent week protects him from a HEDGE becoming furniture. A date the employer stated is a
    // fact, and held back to day seven it would arrive after the date it names had passed.
    expect(card.ageing).toBe("The employer said applications close on 4 September.");
  });

  it("lets a closing date the employer stated supersede the vague line", async () => {
    useFakeClock();
    const { app } = broughtServer({ closingDate: "2026-09-15" });
    const cookie = await readyForDeck(app);
    const adId = await paste(app, cookie, PASTED);

    at("2026-09-10T09:00:00.000Z"); // day nine, closing still ahead
    const ahead = (await deck(app, cookie)).cards.find((entry) => entry.adId === adId)!;
    expect(ahead.ageing).toBe("The employer said applications close on 15 September.");

    at("2026-09-18T09:00:00.000Z"); // three days past it
    const past = (await deck(app, cookie)).cards.find((entry) => entry.adId === adId)!;
    expect(past.ageing).toBe("The employer said applications closed on 15 September, 3 days ago.");
  });

  it("keeps showing the card after that closing date — a stated date is not an expiry", async () => {
    useFakeClock();
    const { app } = broughtServer({ closingDate: "2026-09-02" });
    const cookie = await readyForDeck(app);
    const adId = await paste(app, cookie, PASTED);

    at("2026-09-25T09:00:00.000Z"); // three weeks past the closing date
    const cards = (await deck(app, cookie)).cards;
    expect(cards[0]!.adId).toBe(adId); // still pinned, still his
    expect(cards.length).toBeGreaterThan(1); // and it took nothing else down with it
  });

  it("counts from HIS paste, not from when anyone first pasted the same advert", async () => {
    useFakeClock();
    const { app } = broughtServer();
    const early = await readyForDeck(app);
    await paste(app, early, PASTED);

    at("2026-09-12T09:00:00.000Z"); // eleven days later, somebody else brings the same advert in
    const late = await readyForDeck(app);
    const adId = await paste(app, late, PASTED);

    const hisCard = (await deck(app, late)).cards.find((entry) => entry.adId === adId)!;
    expect(hisCard.ageing).toBeUndefined(); // his own paste is today, whatever the record's age
    const herCard = (await deck(app, early)).cards.find((entry) => entry.adId === adId)!;
    expect(herCard.ageing).toBe("You pasted this 11 days ago. We cannot check whether it is still open.");
  });
});
