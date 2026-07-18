// Production/dev entrypoint: local-disk blobs (R2 driver lands with JC-6 accounts) and the
// real LLM-backed pipeline steps (mine + preview). Tests build their own server with fakes.
import { join } from "node:path";
import { buildServer } from "./server.js";
import { storageFromEnv } from "./storage.js";
import { llmFromEnv } from "./llm.js";
import { makeMineStep } from "./miner.js";
import { makePreviewStep } from "./preview.js";
import { makeGrillPhraser } from "./grill.js";
import { makeCvAuditor } from "./audit.js";
import { sessionStoreFromEnv } from "./sessions.js";
import { claimStoreFromEnv } from "./claims.js";
import { authStoreFromEnv } from "./auth.js";
import { mailerFromEnv } from "./mailer.js";
import { runPurge } from "./purge.js";
import { getPool } from "./db.js";

const llm = llmFromEnv();

// JC-6 persistence: Postgres when DATABASE_URL is set (survives restart — accounts + claim graph),
// in-memory otherwise. Init (create tables) before serving; fail fast if the DB is unreachable.
const sessions = sessionStoreFromEnv(process.env.DATABASE_URL);
const claims = claimStoreFromEnv(process.env.DATABASE_URL);
const auth = authStoreFromEnv(process.env.DATABASE_URL);
try {
  await sessions.init();
  await claims.init();
  await auth.init();
} catch (err) {
  console.error("store init failed", err);
  process.exit(1);
}

const { app } = buildServer({
  sessions,
  claims,
  auth,
  mailer: mailerFromEnv(),
  webUrl: process.env.WEB_URL,
  blobs: storageFromEnv(process.env.UPLOAD_DIR ?? join(process.cwd(), "data", "uploads")),
  pipeline: { mine: makeMineStep(llm), preview: makePreviewStep(llm) },
  phraseGrill: makeGrillPhraser(llm),
  auditCv: makeCvAuditor(llm),
});

// JC-20 purge: sweep unclaimed anonymous sessions/claims + spent tokens on boot and every 6h
// (Postgres only — in-memory data is wiped on restart).
if (process.env.DATABASE_URL) {
  const pool = getPool(process.env.DATABASE_URL);
  const sweep = () => void runPurge(pool).catch((err) => app.log.error(err, "purge failed"));
  sweep();
  setInterval(sweep, 6 * 60 * 60 * 1000).unref();
}

const port = Number(process.env.PORT ?? 3001);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
