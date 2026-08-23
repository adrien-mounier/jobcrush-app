// #282 — the employer web lookup: one cached search per company, shared by everyone, and never able
// to block an upload.
//
// Tested at the HTTP seam, with a fake endpoint INJECTED where production injects the real one. What
// these tests assert is the request we actually send (the server-side web search tool, the employer name and nothing else) and
// what we do with every shape of answer. That the request is ACCEPTED by the real API is not
// something a stub can prove — see the ticket's own real-API evidence for that half.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  InMemoryEmployerLookupStore,
  makeEmployerLookup,
  normaliseEmployerKey,
  webSearchUsdPerSearch,
  type EmployerLookupStore,
} from "../src/employerLookup.js";
import { readCounters, resetCountersForTest } from "../src/counters.js";
import { InMemoryUsageLedgerStore } from "../src/usageLedgerStore.js";

const answer = (text: string, extra: Record<string, unknown> = {}) => ({
  content: [
    { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "acme" } },
    { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [] },
    { type: "text", text },
  ],
  stop_reason: "end_turn",
  usage: { input_tokens: 4000, output_tokens: 200, server_tool_use: { web_search_requests: 2 } },
  ...extra,
});

/** A fake Anthropic endpoint, injected at the same seam production injects the real one — the repo's
 *  own idiom for an outbound HTTP caller (postingProvider.ts's `fetchImpl`), not a stubbed global. */
function fakeFetch(respond: (call: number) => unknown) {
  const bodies: any[] = [];
  const fetchSpy = vi.fn(async (_url: any, init: any) => {
    bodies.push(JSON.parse(init.body));
    const result = respond(bodies.length);
    if (result instanceof Error) throw result;
    if (typeof result === "number") {
      return { ok: false, status: result, text: async () => "boom" } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => result } as unknown as Response;
  });
  return { fetchImpl: fetchSpy as unknown as typeof fetch, fetchSpy, bodies };
}

beforeEach(() => resetCountersForTest());

describe("the cache key — two spellings of one company are one company", () => {
  it("folds case, punctuation, accents and trailing legal forms", () => {
    expect(normaliseEmployerKey("Acme Solutions Ltd.")).toBe("acme solutions");
    expect(normaliseEmployerKey("  ACME   SOLUTIONS LIMITED ")).toBe("acme solutions");
    expect(normaliseEmployerKey("Acme Solutions Pty Ltd")).toBe("acme solutions");
    expect(normaliseEmployerKey("Société Générale S.A.")).toBe("societe generale");
  });

  it("folds a slashed legal form — found by the real-API run, which paid for Nordea twice", () => {
    expect(normaliseEmployerKey("Nordea Bank A/S")).toBe("nordea bank");
    expect(normaliseEmployerKey("nordea bank a/s")).toBe(normaliseEmployerKey("Nordea Bank"));
    // ...and only between two single letters. A slash anywhere else is a real word break.
    expect(normaliseEmployerKey("Marks/Spencer")).toBe("marks spencer");
  });

  it("keeps words that are part of the name, not the legal form", () => {
    // Dropping these would collide two genuinely different businesses into one shared answer, which
    // is the one failure of this cache that does not heal itself.
    expect(normaliseEmployerKey("Acme Group")).toBe("acme group");
    expect(normaliseEmployerKey("Acme Holdings")).toBe("acme holdings");
    expect(normaliseEmployerKey("Acme International")).toBe("acme international");
  });

  it("never strips a name down to nothing", () => {
    expect(normaliseEmployerKey("Co")).toBe("co");
    expect(normaliseEmployerKey("")).toBe("");
    expect(normaliseEmployerKey("   ---  ")).toBe("");
  });
});

