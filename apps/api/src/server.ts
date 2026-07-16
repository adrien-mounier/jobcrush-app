// JC-8 API skeleton: Fastify + zod-typed routes, error envelope, auth stub, healthz, and the
// JC-9 jobs endpoints (create demo job, get status, SSE progress stream).
import Fastify, { type FastifyError } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { z } from "zod";
import { InMemoryJobStore, isTerminal, runDemoJob, type JobStore } from "./jobs.js";

declare module "fastify" {
  interface FastifyRequest {
    sessionId: string | null;
  }
}

export interface BuildOptions {
  store?: JobStore;
}

export function buildServer(opts: BuildOptions = {}) {
  const store = opts.store ?? new InMemoryJobStore();
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Error envelope: every error becomes { error: { code, message } }.
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    const status = err.statusCode ?? 500;
    reply.status(status).send({
      error: { code: err.code ?? "internal_error", message: err.message },
    });
  });

  // Auth stub (JC-18 replaces this): reads a bearer/session token if present, attaches a session
  // context. Nothing is rejected yet — routes that need auth opt in once real auth lands.
  app.decorateRequest("sessionId", null);
  app.addHook("onRequest", async (req) => {
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) req.sessionId = auth.slice(7);
  });

  app.get("/healthz", async () => ({
    ok: true,
    sha: process.env.BUILD_SHA ?? "dev",
    env: process.env.APP_ENV ?? "local",
  }));

  app.post(
    "/jobs/demo",
    { schema: { response: { 201: z.object({ id: z.string() }) } } },
    async (req, reply) => {
      const job = await store.create("demo-job", req.sessionId);
      void runDemoJob(store, job.id); // fire-and-forget; progress lands in the store
      reply.status(201);
      return { id: job.id };
    },
  );

  app.get(
    "/jobs/:id",
    { schema: { params: z.object({ id: z.string() }) } },
    async (req, reply) => {
      const job = await store.get(req.params.id);
      if (!job) return reply.status(404).send({ error: { code: "not_found", message: "unknown job" } });
      return job;
    },
  );

  // SSE progress stream. Emits one event per update; closes when the job reaches a terminal state.
  app.get(
    "/jobs/:id/events",
    { schema: { params: z.object({ id: z.string() }) } },
    async (req, reply) => {
      const job = await store.get(req.params.id);
      if (!job) return reply.status(404).send({ error: { code: "not_found", message: "unknown job" } });

      reply.raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const send = (j: unknown) => reply.raw.write(`data: ${JSON.stringify(j)}\n\n`);
      send(job);
      if (isTerminal(job.status)) {
        reply.raw.end();
        return reply;
      }
      const heartbeat = setInterval(() => reply.raw.write(": hb\n\n"), 15_000);
      const unsubscribe = store.subscribe(req.params.id, (updated) => {
        send(updated);
        if (isTerminal(updated.status)) {
          cleanup();
          reply.raw.end();
        }
      });
      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
      req.raw.on("close", cleanup);
      return reply;
    },
  );

  return { app, store };
}
