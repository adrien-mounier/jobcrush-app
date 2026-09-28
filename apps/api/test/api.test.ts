import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { isTerminal } from "../src/jobs.js";

describe("api skeleton", () => {
  it("healthz reports sha and env", async () => {
    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, sha: "dev" });
  });

  it("errors use the envelope", async () => {
    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/jobs/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: "not_found" } });
  });

  it("demo job runs its checkpointed steps to completion", async () => {
    const { app, store } = buildServer();
    const created = await app.inject({ method: "POST", url: "/jobs/demo" });
    expect(created.statusCode).toBe(201);
    const { id } = created.json();

    // wait for terminal state via the store's own subscription
    await new Promise<void>((resolve) => {
      const un = store.subscribe(id, (j) => {
        if (isTerminal(j.status)) {
          un();
          resolve();
        }
      });
    });
    const job = await store.get(id);
    expect(job?.status).toBe("completed");
    expect(job?.progress).toMatchObject({
      extract: "extract-done",
      mine: "mine-done",
      render: "render-done",
    });
  });

  it("checkpoint rule: a re-run never redoes a completed step", async () => {
    const { store } = buildServer();
    const job = await store.create("demo-job");
    await store.update(job.id, { progress: { extract: "already-done-elsewhere" } });
    const { runDemoJob } = await import("../src/jobs.js");
    await runDemoJob(store, job.id);
    const done = await store.get(job.id);
    expect(done?.progress.extract).toBe("already-done-elsewhere"); // untouched
    expect(done?.status).toBe("completed");
  });

  it("SSE stream delivers progress and closes at terminal state", async () => {
    const { app } = buildServer();
    const created = await app.inject({ method: "POST", url: "/jobs/demo" });
    const { id } = created.json();
    // inject resolves only when the response ends — which the route does at terminal state
    const res = await app.inject({ method: "GET", url: `/jobs/${id}/events` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const events = res.body
      .split("\n\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => JSON.parse(l.slice(6)));
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.at(-1).status).toBe("completed");
  });

  it("#304: the stream forbids an intermediary from transforming or buffering it", async () => {
    // Measured 2026-09-28, and the reason this assertion exists rather than a comment: the web app
    // proxies /api/* through Next, Next compresses what it proxies when the browser asks for gzip,
    // and a compressed body is held back until the stream closes. Every progress event of a
    // three-second read therefore landed in ONE burst at the end — so the screen could only ever
    // show the final state, however honestly the server narrated. curl hid it by not asking for
    // gzip. Both headers are instructions to an intermediary to leave the body alone.
    //
    // This pins the instruction, not the proxy's obedience. What proves a person really watches the
    // steps go by is apps/web/e2e/paste-wait-journey.mjs, in a real browser through the real proxy.
    const { app } = buildServer();
    const { id } = (await app.inject({ method: "POST", url: "/jobs/demo" })).json();
    const res = await app.inject({ method: "GET", url: `/jobs/${id}/events` });
    expect(res.headers["cache-control"]).toContain("no-transform");
    expect(res.headers["x-accel-buffering"]).toBe("no");
  });
});
