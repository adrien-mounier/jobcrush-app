// #23 tailor (screen 3) — pure helpers (prior art: matchtick.test.ts) + the pinned HTTP seam (prior
// art: discovery.test.ts, cards.test.ts). #415 (ADR-0020): the requirement yes/no queue, its answer
// route and the ledger are gone — the Tailor step asks only the profile questions (tailorProfile.ts)
// and then writes the CV. What this file pins now: the claim-id scheme, the denial mapping the card
// and the report read, the `requirements` list the screen's "Where you fit" / "Also asked, not on
// your CV" are drawn from, and the route behaviours — the removed door 404s, drop loses the job but
// never a claim.
import { describe, expect, it } from "vitest";
import type { AdRequirementV1, AdRequirementsV1, CandidateClaim } from "@jobcrush/contracts";
import { buildItProjectDeliveryServer as buildServer } from "./placedServer.js";
// #63: adverts reach a session through retrieval now - see fixtureDeck.ts.
import { liveIdFor, warmRetrieval } from "./fixtureDeck.js";
import type { ClaimRecord } from "../src/claims.js";
import { loadAdRequirements } from "../src/e5stub.js";
import { discoveryClaimId } from "../src/discovery.js";
import { buildTailorState } from "../src/deck.js";
import type { Posting } from "../src/preview.js";
import {
  advertDeniedRows,
  deniedCapabilities,
  negativeRequirementIds,
  tailorClaimId,
} from "../src/tailor.js";
import { DECLINE_OPTION, eligibilityCandidates } from "../src/eligibilityDiscovery.js";
import { ANY_FAMILY } from "../src/eligibility.js";

const AD: AdRequirementsV1 = {
  schemaVersion: "1",
  adId: "test-ad",
  curated: true,
  language: "en",
  familyFit: { family: "IT Project Manager", confidence: 0.9 },
  requirements: [
    {
      id: "own-budget",
      band: "essential",
      requirement: "Own a project budget with vendor oversight",
      sourceSpan: "Own a project budget with vendor oversight",
    },
    {
      id: "lead-team",
      band: "essential",
      requirement: "Lead a cross-functional delivery team",
      sourceSpan: "Lead a cross-functional delivery team",
    },
    {
      id: "certification",
      band: "nice-to-have",
      requirement: "Hold a project management certification",
      sourceSpan: "Hold a project management certification",
    },
  ],
};
const [OWN_BUDGET, LEAD_TEAM, CERTIFICATION] = AD.requirements as [AdRequirementV1, AdRequirementV1, AdRequirementV1];

let seqCounter = 0;
// A tailor-scoped claim exactly as the retired answer route wrote it (the stored claims of past
// answers stay as they are — no data step — so the readers below must still understand them).
const claimFor = (
  adId: string,
  req: AdRequirementV1,
  answer: string,
  decision: "confirmed" | "negative",
): ClaimRecord => ({
  id: tailorClaimId(adId, req.id),
  role: "profile",
  text: decision === "negative" ? `Not applicable — ${req.requirement}` : `${req.requirement}.`,
  machine_touch: "verbatim",
  classification: "Verified",
  source_quote: answer.slice(0, 200),
  needs_grill: false,
  grill_hint: null,
  decision,
  origin: "user-authored",
  seq: ++seqCounter,
});
const yesClaim = (req: AdRequirementV1) => claimFor(AD.adId, req, "Yes", "confirmed");
const noClaim = (req: AdRequirementV1) => claimFor(AD.adId, req, "No", "negative");

describe("#23 tailorClaimId", () => {
  it("is a valid kebab-case slug even when the adId carries underscores (the E5 stub's date-slug ids)", () => {
    const id = tailorClaimId("2026-07-05_manulife_senior-project-manager", "own-budget");
    expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(id).toBe("tailor-2026-07-05-manulife-senior-project-manager-own-budget");
  });

  it("is deterministic and distinct per (adId, requirementId)", () => {
    expect(tailorClaimId("ad", "r1")).toBe(tailorClaimId("ad", "r1"));
    expect(tailorClaimId("ad", "r1")).not.toBe(tailorClaimId("ad", "r2"));
    expect(tailorClaimId("ad", "r1")).not.toBe(tailorClaimId("other", "r1"));
  });
});

