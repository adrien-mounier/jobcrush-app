# Lessons — jobcrush-app

## Cross-import corrections require stable semantic identity before UI work

Generated claim IDs and normalized display text are not durable identities.
They cannot safely merge semantic equivalents, distinguish a field-local
conflict, or preserve a correction when the same CV is mined again with
different wording. The honest seam is a versioned evidence contract: a stable
semantic key for coverage, paired field key/value/label for single-valued
conflicts, and user resolutions keyed to that identity.

The same truthfulness rule applies to reward metrics. Before a validated family
question floor exists, do not turn “useful facts found” into a fabricated
“questions skipped” count. Return zero and use facts-only copy until the real
question-coverage seam lands.

## Typed Fastify response schemas must include every status branch

A Fastify route can pass its HTTP integration tests and still fail the repository
typecheck when its response schema declares only the success status. The
`PUT /sessions/me/source-entry` handler already returned the correct fail-closed
`401 no_session` envelope at runtime, but its typed schema declared only `200`.
TypeScript therefore rejected `reply.status(401).send(...)` even though the behavior
test passed.

For every typed route, declare the exact schema for each status the handler sends
(including authentication and validation branches), then run package typecheck in
addition to route tests. HTTP tests prove runtime behavior; the response map proves
the handler and public contract remain type-compatible.

## Responsive sibling panels must not derive height from each other

This bug survived at least four sessions because each pass patched one visible symptom—centering,
matching edges, A4 sizing, then stopping the ask from stretching—without challenging the page's
underlying geometry. The desktop CV and question were still coupled through a shared header/main
structure, and `aspect-ratio: 210 / 297` kept a sparse CV artificially huge even after equal-height
stretching was removed. On stacked screens, the wrapper also lacked the `flex`/`min-height: 0`
contract needed to keep a growing dock inside the fixed viewport.

The false-completion signals were especially costly: typecheck and ordinary interaction tests were
green; narrow geometry checks proved only that elements stayed inside the viewport and shared an
edge; a 1440×900 screenshot looked less severe than the owner's 2048×1118 case. None of those checks
asserted the thing the user actually disliked: a mostly empty CV consuming nearly the full screen
and making the post-answer composition feel dropped and broken.

For future responsive UI bugs:

1. Reproduce the owner's exact state, viewport, and content density before editing.
2. Translate the complaint into **negative visual invariants**—for this bug: no forced document
   aspect ratio, no scrollbar on a sparse preview, no sparse panel consuming most of the viewport,
   and no sibling's content determining another sibling's height.
3. Fix the ownership model, not successive offsets: the viewport owns available height; independent
   columns own their intrinsic content; overflow belongs only to the region that genuinely grows.
4. Test the Cartesian product of meaningful states and representative viewports, including the
   reported one—not merely one before/after transition.
5. Inspect a rendered screenshot from the deployed SHA. CI, health checks, and DOM geometry are
   necessary evidence, but they cannot replace comparing the actual composition with the user's
   evidence.
6. When the user says the improvement is not visible, treat that screenshot as a contradiction of
   completion—not as a cache problem or a request for another cosmetic adjustment.

## After a domain move, add the new origin's Google OAuth redirect URI to the Google Console

`WEB_URL` on the API drives the `redirect_uri` sent to Google (`${WEB_URL}/api/auth/google/callback`,
`apps/api/src/routes/auth.ts`). When the site moved from `https://jobcrush-web-staging.fly.dev` to
`https://jobcrush.org` (session 38, `WEB_URL` Fly secret updated), the app correctly started sending
the new return address — but the Google Cloud Console's authorized redirect URIs still listed only the
old `fly.dev` address. Google rejects an unregistered `redirect_uri` with **`Error 400: redirect_uri_mismatch`**
on its own page, *before* the account picker — so the user never reaches the app's `?login=expired`
bounce. The fix is a Console edit only (Credentials → OAuth client → Authorized redirect URIs → add
`<new origin>/api/auth/google/callback`, keep the old + localhost entries), no code change, no redeploy.
**After any future domain/origin change, update the Console's redirect URIs in the same motion as the
`WEB_URL` Fly secret.** Symptom-to-cause: "Google sign-in shows a Google 400 error page" ≠ "app says
sign-in didn't complete" — the first is a Console redirect-URI gap; the second is the state cookie or
token exchange (e.g. a stale `GOOGLE_CLIENT_SECRET`).

