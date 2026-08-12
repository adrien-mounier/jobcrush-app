// #161 — the /job-blocks read + correction door: session gating, params/body validation at the
// trust boundary, and 404 on an unknown blockId rather than a silently-swallowed ok:true.
import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { InMemoryJobBlockStore } from "../src/jobBlockStore.js";

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
    expect(res.json()).toEqual({ blocks: [], summary: { totalBlocks: 0, confirmedBlocks: 0, read: { status: "not_run" } } });
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
