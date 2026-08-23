// #104 (E5 slice 3) — the ad-reader's own LLM-call idiom, tested the same way miner.test.ts tests
// mineClaims: directly, with a fake LlmClient injected at the seam llm.ts defines. This is the LLM
// boundary the ticket's testing decisions call out as "where the test double is injected" — never a
// live call. HTTP-level deck behaviour (growth, no-second-call, drop-on-failure) lives in
// cards.test.ts, driven through the real /onboarding routes.
import { describe, expect, it, vi } from "vitest";
import { AdRequirementsV1 } from "@jobcrush/contracts";
import {
  adReaderPrompt,
  adReaderVersion,
  buildAdReaderInput,
  computeSuppressionBackoffMs,
  isSuppressionActive,
  makeAdReader,
  NO_KNOWN_FAMILY,
  readAdvert,
  SUPPRESSION_BASE_MS,
  SUPPRESSION_MAX_MS,
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

// #243: the reader's closed list is ReaderFamily entries (the published production vocabulary in
// production — main.ts wires publishedFamilies()). The familyId doubles as the value the model
// must answer, so these tests keep the historical "IT Project Manager" string as the id.
const FAMILIES = [
  { familyId: "IT Project Manager", label: "IT Project Manager", scope: "Delivering IT projects" },
];

// #284: the reader's closed INDUSTRY list, the twin of FAMILIES above. Two of the real published
// ids, in the same group, so a test can name one the vocabulary knows and one it doesn't.
const INDUSTRIES = [
  { industryId: "it-services", label: "IT services", scope: "Delivering IT to other businesses" },
  { industryId: "banking", label: "Banking", scope: "Deposit-taking and lending institutions" },
];

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
  it("embeds the known families list (label, id, scope) and the advert text after the prompt", () => {
    const input = buildAdReaderInput(posting(), FAMILIES, INDUSTRIES);
    expect(input).toContain("### IT Project Manager");
    expect(input).toContain("id: IT Project Manager");
    expect(input).toContain("covers: Delivering IT projects");
    expect(input).toContain("Senior Project Manager at Acme (Sydney, Australia)");
    expect(input).toContain("Manage a $2M budget");
    expect(input).not.toContain("<!--"); // human header stripped
  });

  // A function replacer, not a string one (#104 review, "also fix, cheap") — a string replacer
  // would treat "$&"/"$1"/etc. in a family name as replacement patterns instead of literal text.
  it("treats a family or industry name containing a $-pattern as literal text, not a replacement pattern", () => {
    const input = buildAdReaderInput(
      posting(),
      [{ familyId: "data-analytics", label: "Data $& Analytics", scope: "Analytics $1 work" }],
      [{ industryId: "media", label: "Media $& Publishing", scope: "Publishing $1 businesses" }],
    );
    expect(input).toContain("### Data $& Analytics");
    expect(input).toContain("covers: Analytics $1 work");
    expect(input).toContain("### Media $& Publishing");
    expect(input).toContain("covers: Publishing $1 businesses");
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
    // #107 (E5 slice 6, D1): a hard-gate dimension alone isn't enough for language/certification —
    // this wording is what tells the model to also name the SUBJECT ("Mandarin", not just
    // "language"). adReader.ts's clampBlocking is the mechanical backstop behind it.
    expect(prompt).toContain(
      'A `blocking` requirement whose `eligibilityDimension` is `"language"` or `"certification"`',
    );
  });
});

