# Lessons — jobcrush-app

Non-obvious things worth remembering, so we don't relearn them the hard way.

## On a copy ticket, most of the hard calls are inherited constraints, not taste

The front-door ticket looked like pure wordsmithing. It wasn't: three of the four hardest calls were
already decided elsewhere, by people (us) who never propagated the consequence to the words. The door
**cannot say "5 questions" or "takes two minutes"** — §6 replaced the flat pace with a variable-length
discovery, so both are promises we'd be caught breaking. It **cannot say "free" or "no signup"** — §12
walls after the reveal, so "free" invites *why?* and "no signup" plants a word the visitor wasn't
thinking. And the CV shortcut **cannot say just "skip ahead"** — §11 says a CV buys one jump and does
*not* end the game, so the honest line is "skip the questions it already answers". Every one of those
reads as a style choice and is actually a correctness constraint, enforced nowhere. So: **before
drafting any user-facing words, re-read the decision log for what those words are no longer allowed to
claim** — the constraint is never in the copy ticket, it's in a section three chapters away that
changed after the copy was scoped. Same shape as the CV-brain rule: the reasoning doc is the contract,
the surface has to stay true to it. Record: `docs/onboarding-reward-design.md` §10.1, wayfinder
ticket #7.

## Prototype the screen before trusting the flow you designed on paper

The reward structure was grilled to 13 locked decisions over two sessions, all of them defensible on
paper. Building one throwaway HTML mock broke three of them inside an hour — the flat "5 questions → 3
cards" pace, the countdown copy, and "three cards re-score live" — because the paper design never
noticed that **during the first questions there are no cards on screen at all**. Nothing to re-score,
nothing to count down to. One screen turned out to be three, with different jobs. The tell was needing
content for a screen and finding none: if you cannot populate a mock without inventing a mechanism,
the design has a hole. A second thing fell out of the same build — the card's *weak fits* became the
next screen's questions, which no amount of arguing would have produced. **Prototype before `/to-spec`,
not after.** Record: `docs/onboarding-reward-design.md` ("The shape"), wayfinder ticket #8.

## A number on a person and a number on a job are different objects, at identical maths

"This job: 34%" is useful — skip it. "Your profile: 34%" tells a human being, in their first minute,
that they are poor, and they close the tab. Same arithmetic, opposite outcome, and reframing does not
save it: we designed a "fuel gauge, not a grade" level meter (low = early, not bad) and a council pass
killed it anyway — users read any digit next to their own name as a verdict, whatever the label says.
The escape is not a gentler number, it's **no number**: a countdown to the next reward ("3 answers
until your next jobs") does the same motivational work with nothing to be graded by, and the
progression moves onto counters that only ever go up (lines in your document, jobs you own, a job's %
climbing as you answer). Applies anywhere we're tempted to score the user rather than our own work —
the same line the S2 quality gate already draws. Full design:
[`docs/onboarding-reward-design.md`](docs/onboarding-reward-design.md) §7-8.

## A magic link is opened in a different browser than it was requested from — plan for it

The mail-app in-app webview (Gmail/Outlook on mobile) is a *separate cookie jar and localStorage* from
the browser the user requested the link in. So anything the sign-in flow relied on from the requesting
tab — the session cookie, a stashed jobId — is simply absent when the link opens. The trap here was
double: our onboarding job + claims are anchored to the anonymous **session** (`job.sessionId`), and
verify claimed *the opener's* session, so a cross-browser open couldn't reach the deck even if it
resumed. Fix pattern: carry the requesting session id on the token and claim **that** session on
verify (then re-home the opener's cookie onto it), and put any needed routing ids **in the link URL**,
never only in localStorage. OAuth is exempt — it's a full-page redirect, so it always returns to the
same browser. Applies to any future emailed/SMS deep link that resumes server-anchored state.

## API routes the browser reaches through the /api proxy must redirect with RELATIVE paths

The browser navigates to `<web-origin>/api/auth/google`; Next proxies it server-side, so the 302 the
API returns is seen *on the web origin* — a relative `Location: /signup?...` lands exactly where it
should in every environment. The first OAuth cut built absolute URLs from `WEB_URL` with a
`localhost:3000` fallback, which bounced real staging users to localhost the moment the env var was
missing (`058a2ad` fixed it). Only values sent to *third parties* (Google's `redirect_uri`) genuinely
need the absolute `WEB_URL`. Applies to any future browser-facing redirect route (payment returns,
share links).

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

## Staging ops: the `!` prompt runs bash, Resend caps free domains, and `--stage` batches restarts

Three things learned wiring real email onto Fly staging:

- **The interactive `!` prompt runs bash, not PowerShell.** A PowerShell call `& "$HOME\.fly\bin\flyctl.exe" …`
  pasted into `!` dies with `syntax error near unexpected token '&'` and does nothing. Give the user
  either the **bash form** (`~/.fly/bin/flyctl.exe secrets set …`, no `&`) for the `!` prompt, or tell
  them to open their **own** PowerShell window for the `&` form. Corollary: the `!` prompt **echoes its
  input into the transcript**, so never route a secret through it — have the user set secret values from
  their own terminal.
- **Resend's free tier verifies exactly ONE sending domain per account.** A second product's domain hits
  a $20/mo Pro-plan wall in the same account. Workaround with zero code change: a **second free Resend
  account** (Gmail plus-addressing — `you+jobcrush@gmail.com` — counts as distinct), verify the domain
  there, use that account's API key. Bonus: separate 3k/mo quotas. The catch to remember: the API key on
  staging must come from **the account that owns the verified domain**, or `MAIL_FROM=@thatdomain` sends
  fail silently. And a custom domain is unavoidable for emailing arbitrary users — every provider
  requires you to verify a domain you own (test senders like `onboarding@resend.dev` only reach the
  account owner).
- **`flyctl secrets set --stage` parks a value without restarting.** Stage all the non-secret config
  (`WEB_URL`, `MAIL_FROM`), then one real `secrets set` (of the secret) applies everything in a single
  rolling restart instead of one restart per value — and lets the user run only the secret-bearing
  command themselves.

## Adding a server-side gate ripples to every test that used the gated routes

E2's wall (`requireUser` on deck/grill/build) instantly 401'd every onboarding + grill API test — they
built anonymous sessions the routes no longer accept. The fix wasn't editing each test one by one: it
was folding the new precondition (a magic-link login) into the ONE shared `startSession` helper each
file already used, so every test upgraded at once. When you gate shared routes with a new precondition,
update the shared test setup, not the call sites — and it doubles as a real end-to-end exercise of the
new login path on every run. (pg-mem earned its keep again here too: it caught nothing new, but running
the auth store's SQL — single-use UPDATE…RETURNING, ON CONFLICT upsert — in CI is why staging wasn't
the first place the queries ran.)
