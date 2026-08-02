// #104 (E5 slice 3) — the ad-reader's own LLM-call idiom, tested the same way miner.test.ts tests
// mineClaims: directly, with a fake LlmClient injected at the seam llm.ts defines. This is the LLM
// boundary the ticket's testing decisions call out as "where the test double is injected" — never a
// live call. HTTP-level deck behaviour (growth, no-second-call, drop-on-failure) lives in
// cards.test.ts, driven through the real /onboarding routes.
import { describe, expect, it } from "vitest";
import { AdRequirementsV1 } from "@jobcrush/contracts";
import {
  adReaderPrompt,
  adReaderVersion,
  buildAdReaderInput,
  makeAdReader,
  readAdvert,
} from "../src/adReader.js";
import { InMemoryAdRequirementsStore, type AdRequirementsStore } from "../src/adRequirementsStore.js";
import { readCounters, recentReadFailuresList } from "../src/counters.js";
import type { LlmClient } from "../src/llm.js";
import type { Posting } from "../src/preview.js";

const posting = (over: Partial<Posting> = {}): Posting => ({
  id: "ad-1",
  title: "Senior Project Manager",
  company: "Acme",
  location: "Sydney, Australia",
  keywords: ["project", "manager"],
  excerpt: "Own the full project lifecycle. Manage a $2M budget. 8+ years experience required.",
  language: "en",
  ...over,
});

const validDoc = {
  language: "en",
  familyFit: { family: "IT Project Manager", confidence: 0.8 },
  requirements: [
    {
      id: "own-budget",
      band: "essential",
      kind: "ordinary",
      requirement: "Own a project budget",
      sourceSpan: "Manage a $2M budget",
    },
  ],
};

function fakeLlm(
  responses: string[],
  opts: { model?: string; withUsage?: boolean } = {},
): LlmClient & { calls: string[] } {
  const calls: string[] = [];
  const base: LlmClient & { calls: string[] } = {
    calls,
    model: opts.model ?? "fake-model",
    async complete(prompt: string) {
      calls.push(prompt);
      const next = responses.shift();
      if (next === undefined) throw new Error("fake llm exhausted");
      return next;
    },
  };
  if (opts.withUsage) {
    base.completeWithUsage = async (prompt: string) => {
      const text = await base.complete(prompt);
      return { text, usage: { inputTokens: 1000, outputTokens: 200 } };
    };
  }
  return base;
}

/** Wraps an in-memory store so get()/put() can be made to throw on demand — proves the review's
 *  "store failures are invisible" finding at the exact seam that broke (#104 review finding 4). */
function flakyStore(opts: { onGet?: boolean; onPut?: boolean }): AdRequirementsStore {
  const inner = new InMemoryAdRequirementsStore();
  return {
    init: () => inner.init(),
    get: async (adId) => {
      if (opts.onGet) throw new Error("store down");
      return inner.get(adId);
    },
    put: async (adId, record) => {
      if (opts.onPut) throw new Error("store down");
      return inner.put(adId, record);
    },
  };
}

describe("#104 adReader prompt plumbing", () => {
  it("embeds the known families list and the advert text after the prompt", () => {
    const input = buildAdReaderInput(posting(), ["IT Project Manager"]);
    expect(input).toContain("- IT Project Manager");
    expect(input).toContain("Senior Project Manager at Acme (Sydney, Australia)");
    expect(input).toContain("Manage a $2M budget");
    expect(input).not.toContain("<!--"); // human header stripped
  });

  // A function replacer, not a string one (#104 review, "also fix, cheap") — a string replacer
  // would treat "$&"/"$1"/etc. in a family name as replacement patterns instead of literal text.
  it("treats a family name containing a $-pattern as literal text, not a replacement pattern", () => {
    const input = buildAdReaderInput(posting(), ["Data $& Analytics"]);
    expect(input).toContain("- Data $& Analytics");
  });

  // Contract-pin: this wording is measured, not incidental (see ad-reader.md's own header) — a
  // spike WITHOUT it classified 4 requirements blocking on a single advert; WITH it, 1 across 8.
  // This test fails the moment the wording drifts, forcing a deliberate re-run of the measurement
  // harness (#110) rather than a silent edit.
  it("pins the blocking definition's exact wording", () => {
    const prompt = adReaderPrompt();
    expect(prompt).toContain(
      "A requirement is **blocking** ONLY IF the advert states it as mandatory AND it is a hard gate: a",
    );
    expect(prompt).toContain(
      'Years of experience is **NOT** blocking, however the advert phrases it ("8+ years required").',
    );
    expect(prompt).toContain("is **NOT** blocking, even phrased as a strict requirement.");
    expect(prompt).toContain('"Mandarin an advantage", "PMP a plus" — is **NOT** blocking; it is ordinary.');
    // #104 review finding 1: the prompt must tie blocking to a hard-gate eligibilityDimension, or
    // the code-level clamp (which enforces exactly this) silently down-classifies a genuine hard
    // gate the model correctly called blocking but forgot to tag.
    expect(prompt).toContain(
      'Every `blocking` requirement MUST also set `eligibilityDimension` to `"work-rights"`,',
    );
  });
});

