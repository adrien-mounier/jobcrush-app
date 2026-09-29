// #307 — the Tailor queue's profile-level questions: asked only when the advert asks (AC7), first
// in the queue (AC3), written to the ELIGIBILITY store at the posting's market scope (AC4), never
// asked again on any later job (AC5), with the before/after lines around a permanent answer (AC6)
// — and NEVER a years/family-floor question (AC8, ADR-0008 clause 2's queue-side check).
//
// Pure helpers first (tailorProfile.ts), then the HTTP seam (routes/tailor.ts's profile-answer),
// following tailor.test.ts's own split. The two work-rights adverts are UNCURATED corpus postings
// (no entry in sample-ad-requirements.json) served through the injected reader seam — the same
// move cards.test.ts and qa-main.ts's #209 language adverts make, for the same reason: writing a
// work-rights requirement into the shipped fixture would put words into a real employer's advert.
import { describe, expect, it } from "vitest";
import type { AdRequirementsV1, FamilyPlacement, MinedJobBlock } from "@jobcrush/contracts";
import { buildItProjectDeliveryServer as buildServer } from "./placedServer.js";
import { liveIdFor, warmRetrieval, getCardsWhenRetrieved } from "./fixtureDeck.js";
import type { Posting } from "../src/preview.js";
import type { JudgeFn } from "../src/judge.js";
import { advertYearsFamilyId } from "../src/deck.js";
import { NO_KNOWN_FAMILY } from "../src/adReader.js";
import { InMemoryJobBlockStore } from "../src/jobBlockStore.js";
import { InMemoryEligibilityStore, ANY_FAMILY } from "../src/eligibility.js";
import { refreshWorkedYears } from "../src/yearsWorked.js";
import {
  broughtStaysLine,
  languageChangeLine,
  newlyHiddenCount,
  NOT_SURE_YET,
  profileChangeLine,
  profileOwnedRequirementIds,
  skippedLine,
  tailorProfileAsks,
  withdrawalReasonLine,
  type LanguageProfileAsk,
  type WorkRightsProfileAsk,
} from "../src/tailorProfile.js";
import { LANGUAGE_LADDER } from "../src/languageLevel.js";
import type { EligibilityFact } from "../src/eligibility.js";
import type { BroughtJob } from "../src/broughtJobs.js";
import { InMemoryPostingStore } from "../src/postingStore.js";
import { InMemoryPasteRecordStore } from "../src/pasteRecordStore.js";

// --- the advert shapes ------------------------------------------------------------------------

const workRightsAd = (adId: string, extras: AdRequirementsV1["requirements"] = []): AdRequirementsV1 => ({
  schemaVersion: "1",
  adId,
  curated: false,
  language: "en",
  familyFit: { family: "it-project-delivery", confidence: 0.85 },
  requirements: [
    {
      id: "own-delivery",
      band: "essential",
      requirement: "Own delivery across several vendor teams",
      cvSection: "experience",
      sourceSpan: "own delivery across several vendor teams",
    },
    {
      id: "right-to-work-hk",
      band: "essential",
      kind: "blocking",
      requirement: "Hold the right to work in Hong Kong without sponsorship",
      cvSection: "experience",
      eligibilityDimension: "work-rights",
      sourceSpan: "Test fixture (#307): applicants must already hold the right to work in Hong Kong.",
    },
    ...extras,
  ],
});

const plainAd = (adId: string): AdRequirementsV1 => ({
  schemaVersion: "1",
  adId,
  curated: false,
  language: "en",
  familyFit: { family: "it-project-delivery", confidence: 0.85 },
  requirements: [
    {
      id: "own-delivery",
      band: "essential",
      requirement: "Own delivery across several vendor teams",
      cvSection: "experience",
      sourceSpan: "own delivery across several vendor teams",
    },
  ],
});

/** #308 — a language the advert names only as a plus; the graded ask must fire on it anyway. */
const mandarinPlus: AdRequirementsV1["requirements"][number] = {
  id: "mandarin-advantage",
  band: "nice-to-have",
  requirement: "Mandarin is an advantage when working with the regional vendors",
  cvSection: "skills",
  eligibilityDimension: "language",
  eligibilitySubject: "Mandarin",
  sourceSpan: "Test fixture (#308): Mandarin is an advantage.",
};

const HK_LOCATION = "Hong Kong, Hong Kong SAR";
const hkFact = (value: string): EligibilityFact => ({
  dimension: "work-rights",
  familyId: "hong-kong",
  value,
  label: "Right to work without sponsorship",
});

// --- tailorProfileAsks: which question, and when ------------------------------------------------

