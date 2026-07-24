# Lessons — jobcrush-app

Non-obvious things worth remembering, so we don't relearn them the hard way.

## A future screen can be unblocked by a durable handoff, not a full route

In S25, #21 looked blocked-in-practice because its "swipe right advances to Tailor" AC pointed at
the still-open #23 Tailor screen. The workable slice in S26 was narrower and better: #21 persists the
selected `adId` server-side (`stage="tailor"`, `tailorAdId`) and shows an in-deck Tailor handoff,
while #23 owns the real Tailor UI that consumes that stored target. Before deferring a ticket for a
missing downstream screen, check whether the AC needs the downstream feature itself or just a durable
state transition plus a non-dead-end handoff.

## A ticket can be GitHub-"unblocked" (`blocked_by:0`) yet practically blocked by a missing nav target

When picking the frontier, GitHub's dependency graph only knows the edges someone drew. In S25, #17
(profile badge) and #21 (swipe the deck) both showed `blocked_by:0`, but their ACs point at screens
another, still-blocked ticket owns: #17's badge "tap-opens the full profile as its own screen" (=
`/profile`, built by the native-blocked #20), and #21's swipe-right "advances to Tailor" (= the
native-blocked #23). Building either now wires a real user action to a 404. **Before claiming a
frontier ticket, read its ACs for a route/screen/stage another ticket owns — if that owner is open,
the ticket is blocked-in-practice regardless of the `blocked_by` count.** Cross-checking the actual
routes (`find apps/web/app -name page.tsx`; grep the target stage) takes a minute and saves a
dead-end build.

## Return-path markers in localStorage must be one-shot, and a specific intent must beat a generic one

#22's wall stashed `jc_return="/deck"` before opening a sign-in door, consumed in `/auth/verify`'s
`resume()`. The review-caught bug: it was written **eagerly** but only cleared **on consumption**, so
an **abandoned** wall visit left `/deck` behind, and a **later, unrelated** S2 sign-in (which carries
its own `?job=`) found the stale marker — `router.replace("/deck")` hijacked the job-scoped resume.
Two lessons for any cross-flow return marker: (1) **consume it one-shot** — read-and-remove at the top
of the resume handler so it can never survive to a later sign-in; (2) **order by specificity** — a
job-/context-scoped intent (`?job=`, `jc_job`) must be checked *before* the generic stash, and (3)
guard `router.replace(x)` on a stored value to internal paths (`x.startsWith("/") && !x.startsWith("//")`)
so a stray value can't become an open redirect.

## Run the app for a live e2e/QA drive without ts-node or Postgres — build to `dist` + in-memory store

The `apps/api` `dev` script needs `ts-node`, which isn't installed in the worktree, so agents keep
concluding "the app can't run here" and fall back to trace-only verification. It **can** run: `pnpm
--filter @jobcrush/api build`, then `node apps/api/dist/main.js` with **no `DATABASE_URL` and no
`ANTHROPIC_API_KEY`** — it falls back to the in-memory session/claim store and the no-LLM path, which
is all the discovery → cards → deck flow needs (it's pure and deterministic). For the web side, build
and run **`next start`, not `next dev`** (use an alternate port if 3000 is taken by another app on the
machine): the `next dev` error/overlay (`<nextjs-portal>`) sits on top of the page and **intercepts
clicks on bottom-docked buttons**, producing false Playwright failures that look like real defects.
That combination is the recipe for a genuine live e2e/QA drive — used in S24 to GO/NO-GO #19 + #24.

## A code trace can't be trusted for `.focus()` timing on a conditionally-mounted element — verify live

#24's bare-"no" focus bug was `fixNoticeButtonRef.current?.focus()` called **synchronously** while the
notice that mounts that button was **not rendered** (it only renders when `correcting` is null, and the
call happened before the re-render), so the ref was `null` and `.focus()` **silently no-op'd**. It
survived *two* code traces — the dev's and an orchestrator review — both of which reasoned "the element
is present and enabled at call time," which is exactly the claim that is false when the element's render
is conditional on the very state transition you're reacting to. Only the live QA run (a real browser
asserting `toBeFocused()`) caught it. Rule: for focus/mount-timing on conditionally-rendered elements,
**defer `.focus()` to a post-render effect** keyed on a flag (mirror the working sibling path) so it
fires once the target has actually mounted — and **prove it with a live run, never a trace**.

