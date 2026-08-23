import type { FastifyBaseLogger } from "fastify";

/** #227 — runs ONE best-effort labeler retry safely: a placement left null by an earlier miss is
 *  filled in before a read that needs it, and a failure here never reaches the caller. The labeler
 *  owns idempotency and skips answered/corrected jobs, so callers may run it before reads that use
 *  placements for discovery, review readback, or fallback ranking.
 *  #281 — named for what it does rather than for one axis, because both the family labeler and the
 *  industry labeler are now handed to it. */
export async function runLabelerRetry(
  retry: ((sessionId: string) => Promise<void>) | undefined,
  sessionId: string,
  log: Pick<FastifyBaseLogger, "warn">,
): Promise<void> {
  try {
    await retry?.(sessionId);
  } catch (err) {
    // #281: shared by the family and industry halves, so the message names neither.
    log.warn({ err, sessionId }, "job-block placement retry failed");
  }
}
