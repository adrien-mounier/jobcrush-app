// JC-24 grill — deterministic gap detection + the grill routes over the real API.
import { describe, expect, it } from "vitest";
import type { MinedRole } from "@jobcrush/contracts";
import { buildServer } from "../src/server.js";
import { isTerminal } from "../src/jobs.js";
import { answerToClaim, detectGaps, templateQuestion, type Gap } from "../src/grill.js";
import type { ClaimRecord } from "../src/claims.js";

const claim = (over: Partial<ClaimRecord>): ClaimRecord => ({
  id: "acme-led",
  role: "PM - Acme",
  text: "Led the replatform",
  machine_touch: "reworded",
  classification: "Verified",
  source_quote: "led the replatform",
  needs_grill: false,
  grill_hint: null,
  decision: "confirmed",
  origin: "mined",
  ...over,
});

const undated = (employer: string, title = "PM"): MinedRole => ({
  employer,
  title,
  dates_as_written: "",
  dates_missing: true,
});

describe("JC-24 detectGaps (pure)", () => {
  it("one missing-dates gap per undated role that still has a confirmed claim", () => {
    const gaps = detectGaps([claim({ role: "PM - Acme" })], [undated("Acme")]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ type: "missing-dates", employer: "Acme", title: "PM", id: "gap-dates-acme" });
  });

  it("no date gap when the role is dated, and none when nothing is flagged", () => {
    const roles: MinedRole[] = [{ employer: "Acme", title: "PM", dates_as_written: "2020–2024", dates_missing: false }];
    expect(detectGaps([claim({ role: "PM - Acme" })], roles)).toEqual([]);
  });

  it("no date gap for an undated role whose claims were all rejected (not in confirmed)", () => {
    expect(detectGaps([], [undated("Acme")])).toEqual([]);
  });

  it("one needs-info gap per needs_grill claim", () => {
    const gaps = detectGaps(
      [claim({ id: "skill-x", role: "profile", text: "Stakeholder management", needs_grill: true, grill_hint: "no evidence" })],
      [],
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ type: "needs-info", id: "gap-info-skill-x", hint: "no evidence" });
  });

  it("suppresses a claim's needs-info gap when its role already gets a date question", () => {
    const gaps = detectGaps(
      [claim({ id: "acme-led", role: "PM - Acme", needs_grill: true, grill_hint: "no metric" })],
      [undated("Acme")],
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0].type).toBe("missing-dates");
  });

  it("caps at 5 with date gaps ranked first", () => {
    const roles = [undated("Acme"), undated("Beta"), undated("Ciru")];
    const confirmed = [
      claim({ id: "acme-x", role: "PM - Acme" }),
      claim({ id: "beta-x", role: "PM - Beta" }),
      claim({ id: "ciru-x", role: "PM - Ciru" }),
      ...Array.from({ length: 6 }, (_, i) =>
        claim({ id: `skill-${i}`, role: "profile", text: `s${i}`, needs_grill: true, grill_hint: "x" }),
      ),
    ];
    const gaps = detectGaps(confirmed, roles);
    expect(gaps).toHaveLength(5);
    expect(gaps.slice(0, 3).every((g) => g.type === "missing-dates")).toBe(true); // dates survive the cut
  });

  it("answerToClaim yields a confirmed, user-authored, kebab-id claim", () => {
    const g: Gap = { id: "gap-dates-acme", type: "missing-dates", role: "PM - Acme", employer: "Acme", title: "PM" };
    const c = answerToClaim(g, "2020 to 2024");
    expect(c.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(c.text).toContain("2020 to 2024");
    expect(c.needs_grill).toBe(false);
    expect(templateQuestion(g)).toMatch(/dates/i);
  });
});

// --- routes ---
function fakeMine(claims: ClaimRecord[], roles: MinedRole[]) {
  return {
    mine: async () => ({
      doc: { schemaVersion: "0", roles, claims, parser_flags: [] },
      claims,
      roles: roles.length,
      needsGrill: claims.filter((c) => c.needs_grill).length,
    }),
  };
}

