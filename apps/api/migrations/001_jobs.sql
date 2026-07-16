-- JC-9 jobs table (applies when Postgres exists — JC-6). Mirrors src/jobs.ts JobRecord.
CREATE TABLE IF NOT EXISTS jobs (
  id          uuid PRIMARY KEY,
  type        text NOT NULL,
  session_id  text,
  status      text NOT NULL CHECK (status IN ('queued','running','completed','failed')),
  progress    jsonb NOT NULL DEFAULT '{}'::jsonb, -- checkpointed per-step outputs (LLM stages never re-run)
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_session_idx ON jobs (session_id, created_at DESC);