describe("#307 tailorProfileAsks", () => {
  it("asks the work-rights question when the advert states the requirement and nothing is stored", () => {
    const asks = tailorProfileAsks(workRightsAd("ad-1"), HK_LOCATION, []);
    expect(asks).toHaveLength(1);
    const [ask] = asks;
    expect(ask!.kind).toBe("profile");
    expect(ask!.requirementId).toBe("eligibility-work-rights-hong-kong");
    expect(ask!.market).toBe("Hong Kong");
    expect(ask!.question).toBe("Can you already work in Hong Kong without visa sponsorship?");
    // AC6's before-line: he is told the answer is permanent BEFORE he gives it.
    expect(ask!.remember).toBe("I'll remember this for every job in Hong Kong.");
    // No decline: the discovery decline would close the question through the claims store — a
    // skip hardened into a blank, which ADR-0011 clause 4 forbids. The way out is #308's skip.
    expect(ask!.options).toEqual(["Yes — no sponsorship needed", "Not yet — I'd need sponsorship"]);
    expect(ask!.skip).toBe(NOT_SURE_YET);
  });

  it("AC7: an advert that states no work-rights requirement raises no question, whatever the market", () => {
    expect(tailorProfileAsks(plainAd("ad-1"), HK_LOCATION, [])).toEqual([]);
    expect(tailorProfileAsks(plainAd("ad-2"), "Singapore", [])).toEqual([]);
  });

  it("AC8: a years bar NEVER becomes a profile question — years are worked out, not asked", () => {
    const ad = plainAd("ad-years");
    ad.requirements.push({
      id: "eight-years",
      band: "essential",
      requirement: "8+ years of IT project delivery",
      cvSection: "experience",
      eligibilityDimension: "years-experience",
      sourceSpan: "8+ years of IT project delivery",
    });
    expect(tailorProfileAsks(ad, HK_LOCATION, [])).toEqual([]);
  });

  it("AC5: a stored fact at the posting's market means no question — asked once, ever", () => {
    expect(tailorProfileAsks(workRightsAd("ad-1"), HK_LOCATION, [hkFact("eligible")])).toEqual([]);
    // The prior "No" also closes the question: he answered; the answer is remembered either way.
    expect(tailorProfileAsks(workRightsAd("ad-1"), HK_LOCATION, [hkFact("needs-sponsorship")])).toEqual([]);
  });

  it("a fact for a DIFFERENT market does not close the question — a Sydney answer says nothing about Hong Kong", () => {
    const sydney: EligibilityFact = { ...hkFact("eligible"), familyId: "australia" };
    expect(tailorProfileAsks(workRightsAd("ad-1"), HK_LOCATION, [sydney])).toHaveLength(1);
  });

  it("an unplaceable posting market asks nothing — never guess a market for a permanent question", () => {
    expect(tailorProfileAsks(workRightsAd("ad-1"), "Shenzhen, Guangdong, China", [])).toEqual([]);
    expect(tailorProfileAsks(workRightsAd("ad-1"), null, [])).toEqual([]);
  });
});

// --- #308: the language ladder in the queue, and the skip -----------------------------------------

describe("#308 tailorProfileAsks — the graded language question, in the queue", () => {
  it("AC3/AC4: an advert naming a language raises the ladder — graded rungs, never Yes/No, work-rights first", () => {
    const asks = tailorProfileAsks(workRightsAd("ad-1", [mandarinPlus]), HK_LOCATION, []);
    expect(asks).toHaveLength(2);
    expect(asks[0]!.dimension).toBe("work-rights"); // #292 ruling 3's order, kept
    const lang = asks[1] as LanguageProfileAsk;
    expect(lang).toMatchObject({
      kind: "profile",
      dimension: "language",
      requirementId: "mandarin-advantage",
      language: "Mandarin",
      skip: "Not now",
      remember: "I'll remember this for every job.",
    });
    // Graded, not yes-or-no: the six situations, offered descending so the one answer with a cost
    // sits last — the ladder's own order, unchanged by the move off the card.
    expect(lang.options).toEqual([...LANGUAGE_LADDER].reverse().map((r) => r.situation));
    expect(lang.options).not.toContain("Yes");
    // Why THIS advert cares, its own line quoted, and the cost said before the rungs.
    expect(lang.why).toContain("Mandarin is an advantage");
    expect(lang.consequence).toContain("takes jobs out of your deck");
  });

  it("the ladder needs no market: a language ask fires even where work-rights cannot", () => {
    const asks = tailorProfileAsks(workRightsAd("ad-1", [mandarinPlus]), "Shenzhen, Guangdong, China", []);
    expect(asks).toHaveLength(1);
    expect(asks[0]!.dimension).toBe("language");
  });

  it("asked once per language ever: a placed rung means no question, on this job or any other", () => {
    const placed: EligibilityFact = {
      dimension: "language",
      familyId: "Mandarin",
      value: "gets-by",
      label: "Mandarin — I get by day to day",
    };
    const asks = tailorProfileAsks(workRightsAd("ad-1", [mandarinPlus]), HK_LOCATION, [placed]);
    expect(asks.map((a) => a.dimension)).toEqual(["work-rights"]);
  });

  it("AC1/AC2: a skipped question is left out for THIS job — and only the skipped one", () => {
    const ad = workRightsAd("ad-1", [mandarinPlus]);
    const workRightsId = "eligibility-work-rights-hong-kong";
    expect(
      tailorProfileAsks(ad, HK_LOCATION, [], new Set([workRightsId])).map((a) => a.dimension),
    ).toEqual(["language"]);
    expect(
      tailorProfileAsks(ad, HK_LOCATION, [], new Set([workRightsId, "mandarin-advantage"])),
    ).toEqual([]);
    // An empty skip set is every pre-#308 caller unchanged.
    expect(tailorProfileAsks(ad, HK_LOCATION, [])).toHaveLength(2);
  });
});