async function startSession(app: ReturnType<typeof buildServer>["app"]) {
  const res = await app.inject({ method: "POST", url: "/sessions/anonymous" });
  return `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
}

async function seededDeck(server: ReturnType<typeof buildServer>, cookie: string) {
  const created = await server.app.inject({
    method: "POST",
    url: "/cv/paste",
    headers: { cookie },
    payload: { text: "Experience\nPM at Acme\n- led things\n".repeat(5) },
  });
  const { jobId } = created.json();
  await new Promise<void>((resolve) => {
    const un = server.store.subscribe(jobId, (j) => isTerminal(j.status) && (un(), resolve()));
    void server.store.get(jobId).then((j) => j && isTerminal(j.status) && (un(), resolve()));
  });
  await server.app.inject({ method: "POST", url: "/onboarding/deck", headers: { cookie }, payload: { jobId } });
  return jobId as string;
}

const confirm = (server: ReturnType<typeof buildServer>, cookie: string, id: string) =>
  server.app.inject({ method: "POST", url: `/onboarding/claims/${id}/confirm`, headers: { cookie } });

describe("JC-24 grill routes", () => {
  const CLAIMS = [
    claim({ id: "acme-led", role: "PM - Acme", text: "Led the replatform", machine_touch: "reworded" }),
    claim({ id: "skill-x", role: "profile", text: "Stakeholder management", needs_grill: true, grill_hint: "no evidence" }),
  ];
  const ROLES = [undated("Acme")];

  it("returns template-phrased questions for the detected gaps and sets stage=grill", async () => {
    const server = buildServer({ pipeline: fakeMine(CLAIMS, ROLES) });
    const cookie = await startSession(server.app);
    const jobId = await seededDeck(server, cookie);
    await confirm(server, cookie, "acme-led");
    await confirm(server, cookie, "skill-x");

    const res = await server.app.inject({ method: "POST", url: "/onboarding/grill", headers: { cookie }, payload: { jobId } });
    expect(res.json().stage).toBe("grill");
    const qs = res.json().questions as Array<{ gapId: string; type: string; question: string }>;
    expect(qs.map((q) => q.type).sort()).toEqual(["missing-dates", "needs-info"]);
    expect(qs.find((q) => q.type === "missing-dates")!.question).toMatch(/dates/i);
  });

  it("uses the injected phraser, and falls back to templates when it throws", async () => {
    const good = buildServer({ pipeline: fakeMine(CLAIMS, ROLES), phraseGrill: async (gaps) => gaps.map((g) => `Q<${g.id}>`) });
    let cookie = await startSession(good.app);
    let jobId = await seededDeck(good, cookie);
    await confirm(good, cookie, "acme-led");
    const gq = await good.app.inject({ method: "POST", url: "/onboarding/grill", headers: { cookie }, payload: { jobId } });
    expect((gq.json().questions as Array<{ question: string }>)[0].question).toMatch(/^Q</);

    const bad = buildServer({ pipeline: fakeMine(CLAIMS, ROLES), phraseGrill: async () => { throw new Error("model down"); } });
    cookie = await startSession(bad.app);
    jobId = await seededDeck(bad, cookie);
    await confirm(bad, cookie, "acme-led");
    const bq = await bad.app.inject({ method: "POST", url: "/onboarding/grill", headers: { cookie }, payload: { jobId } });
    expect((bq.json().questions as Array<{ question: string }>)[0].question).toMatch(/dates/i); // template
  });

  it("no gaps → empty questions", async () => {
    const dated: MinedRole[] = [{ employer: "Acme", title: "PM", dates_as_written: "2020–24", dates_missing: false }];
    const server = buildServer({ pipeline: fakeMine([claim({ id: "acme-led", role: "PM - Acme" })], dated) });
    const cookie = await startSession(server.app);
    const jobId = await seededDeck(server, cookie);
    await confirm(server, cookie, "acme-led");
    const res = await server.app.inject({ method: "POST", url: "/onboarding/grill", headers: { cookie }, payload: { jobId } });
    expect(res.json().questions).toEqual([]);
  });

  it("an answer becomes a confirmed claim that lands in the built root CV", async () => {
    const server = buildServer({ pipeline: fakeMine(CLAIMS, ROLES) });
    const cookie = await startSession(server.app);
    const jobId = await seededDeck(server, cookie);
    await confirm(server, cookie, "acme-led");

    await server.app.inject({
      method: "POST",
      url: "/onboarding/grill/answer",
      headers: { cookie },
      payload: { jobId, gapId: "gap-dates-acme", answer: "Mar 2020 to Present" },
    });
    const built = await server.app.inject({ method: "POST", url: "/onboarding/build", headers: { cookie } });
    expect(built.json().stage).toBe("ready");
    expect(built.json().rootCv.markdown).toContain("Mar 2020 to Present");
  });

  it("an unknown gapId is a 404, not a silent write", async () => {
    const server = buildServer({ pipeline: fakeMine(CLAIMS, ROLES) });
    const cookie = await startSession(server.app);
    const jobId = await seededDeck(server, cookie);
    await confirm(server, cookie, "acme-led");
    const res = await server.app.inject({
      method: "POST",
      url: "/onboarding/grill/answer",
      headers: { cookie },
      payload: { jobId, gapId: "gap-dates-nope", answer: "whenever" },
    });
    expect(res.statusCode).toBe(404);
  });
});
