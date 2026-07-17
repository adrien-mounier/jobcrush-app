// A persistent per-run store. Fly logs are ephemeral and the in-memory job store is wiped on
// restart, so this is the durable record of every onboarding run. It serves two jobs:
//   1. a content-free scoreboard/debug trail (outcome, stage, timings, error, step feed), and
//   2. the kept CV data itself — extracted text, mined claims, and a pointer to the original file
//      in R2 — so uploads are not lost. CV content is PII: it is stored but only ever read back
//      through the key-gated detail routes, never the open scoreboard.
// Writes are best-effort and MUST never block or fail a real run.
import pg from "pg";
import type { VisitRecord } from "./pipeline.js";

/** Scoreboard row — no CV content, safe to show openly. */
export interface VisitSummary {
  id: number;
  createdAt: string;
  jobId: string;
  sessionId: string | null;
  finished: boolean;
  stage: string;
  minedClaims: number | null;
  roles: number | null;
  needsGrill: number | null;
  posting: string | null;
  durationMs: number | null;
  error: string | null;
  feed: string[];
}

/** Full row including the kept CV data. Returned only through the key-gated detail route. */
export interface VisitFull extends VisitSummary {
  uploadKey: string | null; // R2 object key of the original file (null for pasted text)
  kind: string | null; // pdf | docx | txt
  rawCv: unknown; // extracted CV (includes fullText)
  claims: unknown; // mined claims
}