describe("#308 languageChangeLine + skippedLine — the after-lines", () => {
  it("a placed rung says what is remembered and that the question is closed", () => {
    expect(languageChangeLine("Mandarin", "gets-by", 0)).toBe(
      "Remembered for Mandarin: I get by day to day. No job will ask you this again.",
    );
  });
  it("the deliberate bottom rung names the honest count", () => {
    expect(languageChangeLine("Cantonese", "not-at-all", 3)).toBe(
      "Hidden 3 jobs that need Cantonese from your deck.",
    );
    expect(languageChangeLine("Cantonese", "not-at-all", 1)).toBe(
      "Hidden 1 job that needs Cantonese from your deck.",
    );
  });
  it("a bottom rung that hid nothing still says what it means for the deck", () => {
    expect(languageChangeLine("Cantonese", "not-at-all", 0)).toBe(
      "Remembered. Jobs that need Cantonese will stay off your deck.",
    );
  });
  it("a skip says both halves out loud: nothing saved, and the question comes back", () => {
    const asks = tailorProfileAsks(workRightsAd("ad-1", [mandarinPlus]), HK_LOCATION, []);
    expect(skippedLine(asks[0] as WorkRightsProfileAsk)).toBe(
      "Nothing saved — I'll ask again on another job in Hong Kong.",
    );
    expect(skippedLine(asks[1] as LanguageProfileAsk)).toBe(
      "Nothing saved — I'll ask about Mandarin again on another job that needs it.",
    );
  });
});

describe("#307 profileOwnedRequirementIds — one queue means one question", () => {
  it("the profile question owns the advert's work-rights requirement, so no Yes/No twin is asked", () => {
    expect(profileOwnedRequirementIds(workRightsAd("ad-1"), HK_LOCATION)).toEqual(
      new Set(["right-to-work-hk"]),
    );
    expect(profileOwnedRequirementIds(plainAd("ad-1"), HK_LOCATION)).toEqual(new Set());
  });
  it("an unplaceable market owns no work-rights requirement — it keeps its ordinary question rather than losing every door", () => {
    expect(profileOwnedRequirementIds(workRightsAd("ad-1"), "Shenzhen, Guangdong, China")).toEqual(new Set());
  });
  // #308 AC4: the graded ladder is the only door a language answer may take — a Yes/No twin for a
  // subject-carrying language requirement would write the advert-scoped claim the ticket forbids.
  it("#308: a language requirement with a subject is owned everywhere, even where no market places", () => {
    expect(
      profileOwnedRequirementIds(workRightsAd("ad-1", [mandarinPlus]), "Shenzhen, Guangdong, China"),
    ).toEqual(new Set(["mandarin-advantage"]));
    expect(profileOwnedRequirementIds(workRightsAd("ad-1", [mandarinPlus]), HK_LOCATION)).toEqual(
      new Set(["right-to-work-hk", "mandarin-advantage"]),
    );
    // No subject means no safe way to know WHICH language — it stays an ordinary advert question.
    const noSubject = { ...mandarinPlus, id: "some-language" };
    delete (noSubject as { eligibilitySubject?: string }).eligibilitySubject;
    expect(profileOwnedRequirementIds(workRightsAd("ad-1", [noSubject]), HK_LOCATION)).toEqual(
      new Set(["right-to-work-hk"]),
    );
  });
});

// --- newlyHiddenCount + the after-line -----------------------------------------------------------

const candidate = (adId: string, location: string, adReq: AdRequirementsV1) => ({
  posting: { id: adId, location } as unknown as Posting,
  adReq,
});

describe("#307 newlyHiddenCount", () => {
  const hkA = candidate("hk-a", HK_LOCATION, workRightsAd("hk-a"));
  const hkB = candidate("hk-b", HK_LOCATION, workRightsAd("hk-b"));
  const plain = candidate("plain", HK_LOCATION, plainAd("plain"));

  it("counts only the jobs THIS answer withdrew", () => {
    expect(newlyHiddenCount([hkA, hkB, plain], [], [hkFact("needs-sponsorship")], [])).toBe(2);
    expect(newlyHiddenCount([hkA, hkB, plain], [], [hkFact("eligible")], [])).toBe(0);
  });

  it("a job already withdrawn before the answer is never re-counted", () => {
    const before = [hkFact("needs-sponsorship")];
    expect(newlyHiddenCount([hkA, hkB], before, before, [])).toBe(0);
  });

  it("a job he brought never counts — it never withdraws (#294 c1)", () => {
    const brought = [{ posting: { id: "hk-a" } }] as unknown as BroughtJob[];
    expect(newlyHiddenCount([hkA, hkB], [], [hkFact("needs-sponsorship")], brought)).toBe(1);
  });
});

describe("#307 profileChangeLine — AC6's after-line", () => {
  it("a yes says what is remembered and that the question is closed", () => {
    expect(profileChangeLine("eligible", "Hong Kong", 0)).toBe(
      "Remembered: you can work in Hong Kong. No job will ask you this again.",
    );
  });
  it("a no with hidden jobs names the honest count and the undo", () => {
    expect(profileChangeLine("needs-sponsorship", "Hong Kong", 4)).toBe(
      "Hidden 4 Hong Kong jobs from your deck — change this any time in your profile.",
    );
    expect(profileChangeLine("needs-sponsorship", "Singapore", 1)).toBe(
      "Hidden 1 Singapore job from your deck — change this any time in your profile.",
    );
  });
  it("a no that hid nothing still says what was remembered and where to change it", () => {
    expect(profileChangeLine("needs-sponsorship", "Hong Kong", 0)).toBe(
      "Remembered. Jobs in Hong Kong that need sponsorship will stay off your deck — change this any time in your profile.",
    );
  });
});

// --- #309: the two withdrawal-asymmetry lines ----------------------------------------------------

