// JC-10 routes: anonymous session creation + target-titles storage (JC-14 writes these).
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { IpRateLimiter, type SearchAreaEntry, type SearchIntent, type SessionStore } from "../sessions.js";
import { coveredMarketNames, resolveSearchArea, searchAreaVocabulary } from "../postingRetrieval.js";

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

// #214 — the wire shape of one stored target location: the stored entry (words as typed, marketKey,
// statedAt) plus its display resolution (market, label), resolved fresh from the one vocabulary on
// every read, never persisted twice.
const searchAreaStateSchema = z.object({
  text: z.string(),
  marketKey: z.string(),
  statedAt: z.string(),
  market: z.string(),
  label: z.string(),
});

// #214: up to 3 target locations. `searchArea` stays accepted as the legacy one-entry alias so
// pre-#214 callers (and tests) keep working; `searchAreas` REPLACES the whole list when present.
const MAX_TARGET_AREAS = 3;
const intentWriteSchema = z
  .object({
    targetRole: z.string().trim().min(1).optional(),
    searchArea: z.string().trim().min(1).optional(),
    searchAreas: z.array(z.string().trim().min(1)).max(MAX_TARGET_AREAS).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.targetRole !== undefined || value.searchArea !== undefined || value.searchAreas !== undefined,
  );

// #184's server-side coverage gate, carried forward: an uncovered entry is REFUSED (reported in
// `refused`, never stored), and the checkpoint advances only on targetRole + ≥1 covered market.
// `coverage`/`areaVocabulary` resolve fresh from the live provider registry on every read, so a
// registry edit updates both with no code change (per-deploy — postings.ts memoizes the file).
const intentState = (intent: SearchIntent, refused: Array<{ text: string; coverage: string[] }> = []) => {
  const searchAreas = intent.searchAreas.flatMap((entry) => {
    const resolution = resolveSearchArea(entry.text);
    // A stored entry no longer covered (registry shrank) drops from display AND from the gate.
    return resolution.covered
      ? [{ ...entry, market: resolution.market, label: resolution.label }]
      : [];
  });
  const missing = [
    ...(intent.targetRole === null ? (["targetRole"] as const) : []),
    ...(searchAreas.length === 0 ? (["searchArea"] as const) : []),
  ];
  return {
    intent: { targetRole: intent.targetRole, searchAreas },
    missing,
    checkpoint: missing.length === 0 ? ("intent_known" as const) : ("intent_needed" as const),
    refused,
    coverage: coveredMarketNames(),
    areaVocabulary: searchAreaVocabulary(),
  };
};

const intentStateSchema = z.object({
  intent: z.object({
    targetRole: z.string().nullable(),
    searchAreas: z.array(searchAreaStateSchema),
  }),
  missing: z.array(z.enum(["targetRole", "searchArea"])),
  checkpoint: z.enum(["intent_needed", "intent_known"]),
  refused: z.array(z.object({ text: z.string(), coverage: z.array(z.string()) })),
  coverage: z.array(z.string()),
  areaVocabulary: z.array(z.object({ alias: z.string(), market: z.string(), label: z.string() })),
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
      // #214: raw texts resolve here, once, server-side — covered ones become stored entries
      // (deduped by place: Sydney twice, or Sydney + "Sydney, Australia", is one chip), uncovered
      // ones are refused and reported, never stored. statedAt survives a re-save of a place the
      // person already holds — it means "when we learned it", not "when they last pressed save".
      const texts = req.body.searchAreas ?? (req.body.searchArea !== undefined ? [req.body.searchArea] : undefined);
      let entries: SearchAreaEntry[] | undefined;
      const refused: Array<{ text: string; coverage: string[] }> = [];
      if (texts) {
        const placeKey = (text: string): string | null => {
          const resolution = resolveSearchArea(text);
          return resolution.covered
            ? `${resolution.marketKey}/${resolution.city ?? ""}`
            : null;
        };
        const now = new Date().toISOString();
        const prior = new Map(
          req.session.intent.searchAreas.map((entry) => [placeKey(entry.text), entry.statedAt] as const),
        );
        const seen = new Set<string>();
        entries = [];
        for (const text of texts) {
          const resolution = resolveSearchArea(text);
          if (!resolution.covered) {
            refused.push({ text, coverage: resolution.coverage });
            continue;
          }
          const key = `${resolution.marketKey}/${resolution.city ?? ""}`;
          if (seen.has(key)) continue;
          seen.add(key);
          entries.push({ text, marketKey: resolution.marketKey, statedAt: prior.get(key) ?? now });
        }
      }
      const intent = await sessions.setIntent(req.session.id, {
        ...(req.body.targetRole !== undefined ? { targetRole: req.body.targetRole } : {}),
        ...(entries !== undefined ? { searchAreas: entries } : {}),
      });
      return intentState(intent, refused);
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