describe("#23 negativeRequirementIds", () => {
  it("returns exactly the requirement ids with a recorded tailor negative for this ad", () => {
    const ids = negativeRequirementIds(AD, [noClaim(OWN_BUDGET), noClaim(CERTIFICATION)]);
    expect([...ids].sort()).toEqual(["certification", "own-budget"]);
  });

  it("is empty when nothing has been answered 'no' for this ad", () => {
    expect(negativeRequirementIds(AD, [])).toEqual(new Set());
  });

  it("never matches a negative recorded against a DIFFERENT ad (claim ids are ad-scoped)", () => {
    const foreign = claimFor("some-other-ad", OWN_BUDGET, "No", "negative");
    expect(negativeRequirementIds(AD, [foreign])).toEqual(new Set());
  });
});

// --- #415 (ADR-0020 clause 6): the requirements list behind "Where you fit" and "Also asked" ------

const POSTING: Posting = {
  id: AD.adId,
  title: "Senior Project Manager",
  company: "Acme",
  location: "Paris, France",
  keywords: [],
  excerpt: "Lead delivery.",
  language: "en",
};
const judgement = (fits: Record<string, number>) => ({
  verdicts: AD.requirements.map((r) => ({
    requirementId: r.id,
    fit: fits[r.id] ?? 0,
    supportingFactId: null,
    reason: fits[r.id] !== undefined && fits[r.id]! >= 0.8 ? "you have done this" : "partial",
  })),
  version: "test",
  cost: { model: "fake-judge", inputTokens: 1, outputTokens: 1, judgedAt: new Date().toISOString() },
});

describe("#415 buildTailorState.requirements — every requirement of the job, in the job's own order", () => {
  it("names each requirement met, gap or untested, in the job's order — never re-sorted by band", () => {
    // own-budget met (0.9), lead-team in part (0.5 — under the threshold is a gap, as the card
    // computes it), certification denied (a planted 'No' — a gap too, ADR-0020 clause 6).
    const state = buildTailorState(POSTING, AD, [], [noClaim(CERTIFICATION)], judgement({ "own-budget": 0.9, "lead-team": 0.5 }));
    expect(state.requirements).toEqual([
      { id: "own-budget", text: OWN_BUDGET.requirement, state: "met" },
      { id: "lead-team", text: LEAD_TEAM.requirement, state: "gap" },
      { id: "certification", text: CERTIFICATION.requirement, state: "gap" },
    ]);
    // The same verdicts the card carries: the met row is the card's fit row, the gaps are its
    // open and denied rows — one list, never a second scorer.
    expect(state.card.fit.map((f) => f.id)).toEqual(["own-budget"]);
    expect(state.card.dontYet.map((r) => r.id)).toEqual(["lead-team"]);
    expect(state.card.askedClosed.map((f) => f.id)).toEqual([tailorClaimId(AD.adId, CERTIFICATION.id)]);
  });

  it("a years bar the record could not test reads 'untested', not a gap (#162 AC6 flows through)", () => {
    const yearsAd: AdRequirementsV1 = {
      ...AD,
      requirements: [
        { id: "years", band: "essential", requirement: "8+ years of IT experience", sourceSpan: "8+ years", eligibilityDimension: "years-experience" },
        ...AD.requirements,
      ],
    };
    const untestable = { total: null, family: null, familySource: "unscoped", familyConfidence: null } as const;
    const state = buildTailorState(POSTING, yearsAd, [], [], null, untestable);
    expect(state.requirements[0]).toEqual({ id: "years", text: "8+ years of IT experience", state: "untested" });
    expect(state.requirements.slice(1).every((r) => r.state === "gap")).toBe(true);
  });

  it("the queue is the profile questions alone — no requirement is ever a question", () => {
    const state = buildTailorState(POSTING, AD, [], [], judgement({}));
    expect(state.questions).toEqual([]);
    expect(state).not.toHaveProperty("ledger");
    expect(state).not.toHaveProperty("doors");
    expect(state).not.toHaveProperty("closedGaps");
  });
});