export interface Guestbook {
  /** true when a real DB is wired; false = no-op (local dev / tests). */
  ready: boolean;
  init(): Promise<void>;
  record(v: VisitRecord): Promise<void>;
  list(limit?: number): Promise<VisitSummary[]>;
  get(id: number): Promise<VisitFull | null>;
}

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS visits (
  id           bigserial PRIMARY KEY,
  created_at   timestamptz NOT NULL DEFAULT now(),
  job_id       text,
  session_id   text,
  finished     boolean NOT NULL,
  stage        text,
  mined_claims integer,
  roles        integer,
  needs_grill  integer,
  posting      text,
  duration_ms  integer,
  error        text,
  feed         jsonb,
  upload_key   text,   -- R2 key of the original uploaded file
  kind         text,   -- pdf | docx | txt
  raw_cv       jsonb,  -- extracted CV (kept)
  claims       jsonb   -- mined claims (kept)
)`;

// ponytail: hand-rolled idempotent migration for a tiny app — ADD COLUMN IF NOT EXISTS evolves an
// already-created table. Move to a real migration tool if the schema grows past a handful of these.
const ALTERS = [
  "ALTER TABLE visits ADD COLUMN IF NOT EXISTS upload_key text",
  "ALTER TABLE visits ADD COLUMN IF NOT EXISTS kind text",
  "ALTER TABLE visits ADD COLUMN IF NOT EXISTS raw_cv jsonb",
  "ALTER TABLE visits ADD COLUMN IF NOT EXISTS claims jsonb",
];

const SUMMARY_COLS = `id, created_at, job_id, session_id, finished, stage, mined_claims,
                      roles, needs_grill, posting, duration_ms, error, feed`;

function toSummary(r: Record<string, unknown>): VisitSummary {
  const created = r.created_at;
  return {
    id: Number(r.id),
    createdAt: created instanceof Date ? created.toISOString() : String(created),
    jobId: r.job_id as string,
    sessionId: (r.session_id as string) ?? null,
    finished: r.finished as boolean,
    stage: (r.stage as string) ?? "",
    minedClaims: (r.mined_claims as number) ?? null,
    roles: (r.roles as number) ?? null,
    needsGrill: (r.needs_grill as number) ?? null,
    posting: (r.posting as string) ?? null,
    durationMs: (r.duration_ms as number) ?? null,
    error: (r.error as string) ?? null,
    feed: Array.isArray(r.feed) ? (r.feed as string[]) : [],
  };
}

/** No DB configured → a guestbook that quietly does nothing, so no caller needs to branch. */
function noopGuestbook(): Guestbook {
  return {
    ready: false,
    init: async () => {},
    record: async () => {},
    list: async () => [],
    get: async () => null,
  };
}

export function createGuestbook(databaseUrl?: string): Guestbook {
  if (!databaseUrl) return noopGuestbook();
  // Fly's attached Postgres is on the internal network (no TLS); default pg config is correct.
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 3 });

  return {
    ready: true,
    async init() {
      await pool.query(CREATE_TABLE);
      for (const alter of ALTERS) await pool.query(alter);
    },
    async record(v) {
      await pool.query(
        `INSERT INTO visits
           (job_id, session_id, finished, stage, mined_claims, roles, needs_grill,
            posting, duration_ms, error, feed, upload_key, kind, raw_cv, claims)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          v.jobId, v.sessionId, v.finished, v.stage, v.minedClaims, v.roles, v.needsGrill,
          v.posting, v.durationMs, v.error, JSON.stringify(v.feed), v.uploadKey, v.kind,
          v.rawCv == null ? null : JSON.stringify(v.rawCv),
          v.claims == null ? null : JSON.stringify(v.claims),
        ],
      );
    },
    async list(limit = 100) {
      const { rows } = await pool.query(
        `SELECT ${SUMMARY_COLS} FROM visits ORDER BY id DESC LIMIT $1`,
        [limit],
      );
      return rows.map(toSummary);
    },
    async get(id) {
      const { rows } = await pool.query(
        `SELECT ${SUMMARY_COLS}, upload_key, kind, raw_cv, claims FROM visits WHERE id = $1`,
        [id],
      );
      if (rows.length === 0) return null;
      const r = rows[0];
      return {
        ...toSummary(r),
        uploadKey: (r.upload_key as string) ?? null,
        kind: (r.kind as string) ?? null,
        rawCv: r.raw_cv ?? null,
        claims: r.claims ?? null,
      };
    },
  };
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A phone-readable scoreboard. Each run shows its outcome, and expands to its step trail + error. */
export function renderGuestbookHtml(rows: VisitSummary[]): string {
  const body = rows
    .map((r) => {
      const ok = r.finished ? "✅" : "❌";
      const when = esc(r.createdAt.replace("T", " ").slice(0, 19));
      const took = r.durationMs != null ? (r.durationMs / 1000).toFixed(1) + "s" : "";
      const feed = (r.feed ?? []).map((f) => `<li>${esc(f)}</li>`).join("");
      const err = r.error ? `<div class="err">${esc(r.error)}</div>` : "";
      return `<tr class="row"><td>${ok}</td><td>${when}</td><td>#${r.id}</td><td>${esc(r.stage)}</td>
        <td>${esc(r.minedClaims ?? "")}</td><td>${esc(r.posting ?? "")}</td><td>${took}</td></tr>
        <tr class="trail"><td></td><td colspan="6"><ul>${feed}</ul>${err}</td></tr>`;
    })
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>JobCrush — visits</title>
<style>
  body{font:14px/1.5 system-ui,-apple-system,sans-serif;margin:1rem;color:#111}
  h1{font-size:1.2rem} h1 small{color:#888;font-weight:400}
  table{border-collapse:collapse;width:100%}
  th,td{padding:.35rem .5rem;text-align:left;vertical-align:top;border-bottom:1px solid #eee}
  th{font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:#666}
  .trail ul{margin:.2rem 0;padding-left:1.1rem;color:#555;font-size:13px}
  .err{color:#b00020;font-family:ui-monospace,monospace;font-size:12px;white-space:pre-wrap;margin-top:.3rem}
  @media(prefers-color-scheme:dark){body{background:#111;color:#eee}th,td{border-color:#333}
    th,.trail ul{color:#aaa}.err{color:#ff6b6b}}
</style></head><body>
<h1>Visits <small>(${rows.length})</small></h1>
<table><thead><tr><th>ok</th><th>when (UTC)</th><th>#</th><th>stage</th><th>claims</th><th>posting</th><th>took</th></tr></thead>
<tbody>${body || '<tr><td colspan="7">no visits yet</td></tr>'}</tbody></table>
</body></html>`;
}