## Local dev: unset APP_ENV must count as "local" or Secure cookies break every sign-in

`cookieSecure = process.env.APP_ENV !== "local" && ...` in `routes/auth.ts` and `routes/sessions.ts`
marked the session + OAuth-state cookies `Secure` whenever `APP_ENV` was unset — which is the default
`pnpm dev` state (the dev script sets no env, and no `.env` is auto-loaded). Browsers silently drop
`Secure` cookies over `http://localhost`, so both Google and magic-link sign-in failed identically
locally with no error surfaced. The fix: `(process.env.APP_ENV ?? "local") !== "local"`, matching the
healthz convention in `server.ts`. Staging/prod are unaffected (`APP_ENV=staging` is explicit). Any new
cookie flagged `secure` should use the same `?? "local"` default.

## R2 CORS is not in the Cloudflare dashboard — and presigned-PUT uploads silently fail without it

The browser uploads a CV straight to a presigned R2 URL (cross-origin). If the bucket has no CORS
rule, R2 replies `403 "CORS not configured for this bucket"` to the browser's preflight and the PUT
never fires — the front door shows its generic *"Couldn't upload that — check your connection"*
message, which reads like a network bug, not a bucket-config bug. The Cloudflare R2 dashboard
exposes only Object Lifecycle and Bucket Lock rules — **CORS is wrangler/S3-API only**, and `wrangler`
isn't installed locally (by rule, to keep account-wide commands out of reach).

**The R2 token must have bucket-admin permission to set CORS.** The first attempt at boot-time
`PutBucketCors` (`R2Storage.ensureCors`, `fd5cef6`) failed silently every boot: the scoped R2 token the
API used had only object-read/write permission, so `PutBucketCors` was denied (caught and swallowed —
invisible without Fly logs). It looked like it worked once because a pre-existing `fly.dev` rule was on
the bucket, not because the call succeeded. **Do not assume `PutBucketCors` succeeded without re-running
the CORS preflight against the exact origin.** A temporary workaround (`deeeecf`) routed upload bytes
through the API (`presignPut` returned the API-relative `/uploads/:id/content` path, same-origin, no
CORS) — fine at staging volume, but it puts ≤10 MB uploads through the API and runs into Fly request-size
limits at real volume.

