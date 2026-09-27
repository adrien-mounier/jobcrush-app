// #100: behaviour tests for the Techmap provider client (postingProvider.ts) through its real seams
// only — no network. normalizeTechmapItem is tested as a pure function against a fixture envelope
// constructed faithful to §6 of docs/research/live-posting-retrieval-contract.md's measured field
// list (schema.org/JobPosting jsonLD shape) — no real captured Techmap response was available in this
// environment (no funded RapidAPI key here), so this is NOT a captured response; it should be checked
// against a real one before the staging smoke script (scripts/techmap-smoke.mjs) is first run for
// real. TechmapPostingProvider.fetch is exercised with an injected fetchImpl fake — no live call ever
// runs in `pnpm test`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PostingProviderPolicyV1 } from "@jobcrush/contracts";
import {
  canonicalizeTechmapDate,
  FixedWindowBudget,
  MinIntervalGate,
  normalizeTechmapItem,
  resetTechmapPacingForTest,
  TECHMAP_PAGE_SIZE,
  TechmapPostingProvider,
  techmapProviderFromEnv,
  TestFixturePostingProvider,
} from "../src/postingProvider.js";
import { readCounters, resetCountersForTest } from "../src/counters.js";
import { dedupePostings } from "../src/postings.js";
import { InMemoryPostingStore } from "../src/postingStore.js";

// A realistic Techmap (jobdatafeeds.com Jobs API v2.6) result item, constructed faithful to §6's
// measured field list: top-level `title`, and the FULL advert body + every structured field living
// under `jsonLD` (schema.org/JobPosting), never any top-level "description"/"summary" field.
function techmapItem(overrides: Record<string, unknown> = {}, jsonLDOverrides: Record<string, unknown> = {}) {
  return {
    title: "Senior Project Manager",
    url: "https://jobdatafeeds.com/jobs/senior-project-manager-bnp-paribas",
    ...overrides,
    jsonLD: {
      "@context": "https://schema.org/",
      "@type": "JobPosting",
      identifier: { "@type": "PropertyValue", name: "techmap", value: "tm-778812" },
      title: "Senior Project Manager",
      description:
        "**Responsibilities:**\n- Lead delivery of a portfolio of technology programs across APAC.\n- Own stakeholder communication with regional business sponsors.\n\n**Requirements:**\n- 8+ years running IT project delivery.\n- Strong Agile delivery experience.\n\n**Qualifications:**\n- PMP or equivalent preferred.",
      datePosted: "2026-07-28",
      validThrough: "2026-09-01T00:00:00Z",
      employmentType: "FULL_TIME",
      hiringOrganization: { "@type": "Organization", name: "BNP Paribas" },
      jobLocation: {
        "@type": "Place",
        address: { "@type": "PostalAddress", addressLocality: "Hong Kong", addressCountry: "HK" },
      },
      skills: ["Agile delivery", "Stakeholder management"],
      url: "https://jobdatafeeds.com/jobs/senior-project-manager-bnp-paribas",
      ...jsonLDOverrides,
    },
  };
}

const TECHMAP_POLICY: PostingProviderPolicyV1 = {
  schemaVersion: "3",
  providerId: "techmap",
  regionsServed: ["HK", "SG", "VN", "AU"],
  authorityRank: 1,
  permitsStorage: true,
  permitsMatching: true,
  attributionRequired: false,
  attributionTemplate: null,
  rateLimit: { perSecond: 0.4, perMinute: 24, perDay: null, perMonth: 1000 },
  retry: { maxAttempts: 2, backoffMs: 1000 },
  timeoutMs: 10000,
  costModel: { kind: "perThousandPostings", amountUsd: 1 },
  freshnessTtlHours: 24,
  livenessCheckable: true,
};

beforeEach(() => {
  resetCountersForTest();
  // #100 review MF4: the pacing gate + budgets are now shared PROCESS-WIDE per providerId, not per
  // instance — without this reset, one test's injected fake clock (or consumed budget) would leak
  // into the next test's fresh `new TechmapPostingProvider(...)`.
  resetTechmapPacingForTest();
});