describe("#309 withdrawalReasonLine + broughtStaysLine", () => {
  const workRightsReq = workRightsAd("ad-1").requirements.find((r) => r.id === "right-to-work-hk")!;
  const mandarinBlocking = {
    ...mandarinPlus,
    kind: "blocking" as const,
    requirement: "Fluent Mandarin is required",
  };

  it("AC3: a found job's withdrawal names the gap in the person's own terms", () => {
    expect(withdrawalReasonLine(workRightsReq, "Hong Kong")).toBe(
      "This job needs the right to work in Hong Kong, and your answer says you don't have it — so it has come off your deck.",
    );
    expect(withdrawalReasonLine(mandarinBlocking, "Hong Kong")).toBe(
      "This job needs Mandarin, and your answer says you don't have it — so it has come off your deck.",
    );
  });

  it("AC4: the brought job's stays-anyway line names the same gap and calls it real", () => {
    expect(broughtStaysLine(workRightsReq, "Hong Kong")).toBe(
      "You brought this job, so it stays and I'll draft for it — but it needs the right to work in Hong Kong, and that gap is real.",
    );
    expect(broughtStaysLine(mandarinBlocking, null)).toBe(
      "You brought this job, so it stays and I'll draft for it — but it needs Mandarin, and that gap is real.",
    );
  });
});

// --- the HTTP seam -------------------------------------------------------------------------------

// Two UNCURATED Hong Kong corpus postings (no sample-ad-requirements entry, so the injected reader
// below answers for them) — distinct from #209's three, so the two suites never fight over an adId.
const CHARTERHOUSE = "2026-07-09_charterhouse-partnership-asia_senior-business-analyst-product-manager-1-year-contract";
const SANDERSON = "2026-07-09_sanderson-ikas-hong-kong_business-analyst-product-manager-digital-transformation-mobile";
const AD_A = liveIdFor(CHARTERHOUSE);
const AD_B = liveIdFor(SANDERSON);
const WORK_RIGHTS_ADS = new Set([AD_A, AD_B]);

function workRightsServer(extras: AdRequirementsV1["requirements"] = []) {
  const postings = new InMemoryPostingStore();
  const pasteRecords = new InMemoryPasteRecordStore();
  return {
    ...buildServer({
      postings,
      pasteRecords,
      // The two found adverts AND the pasted one all read as work-rights adverts — the pasted
      // posting is recognisable by the company the header stub below stamps on it. `extras`
      // (#308) lets a test add a language requirement to both found adverts.
      readAd: async (posting: Posting) =>
        WORK_RIGHTS_ADS.has(posting.id) || posting.company === "Pasted Co"
          ? workRightsAd(posting.id, extras)
          : null,
      // #307's brought arm pastes an advert; the header stub plays the model's part (#303's seam).
      readPastedAdvert: async () => ({
        title: "Regional PM",
        company: "Pasted Co",
        location: HK_LOCATION,
        closingDate: null,
      }),
    }),
    postings,
    pasteRecords,
  };
}

