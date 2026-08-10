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
  // A stray test.only left in any spec would otherwise make the CI gate run just that one test,
  // exit 0, and ship — forbidOnly turns that into a hard failure, in CI only (a local test.only
  // while iterating is still fine).
  forbidOnly: !!process.env.CI,
  // Different spec files run in separate workers by default; all of them share ONE in-memory
  // qa-main.ts process (sessions, family-learning store, rate limiter, …), so parallel workers race
  // on that shared server state. Pinned to 1 in CI — a deploy gate that's flaky is worse than one
  // that's merely slow. Local iteration keeps the default (parallel, fast).
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