describe("AC1 — the lookup runs on Anthropic's own server-side web search, on the existing key", () => {
  it("sends the web search tool and nothing but the employer name", async () => {
    const { fetchImpl, fetchSpy, bodies } = fakeFetch(() => answer("Acme sells industrial pumps."));
    const lookup = makeEmployerLookup({ fetchImpl, apiKey: "sk-test", store: new InMemoryEmployerLookupStore() });

    expect(await lookup("Acme Pumps Ltd")).toBe("Acme sells industrial pumps.");

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init as any).headers["x-api-key"]).toBe("sk-test");
    expect(bodies[0].tools).toEqual([
      { type: "web_search_20260209", name: "web_search", max_uses: 3 },
    ]);
    // The prompt carries the employer name. A cached row is read by strangers, so nothing about the
    // person whose CV named the employer may go out with the question.
    const prompt: string = bodies[0].messages[0].content;
    expect(prompt).toContain("Acme Pumps Ltd");
    expect(prompt).toContain("Look up this company on the web");
  });

  it("resumes a paused turn, hands the assistant message straight back, and KEEPS what it already said", async () => {
    const f = fakeFetch((call) =>
      call === 1
        ? answer("Acme makes industrial pumps.", { stop_reason: "pause_turn" })
        : answer(" It sells them to water utilities."),
    );
    const lookup = makeEmployerLookup({ ...f, apiKey: "sk-test", store: new InMemoryEmployerLookupStore() });

    // A resumed turn CONTINUES the answer rather than restarting it, so the first turn's sentence is
    // part of the answer. Overwriting it lost half of what we paid for — and a final turn that added
    // nothing would have read as an empty lookup and degraded the job for no reason.
    expect(await lookup("Acme")).toBe("Acme makes industrial pumps. It sells them to water utilities.");
    expect(f.fetchSpy).toHaveBeenCalledTimes(2);
    // Unchanged, blocks and all — the search results inside carry encrypted content the API decrypts
    // to restore its own context, and editing them is a 400.
    expect(f.bodies[1].messages[1]).toEqual({
      role: "assistant",
      content: answer("Acme makes industrial pumps.").content,
    });
  });
});

