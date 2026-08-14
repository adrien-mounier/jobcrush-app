// #220: the deliberate-eval lane. Kept OUT of the fast lane on purpose — every case here is a real
// model call (ADR-0014 decision 6's measurement grid), so it must never run on a push. The default
// `vitest run` picks up *.test.ts only, so nothing under eval/ is collected there; this config is
// how you ask for it: `pnpm --filter @jobcrush/api eval:labeler`.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["eval/**/*.eval.ts"] },
});
