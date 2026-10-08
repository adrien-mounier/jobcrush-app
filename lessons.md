# Lessons — jobcrush-app

_What we've learned, so we don't relearn it. Grouped by topic, ~40 max. Rules move to CLAUDE.md / CODING_STANDARDS.md; stale lessons are deleted. Full history: docs/archive/lessons-2026-10-06.md_

## Before you design

### Grep the capability, not the name — premises decay
**What happened:** across map #127 and after, ticket after ticket was premised on something false:
a mechanism #162 had already deleted (#292), "we store no dates" while `MinedRole` read them (#126),
"no route from a fact to the CV" when two existed (#135), a "deleted" draft screen while Tailor was
alive (#287), a certification gate three documents described and `withdrawal.ts:82` disables.
**Lesson:** a claim about code with no file:line behind it is unverified, however many documents
repeat it — ADRs and specs copy premises, they don't test them; a spec user story proves something
was once wanted, not that it exists. "The system can't do X" needs every component that could do X
checked, not the first one. Code is a third party to a doc disagreement and never files a brief.
**Apply:** grep for the capability (and for a ban: a removed mechanism leaves a comment + a test),
list `apps/web/app/*/page.tsx` before saying a screen is gone, read the upstream stage's output
(the miner already flags gaps) before building detection over it.

### The schema says what the code can do; the CV brain says what it should do
A job's flat bullet array said "no sub-headings"; `cv-authoring-rules.md` had fully specified
"Key Deliveries" — never built, and nothing recorded the gap. In this repo an absence in the schema
is ambiguous between *decided against* and *never built*. Before answering "can the product do X?"
from a schema, grep `docs/cv-brain/` for X; an unimplemented rule is a ticket, not a footnote. The
reverse holds too: a phrase that appears only in the rules ("fix-this item") has never run.

### Prove a feature is reachable on the shipped path, not just implemented
#222 read `session.discovery.floor`, written only by routes the shipped client never calls — every
test seeded it, so the feature silently never ran. #63's gate had never been passable by anyone; a
banned phrasing deleted from a fallback template still shipped from the LLM phraser. **Apply:** for
every state field a feature reads, trace who writes it and whether the real client reaches that
writer; pin tests on what `main.ts` actually wires; name a visitor who has reached the gated state.
A 40-line throwaway probe that drives the real flow (or a five-row table of real outputs) settles in
minutes what review and reasoning don't — reviewers find refinements of what the diff already says.

### The shipped screens show how far a design rule reaches
Reading DESIGN.md's Gold Law as "one gold element" produced a redesign the owner called worse; the
shipped flow carries gold on 8–10 elements — the rule governs the glow. Likewise a per-file design
lint fired on one screen when there was no norm at all (four radii, four sizes across screens).
**Apply:** before applying or "fixing" toward a design rule, grep the token (`#e8a33d`) across
`apps/web/app/*.css` and look at what the other screens do; never hand the owner a two-option fork
before checking both options exist.

## Measurement and evidence

### Count honestly: who drew the denominator, and how many documents made the number
- A subset you filtered yourself is grading your own homework — prefer the dataset's own label (44/45, not "19/19").
- A corpus ratio can be one document (18 of 22 "projects" came from one CV, zero in our market).
- A keyword hit is not a measurement: "sponsor" was the project sponsor; "fluen" matched Confluence. Read the sentence.
- A job title is not an occupation (~⅓ of "project manager" postings are IT delivery); dedupe by content, not provider id.
- A threshold without a recognition rule moves 23 points with the reader. Write the rule first.
- Re-derive a ticket's headline number from raw data (the "25 bullets" was sample 1 of 3) and hand-check the suspicious row before trusting the summary.
- "Every ad asks for X" is a hypothesis; the corpus to count it is usually in the repo. If the population is small (29 adverts), read all of it instead of sampling.

### A comparison that moves two variables answers neither — find the constraint that binds
#160's "richer read is 0.77× the cost" compared few×rich against many×lean; the cell the product
needed was never measured. #117 raised the paid-scoring cap 8→20 and the deck got *emptier* and
114% dearer — the shared 8s deadline was the binding constraint, not the cap. Name every dimension
that differs between arms; ask "could we ship either arm?"; and an AC no value of the lever can meet
is recorded unmet with the table, not redefined until green.

### LLM evals lie in specific ways
- A case known to flip needs ~5 runs; "green twice" is a coin flip. Write the run count into the note.
- A harness that can't tell "the model answered X" from "the call failed" reports absurd results with confidence (a sous chef confirmed as a PM). Count each case's own calls; refuse to score if any degraded. Evals write results to disk.
- When eight models from five labs disagree with one hand-written label, suspect the label — but the owner arbitrates the change, never the author, and owner-arbitrated expectations are never flipped to make a rate green.
- Emitting the justification before the answer token (`why` first) ended a flip.

### A model test is blind only if the generator never saw the answer
The session model drafted CV lines right after reading the owner's real ones — partly a copy. A
case written into the prompt as a worked example is likewise an open-book exam (#105). Generate in a
separate process — `claude -p --model <id> --tools "" --system-prompt "…" < input.md` with
`CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` — and certify on a held-out set. With no `ANTHROPIC_API_KEY` the
LLM seam drives the CLI, so a real miner/tailor run on the owner's CV is free locally and is the only
honest check of a prompt change (pattern: build API, import from `apps/api/dist/`). Each CLI run
carries ~134k tokens of Claude Code context — check `/usage` before spending the weekly share.

### Price a model run from the repo's measured figure
A grid quoted at $0.65 cost $0.05: the lane runs on `FAMILY_PLACEMENT_MODEL` (minimax), not the
frontier tier, and `apps/api/eval/bakeoff-result.json` already held the measured cost. Read the
lane's model (`FAMILY_PLACEMENT_MODEL`, `JUDGE_MODEL`) and any measured figure before quoting.
Web search is mostly input tokens (~$0.10–0.15 per lookup on claude-sonnet-5; the fee is rounding).
For closed-list classification, eight models landed within 5 points at 27× price spread — cheap
model per *measured* stage; it does not transfer to mining/tailoring, which have no grader.

### Measure an external behaviour before designing on it
Thirteen Techmap calls (~1% of the month) dissolved five rounds of argument: unquoted titles match
ANY word (438 vs 22), quoted phrases OR together, word order is irrelevant, `size` is ignored.
`applicantLocationRequirements` turned out to be "HKT Timezone"; the full advert hid in nested
`jsonLD`. Same for wrappers: Playwright adds `--disable-dev-shm-usage` itself — verify at the
wrapper's output (`DEBUG=pw:browser`), not your input. **Apply:** buy the measurement early, read
values not field names, enumerate nested objects, and record the exact endpoint/headers + script.

### Heuristics and normalisers need adversarial, real inputs
Fixtures written beside an algorithm encode its assumptions: `matchtick` looked sound on
candidate-worded requirements; the English detector scored ATS bullet lists 0.03; a borrowed
"half the tokens" clause rule matched entities on one common word ("delivery"); job jargon is not
language evidence; a company-cache key paid "Nordea Bank" and "Nordea Bank A/S" twice. Test against
the real corpus plus invented hostile shapes, count the "can't tell" bucket separately, and give a
cache whose point is the bill one real run plus hit/miss counters.

### Research hygiene
- A market's convention must be read in that market's language, dated (Vietnamese sites contradicted English ones). Silence is not agreement.
- Two passes disagreeing is the valuable outcome — ask which *stage* (advert, application, contract) each rule binds.
- A regulation names a penalty; check *who it binds* (Singapore's WFA binds employers, not candidates) before treating it as a deadline.
- `archived: true` can mean "MOVED" — read the description and the registry's last publish.
- A benchmark may measure a harder task (ESCO taxonomy placement ≠ judging two texts).
- Never brief a sub-agent with unverified market context ("UK and EU") — check the repo's data; the agent can't know it wasn't verified.

## Testing traps

### Route-mocked tiers cannot see a fixture/server divergence
Every `apps/web/e2e/*.spec.ts` mocks at the route layer, so a mock encoding the *intended*
behaviour stays green while the server does otherwise (#23's bubble). A gate that mocks the network
never exercises the fake model either — CI now asserts `/qa/llm-calls` stays zero. Only real-stack
journeys (`*-journey.mjs`) and a browser witness the wire: `useParams` double-encoding killed every
paste behind 1,721 green tests; a v2 contract 400'd on Save while `pnpm test` was green.

### A journey in no tier rots silently — four occurrences
The eligibility journey (#205), master-cv (#209), the S2 loop spec (#271) and the industry journeys
(#282) each looked healthy because nothing ran them; an asset in no tier fails at exactly the rate
the product changes, and a good reason for exclusion (a paid model) protects it no better. Every
journey sits in a tier or carries a filed ticket saying why not. When touching one outside every
tier, assume it is already broken and prove it against the live product.
Adding one to the gate: a source file `tier2-coverage.mjs` never mapped selects EVERY journey, so
naming it only in the new journey's entry NARROWS it (#358's `qaReviewAnswer.ts`). Put it in the
shared area, then check `selectJourneys([file])` before and after.

### The in-memory store hands out the object it stores
`InMemorySessionStore` returns the stored record, so a background task writing back makes every read
a live view; whether a response saw "searching" depended on how many `await`s ran (#305). Postgres
can't do this, so it only ever bites tests. A test that goes red when you add an `await` was testing
timing: pin what the response observed (`const observed = {…}`) before the first `await`, and
decide which answer the design promises (`injectSettled` exists for the documented one).

### pg-mem and the in-memory driver are not Postgres
pg-mem rejected a `NaN` insert Postgres accepted (one `NaN` poisons every `SUM`), does not roll back
on an injected failure, and throws on `CREATE TABLE IF NOT EXISTS` for an existing table (so boot
idempotence is untestable there). Driver-contract tests prove only what both drivers do: the
Postgres driver parsed on read, the in-memory one didn't; in-memory returned `undefined` where
Postgres returned `null`. Verify corruptible numerics, rollback and migrations/backfills against a
real Postgres once; grep both drivers for asymmetric work; normalise in the driver.

### Playwright traps
- `getByText` matches the visible copy *and* the required `sr-only` aria-live region → strict-mode failure. Use `{ exact: true }` or scope to a container.
- `expect(...).toPass()` retries nothing unless the inner assertions carry tighter timeouts than the loop; prove iteration 2 happens.
- A phone-emulation pass reports `(hover: none)` — every desktop/hover path never runs. Add a desktop context.
- Reproduce a route-mocked flake on a production build (`build && start`), as CI does; the dev server hides readiness races.
- Run one spec with `cd apps/web && npx playwright test e2e/x.spec.ts`; `pnpm --filter … e2e -- <file>` runs the whole suite.

### QA-stack fixture traps
- qa-main's fake judge covers exactly `requirements[0]` — a requirement that must stay *open* goes anywhere but slot 0; say so in a comment on the fixture.
- A journey that writes to a record keyed on its fixture's content (a pasted advert: first link wins) is not re-runnable until the fixture carries a run stamp.
- Deck cards carry no per-card id and real postings share titles — reach a specific advert via `POST /onboarding/cards/:adId/want`, then assert `card.adId`.
- A prompt-routing fake matches each stage by its own opening line; both miners end in `===CV-TEXT===`.
- A fake that parses the prompt's input blocks must slice from the LAST occurrence of a block marker, not
  the first: the instructions name every marker (`=== JOB FAMILIES ===`) before the block itself appears,
  so `indexOf` reads the instructions and the fake answers "no families" without an error (#342).
- A journey must never assert deck ORDER or scores across a step that changes the person's facts. When
  the facts grow, `judge.ts` re-grades only the still-unmet requirements (#117 superset reuse), and the
  fake judge covers the first requirement it is handed (`qa-main.ts`), so each partial re-grade adds a met
  requirement and ten points; whether a read has seen one depends on when the first judgement ran relative
  to the answers — green locally every time, red on CI five pushes in a row (#338, runs 37459528860 →
  37559882744). Assert membership and the search family; print score provenance in the note. Two earlier
  explanations (labelers landing late; years facts landing after placements) were wrong — the diagnostics in
  the report, not reasoning, found the cause.

### Read the gate's verdict, not its summary line
- A journey that self-skips with a `qa.note` still prints "35 passed, 0 failed" — grep the report for skip notes.
- Reports land relative to the CWD: today's are in `apps/web/qa-results/`; `apps/web/e2e/qa-results/` holds June's. Read the path the journey prints on its last line, never a glob.
- `node x.mjs | tail -3; echo $?` reports `tail`'s status; redirect to a file or use `PIPESTATUS`.
- Before calling a red test your regression, run it against the commit before yours — a stale expectation (a family published two days earlier) gets filed against its real cause.

## Local environment

### A local run can be testing someone else's server, or yesterday's build
A `next start` left from the previous day held :3000; the health-wait passed and Tier 1 drove the
old build for 21 minutes (144 "failures"). Stopping a background task ends the shell wrapper, not
the node server. **Apply:** read the start log rather than trusting a health-wait; prove the stack
serves your tree (rebuild, or grep `dist/` for a symbol the diff adds); after stopping a server
check the port with
`$c = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue; if ($c) { $c | Select-Object LocalPort,OwningProcess } else { "port free" }`
(the bare cmdlet exits 1 with no output on a free port, which reads as an error), then
`Stop-Process` only what you started. `ERR_NO_BUFFER_SPACE` late in a long Windows run is spurious —
re-run that spec alone.

### Browser tests run against the fake-model API; `main.js` is for live drives
Specs start their own fake-model stack (`apps/web/playwright.config.ts` — its header says why
`main.js` fails them); journeys need `start:qa` as `ci.yml` runs it. A live drive on the real model
is the one use for `main.js`: build, then `node apps/api/dist/main.js` with no
`DATABASE_URL`/`ANTHROPIC_API_KEY` (in-memory stores), on the high ports from `SHARED_INFRA.md`,
with the web built against that `API_URL`. The dev overlay intercepts clicks on bottom-docked buttons; a Fastify 404 body on `/`
means you hit an API on your web port; a `"use client"` page SSRs only its shell — screenshot with
Playwright, don't curl.

### Next and turbo build traps
- `next dev` and `next build`/`start` against the same `.next` → `start` serves 400s for chunks; the page never hydrates. Attach `page.on("requestfailed")` before blaming the feature.
- Rebuilding under a running `next start` swaps its chunks; restart after a rebuild.
- Deleting a page leaves `tsc` red via `.next/types` until `pnpm exec next build`.
- `API_URL` is baked at build time (`SHARED_INFRA.md`), and turbo neither hashes it (cache restores the wrong port) nor passes undeclared env: for a custom API port, `rm -rf .next && API_URL=… npx next build` in `apps/web`, not through turbo.
- Mirroring CI by hand in one checkout: run the turbo `pnpm build` *before* the e2e web build — it bakes the dead `:3001` fallback.

### Commit the `/playwright` drivers with the slice
QA drivers land in `apps/web/e2e/*.mjs` untracked (only `qa-results/` is ignored), so "everything is
pushed" stays true while they live only in a worktree that `git worktree remove` deletes. Run
`git status --untracked-files=all` before removing a worktree; they ride the live backend and are
not duplicate coverage of the mocked specs.

### `apps/api/data/` ships only `*.json` and `*.mjs`
The root `.gitignore` excludes `data/` and whitelists `apps/api/data/*.json` / `*.mjs`; any other
extension there is silently untracked, works locally, and 500s on a fresh checkout. A negation can't
reach inside an excluded directory (un-exclude the dir, re-exclude contents, whitelist), and
`git check-ignore -v` exits 0 on a negation match — verify with `git add --dry-run`, probing both a
file that must ship and one that must not.

### Node's `execSync` runs cmd.exe here, which eats `^`
`git rev-parse X^` / `rev-list A ^B` through `execSync` silently become `X` / `A B` — no error, wrong
answer (bit the QA gate twice, 2026-10-06). Write `X~1` and `rev-list A --not B`.

### Python text mode writes CRLF here, and Git Bash's `grep $'\r'` can miss it
A Python edit script using `open(p, 'w')` rewrites every LF file as CRLF on this machine; git only
warns ("CRLF will be replaced by LF"). `grep -c $'\r'` in Git Bash once reported 0 on such files, so a
"normalise" loop built on it fixed nothing (#339). Edit with `newline=''` both ways, and check bytes:
`python -c "print(open(p,'rb').read().count(b'\r'))"`.

## CI, deploy and ops

### CI: what's filtered, what blocks it, and how to deploy without it
- `paths-ignore` is an explicit allowlist of inert paths, never an extension pattern — `apps/api/prompts/*.md` and `research-data/**` are product. Check with `git ls-files` against the filter.
- 0-second jobs with no logs = an account block (a $0 spending limit reads as "payments failed"), never a code fault. Read the run's annotation; the billable-minutes API reads 0 on free tier.
- Count undeployed work by diffing `main` against the last green `deploy-staging` sha, not by scanning the run list.
- When Actions is unavailable, the hand-deploy recipe (same gates first, then two `flyctl deploy` with `BUILD_SHA`) is in the archive under "CI blocked ≠ deploy blocked".

### Staging ops
- Probe sign-in with `delivered@resend.dev`, never `example.com` (Resend 422 → bare 500). The staging key is send-only; the container has no `curl` — use `fly ssh console` + `node -e "fetch(…)"`, and `-C` keeps secrets like `OPS_KEY` out of the session.
- The interactive `!` prompt runs bash and echoes into the transcript — never route a secret through it; the user sets secrets in their own terminal.
- Resend's free tier verifies one domain per account (a second free account works); the key must come from the account owning the domain.
- `flyctl secrets set --stage` parks values; one real `secrets set` applies all in one restart.
- **A paid model run on the product setting runs on the staging machine** (#340): the API key is a Fly
  secret the agent never reads, and `fly ssh console -C` inherits it. The machine is stopped by
  default (`fly machine start` first; `ssh console` does not auto-start it), `sftp shell` is
  interactive-only (upload with `echo <base64> | base64 -d > path` over `-C`), and a file added in
  the working tree (a new prompt, a script) is not on the machine until a deploy — upload it too.
  Launch with `nohup … &`, and first `fly machine update <id> --autostop=off -y`: a `/healthz` ping
  every minute did NOT hold the machine (the proxy stopped it 7 min into a run, and a restart boots a
  fresh rootfs — uploads and `/tmp` gone, the paid call lost). Restore with `--autostop=stop` after;
  the next deploy restores it from `fly.api.toml` regardless.

### Origins: OAuth, CORS, redirects, magic links
- After a domain move, update Google Console redirect URIs in the same motion as the `WEB_URL` Fly secret (a Google 400 page = Console gap; "sign-in didn't complete" = state cookie/token).
- Routes the browser reaches through `/api` redirect with relative paths; only third-party values (`redirect_uri`) need absolute `WEB_URL`.
- A magic link opens in a different cookie jar (mail-app webview): carry the session id on the token and routing ids in the URL, never only in localStorage.
- R2 CORS is not in the dashboard and the object-scoped token can't set it: run `pnpm --filter @jobcrush/api set-r2-cors` once with a temporary admin token, delete it, and check with `pnpm --filter @jobcrush/web e2e:r2-cors` after any upload-path change.

## Backend and data

### Node's fetch gives up on silent headers at five minutes, whatever your deadline says
A reasoning model on a whole-CV review answers nothing for minutes; the non-streamed Fireworks call
died at 300 s with `UND_ERR_HEADERS_TIMEOUT` while the step's own deadline was 30 minutes. That is
undici's headers timeout, which an `AbortSignal` cannot raise and which `undici` (not a dependency
here) would be needed to configure. **Apply:** stream every call that may think for long — headers
arrive at once and the step deadline becomes the only clock (both drivers in `llm.ts` stream now).
A per-step timeout above five minutes on a non-streamed call is a setting nothing honours.

### Widening to nullable disarms the checks you rely on
A `!` strips `null` as readily as `undefined`, so widening `verifiedLiveAt` produced no compile error
at the line that broke — grep the widened field for `!` and `as`. In SQL a NULL comparison yields
NULL, so a `CASE` falls to `ELSE`: write the `IS NULL` arms first and test the mixed case on both
drivers. A new column used in a keep/discard comparison needs an idempotent backfill (NULL on every
existing row re-introduced #31's bug once). Never put a nullable column in a composite primary key —
two NULLs never collide; use a sentinel (`'*'`).

### Matching a fact to a requirement: same subject, same granularity, same bar
`work-rights` is asked for one city and stored globally; matching it to a country-scoped requirement
would have withdrawn every Australian posting for an Australian in Hong Kong. A tick-box `none` meant
"not at the meeting bar" and withdrawal read it as "not at all". **Apply:** a category key
(`language`) instead of a thing (`Mandarin`) silently matches the wrong instance; an unknown scope
returns `null` and never withdraws; store the grade, not a boolean, when consumers may read it at a
different bar; a model label wired to a destructive action (`blocking`) carries an explicit
definition, a boundary regression test, and a firing-rate counter.

### Changing a unit or container changes every bound around it
`MAX_QUERY_TERM_LENGTH = 40` was per word; when queries became phrases it silently truncated a
43-character title into an empty deck, and stripping punctuation turned "C&B" unmatchable. Rewriting
`find()` as a `Map` flips duplicate precedence (first → last). When the unit a collection holds
changes, grep every constant, comparison and normalisation over it — even untouched lines — and
write down which duplicate wins.

### Counters and alarms that can't fire
A timeout rate whose overrunning reads later increment `read_succeeded` asymptotes to 0.5 — and the
threshold was `> 0.5`. Fixture parse errors fed a numerator but not its denominator; the reads that
could fail hardest sat outside the `try`. For any rate: one sentence each for numerator and
denominator, ask whether one event moves both, count at the decision point, and check what can move
it that shouldn't and what should that can't reach it.

### Next.js client gotchas
- `useParams()` returns the segment still percent-encoded — decode once, defensively, before re-encoding.
- A *value* import from `@jobcrush/contracts` drags `node:crypto` into the browser (`UnhandledSchemeError`); `import type` is fine, sharing runtime helpers needs a subpath export.
- Two CSS rules at equal specificity: load order wins (`profile.css` after `deck.css` collapsed a screen to 0px).
- A renderer mounted in two containers is styled off a class it emits itself, and rows are targeted by a `data-` attribute it writes, never by position.

## UI and product

### Before bypassing or removing a screen, list what it alone carries
A shortcut past the match reveal would have dropped its live-region announce, its focus target and
#123's conditional "…I left them out" sentence (the shortcut now declines when there's one to say).
An undo placed in "the slot after you answer" never renders for the *last* question, because
answering it is the transition away. A warning deleted because it became false must be re-homed if
its risk moved. Hiding a state from one view means auditing every count that still includes it
(badge 54, screen 47) — one `shown()` source of truth.

### Prototype and verify UI by driving it, at the owner's size
- Prototype before `/to-spec`: one throwaway mock broke three of thirteen paper decisions.
- Once a screen ships, prototype against the real component (a throwaway route importing the page with a stubbed `window.fetch`, deleted once decided — #299's settled `docs/design/add-something-new.md`), not a hand-drawn likeness.
- Standalone prototype HTML needs `<meta name="viewport" …>` and real closing tags (anchor-based tools like the impeccable injector skip files without `</body>`). Drive it with Playwright `isMobile: true` — layout-shift bugs live in transitions, not end-state screenshots.
- Style probes compare *worlds* side by side (type, material, shape), not palette swaps in a switcher.
- Responsive bugs (the desktop CV/ask layout survived four sessions of patches): reproduce the owner's exact viewport and content, state negative visual invariants, fix ownership of height (siblings never size each other) instead of offsets, and compare a screenshot of the deployed SHA. "I can't see the improvement" contradicts completion.

### A number on a person reads as a verdict
"This job: 34%" is useful; "Your profile: 34%" makes people leave — no label rescues a digit next to
their own name. Score our work (jobs), not the user; progression uses counters that only go up. And a
job score never appears without what it's made of in the same glance (strongest matching fact,
biggest open item), or it slides back into a grade.

## CV domain

### The graph validator checks structure, never richness
`validate_graph.mjs` validates node shape and conditional invariants only — no minimum count, no
"strong enough". That is what lets any honest user, even with a thin CV, produce a valid graph (S2
decision 5). Deck policy such as "keep at least one fact" lives in the route
(`routes/onboarding.ts`), and profile-strength feedback belongs to a future advisory feature.

## Process and tracker

### The tracker is the plan — keep it and its handoffs honest
- Next work is read from the GitHub tracker plus `roadmap.md`'s Now/Next; reconcile the two before claiming a frontier, and file anything named in one but missing from the other.
- `blocked_by: 0` can still be blocked in practice: read the ACs for a route/screen another open ticket owns. And blockers can be vacuous (decided weeks ago) — check they're still *true*, and re-home anything routed back to a ticket before closing it.
- A ticket number coming back higher than expected means someone filed adjacent work — list the recent range first.
- Hand off through the issue, naming the traps; when superseding tickets, copy their measured findings inline into the replacement *before* closing — nobody opens a closed issue.

### Two sessions in parallel collide on the NEW files each must create
The dependency graph gives order, not collisions. Two worktrees creating the same new file lose one
version at merge with no conflict marker (#20's whole deliverable was a file #17's AC forced into
existence). Semantic collisions need no shared file (#26 rescoring numbers #23's tests assert). A
blocked ticket's documented deferred limitation is often the safest parallel work.
