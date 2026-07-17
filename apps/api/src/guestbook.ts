// A tiny persistent "guestbook": one row per onboarding run, so a friend/stranger test leaves a
// durable, debuggable trail. Fly logs are ephemeral (live tail only); this survives restarts and
// answers both "did it work?" and, when it didn't, "what happened?" — the row keeps the raw error
// and the full step feed. Writes are best-effort and MUST never block or fail a real run.
import pg from "pg";
import type { VisitRecord } from "./pipeline.js";

export interface VisitRow extends VisitRecord {
  id: number;
  createdAt: string;
}

export interface Guestbook {
  /** true when a real DB is wired; false = no-op (local dev / tests). */
  ready: boolean;
  init(): Promise<void>;
  record(v: VisitRecord): Promise<void>;
  list(limit?: number): Promise<VisitRow[]>;
}

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS visits (
  id           bigserial PRIMARY KEY,
  created_at   timestamptz NOT NULL DEFAULT now(),
  job_id       text,
  session_id   text,
  finished     boolean NOT NULL,
  stage        text,              -- last stage reached: extract | mine | preview | start
  mined_claims integer,
  roles        integer,
  needs_grill  integer,
  posting      text,
  duration_ms  integer,
  error        text,              -- raw failure message (null on success)
  feed         jsonb              -- the human-readable step trail, for debugging
)`;

/** No DB configured → a guestbook that quietly does nothing, so no caller needs to branch. */
function noopGuestbook(): Guestbook {
  return { ready: false, init: async () => {}, record: async () => {}, list: async () => [] };
}

export function createGuestbook(databaseUrl?: string): Guestbook {
  if (!databaseUrl) return noopGuestbook();
  // Fly's attached Postgres is on the internal network (no TLS); default pg config is correct.
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 3 });

  return {
    ready: true,
    async init() {
      await pool.query(CREATE_TABLE);
    },
    async record(v) {
      await pool.query(
        `INSERT INTO visits
           (job_id, session_id, finished, stage, mined_claims, roles, needs_grill,
            posting, duration_ms, error, feed)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          v.jobId, v.sessionId, v.finished, v.stage, v.minedClaims, v.roles,
          v.needsGrill, v.posting, v.durationMs, v.error, JSON.stringify(v.feed),
        ],
      );
    },
    async list(limit = 100) {
      const { rows } = await pool.query(
        `SELECT id, created_at, job_id, session_id, finished, stage, mined_claims,
                roles, needs_grill, posting, duration_ms, error, feed
           FROM visits ORDER BY id DESC LIMIT $1`,
        [limit],
      );
      return rows.map((r) => ({
        id: Number(r.id),
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
        jobId: r.job_id,
        sessionId: r.session_id,
        finished: r.finished,
        stage: r.stage,
        minedClaims: r.mined_claims,
        roles: r.roles,
        needsGrill: r.needs_grill,
        posting: r.posting,
        durationMs: r.duration_ms,
        error: r.error,
        feed: Array.isArray(r.feed) ? r.feed : [],
      }));
    },
  };
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A phone-readable scoreboard. Each run shows its outcome, and expands to its step trail + error. */
export function renderGuestbookHtml(rows: VisitRow[]): string {
  const body = rows
    .map((r) => {
      const ok = r.finished ? "✅" : "❌";
      const when = esc(r.createdAt.replace("T", " ").slice(0, 19));
      const took = r.durationMs != null ? (r.durationMs / 1000).toFixed(1) + "s" : "";
      const feed = (r.feed ?? []).map((f) => `<li>${esc(f)}</li>`).join("");
      const err = r.error ? `<div class="err">${esc(r.error)}</div>` : "";
      return `<tr class="row"><td>${ok}</td><td>${when}</td><td>${esc(r.stage)}</td>
        <td>${esc(r.minedClaims ?? "")}</td><td>${esc(r.posting ?? "")}</td><td>${took}</td></tr>
        <tr class="trail"><td></td><td colspan="5"><ul>${feed}</ul>${err}</td></tr>`;
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
<table><thead><tr><th>ok</th><th>when (UTC)</th><th>stage</th><th>claims</th><th>posting</th><th>took</th></tr></thead>
<tbody>${body || '<tr><td colspan="6">no visits yet</td></tr>'}</tbody></table>
</body></html>`;
}
