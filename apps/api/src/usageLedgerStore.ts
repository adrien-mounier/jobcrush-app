// #118 — the durable usage ledger: one row per completed model call, priced at write time, retained
// indefinitely (the owner's retention decision on issue #118 — see purge.ts's header for the
// content-vs-spend split that decision creates). Same driver-split shape as every other store in this
// repo (InMemory + Pg + …FromEnv), but the row payload is a hard privacy boundary rather than a cache:
// it carries ONLY a visitor id, stage, model, token counts, a measured flag, computed cost, and a
// timestamp — no prompt, no completion, no CV text, no advert text, no model-written prose. Proven by
// construction: the Pg table below has no column that could hold any of that, and the InMemory driver
// never spreads a caller's object wholesale (see its record() below).
//
// Read costForVisitor's own doc before pricing anything off it: adReader.ts's and judge.ts's caches
// mean this number is "what THIS visitor caused us to spend fresh", not "their fair share of what
// they consumed" — a second visitor who hits a warm cache for the same advert genuinely adds nothing
// to their own total for that stage, even though they benefited from the read just as much as the
// visitor who paid for it.
import type { Pool } from "pg";
import { getPool } from "./db.js";

/** Every spending stage in the pipeline, named once here so a call site can't invent a new one by
 *  typo. main.ts builds one metered client per value (llmMeter.ts's meterLlm) — the stage is fixed at
 *  construction, never decided per call. */
export type LlmStage =
  | "advert-reading"
  | "judging"
  | "claim-mining"
  | "job-block-mining"
  | "preview-tailor"
  | "grill"
  | "cv-audit"
  | "family-screen"
  // #220: placing a target role into a job family — its own stage, not folded into family-screen
  // (which is the research-candidate screening call, a different question at a different moment).
  | "family-placement"
  // #281: placing a dated job into an INDUSTRY — the second label axis. Its own stage, not folded
  // into family-placement: it runs against a different vocabulary on a different model, and #282
  // adds a paid employer web lookup to it that the family half will never make.
  | "industry-placement"
  // #282: the employer web lookup that feeds the industry placement. Its own stage because it is
  // priced differently from every other row here — Anthropic's per-search charge sits on top of the
  // tokens — and because it is the one stage whose spend is SHARED: a lookup is paid for once and
  // read by every visitor who ever names that employer, so its rows carry no visitor at all.
  | "employer-lookup"
  // #303: reading the title/company/location/closing date out of an advert somebody PASTED. Its own
  // stage, not folded into advert-reading: that is the requirements read every advert gets, this is
  // the split a provider's feed would have done for free, and #315's per-application cost has to be
  // able to tell the paste door's own spend from the deck's.
  | "pasted-advert-reading";

/** One completed model call. `visitorId` is a pseudonym (a session id) or null for an unattributed
 *  call — never dropped, never guessed. `inputTokens`/`outputTokens`/`costUsd` are null together
 *  exactly when `measured` is false (the driver behind this call had no completeWithUsage): real
 *  spend, honestly unknown, never estimated into a number that would look measured. */
export interface UsageLedgerEntry {
  visitorId: string | null;
  stage: LlmStage;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  measured: boolean;
  costUsd: number | null;
  at: string; // ISO timestamp
}

export interface UsageLedgerStore {
  init(): Promise<void>;
  /** Records one completed call. A failure here is the caller's (llmMeter.ts's) to handle — this
   *  store never silently drops what it's given. */
  record(entry: UsageLedgerEntry): Promise<void>;
  /** Total spend across every recorded entry, in dollars. An unmeasured entry (costUsd null)
   *  contributes 0 — its true cost is real but unknown, never estimated into the total. */
  totalCostUsd(): Promise<number>;
  /** Spend broken down by stage, in dollars — only stages with at least one entry appear. */
  costByStage(): Promise<Record<string, number>>;
  /** Spend attributed to one visitor, in dollars. FIRST-TOUCHER BILLED, not fair-share: adReader.ts's
   *  and judge.ts's caches (keyed by advert, or by (advert, fact-set), with in-flight dedup) mean the
   *  FIRST visitor to trigger a fresh read or judgement for a given advert is billed for that whole
   *  model call; every later visitor who hits the cache makes no model call and this total gains
   *  nothing for them, for that stage, even though they saw the same result. This is correct — the
   *  money really was spent by whoever triggered it — but it means this number answers "what did
   *  this visitor cause us to spend fresh", not "their share of what they consumed". Price the
   *  product off it with that reading, not the other one. */
  costForVisitor(visitorId: string): Promise<number>;
  /** #68's "start over" deletion: nulls the visitor id on every row currently attributed to
   *  `visitorId`, keeping the row — and its cost — intact. Totals before and after this call are
   *  identical; only the link to the person is gone. No HTTP route calls this yet — that surface is
   *  #68's scope, not this ticket's. */
  scrubVisitor(visitorId: string): Promise<void>;
}