describe("#104 readAdvert", () => {
  it("skips a non-served-language posting with no model call, counted as a skip not a failure", async () => {
    const before = readCounters()["adReader.language_skipped"];
    const llm = fakeLlm([]);
    const result = await readAdvert(posting({ language: "zh" }), llm, FAMILIES, INDUSTRIES);
    expect(result).toBeNull();
    expect(llm.calls).toHaveLength(0);
    expect(readCounters()["adReader.language_skipped"]).toBe(before + 1);
  });

  it("parses a valid response, producing familyFit and requirements from ONE call", async () => {
    const llm = fakeLlm([JSON.stringify(validDoc)]);
    const result = await readAdvert(posting(), llm, FAMILIES, INDUSTRIES);
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
    const result = await readAdvert(posting(), llm, FAMILIES, INDUSTRIES);
    expect(result?.requirements.adId).toBe("ad-1"); // posting.id wins, never the model's echo
    expect(result?.requirements.curated).toBe(false); // never promoted by an echoed field
    expect(result?.requirements.schemaVersion).toBe("1");
  });

  it("retries once with the validation error, then succeeds", async () => {
    const llm = fakeLlm(["not json at all", JSON.stringify(validDoc)]);
    const result = await readAdvert(posting(), llm, FAMILIES, INDUSTRIES);
    expect(result).not.toBeNull();
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]).toContain("===RETRY===");
  });

  it("fails after two invalid answers instead of shipping junk", async () => {
    const llm = fakeLlm(["{}", "{}"]);
    await expect(readAdvert(posting(), llm, FAMILIES, INDUSTRIES)).rejects.toThrow(
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
    const result = await readAdvert(posting(), llm, FAMILIES, INDUSTRIES);
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
    const result = await readAdvert(posting(), llm, FAMILIES, INDUSTRIES);
    expect(result?.requirements.requirements[0]?.kind).toBe("ordinary");
    expect(readCounters()["adReader.blocking_clamped"]).toBe(before);
  });

  // #104 review finding 1's proof: a genuine hard gate, correctly tagged AND scoped, must survive as
  // blocking — the clamp only catches a blocking claim with no hard-gate dimension, or (#107, D1) no
  // subject, behind it.
  it("a genuine hard gate (fluent Cantonese, mandatory, eligibilityDimension: language, eligibilitySubject: Cantonese) survives as blocking", async () => {
    const doc = {
      ...validDoc,
      requirements: [
        {
          id: "fluent-cantonese",
          band: "essential",
          kind: "blocking",
          requirement: "Fluent Cantonese required",
          eligibilityDimension: "language",
          eligibilitySubject: "Cantonese",
          sourceSpan: "Fluent Cantonese is required for this role",
        },
      ],
    };
    const llm = fakeLlm([JSON.stringify(doc)]);
    const result = await readAdvert(posting(), llm, FAMILIES, INDUSTRIES);
    expect(result?.requirements.requirements[0]?.kind).toBe("blocking");
    expect(result?.requirements.requirements[0]?.eligibilitySubject).toBe("Cantonese");
  });

  // #107 (E5 slice 6, D1) — the ticket's own central safety rule: a hard-gate dimension alone isn't
  // enough for language/certification. Without a SUBJECT there is no way to tell this gate apart
  // from any other one on the same dimension, so it clamps to ordinary exactly like a missing
  // eligibilityDimension does.
  it("clamps a blocking language requirement with a hard-gate dimension but NO eligibilitySubject", async () => {
    const before = readCounters()["adReader.blocking_clamped"];
    const doc = {
      ...validDoc,
      requirements: [
        {
          id: "fluent-mandarin",
          band: "essential",
          kind: "blocking",
          requirement: "Fluent Mandarin required",
          eligibilityDimension: "language",
          sourceSpan: "Fluent Mandarin is required for this role",
        },
      ],
    };
    const llm = fakeLlm([JSON.stringify(doc)]);
    const result = await readAdvert(posting(), llm, FAMILIES, INDUSTRIES);
    expect(result?.requirements.requirements[0]?.kind).toBe("ordinary");
    expect(readCounters()["adReader.blocking_clamped"]).toBe(before + 1);
  });

  // work-rights carries no subject by design (the fact is global, not scoped to a subject) — must
  // NOT be clamped for lacking eligibilitySubject the way language/certification are.
  it("a blocking work-rights requirement survives without an eligibilitySubject — it has none by design", async () => {
    const doc = {
      ...validDoc,
      requirements: [
        {
          id: "visa-sponsorship",
          band: "essential",
          kind: "blocking",
          requirement: "Right to work required, no visa sponsorship",
          eligibilityDimension: "work-rights",
          sourceSpan: "must have the right to work without sponsorship",
        },
      ],
    };
    const llm = fakeLlm([JSON.stringify(doc)]);
    const result = await readAdvert(posting(), llm, FAMILIES, INDUSTRIES);
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
    const result = await readAdvert(posting(), llm, FAMILIES, INDUSTRIES);
    expect(result?.requirements.requirements[0]?.kind).toBe("ordinary");
  });

  it("uses completeWithUsage and records real token counts when the driver offers it", async () => {
    const llm = fakeLlm([JSON.stringify(validDoc)], { withUsage: true, model: "claude-sonnet-5" });
    const result = await readAdvert(posting(), llm, FAMILIES, INDUSTRIES);
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
    await readAdvert(posting(), llm, FAMILIES, INDUSTRIES);
    expect(readCounters()["adReader.cost_reads_recorded"]).toBe(before.reads + 1);
    expect(readCounters()["adReader.cost_input_tokens_total"]).toBe(before.input + 1000);
    expect(readCounters()["adReader.cost_output_tokens_total"]).toBe(before.output + 200);
  });

  it("an unmeasured read (no completeWithUsage) does not move the cost aggregate counters", async () => {
    const before = readCounters()["adReader.cost_reads_recorded"];
    const llm = fakeLlm([JSON.stringify(validDoc)], { model: "sonnet" });
    await readAdvert(posting(), llm, FAMILIES, INDUSTRIES);
    expect(readCounters()["adReader.cost_reads_recorded"]).toBe(before); // stays unmeasured, not zero-costed
  });

  it("falls back to complete() and stores null token counts — never an estimate — when usage isn't offered", async () => {
    const llm = fakeLlm([JSON.stringify(validDoc)], { model: "sonnet" });
    const result = await readAdvert(posting(), llm, FAMILIES, INDUSTRIES);
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
    const result = await readAdvert(posting(), llm, FAMILIES, INDUSTRIES);
    expect(calls).toHaveLength(2);
    expect(result?.cost).toEqual({ model: "claude-sonnet-5", inputTokens: 1100, outputTokens: 130 });
  });
});

