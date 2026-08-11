// #161 — the read + correction door for structured job records. Session-authenticated (same gate
// as contact.ts), reachable pre-wall. This is the interface a future confirm-deck frontend (#157
// Design A) builds against; no UI ships here.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { MinedDate, MinedEndValue, KINDS } from "@jobcrush/contracts";
import { requireSession } from "../server.js";
import type { JobBlockStore } from "../jobBlockStore.js";

export interface JobBlocksDeps {
  jobBlocks: JobBlockStore;
}

const Params = z.object({ blockId: z.string() });

// Review fix #1: a correction's `value` is validated per decision key against the SAME shape the
// contract requires of the miner's own output — `value: z.unknown()` let `{key:"kind",
// value:"hobby"}` or `{key:"start", value:"whenever"}` persist junk that toView then casts straight
// to Kind/MinedDate downstream.
const CorrectBody = z.discriminatedUnion("key", [
  z.object({ key: z.literal("employer"), value: z.string().min(1) }),
  z.object({ key: z.literal("title"), value: z.string().min(1) }),
  z.object({ key: z.literal("start"), value: MinedDate }),
  z.object({ key: z.literal("end"), value: MinedEndValue }),
  z.object({ key: z.literal("kind"), value: z.enum(KINDS) }),
]);

const ResolveMatchBody = z.discriminatedUnion("resolution", [
  z.object({ resolution: z.literal("same"), matchedBlockId: z.string() }),
  z.object({ resolution: z.literal("different") }),
]);

const notFound = (message: string) => ({ error: { code: "not_found", message } });

export function jobBlocksRoutes(deps: JobBlocksDeps) {
  return async function plugin(fastify: FastifyInstance) {
    const app = fastify.withTypeProvider<ZodTypeProvider>();

    // The confirm deck's own read: every dated block, each of its five decisions (value + origin +
    // machine_touch + classification + a stable per-decision id a correction can target), whether
    // it counts toward experience (derived, never asked), an ambiguous block's candidate ids, plus
    // deck-level totals and the not_run/ok/failed read state (#161 AC8's negative test, surfaced
    // here — "failed" is distinct from "ok, blocksFound: 0").
    app.get("/job-blocks", async (req) => {
      const session = requireSession(req);
      const [blocks, summary] = await Promise.all([
        deps.jobBlocks.list(session.id),
        deps.jobBlocks.summary(session.id),
      ]);
      return { blocks, summary };
    });

    app.post(
      "/job-blocks/:blockId/confirm",
      { schema: { params: Params } },
      async (req, reply) => {
        const session = requireSession(req);
        const found = await deps.jobBlocks.confirm(session.id, req.params.blockId);
        if (!found) return reply.status(404).send(notFound("unknown job block"));
        return { ok: true };
      },
    );

    app.post(
      "/job-blocks/:blockId/correct",
      { schema: { params: Params, body: CorrectBody } },
      async (req, reply) => {
        const session = requireSession(req);
        const { key, value } = req.body;
        const found = await deps.jobBlocks.correct(session.id, req.params.blockId, key, value);
        if (!found) return reply.status(404).send(notFound("unknown job block"));
        return { ok: true };
      },
    );

    app.post(
      "/job-blocks/:blockId/detach",
      { schema: { params: Params } },
      async (req, reply) => {
        const session = requireSession(req);
        const found = await deps.jobBlocks.detach(session.id, req.params.blockId);
        if (!found) return reply.status(404).send(notFound("unknown job block"));
        return { ok: true };
      },
    );

    // The person's answer to an ambiguous match (#157 Design A's own "ask when ambiguous"): "same
    // job as X" merges into the existing block (keeping every confirmation/correction it already
    // carries); "different job" lets the ambiguous block stand alone as its own recognised job.
    app.post(
      "/job-blocks/:blockId/resolve-match",
      { schema: { params: Params, body: ResolveMatchBody } },
      async (req, reply) => {
        const session = requireSession(req);
        const resolution =
          req.body.resolution === "same"
            ? ({ type: "same" as const, matchedBlockId: req.body.matchedBlockId })
            : ({ type: "different" as const });
        const found = await deps.jobBlocks.resolveMatch(session.id, req.params.blockId, resolution);
        if (!found) return reply.status(404).send(notFound("unknown job block or candidate"));
        return { ok: true };
      },
    );
  };
}
