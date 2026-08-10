// #20 profile screen (Sorted + Constellation) — the colour law derivation over HTTP, the spec's
// pinned seam (#11). Prior art: onboarding.test.ts (deck/build over real requests), discovery.test.ts
// (anonSession/signIn helpers for pre-wall vs post-wall routes).
import { describe, expect, it } from "vitest";
import type { CandidateClaim } from "@jobcrush/contracts";
import { buildServer } from "../src/server.js";
import { isTerminal } from "../src/jobs.js";
import { DECLINE_OPTION, languagesQuestion as composeLanguagesQuestion } from "../src/eligibilityDiscovery.js";

const claim = (over: Partial<CandidateClaim>): CandidateClaim => ({
  id: "acme-led-migration",
  semantic_key: over.id ?? "acme-led-migration",
  field_key: null,
  field_value: null,
  field_label: null,
  role: "Acme — PM",
  text: "Led the checkout replatform, delivered 2 months early.",
  machine_touch: "verbatim",
  classification: "Verified",
  source_quote: "Led checkout replatform",
  needs_grill: false,
  grill_hint: null,
  ...over,
});

// Three mined claims spanning distinct root-CV sections (experience, cert, skill) — same fixture
// shape as onboarding.test.ts's MINED, reused here to exercise domain grouping/ordering.
const MINED: CandidateClaim[] = [
  claim({ id: "acme-led-migration" }),
  claim({ id: "cert-pmp", role: "profile", text: "PMP, 2021." }),
  claim({ id: "skill-jira", role: "profile", text: "Jira" }),
];

function fakePipeline() {
  return { mine: async () => ({ doc: null, claims: MINED, roles: 1, needsGrill: 0 }) };
}

