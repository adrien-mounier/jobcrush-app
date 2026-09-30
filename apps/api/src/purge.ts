// E2/JC-20 — purge unclaimed anonymous data. Purge deletes sessions never claimed by a user and idle
// past the TTL, their claims, any spent/expired login tokens, and — #105 — card_judgements rows
// UNUSED for the same TTL. Postgres-only — in-memory data is wiped on restart, so there is nothing to
// purge there. The cutoff is computed in JS (no interval SQL) so it runs identically on Postgres and
// pg-mem.
//
// #118 — the ACTUAL rule, stated truthfully so this header doesn't go stale the way a prior purge
// header once did: content is purged, spend is not. `llm_usage_ledger` (usageLedgerStore.ts) rows are
// retained INDEFINITELY and this function never touches that table — the owner's explicit decision on
// #118 was to keep per-visitor spend history beyond this TTL, even for a visitor who never signed up,
// in exchange for the narrowest possible payload on every row (no CV text, no answers, no advert or
// requirement text, no model-written prose — just a pseudonymous visitor id, stage, model, token
// counts, and a computed cost). A visitor's ledger rows therefore carry their id indefinitely, with
// no TTL, unless and until something explicitly scrubs it.
//
// The MECHANISM for an explicit deletion request exists — usageLedgerStore.ts's scrubVisitor nulls
// the visitor id on that visitor's rows and keeps the money — but nothing calls it yet. #68 ("start
// over") is still open, and the HTTP route that would invoke scrubVisitor on a real deletion request
// lands there, not here. Until #68 ships, this is a documented capability with no caller, not a live
// deletion path.
//
// #252 — a SECOND retained table, named here for the same reason: `unmapped_labels` holds the words
// a visitor typed (or that were read off their CV) that the published vocabulary had no family for,
// with the session id as its person link. It is retained INDEFINITELY and this function never touches
// it — the owner's decision on 2026-08-20 was to build no deletion for it, so the growth process
// (#218) keeps a complete record of the vocabulary's gaps. The session it points at IS purged on the
// usual TTL, so the link dangles by design; the words and the reason are what the process needs.
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
  // #303 (#294 clause 11): the per-person paste record joins the sweep unchanged — it is keyed on
  // the session, so it goes when the session's whole profile goes, and it costs nothing new. Note
  // what it does NOT take with it: the pasted advert itself lives in provider_postings, which this
  // function has never touched, and is shared by everyone who pasted the same text. That retention
  // is named as a carried risk in #294 clause 10, not engineered away.
  await pool.query(
    `DELETE FROM paste_records WHERE session_id IN (
       SELECT id FROM sessions WHERE claimed_by_user_id IS NULL AND last_seen_at < $1)`,
    [cutoff],
  );
  // #310: the tailored-draft checkpoint is session-keyed CV content — it goes when the session's
  // whole profile goes, same shape as claims and paste_records above.
  await pool.query(
    `DELETE FROM tailor_drafts WHERE session_id IN (
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
