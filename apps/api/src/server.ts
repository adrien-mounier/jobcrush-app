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
import { cvRoutes } from "./routes/cv.js";
import { onboardingRoutes } from "./routes/onboarding.js";
import { InMemoryClaimStore, type ClaimStore } from "./claims.js";
import type { GrillPhraser } from "./grill.js";
import type { CvAuditor } from "./audit.js";
import {
  initialProductionFamilyFloors,
  type ProductionFamilyFloorStore,
  TestFixtureFamilyFloorStore,
} from "./familyFloors.js";
import { InMemoryAuthStore, type AuthStore } from "./auth.js";
import { authRoutes } from "./routes/auth.js";
import { DevMailer, type Mailer } from "./mailer.js";
import { createGuestbook, renderGuestbookHtml, type Guestbook } from "./guestbook.js";
import type { JobRecord } from "./jobs.js";
import {
  InMemoryFamilyLearningStore,
  type FamilyCandidateScreen,
  type FamilyMatchNotifier,
  type FamilyLearningStore,
} from "./familyLearning.js";
import { familyLearningRoutes } from "./routes/familyLearning.js";
import { readCounters, readFailureAlarm, readTimeoutAlarm, recentReadFailuresList } from "./counters.js";
import type { Posting } from "./preview.js";
import type { AdRequirementsV1 } from "@jobcrush/contracts";
import type { JudgeFn } from "./judge.js";
import { runWithVisitor } from "./llmVisitorContext.js";

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
  /** Persistent per-run guestbook. Defaults to Postgres via DATABASE_URL; no-op when unset. */
  guestbook?: Guestbook;
  /** JC-21 confirmed-claims store backing the onboarding deck. Postgres driver lands with JC-6/26. */
  claims?: ClaimStore;
  /** Deterministic, explicitly non-production floor catalog for #59 integration tests. */
  familyFloors?: TestFixtureFamilyFloorStore;
  productionFamilyFloors?: ProductionFamilyFloorStore;
  placeFamily?: (session: Readonly<SessionRecord>) => Promise<import("@jobcrush/contracts").FamilyPlacement>;
  /** JC-24 grill question phrasing (LLM-backed in prod). Absent → deterministic template phrasing. */
  phraseGrill?: GrillPhraser;
  /** S2 decision #6 root-CV wording audit (LLM-backed in prod). Absent → the CV ships unaudited. */
  auditCv?: CvAuditor;
  /** E2 accounts + magic-link tokens. Postgres driver lands with JC-6's DATABASE_URL. */
  auth?: AuthStore;
  /** E2 email seam. Absent → DevMailer (returns the link instead of sending it). */
  mailer?: Mailer;
  /** Absolute web origin for emailed sign-in links + OAuth redirects. */
  webUrl?: string;
  /** Google OAuth code→email exchange. Tests inject a fake; absent → the real Google endpoint. */
  googleEmail?: (code: string, redirectUri: string) => Promise<string | null>;
  familyLearning?: FamilyLearningStore;
  screenFamilyCandidate?: FamilyCandidateScreen;
  familyLearningOperatorKey?: string;
  familyLearningKnownFamilies?: Array<{ familyId: string; version: number }>;
  notifyFamilyMatch?: FamilyMatchNotifier;
  /** #104: reads an advert nobody hand-curated (fixture-only when absent — every pre-#104 test
   *  stays valid, and nothing here ever makes a live call unless main.ts wires the real reader). */
  readAd?: (posting: Posting) => Promise<AdRequirementsV1 | null>;
  /** #105: meaning-aware judging (deterministic tick when absent — every pre-#105 test stays valid,
   *  and nothing here ever makes a live judging call unless main.ts wires the real judge). */
  judge?: JudgeFn;
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

/** E2 wall (server-side, spec §8-3): onboarding routes past the preview require a claimed session. */
export function requireUser(req: FastifyRequest): SessionRecord {
  const session = requireSession(req);
  if (!session.claimedByUserId) {
    const err = new Error("login required") as FastifyError;
    err.statusCode = 401;
    err.code = "login_required";
    throw err;
  }
  return session;
}