type App = ReturnType<typeof workRightsServer>["app"];
async function anonSession(app: App): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/sessions/anonymous" });
  return `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
}
const get = (app: App, cookie: string, url: string) => app.inject({ method: "GET", url, headers: { cookie } });
const post = (app: App, cookie: string, url: string, payload?: unknown) =>
  app.inject({ method: "POST", url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });
async function signIn(app: App, cookie: string, email: string): Promise<void> {
  const link = await post(app, cookie, "/auth/request-link", { email });
  const token = new URL("http://x" + link.json().devLink).searchParams.get("token")!;
  await post(app, cookie, "/auth/verify", { token });
}

/** Discovery answered, signed in, retrieval warmed — the deck, with nothing targeted yet. */
async function reachDeck(app: App, cookie: string, email: string): Promise<void> {
  await post(app, cookie, "/onboarding/discovery/start", { role: "IT project manager" });
  for (const itemId of [
    "end-to-end-delivery",
    "stakeholder-coordination",
    "risk-dependency-control",
    "delivery-communication",
  ]) {
    await post(app, cookie, "/onboarding/discovery/answer", { itemId, answer: "Yes" });
  }
  await signIn(app, cookie, email);
  await warmRetrieval(app, cookie);
}

/** tailor.test.ts's reachTailor, on this suite's own server + target advert. */
async function reachTailor(app: App, cookie: string, email: string, adId: string = AD_A): Promise<void> {
  await reachDeck(app, cookie, email);
  const want = await post(app, cookie, `/onboarding/cards/${adId}/want`);
  expect(want.statusCode).toBe(200);
}

/** The paste door end to end: start the paste, poll the job, return the pasted advert's adId. */
async function pasteJob(app: App, cookie: string, text: string): Promise<string> {
  const started = await post(app, cookie, "/onboarding/paste", { text });
  expect(started.statusCode).toBe(202);
  const { jobId } = started.json();
  let adId: string | null = null;
  for (let attempt = 0; attempt < 500 && !adId; attempt += 1) {
    const job = (await get(app, cookie, `/jobs/${jobId}`)).json();
    if (job.status === "failed") throw new Error("paste failed");
    adId = job.progress?.paste?.result?.adId ?? null;
    if (!adId) await new Promise((resolve) => setImmediate(resolve));
  }
  expect(adId).toBeTruthy();
  return adId!;
}

const PROFILE_Q_ID = "eligibility-work-rights-hong-kong";
const YES = "Yes — no sponsorship needed";
const NOT_YET = "Not yet — I'd need sponsorship";

describe("#307 GET /onboarding/tailor — the queue leads with the profile question", () => {
  it("AC1/AC3/AC6: the work-rights question comes FIRST, with the remember line, before the advert's own", async () => {
    const { app } = workRightsServer();
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "queue-first@example.com");

    const state = (await get(app, cookie, "/onboarding/tailor")).json();
    expect(state.questions.length).toBeGreaterThan(1); // the advert's own questions are still there, after
    expect(state.questions[0]).toMatchObject({
      requirementId: PROFILE_Q_ID,
      kind: "profile",
      market: "Hong Kong",
      remember: "I'll remember this for every job in Hong Kong.",
    });
    expect(state.questions[0].options).toEqual([YES, NOT_YET]);
    // Exactly one profile question per kind per advert, and every later one is the advert's own.
    expect(state.questions.slice(1).every((q: { kind?: string }) => q.kind === undefined)).toBe(true);
    // One queue means ONE question: the advert's own work-rights requirement never also appears
    // as a "This job wants: …" Yes/No twin (#292 ruling 2's defect, kept closed).
    expect(
      state.questions.some((q: { requirementId: string }) => q.requirementId === "right-to-work-hk"),
    ).toBe(false);
  });

  it("the advert-answer door refuses the profile-owned requirement — no advert-scoped claim can be written for it", async () => {
    const { app } = workRightsServer();
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "no-claim-door@example.com");

    const res = await post(app, cookie, "/onboarding/tailor/answer", {
      requirementId: "right-to-work-hk",
      answer: "Yes",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("unknown_requirement");
  });
});

describe("#307 POST /onboarding/tailor/profile-answer", () => {
  it("AC4/AC5/AC6: a yes writes a profile-scoped fact, never a claim, answers with the after-line, and is never asked again — on this job or the next", async () => {
    const built = workRightsServer();
    const { app, eligibility, claims } = built;
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "asked-once@example.com");
    const sessionId = (await get(app, cookie, "/sessions/me")).json().id as string;
    const claimsBefore = [
      (await claims.confirmed(sessionId)).length,
      (await claims.negatives(sessionId)).length,
    ];

    const res = await post(app, cookie, "/onboarding/tailor/profile-answer", {
      requirementId: PROFILE_Q_ID,
      answer: YES,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.changed).toBe("Remembered: you can work in Hong Kong. No job will ask you this again.");
    // The job survives, and the queue moves on to the advert's own questions.
    expect(body.state).not.toBeNull();
    expect(body.state.questions.every((q: { kind?: string }) => q.kind === undefined)).toBe(true);

    // AC4: the answer is a PROFILE fact at the market's own scope in the eligibility store…
    const fact = await eligibility.get(sessionId, "work-rights", "hong-kong");
    expect(fact).toMatchObject({ value: "eligible" });
    // …and never a claim (#106 must-fix 1): the claims store is untouched by a real answer.
    expect([
      (await claims.confirmed(sessionId)).length,
      (await claims.negatives(sessionId)).length,
    ]).toEqual(claimsBefore);

    // AC5: the NEXT job in the same market asks nothing.
    await post(app, cookie, `/onboarding/cards/${AD_B}/want`);
    const next = (await get(app, cookie, "/onboarding/tailor")).json();
    expect(next.card.adId).toBe(AD_B);
    expect(next.questions.some((q: { kind?: string }) => q.kind === "profile")).toBe(false);

    // And the write door agrees with the read door: re-answering the closed question is a 404.
    const again = await post(app, cookie, "/onboarding/tailor/profile-answer", {
      requirementId: PROFILE_Q_ID,
      answer: YES,
    });
    expect(again.statusCode).toBe(404);
  });

  it("a no on a FOUND job withdraws it — state null, target cleared, the after-line carries the honest count, and (#309 AC3) the withdrawal names its reason", async () => {
    const { app } = workRightsServer();
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "no-withdraws@example.com");

    const res = await post(app, cookie, "/onboarding/tailor/profile-answer", {
      requirementId: PROFILE_Q_ID,
      answer: NOT_YET,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Both Hong Kong work-rights adverts go — the one being tailored and its sibling in the deck.
    expect(body.changed).toBe("Hidden 2 Hong Kong jobs from your deck — change this any time in your profile.");
    expect(body.state).toBeNull();
    // #309 AC3: he just answered, so the job's disappearance names its rule — never silence.
    expect(body.withdrawal).toBe(
      "This job needs the right to work in Hong Kong, and your answer says you don't have it — so it has come off your deck.",
    );

    // The target is cleared the same way GET's own withdrawal rule clears it (#107 M3).
    expect((await get(app, cookie, "/onboarding/tailor")).statusCode).toBe(409);
    // And the deck no longer carries either advert.
    const deck = (await getCardsWhenRetrieved(app, cookie)).json();
    const ids = deck.cards.map((c: { adId: string }) => c.adId);
    expect(ids).not.toContain(AD_A);
    expect(ids).not.toContain(AD_B);
  });

  it("AC2: a job he BROUGHT asks in the same queue, a no never takes it away (#294 c1), and (#309 AC4) it says in one line why it stays", async () => {
    const { app } = workRightsServer();
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "brought-stays@example.com");

    // Bring a job: the paste door, then want it — the same queue, no other surface.
    const adId = await pasteJob(
      app,
      cookie,
      [
        "Regional Project Manager — Pasted Co",
        "Hong Kong",
        "",
        "We are looking for a delivery lead to run a portfolio of technology programmes across the",
        "region. You will coordinate business and technical stakeholders and hold the plan end to",
        "end. Applicants must already hold the right to work in Hong Kong without sponsorship.",
      ].join("\n"),
    );
    await post(app, cookie, `/onboarding/cards/${adId}/want`);

    // Same queue, same first question — the job's origin decides nothing. And no stays-anyway
    // line yet: nothing he has answered contradicts this job (#309 AC4 fires on the gap, not the origin).
    const state = (await get(app, cookie, "/onboarding/tailor")).json();
    expect(state.questions[0]).toMatchObject({ requirementId: PROFILE_Q_ID, kind: "profile" });
    expect(state.stayed).toBeUndefined();

    const res = await post(app, cookie, "/onboarding/tailor/profile-answer", {
      requirementId: PROFILE_Q_ID,
      answer: NOT_YET,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // The brought job stays — state is the live tailor screen, not a cleared target…
    expect(body.state).not.toBeNull();
    expect(body.state.card.adId).toBe(adId);
    // …while the two FOUND Hong Kong adverts are honestly gone from the deck.
    expect(body.changed).toBe("Hidden 2 Hong Kong jobs from your deck — change this any time in your profile.");
    // #309 AC4: the asymmetry reads as a promise — the survivor says why it survived, in one line…
    const stayed =
      "You brought this job, so it stays and I'll draft for it — but it needs the right to work in Hong Kong, and that gap is real.";
    expect(body.state.stayed).toBe(stayed);
    // …and the line is derived from the stored facts, so a reload still carries it.
    const reloaded = await get(app, cookie, "/onboarding/tailor");
    expect(reloaded.statusCode).toBe(200);
    expect(reloaded.json().stayed).toBe(stayed);
  });

  it("refuses what the queue never asked: an unknown question is a 404, the discovery decline a 400", async () => {
    const { app } = workRightsServer();
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "refusals@example.com");

    const unknown = await post(app, cookie, "/onboarding/tailor/profile-answer", {
      requirementId: "eligibility-work-rights-singapore",
      answer: YES,
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe("unknown_question");

    const decline = await post(app, cookie, "/onboarding/tailor/profile-answer", {
      requirementId: PROFILE_Q_ID,
      answer: "Ask me later",
    });
    expect(decline.statusCode).toBe(400);
  });
});

// --- #308: the skip and the graded language answer, through the HTTP seam ------------------------

const NOT_NOW = "Not now";
const LANG_Q_ID = "mandarin-advantage";

describe("#308 POST /onboarding/tailor/profile-answer — the skip", () => {
  it("AC1/AC2/AC5: 'not sure yet' writes NOTHING, steps aside for this job, and returns on the next", async () => {
    const built = workRightsServer();
    const { app, eligibility, claims } = built;
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "not-sure-yet@example.com");
    const sessionId = (await get(app, cookie, "/sessions/me")).json().id as string;
    const claimsBefore = [
      (await claims.confirmed(sessionId)).length,
      (await claims.negatives(sessionId)).length,
    ];

    const res = await post(app, cookie, "/onboarding/tailor/profile-answer", {
      requirementId: PROFILE_Q_ID,
      answer: "Not sure yet",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.changed).toBe("Nothing saved — I'll ask again on another job in Hong Kong.");
    // The queue moves on: the skipped question is gone from THIS job's queue…
    expect(body.state).not.toBeNull();
    expect(body.state.questions.every((q: { kind?: string }) => q.kind === undefined)).toBe(true);

    // AC5, the sharp one: a skip is not an answer. Nothing in the eligibility store…
    expect(await eligibility.get(sessionId, "work-rights", "hong-kong")).toBeNull();
    // …and nothing in the claims store either — no decline marker, no sentinel.
    expect([
      (await claims.confirmed(sessionId)).length,
      (await claims.negatives(sessionId)).length,
    ]).toEqual(claimsBefore);

    // Never twice for the same advert (ADR-0011 clause 4): a reload does not re-ask…
    const reloaded = (await get(app, cookie, "/onboarding/tailor")).json();
    expect(reloaded.questions.every((q: { kind?: string }) => q.kind === undefined)).toBe(true);
    // …a drop + re-swipe of the SAME job does not re-ask…
    await post(app, cookie, "/onboarding/tailor/drop");
    await post(app, cookie, `/onboarding/cards/${AD_A}/want`);
    const reentered = (await get(app, cookie, "/onboarding/tailor")).json();
    expect(reentered.questions.every((q: { kind?: string }) => q.kind === undefined)).toBe(true);
    // …and re-skipping the now-absent question is the same 404 as any question the queue never asked.
    const reskip = await post(app, cookie, "/onboarding/tailor/profile-answer", {
      requirementId: PROFILE_Q_ID,
      answer: "Not sure yet",
    });
    expect(reskip.statusCode).toBe(404);

    // AC1/AC2: the NEXT job that states the requirement asks again — a skip never hardens.
    await post(app, cookie, `/onboarding/cards/${AD_B}/want`);
    const next = (await get(app, cookie, "/onboarding/tailor")).json();
    expect(next.card.adId).toBe(AD_B);
    expect(next.questions[0]).toMatchObject({ requirementId: PROFILE_Q_ID, kind: "profile" });

    // And the skip is PER-ADVERT, not per-most-recent-target: coming back to the job it was
    // skipped on — with another job tailored in between — still does not re-ask (ADR-0011
    // clause 4's "never twice for the same advert", the code-review hole this line pins).
    await post(app, cookie, `/onboarding/cards/${AD_A}/want`);
    const backOnA = (await get(app, cookie, "/onboarding/tailor")).json();
    expect(backOnA.card.adId).toBe(AD_A);
    expect(backOnA.questions.every((q: { kind?: string }) => q.kind === undefined)).toBe(true);
  });
});

describe("#308 the language ladder in the queue, through the HTTP seam", () => {
  it("AC3/AC4: the graded question follows work-rights; answering a rung writes the level, never a claim, and never asks again", async () => {
    const built = workRightsServer([mandarinPlus]);
    const { app, eligibility, claims } = built;
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "graded-answer@example.com");
    const sessionId = (await get(app, cookie, "/sessions/me")).json().id as string;

    const state = (await get(app, cookie, "/onboarding/tailor")).json();
    expect(state.questions[0]).toMatchObject({ requirementId: PROFILE_Q_ID, kind: "profile" });
    const lang = state.questions[1];
    expect(lang).toMatchObject({ requirementId: LANG_Q_ID, kind: "profile", skip: NOT_NOW });
    expect(lang.options).toHaveLength(6); // graded — the six situations, never Yes/No
    // AC4's twin check: the advert's own language requirement never appears as a Yes/No question…
    expect(
      state.questions.filter((q: { requirementId: string }) => q.requirementId === LANG_Q_ID),
    ).toHaveLength(1);
    // …and the advert-answer door refuses it outright.
    const twin = await post(app, cookie, "/onboarding/tailor/answer", {
      requirementId: LANG_Q_ID,
      answer: "Yes",
    });
    expect(twin.statusCode).toBe(404);
    // A grade that is not a tapped situation is refused, not guessed at.
    const graded = await post(app, cookie, "/onboarding/tailor/profile-answer", {
      requirementId: LANG_Q_ID,
      answer: "fluent",
    });
    expect(graded.statusCode).toBe(400);

    const claimsBefore = [
      (await claims.confirmed(sessionId)).length,
      (await claims.negatives(sessionId)).length,
    ];
    const res = await post(app, cookie, "/onboarding/tailor/profile-answer", {
      requirementId: LANG_Q_ID,
      answer: "I get by day to day",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.changed).toBe("Remembered for Mandarin: I get by day to day. No job will ask you this again.");
    // Below the advert's bar keeps the job — the ladder's whole promise, intact after the move.
    expect(body.state).not.toBeNull();
    expect(body.state.card.adId).toBe(AD_A);
    // The level is a fact at the language's own scope, and never a claim (#106 must-fix 1).
    expect(await eligibility.get(sessionId, "language", "Mandarin")).toMatchObject({ value: "gets-by" });
    expect([
      (await claims.confirmed(sessionId)).length,
      (await claims.negatives(sessionId)).length,
    ]).toEqual(claimsBefore);

    // Asked once per language ever: the next job naming Mandarin asks nothing about it.
    await post(app, cookie, `/onboarding/cards/${AD_B}/want`);
    const next = (await get(app, cookie, "/onboarding/tailor")).json();
    expect(
      next.questions.some((q: { requirementId: string }) => q.requirementId === LANG_Q_ID),
    ).toBe(false);
  });

  it("AC2/AC5: 'Not now' on the ladder stores nothing and the next job asks again", async () => {
    const built = workRightsServer([mandarinPlus]);
    const { app, eligibility } = built;
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "ladder-not-now@example.com");
    const sessionId = (await get(app, cookie, "/sessions/me")).json().id as string;

    const res = await post(app, cookie, "/onboarding/tailor/profile-answer", {
      requirementId: LANG_Q_ID,
      answer: NOT_NOW,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.changed).toBe("Nothing saved — I'll ask about Mandarin again on another job that needs it.");
    // Gone from this job's queue — but the work-rights question is untouched by the language skip.
    expect(body.state.questions[0]).toMatchObject({ requirementId: PROFILE_Q_ID });
    expect(
      body.state.questions.some((q: { requirementId: string }) => q.requirementId === LANG_Q_ID),
    ).toBe(false);
    // Nothing stored: no level, not even a declaration.
    expect(await eligibility.get(sessionId, "language", "Mandarin")).toBeNull();

    // The next job that names Mandarin asks the ladder again.
    await post(app, cookie, `/onboarding/cards/${AD_B}/want`);
    const next = (await get(app, cookie, "/onboarding/tailor")).json();
    expect(
      next.questions.some((q: { requirementId: string }) => q.requirementId === LANG_Q_ID),
    ).toBe(true);
  });
});

// --- #309 AC5: the honest zero — a pasted job outside his field ----------------------------------
//
// The years scope for a job HE BROUGHT is the advert's OWN read-stamped family
// (advertYearsFamilyId), not the family his deck was searched for. Without that, a field-marketing
// advert's "5+ years" bar was answered with his IT-project-delivery years — his career total lent
// to a field his work history does not cover — and the CV would be drafted as though he had them.

const MARKETING_BAR_ID = "five-years-marketing";

const marketingAd = (adId: string): AdRequirementsV1 => ({
  schemaVersion: "1",
  adId,
  curated: false,
  language: "en",
  familyFit: { family: "field-marketing", confidence: 0.9 },
  requirements: [
    {
      id: MARKETING_BAR_ID,
      band: "essential",
      requirement: "5+ years running field marketing campaigns",
      cvSection: "experience",
      eligibilityDimension: "years-experience",
      comparable: { op: ">=", value: 5 },
      sourceSpan: "Test fixture (#309): 5+ years running field marketing campaigns.",
    },
  ],
});

// A judge that finds every requirement fully evidenced, instantly — so any movement in matchPct
// below comes from the years shortfall under test, nothing else (familyYears.test.ts's own shape).
const fullFitJudge: JudgeFn = async (adReq) => ({
  verdicts: adReq.requirements.map((r) => ({
    requirementId: r.id,
    fit: 1,
    supportingFactId: null,
    reason: "test",
  })),
  version: "test",
  cost: { model: "fake-judge", inputTokens: 1, outputTokens: 1, judgedAt: new Date().toISOString() },
});

const decision = (value: string) => ({
  value,
  source_quote: value,
  machine_touch: "verbatim" as const,
  classification: "Verified" as const,
});

function pmBlock(id: string, startYear: number, endYear: number): MinedJobBlock {
  return {
    id,
    employer: decision(`Employer ${id}`),
    title: decision("Regional PM"),
    start: {
      value: { year: startYear, month: 1, precision: "month" },
      source_quote: `Jan ${startYear}`,
      machine_touch: "verbatim",
      classification: "Verified",
    },
    end: {
      value: { state: "ended", date: { year: endYear, month: 12, precision: "month" } },
      source_quote: `Dec ${endYear}`,
      machine_touch: "verbatim",
      classification: "Verified",
    },
    kind: decision("job") as MinedJobBlock["kind"],
  };
}

const placedIn = (familyId: string): FamilyPlacement => ({
  schemaVersion: "2",
  outcome: "confirmed",
  families: [{ familyId, version: 1 }],
  confidence: "certain",
});

function honestZeroServer() {
  const jobBlocks = new InMemoryJobBlockStore();
  const eligibility = new InMemoryEligibilityStore();
  const postings = new InMemoryPostingStore();
  const pasteRecords = new InMemoryPasteRecordStore();
  return {
    ...buildServer({
      postings,
      pasteRecords,
      jobBlocks,
      eligibility,
      judge: fullFitJudge,
      judgeMaxCards: 99,
      readAd: async (posting: Posting) =>
        posting.company === "Pasted Co" ? marketingAd(posting.id) : null,
      readPastedAdvert: async () => ({
        title: "Field Marketing Lead",
        company: "Pasted Co",
        location: HK_LOCATION,
        closingDate: null,
      }),
    }),
    jobBlocks,
    eligibility,
  };
}

describe("#309 AC5 — a pasted job outside his field scores an honest zero, not the career total", () => {
  it("the scope rule: a brought job reads its OWN family; found jobs keep the deck's; an unplaceable familyFit reads the career total", () => {
    const ad = marketingAd("x");
    expect(advertYearsFamilyId(ad, true, "it-project-delivery")).toBe("field-marketing");
    expect(advertYearsFamilyId(ad, false, "it-project-delivery")).toBe("it-project-delivery");
    // NO_KNOWN_FAMILY → unscoped (career total), NOT the deck's family — the deck scope would be
    // arbitrary for a job that isn't in it and could even be a known zero, and an unknown never
    // lowers. Independent of the deck scope, so every surface reads the same number.
    const unknown = { ...ad, familyFit: { family: NO_KNOWN_FAMILY, confidence: 0.2 } };
    expect(advertYearsFamilyId(unknown, true, "it-project-delivery")).toBeNull();
    expect(advertYearsFamilyId(unknown, true, null)).toBeNull();
  });

  it("his 8 placed IT years are not lent to a field-marketing bar: the tailor shows the bar open and the score at zero", async () => {
    const { app, jobBlocks, eligibility } = honestZeroServer();
    const cookie = await anonSession(app);
    await reachDeck(app, cookie, "honest-zero@example.com");
    const sessionId = (await get(app, cookie, "/sessions/me")).json().id as string;

    // One dated job, 2016–2023, placed with certainty in HIS family — nothing unaccounted, so the
    // advert's family is a KNOWN zero (resolveSessionYears's "zero" rule), never the fallback.
    await jobBlocks.ingest(sessionId, { schemaVersion: "1", blocks: [pmBlock("b1", 2016, 2023)] }, "{}");
    await jobBlocks.label(sessionId, "b1", placedIn("it-project-delivery"));
    await refreshWorkedYears(jobBlocks, eligibility, sessionId);
    // Sanity: the career total really exists and would clear the bar — the thing that must not be lent.
    const total = await eligibility.get(sessionId, "years-experience", ANY_FAMILY);
    expect(Number(total?.value)).toBeGreaterThanOrEqual(5);

    const adId = await pasteJob(
      app,
      cookie,
      [
        "Field Marketing Lead — Pasted Co",
        "Hong Kong",
        "",
        "We are looking for a marketer to run our regional campaigns end to end.",
        "5+ years running field marketing campaigns.",
      ].join("\n"),
    );
    await post(app, cookie, `/onboarding/cards/${adId}/want`);

    const state = (await get(app, cookie, "/onboarding/tailor")).json();
    expect(state.card.adId).toBe(adId);
    // The one essential bar is 5+ years in the advert's own field. His known zero there fails it —
    // the judge found everything evidenced, so only the years shortfall can be holding this down.
    expect(state.card.matchPct).toBe(0);
    expect(state.card.dontYet.map((r: { id: string }) => r.id)).toContain(MARKETING_BAR_ID);
  });
});
