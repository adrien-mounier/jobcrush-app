// #161 — the /job-blocks read + correction door: session gating, params/body validation at the
// trust boundary, and 404 on an unknown blockId rather than a silently-swallowed ok:true.
import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { InMemoryJobBlockStore } from "../src/jobBlockStore.js";
import { InMemoryClaimStore } from "../src/claims.js";

async function anonSession(app: ReturnType<typeof buildServer>["app"]): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/sessions/anonymous" });
  return `jc_session=${res.cookies.find((c) => c.name === "jc_session")!.value}`;
}

describe("GET /job-blocks", () => {
  it("requires a session", async () => {
    const server = buildServer();
    const res = await server.app.inject({ method: "GET", url: "/job-blocks" });
    expect(res.statusCode).toBe(401);
  });

  it("returns an empty deck with a not_run read state for a fresh session", async () => {
    const server = buildServer();
    const cookie = await anonSession(server.app);
    const res = await server.app.inject({ method: "GET", url: "/job-blocks", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    // #231: the deck no longer carries the published families. They were here so the review screen
    // could offer choices for an unplaced job; nobody is asked any more, so nothing read them.
    // #281: the published INDUSTRIES do travel, because something reads them — the work-history
    // screen prints the industry beside the employer, and a placement carries ids and versions only.
    const body = res.json();
    expect(body.blocks).toEqual([]);
    expect(body.summary).toEqual({ totalBlocks: 0, confirmedBlocks: 0, read: { status: "not_run" } });
    // The whole closed list, each entry carrying exactly what a screen needs to name and pick it.
    expect(body.industries.length).toBeGreaterThanOrEqual(10);
    expect(body.industries).toContainEqual({ industryId: "banking", label: "Banking", version: 1 });
    for (const entry of body.industries) {
      expect(Object.keys(entry).sort()).toEqual(["industryId", "label", "version"]);
    }
    // No fourth key: the deck is blocks, totals and the vocabulary that names them, nothing else.
    expect(Object.keys(body).sort()).toEqual(["blocks", "industries", "summary"]);
  });
});

describe("POST /job-blocks/:blockId/correct — validated at the trust boundary", () => {
  async function seeded(): Promise<{ server: ReturnType<typeof buildServer>; cookie: string; sessionId: string }> {
    const jobBlocks = new InMemoryJobBlockStore();
    await jobBlocks.init();
    const server = buildServer({ jobBlocks });
    const cookie = await anonSession(server.app);
    const meRes = await server.app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sessionId = meRes.json().id as string;
    await jobBlocks.ingest(
      sessionId,
      {
        schemaVersion: "1",
        blocks: [
          {
            id: "block-1",
            employer: { value: "Standard Chartered", source_quote: "Standard Chartered Bank", machine_touch: "verbatim", classification: "Verified" },
            title: { value: "Regional PM", source_quote: "Regional Project Manager", machine_touch: "verbatim", classification: "Verified" },
            start: { value: { year: 2019, month: 1, precision: "month" }, source_quote: "Jan 2019", machine_touch: "verbatim", classification: "Verified" },
            end: { value: { state: "ended", date: { year: 2022, month: 3, precision: "month" } }, source_quote: "Mar 2022", machine_touch: "verbatim", classification: "Verified" },
            kind: { value: "job", source_quote: "Regional Project Manager", machine_touch: "verbatim", classification: "Verified" },
          },
        ],
      },
      "raw",
    );
    return { server, cookie, sessionId };
  }

  it("accepts a well-formed correction for its key", async () => {
    const { server, cookie } = await seeded();
    const res = await server.app.inject({
      method: "POST",
      url: "/job-blocks/block-1/correct",
      headers: { cookie },
      payload: { key: "title", value: "Senior Regional PM" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("rejects a kind value outside the contract's enum — never persists junk", async () => {
    const { server, cookie } = await seeded();
    const res = await server.app.inject({
      method: "POST",
      url: "/job-blocks/block-1/correct",
      headers: { cookie },
      payload: { key: "kind", value: "hobby" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a start value that isn't a real MinedDate shape", async () => {
    const { server, cookie } = await seeded();
    const res = await server.app.inject({
      method: "POST",
      url: "/job-blocks/block-1/correct",
      headers: { cookie },
      payload: { key: "start", value: "whenever" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts a valid MinedDate for start", async () => {
    const { server, cookie } = await seeded();
    const res = await server.app.inject({
      method: "POST",
      url: "/job-blocks/block-1/correct",
      headers: { cookie },
      payload: { key: "start", value: { year: 2018, month: null, precision: "year" } },
    });
    expect(res.statusCode).toBe(200);
  });

  it("returns 404, not a silent ok, for an unknown blockId", async () => {
    const { server, cookie } = await seeded();
    const res = await server.app.inject({
      method: "POST",
      url: "/job-blocks/does-not-exist/correct",
      headers: { cookie },
      payload: { key: "title", value: "Whatever" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /job-blocks/:blockId/confirm and /detach — 404 on unknown blockId", () => {
  it("confirm 404s on an unknown blockId", async () => {
    const server = buildServer();
    const cookie = await anonSession(server.app);
    const res = await server.app.inject({ method: "POST", url: "/job-blocks/nope/confirm", headers: { cookie } });
    expect(res.statusCode).toBe(404);
  });

  it("detach 404s on an unknown blockId", async () => {
    const server = buildServer();
    const cookie = await anonSession(server.app);
    const res = await server.app.inject({ method: "POST", url: "/job-blocks/nope/detach", headers: { cookie } });
    expect(res.statusCode).toBe(404);
  });

  it("unconfirm 404s on an unknown blockId", async () => {
    const server = buildServer();
    const cookie = await anonSession(server.app);
    const res = await server.app.inject({ method: "POST", url: "/job-blocks/nope/unconfirm", headers: { cookie } });
    expect(res.statusCode).toBe(404);
  });
});

// #157 Design A — "no action in this flow is irreversible without a visible undo." confirm's reverse.
describe("POST /job-blocks/:blockId/unconfirm", () => {
  it("reverses a confirm on a real block", async () => {
    const jobBlocks = new InMemoryJobBlockStore();
    await jobBlocks.init();
    const server = buildServer({ jobBlocks });
    const cookie = await anonSession(server.app);
    const meRes = await server.app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sessionId = meRes.json().id as string;
    await jobBlocks.ingest(
      sessionId,
      {
        schemaVersion: "1",
        blocks: [
          {
            id: "block-1",
            employer: { value: "Standard Chartered", source_quote: "Standard Chartered Bank", machine_touch: "verbatim", classification: "Verified" },
            title: { value: "Regional PM", source_quote: "Regional Project Manager", machine_touch: "verbatim", classification: "Verified" },
            start: { value: { year: 2019, month: 1, precision: "month" }, source_quote: "Jan 2019", machine_touch: "verbatim", classification: "Verified" },
            end: { value: { state: "ended", date: { year: 2022, month: 3, precision: "month" } }, source_quote: "Mar 2022", machine_touch: "verbatim", classification: "Verified" },
            kind: { value: "job", source_quote: "Regional Project Manager", machine_touch: "verbatim", classification: "Verified" },
          },
        ],
      },
      "raw",
    );
    await server.app.inject({ method: "POST", url: "/job-blocks/block-1/confirm", headers: { cookie } });
    expect((await jobBlocks.list(sessionId))[0]!.confirmed).toBe(true);

    const res = await server.app.inject({ method: "POST", url: "/job-blocks/block-1/unconfirm", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect((await jobBlocks.list(sessionId))[0]!.confirmed).toBe(false);
  });
});

// #163 / ADR-0002 clause 3 — a confirmed sentence that contradicts a correction is held aside
// (reopened, never rewritten) with a precise question; unrelated sentences are untouched.
describe("POST /job-blocks/:blockId/correct — holds contradicting confirmed sentences", () => {
  const claim = (id: string, text: string) => ({
    id,
    semantic_key: id,
    field_key: null,
    field_value: null,
    field_label: null,
    role: "IT Project Manager - Standard Chartered",
    text,
    machine_touch: "verbatim" as const,
    classification: "Verified" as const,
    source_quote: text.slice(0, 100),
    needs_grill: false,
    grill_hint: null,
  });

  async function seededWithClaims() {
    const jobBlocks = new InMemoryJobBlockStore();
    const claims = new InMemoryClaimStore();
    await jobBlocks.init();
    const server = buildServer({ jobBlocks, claims });
    const cookie = await anonSession(server.app);
    const meRes = await server.app.inject({ method: "GET", url: "/sessions/me", headers: { cookie } });
    const sessionId = meRes.json().id as string;
    await jobBlocks.ingest(
      sessionId,
      {
        schemaVersion: "1",
        blocks: [
          {
            id: "block-1",
            employer: { value: "Standard Chartered", source_quote: "Standard Chartered Bank", machine_touch: "verbatim", classification: "Verified" },
            title: { value: "Regional PM", source_quote: "Regional Project Manager", machine_touch: "verbatim", classification: "Verified" },
            start: { value: { year: 2019, month: 1, precision: "month" }, source_quote: "Jan 2019", machine_touch: "verbatim", classification: "Verified" },
            end: { value: { state: "ended", date: { year: 2022, month: 3, precision: "month" } }, source_quote: "Mar 2022", machine_touch: "verbatim", classification: "Verified" },
            kind: { value: "job", source_quote: "Regional Project Manager", machine_touch: "verbatim", classification: "Verified" },
          },
        ],
      },
      "raw",
    );
    await claims.seed(sessionId, [
      claim("scb-title-sentence", "Promoted to Regional PM after one year"),
      claim("scb-joined-sentence", "Joined the payments team in 2019"),
      claim("scb-unrelated", "Delivered the checkout replatform two months early"),
    ]);
    for (const id of ["scb-title-sentence", "scb-joined-sentence", "scb-unrelated"]) {
      await claims.confirm(sessionId, id);
    }
    return { server, cookie, sessionId, claims };
  }

  it("holds the sentence carrying the superseded title, with a question — and never rewrites it", async () => {
    const { server, cookie, sessionId, claims } = await seededWithClaims();
    const res = await server.app.inject({
      method: "POST",
      url: "/job-blocks/block-1/correct",
      headers: { cookie },
      payload: { key: "title", value: "Regional Delivery Director" },
    });
    expect(res.statusCode).toBe(200);
    const { held } = res.json();
    expect(held).toHaveLength(1);
    expect(held[0].id).toBe("scb-title-sentence");
    expect(held[0].text).toBe("Promoted to Regional PM after one year"); // untouched, never rewritten
    expect(held[0].question).toContain('"Regional Delivery Director"');
    expect(held[0].question).toContain("measure something");
    // #163 binding UX intent: the downstream consequence, in plain words.
    expect(res.json().downstream).toContain('"Regional Delivery Director"');
    // Held = out of the confirmed set (never prints beside the corrected fact)…
    const confirmed = await claims.confirmed(sessionId);
    expect(confirmed.map((c) => c.id)).not.toContain("scb-title-sentence");
    expect(confirmed.map((c) => c.id)).toContain("scb-unrelated");
    // …but still present, pending — it returns the moment the person answers.
    const all = await claims.list(sessionId);
    const heldClaim = all.find((c) => c.id === "scb-title-sentence")!;
    expect(heldClaim.decision).toBe("pending");
    expect(heldClaim.text).toBe("Promoted to Regional PM after one year");
  });

  it("a date correction holds sentences carrying the superseded year", async () => {
    const { server, cookie, sessionId, claims } = await seededWithClaims();
    const res = await server.app.inject({
      method: "POST",
      url: "/job-blocks/block-1/correct",
      headers: { cookie },
      payload: { key: "start", value: { year: 2018, month: null, precision: "year" } },
    });
    const { held } = res.json();
    expect(held.map((h: { id: string }) => h.id)).toEqual(["scb-joined-sentence"]);
    expect((await claims.confirmed(sessionId)).map((c) => c.id)).not.toContain("scb-joined-sentence");
  });

  it("a correction contradicting nothing holds nothing", async () => {
    const { server, cookie, sessionId, claims } = await seededWithClaims();
    const res = await server.app.inject({
      method: "POST",
      url: "/job-blocks/block-1/correct",
      headers: { cookie },
      payload: { key: "employer", value: "Standard Chartered Singapore" },
    });
    // "Standard Chartered" appears in no confirmed sentence text — everything stays confirmed.
    expect(res.json().held).toEqual([]);
    expect(await claims.confirmed(sessionId)).toHaveLength(3);
  });
});
