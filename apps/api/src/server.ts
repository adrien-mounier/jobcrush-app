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
import { InMemorySessionStore, IpRateLimiter, type SessionRecord, type SessionStore } from "./sessions.js";
import { SESSION_COOKIE, sessionRoutes } from "./routes/sessions.js";
import { uploadRoutes, type UploadDeps } from "./routes/uploads.js";
import { InMemoryBlobStorage, type BlobStorage } from "./storage.js";
import { InMemoryUploadStore, REJECT_MESSAGES } from "./uploads.js";
import { runOnboardingJob, type PipelineDeps } from "./pipeline.js";
import { cvRoutes } from "./routes/cv.js";
import { onboardingRoutes } from "./routes/onboarding.js";
import { InMemoryClaimStore, type ClaimStore } from "./claims.js";
import { InMemoryJobBlockStore, type JobBlockStore } from "./jobBlockStore.js";
import { jobBlocksRoutes } from "./routes/jobBlocks.js";
import { InMemoryEligibilityStore, type EligibilityStore } from "./eligibility.js";
import { InMemoryContactStore, type ContactStore } from "./contact.js";
import { contactRoutes } from "./routes/contact.js";
import { reviewRoutes } from "./routes/review.js";
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
import { makeFamilyCandidateWatch } from "./familyCandidateIntake.js";
import {
  readCounters,
  readFailureAlarm,
  readTimeoutAlarm,
  recentReadFailuresList,
} from "./counters.js";
import {
  InMemoryUnmappedLabelStore,
  type UnmappedLabelStore,
} from "./unmappedLabels.js";
import type { Posting } from "./preview.js";
import type { AdRequirementsV1 } from "@jobcrush/contracts";
import { PLACEMENT_SCHEMA_VERSION } from "@jobcrush/contracts";
import type { JudgeFn, JudgePeekFn } from "./judge.js";
import { runWithVisitor } from "./llmVisitorContext.js";
import { InMemoryUsageLedgerStore, type UsageLedgerStore } from "./usageLedgerStore.js";
import { InMemoryPostingStore, type PostingStore } from "./postingStore.js";
import { InMemoryPasteRecordStore, type PasteRecordStore } from "./pasteRecordStore.js";
import { InMemoryTailorDraftStore, type TailorDraftStore } from "./tailorDraftStore.js";
import type { LlmClient } from "./llm.js";
import type { ReadPastedAdvert } from "./pastedAdvert.js";
import { makeBroughtJobs } from "./broughtJobs.js";
import type { EmployerLookup } from "./employerLookup.js";
import type { DocumentMaker } from "./documentMaker.js";
import { pasteRoutes } from "./routes/paste.js";
import { tailorRoutes } from "./routes/tailor.js";
import type { PostingRetrievalResultV1 } from "@jobcrush/contracts";
import type { RetrievalRequest } from "./postingRetrieval.js";
import { reconcileImport } from "./importReconciliation.js";
import { refreshWorkedYears } from "./yearsWorked.js";
import { publishedFamilies } from "./familyLabeler.js";
import { publishedIndustryVocabulary, type IndustryVocabulary } from "./industryVocabulary.js";

declare module "fastify" {
  interface FastifyRequest {
    session: SessionRecord | null;
  }
}

