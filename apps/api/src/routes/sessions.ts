// JC-10 routes: anonymous session creation + target-titles storage (JC-14 writes these).
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { IpRateLimiter, type SessionStore } from "../sessions.js";
import { resolveSearchArea } from "../postingRetrieval.js";

export const SESSION_COOKIE = "jc_session";

const sourceEntrySchema = z.discriminatedUnion("checkpoint", [
  z.object({ checkpoint: z.literal("invited"), choice: z.null() }).strict(),
  z
    .object({
      checkpoint: z.literal("source_selected"),
      choice: z.enum(["cv", "questions"]),
    })
    .strict(),
]);

const importProofSchema = z.object({
  outcome: z.enum(["success", "partial", "failed", "no_useful_facts"]),
  usefulFactCount: z.number().int().nonnegative(),
  skippedQuestionCount: z.number().int().nonnegative(),
  representativeFacts: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      provenance: z.literal("cv"),
    }),
  ).max(4),
  conflict: z
    .object({
      fieldId: z.string(),
      label: z.string(),
      userResolvedValue: z.string().nullable(),
    })
    .nullable(),
});

const intentSchema = z.object({
  targetRole: z.string().nullable(),
  searchArea: z.string().nullable(),
});

const intentWriteSchema = z
  .object({
    targetRole: z.string().trim().min(1).optional(),
    searchArea: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine((value) => value.targetRole !== undefined || value.searchArea !== undefined);

// #184 — the PINNED additive field: resolved fresh from postingRetrieval.ts's live provider registry
// on every read (never persisted, never a second copy of the coverage list), so a registry edit
// updates the message with no code change (AC3) — across DEPLOYS; postings.ts's own loader
// memoizes the parsed file for the lifetime of a running process (postings.ts:41), so a registry
// edit only takes effect on the next deploy/restart, not the next request against a live one. `null`
// only when nothing has been typed yet — once `searchArea` is non-null, the visitor is ALWAYS told
// covered/uncovered, at the intent step, before any retrieval (AC1).
const searchAreaResolutionSchema = z.union([
  z.object({ covered: z.literal(true), market: z.string(), marketKey: z.string() }),
  z.object({ covered: z.literal(false), coverage: z.array(z.string()) }),
]);

const intentState = (intent: { targetRole: string | null; searchArea: string | null }) => {
  const searchAreaResolution = intent.searchArea ? resolveSearchArea(intent.searchArea) : null;
  // #184 spec review must-fix: the coverage gate is SERVER-side, not just the web's refusal to
  // advance — an uncovered area must never flip the checkpoint to intent_known. The typed text is
  // still stored and still returned in `intent` (useful for re-display), but it counts as still
  // "missing" so checkpoint stays intent_needed and the web's restore path (GET, e.g. on reload) can
  // re-show the coverage message from `searchAreaResolution` rather than the area passing silently
  // onward once the checkpoint alone said "known".
  const uncoveredArea = searchAreaResolution !== null && !searchAreaResolution.covered;
  const missing = (["targetRole", "searchArea"] as const).filter(
    (field) => intent[field] === null || (field === "searchArea" && uncoveredArea),
  );
  return {
    intent,
    missing,
    checkpoint: missing.length === 0 ? ("intent_known" as const) : ("intent_needed" as const),
    searchAreaResolution,
  };
};

const intentStateSchema = z.object({
  intent: intentSchema,
  missing: z.array(z.enum(["targetRole", "searchArea"])),
  checkpoint: z.enum(["intent_needed", "intent_known"]),
  searchAreaResolution: searchAreaResolutionSchema.nullable(),
});

export function sessionRoutes(
  sessions: SessionStore,
  limiter = new IpRateLimiter(),
) {
  return async function plugin(fastify: FastifyInstance) {
    const app = fastify.withTypeProvider<ZodTypeProvider>();

    app.post(
      "/sessions/anonymous",
      {
        schema: {
          response: {
            201: z.object({ id: z.string() }),
            429: z.object({ error: z.object({ code: z.string(), message: z.string() }) }),
          },
        },
      },
      async (req, reply) => {
        if (!limiter.allow(req.ip)) {
          return reply
            .status(429)
            .send({ error: { code: "rate_limited", message: "too many sessions from this address" } });
        }
        const session = await sessions.create();
        reply.setCookie(SESSION_COOKIE, session.token, {
          path: "/",
          httpOnly: true,
          sameSite: "lax",
          secure: (process.env.APP_ENV ?? "local") !== "local" && process.env.NODE_ENV !== "test",
        });
        reply.status(201);
        return { id: session.id };
      },
    );

  app.get("/sessions/me", async (req, reply) => {
      if (!req.session) {
        return reply.status(401).send({ error: { code: "no_session", message: "no active session" } });
      }
      const { token: _token, ...safe } = req.session;
    return safe;
  });

  app.get(
    "/sessions/me/intent",
    {
      schema: {
        response: {
          200: intentStateSchema,
          401: z.object({
            error: z.object({
              code: z.literal("no_session"),
              message: z.literal("no active session"),
            }),
          }),
        },
      },
    },
    async (req, reply) => {
      if (!req.session) {
        return reply
          .status(401)
          .send({ error: { code: "no_session", message: "no active session" } });
      }
      return intentState(req.session.intent);
    },
  );

  app.put(
    "/sessions/me/intent",
    {
      schema: {
        body: intentWriteSchema,
        response: {
          200: intentStateSchema,
          401: z.object({
            error: z.object({
              code: z.literal("no_session"),
              message: z.literal("no active session"),
            }),
          }),
        },
      },
    },
    async (req, reply) => {
      if (!req.session) {
        return reply
          .status(401)
          .send({ error: { code: "no_session", message: "no active session" } });
      }
      return intentState(await sessions.setIntent(req.session.id, req.body));
    },
  );

    app.put(
      "/sessions/me/targets",
      { schema: { body: z.object({ targetTitles: z.array(z.string().trim().min(1)).max(10) }) } },
      async (req, reply) => {
        if (!req.session) {
          return reply.status(401).send({ error: { code: "no_session", message: "no active session" } });
        }
        await sessions.setTargetTitles(req.session.id, req.body.targetTitles);
        return { ok: true };
      },
    );

    // #15 front door → discovery handoff. Anonymous-friendly (pre-wall, like /targets above) —
    // only these two early stages are settable here; the enum fails closed on anything else.
    app.put(
      "/sessions/me/stage",
      { schema: { body: z.object({ stage: z.enum(["front-door", "discovery"]) }) } },
      async (req, reply) => {
        if (!req.session) {
          return reply.status(401).send({ error: { code: "no_session", message: "no active session" } });
        }
        await sessions.setStage(req.session.id, req.body.stage);
        return { ok: true };
      },
    );

    app.put(
      "/sessions/me/source-entry",
      {
        schema: {
          body: sourceEntrySchema,
          response: {
            200: z.object({ sourceEntry: sourceEntrySchema }),
            401: z.object({
              error: z.object({
                code: z.literal("no_session"),
                message: z.literal("no active session"),
              }),
            }),
          },
        },
      },
      async (req, reply) => {
        if (!req.session) {
          return reply.status(401).send({ error: { code: "no_session", message: "no active session" } });
        }
        await sessions.setSourceEntry(req.session.id, req.body);
        return { sourceEntry: req.body };
      },
    );

    app.put(
      "/sessions/me/import-resolution",
      {
        schema: {
          body: z.object({
            fieldId: z.string().trim().min(1),
            value: z.string().trim().min(1),
          }).strict(),
        },
      },
      async (req, reply) => {
        if (!req.session) {
          return reply
            .status(401)
            .send({ error: { code: "no_session", message: "no active session" } });
        }
        const proof = req.session.importProof;
        if (!proof) {
          return reply
            .status(409)
            .send({ error: { code: "import_not_ready", message: "CV import is not ready" } });
        }
        if (
          !proof.representativeFacts.some((fact) => fact.id === req.body.fieldId) &&
          proof.conflict?.fieldId !== req.body.fieldId
        ) {
          return reply
            .status(404)
            .send({ error: { code: "unknown_field", message: "unknown imported field" } });
        }
        const importProof = await sessions.resolveImport(
          req.session.id,
          req.body.fieldId,
          req.body.value,
        );
        return { importProof: importProofSchema.parse(importProof) };
      },
    );
  };
}
