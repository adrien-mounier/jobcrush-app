import { describe, expect, it } from "vitest";
import { InMemoryJobStore } from "../src/jobs.js";
import { runOnboardingJob, type VisitRecord } from "../src/pipeline.js";
import { createGuestbook, renderGuestbookHtml } from "../src/guestbook.js";

const paste = (text: string) => ({ type: "paste" as const, text });
const minedClaim = (id: string) => ({
  id,
  semantic_key: id,
  field_key: null,
  field_value: null,
  field_label: null,
  role: "PM - Acme",
  text: `Fact ${id}`,
  machine_touch: "verbatim" as const,
  classification: "Verified" as const,
  source_quote: `Fact ${id}`,
  needs_grill: false,
  grill_hint: null,
});

describe("guestbook hook", () => {
  it("records a finished visit with mined counts and the step feed", async () => {
    const store = new InMemoryJobStore();
    const job = await store.create("onboarding", "sess-1");
    const visits: VisitRecord[] = [];
    await runOnboardingJob(
      store,
      job.id,
      paste("Jane Doe\nProject Manager 2020-2024\n- delivered a platform migration"),
      {
        mine: async () => ({
          claims: [minedClaim("fact-a"), minedClaim("fact-b"), minedClaim("fact-c")],
          needsGrill: 1,
          roles: 2,
        }),
        recordVisit: async (v) => void visits.push(v),
      },
    );
    expect(visits).toHaveLength(1);
    expect(visits[0]).toMatchObject({
      finished: true,
      stage: "mine", // the last stage since #272 deleted the draft-building preview step
      minedClaims: 3,
      roles: 2,
      needsGrill: 1,
      posting: null,
      error: null,
      uploadKey: null, // paste has no stored file
      kind: null,
    });
    expect(visits[0].feed.length).toBeGreaterThan(0);
    expect(visits[0].rawCv).toBeTruthy(); // extracted CV kept
    expect(Array.isArray(visits[0].claims)).toBe(true); // mined claims kept
  });

  it("keeps the upload key + kind when the input is an uploaded file", async () => {
    const store = new InMemoryJobStore();
    const job = await store.create("onboarding", "sess-up");
    const visits: VisitRecord[] = [];
    await runOnboardingJob(
      store,
      job.id,
      { type: "upload", data: Buffer.from("Jane Doe\nPM 2020-2024\n- x"), kind: "txt", key: "r2-key-123" },
      {
        mine: async () => ({ claims: [minedClaim("fact-a")], needsGrill: 0, roles: 1 }),
        recordVisit: async (v) => void visits.push(v),
      },
    );
    expect(visits[0].uploadKey).toBe("r2-key-123");
    expect(visits[0].kind).toBe("txt");
  });

  it("records a failed visit with the raw error and the stage it reached", async () => {
    const store = new InMemoryJobStore();
    const job = await store.create("onboarding", null);
    const visits: VisitRecord[] = [];
    await runOnboardingJob(store, job.id, paste("Jane Doe\nPM 2020-2024\n- x"), {
      mine: async () => {
        throw new Error("miner boom");
      },
      recordVisit: async (v) => void visits.push(v),
    });
    expect(visits).toHaveLength(1);
    expect(visits[0].finished).toBe(false);
    expect(visits[0].error).toContain("miner boom");
    expect(visits[0].stage).toBe("extract"); // reached extract; blew up inside mine
  });

  it("no-op guestbook (no DATABASE_URL) never throws and lists nothing", async () => {
    const gb = createGuestbook(undefined);
    expect(gb.ready).toBe(false);
    await gb.init();
    await gb.record({
      jobId: "j", sessionId: null, finished: true, stage: "mine", minedClaims: 1,
      roles: 1, needsGrill: 0, posting: null, durationMs: 10, error: null, feed: [],
      uploadKey: null, kind: null, rawCv: null, claims: null,
    });
    expect(await gb.list()).toEqual([]);
    expect(await gb.get(1)).toBeNull();
  });

  it("renders an HTML scoreboard and escapes error text", () => {
    const html = renderGuestbookHtml([
      {
        id: 1, createdAt: "2026-07-18T01:00:00.000Z", jobId: "j", sessionId: null,
        finished: false, stage: "mine", minedClaims: null, roles: 2, needsGrill: null,
        posting: null, durationMs: 1234, error: "boom <script>", feed: ["Reading your CV…"],
      },
    ]);
    expect(html).toContain("Visits");
    expect(html).toContain("Reading your CV");
    expect(html).toContain("boom &lt;script&gt;"); // no raw HTML injection
  });
});