/** The local-dev fallback when DATABASE_URL is unset — explicitly non-durable (wiped on restart,
 *  same as every other store's InMemory driver) and its `entries` array is unbounded for the life of
 *  the process. Both are accepted for a dev-only driver nothing production runs on; revisit only if
 *  that stops being true. */
export class InMemoryUsageLedgerStore implements UsageLedgerStore {
  private entries: UsageLedgerEntry[] = [];

  async init(): Promise<void> {}

  async record(entry: UsageLedgerEntry): Promise<void> {
    // Listed field-by-field, never `{...entry}` — the same "the shape IS the boundary" guarantee the
    // Pg driver gets for free from its column list, applied here so a caller that smuggles extra
    // data onto the object (a bug, never a legitimate use) can't make it durable in this driver either.
    this.entries.push({
      visitorId: entry.visitorId,
      stage: entry.stage,
      model: entry.model,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      measured: entry.measured,
      costUsd: entry.costUsd,
      at: entry.at,
    });
  }

  async totalCostUsd(): Promise<number> {
    return this.entries.reduce((sum, e) => sum + (e.costUsd ?? 0), 0);
  }

  async costByStage(): Promise<Record<string, number>> {
    const totals: Record<string, number> = {};
    for (const e of this.entries) totals[e.stage] = (totals[e.stage] ?? 0) + (e.costUsd ?? 0);
    return totals;
  }

  async costForVisitor(visitorId: string): Promise<number> {
    return this.entries
      .filter((e) => e.visitorId === visitorId)
      .reduce((sum, e) => sum + (e.costUsd ?? 0), 0);
  }

  async scrubVisitor(visitorId: string): Promise<void> {
    for (const e of this.entries) if (e.visitorId === visitorId) e.visitorId = null;
  }
}

const LLM_USAGE_LEDGER_TABLE = `
CREATE TABLE IF NOT EXISTS llm_usage_ledger (
  id            bigserial PRIMARY KEY,
  visitor_id    text,
  stage         text NOT NULL,
  model         text NOT NULL,
  input_tokens  integer,
  output_tokens integer,
  measured      boolean NOT NULL,
  cost_usd      double precision,
  created_at    timestamptz NOT NULL
)`;

export class PgUsageLedgerStore implements UsageLedgerStore {
  constructor(private pool: Pool) {}

  async init(): Promise<void> {
    await this.pool.query(LLM_USAGE_LEDGER_TABLE);
  }

  async record(entry: UsageLedgerEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO llm_usage_ledger
         (visitor_id, stage, model, input_tokens, output_tokens, measured, cost_usd, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        entry.visitorId,
        entry.stage,
        entry.model,
        entry.inputTokens,
        entry.outputTokens,
        entry.measured,
        entry.costUsd,
        entry.at,
      ],
    );
  }

  async totalCostUsd(): Promise<number> {
    const { rows } = await this.pool.query(`SELECT COALESCE(SUM(cost_usd), 0) AS total FROM llm_usage_ledger`);
    return Number(rows[0]?.total ?? 0);
  }

  async costByStage(): Promise<Record<string, number>> {
    const { rows } = await this.pool.query(
      `SELECT stage, COALESCE(SUM(cost_usd), 0) AS total FROM llm_usage_ledger GROUP BY stage`,
    );
    return Object.fromEntries(rows.map((r) => [r.stage as string, Number(r.total)]));
  }

  async costForVisitor(visitorId: string): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM llm_usage_ledger WHERE visitor_id = $1`,
      [visitorId],
    );
    return Number(rows[0]?.total ?? 0);
  }

  async scrubVisitor(visitorId: string): Promise<void> {
    await this.pool.query(`UPDATE llm_usage_ledger SET visitor_id = NULL WHERE visitor_id = $1`, [visitorId]);
  }
}

/** Postgres when DATABASE_URL is set, in-memory otherwise — same convention as every other store. */
export function usageLedgerStoreFromEnv(databaseUrl?: string): UsageLedgerStore {
  if (!databaseUrl) {
    // This ticket's own AC4 is "no cost figure may live only in process memory" — worth a boot-time
    // signal when that's exactly what's about to happen (a genuine local-dev choice, never desired in
    // a deployed environment).
    console.warn("[ops] DATABASE_URL is unset — the usage ledger is in-memory only and will not survive a restart");
    return new InMemoryUsageLedgerStore();
  }
  return new PgUsageLedgerStore(getPool(databaseUrl));
}
