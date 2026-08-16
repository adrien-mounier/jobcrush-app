import type { FastifyBaseLogger } from "fastify";

/** #227 — best-effort retry for past-job family placements left null by an earlier labeler miss.
 *  The labeler owns idempotency and skips answered/corrected jobs, so callers may run it before
 *  reads that use placements for discovery, review readback, or fallback ranking. */
export async function retryJobBlockLabels(
  retry: ((sessionId: string) => Promise<void>) | undefined,
  sessionId: string,
  log: Pick<FastifyBaseLogger, "warn">,
): Promise<void> {
  try {
    await retry?.(sessionId);
  } catch (err) {
    log.warn({ err, sessionId }, "job-block family placement retry failed");
  }
}