export function buildServer(opts: BuildOptions = {}) {
  const store = opts.store ?? new InMemoryJobStore();
  const sessions = opts.sessions ?? new InMemorySessionStore();
  const blobs = opts.blobs ?? new InMemoryBlobStorage();
  const uploads = opts.uploads ?? new InMemoryUploadStore();
  const claims = opts.claims ?? new InMemoryClaimStore();
  const familyFloors = opts.familyFloors ?? new TestFixtureFamilyFloorStore();
  const productionFamilyFloors =
    opts.productionFamilyFloors ?? initialProductionFamilyFloors();
  const placeFamily =
    opts.placeFamily ??
    (async () => ({ schemaVersion: "1" as const, outcome: "unmapped" as const }));
  const auth = opts.auth ?? new InMemoryAuthStore();
  const mailer = opts.mailer ?? new DevMailer();
  const guestbook = opts.guestbook ?? createGuestbook(process.env.DATABASE_URL);
  const familyLearning = opts.familyLearning ?? new InMemoryFamilyLearningStore();
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" }).withTypeProvider<ZodTypeProvider>();
  guestbook.init().catch((err) => app.log.error(err, "guestbook init failed"));
  familyLearning.init().catch((err) => app.log.error(err, "family learning init failed"));
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
  // #118: the (request, reply, done) callback form is deliberate, not stylistic — it's what lets this
  // hook call runWithVisitor(visitorId, done) as its LAST synchronous action. done() then drives
  // Fastify's own continuation (the rest of the hook chain, then the route handler, then everything
  // the handler itself awaits) from INSIDE that AsyncLocalStorage scope, which is the only way the
  // ambient visitor survives past this hook (see llmVisitorContext.ts's header for why the equivalent
  // plain-async-hook + enterWith shape does not).
  app.addHook("onRequest", (req, reply, done) => {
    (async () => {
      const auth = req.headers.authorization;
      const token = req.cookies?.[SESSION_COOKIE] ?? (auth?.startsWith("Bearer ") ? auth.slice(7) : null);
      if (!token) return null;
      const session = await sessions.getByToken(token);
      if (session) {
        req.session = session;
        await sessions.touch(session.id);
      }
      return session;
    })()
      .then((session) => {
        // session.id doubles as the visitor pseudonym; no token, an unresolved token, or an error
        // resolving one all record null, never a guess.
        runWithVisitor(session?.id ?? null, done);
      })
      .catch(done);
  });

  app.get("/healthz", async () => ({
    ok: true,
    sha: process.env.BUILD_SHA ?? "dev",
    env: process.env.APP_ENV ?? "local",
  }));

  // #103: numbers only, no PII — same "always open" idiom as /healthz and the guestbook scoreboard.
  // In-process, reset-on-restart (counters.ts's known, documented limit for this slice). #104 adds
  // the read-failure alarm's firing state + current rate, both encoded as plain numbers (firing as
  // 0/1, rate as parts-per-mille) to keep this route's "numbers only" property intact.
  app.get("/ops/counters", async () => {
    const alarm = readFailureAlarm();
    const timeoutAlarm = readTimeoutAlarm();
    return {
      ...readCounters(),
      "adReader.read_failure_rate_per_mille": Math.round(alarm.rate * 1000),
      "adReader.read_failure_alarm_firing": alarm.firing ? 1 : 0,
      "adReader.read_timeout_rate_per_mille": Math.round(timeoutAlarm.rate * 1000),
      "adReader.read_timeout_alarm_firing": timeoutAlarm.firing ? 1 : 0,
    };
  });
  // #115: the WHY behind postings.read_failed / postings.read_timed_out. A separate route rather
  // than folded into /ops/counters above, which deliberately promises "numbers only, no PII" — but
  // unlike that route, this one CAN carry raw-ish upstream error text (a pg driver message, a
  // provider error), which is exactly the class of thing GUESTBOOK_KEY already exists to keep off an
  // open URL. Same contentKeyOk idiom, its own dedicated OPS_KEY rather than reusing GUESTBOOK_KEY —
  // a leaked ops-diagnostics key should not also unlock CV content, or vice versa. With no key set,
  // this refuses, same fail-closed default as the guestbook content routes.
  const opsKeyOk = (req: FastifyRequest) => {
    const key = process.env.OPS_KEY;
    return !!key && (req.query as { key?: string }).key === key;
  };
  app.get("/ops/read-failures", async (req, reply) => {
    if (!opsKeyOk(req))
      return reply.status(403).send({
        error: { code: "forbidden", message: "set OPS_KEY and pass ?key=… to read failure detail" },
      });
    return { entries: recentReadFailuresList() };
  });
  app.get(
    "/family-floors/:familyId/active",
    { schema: { params: z.object({ familyId: z.string().min(1) }) } },
    async (req, reply) => {
      const publication = productionFamilyFloors.active(req.params.familyId);
      if (!publication) {
        return reply.status(404).send({
          error: { code: "family_unavailable", message: "family unavailable" },
        });
      }
      return publication.floor;
    },
  );

  // Persistent scoreboard/debug trail of every onboarding run. Always open: rows carry no CV
  // content or contact info, only outcomes. (GUESTBOOK_KEY gates only the CV-content routes below.)
  app.get("/guestbook", async (_req, reply) => {
    try {
      const rows = await guestbook.list();
      reply.header("content-type", "text/html; charset=utf-8");
      return renderGuestbookHtml(rows);
    } catch (err) {
      return reply.status(503).send({
        error: { code: "guestbook_unavailable", message: err instanceof Error ? err.message : String(err) },
      });
    }
  });

  // CV content is personal data: the detail routes below expose the kept CV text, mined claims, and
  // original file, so they ALWAYS require GUESTBOOK_KEY to be set and matched (?key=…). With no key
  // set they refuse — PII is never served from an ungated URL, even though the scoreboard is open.
  const contentKeyOk = (req: FastifyRequest) => {
    const key = process.env.GUESTBOOK_KEY;
    return !!key && (req.query as { key?: string }).key === key;
  };
  const mimeByKind: Record<string, string> = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    txt: "text/plain; charset=utf-8",
  };

  app.get(
    "/guestbook/:id",
    { schema: { params: z.object({ id: z.coerce.number().int().positive() }) } },
    async (req, reply) => {
      if (!contentKeyOk(req))
        return reply.status(403).send({
          error: { code: "forbidden", message: "set GUESTBOOK_KEY and pass ?key=… to read CV data" },
        });
      const row = await guestbook.get(req.params.id);
      if (!row)
        return reply.status(404).send({ error: { code: "not_found", message: "unknown visit" } });
      return row;
    },
  );

  // Download the original uploaded file (kept in R2). Same key gate as the detail route.
  app.get(
    "/guestbook/:id/file",
    { schema: { params: z.object({ id: z.coerce.number().int().positive() }) } },
    async (req, reply) => {
      if (!contentKeyOk(req))
        return reply.status(403).send({
          error: { code: "forbidden", message: "set GUESTBOOK_KEY and pass ?key=… to download files" },
        });
      const row = await guestbook.get(req.params.id);
      if (!row?.uploadKey)
        return reply.status(404).send({ error: { code: "not_found", message: "no stored file for this visit" } });
      const data = await blobs.get(row.uploadKey);
      if (!data)
        return reply.status(404).send({ error: { code: "gone", message: "file no longer in storage" } });
      reply.header("content-type", mimeByKind[row.kind ?? "txt"] ?? "application/octet-stream");
      reply.header("content-disposition", `attachment; filename="cv-${row.id}.${row.kind ?? "bin"}"`);
      return data;
    },
  );

  app.register(sessionRoutes(sessions));

  // A completed upload starts the onboarding pipeline job (extract → mine → preview).
  // Every run leaves one durable line in the guestbook (recordVisit).
  const pipelineDeps: PipelineDeps = {
    ...(opts.pipeline ?? {}),
    recordVisit: opts.pipeline?.recordVisit ?? guestbook.record,
  };
  const defaultOnUploaded: NonNullable<UploadDeps["onUploaded"]> = async (row, data) => {
    if (!row.kind) return null;
    const job = await store.create("onboarding", row.sessionId);
    const session = await sessions.getById(row.sessionId);
    void runOnboardingJob(
      store,
      job.id,
      { type: "upload", data, kind: row.kind, key: row.id },
      session?.targetTitles ?? [],
      {
        ...pipelineDeps,
        persistImport: async (proof, importedClaims) => {
          const current = await sessions.getById(row.sessionId);
          const resolutions = current?.importResolutions ?? {};
          const identity = (claim: (typeof importedClaims)[number]) =>
            claim.field_key ?? claim.semantic_key;
          const stableClaims = [
            ...new Map(
              importedClaims.map((claim) => [
                identity(claim),
                {
                  ...claim,
                  id: identity(claim),
                  text: resolutions[identity(claim)] ?? claim.text,
                  field_value:
                    claim.field_key && resolutions[identity(claim)]
                      ? resolutions[identity(claim)]!
                      : claim.field_value,
                },
              ]),
            ).values(),
          ];
          await claims.seed(row.sessionId, stableClaims);
          for (const claim of stableClaims) {
            if (resolutions[identity(claim)] !== undefined) {
              await claims.add(row.sessionId, claim);
            }
          }
          const resolvedProof = {
            ...proof,
            representativeFacts: proof.representativeFacts.map((fact) => ({
              ...fact,
              text: resolutions[fact.id] ?? fact.text,
            })),
            conflict:
              proof.conflict && resolutions[proof.conflict.fieldId] === undefined
                ? proof.conflict
                : null,
          };
          await sessions.setImportProof(row.sessionId, resolvedProof);
          return resolvedProof;
        },
      },
    );
    return { jobId: job.id };
  };
  app.register(uploadRoutes({ uploads, blobs, onUploaded: opts.onUploaded ?? defaultOnUploaded }));
  app.register(cvRoutes({ store, pipeline: pipelineDeps }));
  app.register(onboardingRoutes({
    claims,
    store,
    sessions,
    familyFloors,
    productionFamilyFloors,
    placeFamily,
    phraseGrill: opts.phraseGrill,
    auditCv: opts.auditCv,
    readAd: opts.readAd,
    judge: opts.judge,
  }));
  app.register(authRoutes({ auth, sessions, mailer, webUrl: opts.webUrl, googleEmail: opts.googleEmail }));
  app.register(
    familyLearningRoutes({
      store: familyLearning,
      screen: opts.screenFamilyCandidate,
      operatorKey: opts.familyLearningOperatorKey,
      knownFamilies: opts.familyLearningKnownFamilies,
      notify:
        opts.notifyFamilyMatch ??
        (async (attempt, { idempotencyKey }) => {
          if (!mailer.live) throw new Error("family match notification provider unavailable");
          const session = await sessions.getById(attempt.sessionId);
          if (!session?.claimedByUserId) throw new Error("family learning session is unclaimed");
          const user = await auth.getUserById(session.claimedByUserId);
          if (!user) throw new Error("family learning user not found");
          await mailer.sendFamilyReady(user.email, attempt.targetRole, idempotencyKey);
        }),
    }),
  );

  // Job payloads sent to the client: the preview HTML travels only via GET /previews/:jobId
  // (in-app view), and jobs bound to a session are visible to that session alone.
  const clientView = (job: JobRecord) => {
    const { previewHtml: _previewHtml, miner: _miner, rawCv: _rawCv, ...progress } = job.progress;
    return { ...job, progress };
  };
  const canSee = (req: FastifyRequest, job: JobRecord) =>
    job.sessionId === null || job.sessionId === req.session?.id;

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
      if (!job || !canSee(req, job))
        return reply.status(404).send({ error: { code: "not_found", message: "unknown job" } });
      return clientView(job);
    },
  );

  // SSE progress stream. Emits one event per update; closes when the job reaches a terminal state.
  app.get(
    "/jobs/:id/events",
    { schema: { params: z.object({ id: z.string() }) } },
    async (req, reply) => {
      const job = await store.get(req.params.id);
      if (!job || !canSee(req, job))
        return reply.status(404).send({ error: { code: "not_found", message: "unknown job" } });

      reply.raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const send = (j: JobRecord) => reply.raw.write(`data: ${JSON.stringify(clientView(j))}\n\n`);
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

  return { app, store, sessions, blobs, uploads, claims, auth, familyLearning };
}
