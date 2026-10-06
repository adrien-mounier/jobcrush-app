import { defineConfig } from "@playwright/test";

// One end-to-end onboarding smoke over a real browser. It drives the true pipeline (real LLM), so
// runs are slow and non-deterministic — assertions are structural, not on exact claim text.
//
// Three ways to run:
//   - local (default, E2E_BASE_URL unset): Playwright starts the fake-model API (qa-main.js, needs
//     `pnpm --filter @jobcrush/api build` first) and a built web app on private ports, and stops both
//     when the run ends. Never main.js: it caps anonymous sessions at 12/hour and a run blows
//     through that with failures that look unrelated. A busy port fails loudly rather than
//     silently reusing a stranger's server (vitacairn shares this machine).
//   - CI: starts its own stack and sets E2E_BASE_URL (ci.yml).
//   - staging / real model: E2E_BASE_URL=https://jobcrush-web-staging.fly.dev pnpm --filter @jobcrush/web e2e
const LOCAL_WEB = "http://127.0.0.1:34100";
const LOCAL_API = "http://127.0.0.1:34101";
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
    baseURL: process.env.E2E_BASE_URL ?? LOCAL_WEB,
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: "node ../api/dist/qa-main.js",
          // /qa/llm-calls exists only on qa-main — proves the fake answered, not a real API.
          url: `${LOCAL_API}/qa/llm-calls`,
          env: { PORT: new URL(LOCAL_API).port, OPS_KEY: "qa-ops-key" },
          reuseExistingServer: false,
        },
        {
          // A production build, as ci.yml runs it: under `next dev` two specs fail that pass on a
          // build (#311 tailor 'No change', wall resume — measured 2026-10-06).
          command: `npx next build && npx next start -p ${new URL(LOCAL_WEB).port}`,
          url: LOCAL_WEB,
          env: { API_URL: LOCAL_API },
          reuseExistingServer: false,
          timeout: 300_000,
        },
      ],
});
