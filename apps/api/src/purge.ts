// E2/JC-20 — purge unclaimed anonymous data. The only assets an anonymous visitor leaves are their
// session + its claims (kickoff #2), so purge is one rule: delete sessions never claimed by a user
// and idle past the TTL, their claims, and any spent/expired login tokens. Postgres-only — in-memory
// data is wiped on restart, so there is nothing to purge there. The cutoff is computed in JS (no
// interval SQL) so it runs identically on Postgres and pg-mem.
import type { Pool } from "pg";

export async function runPurge(pool: Pool, ttlDays = 14): Promise<{ sessions: number }> {
  const cutoff = new Date(Date.now() - ttlDays * 86_400_000).toISOString();
  await pool.query(
    `DELETE FROM claims WHERE session_id IN (
       SELECT id FROM sessions WHERE claimed_by_user_id IS NULL AND last_seen_at < $1)`,
    [cutoff],
  );
  const { rowCount } = await pool.query(
    `DELETE FROM sessions WHERE claimed_by_user_id IS NULL AND last_seen_at < $1`,
    [cutoff],
  );
  await pool.query(`DELETE FROM login_tokens WHERE used_at IS NOT NULL OR expires_at < now()`);
  return { sessions: rowCount ?? 0 };
}