describe("normalizeTechmapItem (#100, §6)", () => {
  it("maps jsonLD.description to excerpt whole (never truncated) and carries structured fields through, not flattened into excerpt", () => {
    const record = normalizeTechmapItem(techmapItem(), "2026-08-04T00:00:00Z", TECHMAP_POLICY);
    expect(record).not.toBeNull();
    expect(record!.excerpt).toContain("Lead delivery of a portfolio");
    expect(record!.excerpt).toContain("PMP or equivalent preferred");
    expect(record!.skills).toEqual(["Agile delivery", "Stakeholder management"]);
    expect(record).not.toHaveProperty("applicantLocationRequirements"); // #133: removed, not carried
    // #133 item 3: canonicalized, not verbatim — both already-ISO inputs land on the same
    // uniform ISO 8601 shape (YYYY-MM-DDTHH:mm:ss.sssZ), not a passthrough of whatever the
    // provider happened to send.
    expect(record!.expiresAt).toBe("2026-09-01T00:00:00.000Z"); // jsonLD.validThrough -> expiresAt
    expect(record!.postedAt).toBe("2026-07-28T00:00:00.000Z"); // jsonLD.datePosted -> postedAt
    expect(record!.providerId).toBe("techmap");
    expect(record!.providerPostingId).toBe("tm-778812");
    expect(record!.company).toBe("BNP Paribas");
    expect(record!.location).toBe("Hong Kong, HK");
    expect(record!.capturedAt).toBe("2026-08-04T00:00:00Z");
    expect(record!.verifiedLiveAt).toBe("2026-08-04T00:00:00Z");
  });

  it("pulls attribution from the policy's own attributionTemplate, never invents one", () => {
    const withTemplate = normalizeTechmapItem(techmapItem(), "2026-08-04T00:00:00Z", {
      ...TECHMAP_POLICY,
      attributionTemplate: { label: "via Techmap", url: "https://jobdatafeeds.com" },
    });
    expect(withTemplate!.attribution).toEqual({ label: "via Techmap", url: "https://jobdatafeeds.com" });

    const withoutTemplate = normalizeTechmapItem(techmapItem(), "2026-08-04T00:00:00Z", TECHMAP_POLICY);
    expect(withoutTemplate!.attribution).toBeNull();
  });

  it("tags language at ingest, derived from the excerpt, never taken from the provider", () => {
    const record = normalizeTechmapItem(techmapItem(), "2026-08-04T00:00:00Z", TECHMAP_POLICY);
    expect(record!.language).toBe("en");
  });

  // #100 review MF6: normalizeTechmapItem no longer touches postings.language_skipped/undetermined
  // (that used to inflate with every re-fetch of an already-known posting) — the count moved to
  // postingStore.ts's upsert(), tested in pgstores.test.ts's PostingStore contract block. This test
  // only proves retention + the language label; not the counter.
  it("a non-English advert is RETAINED (not dropped), not filtered out at ingest", () => {
    const chineseDescription = "**職責:**\n- 領導亞太地區的技術項目交付組合。\n- 負責與區域業務發起人的利益相關者溝通。";
    const record = normalizeTechmapItem(
      techmapItem({}, { description: chineseDescription }),
      "2026-08-04T00:00:00Z",
      TECHMAP_POLICY,
    );
    expect(record).not.toBeNull();
    expect(record!.excerpt).toBe(chineseDescription); // retained in full, not withheld
    expect(record!.language).toBe("zh");
  });

  it("an undeterminable excerpt is retained, tagged 'und'", () => {
    const record = normalizeTechmapItem(
      techmapItem({}, { description: "Manage delivery. Own stakeholders." }),
      "2026-08-04T00:00:00Z",
      TECHMAP_POLICY,
    );
    expect(record).not.toBeNull();
    expect(record!.language).toBe("und");
  });

  it("returns null (skips, does not throw) when the advert body is genuinely missing", () => {
    // jsonLD.description is the ONLY source of the advert body (§6) — no top-level fallback exists,
    // so a missing description is unrecoverable and the item is skipped, not fabricated.
    expect(normalizeTechmapItem(techmapItem({}, { description: undefined }), "now", TECHMAP_POLICY)).toBeNull();
    expect(normalizeTechmapItem(null, "now", TECHMAP_POLICY)).toBeNull();
    expect(normalizeTechmapItem("not an object", "now", TECHMAP_POLICY)).toBeNull();
  });

  it("falls back to the top-level field when the jsonLD equivalent is absent (e.g. sourceUrl)", () => {
    // jsonLD.url is unset here; the top-level `url` techmapItem() always sets must be used instead.
    const record = normalizeTechmapItem(techmapItem({}, { url: undefined }), "2026-08-04T00:00:00Z", TECHMAP_POLICY);
    expect(record).not.toBeNull();
    expect(record!.sourceUrl).toBe("https://jobdatafeeds.com/jobs/senior-project-manager-bnp-paribas");
  });

  it("accepts identifier/hiringOrganization/jobLocation given as bare strings, and skills as a plain string array", () => {
    const record = normalizeTechmapItem(
      techmapItem(
        {},
        {
          identifier: "bare-id-1",
          hiringOrganization: "Acme Corp",
          jobLocation: "Singapore",
          skills: ["Jira"],
        },
      ),
      "2026-08-04T00:00:00Z",
      TECHMAP_POLICY,
    );
    expect(record!.providerPostingId).toBe("bare-id-1");
    expect(record!.company).toBe("Acme Corp");
    expect(record!.location).toBe("Singapore");
    expect(record!.skills).toEqual(["Jira"]);
  });

  // #133 item 1 (owner decision): jsonLD.applicantLocationRequirements is NEVER read, even when
  // present — the live feed populates it with a bare timezone string ("HKT Timezone"), not
  // eligibility data, and mapping it anywhere would be exactly the "permissive union must never
  // silently become a gating input" hazard postingRetrieval.ts warns against for this field.
  it("never reads jsonLD.applicantLocationRequirements, even when the provider sends it", () => {
    const record = normalizeTechmapItem(
      techmapItem({}, { applicantLocationRequirements: "HKT Timezone" }),
      "2026-08-04T00:00:00Z",
      TECHMAP_POLICY,
    );
    expect(record).not.toBeNull();
    expect(record).not.toHaveProperty("applicantLocationRequirements");
  });
});

