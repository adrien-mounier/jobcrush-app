// API composition root: Fastify + zod-typed routes, error envelope, session resolution,
// healthz, JC-9 job endpoints, and the S1 route plugins (sessions, uploads, cv, previews).
import Fastify, { type FastifyError, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { z } from "zod";
import { InMemoryJobStore, isTerminal, runDemoJob, type JobStore } from "./jobs.js";
import { InMemorySessionStore, type SessionRecord, type SessionStore } from "./sessions.js";
import { SESSION_COOKIE, sessionRoutes } from "./routes/sessions.js";
import { uploadRoutes, type UploadDeps } from "./routes/uploads.js";
import { InMemoryBlobStorage, type BlobStorage } from "./storage.js";
import { InMemoryUploadStore, REJECT_MESSAGES } from "./uploads.js";
import { runOnboardingJob, type PipelineDeps } from "./pipeline.js";

declare module "fastify" {
  interface FastifyRequest {
    session: SessionRecord | null;
  }
}

export interface BuildOptions {
  store?: JobStore;
  sessions?: SessionStore;
  blobs?: BlobStorage;
  uploads?: InMemoryUploadStore;
  /** LLM-backed pipeline steps (mine, preview). Absent steps are skipped — tests inject fakes. */
  pipeline?: PipelineDeps;
  onUploaded?: UploadDeps["onUploaded"];
}

/** 401 helper: routes that require the JC-10 anonymous session call this first. */
export function requireSession(req: FastifyRequest): SessionRecord {
  if (!req.session) {
    const err = new Error("no active session") as FastifyError;
    err.statusCode = 401;
    err.code = "no_session";
    throw err;
  }
  return req.session;
}

export function buildServer(opts: BuildOptions = {}) {
  const store = opts.store ?? new InMemoryJobStore();
  const sessions = opts.sessions ?? new InMemorySessionStore();
  const blobs = opts.blobs ?? new InMemoryBlobStorage();
  const uploads = opts.uploads ?? new InMemoryUploadStore();
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.register(cookie);

  // Error envelope: every error becomes { error: { code, message } }.
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    if (err.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return reply.status(413).send({ error: { code: "too_big", message: REJECT_MESSAGES.tooBig } });
    }
    const status = err.statusCode ?? 500;
    reply.status(status).send({
      error: { code: err.code ?? "internal_error", message: err.message },
    });
  });

  // Session resolution (JC-10): cookie first, bearer token as the non-browser fallback.
  // Every S1 route authorizes against the resolved session; nothing is global.
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (req) => {
    const auth = req.headers.authorization;
    const token = req.cookies?.[SESSION_COOKIE] ?? (auth?.startsWith("Bearer ") ? auth.slice(7) : null);
    if (!token) return;
    const session = await sessions.getByToken(token);
    if (session) {
      req.session = session;
      await sessions.touch(session.id);
    }
  });

  app.get("/healthz", async () => ({
    ok: true,
    sha: process.env.BUILD_SHA ?? "dev",
    env: process.env.APP_ENV ?? "local",
  }));

  app.register(sessionRoutes(sessions));

  // A completed upload starts the onboarding pipeline job (extract → mine → preview).
  const pipelineDeps = opts.pipeline ?? {};
  const defaultOnUploaded: NonNullable<UploadDeps["onUploaded"]> = async (row, data) => {
    if (!row.kind) return null;
    const job = await store.create("onboarding", row.sessionId);
    const session = await sessions.getById(row.sessionId);
    void runOnboardingJob(
      store,
      job.id,
      { type: "upload", data, kind: row.kind },
      session?.targetTitles ?? [],
      pipelineDeps,
    );
    return { jobId: job.id };
  };
  app.register(uploadRoutes({ uploads, blobs, onUploaded: opts.onUploaded ?? defaultOnUploaded }));

  app.post(
    "/jobs/demo",
    { schema: { response: { 201: z.object({ id: z.string() }) } } },
    async (req, reply) => {
      const job = await store.create("demo-job", req.session?.id ?? null);
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

  return { app, store, sessions, blobs, uploads };
}
