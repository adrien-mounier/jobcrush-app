// #103 (E5 slice 2) — the posting-pool counters: a language skip is counted once, at ingest, never
// per deck request; "und" (undetermined) is counted separately from a confirmed non-served-language
// skip (code review finding 3); and both stay separate from the (currently always-zero) failure
// counter that #104 (slice 3) is the first to increment.
import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { loadPostings } from "../src/preview.js";
import { readCounters } from "../src/counters.js";

describe("#103 posting-pool counters", () => {
  it("counts the fixture's one non-English posting as a skip exactly once, no matter how many times the pool is read, and never as undetermined or a failure", () => {
    loadPostings();
    loadPostings();
    loadPostings();
    expect(readCounters()["postings.language_skipped"]).toBe(1);
    expect(readCounters()["postings.language_undetermined"]).toBe(0); // no terse/ambiguous fixtures
    expect(readCounters()["postings.read_failed"]).toBe(0); // slice 3 (#104) is the first writer
  });

  it("exposes all three counters, numbers only, on the open ops route", async () => {
    loadPostings(); // ensure ingest has happened at least once in this test file's module instance
    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/ops/counters" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      "postings.language_skipped": 1,
      "postings.language_undetermined": 0,
      "postings.read_failed": 0,
    });
  });
});