// #133 item 3: jsonLD.validThrough/datePosted arrive in two different date shapes MIXED WITHIN THE
// SAME PAGE, measured live on staging 2026-08-04 (10 postings, HK `project manager` query):
// ISO ("2026-09-02", 5/10) and Techmap's own dash form ("16-09-2026", 2/10). Stored verbatim, the
// dash form sorts lexicographically BEFORE any ISO string, so dedupePostings' earliest/latest
// (postings.ts) — which assume every expiresAt is already ISO 8601 — would read a live Sept-2026
// posting as having expired in "the year 16" and silently drop it (#86's named worst failure).
describe("canonicalizeTechmapDate (#133 item 3)", () => {
  it("the two LIVE-MEASURED formats (staging, 2026-08-04): DD-MM-YYYY and short ISO", () => {
    expect(canonicalizeTechmapDate("16-09-2026")).toBe("2026-09-16T00:00:00.000Z");
    expect(canonicalizeTechmapDate("2026-09-02")).toBe("2026-09-02T00:00:00.000Z");
  });

  it("a full ISO 8601 timestamp is accepted and normalized to the uniform millisecond shape", () => {
    expect(canonicalizeTechmapDate("2026-09-01T00:00:00Z")).toBe("2026-09-01T00:00:00.000Z");
    expect(canonicalizeTechmapDate("2026-09-01T10:15:30.5Z")).toBe("2026-09-01T10:15:30.500Z");
  });

  it("Techmap's dash form is read DD-MM-YYYY unconditionally, never guessed per-value", () => {
    // "05-09-2026" is genuinely ambiguous in isolation (5 Sep vs 9 May) — the point of the fixed
    // provider rule is that there is nothing to guess: it always reads day-first for Techmap.
    expect(canonicalizeTechmapDate("05-09-2026")).toBe("2026-09-05T00:00:00.000Z");
  });

  it("unparseable or impossible values emit null, never a guess and never the verbatim string", () => {
    expect(canonicalizeTechmapDate("not-a-date")).toBeNull();
    expect(canonicalizeTechmapDate("2026-13-45")).toBeNull(); // impossible month/day, not coerced
    expect(canonicalizeTechmapDate("32-13-2026")).toBeNull(); // impossible day/month in dash form
    expect(canonicalizeTechmapDate("30-02-2026")).toBeNull(); // Feb never has 30 days
    expect(canonicalizeTechmapDate("")).toBeNull();
    expect(canonicalizeTechmapDate(undefined)).toBeNull();
    expect(canonicalizeTechmapDate(null)).toBeNull();
    expect(canonicalizeTechmapDate(12345)).toBeNull(); // not a string at all
  });

  it("null propagates from normalizeTechmapItem — never the verbatim unparseable string", () => {
    const record = normalizeTechmapItem(
      techmapItem({}, { validThrough: "not-a-date", datePosted: "also-not-a-date" }),
      "2026-08-04T00:00:00Z",
      TECHMAP_POLICY,
    );
    expect(record!.expiresAt).toBeNull();
    expect(record!.postedAt).toBeNull();
  });

  // The ordering bug itself, through the REAL seam (normalizeTechmapItem -> dedupePostings), not a
  // private helper: two Techmap items for the SAME job, one using each measured date format, merged
  // into one canonical posting. Before this fix, dedupePostings' earliest() compared the raw
  // strings and would have picked "16-09-2026" as "earliest" (wrong — it sorts first lexically but
  // means 16 Sept, the LATER of the two dates). After canonicalization, earliest() correctly picks
  // the chronologically earlier 2 Sept expiry — proving neither posting is treated as expired on
  // formatting grounds and the merge picks the right date, not the lexically-smallest raw string.
  it("dedupePostings picks the chronologically correct earliest expiresAt across mixed source formats", () => {
    const dashFormItem = techmapItem(
      { url: "https://x/dash" },
      { identifier: "tm-dash", validThrough: "16-09-2026" }, // -> 2026-09-16 (the LATER date)
    );
    const isoFormItem = techmapItem(
      { url: "https://x/iso" },
      { identifier: "tm-iso", validThrough: "2026-09-02" }, // -> 2026-09-02 (the EARLIER date)
    );
    const dashRecord = normalizeTechmapItem(dashFormItem, "2026-08-04T00:00:00Z", TECHMAP_POLICY)!;
    const isoRecord = normalizeTechmapItem(isoFormItem, "2026-08-04T00:00:00Z", TECHMAP_POLICY)!;
    expect(dashRecord.expiresAt).toBe("2026-09-16T00:00:00.000Z");
    expect(isoRecord.expiresAt).toBe("2026-09-02T00:00:00.000Z");

    const [posting] = dedupePostings([dashRecord, isoRecord], [
      {
        schemaVersion: "3",
        providerId: "techmap",
        regionsServed: ["HK"],
        authorityRank: 1,
        permitsStorage: true,
        permitsMatching: true,
        attributionRequired: false,
        attributionTemplate: null,
        rateLimit: { perSecond: null, perMinute: null, perDay: null, perMonth: null },
        retry: { maxAttempts: 1, backoffMs: 0 },
        timeoutMs: 5000,
        costModel: { kind: "perThousandPostings", amountUsd: 1 },
        freshnessTtlHours: 24,
        livenessCheckable: true,
      },
    ]);
    // Correct: 2 Sept is chronologically earlier than 16 Sept. A lexicographic compare of the RAW
    // strings ("16-09-2026" vs "2026-09-02") would have picked "16-09-2026" instead — this assertion
    // is exactly the case that would fail without the fix.
    expect(posting!.expiresAt).toBe("2026-09-02T00:00:00.000Z");
  });
});

