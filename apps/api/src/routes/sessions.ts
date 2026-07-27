// JC-10 routes: anonymous session creation + target-titles storage (JC-14 writes these).
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { IpRateLimiter, type SessionStore } from "../sessions.js";

export const SESSION_COOKIE = "jc_session";

export function sessionRoutes(sessions: SessionStore, limiter = new IpRateLimiter()) {
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
  };
}
