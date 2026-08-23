// #282 (spec #279, ADR-0014 decision 2 as amended) — WHAT THE EMPLOYER REALLY IS.
//
// #281 places a job from the employer name, the job title and the person's own CV lines. That is
// half the evidence, and it is the half a CV can give: "Acme Solutions Ltd" tells a model nothing,
// so many small employers come out honestly unplaced. This is the other half — one web lookup of the
// company itself, run through Anthropic's SERVER-SIDE web search on the key the product already
// holds. No new vendor, no new account, no search infrastructure of our own.
//
// Three properties this file exists to hold:
//
//   1. THE ANSWER IS SHARED. What "Nordea Bank" is does not change per visitor and is not personal
//      data, so it is cached durably and read by everyone: a company is paid for once, ever. The
//      cache key is a NORMALISED name, so "Acme Solutions Ltd." and "ACME Solutions Limited" are one
//      company and one payment.
//   2. A FAILURE IS NEVER CACHED. Only a real answer is stored. A network error, a timeout or an
//      empty response leaves the cache untouched, so the next run looks the employer up for real —
//      the same rule industryLabeler.ts follows for a degraded placement, and for the same reason:
//      one bad minute must never become permanent for every visitor who ever names that employer.
//   3. NOTHING ABOUT THE PERSON GOES OUT. The only input is the employer name. A cached row is read
//      by strangers, so it must not be able to contain anything else.
//
// The lookup answers "what is this employer"; the CV lines answer "what industry was the work in".
// They are two different questions and a disagreement between them is not a conflict — it is the
// two-industry case (a consultant at a consultancy who spent six years on bank engagements), and
// resolving it is industry-labeler.md's job, not this file's.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { getPool, iso } from "./db.js";
import { incrementCounter } from "./counters.js";
import { DEFAULT_MODEL } from "./llm.js";
import { computeCostUsd, type PricingTable } from "./llmPricing.js";
import type { UsageLedgerStore } from "./usageLedgerStore.js";

const PROMPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "prompts", "employer-lookup.md");

let cachedPrompt: string | null = null;
export function employerLookupPrompt(): string {
  if (!cachedPrompt) {
    cachedPrompt = readFileSync(PROMPT_PATH, "utf8").replace(/^<!--[\s\S]*?-->\s*/, "");
  }
  return cachedPrompt;
}

/** Legal forms, stripped from the END of a name so one company is one cache row and one payment.
 *  Deliberately legal forms ONLY: "Group", "Holdings" and "International" are part of what a company
 *  is called, and dropping them would collide two genuinely different businesses into one shared
 *  answer — the one failure mode of this cache that does not heal itself. */
const LEGAL_FORMS = new Set([
  "ltd", "limited", "llc", "llp", "lp", "inc", "incorporated", "corp", "corporation", "co",
  "company", "plc", "gmbh", "mbh", "ag", "kg", "sa", "sas", "sarl", "sl", "srl", "spa", "bv", "nv",
  "ab", "as", "asa", "aps", "oy", "oyj", "pty", "pte", "sdn", "bhd", "kk", "pt", "doo", "zoo",
]);

/**
 * The cache key: what two spellings of the same company have in common. Lower-cased, accents folded,
 * punctuation dropped, trailing legal forms removed, whitespace collapsed.
 *
 * Applied by BOTH drivers rather than by whichever one happens to be configured, so the key is a
 * property of the seam (the rule unmappedLabels.ts's `normalise` already follows).
 */