export interface BuildOptions {
  store?: JobStore;
  sessions?: SessionStore;
  /** Overrides sessionRoutes' own default IpRateLimiter (12/hour) — test-only in practice (main.ts
   *  never sets it). A real Playwright run mints many real anonymous sessions from one IP inside the
   *  default window; qa-main.ts passes a generous limiter here rather than raising the production
   *  default in sessions.ts. Absent → sessionRoutes' own default, unchanged for every other caller. */
  sessionRateLimiter?: IpRateLimiter;
  /** The same seam for authRoutes' own default (5 magic links / 15 min per IP) — test-only in
   *  practice, main.ts never sets it. #209: Tier 2 grew past four sign-ins in one run, so the whole
   *  gate started failing on a real product protection doing its job. qa-main.ts passes a generous
   *  limiter here rather than raising the production default in routes/auth.ts. Absent → authRoutes'
   *  own default, unchanged for every other caller. */
  authRateLimiter?: IpRateLimiter;
  blobs?: BlobStorage;
  uploads?: InMemoryUploadStore;
  /** LLM-backed pipeline steps (mine, preview). Absent steps are skipped — tests inject fakes. */
  pipeline?: PipelineDeps;
  onUploaded?: UploadDeps["onUploaded"];
  /** Persistent per-run guestbook. Defaults to Postgres via DATABASE_URL; no-op when unset. */
  guestbook?: Guestbook;
  /** JC-21 confirmed-claims store backing the onboarding deck. Postgres driver lands with JC-6/26. */
  claims?: ClaimStore;
  /** #161 durable job-record store (employer/title/start/end/kind, each with its own origin). */
  jobBlocks?: JobBlockStore;
  /** #106: the eligibility-fact store (#86 decisions 4+5) backing discovery's eligibility questions. */
  eligibility?: EligibilityStore;
  /** #190: the contact-fact store (phone/email + origin) backing the profile's contact block. */
  contact?: ContactStore;
  /** Deterministic, explicitly non-production floor catalog for #59 integration tests. */
  familyFloors?: TestFixtureFamilyFloorStore;
  productionFamilyFloors?: ProductionFamilyFloorStore;
  /** #281 — the published industry vocabulary, injected on exactly the same terms as
   *  productionFamilyFloors above. It matters that this is ONE object and not a second read off
   *  disk: it is both what the labeler places into and what the correction door checks against, and
   *  two independent publications would let the door refuse an industry the labeler had just
   *  stored. Absent → the shipped publication. */
  industryVocabulary?: IndustryVocabulary;
  placeFamily?: (session: Readonly<SessionRecord>) => Promise<import("@jobcrush/contracts").FamilyPlacement>;
  retrievePostings?: (input: RetrievalRequest) => Promise<PostingRetrievalResultV1>;
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
  /** #252 — the durable unmapped-label feed /ops/unmapped-labels reads. Production passes the SAME
   *  store instance that is wired into placeFamily/labelJobBlocks; a test that injects its own
   *  placement fake and wants to read the feed must do the same. */
  unmappedLabels?: UnmappedLabelStore;
  screenFamilyCandidate?: FamilyCandidateScreen;
  familyLearningOperatorKey?: string;
  familyLearningKnownFamilies?: Array<{ familyId: string; version: number }>;
  notifyFamilyMatch?: FamilyMatchNotifier;
  /** #104: reads an advert nobody hand-curated (fixture-only when absent — every pre-#104 test
   *  stays valid, and nothing here ever makes a live call unless main.ts wires the real reader). */
  readAd?: (posting: Posting) => Promise<AdRequirementsV1 | null>;
  /** #304: the paste door's "looking up the employer" step, cache-first and shared across everyone
   *  (employerLookup.ts). Absent — every test, and any deployment with no Anthropic key, which is
   *  main.ts's own condition for wiring it — means the step runs and says nothing, never that it is
   *  skipped or faked. */
  employerLookup?: EmployerLookup;
  /** #105: meaning-aware judging (deterministic tick when absent — every pre-#105 test stays valid,
   *  and nothing here ever makes a live judging call unless main.ts wires the real judge). */
  judge?: JudgeFn;
  /** #117 must-fix 1: a cache-only companion to `judge` (judge.ts's makeJudgePeek) — structurally
   *  incapable of spending, since it never receives an LlmClient. Absent → every card is treated as
   *  "not yet resolved for free" (every pre-must-fix-1 test stays valid). */
  judgePeek?: JudgePeekFn;
  /** #117 (coordinator review) — an override for DECK_JUDGE_MAX_CARDS, test-only in practice
   *  (main.ts never sets it). Lets a test construct a "candidate pool exceeds the paid-judging
   *  ceiling" scenario against the REAL posting pool rather than adding synthetic entries to
   *  data/sample-postings.json, which is live product data, not a fixture. */
  judgeMaxCards?: number;
  /** #118's durable usage ledger, read by /ops/spend below (#117 AC4/AC8). Absent (every test that
   *  doesn't wire one, local dev with no DATABASE_URL) defaults to a fresh, empty in-memory ledger —
   *  never throws, just reports zero spend. */
  usageLedger?: UsageLedgerStore;
  /** #303 — the provider-record store, now reachable from a ROUTE and not only from the retrieval
   *  seam: a pasted advert is written into it as an ordinary provider record and read back out of
   *  it by the job's own screen, because nothing can re-fetch it. Production passes the SAME
   *  instance makePostingRetriever was built with; absent → a fresh in-memory store, so a test that
   *  doesn't wire one still gets a working paste door with nothing shared. */
  postings?: PostingStore;
  /** #303 (#294 clause 11) — who pasted which advert, and when. First-write-wins, session-keyed,
   *  swept with the session. */
  pasteRecords?: PasteRecordStore;
  /** #303: reads the title/company/location/closing date out of one pasted advert. Absent → the
   *  paste door answers 503 rather than inventing a posting, the same rule readAd/judge follow:
   *  real model calls are wired in main.ts only, never defaulted here. */
  readPastedAdvert?: ReadPastedAdvert;
  /** #310 — the tailored-draft checkpoint, one row per (session, advert), swept with the session. */
  tailorDrafts?: TailorDraftStore;
  /** #310: the model client behind the CV brain's draft call. Absent → the draft door answers 503
   *  rather than inventing a CV — the readPastedAdvert rule; main.ts wires the metered real client,
   *  qa-main.ts its stage-aware fake, tests their own. */
  tailorLlm?: LlmClient;
  /** #312: makes the two-page PDF from the rendered draft — consumed by #313's approve route.
   *  Absent → that route answers 503 rather than inventing a document (the readPastedAdvert
   *  rule); main.ts wires the real browser (chrome-headless-shell in the API image), qa-main.ts
   *  and tests the stand-in, so CI never downloads a browser. */
  documentMaker?: DocumentMaker;
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
  const jobBlocks = opts.jobBlocks ?? new InMemoryJobBlockStore();
  const eligibility = opts.eligibility ?? new InMemoryEligibilityStore();
  const contact = opts.contact ?? new InMemoryContactStore();
  const familyFloors = opts.familyFloors ?? new TestFixtureFamilyFloorStore();
  const productionFamilyFloors =
    opts.productionFamilyFloors ?? initialProductionFamilyFloors();
  // Read once per server, not per request: the publication is a shipped file, so re-reading it
  // would buy nothing, and reading it at module load would turn a bad publication into an
  // import-time crash instead of a boot-time one.
  const industryVocabulary = opts.industryVocabulary ?? publishedIndustryVocabulary();
  const placeFamily =
    opts.placeFamily ??
    (async () => ({ schemaVersion: PLACEMENT_SCHEMA_VERSION, outcome: "unmapped" as const }));
  const auth = opts.auth ?? new InMemoryAuthStore();
  const mailer = opts.mailer ?? new DevMailer();
  const guestbook = opts.guestbook ?? createGuestbook(process.env.DATABASE_URL);
  const familyLearning = opts.familyLearning ?? new InMemoryFamilyLearningStore();
  const unmappedLabels = opts.unmappedLabels ?? new InMemoryUnmappedLabelStore();
  const usageLedger = opts.usageLedger ?? new InMemoryUsageLedgerStore();
  const postings = opts.postings ?? new InMemoryPostingStore();
  const pasteRecords = opts.pasteRecords ?? new InMemoryPasteRecordStore();
  const tailorDrafts = opts.tailorDrafts ?? new InMemoryTailorDraftStore();
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" }).withTypeProvider<ZodTypeProvider>();
  guestbook.init().catch((err) => app.log.error(err, "guestbook init failed"));
  familyLearning.init().catch((err) => app.log.error(err, "family learning init failed"));
  jobBlocks.init().catch((err) => app.log.error(err, "job block store init failed"));
  // #303: both are already init'd by main.ts in production (fail-fast, before serving). This is the
  // same best-effort init every store above gets, and it is what makes a test's own default
  // in-memory pair usable without each test remembering to call it.
  postings.init().catch((err) => app.log.error(err, "posting store init failed"));
  pasteRecords.init().catch((err) => app.log.error(err, "paste record store init failed"));
  tailorDrafts.init().catch((err) => app.log.error(err, "tailor draft store init failed"));
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
  // #220 AC7 — the words the closed vocabulary had no family for, as feed for #218's
  // vocabulary-growth process. Same OPS_KEY gate and same reasoning as /ops/read-failures above:
  // these entries carry visitor-typed / CV-read free text, which has no business on an open URL.
  // #252: read from the DURABLE store — the in-process buffer a deploy erased is gone.
  app.get("/ops/unmapped-labels", async (req, reply) => {
    if (!opsKeyOk(req))
      return reply.status(403).send({
        error: { code: "forbidden", message: "set OPS_KEY and pass ?key=… to read unmapped labels" },
      });
    // #253: the counts come with the entries — the owner's "is a run worth launching?" answer is
    // the waiting count and how many distinct roles it represents, not a list they have to tally.
    // ?waiting=1 is what a growth run reads: only the labels it still has to research. Without it
    // the entries are everything, harvested ones included — nothing is ever deleted.
    const unharvestedOnly = (req.query as { waiting?: string }).waiting === "1";
    const [entries, waiting] = await Promise.all([
      unmappedLabels.recent(undefined, unharvestedOnly),
      unmappedLabels.stats(),
    ]);
    return { entries, waiting };
  });
  // #253 — how a vocabulary-growth run closes out what it consumed: the waiting count drops to
  // zero, the entries stay readable with a harvest time on them. Nothing is deleted (owner decision
  // 2026-08-20). Repeating it marks nothing and returns 0, so a re-run cannot double-count.
  app.post("/ops/unmapped-labels/harvest", async (req, reply) => {
    if (!opsKeyOk(req))
      return reply.status(403).send({
        error: { code: "forbidden", message: "set OPS_KEY and pass ?key=… to mark labels harvested" },
      });
    const marked = await unmappedLabels.markHarvested();
    return { marked, waiting: await unmappedLabels.stats() };
  });
  // #117 AC4/AC6/AC8 — the ONE place cost-per-visitor and the deck's cold-fallback rate are reported
  // TOGETHER, from the same run — the ticket's own closing AC. Same OPS_KEY gate as /ops/read-failures
  // above, not the always-open /ops/counters below: ?visitorId= ties a dollar figure to a session
  // pseudonym, which is exactly the class of visitor-linked detail OPS_KEY/GUESTBOOK_KEY exist to
  // keep off an open URL, even though the figure itself is "just a number" (same reasoning
  // /ops/read-failures's own doc already gives for CAN-carry-sensitive-detail routes).
  app.get("/ops/spend", async (req, reply) => {
    if (!opsKeyOk(req))
      return reply.status(403).send({
        error: { code: "forbidden", message: "set OPS_KEY and pass ?key=… to read spend detail" },
      });
    // Same "no schema, plain query cast" idiom as opsKeyOk's own ?key= read just above (and
    // /ops/read-failures's route) — a declared zod querystring schema would silently STRIP ?key=
    // (not part of this route's own declared shape) before opsKeyOk ever saw it.
    const visitorId = (req.query as { visitorId?: string }).visitorId;
    const [totalCostUsd, costByStage] = await Promise.all([
      usageLedger.totalCostUsd(),
      usageLedger.costByStage(),
    ]);
    const visitorCostUsd = visitorId ? await usageLedger.costForVisitor(visitorId) : null;
    const counters = readCounters();
    const judged = counters["deck.cards_judged"];
    const pending = counters["deck.cards_pending"];
    const unscored = counters["deck.cards_unscored"];
    const estimated = counters["deck.cards_estimated"];
    const totalCards = judged + pending + unscored + estimated;
    return {
      totalCostUsd,
      costByStage,
      visitorCostUsd,
      deck: {
        cardsJudged: judged,
        cardsPending: pending,
        cardsUnscored: unscored,
        cardsEstimated: estimated,
        judgeBoundHit: counters["deck.judge_bound_hit"],
        // #117 AC6/must-fix D (coordinator review) — must be comparable against the owner's staging
        // measurement (9 of 15 cards falling back on a cold deck), which asked "of every card on the
        // deck, how many carry no honest judged number?" pending / (judged + pending) alone undercounts
        // this badly: on the expected cold-deck shape (~8 judged, ~7 unscored, ~0 pending) that ratio
        // reads ≈0% while roughly half the deck carries no number at all. The denominator is now
        // EVERY card rendered (all four states); the numerator is every card WITHOUT an honest judged
        // number — pending AND unscored, both. `estimated` is counted in the denominator (it is still
        // a card on the deck) but deliberately not in the numerator: that state only ever means "no
        // judge wired at all", a different regime from a judge-wired deck's fallback rate, and folding
        // it into "no number" here would conflate a deployment fact with a judging outcome.
        fallbackRatePerMille: totalCards > 0 ? Math.round(((pending + unscored) / totalCards) * 1000) : 0,
      },
    };
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

  app.register(sessionRoutes(sessions, opts.sessionRateLimiter));

  // A completed upload starts the onboarding pipeline job (extract → mine).
  // Every run leaves one durable line in the guestbook (recordVisit).
  const pipelineDeps: PipelineDeps = {
    ...(opts.pipeline ?? {}),
    recordVisit: opts.pipeline?.recordVisit ?? guestbook.record,
    // #270: bound here, for BOTH intake paths — a person who pastes their CV is not a different
    // kind of visitor. ADR-0002: a correction the person already made outranks whatever this re-read
    // found; the rule itself is importReconciliation.ts (pure, directly tested), this is its IO shell.
    persistImport:
      opts.pipeline?.persistImport ??
      (async (sessionId, proof, importedClaims) => {
        const current = await sessions.getById(sessionId);
        const reconciled = reconcileImport(proof, importedClaims, current?.importResolutions ?? {});
        await claims.seed(sessionId, reconciled.claims);
        for (const claim of reconciled.corrected) await claims.add(sessionId, claim);
        await sessions.setImportProof(sessionId, reconciled.proof);
        return reconciled.proof;
      }),
    // #190: shared by both the upload and paste pipeline entry points — sessionId travels as a
    // plain argument, not a per-request closure, so contact capture works uniformly on either path.
    persistContact:
      opts.pipeline?.persistContact ??
      (async (sessionId, extraction) => {
        if (extraction.phone) await contact.put(sessionId, "phone", { ...extraction.phone, origin: "read" });
        if (extraction.email) await contact.put(sessionId, "email", { ...extraction.email, origin: "read" });
        // #310: the CV's letterhead, kept for the draft door — the engine prints name/city from it.
        if (extraction.header)
          await contact.put(sessionId, "header", {
            value: extraction.header,
            origin: "read",
            sourceText: extraction.header,
          });
      }),
    // #161: shared by both intake paths, same convention as persistContact above — sessionId travels
    // as a plain argument so job-block capture works uniformly on either upload or paste.
    persistJobBlocks:
      opts.pipeline?.persistJobBlocks ??
      (async (sessionId, doc, rawOutput) => {
        await jobBlocks.ingest(sessionId, doc, rawOutput);
        // #162: the years-of-experience total is a regenerable copy of these records — re-derived at
        // every door that changes them, never asked for.
        await refreshWorkedYears(jobBlocks, eligibility, sessionId);
      }),
    recordJobBlocksFailed:
      opts.pipeline?.recordJobBlocksFailed ??
      (async (sessionId) => {
        await jobBlocks.recordFailedRun(sessionId);
      }),
  };
  const defaultOnUploaded: NonNullable<UploadDeps["onUploaded"]> = async (row, data) => {
    if (!row.kind) return null;
    const job = await store.create("onboarding", row.sessionId);
    void runOnboardingJob(
      store,
      job.id,
      { type: "upload", data, kind: row.kind, key: row.id },
      pipelineDeps,
    );
    return { jobId: job.id };
  };
  app.register(uploadRoutes({ uploads, blobs, onUploaded: opts.onUploaded ?? defaultOnUploaded }));
  app.register(cvRoutes({ store, pipeline: pipelineDeps, claims }));
  app.register(contactRoutes({ contact }));
  // #338: "Your CV, reviewed" — the screen between the last question and the jobs.
  app.register(reviewRoutes({ claims, sessions, jobBlocks, eligibility, contact }));
  // #221: the same production registry the labeler places against backs the review screen's choices
  // and the family-correction check — one closed vocabulary, read in one place.
  app.register(
    jobBlocksRoutes({
      jobBlocks,
      claims,
      eligibility,
      families: () => publishedFamilies(productionFamilyFloors),
      // #281: the same story for the second axis — the published industry vocabulary is what the
      // labeler places into AND what an industry correction is checked against. Read once at boot:
      // the publication is a shipped file, not a registry that grows mid-process.
      industries: () =>
        industryVocabulary
          .activeIndustries()
          .map(({ industryId, version, label }) => ({ industryId, version, label })),
      retryJobBlockLabels: pipelineDeps.labelJobBlocks,
      retryJobBlockIndustryLabels: pipelineDeps.labelJobBlockIndustries,
    }),
  );
  // #236: the screen judges a target role against the WHOLE published list, read fresh each call so
  // a family published mid-session is immediately recognisable. Explicit opts override for tests.
  const familyLearningKnownFamilies = () =>
    opts.familyLearningKnownFamilies ??
    publishedFamilies(productionFamilyFloors).map(({ familyId, version }) => ({ familyId, version }));
  app.register(onboardingRoutes({
    claims,
    store,
    sessions,
    eligibility,
    jobBlocks,
    contact,
    familyFloors,
    productionFamilyFloors,
    placeFamily,
    retrievePostings: opts.retrievePostings,
    phraseGrill: opts.phraseGrill,
    auditCv: opts.auditCv,
    readAd: opts.readAd,
    judge: opts.judge,
    judgePeek: opts.judgePeek,
    judgeMaxCards: opts.judgeMaxCards,
    retryJobBlockLabels: pipelineDeps.labelJobBlocks,
    // #305: the adverts this person pasted, read off the SAME two stores the paste door writes into —
    // the deck stitches them in on every rebuild because a pasted job has nobody to re-ask, and the
    // want/tailor doors resolve them for the same reason.
    broughtJobs: makeBroughtJobs({ postings, pasteRecords }),
    // #236: only wired when a real screen exists — absent, the word-search deck screens nothing,
    // exactly as before this ticket.
    watchFamilyCandidate: opts.screenFamilyCandidate
      ? makeFamilyCandidateWatch({
          store: familyLearning,
          screen: opts.screenFamilyCandidate,
          knownFamilies: familyLearningKnownFamilies,
          sessions,
          log: app.log,
        })
      : undefined,
  }));
  // #303: the paste door and the job's own screen. Its own plugin, not onboarding's — see the
  // file's header for why. It shares the deck's read/judge seams so a pasted job is read, scored and
  // checkpointed by exactly the code a fetched one is.
  app.register(
    pasteRoutes({
      postings,
      pasteRecords,
      readPastedAdvert: opts.readPastedAdvert,
      // #304: the paste door narrates over the SAME job/progress record the front door's CV read
      // uses, so the screen watches `GET /jobs/:id/events` and nothing new had to be built.
      jobs: store,
      employerLookup: opts.employerLookup,
      claims,
      eligibility,
      jobBlocks,
      placeFamily,
      readAd: opts.readAd,
      judge: opts.judge,
      judgePeek: opts.judgePeek,
    }),
  );
  // #307: the tailor step's own plugin — the spine's three tailor endpoints moved here, plus the
  // queue's permanent profile-answer door. Same shared read/judge seams as the deck and the paste
  // door, so a tailored job is resolved and scored by exactly the code the deck used to show it.
  app.register(
    tailorRoutes({
      claims,
      sessions,
      eligibility,
      jobBlocks,
      productionFamilyFloors,
      placeFamily,
      broughtJobs: makeBroughtJobs({ postings, pasteRecords }),
      readAd: opts.readAd,
      judge: opts.judge,
      // #310: the draft doors — the SAME job/progress store the front and paste doors narrate over,
      // the contact store whose corrected values win the render, and the checkpoint store above.
      jobs: store,
      contact,
      tailorDrafts,
      tailorLlm: opts.tailorLlm,
      // #313: the approve-is-send press — the account's email, the mail seam, and #312's
      // injected document maker (absent ⇒ the press answers 503, the readPastedAdvert rule).
      auth,
      mailer,
      documentMaker: opts.documentMaker,
    }),
  );
  app.register(authRoutes({ auth, sessions, mailer, webUrl: opts.webUrl, googleEmail: opts.googleEmail, limiter: opts.authRateLimiter }));
  app.register(
    familyLearningRoutes({
      store: familyLearning,
      screen: opts.screenFamilyCandidate,
      operatorKey: opts.familyLearningOperatorKey,
      knownFamilies: familyLearningKnownFamilies,
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

  // Job payloads sent to the client: the raw extracted CV and mined claims stay server-side,
  // and jobs bound to a session are visible to that session alone.
  const clientView = (job: JobRecord) => {
    const { miner: _miner, rawCv: _rawCv, ...progress } = job.progress;
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
        // `no-transform` is load-bearing, not belt-and-braces. Measured 2026-09-28 (#304): the web
        // app proxies /api/* through Next, Next compresses what it proxies when the browser asks
        // for gzip — and a compressed stream is BUFFERED until it closes. Every progress event of a
        // three-second read therefore arrived in one burst at the end, so the screen could only ever
        // show the final state however well the server narrated. curl hid it by not asking for gzip.
        // `no-transform` is the standard instruction to an intermediary to leave a body alone, and
        // `x-accel-buffering` is the same instruction for the nginx-family proxies in front of a
        // deploy. The front door's CV read rides this same stream and had the same defect.
        "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no",
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

  return { app, store, sessions, blobs, uploads, claims, eligibility, contact, auth, familyLearning, usageLedger, unmappedLabels };
}
