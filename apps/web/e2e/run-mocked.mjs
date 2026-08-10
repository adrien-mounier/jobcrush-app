// Tier 1 gate file list, computed at run time — not a hand-typed list in package.json — so a new
// route-mocked spec is automatically included and a rename can't silently shrink the gate (found in
// review while wiring E2E into CI). Excludes only onboarding.spec.ts, the one spec that drives the
// real paid model and must never run in CI.
//
// A tiny Node script rather than shell globbing ($(ls e2e/*.spec.ts | grep -v …)) so `pnpm
// e2e:mocked` behaves the same on Windows (PowerShell/cmd, no $(...) support) and in CI — no new
// dependency, no shell-specific syntax.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const e2eDir = fileURLToPath(new URL("./", import.meta.url));

const files = readdirSync(e2eDir)
  .filter((f) => f.endsWith(".spec.ts") && f !== "onboarding.spec.ts")
  .sort()
  .map((f) => `e2e/${f}`);

if (files.length === 0) {
  console.error("run-mocked.mjs: no route-mocked spec files found in e2e/ — refusing to run playwright with no args (that would run EVERYTHING, including onboarding.spec.ts)");
  process.exit(1);
}

// Node ≥18.20 refuses .cmd/.bat with shell:false (CVE-2024-27980) — same reasoning as llm.ts's
// ClaudeCliLlm. Args are static file paths, so shell:true for the Windows npx.cmd shim is
// injection-safe.
const result = spawnSync("npx", ["playwright", "test", ...files], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