export function normaliseEmployerKey(employer: string): string {
  const words = employer
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // the combining marks NFKD just split off
    .toLowerCase()
    // Dots and apostrophes CLOSE UP rather than becoming a gap, so "S.A." reads as the legal form
    // it is instead of as two one-letter words the strip below cannot recognise.
    .replace(/[.'’]/g, "")
    // Same for a slash BETWEEN TWO SINGLE LETTERS, and only there: "A/S" is the Danish legal form
    // and has to fold into "as", while a slash anywhere else is a genuine word break. Found by the
    // real-API run — "Nordea Bank" and "Nordea Bank A/S" were being paid for twice.
    .replace(/\b([a-z])\/([a-z])\b/g, "$1$2")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  // Repeatedly, because a name can carry two ("Acme Solutions Pty Ltd"). Never down to empty: a
  // company genuinely called "Co" must keep a key, or every such name would share one cache row.
  while (words.length > 1 && LEGAL_FORMS.has(words[words.length - 1]!)) words.pop();
  return words.join(" ");
}

export interface EmployerLookupRecord {
  /** normaliseEmployerKey's output — the shared identity of the company. */
  key: string;
  /** The employer name that FIRST caused the lookup, kept for humans reading the table back. */
  employer: string;
  /** What the web said, in plain words. Never empty: a lookup with no answer is not stored. */
  summary: string;
  lookedUpAt: string; // ISO timestamp
}

export interface EmployerLookupStore {
  init(): Promise<void>;
  get(key: string): Promise<EmployerLookupRecord | null>;
  put(record: Omit<EmployerLookupRecord, "lookedUpAt">): Promise<void>;
}

/** Bound on what one cached row can hold. The prompt asks for four short sentences; this is the
 *  guard against a model that ignores it, since the text is read back into every later labeling call
 *  for that employer, for as long as the row lives. */
export const SUMMARY_LIMIT = 1200;

export class InMemoryEmployerLookupStore implements EmployerLookupStore {
  private readonly rows = new Map<string, EmployerLookupRecord>();
  async init() {}
  async get(key: string) {
    const row = this.rows.get(key);
    return row ? { ...row } : null;
  }
  async put(record: Omit<EmployerLookupRecord, "lookedUpAt">) {
    this.rows.set(record.key, {
      ...record,
      summary: record.summary.slice(0, SUMMARY_LIMIT),
      lookedUpAt: new Date().toISOString(),
    });
  }
}

const EMPLOYER_LOOKUPS_TABLE = `
  CREATE TABLE IF NOT EXISTS employer_lookups (
    key          text PRIMARY KEY,
    employer     text NOT NULL,
    summary      text NOT NULL,
    looked_up_at timestamptz NOT NULL
  )
`;

export class PgEmployerLookupStore implements EmployerLookupStore {
  constructor(private pool: Pool) {}

  async init() {
    await this.pool.query(EMPLOYER_LOOKUPS_TABLE);
  }

  async get(key: string) {
    const { rows } = await this.pool.query(
      `SELECT key, employer, summary, looked_up_at FROM employer_lookups WHERE key = $1`,
      [key],
    );
    if (!rows[0]) return null;
    return {
      key: rows[0].key as string,
      employer: rows[0].employer as string,
      summary: rows[0].summary as string,
      lookedUpAt: iso(rows[0].looked_up_at),
    };
  }

  async put(record: Omit<EmployerLookupRecord, "lookedUpAt">) {
    // Last writer wins on a race — two workers looking the same company up at once each hold a real
    // answer, and either is correct. What must NOT happen is the insert throwing, and a lookup that
    // actually succeeded being recorded as a failure.
    await this.pool.query(
      `INSERT INTO employer_lookups (key, employer, summary, looked_up_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (key) DO UPDATE SET employer = EXCLUDED.employer,
                                       summary = EXCLUDED.summary,
                                       looked_up_at = EXCLUDED.looked_up_at`,
      [record.key, record.employer, record.summary.slice(0, SUMMARY_LIMIT), new Date().toISOString()],
    );
  }
}

/** Postgres when DATABASE_URL is set, in-memory otherwise — same convention as every other store.
 *  Note what the in-memory driver means for this cache's promise: "paid for once, EVER" is a property
 *  of the Postgres row. Without a database the cache lives as long as the process, which is the
 *  dev/test ceiling, not production's. */
export function employerLookupStoreFromEnv(databaseUrl?: string): EmployerLookupStore {
  return databaseUrl
    ? new PgEmployerLookupStore(getPool(databaseUrl))
    : new InMemoryEmployerLookupStore();
}

/** What one employer's web lookup gives the labeler: plain words, or null when there is nothing to
 *  add. Null is ALWAYS survivable — the job is still placed on the CV evidence alone. */
export type EmployerLookup = (employer: string) => Promise<string | null>;

/** Anthropic's server-side web search tool. The `_20260209` variant (dynamic filtering) is the latest
 *  the app's own DEFAULT_MODEL supports; the API provisions the code execution that needs on its own,
 *  so nothing else is declared here. */
const WEB_SEARCH_TOOL = { type: "web_search_20260209", name: "web_search", max_uses: 3 } as const;

/** Anthropic's published web-search price, read 2026-08-23: USD 10 per 1,000 searches. Held as
 *  configuration for the same reason llmPricing.ts's rates are — a re-price is an env var, never a
 *  code change. Token cost is priced separately, off the ordinary per-model table. */
export function webSearchUsdPerSearch(env: NodeJS.ProcessEnv = process.env): number {
  const override = Number(env.WEB_SEARCH_USD_PER_SEARCH);
  return Number.isFinite(override) && override >= 0 ? override : 0.01;
}

/** How long the WHOLE lookup may take — every round trip together, not each — before it is abandoned
 *  and the job falls back to CV evidence. Sized off the real-API run of 2026-08-23: a company the web knows answered in 17-20s,
 *  and a company it does not know ran until it was cut off. So this is a deadline on the SECOND
 *  case, not the first — three times the measured success, and a bound on how long an unfindable
 *  employer may hold up everyone else's job on the same pipeline run.
 *  A company the web genuinely has nothing on does NOT normally reach this deadline — the prompt
 *  gives it the words "No public information found for this company name.", which is a real answer
 *  and is cached like any other, so that employer costs one search ever, not one per run. This is
 *  the deadline for the case where the model keeps looking instead of saying that.
 *  ponytail: one flat deadline, no per-attempt budget. Add one only if the ops numbers show timeouts
 *  are common enough to matter. */
const LOOKUP_TIMEOUT_MS = 60_000;

/** How many times a paused turn is resumed. Server tools pause a long turn (`stop_reason:
 *  "pause_turn"`) and expect the assistant message handed straight back. Two resumes is generous for
 *  a three-search question; past that we take whatever text we have. */
const MAX_RESUMES = 2;

type ContentBlock = { type: string; text?: string };

export interface EmployerLookupDeps {
  apiKey: string;
  store: EmployerLookupStore;
  model?: string;
  /** #118's ledger, so this paid call is not a spending stage living outside it. Optional — a test
   *  or an eval that wires no ledger still looks employers up. */
  ledger?: UsageLedgerStore;
  pricing?: PricingTable;
  /** #6 review: the per-search price, read ONCE here rather than out of the ambient environment on
   *  every call — token pricing already travels as an injected table, and one rate arriving two
   *  different ways is how the two drift. */
  searchUsd?: number;
  /** The repo's own seam for an outbound HTTP caller (postingProvider.ts's `fetchImpl`), so a test
   *  injects a fake instead of stubbing the global. */
  fetchImpl?: typeof fetch;
}

/**
 * The lookup, cache in front. Returns the employer summary, or null when there is nothing to add.
 *
 * NEVER THROWS. Every failure — an unusable name, a 500, a timeout, an empty answer — is counted,
 * logged and turned into null, because the ticket's own line is that the upload never blocks: a job
 * with no lookup is still placed on the CV evidence alone.
 */
export function makeEmployerLookup(deps: EmployerLookupDeps): EmployerLookup {
  const model = deps.model ?? DEFAULT_MODEL;
  const searchUsd = deps.searchUsd ?? webSearchUsdPerSearch();
  return async (employer: string): Promise<string | null> => {
    const key = normaliseEmployerKey(employer);
    if (!key) return null; // no name to look up — not a failure, there is simply nothing to ask

    try {
      const cached = await deps.store.get(key);
      if (cached) {
        incrementCounter("employerLookup.cache_hit");
        return cached.summary;
      }
    } catch (err) {
      // A cache READ failure must not stop the lookup — it costs a search we could have saved, which
      // is the cheap half of the trade. It must not be silent either: this is the number that shows
      // a broken cache as a rising bill rather than as nothing at all.
      incrementCounter("employerLookup.cache_read_failed");
      console.error(
        `[ops] employer lookup cache read failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    let summary: string;
    try {
      summary = await search(employer, model, searchUsd, deps);
    } catch (err) {
      incrementCounter("employerLookup.failed");
      console.error(
        `[ops] employer lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
    if (!summary) {
      // The call worked and said nothing usable. Not stored, for the same reason a failure is not:
      // an empty row would answer for this company forever.
      incrementCounter("employerLookup.empty");
      return null;
    }

    incrementCounter("employerLookup.looked_up");
    const bounded = summary.slice(0, SUMMARY_LIMIT);
    try {
      await deps.store.put({ key, employer: employer.trim(), summary: bounded });
    } catch (err) {
      // The answer is already in hand and is returned regardless — losing the WRITE only means the
      // next visitor pays for this company again.
      incrementCounter("employerLookup.cache_write_failed");
      console.error(
        `[ops] employer lookup cache write failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return bounded;
  };
}

/** One web-search-backed call, resumed across `pause_turn`. Throws on any transport or API failure —
 *  makeEmployerLookup above is what turns that into null. */
async function search(
  employer: string,
  model: string,
  searchUsd: number,
  deps: EmployerLookupDeps,
): Promise<string> {
  // Function replacer: the employer name is a person's own CV free text, and a string replacer would
  // read a "$&" inside it as a pattern (the hazard industryLabeler.ts and adReader.ts also carry).
  const prompt = employerLookupPrompt().replace("{{EMPLOYER}}", () => employer.trim());
  const messages: Array<{ role: string; content: unknown }> = [{ role: "user", content: prompt }];
  // ONE deadline for the whole lookup, not one per round trip. A paused turn resumes into a fresh
  // request, so a per-request timeout would let a single unfindable employer hold the pipeline for
  // MAX_RESUMES times the deadline — and this loop runs once per job, in series, so five such
  // employers on one CV would be a quarter of an hour before anyone's work history showed an
  // industry. Review finding, #282.
  const deadline = Date.now() + LOOKUP_TIMEOUT_MS;
  const parts: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let searches = 0;

  try {
    for (let turn = 0; turn <= MAX_RESUMES; turn++) {
        const res = await (deps.fetchImpl ?? fetch)("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        headers: {
          "content-type": "application/json",
          "x-api-key": deps.apiKey,
          "anthropic-version": "2023-06-01",
        },
        // No `thinking` field, unlike AnthropicLlm: the tool actually has to be reached for, and a
        // thinking-disabled tool turn is how a model ends up DESCRIBING a search instead of running
        // one. max_tokens is sized for adaptive thinking plus four sentences.
        body: JSON.stringify({ model, max_tokens: 4000, tools: [WEB_SEARCH_TOOL], messages }),
      });
      if (!res.ok) throw new Error(`anthropic api ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const body = (await res.json()) as {
        content: ContentBlock[];
        stop_reason?: string;
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          server_tool_use?: { web_search_requests?: number };
        };
      };
      inputTokens += body.usage?.input_tokens ?? 0;
      outputTokens += body.usage?.output_tokens ?? 0;
      searches += body.usage?.server_tool_use?.web_search_requests ?? 0;
      // ACCUMULATED across turns, not overwritten. A resumed turn continues the answer rather than
      // restarting it, so reassigning here threw away everything the model said before it paused —
      // and a final turn that added nothing would then read as an empty lookup. Review finding, #282.
      parts.push(
        ...body.content.filter((block) => block.type === "text").map((block) => block.text ?? ""),
      );
      if (body.stop_reason !== "pause_turn") break;
      // A paused turn resumes by handing the assistant message straight back, UNCHANGED — the search
      // results inside it carry encrypted content the API decrypts to restore its own context.
      messages.push({ role: "assistant", content: body.content });
    }
  } finally {
    // In the `finally`, because a turn that failed on the SECOND round trip has already been billed
    // for the first: the money is spent whether or not we end up with an answer, so the ledger has
    // to hear about it either way. A FIRST round trip that is aborted records nothing — there is no
    // usage block to read, and the provider may still bill for searches it had already run. That is
    // llmMeter.ts's own accepted limit, carried here for the same reason: an estimate would look
    // like a measurement.
    if (searches || inputTokens || outputTokens) {
      recordSpend(deps, model, searchUsd, { inputTokens, outputTokens, searches });
    }
  }
  return parts.join("").trim();
}

/** Writes one ledger row for the lookup, priced as tokens PLUS the per-search charge — the token
 *  table alone would under-report a web-search call by what is usually the larger half of its cost.
 *
 *  Fire-and-forget, for llmMeter.ts's reason: a wedged store must never add latency to a paid call.
 *  A failed write is counted, not swallowed. */
function recordSpend(
  deps: EmployerLookupDeps,
  model: string,
  searchUsd: number,
  usage: { inputTokens: number; outputTokens: number; searches: number },
): void {
  incrementCounter("employerLookup.billed_calls");
  if (!deps.ledger) return;
  const tokenCost = deps.pricing
    ? computeCostUsd(model, usage.inputTokens, usage.outputTokens, deps.pricing)
    : null;
  const searchCost = usage.searches * searchUsd;
  void deps.ledger
    .record({
      // No visitor, deliberately: the answer is shared by everyone who ever names this employer, so
      // billing the whole company to whoever happened to arrive first would be a fiction that
      // costForVisitor is read as fact.
      visitorId: null,
      stage: "employer-lookup",
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      measured: true,
      costUsd: tokenCost === null ? searchCost : tokenCost + searchCost,
      at: new Date().toISOString(),
    })
    .catch((err) => {
      incrementCounter("usageLedger.write_failed");
      console.error(
        `[ops] employer lookup ledger write failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
}