describe("#104 readAdvert", () => {
  it("skips a non-served-language posting with no model call, counted as a skip not a failure", async () => {
    const before = readCounters()["adReader.language_skipped"];
    const llm = fakeLlm([]);
    const result = await readAdvert(posting({ language: "zh" }), llm, ["IT Project Manager"]);
    expect(result).toBeNull();
    expect(llm.calls).toHaveLength(0);
    expect(readCounters()["adReader.language_skipped"]).toBe(before + 1);
  });

  it("parses a valid response, producing familyFit and requirements from ONE call", async () => {
    const llm = fakeLlm([JSON.stringify(validDoc)]);
    const result = await readAdvert(posting(), llm, ["IT Project Manager"]);
    expect(llm.calls).toHaveLength(1);
    expect(result?.requirements.schemaVersion).toBe("1");
    expect(result?.requirements.adId).toBe("ad-1"); // set by the reader, not trusted from the model
    expect(result?.requirements.curated).toBe(false);
    expect(result?.requirements.familyFit).toEqual({ family: "IT Project Manager", confidence: 0.8 });
    expect(result?.requirements.requirements).toHaveLength(1);
  });

  // #104 review finding 2: the reader used to spread the model's object AFTER its own pinned
  // fields, so an echoed "curated": true could promote an unreviewed advert into the curated-opener
  // slot, and an echoed adId could desync the store key from what it actually holds.
  it("the model cannot override adId/curated/schemaVersion by echoing them back", async () => {
    const doc = { ...validDoc, adId: "totally-different-id", curated: true, schemaVersion: "999" };
    const llm = fakeLlm([JSON.stringify(doc)]);
    const result = await readAdvert(posting(), llm, ["IT Project Manager"]);
    expect(result?.requirements.adId).toBe("ad-1"); // posting.id wins, never the model's echo
    expect(result?.requirements.curated).toBe(false); // never promoted by an echoed field
    expect(result?.requirements.schemaVersion).toBe("1");
  });

  it("retries once with the validation error, then succeeds", async () => {
    const llm = fakeLlm(["not json at all", JSON.stringify(validDoc)]);
    const result = await readAdvert(posting(), llm, ["IT Project Manager"]);
    expect(result).not.toBeNull();
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]).toContain("===RETRY===");
  });

  it("fails after two invalid answers instead of shipping junk", async () => {
    const llm = fakeLlm(["{}", "{}"]);
    await expect(readAdvert(posting(), llm, ["IT Project Manager"])).rejects.toThrow(
      /failed validation twice/,
    );
  });

  // The ticket's own measured regression: a capability requirement returned as blocking by the
  // model must come back ordinary through this boundary — enforced in code, not only prompted for.
  it("clamps a capability requirement returned as blocking down to ordinary, and counts the clamp", async () => {
    const before = readCounters()["adReader.blocking_clamped"];
    const doc = {
      ...validDoc,
      requirements: [
        {
          id: "coordinate-stakeholders",
          band: "essential",
          kind: "blocking",
          requirement: "Communicate with stakeholders",
          sourceSpan: "Drive regular, clear communication with all stakeholders",
        },
      ],
    };
    const llm = fakeLlm([JSON.stringify(doc)]);
    const result = await readAdvert(posting(), llm, ["IT Project Manager"]);
    expect(result?.requirements.requirements[0]?.kind).toBe("ordinary");
    expect(readCounters()["adReader.blocking_clamped"]).toBe(before + 1);
  });

  // "Mandarin an advantage" — an explicit preference — must stay ordinary and untouched by the
  // clamp (nothing to clamp: the model never called it blocking in the first place).
  it("'Mandarin an advantage' stays ordinary, unclamped and unaltered", async () => {
    const before = readCounters()["adReader.blocking_clamped"];
    const doc = {
      ...validDoc,
      requirements: [
        {
          id: "mandarin-advantage",
          band: "nice-to-have",
          kind: "ordinary",
          requirement: "Mandarin an advantage",
          sourceSpan: "Mandarin an advantage",
        },
      ],
    };
    const llm = fakeLlm([JSON.stringify(doc)]);
    const result = await readAdvert(posting(), llm, ["IT Project Manager"]);
    expect(result?.requirements.requirements[0]?.kind).toBe("ordinary");
    expect(readCounters()["adReader.blocking_clamped"]).toBe(before);
  });

  // #104 review finding 1's proof: a genuine hard gate, correctly tagged, must survive as blocking
  // — the clamp only catches a blocking claim with NO hard-gate dimension behind it, never a real one.
  it("a genuine hard gate (fluent Cantonese, mandatory, eligibilityDimension: language) survives as blocking", async () => {
    const doc = {
      ...validDoc,
      requirements: [
        {
          id: "fluent-cantonese",
          band: "essential",
          kind: "blocking",
          requirement: "Fluent Cantonese required",
          eligibilityDimension: "language",
          sourceSpan: "Fluent Cantonese is required for this role",
        },
      ],
    };
    const llm = fakeLlm([JSON.stringify(doc)]);
    const result = await readAdvert(posting(), llm, ["IT Project Manager"]);
    expect(result?.requirements.requirements[0]?.kind).toBe("blocking");
  });

  // years-experience is explicitly NOT a hard gate — a blocking years bar clamps even WITH the
  // dimension set, unlike work-rights/language/certification.
  it("a blocking years-experience requirement still clamps — years is not a hard gate", async () => {
    const doc = {
      ...validDoc,
      requirements: [
        {
          id: "years-bar",
          band: "essential",
          kind: "blocking",
          requirement: "8+ years required",
          eligibilityDimension: "years-experience",
          comparable: { op: ">=", value: 8 },
          sourceSpan: "8+ years required",
        },
      ],
    };
    const llm = fakeLlm([JSON.stringify(doc)]);
    const result = await readAdvert(posting(), llm, ["IT Project Manager"]);
    expect(result?.requirements.requirements[0]?.kind).toBe("ordinary");
  });

  it("uses completeWithUsage and records real token counts when the driver offers it", async () => {
    const llm = fakeLlm([JSON.stringify(validDoc)], { withUsage: true, model: "claude-sonnet-5" });
    const result = await readAdvert(posting(), llm, ["IT Project Manager"]);
    expect(result?.cost).toEqual({ model: "claude-sonnet-5", inputTokens: 1000, outputTokens: 200 });
  });

  // #104 review finding 8: cost was captured per advert but never exposed anywhere — no route, no
  // counter — so the unit economics #86 asked to be KNOWN stayed unknowable without a live DB.
  it("adds a measured read's tokens to the aggregate cost counters", async () => {
    const before = {
      reads: readCounters()["adReader.cost_reads_recorded"],
      input: readCounters()["adReader.cost_input_tokens_total"],
      output: readCounters()["adReader.cost_output_tokens_total"],
    };
    const llm = fakeLlm([JSON.stringify(validDoc)], { withUsage: true, model: "claude-sonnet-5" });
    await readAdvert(posting(), llm, ["IT Project Manager"]);
    expect(readCounters()["adReader.cost_reads_recorded"]).toBe(before.reads + 1);
    expect(readCounters()["adReader.cost_input_tokens_total"]).toBe(before.input + 1000);
    expect(readCounters()["adReader.cost_output_tokens_total"]).toBe(before.output + 200);
  });

  it("an unmeasured read (no completeWithUsage) does not move the cost aggregate counters", async () => {
    const before = readCounters()["adReader.cost_reads_recorded"];
    const llm = fakeLlm([JSON.stringify(validDoc)], { model: "sonnet" });
    await readAdvert(posting(), llm, ["IT Project Manager"]);
    expect(readCounters()["adReader.cost_reads_recorded"]).toBe(before); // stays unmeasured, not zero-costed
  });

  it("falls back to complete() and stores null token counts — never an estimate — when usage isn't offered", async () => {
    const llm = fakeLlm([JSON.stringify(validDoc)], { model: "sonnet" });
    const result = await readAdvert(posting(), llm, ["IT Project Manager"]);
    // "sonnet" (the CLI driver's alias) canonicalizes to the same name AnthropicLlm reports, so
    // cost never silently splits across two model names (#104 review, "also fix, cheap").
    expect(result?.cost).toEqual({ model: "claude-sonnet-5", inputTokens: null, outputTokens: null });
  });

  // #104 review finding 5: only the LAST attempt's usage used to be kept, so a retried read
  // silently understated its real spend by roughly the discarded first attempt's tokens.
  it("accumulates cost across a validation retry — the discarded first attempt's tokens are not lost", async () => {
    let callCount = 0;
    const calls: string[] = [];
    const usages = [
      { inputTokens: 500, outputTokens: 50 },
      { inputTokens: 600, outputTokens: 80 },
    ];
    const llm: LlmClient = {
      model: "claude-sonnet-5",
      async complete(prompt: string) {
        calls.push(prompt);
        callCount++;
        return callCount === 1 ? "not json at all" : JSON.stringify(validDoc);
      },
      async completeWithUsage(prompt: string) {
        const text = await llm.complete(prompt);
        return { text, usage: usages[callCount - 1]! };
      },
    };
    const result = await readAdvert(posting(), llm, ["IT Project Manager"]);
    expect(calls).toHaveLength(2);
    expect(result?.cost).toEqual({ model: "claude-sonnet-5", inputTokens: 1100, outputTokens: 130 });
  });
});