describe("#104 makeAdReader — the shared, persisted, version-aware cache", () => {
  it("a first read calls the model and persists the result", async () => {
    const store = new InMemoryAdRequirementsStore();
    const llm = fakeLlm([JSON.stringify(validDoc)]);
    const readAd = makeAdReader(llm, store, FAMILIES, INDUSTRIES);
    const result = await readAd(posting());
    expect(llm.calls).toHaveLength(1);
    expect(result?.adId).toBe("ad-1");
    const stored = await store.get("ad-1");
    expect(stored?.version).toBe(adReaderVersion(FAMILIES, INDUSTRIES));
    expect(stored?.requirements).toEqual(result);
  });

  it("a second read of the same ad reuses the store — no additional model call", async () => {
    const store = new InMemoryAdRequirementsStore();
    const llm = fakeLlm([JSON.stringify(validDoc)]);
    const readAd = makeAdReader(llm, store, FAMILIES, INDUSTRIES);
    await readAd(posting());
    await readAd(posting());
    expect(llm.calls).toHaveLength(1);
  });

  // #104 review finding 7: without in-flight dedupe, "nobody pays twice" held only sequentially —
  // two deck requests landing together at cold start would both miss the store and both pay.
  it("concurrent cold reads for the same advert share one in-flight read", async () => {
    const store = new InMemoryAdRequirementsStore();
    const llm = fakeLlm([JSON.stringify(validDoc)]);
    const readAd = makeAdReader(llm, store, FAMILIES, INDUSTRIES);
    const [a, b] = await Promise.all([readAd(posting()), readAd(posting())]);
    expect(llm.calls).toHaveLength(1);
    expect(a).toEqual(b);
  });

  // #165 AC5: an additive contract field is only half the change — every advert ALREADY stored was
  // read by a prompt that could not produce it. The contract token below is what makes those rows
  // stale, and the test above is what proves a stale row is re-read exactly once, lazily. Pinning it
  // means a future contract change that forgets the bump fails here rather than shipping a fleet of
  // stored reads silently missing the new field.
  it("the reader's version carries the CURRENT ad-requirements contract token", () => {
    expect(adReaderVersion(FAMILIES, INDUSTRIES)).toContain("adreq/4");
  });

  it("a stale stored version triggers exactly one fresh read (a prompt/contract bump)", async () => {
    const store = new InMemoryAdRequirementsStore();
    await store.put("ad-1", {
      requirements: AdRequirementsV1.parse({ schemaVersion: "1", adId: "ad-1", curated: false, ...validDoc }),
      version: "ad-reader/0+adreq/0", // stale — a version ago
      cost: { model: "sonnet", inputTokens: null, outputTokens: null, readAt: "2020-01-01T00:00:00.000Z" },
    });
    const llm = fakeLlm([JSON.stringify(validDoc)]);
    const readAd = makeAdReader(llm, store, FAMILIES, INDUSTRIES);
    await readAd(posting());
    expect(llm.calls).toHaveLength(1); // re-read triggered by the version mismatch
    expect((await store.get("ad-1"))?.version).toBe(adReaderVersion(FAMILIES, INDUSTRIES));
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
    const readAd = makeAdReader(llm, store, FAMILIES, INDUSTRIES);
    const result = await readAd(posting());
    expect(llm.calls).toHaveLength(1);
    expect(result?.adId).toBe("ad-1");
    expect((await store.get("ad-1"))?.version).toBe(adReaderVersion(FAMILIES, INDUSTRIES)); // the broken row is replaced
  });

  it("a read that fails twice never throws out of makeAdReader — drops the card, counts the failure, and records why", async () => {
    const before = readCounters()["postings.read_failed"];
    const store = new InMemoryAdRequirementsStore();
    const llm = fakeLlm(["not json", "still not json"]);
    const readAd = makeAdReader(llm, store, FAMILIES, INDUSTRIES);
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
    const readAd = makeAdReader(llm, store, FAMILIES, INDUSTRIES);
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
    const readAd = makeAdReader(llm, store, FAMILIES, INDUSTRIES);
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
    const readAd = makeAdReader(llm, store, FAMILIES, INDUSTRIES);
    const result = await readAd(posting());
    expect(result?.adId).toBe("ad-1"); // the paid read isn't thrown away over a storage outage
    expect(readCounters()["postings.read_failed"]).toBe(before + 1);
    expect(recentReadFailuresList().filter((f) => f.adId === "ad-1").at(-1)?.class).toBe("store-unavailable");
  });

  // #114 — the negative cache: an advert that failed readAdvert must not be re-attempted at full
  // cost on the very next request for it.
  describe("#114 makeAdReader — the negative cache", () => {
    it("suppresses the next attempt right after a failure — no second model call, and adReader.read_suppressed moves, without re-counting postings.read_failed", async () => {
      const before = {
        suppressed: readCounters()["adReader.read_suppressed"],
        failed: readCounters()["postings.read_failed"],
      };
      const store = new InMemoryAdRequirementsStore();
      const llm = fakeLlm(["not json", "still not json"]);
      const readAd = makeAdReader(llm, store, FAMILIES, INDUSTRIES);
      const first = await readAd(posting());
      expect(first).toBeNull();
      expect(llm.calls).toHaveLength(2); // the two-attempt readAdvert loop
      const second = await readAd(posting());
      expect(second).toBeNull();
      expect(llm.calls).toHaveLength(2); // no further model call — suppressed
      expect(readCounters()["adReader.read_suppressed"]).toBe(before.suppressed + 1);
      expect(readCounters()["postings.read_failed"]).toBe(before.failed + 1); // NOT re-incremented
    });

    it("a raw LLM-call failure is also negatively cached, the same as a validation failure", async () => {
      const store = new InMemoryAdRequirementsStore();
      let callCount = 0;
      const llm: LlmClient = {
        async complete() {
          callCount++;
          throw new Error("network blip");
        },
      };
      const readAd = makeAdReader(llm, store, FAMILIES, INDUSTRIES);
      await readAd(posting());
      expect(callCount).toBe(1);
      await readAd(posting());
      expect(callCount).toBe(1); // suppressed — no second call
    });

    it("does NOT negatively cache a store.get() outage — no model call was made, so nothing to suppress", async () => {
      const before = readCounters()["adReader.read_suppressed"];
      const store = flakyStore({ onGet: true });
      const llm = fakeLlm([JSON.stringify(validDoc), JSON.stringify(validDoc)]);
      const readAd = makeAdReader(llm, store, FAMILIES, INDUSTRIES);
      await readAd(posting()); // store.get() throws before any model call
      expect(llm.calls).toHaveLength(0);
      await readAd(posting()); // still a store outage — never suppressed, so this attempts again too
      expect(llm.calls).toHaveLength(0);
      expect(readCounters()["adReader.read_suppressed"]).toBe(before); // the suppression path never fires
    });

    it("retries exactly once after the backoff window passes — not suppressed forever, not a stampede", async () => {
      const store = new InMemoryAdRequirementsStore();
      const llm = fakeLlm(["not json", "still not json", JSON.stringify(validDoc)]);
      const readAd = makeAdReader(llm, store, FAMILIES, INDUSTRIES);
      const start = Date.now();
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(start);
      try {
        await readAd(posting()); // fails, suppressed for SUPPRESSION_BASE_MS
        expect(llm.calls).toHaveLength(2);
        nowSpy.mockReturnValue(start + SUPPRESSION_BASE_MS - 1);
        await readAd(posting()); // still within the backoff window
        expect(llm.calls).toHaveLength(2);
        nowSpy.mockReturnValue(start + SUPPRESSION_BASE_MS + 1);
        const result = await readAd(posting()); // backoff has elapsed — exactly one retry
        expect(llm.calls).toHaveLength(3);
        expect(result?.adId).toBe("ad-1"); // this attempt actually succeeded
        // A second immediate call must not retry AGAIN — the successful read is now cached in the
        // store (the ordinary version-match path), so this never even reaches the negative cache.
        await readAd(posting());
        expect(llm.calls).toHaveLength(3);
      } finally {
        nowSpy.mockRestore();
      }
    });

    it("escalates the backoff on a second consecutive failure rather than resetting it", async () => {
      const store = new InMemoryAdRequirementsStore();
      const llm = fakeLlm(["nope", "nope", "nope", "nope"]);
      const readAd = makeAdReader(llm, store, FAMILIES, INDUSTRIES);
      const start = Date.now();
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(start);
      try {
        await readAd(posting()); // 1st failure -> backoff = SUPPRESSION_BASE_MS
        expect(llm.calls).toHaveLength(2);
        nowSpy.mockReturnValue(start + SUPPRESSION_BASE_MS + 1);
        await readAd(posting()); // retried, fails again -> backoff escalates to 2x base
        expect(llm.calls).toHaveLength(4);
        // Only ONE base interval further — if the backoff had reset instead of escalated, this
        // would already be past it and would fire a third attempt.
        nowSpy.mockReturnValue(start + SUPPRESSION_BASE_MS + 1 + SUPPRESSION_BASE_MS + 1);
        const stillSuppressed = await readAd(posting());
        expect(stillSuppressed).toBeNull();
        expect(llm.calls).toHaveLength(4); // no new call — the doubled interval hasn't elapsed yet
      } finally {
        nowSpy.mockRestore();
      }
    });

    it("counts adReader.read_suppression_lifted exactly once when the backoff expires and the retry is attempted, not on every suppressed request", async () => {
      const before = readCounters()["adReader.read_suppression_lifted"];
      const store = new InMemoryAdRequirementsStore();
      const llm = fakeLlm(["nope", "nope", JSON.stringify(validDoc)]);
      const readAd = makeAdReader(llm, store, FAMILIES, INDUSTRIES);
      const start = Date.now();
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(start);
      try {
        await readAd(posting());
        await readAd(posting()); // still suppressed — must not count as "lifted"
        expect(readCounters()["adReader.read_suppression_lifted"]).toBe(before);
        nowSpy.mockReturnValue(start + SUPPRESSION_BASE_MS + 1);
        await readAd(posting()); // backoff elapsed — lifted, then retried
        expect(readCounters()["adReader.read_suppression_lifted"]).toBe(before + 1);
      } finally {
        nowSpy.mockRestore();
      }
    });

    // #114 review must-fix 4: a genuine success used to leave its suppression entry lingering. If
    // store.put then failed (the read succeeded but wasn't persisted), the NEXT request would find
    // that stale entry, spuriously count it as "lifted" again, and — had it failed instead of
    // succeeded — would have resumed escalating failureCount from a number a real success already
    // disproved. Fixed by deleting the entry the moment readAdvert succeeds, before store.put even
    // runs.
    it("clears the suppression entry on a genuine success, so a subsequent store.put failure does not resurrect it as a stale 'lift'", async () => {
      const store = flakyStore({ onPut: true });
      const llm = fakeLlm(["nope", "nope", JSON.stringify(validDoc), JSON.stringify(validDoc)]);
      const readAd = makeAdReader(llm, store, FAMILIES, INDUSTRIES);
      const start = Date.now();
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(start);
      try {
        await readAd(posting()); // fails twice — suppressed
        nowSpy.mockReturnValue(start + SUPPRESSION_BASE_MS + 1); // backoff elapsed
        const beforeLifted = readCounters()["adReader.read_suppression_lifted"];
        const beforeSuppressed = readCounters()["adReader.read_suppressed"];
        const first = await readAd(posting()); // retried, SUCCEEDS, but store.put throws
        expect(first?.adId).toBe("ad-1"); // the paid read still comes back — a storage outage, not a read failure
        expect(readCounters()["adReader.read_suppression_lifted"]).toBe(beforeLifted + 1); // lifted exactly once, for this retry

        // A second request, at the SAME mocked "now" — well within what would have been the OLD
        // backoff window had the stale entry survived — must be a plain cache-miss retry, not a
        // "lift" and not a suppression: the entry was deleted the moment the read above succeeded.
        const second = await readAd(posting());
        expect(second?.adId).toBe("ad-1");
        expect(readCounters()["adReader.read_suppression_lifted"]).toBe(beforeLifted + 1); // NOT incremented again
        expect(readCounters()["adReader.read_suppressed"]).toBe(beforeSuppressed); // never suppressed either
      } finally {
        nowSpy.mockRestore();
      }
    });
  });

  describe("#114 computeSuppressionBackoffMs / isSuppressionActive — pure, exact-input tested", () => {
    it("doubles on each consecutive failure and caps at SUPPRESSION_MAX_MS", () => {
      expect(computeSuppressionBackoffMs(1)).toBe(SUPPRESSION_BASE_MS);
      expect(computeSuppressionBackoffMs(2)).toBe(SUPPRESSION_BASE_MS * 2);
      expect(computeSuppressionBackoffMs(3)).toBe(SUPPRESSION_BASE_MS * 4);
      const manyFailures = computeSuppressionBackoffMs(20);
      expect(manyFailures).toBe(SUPPRESSION_MAX_MS); // never exceeds the hard cap
    });

    // #114 review: the version check is defense-in-depth, not the live AC4 guarantee (see
    // isSuppressionActive's own doc) — the reader's version can't move within a running process today,
    // so this asserts the LOGIC is correct as code, not that production ever exercises this branch.
    // AC4's actual operative guarantee is the expired-retryAt case just below: SUPPRESSION_MAX_MS
    // caps the backoff, so every suppressed advert is retried within the hour regardless of version.
    it("is active only when the version matches AND the retry deadline hasn't passed", () => {
      const entry = { version: "v1", retryAt: 1_000, failureCount: 1 };
      expect(isSuppressionActive(entry, "v1", 999)).toBe(true); // before the deadline, same version
      expect(isSuppressionActive(entry, "v1", 1_000)).toBe(false); // AC3: exactly at the deadline, expired
      expect(isSuppressionActive(entry, "v2", 999)).toBe(false); // defense-in-depth: a version mismatch also lifts it
    });
  });
});

