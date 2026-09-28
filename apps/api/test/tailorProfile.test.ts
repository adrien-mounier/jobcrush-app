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
import type { AdRequirementsV1 } from "@jobcrush/contracts";
import { buildItProjectDeliveryServer as buildServer } from "./placedServer.js";
import { liveIdFor, warmRetrieval, getCardsWhenRetrieved } from "./fixtureDeck.js";
import type { Posting } from "../src/preview.js";
import {
  newlyHiddenCount,
  profileChangeLine,
  profileOwnedRequirementIds,
  tailorProfileAsks,
} from "../src/tailorProfile.js";
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
    // No decline: the tailor queue's third option ("not sure yet", stores nothing) is #308's; the
    // discovery decline would close the question through the claims store — a skip hardened into
    // a blank, which ADR-0011 clause 4 forbids.
    expect(ask!.options).toEqual(["Yes — no sponsorship needed", "Not yet — I'd need sponsorship"]);
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

describe("#307 profileOwnedRequirementIds — one queue means one question", () => {
  it("the profile question owns the advert's work-rights requirement, so no Yes/No twin is asked", () => {
    expect(profileOwnedRequirementIds(workRightsAd("ad-1"), HK_LOCATION)).toEqual(
      new Set(["right-to-work-hk"]),
    );
    expect(profileOwnedRequirementIds(plainAd("ad-1"), HK_LOCATION)).toEqual(new Set());
  });
  it("an unplaceable market owns nothing — the requirement keeps its ordinary question rather than losing every door", () => {
    expect(profileOwnedRequirementIds(workRightsAd("ad-1"), "Shenzhen, Guangdong, China")).toEqual(new Set());
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

// --- the HTTP seam -------------------------------------------------------------------------------

// Two UNCURATED Hong Kong corpus postings (no sample-ad-requirements entry, so the injected reader
// below answers for them) — distinct from #209's three, so the two suites never fight over an adId.
const CHARTERHOUSE = "2026-07-09_charterhouse-partnership-asia_senior-business-analyst-product-manager-1-year-contract";
const SANDERSON = "2026-07-09_sanderson-ikas-hong-kong_business-analyst-product-manager-digital-transformation-mobile";
const AD_A = liveIdFor(CHARTERHOUSE);
const AD_B = liveIdFor(SANDERSON);
const WORK_RIGHTS_ADS = new Set([AD_A, AD_B]);

function workRightsServer() {
  const postings = new InMemoryPostingStore();
  const pasteRecords = new InMemoryPasteRecordStore();
  return {
    ...buildServer({
      postings,
      pasteRecords,
      // The two found adverts AND the pasted one all read as work-rights adverts — the pasted
      // posting is recognisable by the company the header stub below stamps on it.
      readAd: async (posting: Posting) =>
        WORK_RIGHTS_ADS.has(posting.id) || posting.company === "Pasted Co"
          ? workRightsAd(posting.id)
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

/** tailor.test.ts's reachTailor, on this suite's own server + target advert. */
async function reachTailor(app: App, cookie: string, email: string, adId: string = AD_A): Promise<void> {
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
  const want = await post(app, cookie, `/onboarding/cards/${adId}/want`);
  expect(want.statusCode).toBe(200);
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

  it("a no on a FOUND job withdraws it — state null, target cleared, and the after-line carries the honest count", async () => {
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

    // The target is cleared the same way GET's own withdrawal rule clears it (#107 M3).
    expect((await get(app, cookie, "/onboarding/tailor")).statusCode).toBe(409);
    // And the deck no longer carries either advert.
    const deck = (await getCardsWhenRetrieved(app, cookie)).json();
    const ids = deck.cards.map((c: { adId: string }) => c.adId);
    expect(ids).not.toContain(AD_A);
    expect(ids).not.toContain(AD_B);
  });

  it("AC2: a job he BROUGHT asks in the same queue, and a no never takes it away (#294 c1)", async () => {
    const { app } = workRightsServer();
    const cookie = await anonSession(app);
    await reachTailor(app, cookie, "brought-stays@example.com");

    // Bring a job: the paste door, then want it — the same queue, no other surface.
    const started = await post(app, cookie, "/onboarding/paste", {
      text: [
        "Regional Project Manager — Pasted Co",
        "Hong Kong",
        "",
        "We are looking for a delivery lead to run a portfolio of technology programmes across the",
        "region. You will coordinate business and technical stakeholders and hold the plan end to",
        "end. Applicants must already hold the right to work in Hong Kong without sponsorship.",
      ].join("\n"),
    });
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
    await post(app, cookie, `/onboarding/cards/${adId}/want`);

    // Same queue, same first question — the job's origin decides nothing.
    const state = (await get(app, cookie, "/onboarding/tailor")).json();
    expect(state.questions[0]).toMatchObject({ requirementId: PROFILE_Q_ID, kind: "profile" });

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
    expect((await get(app, cookie, "/onboarding/tailor")).statusCode).toBe(200);
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