describe("AC2 — a company is paid for once, ever", () => {
  it("makes no second call for the same employer, or for another spelling of it", async () => {
    const { fetchImpl, fetchSpy } = fakeFetch(() => answer("Acme sells industrial pumps."));
    const store = new InMemoryEmployerLookupStore();
    const lookup = makeEmployerLookup({ fetchImpl, apiKey: "sk-test", store });

    await lookup("Acme Pumps Ltd");
    await lookup("acme pumps limited");
    await lookup("  ACME  PUMPS,  LTD. ");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(readCounters()["employerLookup.looked_up"]).toBe(1);
    expect(readCounters()["employerLookup.cache_hit"]).toBe(2);
  });

  it("is shared across sessions — a second person's upload reads the first person's answer", async () => {
    const { fetchImpl, fetchSpy } = fakeFetch(() => answer("Acme sells industrial pumps."));
    const store = new InMemoryEmployerLookupStore();
    // Two independently constructed lookups over ONE store: nothing about the caller is part of the
    // key, so whoever arrives second pays nothing.
    await makeEmployerLookup({ fetchImpl, apiKey: "sk-test", store })("Acme Pumps Ltd");
    const second = await makeEmployerLookup({ fetchImpl, apiKey: "sk-test", store })("Acme Pumps Ltd");

    expect(second).toBe("Acme sells industrial pumps.");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("AC5 — a failed, timed-out or empty lookup degrades to CV evidence alone", () => {
  const failures: Array<[string, () => unknown]> = [
    ["an API error", () => 500],
    ["a network failure", () => new Error("socket hang up")],
    ["a timeout", () => Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" })],
  ];

  for (const [name, respond] of failures) {
    it(`returns null and counts it on ${name}`, async () => {
      const { fetchImpl } = fakeFetch(respond as (call: number) => unknown);
      const lookup = makeEmployerLookup({ fetchImpl, apiKey: "sk-test", store: new InMemoryEmployerLookupStore() });

      expect(await lookup("Acme Pumps Ltd")).toBeNull();
      expect(readCounters()["employerLookup.failed"]).toBe(1);
    });
  }

  it("counts an empty answer separately from a failure", async () => {
    const { fetchImpl } = fakeFetch(() => answer("   "));
    const lookup = makeEmployerLookup({ fetchImpl, apiKey: "sk-test", store: new InMemoryEmployerLookupStore() });

    expect(await lookup("Acme Pumps Ltd")).toBeNull();
    expect(readCounters()["employerLookup.empty"]).toBe(1);
    expect(readCounters()["employerLookup.failed"]).toBe(0);
  });

  it("never caches a failure — the next run looks the employer up for real", async () => {
    // The mirror of industryLabeler's "a degraded answer is never stored". A cached failure would
    // make one bad minute permanent for every visitor who ever names this employer.
    const { fetchImpl, fetchSpy } = fakeFetch((call) => (call === 1 ? 500 : answer("Acme sells industrial pumps.")));
    const store = new InMemoryEmployerLookupStore();
    const lookup = makeEmployerLookup({ fetchImpl, apiKey: "sk-test", store });

    expect(await lookup("Acme Pumps Ltd")).toBeNull();
    expect(await lookup("Acme Pumps Ltd")).toBe("Acme sells industrial pumps.");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("never caches an empty answer either", async () => {
    const { fetchImpl, fetchSpy } = fakeFetch((call) => (call === 1 ? answer("") : answer("Acme sells pumps.")));
    const store = new InMemoryEmployerLookupStore();
    const lookup = makeEmployerLookup({ fetchImpl, apiKey: "sk-test", store });

    expect(await lookup("Acme")).toBeNull();
    expect(await lookup("Acme")).toBe("Acme sells pumps.");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("survives a cache that is broken in both directions", async () => {
    const broken: EmployerLookupStore = {
      async init() {},
      async get() {
        throw new Error("db down");
      },
      async put() {
        throw new Error("db down");
      },
    };
    const { fetchImpl } = fakeFetch(() => answer("Acme sells industrial pumps."));
    const lookup = makeEmployerLookup({ fetchImpl, apiKey: "sk-test", store: broken });

    // The answer still reaches the labeler; only the saving of it was lost.
    expect(await lookup("Acme Pumps Ltd")).toBe("Acme sells industrial pumps.");
    expect(readCounters()["employerLookup.cache_read_failed"]).toBe(1);
    expect(readCounters()["employerLookup.cache_write_failed"]).toBe(1);
  });

  it("asks nothing at all for an employer with no usable name", async () => {
    const { fetchImpl, fetchSpy } = fakeFetch(() => answer("never reached"));
    const lookup = makeEmployerLookup({ fetchImpl, apiKey: "sk-test", store: new InMemoryEmployerLookupStore() });

    expect(await lookup("   ")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(readCounters()["employerLookup.failed"]).toBe(0);
  });
});

describe("AC8 — the spend is priced from Anthropic's own model, per search as well as per token", () => {
  it("records one ledger row carrying the per-search charge on top of the tokens", async () => {
    const { fetchImpl } = fakeFetch(() => answer("Acme sells industrial pumps."));
    const ledger = new InMemoryUsageLedgerStore();
    await ledger.init();
    const lookup = makeEmployerLookup({
      fetchImpl,
      apiKey: "sk-test",
      store: new InMemoryEmployerLookupStore(),
      model: "claude-sonnet-5",
      ledger,
      pricing: { "claude-sonnet-5": { inputPerMillionUsd: 3, outputPerMillionUsd: 15 } },
    });

    await lookup("Acme Pumps Ltd");
    await vi.waitFor(async () => expect(await ledger.totalCostUsd()).toBeGreaterThan(0));

    // 4000 in + 200 out at $3/$15 per million = $0.015, plus 2 searches at $0.01 = $0.035.
    expect(await ledger.totalCostUsd()).toBeCloseTo(0.015 + 2 * webSearchUsdPerSearch(), 6);
    expect(await ledger.costByStage()).toEqual({ "employer-lookup": expect.any(Number) });
  });

  it("attributes the row to nobody — the answer is shared, so no one visitor caused it", async () => {
    const { fetchImpl } = fakeFetch(() => answer("Acme sells industrial pumps."));
    const ledger = new InMemoryUsageLedgerStore();
    await ledger.init();
    await makeEmployerLookup({
      fetchImpl,
      apiKey: "sk-test",
      store: new InMemoryEmployerLookupStore(),
      ledger,
    })("Acme Pumps Ltd");
    await vi.waitFor(async () => expect(await ledger.totalCostUsd()).toBeGreaterThan(0));

    expect(await ledger.costForVisitor("anyone")).toBe(0);
  });

  it("reads the published price from the environment, never from a number baked in here", () => {
    expect(webSearchUsdPerSearch({} as NodeJS.ProcessEnv)).toBe(0.01);
    expect(webSearchUsdPerSearch({ WEB_SEARCH_USD_PER_SEARCH: "0.008" } as NodeJS.ProcessEnv)).toBe(0.008);
    // A nonsense override falls back to the published rate rather than silently zeroing the bill.
    expect(webSearchUsdPerSearch({ WEB_SEARCH_USD_PER_SEARCH: "free" } as NodeJS.ProcessEnv)).toBe(0.01);
    expect(webSearchUsdPerSearch({ WEB_SEARCH_USD_PER_SEARCH: "-1" } as NodeJS.ProcessEnv)).toBe(0.01);
  });
});