async function anonSession(app: ReturnType<typeof buildServer>["app"]): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/sessions/anonymous" });
  return `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
}

const get = (app: ReturnType<typeof buildServer>["app"], cookie: string, url: string) =>
  app.inject({ method: "GET", url, headers: { cookie } });
const post = (app: ReturnType<typeof buildServer>["app"], cookie: string, url: string, payload?: unknown) =>
  app.inject({ method: "POST", url, headers: { cookie }, payload });
const put = (app: ReturnType<typeof buildServer>["app"], cookie: string, url: string, payload?: unknown) =>
  app.inject({ method: "PUT", url, headers: { cookie }, payload });

async function signIn(app: ReturnType<typeof buildServer>["app"], cookie: string, email: string): Promise<void> {
  const link = await post(app, cookie, "/auth/request-link", { email });
  const token = new URL("http://x" + link.json().devLink).searchParams.get("token")!;
  await post(app, cookie, "/auth/verify", { token });
}

async function waitTerminal(server: ReturnType<typeof buildServer>, jobId: string) {
  await new Promise<void>((resolve) => {
    const un = server.store.subscribe(jobId, (j) => {
      if (isTerminal(j.status)) {
        un();
        resolve();
      }
    });
    void server.store.get(jobId).then((j) => {
      if (j && isTerminal(j.status)) {
        un();
        resolve();
      }
    });
  });
}

async function mineAndGetJob(server: ReturnType<typeof buildServer>, cookie: string) {
  const created = await server.app.inject({
    method: "POST",
    url: "/cv/paste",
    headers: { cookie },
    payload: { text: "Experience\nPM at Acme 2020 - 2024\n- shipped things\n".repeat(5) },
  });
  const { jobId } = created.json();
  await waitTerminal(server, jobId);
  return jobId as string;
}

const ROLE = "IT project manager in Paris, mostly ERP";

interface ProfileFact {
  id: string;
  text: string;
  colour: "gold" | "grey";
  source: "told" | "read";
  job: string | null;
}
interface ProfileContactField {
  value: string;
  origin: "read" | "person-said";
}
interface ProfileWorkRights {
  market: string;
  answer: string | null;
  questionId: string;
  question: string;
  options: string[];
}
interface ProfileLanguagesQuestion {
  questionId: string;
  question: string;
  consequence: string | null;
  options: string[];
  answer: string[] | null;
}
interface ProfileResponse {
  domains: Array<{ tag: string; heading: string; facts: ProfileFact[] }>;
  factCount: number;
  search: { role: string | null; family: string | null; siblingTitles: string[]; openJobs: number | null };
  contact: { phone: ProfileContactField | null; email: ProfileContactField | null };
  location: { area: string | null; workRights: ProfileWorkRights | null };
  languagesQuestion: ProfileLanguagesQuestion;
}

// #179: until E5 places typed roles into families, the search block is the honest empty state for
// everyone — role exactly as typed, and NO family/siblings/count (never the resolveFamily stub).
const EMPTY_SEARCH = (role: string | null) => ({ role, family: null, siblingTitles: [], openJobs: null });
// #190: honest absence — no contact record yet.
const EMPTY_CONTACT = { phone: null, email: null };
// #185: honest absence — no search area set yet, so no market to hold a work-rights answer either.
const EMPTY_LOCATION = { area: null, workRights: null };
// #185 code-review contract extension: the languages question composed the SAME way
// eligibilityDiscovery.ts's buildQuestion composes it — imported directly (never hand-copied text)
// so this fixture can never drift from the shipped copy. `answer: null` — the honest never-answered
// state every fresh session starts in.
const LANGUAGES_COMPOSITION = composeLanguagesQuestion();
const UNANSWERED_LANGUAGES_QUESTION: ProfileLanguagesQuestion = {
  questionId: LANGUAGES_COMPOSITION.itemId,
  question: LANGUAGES_COMPOSITION.question,
  consequence: LANGUAGES_COMPOSITION.consequence ?? null,
  options: LANGUAGES_COMPOSITION.options,
  answer: null,
};

describe("#20 profile screen — the colour law over HTTP", () => {
  it("returns gold confirmed facts, grey pending facts under the current product decision, and no rejected facts", async () => {
    const server = buildServer({ pipeline: fakePipeline() });
    const cookie = await anonSession(server.app);
    await signIn(server.app, cookie, "e2e@example.com");
    const jobId = await mineAndGetJob(server, cookie);
    await post(server.app, cookie, "/onboarding/deck", { jobId });

    // Confirm the experience claim (→ rendered → gold), leave the cert claim pending (never
    // confirmed → not rendered → grey), reject the skill claim (must vanish from the profile).
    await post(server.app, cookie, "/onboarding/claims/acme-led-migration/confirm");
    await post(server.app, cookie, "/onboarding/claims/skill-jira/reject");

    const res = await get(server.app, cookie, "/profile");
    expect(res.statusCode).toBe(200);
    const { domains, factCount } = res.json() as ProfileResponse;

    // Domain order matches rootcv.ts's SECTIONS order (experience before cert), not insertion order.
    expect(domains.map((d) => d.tag)).toEqual(["experience", "cert"]);
    // The badge count is the server's confirmed+negative monotonic count, not the number of visible facts.
    expect(factCount).toBe(1);

    const experience = domains.find((d) => d.tag === "experience")!;
    expect(experience.heading).toBe("Professional Experience");
    // #185: the job attribution is the claim's own `role` text — "Acme — PM", the MINED fixture's job line.
    expect(experience.facts).toEqual([
      { id: "acme-led-migration", text: expect.any(String), colour: "gold", source: "read", job: "Acme — PM" },
    ]);

    const cert = domains.find((d) => d.tag === "cert")!;
    expect(cert.facts.map((f) => f.id)).toEqual(["cert-pmp"]);
    // #185: a non-experience fact carries no job attribution.
    expect(cert.facts[0]).toMatchObject({ colour: "grey", source: "read", job: null });

    // The rejected claim is gone entirely — no domain lists it, gold or grey.
    const allIds = domains.flatMap((d) => d.facts.map((f) => f.id));
    expect(allIds).not.toContain("skill-jira");
  });

  it("source follows claim origin, not the claim id prefix", async () => {
    const server = buildServer({ pipeline: fakePipeline() });
    const cookie = await anonSession(server.app);
    await signIn(server.app, cookie, "e2e2@example.com");
    const jobId = await mineAndGetJob(server, cookie);
    await post(server.app, cookie, "/onboarding/deck", { jobId });
    await put(server.app, cookie, "/onboarding/claims/acme-led-migration", {
      text: "Led the checkout replatform as programme owner.",
    });
    await post(server.app, cookie, "/onboarding/claims/cert-pmp/confirm");

    const { domains } = (await get(server.app, cookie, "/profile")).json() as ProfileResponse;
    const facts = domains.flatMap((d) => d.facts);
    const told = facts.find((f) => f.id === "acme-led-migration")!;
    const read = facts.find((f) => f.id === "cert-pmp")!;
    expect(told.source).toBe("told");
    expect(read.source).toBe("read");
  });

  it("returns the session-wide floored factCount even when visible profile facts shrink", async () => {
    const server = buildServer({ pipeline: fakePipeline() });
    const cookie = await anonSession(server.app);
    await post(server.app, cookie, "/onboarding/discovery/start", { role: ROLE });
    const answered = await post(server.app, cookie, "/onboarding/discovery/answer", {
      itemId: "budget-accountability",
      answer: "Yes, over $1M",
    });
    expect(answered.json().factCount).toBe(1);

    await signIn(server.app, cookie, "e2e3@example.com");
    await post(server.app, cookie, "/onboarding/claims/discovery-budget-accountability/reject");

    const res = await get(server.app, cookie, "/profile");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      domains: [],
      factCount: 1,
      search: EMPTY_SEARCH(ROLE),
      contact: EMPTY_CONTACT,
      location: EMPTY_LOCATION,
      languagesQuestion: UNANSWERED_LANGUAGES_QUESTION,
    });
  });

  it("an empty profile (no claims yet) is 200 with no domains, not an error", async () => {
    const server = buildServer();
    const cookie = await anonSession(server.app);
    const res = await get(server.app, cookie, "/profile");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      domains: [],
      factCount: 0,
      search: EMPTY_SEARCH(null),
      contact: EMPTY_CONTACT,
      location: EMPTY_LOCATION,
      languagesQuestion: UNANSWERED_LANGUAGES_QUESTION,
    });
  });

  // #179 decision (2026-08-09): the rail's Job family data. Until E5 (#86) places roles, the
  // machine displays no family it cannot honestly attribute — the internal resolveFamily() stub
  // (which places EVERY role in "IT Project Manager") must never leak into this payload.
  it("#179: search carries the role exactly as typed and no stub family", async () => {
    const server = buildServer();
    const cookie = await anonSession(server.app);
    await post(server.app, cookie, "/onboarding/discovery/start", { role: ROLE });

    const { search } = (await get(server.app, cookie, "/profile")).json() as ProfileResponse;
    expect(search).toEqual(EMPTY_SEARCH(ROLE));
    expect(search.role).toBe("IT project manager in Paris, mostly ERP"); // verbatim, never cleaned
    expect(search.family).not.toBe("IT Project Manager"); // the stub's one answer must not surface
  });

  // #106 code-review D1 (2026-08-03, round 3): a decline used to write a claim /profile's factCount
  // counted unfiltered — "9 things you've told me" while listing 7, permanently (the monotonic floor
  // never lowers). /profile must apply the same eligibility exclusion the discovery routes already do.
  it("a declined eligibility question does not inflate /profile's factCount (D1)", async () => {
    const server = buildServer();
    const cookie = await anonSession(server.app);
    const start = (await post(server.app, cookie, "/onboarding/discovery/start", { role: ROLE })).json() as {
      questions: Array<{ itemId: string; eligibility?: { dimension: string } }>;
    };
    const workRights = start.questions.find((q) => q.eligibility?.dimension === "work-rights")!;

    const before = (await get(server.app, cookie, "/profile")).json() as ProfileResponse;
    await post(server.app, cookie, "/onboarding/discovery/answer", {
      itemId: workRights.itemId,
      answer: DECLINE_OPTION,
    });
    const after = (await get(server.app, cookie, "/profile")).json() as ProfileResponse;

    expect(after.factCount).toBe(before.factCount);
  });

  // #190 ACs: mined phone/email land on the profile with a "read" origin pointing at the source
  // words, and a correction through the door shows "person-said" — the other field, untouched by
  // the correction, keeps its own "read" origin.
  it("#190: a mined phone/email show read origin; correcting one leaves the other alone", async () => {
    const server = buildServer({ pipeline: fakePipeline() });
    const cookie = await anonSession(server.app);
    const created = await server.app.inject({
      method: "POST",
      url: "/cv/paste",
      headers: { cookie },
      payload: {
        text: "Jane Doe\njane@example.com | +33 6 00 00 00 00\n\nExperience\nPM at Acme 2020 - 2024\n- shipped things\n".repeat(
          5,
        ),
      },
    });
    const { jobId } = created.json();
    await waitTerminal(server, jobId);

    const before = (await get(server.app, cookie, "/profile")).json() as ProfileResponse;
    expect(before.contact.phone).toEqual({ value: "+33 6 00 00 00 00", origin: "read" });
    expect(before.contact.email).toEqual({ value: "jane@example.com", origin: "read" });

    await put(server.app, cookie, "/contact", { field: "phone", value: "+33 6 99 99 99 99" });
    const after = (await get(server.app, cookie, "/profile")).json() as ProfileResponse;
    expect(after.contact.phone).toEqual({ value: "+33 6 99 99 99 99", origin: "person-said" });
    expect(after.contact.email).toEqual({ value: "jane@example.com", origin: "read" });
  });

  // #190 AC: a CV with no phone is an honest absence, and a value supplied through the door flows
  // exactly like a correction (person-said, immediately readable).
  it("#190: no phone on the CV shows honest absence; supplying one through the door lands as person-said", async () => {
    const server = buildServer({ pipeline: fakePipeline() });
    const cookie = await anonSession(server.app);
    const created = await server.app.inject({
      method: "POST",
      url: "/cv/paste",
      headers: { cookie },
      payload: { text: "Jane Doe\njane@example.com\n\nExperience\nPM at Acme 2020 - 2024\n- shipped things\n".repeat(5) },
    });
    const { jobId } = created.json();
    await waitTerminal(server, jobId);

    const before = (await get(server.app, cookie, "/profile")).json() as ProfileResponse;
    expect(before.contact.phone).toBeNull();

    await put(server.app, cookie, "/contact", { field: "phone", value: "+33 6 99 99 99 99" });
    const after = (await get(server.app, cookie, "/profile")).json() as ProfileResponse;
    expect(after.contact.phone).toEqual({ value: "+33 6 99 99 99 99", origin: "person-said" });
  });

  // #190 AC: the login/account email and the CV's contact email are different values with different
  // jobs — signing in with one email must never surface it as (or overwrite) the CV's own email.
  it("#190: the login email and the CV's contact email are never conflated", async () => {
    const server = buildServer({ pipeline: fakePipeline() });
    const cookie = await anonSession(server.app);
    const created = await server.app.inject({
      method: "POST",
      url: "/cv/paste",
      headers: { cookie },
      payload: {
        text: "Jane Doe\ncv-contact@example.com | +33 6 00 00 00 00\n\nExperience\nPM at Acme 2020 - 2024\n- shipped things\n".repeat(
          5,
        ),
      },
    });
    const { jobId } = created.json();
    await waitTerminal(server, jobId);
    await signIn(server.app, cookie, "login-account@example.com");

    const { contact } = (await get(server.app, cookie, "/profile")).json() as ProfileResponse;
    expect(contact.email).toEqual({ value: "cv-contact@example.com", origin: "read" });
  });

  // #185 AC: the no-job group (tag "profile") heads the rail as "About you" and orders first — the
  // printed root CV's own "Professional Summary" heading must never leak onto the profile screen.
  it("#185: the no-job group is headed \"About you\" and orders first; \"Professional Summary\" never appears", async () => {
    const claims: CandidateClaim[] = [
      claim({ id: "acme-led-migration" }),
      claim({ id: "summary-headline", role: "profile", text: "Delivery-focused IT PM." }),
    ];
    const server = buildServer({ pipeline: { mine: async () => ({ doc: null, claims, roles: 1, needsGrill: 0 }) } });
    const cookie = await anonSession(server.app);
    await signIn(server.app, cookie, "e2e-about-you@example.com");
    const jobId = await mineAndGetJob(server, cookie);
    await post(server.app, cookie, "/onboarding/deck", { jobId });
    await post(server.app, cookie, "/onboarding/claims/acme-led-migration/confirm");
    await post(server.app, cookie, "/onboarding/claims/summary-headline/confirm");

    const { domains } = (await get(server.app, cookie, "/profile")).json() as ProfileResponse;
    expect(domains[0]).toMatchObject({ tag: "profile", heading: "About you" });
    expect(domains.map((d) => d.heading)).not.toContain("Professional Summary");
  });

  // #185 AC: experience facts from two jobs each carry their OWN job attribution.
  it("#185: experience facts from two jobs each carry their own job attribution", async () => {
    const claims: CandidateClaim[] = [
      claim({ id: "acme-led-migration", role: "Acme — PM", text: "Led the checkout replatform." }),
      claim({ id: "acme-second-fact", role: "Acme — PM", text: "Ran vendor negotiations." }),
      claim({ id: "globex-shipped", role: "Globex — Delivery Lead", text: "Shipped the ERP rollout." }),
    ];
    const server = buildServer({ pipeline: { mine: async () => ({ doc: null, claims, roles: 2, needsGrill: 0 }) } });
    const cookie = await anonSession(server.app);
    await signIn(server.app, cookie, "e2e-jobs@example.com");
    const jobId = await mineAndGetJob(server, cookie);
    await post(server.app, cookie, "/onboarding/deck", { jobId });
    await post(server.app, cookie, "/onboarding/claims/acme-led-migration/confirm");
    await post(server.app, cookie, "/onboarding/claims/acme-second-fact/confirm");
    await post(server.app, cookie, "/onboarding/claims/globex-shipped/confirm");

    const { domains } = (await get(server.app, cookie, "/profile")).json() as ProfileResponse;
    const experience = domains.find((d) => d.tag === "experience")!;
    const jobById = Object.fromEntries(experience.facts.map((f) => [f.id, f.job]));
    expect(jobById).toEqual({
      "acme-led-migration": "Acme — PM",
      "acme-second-fact": "Acme — PM",
      "globex-shipped": "Globex — Delivery Lead",
    });
  });

  // #185 code-review must-fix: AC5 ("rejected/negative facts absent") was only pinned for REJECTED
  // above — a "no" answer persists as a NEGATIVE decision (#13's answerNegative), a different code
  // path (routes/onboarding.ts's `c.decision !== "negative"` filter) that a refactor could drop
  // without this suite noticing. Pins the negative half at the same seam.
  it("#185 code-review must-fix: a negative ('no') fact appears in no group", async () => {
    const server = buildServer();
    const cookie = await anonSession(server.app);
    await post(server.app, cookie, "/onboarding/discovery/start", { role: ROLE });
    await post(server.app, cookie, "/onboarding/discovery/answer", {
      itemId: "budget-accountability",
      answer: "No",
    });

    const { domains } = (await get(server.app, cookie, "/profile")).json() as ProfileResponse;
    const allIds = domains.flatMap((d) => d.facts.map((f) => f.id));
    expect(allIds).not.toContain("discovery-budget-accountability");
  });

  // #185 AC: the rail's Location data reads the work-rights answer keyed to the CURRENT search
  // area's own market (#182's per-market keying) — an unanswered market is honest, never another
  // market's stored answer, and switching markets never bleeds a stale answer across (#182's own
  // Paris-then-Hong-Kong guarantee, exercised here at the profile seam). Also pins the code-review
  // contract extension: the rail's own questionId/question/options round-trip against the SAME
  // question the discovery route asked and the answer route accepts — never a client-composed id.
  describe("#185: the profile rail's Location data", () => {
    it("carries the area and this market's work-rights answer; switching markets never bleeds the old one", async () => {
      const server = buildServer();
      const cookie = await anonSession(server.app);
      await put(server.app, cookie, "/sessions/me/intent", { searchArea: "Hong Kong" });
      const start = (await post(server.app, cookie, "/onboarding/discovery/start", { role: ROLE })).json() as {
        questions: Array<{ itemId: string; question: string; options: string[]; eligibility?: { dimension: string } }>;
      };
      const workRights = start.questions.find((q) => q.eligibility?.dimension === "work-rights")!;

      const before = (await get(server.app, cookie, "/profile")).json() as ProfileResponse;
      // The rail's own question/options are byte-identical to the ones discovery/start actually
      // asked — never re-composed, never paraphrased — and its questionId is the SAME id the answer
      // route below accepts (the round-trip pin).
      expect(before.location).toEqual({
        area: "Hong Kong",
        workRights: {
          market: "Hong Kong",
          answer: null,
          questionId: workRights.itemId,
          question: workRights.question,
          options: workRights.options,
        },
      });

      await post(server.app, cookie, "/onboarding/discovery/answer", {
        itemId: before.location.workRights!.questionId, // the rail's own id, not a client-composed one
        answer: workRights.options[0], // "Yes — no sponsorship needed"
      });
      const afterAnswer = (await get(server.app, cookie, "/profile")).json() as ProfileResponse;
      expect(afterAnswer.location).toEqual({
        area: "Hong Kong",
        workRights: {
          market: "Hong Kong",
          answer: workRights.options[0],
          questionId: workRights.itemId,
          question: workRights.question,
          options: workRights.options,
        },
      });

      // Switch to a different covered market: Singapore's own (unanswered) state shows, with its
      // OWN question identity — never Hong Kong's stored "yes" or Hong Kong's questionId.
      await put(server.app, cookie, "/sessions/me/intent", { searchArea: "Singapore" });
      const afterSwitch = (await get(server.app, cookie, "/profile")).json() as ProfileResponse;
      expect(afterSwitch.location.workRights!.market).toBe("Singapore");
      expect(afterSwitch.location.workRights!.answer).toBeNull();
      expect(afterSwitch.location.workRights!.questionId).not.toBe(workRights.itemId);
    });

    it("an uncovered search area has no market to hold a work-rights answer", async () => {
      const server = buildServer();
      const cookie = await anonSession(server.app);
      await put(server.app, cookie, "/sessions/me/intent", { searchArea: "London" });

      const { location } = (await get(server.app, cookie, "/profile")).json() as ProfileResponse;
      expect(location).toEqual({ area: "London", workRights: null });
    });
  });

  // #185 code-review contract extension: the SAME re-open contract as work-rights, for the
  // languages door — the frontend review found it re-declared the question/options itself AND
  // pre-ticked from CV-mined claim text, either of which could silently misrepresent (or, on save,
  // flip) a real eligibility answer. Always present, and reads ONLY the eligibility store.
  describe("#185: the profile rail's languages question", () => {
    it("question/options are byte-identical to discovery's own, and a never-answered session reads answer: null", async () => {
      const server = buildServer();
      const cookie = await anonSession(server.app);
      const start = (await post(server.app, cookie, "/onboarding/discovery/start", { role: ROLE })).json() as {
        questions: Array<{
          itemId: string;
          question: string;
          consequence?: string;
          options: string[];
          eligibility?: { dimension: string };
        }>;
      };
      const discoveryLanguages = start.questions.find((q) => q.eligibility?.dimension === "language")!;

      const { languagesQuestion } = (await get(server.app, cookie, "/profile")).json() as ProfileResponse;
      expect(languagesQuestion).toEqual({
        questionId: discoveryLanguages.itemId,
        question: discoveryLanguages.question,
        consequence: discoveryLanguages.consequence ?? null,
        options: discoveryLanguages.options,
        answer: null,
      });
    });

    it("the questionId round-trips to the answer route and the answered set comes back exactly as stored", async () => {
      const server = buildServer();
      const cookie = await anonSession(server.app);
      await post(server.app, cookie, "/onboarding/discovery/start", { role: ROLE });
      const before = (await get(server.app, cookie, "/profile")).json() as ProfileResponse;
      const [english, mandarin] = before.languagesQuestion.options; // languagesUnion() order, verbatim

      await post(server.app, cookie, "/onboarding/discovery/answer", {
        itemId: before.languagesQuestion.questionId, // the rail's own id, not a client-composed one
        answers: [english, mandarin],
      });
      const after = (await get(server.app, cookie, "/profile")).json() as ProfileResponse;
      expect(after.languagesQuestion.answer).toEqual([english, mandarin]);
    });

    it("a CV language claim never influences the answer (the eligibility store is the only source)", async () => {
      const claims: CandidateClaim[] = [
        claim({ id: "acme-led-migration" }),
        claim({ id: "lang-fluent", role: "profile", text: "Fluent in English and Mandarin." }),
      ];
      const server = buildServer({ pipeline: { mine: async () => ({ doc: null, claims, roles: 1, needsGrill: 0 }) } });
      const cookie = await anonSession(server.app);
      await signIn(server.app, cookie, "e2e-lang-claim@example.com");
      const jobId = await mineAndGetJob(server, cookie);
      await post(server.app, cookie, "/onboarding/deck", { jobId });
      await post(server.app, cookie, "/onboarding/claims/lang-fluent/confirm");

      const { languagesQuestion } = (await get(server.app, cookie, "/profile")).json() as ProfileResponse;
      expect(languagesQuestion.answer).toBeNull();
    });
  });

  it("requires a session (401 with no cookie) but is reachable pre-wall (an unverified anonymous session is not rejected)", async () => {
    const server = buildServer();
    const noCookie = await server.app.inject({ method: "GET", url: "/profile" });
    expect(noCookie.statusCode).toBe(401);

    const cookie = await anonSession(server.app);
    const preWall = await get(server.app, cookie, "/profile");
    expect(preWall.statusCode).toBe(200);
  });
});