describe("MinIntervalGate (#100, §2.9)", () => {
  it("never waits when minIntervalMs <= 0 (no per-second cap)", async () => {
    const sleep = vi.fn(async () => {});
    const gate = new MinIntervalGate(0, () => 0, sleep);
    await gate.wait();
    await gate.wait();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("paces successive calls at least minIntervalMs apart, proven with a fake clock — no real delay", async () => {
    const clock = { t: 0 };
    const sleep = vi.fn(async (ms: number) => {
      clock.t += ms;
    });
    const gate = new MinIntervalGate(2500, () => clock.t, sleep);

    await gate.wait(); // first call: gate starts free, no wait
    expect(sleep).not.toHaveBeenCalled();

    await gate.wait(); // second call: must wait out the full interval
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenNthCalledWith(1, 2500);

    await gate.wait(); // third call: same again
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(clock.t).toBe(5000); // two full intervals elapsed across three calls
  });
});

describe("FixedWindowBudget (#100 review MF2, §2.9)", () => {
  it("null limit means uncapped — always allows", () => {
    const budget = new FixedWindowBudget(null, 60_000, () => 0);
    for (let i = 0; i < 100; i++) expect(budget.allow()).toBe(true);
  });

  it("allows up to the limit within one window, then refuses", () => {
    const budget = new FixedWindowBudget(3, 60_000, () => 0);
    expect(budget.allow()).toBe(true);
    expect(budget.allow()).toBe(true);
    expect(budget.allow()).toBe(true);
    expect(budget.allow()).toBe(false); // 4th call, same window
  });

  it("resets once the window elapses, proven with a fake clock — no real delay", () => {
    const clock = { t: 0 };
    const budget = new FixedWindowBudget(2, 60_000, () => clock.t);
    expect(budget.allow()).toBe(true);
    expect(budget.allow()).toBe(true);
    expect(budget.allow()).toBe(false);
    clock.t = 60_000; // exactly one window later
    expect(budget.allow()).toBe(true); // fresh window, budget restored
  });

  it("release restores a reserved unit when no HTTP attempt follows", () => {
    const budget = new FixedWindowBudget(1, 60_000, () => 0);
    const reservation = budget.reserve();
    expect(reservation).not.toBeNull();
    expect(budget.allow()).toBe(false);
    reservation!.release();
    expect(budget.allow()).toBe(true);
  });

  it("releasing an expired reservation never removes a newer window's unit", () => {
    const clock = { t: 0 };
    const budget = new FixedWindowBudget(1, 60_000, () => clock.t);
    const oldReservation = budget.reserve();
    clock.t = 60_000;
    expect(budget.reserve()).not.toBeNull();
    oldReservation!.release();
    expect(budget.allow()).toBe(false);
  });
});

describe("TechmapPostingProvider.fetch (#100, §2.9, §2.10)", () => {
  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }

  const noPacing: PostingProviderPolicyV1 = {
    ...TECHMAP_POLICY,
    rateLimit: { ...TECHMAP_POLICY.rateLimit, perSecond: null, perMonth: null },
  };

  it("requests the lowercase path with countryCode/page/size/title and the API key in x-rapidapi-key, never in the URL", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return jsonResponse(200, { result: [] });
    });
    const provider = new TechmapPostingProvider({ apiKey: "secret-key-123", policy: noPacing, fetchImpl });

    await provider.fetch({ regionCode: "HK", queryKeywords: ["project manager"], page: 0 });

    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls;
    expect(url).toContain("/api/v2/jobs/search");
    expect(url).not.toContain("/Jobs/Search"); // §6: the path is lowercase
    expect(url).toContain("countryCode=hk");
    expect(url).toContain("page=0");
    expect(url).toContain(`size=${TECHMAP_PAGE_SIZE}`);
    // #240 AC1: the phrase travels QUOTED — unquoted, the vendor matches ANY of its words.
    expect(url).toContain("title=%22project+manager%22");
    expect(url).not.toContain("secret-key-123"); // the key never travels in the URL
    const headers = init.headers as Record<string, string>;
    expect(headers["x-rapidapi-key"]).toBe("secret-key-123");
    expect(headers["x-rapidapi-host"]).toBe("daily-international-job-postings.p.rapidapi.com");
  });

  // #240: several quoted phrases OR together inside ONE `title` value — measured live 2026-08-14
  // (`"project manager" "business analyst"` = 31 adverts = 22 + 10, one overlap) — so a family's
  // whole market word list still costs exactly one call. An embedded quote cannot end a phrase early.
  it("sends every job title as its own quoted phrase in a single call", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL) => {
      calls.push(String(url));
      return jsonResponse(200, { result: [] });
    });
    const provider = new TechmapPostingProvider({ apiKey: "k", policy: noPacing, fetchImpl });

    await provider.fetch({
      regionCode: "HK",
      queryKeywords: ["delivery lead", "C&B Project Manager", 'sen"ior pm'],
    });

    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!).searchParams.get("title")).toBe(
      // Punctuation inside a title survives — "C&B Project Manager" is a real Hong Kong result from
      // the probe. An embedded quote is deleted, not turned into a space: "senior pm" is what was
      // meant, and "sen ior pm" would match nothing.
      '"delivery lead" "C&B Project Manager" "senior pm"',
    );
  });

  // #133 item 4: `size` is a fixed vendor constant (measured live on staging 2026-08-04: size=1,
  // size=20, and size=50 ALL returned pageSize=10) — pinned here so a future change can't quietly
  // reintroduce a made-up page size. `PostingProviderFetchInput` has no `size` field at all (a
  // caller cannot even ask for a different one); only `page` varies the request.
  it("MF-page-size: TECHMAP_PAGE_SIZE is the measured, fixed value (10), and every request sends exactly that", async () => {
    expect(TECHMAP_PAGE_SIZE).toBe(10);

    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL) => {
      urls.push(String(url));
      return jsonResponse(200, { result: [] });
    });
    const provider = new TechmapPostingProvider({ apiKey: "k", policy: noPacing, fetchImpl });

    await provider.fetch({ regionCode: "HK", queryKeywords: [] });
    await provider.fetch({ regionCode: "HK", queryKeywords: [], page: 1 });
    await provider.fetch({ regionCode: "SG", queryKeywords: ["project manager"] });

    for (const url of urls) expect(url).toContain("size=10");
  });

  it("returns ok:true with normalized records on a well-formed 200", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { result: [techmapItem()] }));
    const provider = new TechmapPostingProvider({ apiKey: "k", policy: noPacing, fetchImpl });
    const result = await provider.fetch({ regionCode: "HK", queryKeywords: ["project manager"] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.records).toHaveLength(1);
      expect(result.records[0]!.providerPostingId).toBe("tm-778812");
    }
  });

  it("a genuine zero-result 200 is ok:true with an empty array — distinguishable from a failure", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { result: [] }));
    const provider = new TechmapPostingProvider({ apiKey: "k", policy: noPacing, fetchImpl });
    const result = await provider.fetch({ regionCode: "TH", queryKeywords: ["project manager"] });
    expect(result).toEqual({ ok: true, records: [] });
  });

  it("a 429 is retryable and retried up to policy.retry.maxAttempts, never surfacing as an empty result", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(429, { message: "Too Many Requests" }));
    const provider = new TechmapPostingProvider({
      apiKey: "k",
      policy: { ...noPacing, retry: { maxAttempts: 2, backoffMs: 0 } },
      fetchImpl,
    });
    const result = await provider.fetch({ regionCode: "HK", queryKeywords: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(true);
      expect(result.reason).toMatch(/429/);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2); // maxAttempts, not more
    expect(readCounters()["postings.techmap_calls_made"]).toBe(2);
    expect(readCounters()["postings.techmap_calls_failed"]).toBe(2);
  });

  it("a 401 is NOT retried — auth failures don't get a second attempt", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, { message: "Invalid API key" }));
    const provider = new TechmapPostingProvider({
      apiKey: "k",
      policy: { ...noPacing, retry: { maxAttempts: 2, backoffMs: 0 } },
      fetchImpl,
    });
    const result = await provider.fetch({ regionCode: "HK", queryKeywords: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.retryable).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a thrown network error is treated as retryable and never echoes request config (no API key) into the reason", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND daily-international-job-postings.p.rapidapi.com");
    });
    const provider = new TechmapPostingProvider({
      apiKey: "super-secret-value",
      policy: { ...noPacing, retry: { maxAttempts: 1, backoffMs: 0 } },
      fetchImpl,
    });
    const result = await provider.fetch({ regionCode: "HK", queryKeywords: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(true);
      expect(result.reason).not.toContain("super-secret-value");
    }
  });

  it("cost is computed from records actually returned via the policy's own costModel, and recorded", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { result: [techmapItem(), techmapItem({ url: "https://x/2" }, { identifier: "tm-2" })] }));
    const provider = new TechmapPostingProvider({ apiKey: "k", policy: noPacing, fetchImpl });
    await provider.fetch({ regionCode: "HK", queryKeywords: [] });
    expect(readCounters()["postings.techmap_records_fetched"]).toBe(2);
    expect(readCounters()["postings.techmap_cost_usd_total"]).toBeCloseTo((2 / 1000) * 1, 10);
  });

  it("paces attempts through the rate gate using the injected clock/sleep, not a real delay", async () => {
    const clock = { t: 0 };
    const sleep = vi.fn(async (ms: number) => {
      clock.t += ms;
    });
    const fetchImpl = vi.fn(async () => jsonResponse(200, { result: [] }));
    const provider = new TechmapPostingProvider({
      apiKey: "k",
      policy: { ...TECHMAP_POLICY, rateLimit: { ...TECHMAP_POLICY.rateLimit, perSecond: 0.4, perMonth: null } }, // 1 call/2500ms
      fetchImpl,
      now: () => clock.t,
      sleep,
    });
    await provider.fetch({ regionCode: "HK", queryKeywords: [] });
    await provider.fetch({ regionCode: "HK", queryKeywords: [] });
    expect(sleep).toHaveBeenCalledWith(2500); // the second call waited out the full budget
  });

  // #100 review MF1 (QA D1 fix): a 200 where every item ON THIS PAGE fails to normalize must never
  // surface as a genuine empty result. Gated on the PAGE-LOCAL items.length, never on the envelope's
  // totalCount (the whole query's total, not this page's) — an earlier version gated on totalCount
  // and was wrong both ways: false-failed a genuinely empty PAGE of a non-empty query, and left the
  // real hole open whenever totalCount was absent/0/non-numeric. Every case below is deliberately
  // indifferent to what totalCount says.
  describe("MF1: page-local normalization failure vs. a genuine empty result (D1)", () => {
    it("items present, all drop, totalCount ABSENT — still provider_unavailable, not empty", async () => {
      const fetchImpl = vi.fn(async () => jsonResponse(200, { result: [{ title: "x" }, { title: "y" }] }));
      const provider = new TechmapPostingProvider({ apiKey: "k", policy: noPacing, fetchImpl });
      const result = await provider.fetch({ regionCode: "HK", queryKeywords: ["project manager"] });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/normalized 0 of 2 items/);
        expect(result.retryable).toBe(false); // a shape drift isn't fixed by retrying
      }
      expect(readCounters()["postings.techmap_normalize_dropped"]).toBe(2);
    });

    it("items present, all drop, totalCount 0 — still provider_unavailable (the field lied or is stale)", async () => {
      const fetchImpl = vi.fn(async () => jsonResponse(200, { result: [{ title: "x" }], totalCount: 0 }));
      const provider = new TechmapPostingProvider({ apiKey: "k", policy: noPacing, fetchImpl });
      const result = await provider.fetch({ regionCode: "HK", queryKeywords: [] });
      expect(result.ok).toBe(false);
    });

    it("items present, all drop, totalCount a STRING ('2') — still provider_unavailable, not silently treated as null", async () => {
      const fetchImpl = vi.fn(async () => jsonResponse(200, { result: [{ title: "x" }, { title: "y" }], totalCount: "2" }));
      const provider = new TechmapPostingProvider({ apiKey: "k", policy: noPacing, fetchImpl });
      const result = await provider.fetch({ regionCode: "HK", queryKeywords: [] });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("totalCount=unknown"); // non-numeric -> not trusted, but still caught
    });

    it("EMPTY PAGE (zero items) of a non-empty query (totalCount > 0) is a genuine empty result, not a failure", async () => {
      // The exact case an earlier totalCount-gated version got wrong: page 1 of a 15-result,
      // size-20 search legitimately returns zero items on THIS page while totalCount is real.
      const fetchImpl = vi.fn(async () => jsonResponse(200, { result: [], totalCount: 15 }));
      const provider = new TechmapPostingProvider({ apiKey: "k", policy: noPacing, fetchImpl });
      expect(await provider.fetch({ regionCode: "HK", queryKeywords: [] })).toEqual({ ok: true, records: [] });
    });

    it("empty page with totalCount 0/absent is also a genuine empty result", async () => {
      const zeroTotal = vi.fn(async () => jsonResponse(200, { result: [], totalCount: 0 }));
      const providerZero = new TechmapPostingProvider({ apiKey: "k", policy: noPacing, fetchImpl: zeroTotal });
      expect(await providerZero.fetch({ regionCode: "TH", queryKeywords: [] })).toEqual({ ok: true, records: [] });

      const noTotalField = vi.fn(async () => jsonResponse(200, { result: [] }));
      const providerNoTotal = new TechmapPostingProvider({ apiKey: "k", policy: noPacing, fetchImpl: noTotalField });
      expect(await providerNoTotal.fetch({ regionCode: "TH", queryKeywords: [] })).toEqual({ ok: true, records: [] });
    });

    it("a PARTIAL drift (9 of 10 items normalize) still succeeds with the 9, and counts exactly 1 drop", async () => {
      const items = Array.from({ length: 10 }, (_, i) =>
        i === 9 ? { title: "broken, no jsonLD" } : techmapItem({ url: `https://x/${i}` }, { identifier: `tm-${i}` }),
      );
      const fetchImpl = vi.fn(async () => jsonResponse(200, { result: items, totalCount: 10 }));
      const provider = new TechmapPostingProvider({ apiKey: "k", policy: noPacing, fetchImpl });
      const result = await provider.fetch({ regionCode: "HK", queryKeywords: [] });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.records).toHaveLength(9);
      expect(readCounters()["postings.techmap_normalize_dropped"]).toBe(1);
    });
  });

  // #100 review MF2: perMinute/perDay are enforced in-process, failing closed rather than waited out.
  describe("MF2: perMinute/perDay budgets fail closed, never wait", () => {
    it("exceeding perMinute refuses the call BEFORE any HTTP request, without waiting", async () => {
      const fetchImpl = vi.fn(async () => jsonResponse(200, { result: [] }));
      const policy: PostingProviderPolicyV1 = {
        ...noPacing,
        rateLimit: { ...noPacing.rateLimit, perMinute: 1 },
        retry: { maxAttempts: 1, backoffMs: 0 },
      };
      const provider = new TechmapPostingProvider({ apiKey: "k", policy, fetchImpl });
      const first = await provider.fetch({ regionCode: "HK", queryKeywords: [] });
      expect(first.ok).toBe(true);

      const second = await provider.fetch({ regionCode: "HK", queryKeywords: [] });
      expect(second.ok).toBe(false);
      if (!second.ok) expect(second.retryable).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(1); // the second call never reached the network
      expect(readCounters()["postings.techmap_calls_made"]).toBe(1); // budget-blocked ≠ a call made
      expect(readCounters()["postings.techmap_budget_exceeded"]).toBe(1);
    });

    it("exceeding perDay refuses the call the same way perMinute does", async () => {
      const fetchImpl = vi.fn(async () => jsonResponse(200, { result: [] }));
      const policy: PostingProviderPolicyV1 = {
        ...noPacing,
        rateLimit: { ...noPacing.rateLimit, perDay: 1 },
        retry: { maxAttempts: 1, backoffMs: 0 },
      };
      const provider = new TechmapPostingProvider({ apiKey: "k", policy, fetchImpl });
      await provider.fetch({ regionCode: "HK", queryKeywords: [] });
      const second = await provider.fetch({ regionCode: "HK", queryKeywords: [] });
      expect(second.ok).toBe(false);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
  });

  describe("#132 durable per-month budget", () => {
    it("refuses an exhausted month before HTTP and returns the existing unavailable shape", async () => {
      const store = new InMemoryPostingStore();
      await store.init();
      const fetchImpl = vi.fn(async () => jsonResponse(200, { result: [] }));
      const policy: PostingProviderPolicyV1 = {
        ...noPacing,
        rateLimit: { ...noPacing.rateLimit, perMonth: 1 },
        retry: { maxAttempts: 1, backoffMs: 0 },
      };
      const provider = new TechmapPostingProvider({
        apiKey: "k",
        policy,
        fetchImpl,
        monthlyBudgetStore: {
          durable: true,
          reserveMonthlyCall: store.reserveMonthlyCall.bind(store),
        },
        now: () => Date.UTC(2026, 7, 9),
      });

      expect((await provider.fetch({ regionCode: "HK", queryKeywords: [] })).ok).toBe(true);
      const exhausted = await provider.fetch({ regionCode: "HK", queryKeywords: [] });

      expect(exhausted).toEqual({
        ok: false,
        reason: "techmap: internal per-month call budget exceeded for 2026-08",
        retryable: true,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(readCounters()["postings.techmap_budget_exceeded"]).toBe(1);
      expect(readCounters()["postings.techmap_budget_store_unavailable"]).toBe(0);
    });

    it("fails closed before HTTP and signals store failure separately from exhaustion", async () => {
      const fetchImpl = vi.fn(async () => jsonResponse(200, { result: [] }));
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const provider = new TechmapPostingProvider({
        apiKey: "k",
        policy: {
          ...noPacing,
          rateLimit: { ...noPacing.rateLimit, perMonth: 1 },
          retry: { maxAttempts: 1, backoffMs: 0 },
        },
        fetchImpl,
        monthlyBudgetStore: {
          durable: true,
          reserveMonthlyCall: async () => {
            throw new Error("database offline");
          },
        },
        now: () => Date.UTC(2026, 7, 9),
      });

      const result = await provider.fetch({ regionCode: "HK", queryKeywords: [] });

      expect(result).toEqual({
        ok: false,
        reason: "techmap: monthly call budget store unavailable",
        retryable: true,
      });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(readCounters()["postings.techmap_budget_exceeded"]).toBe(0);
      expect(readCounters()["postings.techmap_budget_store_unavailable"]).toBe(1);
      expect(log).toHaveBeenCalledWith("[ops] techmap monthly call budget store unavailable; request blocked");
      log.mockRestore();
    });

    it("refuses a non-durable monthly store before HTTP", async () => {
      const fetchImpl = vi.fn(async () => jsonResponse(200, { result: [] }));
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const provider = new TechmapPostingProvider({
        apiKey: "k",
        policy: {
          ...noPacing,
          rateLimit: { ...noPacing.rateLimit, perMonth: 1 },
          retry: { maxAttempts: 1, backoffMs: 0 },
        },
        fetchImpl,
        monthlyBudgetStore: new InMemoryPostingStore(),
      });

      const result = await provider.fetch({ regionCode: "HK", queryKeywords: [] });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("techmap: monthly call budget store unavailable");
      expect(fetchImpl).not.toHaveBeenCalled();
      log.mockRestore();
    });

    it("repeated store failures release short-window units so recovery still reaches HTTP", async () => {
      let storeAvailable = false;
      const fetchImpl = vi.fn(async () => jsonResponse(200, { result: [] }));
      const provider = new TechmapPostingProvider({
        apiKey: "k",
        policy: {
          ...noPacing,
          rateLimit: { ...noPacing.rateLimit, perMinute: 1, perDay: 1, perMonth: 10 },
          retry: { maxAttempts: 1, backoffMs: 0 },
        },
        fetchImpl,
        monthlyBudgetStore: {
          durable: true,
          reserveMonthlyCall: async () => {
            if (!storeAvailable) throw new Error("database offline");
            return true;
          },
        },
      });
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

      for (let i = 0; i < 3; i++) {
        const failed = await provider.fetch({ regionCode: "HK", queryKeywords: [] });
        expect(failed.ok).toBe(false);
        if (!failed.ok) expect(failed.reason).toBe("techmap: monthly call budget store unavailable");
      }
      storeAvailable = true;
      expect((await provider.fetch({ regionCode: "HK", queryKeywords: [] })).ok).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(readCounters()["postings.techmap_budget_store_unavailable"]).toBe(3);
      expect(readCounters()["postings.techmap_budget_exceeded"]).toBe(0);
      log.mockRestore();
    });
  });

  // #100 review MF4: the gate/budgets are shared PROCESS-WIDE per providerId, proven across TWO
  // separate instances — otherwise two concurrent retrievals would each get their own tracker and
  // burst through the vendor's cap together.
  it("MF4: pacing is shared across two separate provider instances for the same providerId", async () => {
    const clock = { t: 0 };
    const sleep = vi.fn(async (ms: number) => {
      clock.t += ms;
    });
    const paced: PostingProviderPolicyV1 = {
      ...TECHMAP_POLICY,
      rateLimit: { ...TECHMAP_POLICY.rateLimit, perSecond: 0.4, perMonth: null },
    };
    const fetchImpl = vi.fn(async () => jsonResponse(200, { result: [] }));

    const first = new TechmapPostingProvider({ apiKey: "k", policy: paced, fetchImpl, now: () => clock.t, sleep });
    await first.fetch({ regionCode: "HK", queryKeywords: [] });
    expect(sleep).not.toHaveBeenCalled(); // first instance's first call: gate starts free

    // A BRAND NEW instance — if pacing were per-instance, this would also start "free" and fire
    // immediately, exactly the burst the AC forbids.
    const second = new TechmapPostingProvider({ apiKey: "k", policy: paced, fetchImpl, now: () => clock.t, sleep });
    await second.fetch({ regionCode: "HK", queryKeywords: [] });
    expect(sleep).toHaveBeenCalledWith(2500); // the SHARED gate makes it wait anyway
  });
});

describe("techmapProviderFromEnv (#100 review MF5)", () => {
  const previousKey = process.env.TECHMAP_RAPIDAPI_KEY;
  const monthlyBudgetStore = new InMemoryPostingStore();
  const durableMonthlyBudgetStore = {
    durable: true,
    reserveMonthlyCall: monthlyBudgetStore.reserveMonthlyCall.bind(monthlyBudgetStore),
  };
  afterEach(() => {
    if (previousKey === undefined) delete process.env.TECHMAP_RAPIDAPI_KEY;
    else process.env.TECHMAP_RAPIDAPI_KEY = previousKey;
  });

  it("fails closed — returns null — for a policy row whose providerId isn't techmap, even with a key set", () => {
    process.env.TECHMAP_RAPIDAPI_KEY = "some-key";
    const curatedPoolRow: PostingProviderPolicyV1 = { ...TECHMAP_POLICY, providerId: "curated-pool" };
    expect(techmapProviderFromEnv(curatedPoolRow, durableMonthlyBudgetStore)).toBeNull();
  });

  it("returns null without TECHMAP_RAPIDAPI_KEY set, even for the real techmap row", () => {
    delete process.env.TECHMAP_RAPIDAPI_KEY;
    expect(techmapProviderFromEnv(TECHMAP_POLICY, durableMonthlyBudgetStore)).toBeNull();
  });

  it("constructs a real provider for the techmap row when the key is set", () => {
    process.env.TECHMAP_RAPIDAPI_KEY = "some-key";
    const provider = techmapProviderFromEnv(TECHMAP_POLICY, durableMonthlyBudgetStore);
    expect(provider).not.toBeNull();
    expect(provider?.providerId).toBe("techmap");
  });

  it("refuses to construct a paid live provider with an in-memory monthly budget", () => {
    process.env.TECHMAP_RAPIDAPI_KEY = "some-key";
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(techmapProviderFromEnv(TECHMAP_POLICY, monthlyBudgetStore)).toBeNull();
    expect(log).toHaveBeenCalledWith(
      "[ops] TECHMAP_RAPIDAPI_KEY is set without a durable monthly budget store; provider disabled",
    );
    log.mockRestore();
  });
});

describe("TestFixturePostingProvider (#100, §2.10)", () => {
  it("returns its canned result without any network call, structurally incapable of a live check", async () => {
    const provider = new TestFixturePostingProvider("fixture-provider-a", {
      ok: true,
      records: [],
    });
    expect(provider.providerId).toBe("fixture-provider-a");
    const result = await provider.fetch({ regionCode: "HK", queryKeywords: [] });
    expect(result).toEqual({ ok: true, records: [] });
  });

  // #100 review MF9: the structural guard, same shape as TestFixtureFamilyFloorStore's
  // canUnlockProductionDiscoveryReward.
  it("canReachLiveProvider() is always false — structurally incapable, not merely configured off", () => {
    const provider = new TestFixturePostingProvider("fixture-provider-a", { ok: true, records: [] });
    expect(provider.canReachLiveProvider()).toBe(false);
  });
});