## New data fixtures under `apps/api/data/` are gitignored — `git add -f` them or CI goes red on a fresh checkout

`.gitignore` has a blanket `data/` rule, so a hand-authored fixture placed in `apps/api/data/` (e.g. #12's
`sample-family-floors.json` / `sample-ad-requirements.json`) is **silently untracked** — a plain `git add` /
`git add -A` skips it with no error. It works locally (the file is in your working tree), but CI checks out
**tracked files only**, so any provider that `readFileSync`s that fixture throws ENOENT and `pnpm test` goes
**red on a fresh checkout** — which, with auto-deploy on green, means a broken staging. The precedent was
already there and easy to miss: `apps/api/data/sample-postings.json` is force-added past the same rule. **Any
new file under `data/` must be `git add -f`'d** — and confirm with `git status --ignored` / `git check-ignore
<path>` before committing. General rule: when code reads a data file at runtime, verify the file is actually
**tracked**, not merely present in your working copy.

## A "gate" in a design doc often gates one small parameter, not the whole build

§3's reversal condition read like it blocked building the app: "if v1 cards aren't better than a
LinkedIn search, move the wall before the reveal." Taken at face value it says *don't build until the
cards are proven good*. But tracing what it actually controls, it only sets **one** thing — where the
signup wall sits — which was already a deferred, post-launch-reversible choice. The build never
depended on it. **Before letting a stated condition block work, ask precisely what decision it
changes; a scary-sounding gate frequently turns out to gate a single late-bound knob.** Here the
deeper reason it doesn't gate the build is architectural: CV-tailoring quality lives in prompts +
`preview.ts` behind the `llm.ts` seam and a versioned card contract (`cv-quality-kickoff.md` §7 tunes
it by changing a prompt, never a screen), so quality improves later without moving the UI. When the
output contract is stable, "make the output better" and "build the thing that shows the output" are
independent tracks — don't serialise them.

## A phone-emulation Playwright pass silently skips every hover/desktop path

The whole prototype-pressing habit runs on `devices["iPhone 13"]`, which reports `(hover: none)` and
`(pointer: coarse)`. Any behaviour gated behind `matchMedia("(hover: hover) and (pointer: fine)")` —
desktop hover, cursor changes, mouse-only affordances — **never executes**, so the mobile pass goes
green while that code has never once run. Session 18 shipped a canvas hover feature that was completely
untested until a second Playwright context at `viewport: 1280×1000` was added; that desktop pass
immediately caught a count mismatch (a badge reading 54 while the page it opened read 47) and a latent
`TONE.you is undefined` throw on the ignite path. **The rule: if a prototype has a real desktop
interaction, one green mobile pass is not coverage — add a `(hover: hover)` context.** A cheap
prototype hook (`window.__sky = sky`) lets the pass assert internal hover state directly instead of
guessing from pixels.

## Removing a state from one view means auditing every count that still includes it

Dropping the "no" facts from the profile *display* was one filter (`shown()`), but the badge count,
the constellation's node sizing, and the `+fact` counter each derived their own number straight from
`S.facts`. The badge kept counting the hidden "no"s and read 54 while the screen it opened said 47.
**When a class of item stops being shown, grep every place that counts or measures the collection —
a hidden item that still inflates a visible number is a lie the user can catch.** One source of truth
for "what the screen shows" (here, a single `shown()` helper used by badge, header, sky and Sorted)
is what stops the counts from disagreeing.

## An assertion in a design doc is not a fact about the code — check the spine

`onboarding-reward-design.md` §6.2 stated "the claim graph records it" about a user's "no". It did not:
`graph.ts` hardcodes `renderable:true` with no `Negative` path, the miner can't emit one, and
`detectGaps()` re-derives gaps from the *confirmed* set so an unrecorded "no" gets re-asked forever.
The design had quietly assumed a write path that was never built. **When a design doc asserts runtime
behaviour ("we store X", "we never re-ask Y"), trace it to the code before repeating it — a plausible
sentence in a spec is the easiest kind of bug to inherit.** The contract already supported the fix
(`Negative` is valid, `gate.ts` blocks `renderable:false`); only the write path was missing.

## One renderer mounted in two places: style the output, not the mount

`cardInner()` produced the same card markup for the deck (inside `.jobcard`) and for the live screen
(inside `.live-card`). The CSS said `.jobcard h2 { font-size: 18.5px }`. On the live screen that
selector simply did not match, so the title silently fell back to the browser default `h2` — 2em bold
— and ate half the phone. **Nothing errors, nothing warns; it just looks wrong somewhere you were not
looking.** The rule: the moment a render function is called from a second container, its styles must
key off something the *function itself* emits, not off whichever box it happens to land in
(`.jcbody h2, .live-card h2`, or better, a class the renderer writes). Same trap for anything targeted
by position — the first version highlighted the row that had changed via
`querySelectorAll(".req")[index]`, which quietly broke whenever the list was re-sorted; a `data-req`
attribute written by the renderer survives every reordering.

**And a derived count that mixes states will lie.** The card's header read *"what they ask for: 7 of
7"* for a user who had answered *never* twice, because the count was `total − open` and a settled "no"
is neither met nor open. Any *"N of M"* over items with more than two states needs to name which state
it counts — and the honest reading here was the one that made the design better: fits are one number,
things still open are another, and they move in opposite directions.

Both were found by driving the prototype with Playwright at `isMobile`, not by reading it — see the
layout-shift lesson below, which is the same argument for a different bug class.

## A discriminator is not a floor — they are made of opposite material

A ticket was written on the belief that `docs/cv-brain/tailoring-reasoning.md` §4 already held a
hand-written family floor for PM/PO/PdM, and its whole stopping rule was built on top of that. It does
not. §4 is a **discriminator**: you tally its signals to decide whether a CV should speak Project
Manager, Product Owner or Product Manager. It opens with a **"shared baseline (ignore — too generic to
discriminate)"** list — budget, user stories, stakeholder management, requirements gathering, agile
familiarity. Those are precisely the things a floor is made of. **A discriminator keeps what separates
the families and throws away what they share; a floor keeps what they share and ignores what
separates them.** §4 discards "budget" *because* every PM ad asks for it, and budget is exactly what a
PM CV cannot be missing. The two lists are near-complements, which is why one reads convincingly as the
other at a glance — same domain, same vocabulary, same shape on the page. The tell: a floor is a
checklist you could tick off; a discriminator is a tally you compare. **Before building on a document
someone cites by section number, open it and read its heading** — §4's is *"Decision rules (which role
language the CV adopts)"*, and that sentence alone settles it. Cost of not checking: a stopping rule
that terminates on a list that was never meant to terminate.

**And when you disprove a belief, `grep` for it — do not just fix where you tripped over it.** This one
had been copied into five places across three sessions (a ticket body, `roadmap.md`, two separate
sections of `onboarding-reward-design.md`, and `cv-quality-kickoff.md` §8), and every copy read as
independent confirmation of the others. The first pass corrected two, and reported the job done; Adrien
asking *"so we should update `tailoring-reasoning.md` now?"* is what surfaced the remaining three. Two
rules fall out. **Correct the source document first** — the file everyone lands on has to carry the
note, or the claim simply regrows from it. And **a session log is history, so annotate, never
rewrite**: the old entry keeps its wrong sentence with a dated correction beneath it, because the log
records what that session believed at the time. Record: `docs/cv-brain/tailoring-reasoning.md` §4's
note, `docs/onboarding-reward-design.md` §6.2, wayfinder ticket #6.

## A prototype's layout-shift bugs are invisible in a screenshot and invisible to reasoning

Two bugs in one throwaway prototype, both found only by driving it: a fixed bottom note bar sat on top
of the last tappable answer on a phone (a guessed `padding-bottom` on `body` did not match the bar's
real height, which varies with its text), and a CV line that had just been typed got shoved back below
the fold the instant the next question rendered — because the next question's options are taller than
the "writing it down" placeholder, so the bottom band grew and the scroll container shrank under it.
The second one violates a stated design requirement (§8.2: *the CV scrolls to the line, then types*),
and no amount of staring at a finished screenshot shows it, because **the end state is correct — only
the transition is wrong.** Both are the same class: **one element's size changing after another
element's position was computed.** Fixes are cheap and both are measurements rather than guesses —
measure the bar and set the padding from it; re-anchor the scroll after the band relays out. Reach for
Playwright with `isMobile: true` for any prototype with a fixed element or a band whose height changes
between states. Record: `apps/web/prototypes/first-question.prototype.html`, wayfinder ticket #6.

## A bare .html prototype with no viewport meta is being judged at the wrong size on every phone

Two sessions of "open it on your phone and tell me how it feels" were showing the wrong thing. Neither
`apps/web/prototypes/*.html` had a `<meta name="viewport" content="width=device-width, initial-scale=1">`,
so mobile Safari and Chrome fall back to a ~980px layout viewport and **zoom the whole page out** — the
`@media (max-width: 460px)` block never matches, the phone-frame styles never apply, and type that was
tuned at 30px renders at about a third of that. It is silent: on desktop everything looks perfect, and
on the phone it looks *plausible*, just small, so you blame the design rather than the missing tag. The
tell is a mock that renders full-width on desktop but letterboxed with tiny text on a phone. Any
standalone HTML file meant to be judged on a phone needs the tag; a file with no explicit `<head>` still
gets it, because the parser hoists a leading `<meta>` into the head it creates. Detectable in Playwright
only with `isMobile: true` — a plain narrow viewport does *not* reproduce it. Fixed 2026-07-23 in both
prototypes; record: wayfinder ticket #7.

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

**Refined 2026-07-23 (the job card, §9.1): attaching the number to a job is necessary but not
sufficient — a number nobody can audit slides back into being a grade.** A card showing a bare *61%*
invites *"61% of what, and is that good?"*, and with no way to check it the user supplies their own
answer, which is a verdict on themselves. The fix is not a smaller number or a softer label: it is
that **the number never appears without the thing it is made of inside the same glance**. On the card
that is one sentence naming the user's strongest matching fact and the biggest thing still open. Test
to apply anywhere we show a score: *can the user see, without scrolling or tapping, what would make it
move?* If not, it is a grade whatever it is attached to.

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

## Live-QA the running app from a worktree: API in-memory on 3001 + `next dev` on a *free* port with `API_URL`

For a UI slice, driving the real app beats trusting build+tests — and from a worktree it takes a little setup.
Build the API (`pnpm --filter @jobcrush/api build`) and run it in-memory (`PORT=3001 node apps/api/dist/main.js` —
no `DATABASE_URL` → InMemory stores; discovery/most routes never touch the LLM, so no API key needed). The web
dev server proxies `/api` → `http://127.0.0.1:3001` (its `next.config.mjs` default). **Two gotchas that cost time:**
(1) `next dev` in a worktree warns "multiple lockfiles / inferred workspace root" and its default `-p 3000`
frequently **collides with a pre-existing API already on :3000** — the tell is a *Fastify* 404 body
(`{"message":"Route GET:/ not found","error":"Not Found","statusCode":404}`), not a Next 404 page; run
`next dev -p <free port>` with `API_URL=http://127.0.0.1:3001` instead of fighting the port. (2) A `"use client"`
page SSRs only its loading shell, so `curl`ing the HTML won't show the hydrated screen — use a throwaway
`@playwright/test` `chromium` screenshot (browsers are already installed for the repo's e2e) to see it render and
assert on visible text. On cleanup, kill **only your own** ports (3001 + your web port); never `taskkill` a `:3000`
you didn't start — it's likely the user's own dev server.

## Playwright `getByText` collides with the required `sr-only` aria-live region — `{ exact: true }` or scope

Every a11y-correct screen mirrors its visible copy into a visually-hidden live region so screen readers announce each
change (discovery's `<div aria-live="polite" className="sr-only">` holds the same CV-line / countdown / notice / handoff
strings). So a loose `page.getByText("…")` matches **two** nodes — the visible one **and** the announce region — and
Playwright **strict mode** fails ("resolved to 2 elements"). It trips the *first* such assertion per spec, so one run's
failures are only the first-failures — sweep the whole file. Fix: `getByText(s, { exact: true })` when the visible text
is exactly `s` (the live region carries a longer string — line + countdown — so `exact` excludes it), or **scope** to a
container (`.discovery .notice`) when the visible node has trailing text `exact` can't match (the "no" notice carries a
"Fix that?" button). Test-only — the sr-only region is correct and stays. Two corollaries that also cost time here: a
stub `DiscoveryState` fixture must model a **reachable** shape (`questions: []` while `stage: "discovery"` never happens
against the real API — an unanswered essential is always in `questions` until the gate flips to `deck` — and the screen
renders no ask dock for it, so a notice assertion finds nothing); and to run ONE spec use `cd apps/web && npx playwright
test e2e/discovery.spec.ts` — `pnpm --filter … e2e -- <file>` does *not* scope and runs the whole suite incl. the
real-LLM `onboarding.spec.ts`.