**Cloudflare's dashboard can scope only Object Read & Write / Object Read to a single bucket —
Admin Read & Write is account-level and covers every bucket on the account** (including
vitacairn's). So the dashboard cannot produce the "admin, scoped to only jobcrush-staging" token
the original ticket asked for; that combo breaks the shared-infra one-token-one-bucket rule. A
bucket-scoped admin token *is* possible via the Cloudflare API with a custom access policy
(resource `com.cloudflare.edge.r2.bucket.<ACCOUNT_ID>_<JURISDICTION>_<BUCKET>`), if self-healing
ever becomes worth the setup — but it is not a dashboard click.

**Durable fix (#53, option 1 — one-shot CORS, no self-heal):** keep the existing object-scoped R2
token in Fly (it's already correct for day-to-day uploads — unchanged). Set CORS **once** with a
**temporary** admin R2 token: `pnpm --filter @jobcrush/api set-r2-cors`
(`apps/api/scripts/set-r2-cors.mjs`) calls `PutBucketCors` from `WEB_URL` + optional
`R2_CORS_ORIGINS` (trailing slash stripped, so a `https://jobcrush.org/` can't silently mismatch the
browser's `Origin`), then reads the config back with `GetBucketCors` so you can see it actually
landed. Delete the temp token immediately after. `presignPut` returns a presigned `getSignedUrl`
PUT so bytes go straight to R2 again; the boot-time `ensureCors` is **not** wired (the object token
can't `PutBucketCors`, so calling it on boot would fail silently — the original `fd5cef6` bug). Not
self-healing — if the bucket is ever recreated (owner-gated per `SHARED_INFRA.md`), re-run the
one-shot. **The CI tests never catch any of this** — they inject a fake LLM and use
`InMemoryBlobStorage`, so the real R2 path is only exercised on staging. Guard against rot with
`pnpm --filter @jobcrush/web e2e:r2-cors` (`apps/web/e2e/r2-cors-preflight.mjs`): it creates a
session, gets a real presigned URL from `/api/uploads`, sends the browser's exact `OPTIONS`
preflight, and asserts `204` + `Access-Control-Allow-Origin`. Run it against staging after any
upload-path or CORS change.

Separate but related: `WEB_URL` on `jobcrush-api-staging` was set to `https://jobcrush-web-staging.fly.dev`
(the old Fly URL), not `https://jobcrush.org`. That broke magic-link emails + Google OAuth redirects
(they sent users to `fly.dev`) and would have made any CORS allow-list target the wrong origin.
Setting `WEB_URL` to the real public origin is a Fly secret on the API app.

## Windows rejects the QA driver's trailing-dot report directory through ordinary paths

`qa-driver.mjs` builds its timestamp by slicing the ISO string at 15 characters, which retains the
millisecond separator and produces a directory like `factbadge-journey-20260726-105031.`. The run
and report are valid, but ordinary Windows path traversal can reject the trailing dot. Use the
extended `\\?\` path to inspect existing evidence. If the timestamp helper is changed later, remove
the separator before creating the directory; do not mistake path lookup failure for a missing QA
report.

## A score and its explanation must share one coverage decision

The first #26 implementation could display 100 while listing the same requirement as still open:
the numeric score and the gap list had independently drifted into different ideas of “covered.”
The same review also exposed a subtler inflation path: whole-fact deduplication treated
filler-modified copies as fresh evidence.

Compute coverage once and reuse it everywhere the product explains that coverage. If breadth is
rewarded separately, deduplicate by the evidence relevant to the ad—not by the full input string—
so irrelevant wording cannot manufacture a higher fit score.

## A one-item ordering exception is not a new sort tier

#27 needed one launch-safe card to open the deck, whose normal rule is best match first. Sorting by
`curated` and then by score looked natural, but it promoted **every** curated card ahead of every
uncurated one. Once the wide pool arrived, a mediocre curated card could outrank a 99% ordinary
match — a much larger product change than the ticket asked for.

When a ranked list has a single exceptional position, **sort by the canonical rule first, extract
the one exceptional item, then insert it at that position**. Test with a mixed pool where the
exception is not already first; an all-exception fixture makes the regression assertion vacuous.

## Two CSS rules at equal specificity: load order silently decides the winner

`.profile { position: relative }` (`profile.css`) collapsed the whole #20 screen to 0px because it
collided at **equal specificity** with `deck.css`'s `.jobdeck { position: fixed; inset: 0 }` — same
selector weight, so the later stylesheet wins outright, and `profile.css` loads after `deck.css`.
Invisible to typecheck and build; only surfaced running the app in a browser. Worth a second look
whenever a new screen's root class silently inherits fixed/absolute positioning it didn't ask for.

Non-obvious things worth remembering, so we don't relearn them the hard way.

## A "never decreases" guarantee has to cover the denominator, not just the numerator

S30's #35 made a rejected claim count as *answered* so `railFill` couldn't fall. It still fell — by
0.4 → 0.25 — because `railFill` is `answered ∩ askable / askable`, and `askable` is gated by
`isTriggered`, which keys off *positives*. Rejecting a **trigger** therefore evicted its
already-answered follow-up from the numerator **and** the denominator at once.

**When a ratio is supposed to be monotonic, every filter that gates its denominator inherits the
guarantee.** Ask what shrinks the set, not just what shrinks the count. The fix was one clause —
`|| answeredIds.has(i.id)`, because an already-answered item can never be un-asked — and it left the
original trigger rule (#18 AC5: a "no" on the trigger must not surface an *unanswered* triggered
item) intact.

The test lesson is sharper than the code one: the AC was written as *"has not decreased"* and pinned
with `toBeGreaterThanOrEqual`, **which also passes when the value rises because the denominator
shrank**. It went green on a build that still had the bug. Assertions shaped like the AC's own words
are the ones most likely to pass for the wrong reason — pin the literal value alongside.

## A field added to a store record reaches the wire wherever that record is spread

S30's #28 added an internal `seq` ordinal to `ClaimRecord` for the ledger's answer-order replay.
`GET /onboarding/deck` returned `(await claims.list(...)).map((c) => ({ ...c, tier }))` — no response
schema, so Fastify stripped nothing, and `seq` shipped to the client. On Postgres `seq` is a
**table-global** bigserial, so the delta between two of a visitor's *own* requests disclosed how many
claim rows every *other* session wrote in between.

The whole suite stayed green: no test asserted the *absence* of a key, and the web client just
ignored the extra one. **Adding a field to a type that is spread into a response is a payload change,
not an internal one** — grep for `...record` spreads at every route before adding one, and pin the
absence with a test, because nothing else will catch it.

## Adding a nullable column can re-introduce the bug the column was added to fix

S29's #31 fix keyed the tailor floor to a new `tailor_floor_ad_id` and shipped the usual
`ADD COLUMN IF NOT EXISTS`. That leaves the column **NULL on every existing row**, and in SQL
`NULL = $2` is *unknown*, not false — so `CASE WHEN tailor_floor_ad_id = $2 … ELSE 0` falls to the
`ELSE` for exactly the sessions that were mid-flight at deploy time. The deploy that fixed the bug
would have re-introduced it, once, for every live session. Self-healing and invisible in tests —
both drivers were green, because a fresh test row and a migrated production row are not the same
thing.

**When a new column participates in a comparison that decides whether to keep or discard state, the
migration needs a backfill, not just a default.** Ask what the comparison does for a row that
predates the column. Note the asymmetry with #33's `fact_floor` in the same session: a raise-only
integer defaulting to `0` needs no backfill, because the first read raises it back to its true peak.
The trap is specific to *keyed* state, not to new columns generally.

`init()` runs on every boot, so the backfill must be idempotent — scope its `WHERE` so it can never
match twice. QA verified this against real Postgres rather than pg-mem, which is the only way it
would have been caught: **`CREATE TABLE IF NOT EXISTS` on an existing table throws `NotSupported`
under pg-mem**, so boot-idempotence is not testable there at all.

## Two local traps that make a QA sweep report defects that aren't there

Both cost real time in S29 and neither is discoverable from the failure message.

**(1) `turbo` does not hash `API_URL`.** So `API_URL=… pnpm build` can restore a **cached** web build
with a *different* port baked in — and `API_URL` is a build-time constant, not a runtime one. In a
shared-account setup this is the exact plausible-nonsense `SHARED_INFRA.md` warns about, except it
arrives through the build cache rather than the port: one project's frontend served another
project's backend, with a JobCrush title on a Vitacairn 404. Use
`rm -rf .next && API_URL=… npx next build` directly, and verify the pairing **through the web app's
own `/api/*` proxy** — hitting both ports separately proves only that two servers are up, not that
they are talking to each other.

**(2) `IpRateLimiter` allows 12 anonymous sessions per hour per IP.** A full e2e sweep exhausts it,
and the resulting `429 rate_limited` failures look exactly like real defects — 10 of them in one S29
sweep, all spurious. The limiter is in-memory, so restarting the API clears it. **Attribute every
sweep failure before reporting it**; the tell is failures that vanish on a fresh API.

## A green test suite proved nothing twice in one session — both times it looked thorough

S28 shipped two tickets, and in each one a *passing* suite was hiding the defect.

**(1) A route-level mock can assert the behaviour the server doesn't have.** #23's
`tailor.spec.ts` fixture declared `bubble.open: "Nothing they ask for is still open."` when
`dontYet` was empty — the *correct* behaviour. The real server passed the bubble through
un-recomputed, so after a "no" the card permanently headlined the requirement the visitor had just
declined. The mock encoded the intent, the server contradicted it, and unit + e2e were both green.
**Every spec in `apps/web/e2e` mocks at the route layer, so no amount of them can catch a
fixture/server divergence.** The only thing that did was QA driving the real stack. Remedy now in
the repo: `apps/web/e2e/tailor-journey.mjs` and `factbadge-journey.mjs` — real-stack drivers, no
mocks. Keep them running and add one per screen; when a fixture and the server disagree, they are
the only witness.

**(2) A test can drive the one path where the feature doesn't fire.** #17's test was named *"…and
the chip actually flies"* and drove the 0→1 first answer — the single case where the badge didn't
exist yet, so no chip was ever created. It asserted only the accessible name, which the chipless
fallback satisfied. **Deleting the entire ~40-line chip implementation left the whole suite green.**
Remedy: before trusting a new test, **delete the code it covers and watch it fail.** That check
found both this and the fixture bug above, and it costs one revert-run-restore cycle. Both devs now
report it as proof; ask for it.

## `turbo run build` silently strips env vars the task doesn't declare

Setting `API_URL=… npx turbo run build` does **not** reach Next: `turbo.json` declares no `env` for
`build`, so turbo strips it and the default `http://127.0.0.1:3001` gets baked into the routes
manifest. The stack then looks healthy — two servers, two 200s — while the web app proxies `/api/*`
to a dead port. Run `npx next build` directly in `apps/web` when overriding an env for local QA, and
**verify by fetching through the web app's own `/api/*` proxy**, never by checking two independent
200s. The deploy path is unaffected (`Dockerfile.web` sets `ENV API_URL=$API_URL` and builds via
`pnpm --filter`, not turbo) — this is a local-QA trap only.

## This machine hosts a second project on the same accounts and the same default ports

`vitacairn` sits beside this repo under `AI/Projects`, deploys to the **same Fly and Cloudflare
accounts**, and defaults its API to **3000** and its web to **3001** — exactly overlapping ours. Both
web apps proxy `/api/*` to `127.0.0.1:3000` by default, so with both running one project's frontend
silently talks to the other's backend and returns plausible nonsense. Use distinctive high ports for
any local drive. Full inventory, rules, and the port recipe: `C:/Users/adrie/AI/Projects/SHARED_INFRA.md`.
## To judge whether two sessions can run in parallel, ask which NEW files each ticket must create

The dependency graph tells you build *order*; it says nothing about two sessions colliding. The sharp
test is **which new files each ticket has to create**, because two worktrees writing the same new file
means the loser's version vanishes at merge with no conflict marker to warn you. S28 ran beside an
`/orchestrate-team` on #23 + #17 and the only open ticket was #20 — which looks independent (none of
its six ACs mention the badge) but is the **worst** possible parallel pick: #17's AC5 forces it to
create `apps/web/app/profile/page.tsx`, and that file is #20's entire deliverable. Conversely, a
"blocked" ticket's *documented deferred limitation* is often the safest parallel work available: it is
already scoped, already reviewed, and lives in files nobody is editing. Check the previous session's
"deferred limitations" notes before concluding there is nothing parallel-safe to do.

Related trap: a *semantic* collision needs no shared file. #26 (rescore `matchtick.ts`) touches nothing
#23 touches, but #23's ACs assert on the numbers the tick produces — changing them under a session
writing those tests breaks it in a way git cannot flag.

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

## `/playwright` QA drivers land **untracked** — they die with the worktree unless you `git add` them

The QA pass writes its human-paced drivers into `apps/web/e2e/*.mjs` (`qa-driver.mjs` + one flow file per
journey) and its evidence into `qa-results/`. Only the evidence dir is gitignored; the drivers are merely
**untracked**, so a green "everything is committed and pushed" session check (`git log`, `git status` glanced
at, `origin/main..branch` empty) is still true while the drivers exist in exactly one place — a worktree that
`git worktree remove` will delete. Nearly lost session 25's `onboarding-reveal-wall.mjs` this way. Two habits:
`git status --untracked-files=all` in the worktree **before** removing it, and commit the drivers with the
slice — they are not duplicate coverage of the `.spec.ts` files, which stub `GET /onboarding/cards`, while the
drivers ride the **live** backend (the anon→account magic-link merge has no other regression test). They are
inert to both gates: `.mjs` matches neither Playwright's default `*.@(spec|test).*` glob nor tsconfig's
`**/*.ts` include.