// #243 — the reader answers into the ONE closed vocabulary the rest of the system speaks: the
// published production family ids. AC1: the family it names is one from the published vocabulary
// or "none of these" — never invented free text. AC5: a change to the published family list makes
// every stored read stale, so it is re-read (lazily, at most once) the next time it is needed.
describe("#243 closed-vocabulary family fit", () => {
  it("clamps a familyFit outside the closed list to NO_KNOWN_FAMILY, counted — never free text", async () => {
    const before = readCounters()["adReader.family_clamped"];
    const doc = { ...validDoc, familyFit: { family: "Construction Manager", confidence: 0.95 } };
    const llm = fakeLlm([JSON.stringify(doc)]);
    const result = await readAdvert(posting(), llm, FAMILIES, INDUSTRIES);
    expect(llm.calls).toHaveLength(1); // a clamp, not a retry — the read itself was good
    expect(result?.requirements.familyFit).toEqual({ family: NO_KNOWN_FAMILY, confidence: 0.95 });
    expect(readCounters()["adReader.family_clamped"]).toBe(before + 1);
  });

  it('accepts the literal "none of these" unclamped', async () => {
    const before = readCounters()["adReader.family_clamped"];
    const doc = { ...validDoc, familyFit: { family: NO_KNOWN_FAMILY, confidence: 0.4 } };
    const llm = fakeLlm([JSON.stringify(doc)]);
    const result = await readAdvert(posting(), llm, FAMILIES, INDUSTRIES);
    expect(result?.requirements.familyFit.family).toBe(NO_KNOWN_FAMILY);
    expect(readCounters()["adReader.family_clamped"]).toBe(before);
  });

  it("folds the family list into the reader version — a different list is a different version", () => {
    const other = [
      ...FAMILIES,
      { familyId: "data-analytics", label: "Data analytics", scope: "Analytics work" },
    ];
    expect(adReaderVersion(other, INDUSTRIES)).not.toBe(adReaderVersion(FAMILIES, INDUSTRIES));
    expect(adReaderVersion(other, INDUSTRIES)).toContain("adreq/4"); // the contract half is untouched by the list
  });

  // AC5 end-to-end at the reader seam: a read stored under the OLD family list is stale under the
  // new one — exactly one fresh read, persisted under the new version, same lazy machinery as a
  // prompt/contract bump.
  it("re-reads a stored read from a previous family list exactly once", async () => {
    const oldFamilies = [{ familyId: "old-family", label: "Old family", scope: "The old world" }];
    const store = new InMemoryAdRequirementsStore();
    const firstLlm = fakeLlm([JSON.stringify({ ...validDoc, familyFit: { family: "old-family", confidence: 0.9 } })]);
    await makeAdReader(firstLlm, store, oldFamilies, INDUSTRIES)(posting());
    expect((await store.get("ad-1"))?.version).toBe(adReaderVersion(oldFamilies, INDUSTRIES));

    const secondLlm = fakeLlm([JSON.stringify(validDoc)]);
    const readAd = makeAdReader(secondLlm, store, FAMILIES, INDUSTRIES);
    const reread = await readAd(posting());
    expect(secondLlm.calls).toHaveLength(1); // stale under the new list — re-read
    expect(reread?.familyFit.family).toBe("IT Project Manager");
    expect((await store.get("ad-1"))?.version).toBe(adReaderVersion(FAMILIES, INDUSTRIES));
    await readAd(posting());
    expect(secondLlm.calls).toHaveLength(1); // and only once — the fresh row is current again
  });
});

