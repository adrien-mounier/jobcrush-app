# S1 "magic mirror" — local runbook

The S1 slice end to end: anonymous session → CV upload (or paste) → extract → claim-mine →
tailored, watermarked 1-page preview. Everything below runs locally; the staging deploy is
still gated on the JC-6 accounts (`docs/deploy.md`).

## Run it

```sh
pnpm install && pnpm build

# terminal 1 — API on :3001 (needs an LLM: ANTHROPIC_API_KEY, or the local Claude Code CLI)
cd apps/api && node dist/main.js

# terminal 2 — web on :3000 (proxies /api/* to the API; no CORS)
cd apps/web && pnpm start        # or: pnpm dev
```

Open http://localhost:3000 — pick target titles → upload a CV (fixtures in
`apps/api/test/fixtures/`) → watch the live feed → preview.

## Smoke + timing

```sh
node scripts/s1-smoke.mjs        # drives the whole flow over HTTP, prints upload→preview time
```

Measured 2026-07-17 (live sonnet, clean.pdf fixture): **60.6 s upload→preview** against the
120 s p50 budget. The staging timing log (7-day p50, JC-15 AC) starts once staging exists.

## Miner eval

```sh
cd apps/api
pnpm vitest run test/eval        # CI mode: replays committed recordings, asserts tiers + budget
$env:RECORD_MINER='1'; pnpm vitest run test/eval   # re-record after any prompt change
```

The 5 current cases are synthetic. **JC-13/JC-16 sign-off vs the JC-2 quality bar still needs
the 5 real CVs** (user action) — add them as cases + expectations in `test/eval/cases.json`,
record, and run the blind-rating protocol from `docs/spikes/jc2-preview-quality.md`.

## S1 exit review status (see JobCrush `docs/s1-kickoff.md`)

- [x] Flow runs end to end; p50 ≤ 2 min locally (staging 7-day log pending accounts)
- [x] JC-13 eval ≥ 90 % in CI; miner prompt version-controlled (`apps/api/prompts/`)
- [x] No server-side export path for unverified CVs (asserted against the route table in
      `apps/api/test/preview.test.ts`)
- [ ] Five strangers ran it → `docs/spikes/s1-tester-notes.md` (needs staging + testers)
- [x] Hostile-layout and scanned-PDF fixtures behave (fallback, never garbage output)
