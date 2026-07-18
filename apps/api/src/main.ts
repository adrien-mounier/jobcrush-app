// Production/dev entrypoint: local-disk blobs (R2 driver lands with JC-6 accounts) and the
// real LLM-backed pipeline steps (mine + preview). Tests build their own server with fakes.
import { join } from "node:path";
import { buildServer } from "./server.js";
import { storageFromEnv } from "./storage.js";
import { llmFromEnv } from "./llm.js";
import { makeMineStep } from "./miner.js";
import { makePreviewStep } from "./preview.js";
import { makeGrillPhraser } from "./grill.js";

const llm = llmFromEnv();
const { app } = buildServer({
  blobs: storageFromEnv(process.env.UPLOAD_DIR ?? join(process.cwd(), "data", "uploads")),
  pipeline: { mine: makeMineStep(llm), preview: makePreviewStep(llm) },
  phraseGrill: makeGrillPhraser(llm),
});

const port = Number(process.env.PORT ?? 3001);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
