import { defineConfig } from "@playwright/test";

// One end-to-end onboarding smoke over a real browser. It drives the true pipeline (real LLM), so
// runs are slow and non-deterministic — assertions are structural, not on exact claim text.
//
// Point it at a running stack via E2E_BASE_URL. Two ways to run:
//   - staging:  E2E_BASE_URL=https://jobcrush-web-staging.fly.dev pnpm --filter @jobcrush/web e2e
//   - local:    ANTHROPIC_API_KEY=… node apps/api/dist/main.js   (API on :3001, needs the key)
//               pnpm --filter @jobcrush/web dev                  (web on :3000)
//               pnpm --filter @jobcrush/web e2e
export default defineConfig({
  testDir: "./e2e",
  timeout: 300_000, // paste → mine → preview → deck → build (now with the audit) + a review-fix rebuild, all on the real model
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
  },
});
