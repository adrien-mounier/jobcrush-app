// E2/JC-20 — purge unclaimed anonymous data. Purge deletes sessions never claimed by a user and idle
// past the TTL, their claims, any spent/expired login tokens, and — #105 — card_judgements rows
// UNUSED for the same TTL. Postgres-only — in-memory data is wiped on restart, so there is nothing to
// purge there. The cutoff is computed in JS (no interval SQL) so it runs identically on Postgres and
// pg-mem.
//
// card_judgements carries CV-derived reason prose (a per-requirement verdict can paraphrase what a
// visitor said about themselves) but has no session_id column to join against — it's keyed by
// (adId, factsFingerprint), a property of the advert + fact set, not of any one session (see
// judgementStore.ts's own header for why), and the fingerprint is genuinely SHARED: two visitors who
// answer the same things the same way legitimately share one row, so there is no single "owning"
// session to key a purge on even if a column were added.
//
// #105 review round 2: an earlier version swept by judged_at (age since first judged) — wrong, because
// it silently re-judges a STABLE, actively-viewed card (one that already has a STORED judgement) the
// moment a claimed user returns after the TTL having changed nothing — exactly the failure the ticket
// exists to make impossible for an already-judged card ("the number never moves... run-to-run
// variance must be structurally impossible to surface" — a guarantee that starts once a judgement is
// stored; a card's first-ever view still makes a live call and can fall back on a timeout, see
// judge.ts's makeJudge doc). Swept by
// DISUSE instead: judgementStore.ts's PgJudgementStore.get() bumps last_used_at forward on a read
// (throttled to at most once a day, so an active viewer's row is touched far more often than it goes
// stale) — a row an active user keeps hitting never goes cold and is never purged out from under them;
// a row a purged anonymous visitor left behind goes cold and is swept on schedule. Same TTL, same
// cutoff shape as every other table here, just filtered on the LAST use instead of the FIRST.
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
  await pool.query(`DELETE FROM card_judgements WHERE last_used_at < $1`, [cutoff]);
  return { sessions: rowCount ?? 0 };
}