// --- #423: "The job" tab marks the line each suggestion answers ------------------------------------

describe("#423 buildTailorState.requirements[].line — the job line a requirement was drawn from", () => {
  const lineOfEach = (excerpt: string) =>
    buildTailorState({ ...POSTING, excerpt }, AD, [], [], judgement({})).requirements.map((r) => r.line);

  it("is found from the reader's stored source words, as an index into the card's text split on line breaks", () => {
    const excerpt = [
      "Senior Project Manager",
      "",
      "What you will do:",
      "- OWN a project budget, with vendor oversight.", // case, punctuation and the bullet differ
      "- Lead a cross-functional", // the source words run on to the next line
      "  delivery team",
      "Nice to have: a PM certificate.", // the certification's source words are on no line
    ].join("\n");
    expect(lineOfEach(excerpt)).toEqual([3, 4, undefined]);
    const state = buildTailorState({ ...POSTING, excerpt }, AD, [], [], judgement({}));
    expect(state.card.adExcerpt.split("\n")[3]).toBe("- OWN a project budget, with vendor oversight.");
  });

  it("a line holding all the source words wins over an earlier line they only start with", () => {
    const excerpt = ["Own a project budget", "", "- Own a project budget with vendor oversight"].join("\n");
    expect(lineOfEach(excerpt)[0]).toBe(2);
    // …and with no such line, the line they start with is the one — the longest, never a short
    // heading the quote happens to open with.
    expect(lineOfEach("Own a project budget\nwith vendor oversight")[0]).toBe(0);
    expect(lineOfEach("Own\n\n- Own a project budget with\n  vendor oversight")[0]).toBe(2);
  });

  it("an empty or punctuation-only line never matches, and neither does a part-word", () => {
    expect(lineOfEach("•\n\n—\nOwn a project budge\nWe disown a project budget with vendor oversights")).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});

// --- routes ---
async function anonSession(app: ReturnType<typeof buildServer>["app"]): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/sessions/anonymous" });
  return `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
}
const get = (app: ReturnType<typeof buildServer>["app"], cookie: string, url: string) =>
  app.inject({ method: "GET", url, headers: { cookie } });
const post = (
  app: ReturnType<typeof buildServer>["app"],
  cookie: string,
  url: string,
  payload?: unknown,
) => app.inject({ method: "POST", url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });
async function signIn(app: ReturnType<typeof buildServer>["app"], cookie: string, email: string): Promise<void> {
  const link = await post(app, cookie, "/auth/request-link", { email });
  const token = new URL("http://x" + link.json().devLink).searchParams.get("token")!;
  await post(app, cookie, "/auth/verify", { token });
}

const ROLE = "IT project manager in Paris";
// The curated requirement corpus is keyed by the fixture id; a card and the /want route speak the
// id retrieval delivers. #63 made those two different strings, so both names exist here.
const FIXTURE_AD_ID = "2026-07-05_endava-vietnam_senior-project-manager";
const VALID_AD_ID = liveIdFor(FIXTURE_AD_ID);
const END_TO_END = "end-to-end-delivery";
const STAKEHOLDERS = "stakeholder-coordination";
const RISKS = "risk-dependency-control";
const COMMUNICATION = "delivery-communication";

/** One discovery answer exactly as the pre-#339 answer route wrote it: id `discovery-<item>`,
 *  semantic_key the bare item id, the visitor's own words as the line. */
const floorClaim = (itemId: string, text: string, answer: string): CandidateClaim => ({
  id: discoveryClaimId(itemId),
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
/** #339: discovery no longer asks the floor and the deck no longer waits on it, but these tests read
 *  the four answers it used to record (factCount's 4, the RISKS "No"), so they are planted in the
 *  claims store exactly as the old route wrote them. */
async function plantFloorAnswers(claims: ReturnType<typeof buildServer>["claims"], sid: string) {
  await claims.add(sid, floorClaim(END_TO_END, "Owned delivery from planning through completion.", "Yes"));
  await claims.add(sid, floorClaim(STAKEHOLDERS, "Business, engineering, and vendors.", "Business, engineering, and vendors"));
  await claims.answerNegative(
    sid,
    floorClaim(RISKS, "Not applicable — Have you acted on delivery risks, dependencies, timelines, or budgets?", "No"),
  );
  await claims.add(sid, floorClaim(COMMUNICATION, "Weekly steering updates.", "Weekly steering updates"));
}

/** Question 1 + the planted floor answers -> deck -> sign in -> want -> tailor. Exact prior art:
 *  cards.test.ts's own flow. */
async function reachTailor(
  { app, claims }: Pick<ReturnType<typeof buildServer>, "app" | "claims">,
  cookie: string,
  email: string,
) {
  await post(app, cookie, "/onboarding/discovery/start", { role: ROLE });
  await plantFloorAnswers(claims, (await get(app, cookie, "/sessions/me")).json().id as string);
  await signIn(app, cookie, email);
  await warmRetrieval(app, cookie); // #63: the advert exists for this session once retrieval delivers it
  await post(app, cookie, `/onboarding/cards/${VALID_AD_ID}/want`);
}

describe("#23 GET /onboarding/tailor", () => {
  it("409s with no_tailor_target when no job is being tailored", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await signIn(app, cookie, "no-target@example.com");
    const res = await get(app, cookie, "/onboarding/tailor");
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: { code: "no_tailor_target", message: "no job being tailored" } });
  });

  it("returns the pinned TailorState shape once a job is targeted: profile questions only, every requirement in the job's order", async () => {
    const { app, claims } = buildServer();
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "first-get@example.com");

    const res = await get(app, cookie, "/onboarding/tailor");
    expect(res.statusCode).toBe(200);
    const state = res.json();
    expect(state.card.adId).toBe(VALID_AD_ID);
    // #415: never a requirement as a yes/no — the queue holds profile questions (work rights, a
    // language) or nothing, and the draft is the first thing the person sees.
    expect(state.questions.every((q: { kind?: string }) => q.kind === "profile")).toBe(true);
    expect(state.questions.some((q: { question: string }) => q.question.includes("Does that describe you?"))).toBe(false);
    const adReq = loadAdRequirements(FIXTURE_AD_ID);
    expect(state.requirements.map((r: { id: string }) => r.id)).toEqual(adReq.requirements.map((r) => r.id));
    expect(state.requirements.every((r: { state: string }) => ["met", "gap", "untested"].includes(r.state))).toBe(true);
    for (const key of ["ledger", "closedGaps", "cvLines", "doors", "done"]) expect(state).not.toHaveProperty(key);
    expect(typeof state.factCount).toBe("number");
    expect(state.factCount).toBeGreaterThanOrEqual(4); // the 4 discovery answers already recorded
  });

  it("a stored denial reads as a gap on the list and is named on the card — with no door anywhere on the wire", async () => {
    const { app, claims } = buildServer();
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "stored-denial@example.com");
    const sid = (await get(app, cookie, "/sessions/me")).json().id as string;
    const req = loadAdRequirements(FIXTURE_AD_ID).requirements.find((r) => !r.eligibilityDimension)!;
    await claims.answerNegative(sid, {
      ...floorClaim(req.id, `Not applicable — ${req.requirement}`, "No"),
      id: tailorClaimId(VALID_AD_ID, req.id),
    });

    const state = (await get(app, cookie, "/onboarding/tailor")).json();
    // #423: over the wire too, the row names the line of the job's text its source words came from
    // (this fixture quotes its line verbatim, so it is the first line holding the quote).
    const line = (state.card.adExcerpt as string).split("\n").findIndex((l) => l.includes(req.sourceSpan));
    expect(line).toBeGreaterThan(-1);
    expect(state.requirements.find((r: { id: string }) => r.id === req.id)).toEqual({ id: req.id, text: req.requirement, state: "gap", line });
    expect(state.card.askedClosed.map((f: { id: string }) => f.id)).toContain(tailorClaimId(VALID_AD_ID, req.id));
    expect(state.card.dontYet.map((r: { id: string }) => r.id)).not.toContain(req.id);
    expect(JSON.stringify(state)).not.toContain("Changed? Add it");
  });
});

describe("#415 the requirement answer route is gone", () => {
  it("POST /onboarding/tailor/answer is a 404, even with a job being tailored", async () => {
    const { app, claims } = buildServer();
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "no-answer-door@example.com");
    const req = loadAdRequirements(FIXTURE_AD_ID).requirements[0]!;
    const res = await post(app, cookie, "/onboarding/tailor/answer", { requirementId: req.id, answer: "Yes" });
    expect(res.statusCode).toBe(404);
    // The positive pair: the tailor target really is set, so the 404 is the door's, not a 409.
    expect((await get(app, cookie, "/onboarding/tailor")).statusCode).toBe(200);
  });
});

describe("#23 factCount on the tailor seam", () => {
  // #106 code-review D1 (2026-08-03, round 3): buildTailorState's own factCount is a SEPARATE
  // emission point from /profile's — a decline used to inflate this one too, unfiltered.
  it("a declined eligibility question does not inflate tailor's factCount (D1)", async () => {
    const { app, claims } = buildServer();
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "elig-decline-factcount@example.com");
    const before = (await get(app, cookie, "/onboarding/tailor")).json();

    // #376: discovery no longer serves it; the answer route still answers the composed question.
    const workRights = eligibilityCandidates(ANY_FAMILY, [])[0]!;
    const declined = await post(app, cookie, "/onboarding/discovery/answer", { itemId: workRights.itemId, answer: DECLINE_OPTION });
    expect(declined.statusCode).toBe(200);
    // #63: answering a discovery question changes this session's evidence, which correctly stales
    // the retrieval snapshot the tailor target resolves against - #101's decided fail-closed rule,
    // pinned by postingRetrievalHttp.test.ts. The client returns to the deck and swipes again; that
    // is what these two lines are. What is being measured, factCount on the tailor seam, is
    // untouched by the detour.
    await warmRetrieval(app, cookie);
    await post(app, cookie, `/onboarding/cards/${VALID_AD_ID}/want`);

    const after = (await get(app, cookie, "/onboarding/tailor")).json();
    expect(after.factCount).toBe(before.factCount);
  });

  // #33 — a claim rejected in the S2 review deck really does lower the raw confirmed+negatives count,
  // but the badge's server-side floor must not let ANY of the factCount-emitting routes show a
  // drop (AC4: the guarantee lives at the API seam, not the per-mount client clamp — so every seam
  // that emits factCount needs its own proof, not just the two GETs).
  it("factCount holds at its peak across every emission seam, even after a deck reject (#33)", async () => {
    const { app, claims } = buildServer();
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "fact-floor@example.com");
    const sid = (await get(app, cookie, "/sessions/me")).json().id as string;

    // One genuinely new fact, so peak (5) sits strictly above what the post-reject raw count (4)
    // will be — otherwise a dropped floor on the tailor seam would coincidentally still read 4 and
    // this test wouldn't catch it. #415: no tailor answer records a fact any more, so the fifth is
    // planted the way the four floor answers are.
    await claims.add(sid, floorClaim("one-more", "Ran the vendor tender end to end.", "Yes"));
    // #63: a new fact stales the retrieval snapshot the target resolves against — re-swipe, as the
    // client does from the deck.
    await warmRetrieval(app, cookie);
    await post(app, cookie, `/onboarding/cards/${VALID_AD_ID}/want`);
    const peak = (await get(app, cookie, "/onboarding/tailor")).json().factCount as number;
    expect(peak).toBe(5);

    // Reject one of the discovery claims in the deck — the raw count really does shrink. Assert the
    // reject actually landed on the store (not just a 200 — InMemoryClaimStore.reject is a silent
    // no-op on an unknown id), or a broken claim-id scheme would make this test pass for the wrong
    // reason — exactly the "floor keyed to the wrong thing silently stops firing" failure #31 warned about.
    const claimId = discoveryClaimId(END_TO_END);
    expect((await claims.confirmed(sid)).map((c) => c.id)).toContain(claimId); // present before...
    const rejectRes = await post(app, cookie, `/onboarding/claims/${claimId}/reject`);
    expect(rejectRes.statusCode).toBe(200);
    expect((await claims.confirmed(sid)).map((c) => c.id)).not.toContain(claimId); // ...gone after — raw is now 4
    // #63: the reject changed this session's evidence, which stales the retrieval snapshot the
    // tailor target resolves against (#101's decided fail-closed rule). The client is on the deck
    // when it rejects a claim and swipes back onto the card from there; these two lines are that.
    await warmRetrieval(app, cookie);
    await post(app, cookie, `/onboarding/cards/${VALID_AD_ID}/want`);

    const seams: [string, () => Promise<{ factCount: number }>][] = [
      ["GET /onboarding/tailor", () => get(app, cookie, "/onboarding/tailor").then((r) => r.json())],
      ["GET /onboarding/discovery", () => get(app, cookie, "/onboarding/discovery").then((r) => r.json())],
      [
        "POST /onboarding/discovery/start",
        () => post(app, cookie, "/onboarding/discovery/start", { role: ROLE }).then((r) => r.json()),
      ],
      [
        "POST /onboarding/discovery/answer",
        // #339: the route takes eligibility answers only, so this seam declines one — a decline
        // stores nothing, so it cannot grow the raw count back up to peak on its own. #376: none is
        // served by discovery any more; the composed question is the one the route looks up.
        async () => {
          const open = eligibilityCandidates(ANY_FAMILY, [])[0]!;
          return post(app, cookie, "/onboarding/discovery/answer", {
            itemId: open.itemId,
            answer: DECLINE_OPTION,
          }).then((r) => r.json());
        },
      ],
    ];
    const results: Record<string, number> = {};
    for (const [name, read] of seams) results[name] = (await read()).factCount;
    expect(results).toEqual(Object.fromEntries(seams.map(([name]) => [name, peak])));
  });
});

// Review fix B3 (standards MUST-FIX): session.tailorAdId is persisted state that can outlive the
// fixture pair that validated it at /want time. Simulate that drift directly via the session store
// (bypassing /want's own validation) rather than editing the fixture files — same observable effect.
describe("#23 B3 — a stale/invalid tailor target fails closed with a 404, not a crash", () => {
  it("GET /tailor 404s (not 500) when tailorAdId no longer resolves", async () => {
    const { app, sessions } = buildServer();
    const cookie = await anonSession(app);
    await signIn(app, cookie, "b3-stale-target@example.com");
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;
    await sessions.setTailorTarget(sid, "not-a-real-ad-id", null); // the fixture pair has since drifted

    const getRes = await get(app, cookie, "/onboarding/tailor");
    expect(getRes.statusCode).toBe(404);
    expect(getRes.json()).toEqual({ error: { code: "not_found", message: "unknown card" } });
  });
});

describe("#23 POST /onboarding/tailor/drop", () => {
  it("clears the tailor target and returns to deck WITHOUT losing a recorded fact", async () => {
    const { app, claims } = buildServer();
    const cookie = await anonSession(app);
    await reachTailor({ app, claims }, cookie, "drop-keeps-claims@example.com");
    const me = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sid = me.json().id as string;
    const before = await claims.list(sid);
    expect(before.length).toBeGreaterThan(0); // sanity: there is something to lose

    const res = await post(app, cookie, "/onboarding/tailor/drop");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ stage: "deck" });

    const meAfter = await app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    expect(meAfter.json().stage).toBe("deck");
    expect(meAfter.json().tailorAdId).toBeNull();

    // The tailor target is gone — the 409 re-triggers.
    expect((await get(app, cookie, "/onboarding/tailor")).statusCode).toBe(409);

    // But every claim is still there — "everything you told me stays on your profile."
    expect(await claims.list(sid)).toEqual(before);
  });

  it("works even with nothing currently targeted (idempotent no-op landing on deck)", async () => {
    const { app } = buildServer();
    const cookie = await anonSession(app);
    await signIn(app, cookie, "drop-noop@example.com");
    const res = await post(app, cookie, "/onboarding/tailor/drop");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ stage: "deck" });
  });
});

// --- #311 (#287): a "No" is named only where the posting asks, and never prints -----------------

describe("#311 advertDeniedRows — a denial is named only on a posting that asks for it", () => {
  const denial = (id: string, words: string): ClaimRecord => ({
    id,
    role: "profile",
    text: `Not applicable — ${words}`,
    machine_touch: "verbatim",
    classification: "Verified",
    source_quote: words.slice(0, 200),
    needs_grill: false,
    grill_hint: null,
    decision: "negative",
    origin: "user-authored",
    seq: ++seqCounter,
  });

  it("names this ad's own tailor 'No' by claim id, mapped to the requirement it answered", () => {
    const rows = advertDeniedRows(AD, [], [noClaim(OWN_BUDGET)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.claim.id).toBe(tailorClaimId(AD.adId, OWN_BUDGET.id));
    expect(rows[0]!.requirement.id).toBe(OWN_BUDGET.id);
  });

  it("names a foreign denial (a discovery 'No') when a requirement clause is covered by its words", () => {
    const rows = advertDeniedRows(AD, [], [denial("discovery-budget", "Own a project budget")]);
    expect(rows.map((r) => r.requirement.id)).toEqual([OWN_BUDGET.id]);
  });

  it("never names a denial nothing on this advert asks about — gaps are not recited on every card", () => {
    expect(advertDeniedRows(AD, [], [denial("discovery-danish", "Speak fluent Danish")])).toEqual([]);
  });

  // #311 QA gate defect 1: ONE shared domain-common word ("delivery" here; "project"/"stakeholder"
  // in the wild) half-covers a two-word clause like "delivery discipline", and had a single "No"
  // recited across most of the deck. Two shared words is the floor (anyClauseAsked) — one is never
  // "this posting asks for it".
  it("one shared common word is not an ask — the QA gate's exact repro stays unnamed", () => {
    const shortClauseAd: AdRequirementsV1 = {
      ...AD,
      requirements: [
        {
          id: "governance-discipline",
          band: "essential",
          requirement: "Drive governance, benefit realisation, and delivery discipline",
          sourceSpan: "Drive governance, benefit realisation, and delivery discipline",
        },
      ],
    };
    const titleDenial = denial("tailor-other-ad-title", "Prior title of Delivery Manager or equivalent");
    expect(advertDeniedRows(shortClauseAd, [], [titleDenial])).toEqual([]);
  });

  it("drops the row once a confirmed fact covers the ask — the fact prints in fit on its own merit", () => {
    const negatives = [noClaim(OWN_BUDGET)];
    expect(advertDeniedRows(AD, [], negatives)).toHaveLength(1);
    expect(advertDeniedRows(AD, [yesClaim(OWN_BUDGET)], negatives)).toEqual([]);
  });
});

describe("#311 deniedCapabilities — the page's never-print list", () => {
  it("carries each denial in its own words, answer scaffolding stripped", () => {
    expect(deniedCapabilities([noClaim(OWN_BUDGET)], [])).toEqual([
      "Own a project budget with vendor oversight",
    ]);
  });

  it("drops a denial a confirmed claim now states — the person's own fact outranks the old 'No'", () => {
    const stated: ClaimRecord = { ...yesClaim(OWN_BUDGET), id: "review-own-budget" };
    expect(deniedCapabilities([noClaim(OWN_BUDGET)], [stated])).toEqual([]);
    // An unrelated confirmed fact supersedes nothing.
    expect(deniedCapabilities([noClaim(OWN_BUDGET)], [yesClaim(LEAD_TEAM)])).toHaveLength(1);
  });
});
