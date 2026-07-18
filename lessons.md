# Lessons — jobcrush-app

Non-obvious things worth remembering, so we don't relearn them the hard way.

## Check what already exists before assuming a ticket is greenfield

JC-32 read as "port `validate_graph.mjs` + build the graph". Half of it was already done: the oracle,
the `ClaimGraph` zod port, the schema JSON, and the goldens all landed back in S0/S1. The real gap was
just the **builder**. Grepping the contracts package first turned a "port + build" ticket into a
one-file build. Read the code the change touches before writing — the roadmap ticket describes intent,
not remaining work.

## The pipeline was designed forward-compatibly — trust it, but verify per-field

The S1 claim miner already emits `source_quote`, `machine_touch`, `classification`, `needs_grill` and
id-prefixes — everything S2's deck tiering + grill need. The forward-looking design from S1 paid off.
Still worth confirming field-by-field against the actual prompt (`claim-miner.md`) before building on
it, rather than trusting the roadmap's summary.

## Contracts must be built before vitest can resolve `@jobcrush/contracts`

Running `vitest run test/graph.test.ts` directly fails with "Failed to resolve entry for package
@jobcrush/contracts" — its `exports` point at `dist/`, which isn't built in a fresh worktree. Use
`pnpm test` (turbo builds workspace deps first) rather than raw vitest on a single file. Costs a few
seconds more but it's the same command CI runs.

## The graph validator checks structure, never richness — keep it that way

`validate_graph.mjs` validates node shape + conditional invariants only; it has no minimum-count or
"strong enough" rule. That is what lets decision #5 hold — the S2 gate judges our pipeline's work, not
the user's career, so any honest user (even a thin CV) can produce a validator-clean graph. Don't add
richness checks to the validator; profile-strength feedback belongs in the future advisory feature.

## UI changes can be self-verified in a real browser — don't stop at typecheck + build

The empty-body content-type bug (`jfetch` sent `content-type: application/json` on no-body POSTs, which
Fastify rejects with `FST_ERR_CTP_EMPTY_JSON_BODY`) passed typecheck **and** the Next build, then broke
upload on staging. Those gates never exercise the running client. **The Playwright e2e now closes that
gap** (`apps/web/e2e/onboarding.spec.ts`, `pnpm --filter @jobcrush/web e2e`) — and this environment can
run it end to end without a human: headless Chromium launches, outbound HTTPS works, and
`ANTHROPIC_API_KEY` is set, so the real pipeline runs. Two ways:

- **Local (tests the worktree code):** `node apps/api/dist/main.js` (API on :3001, inherits the key) +
  `next start apps/web -p 3000`, then run the e2e with the default `baseURL`. Use `curl --retry
  --retry-connrefused` for readiness — foreground `sleep` is blocked in this harness.
- **Staging (tests the deployed sha):** `E2E_BASE_URL=https://jobcrush-web-staging.fly.dev`. But it only
  reflects what's pushed — `data-testid`s or fixes still in the worktree won't be there yet.

So after a UI change, run the e2e before claiming it works — "I can't drive a browser" is no longer true.

## Every client page that hits the API must self-ensure the session

`/import` called `uploadCv` without `ensureSession()` — it only worked because the landing page creates
the session before routing there, so a direct visit / refresh 401'd on `POST /uploads`. Pages must
`ensureSession()` themselves (as `/paste` does), never assume a referrer did it. Same shape as the
empty-body content-type bug: both passed typecheck + build and broke only on an entry path the happy
flow never walked — the exact blind spot the browser e2e exists to cover. When adding a page or an
API-calling flow, check it works reached cold (deep link / refresh), not just via the one nav that
precedes it in the demo.

## Check what the upstream stage already computes before building detection logic

JC-24's gap detection first looked like fresh work (regex for missing metrics, matching roles to find
undated ones). But the miner already flags every gap: `claim-miner.md` rule 4 sets `needs_grill` + a
`grill_hint` whenever a role lacks dates, a bullet lacks a metric, scope is absent, or a claim was
inferred — and `MinedRole.dates_missing` is the authoritative per-role date signal. Reading the miner
prompt first turned brittle re-derivation into "filter on `needs_grill`, type by `dates_missing`".
Before writing detection or validation over a pipeline stage's output, read the stage that produced it
— the signal you need is often already computed upstream. (Same lesson shape as JC-32: the contract
layer was already built.)

## Adding a server-side gate ripples to every test that used the gated routes

E2's wall (`requireUser` on deck/grill/build) instantly 401'd every onboarding + grill API test — they
built anonymous sessions the routes no longer accept. The fix wasn't editing each test one by one: it
was folding the new precondition (a magic-link login) into the ONE shared `startSession` helper each
file already used, so every test upgraded at once. When you gate shared routes with a new precondition,
update the shared test setup, not the call sites — and it doubles as a real end-to-end exercise of the
new login path on every run. (pg-mem earned its keep again here too: it caught nothing new, but running
the auth store's SQL — single-use UPDATE…RETURNING, ON CONFLICT upsert — in CI is why staging wasn't
the first place the queries ran.)