describe("#104 makeAdReader — the shared, persisted, version-aware cache", () => {
  it("a first read calls the model and persists the result", async () => {
    const store = new InMemoryAdRequirementsStore();
    const llm = fakeLlm([JSON.stringify(validDoc)]);
    const readAd = makeAdReader(llm, store, ["IT Project Manager"]);
    const result = await readAd(posting());
    expect(llm.calls).toHaveLength(1);
    expect(result?.adId).toBe("ad-1");
    const stored = await store.get("ad-1");
    expect(stored?.version).toBe(adReaderVersion());
    expect(stored?.requirements).toEqual(result);
  });

  it("a second read of the same ad reuses the store — no additional model call", async () => {
    const store = new InMemoryAdRequirementsStore();
    const llm = fakeLlm([JSON.stringify(validDoc)]);
    const readAd = makeAdReader(llm, store, ["IT Project Manager"]);
    await readAd(posting());
    await readAd(posting());
    expect(llm.calls).toHaveLength(1);
  });

  // #104 review finding 7: without in-flight dedupe, "nobody pays twice" held only sequentially —
  // two deck requests landing together at cold start would both miss the store and both pay.
  it("concurrent cold reads for the same advert share one in-flight read", async () => {
    const store = new InMemoryAdRequirementsStore();
    const llm = fakeLlm([JSON.stringify(validDoc)]);
    const readAd = makeAdReader(llm, store, ["IT Project Manager"]);
    const [a, b] = await Promise.all([readAd(posting()), readAd(posting())]);
    expect(llm.calls).toHaveLength(1);
    expect(a).toEqual(b);
  });

  it("a stale stored version triggers exactly one fresh read (a prompt/contract bump)", async () => {
    const store = new InMemoryAdRequirementsStore();
    await store.put("ad-1", {
      requirements: AdRequirementsV1.parse({ schemaVersion: "1", adId: "ad-1", curated: false, ...validDoc }),
      version: "ad-reader/0+adreq/0", // stale — a version ago
      cost: { model: "sonnet", inputTokens: null, outputTokens: null, readAt: "2020-01-01T00:00:00.000Z" },
    });
    const llm = fakeLlm([JSON.stringify(validDoc)]);
    const readAd = makeAdReader(llm, store, ["IT Project Manager"]);
    await readAd(posting());
    expect(llm.calls).toHaveLength(1); // re-read triggered by the version mismatch
    expect((await store.get("ad-1"))?.version).toBe(adReaderVersion());
  });

  // #104 review finding 3: a row written under a prior contract that the CURRENT schema now
  // rejects used to throw out of store.get() before the version comparison ever ran, escaping
  // makeAdReader entirely uncaught. It must instead read as a plain cache miss and re-read.
  it("a stored row the CURRENT schema rejects (e.g. after a contract bump) triggers a fresh read, never a thrown error", async () => {
    const store = new InMemoryAdRequirementsStore();
    await store.put("ad-1", {
      requirements: { schemaVersion: "1", adId: "ad-1", curated: false } as unknown as AdRequirementsV1,
      version: "ad-reader/oldhash+adreq/0", // written under a prior contract version
      cost: { model: "sonnet", inputTokens: null, outputTokens: null, readAt: "2020-01-01T00:00:00.000Z" },
    });
    const llm = fakeLlm([JSON.stringify(validDoc)]);
    const readAd = makeAdReader(llm, store, ["IT Project Manager"]);
    const result = await readAd(posting());
    expect(llm.calls).toHaveLength(1);
    expect(result?.adId).toBe("ad-1");
    expect((await store.get("ad-1"))?.version).toBe(adReaderVersion()); // the broken row is replaced
  });

  it("a read that fails twice never throws out of makeAdReader — drops the card, counts the failure, and records why", async () => {
    const before = readCounters()["postings.read_failed"];
    const store = new InMemoryAdRequirementsStore();
    const llm = fakeLlm(["not json", "still not json"]);
    const readAd = makeAdReader(llm, store, ["IT Project Manager"]);
    const result = await readAd(posting());
    expect(result).toBeNull();
    expect(await store.get("ad-1")).toBeNull(); // nothing checkpointed for a failed read
    expect(readCounters()["postings.read_failed"]).toBe(before + 1);
    // #115 AC2: the reason survives the bare catch — retrievable, naming the advert and the class.
    const entry = recentReadFailuresList().filter((f) => f.adId === "ad-1").at(-1);
    expect(entry?.class).toBe("model-output-invalid");
    expect(entry?.message).toContain("failed validation twice");
  });

  // #115: a raw LLM-call failure (network/API error, never even reaching extractJson/zod) is a
  // genuinely different operational signal from two bad-but-received answers — the provider call
  // itself failed, not the prompt/contract. makeAdReader tells them apart by AdReadValidationError's
  // instanceof, not by matching error text.
  it("a raw LLM-call failure is recorded as a distinct class from an invalid model answer", async () => {
    const before = readCounters()["postings.read_failed"];
    const store = new InMemoryAdRequirementsStore();
    const llm: LlmClient = {
      async complete() {
        throw new Error("network blip");
      },
    };
    const readAd = makeAdReader(llm, store, ["IT Project Manager"]);
    const result = await readAd(posting());
    expect(result).toBeNull();
    expect(readCounters()["postings.read_failed"]).toBe(before + 1);
    const entry = recentReadFailuresList().filter((f) => f.adId === "ad-1").at(-1);
    expect(entry?.class).toBe("model-call-error");
    expect(entry?.message).toContain("network blip");
  });

  // #104 review finding 4: a store outage used to escape all the way to the route's blanket catch
  // with nothing counted — every uncurated advert would silently vanish from every deck while
  // /ops/counters reported a 0% failure rate.
  it("a store.get() outage drops the card, counts the failure, and never blindly pays for a model call", async () => {
    const before = readCounters()["postings.read_failed"];
    const store = flakyStore({ onGet: true });
    const llm = fakeLlm([JSON.stringify(validDoc)]);
    const readAd = makeAdReader(llm, store, ["IT Project Manager"]);
    const result = await readAd(posting());
    expect(result).toBeNull();
    expect(llm.calls).toHaveLength(0);
    expect(readCounters()["postings.read_failed"]).toBe(before + 1);
    expect(recentReadFailuresList().filter((f) => f.adId === "ad-1").at(-1)?.class).toBe("store-unavailable");
  });

  it("a store.put() outage still returns THIS request's freshly-paid-for result, but counts the failure", async () => {
    const before = readCounters()["postings.read_failed"];
    const store = flakyStore({ onPut: true });
    const llm = fakeLlm([JSON.stringify(validDoc)]);
    const readAd = makeAdReader(llm, store, ["IT Project Manager"]);
    const result = await readAd(posting());
    expect(result?.adId).toBe("ad-1"); // the paid read isn't thrown away over a storage outage
    expect(readCounters()["postings.read_failed"]).toBe(before + 1);
    expect(recentReadFailuresList().filter((f) => f.adId === "ad-1").at(-1)?.class).toBe("store-unavailable");
  });
});