// #284 — the other side of the match: an advert that asks for years in an INDUSTRY is finally read
// as asking for it. Nothing is scored differently here (that is #285); this makes the advert's
// question legible, in the one closed vocabulary the labeler also speaks.
describe("#284 the industry years scope", () => {
  const yearsReq = (over: Record<string, unknown>) => ({
    id: "years",
    band: "essential",
    kind: "ordinary",
    requirement: "Years of experience",
    eligibilityDimension: "years-experience",
    comparable: { op: ">=", value: 8 },
    sourceSpan: "8+ years of IT experience including 5+ years as a Project Manager",
    ...over,
  });

  it("puts the published industry list (label, id, scope) into the prompt the model reads", () => {
    const input = buildAdReaderInput(posting(), FAMILIES, INDUSTRIES);
    expect(input).toContain("### IT services");
    expect(input).toContain("id: it-services");
    expect(input).toContain("covers: Delivering IT to other businesses");
    expect(input).toContain("### Banking");
    expect(input).not.toContain("{{KNOWN_INDUSTRIES}}"); // substituted, not left as a placeholder
  });

  // AC4 — the motivating advert. One sentence, TWO bars at two scopes, each keeping the advert's own
  // words it was drawn from. The model answer is a fake; what this pins is that the contract and the
  // clamps carry a compound reading through intact rather than folding it into one number.
  it('reads "8+ years of IT experience including 5+ years as a Project Manager" as two bars', async () => {
    const sentence = "8+ years of IT experience including 5+ years as a Project Manager";
    const doc = {
      ...validDoc,
      requirements: [
        yearsReq({ id: "it-years", yearsScope: "industry", yearsIndustry: "it-services" }),
        yearsReq({ id: "pm-years", comparable: { op: ">=", value: 5 } }),
      ],
    };
    const result = await readAdvert(posting(), fakeLlm([JSON.stringify(doc)]), FAMILIES, INDUSTRIES);
    const [industryBar, familyBar] = result!.requirements.requirements;
    expect(industryBar).toMatchObject({
      yearsScope: "industry",
      yearsIndustry: "it-services",
      comparable: { op: ">=", value: 8 },
      sourceSpan: sentence,
    });
    expect(familyBar?.yearsScope).toBeUndefined(); // absent reads as family — the plain reading
    expect(familyBar?.yearsIndustry).toBeUndefined();
    expect(familyBar?.comparable).toEqual({ op: ">=", value: 5 });
    expect(familyBar?.sourceSpan).toBe(sentence);
  });

  // AC5 — no existing reading regresses. The two scopes that already existed still come back exactly
  // as they were, with no industry attached.
  it("leaves a total-scope and a family-scope bar exactly as they were", async () => {
    const doc = {
      ...validDoc,
      requirements: [
        yearsReq({ id: "career-years", yearsScope: "total", sourceSpan: "8+ years of professional experience" }),
        yearsReq({ id: "role-years", comparable: { op: ">=", value: 5 }, sourceSpan: "5+ years' experience" }),
      ],
    };
    const result = await readAdvert(posting(), fakeLlm([JSON.stringify(doc)]), FAMILIES, INDUSTRIES);
    const [total, family] = result!.requirements.requirements;
    expect(total?.yearsScope).toBe("total");
    expect(total?.yearsIndustry).toBeUndefined();
    expect(family?.yearsScope).toBeUndefined();
    expect(family?.yearsIndustry).toBeUndefined();
  });

  // AC6 — an advert naming an industry we do not publish carries NONE. Visible as an absence: the
  // bar keeps its industry scope (the advert really did ask about an industry) and simply names no
  // id, which leaves it untestable. Our missing vocabulary is never charged to the person.
  it("drops an industry id that is not published, counted, and keeps the scope as an absence", async () => {
    const before = readCounters()["adReader.industry_clamped"];
    const doc = {
      ...validDoc,
      requirements: [yearsReq({ yearsScope: "industry", yearsIndustry: "aerospace" })],
    };
    const llm = fakeLlm([JSON.stringify(doc)]);
    const result = await readAdvert(posting(), llm, FAMILIES, INDUSTRIES);
    expect(llm.calls).toHaveLength(1); // a clamp, not a retry — the read itself was good
    const bar = result!.requirements.requirements[0];
    expect(bar?.yearsScope).toBe("industry");
    expect(bar?.yearsIndustry).toBeUndefined();
    expect(readCounters()["adReader.industry_clamped"]).toBe(before + 1);
  });

  // An id riding on a bar that is not at industry scope names nothing — dropped the same way
  // clampBlocking drops a language level on a non-language requirement.
  it("drops an industry id on a bar that is not at industry scope", async () => {
    const doc = {
      ...validDoc,
      requirements: [yearsReq({ yearsScope: "total", yearsIndustry: "it-services" })],
    };
    const result = await readAdvert(posting(), fakeLlm([JSON.stringify(doc)]), FAMILIES, INDUSTRIES);
    expect(result!.requirements.requirements[0]?.yearsIndustry).toBeUndefined();
  });

  // The #243 trap, applied to the second vocabulary: hashing only the pre-substitution template would
  // let a published-industry change leave every stored read answering from the OLD list forever.
  it("folds the industry list into the reader version — a different list is a different version", () => {
    expect(adReaderVersion(FAMILIES, [])).not.toBe(adReaderVersion(FAMILIES, INDUSTRIES));
    expect(adReaderVersion(FAMILIES, [INDUSTRIES[0]!])).not.toBe(adReaderVersion(FAMILIES, INDUSTRIES));
    expect(adReaderVersion(FAMILIES, INDUSTRIES)).toContain("adreq/4");
  });

  it("re-reads a stored read from a previous industry list exactly once", async () => {
    const store = new InMemoryAdRequirementsStore();
    const firstLlm = fakeLlm([JSON.stringify(validDoc)]);
    await makeAdReader(firstLlm, store, FAMILIES, [INDUSTRIES[0]!])(posting());
    expect((await store.get("ad-1"))?.version).toBe(adReaderVersion(FAMILIES, [INDUSTRIES[0]!]));

    const secondLlm = fakeLlm([JSON.stringify(validDoc)]);
    const readAd = makeAdReader(secondLlm, store, FAMILIES, INDUSTRIES);
    await readAd(posting());
    expect(secondLlm.calls).toHaveLength(1); // stale under the new list — re-read
    await readAd(posting());
    expect(secondLlm.calls).toHaveLength(1); // and only once
  });
});
