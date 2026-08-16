# Lessons — jobcrush-app

## A spend bound is a fingerprint, not a counter

#228 had to guarantee "at most one extra provider search per session, ever". The obvious build is a
counter on the session, and it would have been wrong in three ways at once: it needs a write on the
paying path, it double-counts a retried failure, and nothing stops a poll from spending under it.

The bound that actually held was already in the machinery. Retrieval keys its snapshot on a
**fingerprint of the request**, and the session holds one snapshot per fingerprint. So: latch the
accepted family onto the session, let it ride the request, and a new fingerprint appears exactly
once — one retrieval, then reuse for every later read, with the *latch* (not a number) making a
second acceptance a no-op. No counter, no bookkeeping, and the property is provable by counting
calls to a fake retriever rather than by reading a variable.

The general shape: **when a ticket asks you to bound how often something happens, look first for the
identity the system already caches on.** If repeating the work would produce the same key, the cache
is the bound — and it cannot drift out of sync with reality the way a counter can.

## The server cannot see the end of a list it handed over

#228's spec put four conditions on the offer, and one of them — "no job card remains" — turned out
to be unanswerable on the server: it hands over a full deck and never learns that she swiped past
the last card. Implementing the rule as written would have served the *empty pool* case and silently
missed the *exhausted deck* case, which is the one the ticket is named after.

The split that worked: the server answers **"can this be honoured?"** (every eligibility question —
her CV, her interview, her session state), and the screen answers **"is it time?"** (a fact only it
holds). The rule "the screen renders, it does not decide" survives intact, because the screen still
decides nothing about whether the offer is *possible*.

Worth noticing before writing a server-owned state field: **ask which side actually holds each fact
the condition needs.** A condition mixing the two is a sign the field belongs on both sides of the
wire, split by who can see what — not that one side should guess.

## A bound outlives the unit it was written for

`MAX_QUERY_TERM_LENGTH = 40` was a **per-word** cap. #240 changed the unit the query is made of from
words to phrases, and the constant kept applying itself — silently, correctly by its own logic,
and now wrongly. A 43-character job title went out as a quoted half-title matching nothing: not an
error, not a shorter result, an **empty deck**. The old shredder handled the same input fine, which
is why no existing test failed.

The general shape: **when a change alters the unit a collection holds, every bound, comparison and
loop over that collection changes meaning too, whether or not it changes code.** A truncation that
was a harmless clip becomes a corruption; a "contains a word" check becomes "contains a substring".
Both reviewers found this independently, and neither found it from the diff of the constant — they
found it by asking what the *new* unit does when it hits the *old* rule. When you change a unit,
grep the constants and go read each one against the new meaning, even where the line is untouched.

The same pass caught its sibling: normalisation that was invisible under shredding (stripping
punctuation, since words were compared individually) became destructive under phrases — the real
Hong Kong title **"C&B Project Manager"** shipped as the unmatchable "C B Project Manager".

## Ask the vendor before you fold the fake to match it

#240's curated pool had to match "the same phrases the live provider does". The lazy reading is to
copy what our own driver sends and call it parity. QA instead spent ~USD 0.08 asking the vendor
directly, and two assumptions the entire ticket rested on turned out to be *load-bearing and
untested*: that several quoted phrases **OR** together rather than AND (Hong Kong: `"Delivery
Lead"` = 0, `"project manager"` = 22, both = 22 — an AND would have returned 0 and emptied every
expanded search), and that a quoted phrase respects word boundaries (`"manage"` → 0, so it does not
substring-match "manager").

Both were *stated as fact* in the ticket from an earlier probe, and both were being re-derived from
memory rather than re-measured. A cent's worth of calls converts a design assumption into a fact
you can build on. See the owner's petty-cash rule in `AI/Projects/CLAUDE.md`.

## Thirteen provider calls answered a question five rounds of reasoning could not

Grilling #240 spent five rounds arguing about how to send several job titles to Techmap — phrases or
words, one call or many, how her own wording survives dilution. Every branch rested on an assumption
nobody had ever tested: **what does the `title` parameter actually do with more than one word?**

Thirteen live calls (~1.3% of the month's 1,000, HK, one day) collapsed the whole tree:

- **Unquoted, it matches ANY word.** `project manager` → **438** Hong Kong adverts, top results
  Marketing Manager, PR Manager, Business Development Manager. `"project manager"` → **22**, all
  real. Confirmed by adding a word: `project manager nurse` → 456, exactly the nurse adverts.
- **Word order is irrelevant.** `manager project` returned byte-identical results.
- **Several quoted phrases OR together in one call** — 22 + 10 − 1 = 31. The multi-title cost
  question, argued over three rounds, did not exist.

Two takeaways, and the second is the one that generalises.

**A vendor's query semantics are a fact, not a design input.** Ours had been assumed for a month.
`boundedKeywords()` shreds titles into words *and* the driver sends them unquoted — a search for
project managers is a search across 438 adverts. Not user-visible (fixtures), but #63 was about to
build provider drivers on top of it.

**When a design fork rests on an unmeasured external behaviour, buy the measurement first.** The
probe cost thirteen calls and one script. It killed three questions outright, reversed a
recommendation I had already made twice (a one-title cap, argued on cost grounds that turned out not
to exist), and produced the number — 22 adverts/day is the whole HK catch — that promoted #228 from
edge case to main path. Ask for the call earlier than feels justified.

**Also found in passing, because the payload was printed:** every Techmap item carries `isDuplicate`,
`occupation`, `industry`, `careerLevel`, `portal`, `isDirect` — and `normalizeTechmapItem` reads none
of them. `isDuplicate` is what #92 is chartered to measure. Printing one raw response is cheap; a
year of not printing it is not.

## The CI budget went on prose, and the fix that looks obvious would have switched off the wrong tests

At 90% of the month's GitHub Actions minutes with two weeks left, the burn was ~120 min/day against a
2,000/month allowance — about **1.5 days of runway**, not the 17 the alert implied. The cause was not
a slow suite in general: `test` is ~3 minutes and `e2e` is **~27**, and **132 of that cycle's 237
commits touched nothing but prose**, each paying full price. Nothing cancelled superseded runs either,
so three pushes in ten minutes ran three complete pipelines.

**The trap in the obvious fix:** `paths-ignore: ['**/*.md']`. In this repo markdown is not a synonym
for documentation — `apps/api/prompts/*.md` ARE the product (family-labeler.md decides how a
visitor's job is classified) and `research-data/**` backs the eval lane. That one-line pattern would
have silently switched CI off for the change most able to break a visitor's results. The filter has
to be an **explicit allowlist of inert paths**, never a file-extension pattern. `*.md` without `**`
matches root level only (GitHub: "`*` does not match `/`"), which is what makes it safe.

**The trap in the second fix:** workflow-level `cancel-in-progress`. It would also cancel
`deploy-staging` mid-`fly deploy`, and that job's own concurrency group exists precisely so an
in-flight deploy FINISHES. Cancellation belongs on the pre-deploy jobs only.

**The check to run before any paths filter: for every extension you are about to skip, list the files
matching it that are read at RUNTIME.** If that list is non-empty, you need an allowlist, not a
pattern. The verification that actually settles it is enumerating `git ls-files` against the filter —
72 of 487 files ignored, and every prompt and fixture still gated — not eyeballing the pattern.

**Coda, same day (2026-08-15 ~08:58): the allowance ran out anyway, and the fix landed one commit
too late.** CI has been dead on every push since — including the very commit that added the filter.
Read the failure carefully, because GitHub's wording sends you to the wrong place:

> *The job was not started because recent account payments have failed or your spending limit needs
> to be increased.*

**No payment ever failed. There is no payment method on the account at all.** Checked at the time:
201 workflow runs since 1 August across both repos, and the billing API reports **0 billable
milliseconds** — a run that visibly took 28.7 minutes reports `duration_ms: 0` for every job. That is
what a free-tier account looks like: the 2,000 free minutes are consumed, the default spending limit
is **$0**, and a $0 limit is a **hard stop**, not a warning. GitHub then reports it in the vocabulary
of a billing failure, which is how three sessions in a row went looking for a broken workflow.

Three things worth carrying:

1. **A $0 spending limit is a circuit breaker, and it does its job silently and completely.** It
   blocks at the platform level *before a runner starts*, so there are no logs, the job "fails" in
   3 seconds, and every commit fails identically regardless of content. **0-second jobs with no logs
   = an account block, never a code fault.** Check `gh run view <id>` for the ANNOTATION, not the log.
2. **The billable-minutes API cannot measure free-tier burn** — it reads 0 for work that really ran.
   Anyone estimating runway must sum `run_duration_ms`, not billable time. The earlier "90% of the
   month's minutes" figure came from the alert email, and the API would have flatly contradicted it.
3. **A cost fix that ships at 90% consumed is a fix for next cycle.** The `paths-ignore` work is
   correct and will halve the burn — but only from the next allowance. Between the block and the
   reset, `main` accepts pushes, closes issues, and **deploys nothing**, so the git log and the board
   both read "shipped" while staging stays on the last green build (`85cda41`, 2026-08-15 08:51).
   Three slices are sitting in that gap — #231, #222, #234 — and **#231 is the one that shows how
   this hides**: its code (`34bdd3c`) was pushed together with a docs commit, so it never got a CI
   run of its own. `gh run list` shows no row for that sha at all, which reads as "nothing to see"
   rather than "blocked". **Count undeployed work by diffing `main` against the last green
   `deploy-staging` sha, never by scanning the run list for failures.**
   The only ways out are to wait for the reset or to add a payment method and raise the limit above
   $0 — which is the moment CI stops being free.
   ⚠️ **The reset DATE is not verified here.** A free account's allowance resets at the start of its
   billing cycle, which is normally the 1st, but `gh` cannot confirm it: the billing endpoint needs
   the `user` token scope and this token has `admin:public_key, gist, read:org, repo` only. Read it
   off the Billing & plans page rather than trusting a date in this file.

**The generalisation: when a platform stops your pipeline, find out whether the constraint is money
you owe or money you have not agreed to spend.** They produce the same message and need opposite
actions — one is a dashboard fix, the other is a decision about whether to start paying.

## A production caller whose guard can never be true is the same failure as no caller — and tests that seed state prove wiring, not reachability

#222 wired the family-scoped years reading to `session.discovery.floor` — a field written only by
the production-discovery routes, which the shipped web client never calls. Every test passed,
because every test seeded the floor itself; on the real journey the guard was permanently false and
the whole feature (scoped bars, known zero, confidence attenuation) silently degraded to the old
career-total reading. This is the exact failure mode #222's own AC13 was written against ("a tested
helper with no caller is what let this go missing once already"), reproduced one level down: the
caller existed, its precondition didn't.

Two checks that catch it:
1. **For every session-state field a new feature reads, trace who WRITES it and whether the shipped
   client ever reaches that writer.** A field only integration tests populate is a stub in disguise.
2. **The QA gate must drive the shipped journey and A/B the feature's effect** (here: same CV, one
   role that places vs one that doesn't — 47% vs 49% proved the scope was read). A browser pass that
   only re-walks the happy path would have shown a working deck and missed it; the gate caught it
   precisely by asking "what does the product actually leave in `discovery.floor`?" after a full
   real walk.

## A test double that speaks a dialect the real parser rejects reports the feature MISSING, and CI stays green

#231 changed the labeler's answer shape (`familyId` string → `familyIds` array, plus a required
confidence). Every real caller and every test was updated. The one thing missed was the fake model in
`qa-main.ts` — the stack a live QA drive actually runs against. It kept emitting the old shape, so
the real parser rejected every answer, retried once, and degraded to `unmapped`. Against the QA
stack, **no job and no target role could be placed at all.**

Nothing went red. Not the 1400-test suite, not typecheck, not tier-1, not tier-2 — because no tier
drives `qa-main.js`. It took a human-paced browser drive to notice. And the failure mode is the worst
shape available: a rejected dialect does not throw, it degrades to the same honest-looking answer the
feature gives when it legitimately finds nothing. The screen said "we couldn't place this", which is
a real, expected, correct-looking state. **A broken fake does not look broken; it looks like the
feature working and finding nothing.**

The root cause was not the stale line — it was that nothing *could* test it: `qa-main.ts` starts a
server at import, so the fake was unreachable from any test. The fix was to move the answer into its
own module (`qaFamilyAnswer.ts`) and drive it through the *real* labeler, contract and published
registry in a test.

**The check to run: when you change a shape a model answers in, grep for every fake that produces
it — the ones outside the test suite most of all.** And make the guard assert the **mechanism**, not
the string: any rejected dialect shows up as *two* model calls (the retry) ending in `unmapped`, so
asserting `calls === 1` catches the whole class, where asserting the JSON only catches today's
instance. The same hazard sits in every `e5stub`/recording/fake in this repo.

## When a stored value is also a checkpoint, persisting a fallback makes the failure permanent

#221's labeler skips any block that already has a placement — that skip IS the "a retry never
re-spends a completed call" rule, and it is the cheapest possible checkpoint. But `place()` degrades
an unusable model answer to `unmapped`, and the first cut stored that like any other answer. The two
correct-looking decisions compose into a bug neither one has: the block now *has* a placement, so it
is never asked again, so one bad minute is frozen into the record forever.

The target-role path in the very same file already carried the rule — *"a degraded answer is never
remembered … one bad minute would follow a visitor around"* — and the new caller simply did not
honour it, because from the caller's side the degraded flag looks like optional detail.

**The check to run: for every value you persist, ask what reads it as "already done".** If a fallback
lands in a field that gates re-attempting, the fallback must not be written — leave the absence.
Absence is retryable; a default is not. This applies to every checkpointed step in `pipeline.ts` and
to any `?? DEFAULT` written into a store.

## A measurement harness that can't tell "the model answered X" from "the call failed" will lie to you confidently

Building #220's 60-case accuracy grid, five model calls ran concurrently through the local Claude
Code CLI. Roughly a third of them failed — and the labeler, correctly, degrades an unusable answer to
`unmapped`. So the report came back saying the labeler had turned away *"Senior IT Project Manager"*.
It hadn't: asked on its own, that exact role answered perfectly. A later run on the same prompt
confirmed **"Sous chef"** as IT project delivery. Two runs, opposite pathologies, same code. I tuned
the prompt twice against noise before spotting it.

**The tell was available immediately and I missed it: no competent model confirms a sous chef as a
project manager.** When a measured result implies the thing under test is not merely wrong but
*absurd*, suspect the instrument before the subject.

The fix is structural, not procedural. A grid entry now counts **its own** calls through a per-case
wrapper, so "used its retry and still came back unmapped" is recorded as `degraded`, and the run
**refuses to report any score at all** if a single case degraded. Two properties worth copying to
the next eval: the failure mode and the honest answer must not share a representation, and a harness
must be able to fail *loudly about itself*, not just about its subject.

Corollary, cheap and separate: a paid ten-minute run whose only record is stdout is one `| tail -5`
away from being paid for twice. It was. Evals write their results to disk.

## The model barely matters for mechanical work — measure it instead of assuming

Eight models (GLM 5.2, Kimi K2.6, DeepSeek V4 Pro/Flash, Qwen 3.7 Plus, MiniMax M3, GPT-OSS 120B,
Nemotron 3.5) over the identical 60-case grid landed **within five points of each other — while
their prices spread 27×**. For closed-list classification with a short strict-JSON answer, paying
frontier rates buys nothing measurable. Speed varied more usefully than accuracy: GLM and Kimi took
245s and 368s for 60 calls against ~40s for the others, which matters on a call a visitor waits for.

Two things that make this transferable rather than a one-off: the bake-off is ~80 lines because the
grid already existed (`eval/harness.ts` runs any `LlmClient`), and **it does not generalise to the CV
brain** — mining and tailoring have no grader yet, and that is exactly where a weaker model does the
damage this product exists to prevent. Cheap model per measured stage, never per assumption.

## When every model disagrees with your test, suspect the test

All eight bake-off models called "Product Delivery Manager", "Technical Product Delivery Lead" and
friends plain delivery jobs; my grid said "ambiguous, ask the visitor". Eight independent models from
five labs agreeing against one hand-written label is evidence about the label. They were right —
"product" there is *what is delivered*, not a second craft — and the titles that genuinely join two
crafts ("Head of Product **&** Delivery", "Product Owner **/** Delivery Lead") every model already
flagged correctly, which is what proved the mechanism worked and only the labels were wrong.

The trap on the other side is real and worth naming: correcting a grid *after* seeing what failed is
one step from grading to the answers. Two guards used here — the owner arbitrated the change rather
than the author, and each corrected case carries its own note saying what it was, what it became, and
how many models dissented. The residue is honest: the pass margin is now a single case.

## Before building a gate, drive the flow that has to pass it — and ask "who has ever passed it?"

#63's job was to let a real reveal through a gate the server already owned. The retrieval engine was
finished, the four outcomes were contracted, the ACs were crisp; everything read as ready. It was
ready. **The gate had simply never been passable by anyone.** Placement was never wired in `main.ts`,
so `server.ts`'s default answered `unmapped` for every visitor; and the shipped discovery screen asks
one floor's items while the gate checks a completely different floor's. Both were plainly visible in
the code and neither is visible in a ticket.

Reading found it, but only slowly and only because I got suspicious. **A 40-line throwaway probe
that drove the real flow and printed the request the gate receives settled it in one run** — with the
gate's own verdict (`invalid_request / family_not_published`) and the deck's 8 fixture cards in the
same output. That probe would have been the *cheapest first move*, not the confirmation step.

**The generalisable question: for a feature gated on earned state, name a visitor who has reached
that state.** If the answer comes from reading code paths rather than from a run, produce the run.
Related shape, already in this file: a green journey that skipped its own point — "no contradiction"
is not "covered". Here it was "the gate is implemented" mistaken for "the gate is reachable".

## A QA report is written relative to the CWD — `apps/web/qa-results`, not `apps/web/e2e/qa-results`

Both directories exist. `apps/web/e2e/qa-results/` holds runs someone once started from inside
`e2e/`, and its newest report is from **June**. Journeys are run from `apps/web`, so today's reports
land in `apps/web/qa-results/`. During #209 I spent close to an hour diagnosing a "failure" that had
already been fixed, because `ls -dt e2e/qa-results/…| head -1` cheerfully returned a two-month-old
report every time and I read its verdict as the run I had just done. The API logs said the deck had
11 cards; the "report" said 8; I went looking for a caching bug that did not exist.

**The journey prints its own report path on the last line — read that, never a glob.** And when a
server-side measurement and a report disagree flatly, suspect the report you are reading is not the
run you just made before suspecting the product.

## A green journey can be a journey that skipped its own point

`language-ladder-journey.mjs` printed **"35 passed, 0 failed"** both when its deck half ran and when
it self-skipped with `SKIPPING the deck half: the API is not serving the language adverts this
journey needs`. The skip is a `qa.note`, and a note is never a failure. So the summary line is not
evidence of coverage — it is evidence of no contradiction.

**Grep the report for the journey's own skip notes before believing a pass**, and prefer a skip that
FAILS when the run was supposed to cover that half. This is the same shape as the repo's standing
"found-nothing vs did-not-run" rule (ADR-0010), one level up: at the journey, not the assertion.

## When every option on the table loses, the missing rule is a product promise nobody wrote down

#211 offered three ways to split a skill list. All three were graded on *reader stability*, and the
owner rejected all three — because the winner produced a master CV missing a skill the person's own
CV mentions. The criterion that decided it, **the master CV must be better than the file uploaded**,
existed only in his head. It had already decided #210 silently.

**A ticket that presents candidates which are all wrong is usually complete on its own terms and
missing an outer one.** Before recommending, ask what the *page* has to look like, not what the store
has to hold — this repo's questions arrive framed as storage and are almost always about output.
The tell is a recommendation whose stated cost is *"the person just won't see X"*. It is now
**ADR-0013**, so the next ticket argues from it instead of re-deriving it.

## Read the renderer before promising the renderer will do it

Mid-#211 I recommended *"the writer lifts tool names into the Skills section"* — a clean answer that
kept the reader stable and the bullet whole. `apps/api/src/rootcv.ts` is **mechanical**: it groups
confirmed records by kind tag and prints them. No model, no lifting. The profile screen uses the same
records and the same section list. So the answer was impossible, and the real constraint was the
opposite: **for anything to appear on the master CV or the profile, a record must exist.**

Two renderers exist and they behave differently — `preview-tailor.md` is an LLM and can compose;
`rootcv.ts` cannot. **Check which one your design is asking to be clever before you pitch it.**

## Bypass the turbo cache with `TURBO_FORCE=1`, never `pnpm test -- --force`

`pnpm test -- --force` forwards `--force` to vitest, which rejects it (`CACError: Unknown option
--force`) and fails `@jobcrush/contracts#test`. A future agent reads that as a broken build and
starts debugging a repo that is fine. **Use `TURBO_FORCE=1 pnpm test`** (same for `pnpm typecheck`)
when a run must not be served from cache — a QA gate re-running gates on a cached "7/7 successful"
has verified nothing.

## Run the code to find the gap; reading the diff finds the gap you already thought of

Three review passes went over #208 — two axes plus a QA gate — and all three converged on the same
disclosed hole: *a split can amputate its result*. A five-line script calling the real functions
found a different and worse one in two minutes: a **partially printed** compound claim reports
nothing at all, which silently breaks a promise the ADRs make in writing.

Reviewers reason about the diff, so they find refinements of what the diff already discusses. **A
probe asks the code a question the diff never raised.** When a change alters what a stored unit
*is*, write the throwaway script and try the shapes nobody wrote a test for — especially the ones
that look like non-events (one bullet, one id, nothing anomalous). Cost: two minutes. It produced
[#212](https://github.com/adrien-mounier/jobcrush-app/issues/212).

## A test that cannot fail on the thing it names is worse than no test

#208 added a test asserting the conservation lint passes when one claim is printed as two bullets.
It passes — but each divided bullet cites one claim, and the rule it appears to exercise only fires
at two or more, so the test could never have failed for the reason its name implies. **Before
writing a test for an interaction, find the line in the code that would flip it red.** If there
isn't one, the honest output is a comment saying the case is unchecked, not a green assertion that
reads like coverage. The replacement test puts a division and a bad merge in the same role, which
does fail if the loop is changed.

## A ticket's evidence can be one cherry-picked sample, and the fix built on it will fail

#202 asked for a specific fix — back-reference achievements by job index — justified by one variant
scoring 25 bullets where the others scored 11. **That 25 was sample 1 of 3. The other two scored 11.**
The fix had already failed twice in the data the ticket was written from, and nobody noticed because
only the good number reached the prose.

Re-counting the raw outputs took twenty minutes and retired three of the ticket's premises, including
one I had repeated to the owner as a live production risk. **Before building a fix a ticket names,
re-derive its headline number from the raw data.** Numbers that travel into prose lose their sample
count, and a mean is not a measurement when n=3 and the spread is 2.3x.

## Ask whether variance hurts the product or only the measurement

I argued against mining skills out of job prose because the count swung 17→44 between two runs of the
same CV. The owner's answer retired it in one line: **a CV is read once.** A judgement that would
differ between two hypothetical runs is never visible to anyone, because the second run never happens.

The instability is real and still matters — for *grading*, which is why skills stay out of #202's
answer key. It does not matter for the product. **"This is non-deterministic" is only an objection
when something re-runs it.** Check which side of that line you are on before spending the objection.

## A research ticket that forbids product code cannot hold a product fix

#202's acceptance criteria say no prototype code may land in the pipeline. Its task list then asked
for a live prompt to be changed. Both were mine, written an hour apart, and the owner caught it.

The fix became #208. **When a research pass discovers a product defect, it files it — it does not
adopt it.** The tell is a task that would leave `git status` dirty in a ticket whose closing criterion
is a clean one.

## An urgency argument needs a user to be real

#208 was ranked above the test-debt ticket because "every upload adds rows in the shape we ruled
against". The owner: nobody uses the app yet, and will not soon. **Nothing accrues, so there was no
bleeding to stop**, and the cheaper ticket that unblocks three others went first instead.

Accrual, drift and data-shape arguments all assume traffic. In a pre-launch repo they are worth
recording as future costs and worth **nothing** as ordering arguments. The correction is left visible
in `roadmap.md` — a false urgency argument is worse than none, because it looks like diligence.

## A test that matches a button by its words fails the day the words are right

#165 reworded one button. It broke `years-worked-out-journey` — a tier-2 CI gate about
years-of-experience, which names no language and asserts nothing about them. The journey walks the
whole ask-list, matched the languages question's confirm by literal label, and when the label
changed the walk **stalled on that question and never reached the date question it was actually
testing**. Four assertions failed, none of them about the thing that changed.

**The tell is the failure's shape:** assertions fail *downstream* of an interaction that silently
did nothing. A stalled walk reads exactly like a broken feature.

Match a control by role or by a structural selector (`.elig-actions .go`), never by its sentence.
Copy is the most-edited thing in the product and the least load-bearing — pinning it inverts that.
This was the **third** copy-pin in one ticket: two stale journeys the QA gate caught, four frozen
mock payloads, and this. I fixed the first two batches by updating the words, which is why the third
was still armed. Updating a pinned string fixes today; removing the pin fixes the class.

## Tier 1 green does not mean the e2e gate is green

`pnpm test` runs no browser tests at all. `e2e:mocked` (tier 1, `*.spec.ts`) and `e2e:tier2` (six
hand-picked real-stack journeys) are **separate** CI jobs, and only tier 2 walks whole funnels — so
it is the one that catches a change to a question every funnel passes through. I ran tier 1, saw
131 green, and pushed; CI failed on tier 2 nine minutes later. The QA gate had even named tier 2 as
unrun. **Before pushing anything that touches a shared step of the sign-up funnel, run
`node e2e/run-tier2.mjs` — and give it a port nothing else owns** (`SHARED_INFRA.md`: both projects
default to 3000; my first attempt bound nothing, ran all six journeys against a stranger's server,
and reported a confident 6/6 failure that meant nothing).

## When a ticket says a source is normative, diff your design against that source line by line

#165 named #125 normative — *"all six"*. I read #125's issue body, built a five-rung ladder that felt
right, and invented a rung. #125 decision 3 pins six, verbatim, **in a comment on the issue, not in
its body** — and `gh issue view` without `--comments` never shows them. The reviewer found it in
minutes because it compared a list to a list, which is exactly the check I skipped by reasoning about
the shape instead of reading it. **Fetch the comments too, and when a normative source enumerates
anything, paste its enumeration into the code and diff — do not re-derive it.**

## An answer the UI never displays gets deleted by the next unrelated edit

#165 stores *"I don't speak this one"* as a language fact, and deliberately never shows it in the
person's declared-languages list — it is not a language they have. But the declaring question retracts
any language *absent* from its answer, and that answer is built from the list. So the deliberate
answer was **absent by construction**, and any later edit to their languages silently deleted it,
re-opening a question they had already answered. **Whenever a stored value is hidden from the control
that writes its neighbours, check what that control does with values it cannot see** — "absent from
the form" and "the person removed it" are different facts, and a delta write cannot tell them apart.

## A warning deleted because it became false still has to be re-homed if the risk moved

#165 rewrote the languages question's consequence line, correctly: it warned about a removal that the
new design cannot cause. But the risk did not disappear — it **moved** to the new ladder's bottom
rung, and that screen shipped with no warning at all, quietly dropping a decision (#125 decision 4:
*"the screen must say so before she answers, not after"*) that nobody meant to reverse. **When a
safety line stops being true, find where its danger went before deleting it.** Ask which screen now
carries the tap that costs something.

## A ticket's body AND its own impact comment can both be stale — check every AC against HEAD first

#154 arrived with four acceptance criteria. **Three had already landed** with #153/#158 a week earlier,
and the impact comment written to correct the body was itself out of date: it stated
*"`preview-tailor.md` rule 8 still carries the old ladder and the old merge instruction verbatim"* when
the prompt had already been rewritten. Ten minutes of reading the four files the ticket names turned a
four-part build into a three-part one and re-pointed the design at the only real gap. In a repo where
decision passes and build passes are separate sessions, **the issue tracker lags the code by design** —
read the code, then rewrite the ticket body as part of the work.

## A declared-field check must check containment, not presence

#154's fix has the writer declare, in a field of its own, the outcome a merged bullet kept. Checking
that the field is *non-empty* would have passed the exact bug: a clean outcome in the data beside a
scope list on the page, because the field is never printed. The check that works is that the declared
words appear **verbatim inside the text that prints**. Whenever a model is asked to self-declare a
property, ask what stops the declaration from being decorative — and prefer the mechanical check that
ties the declaration to the artefact the user actually sees.

## Check an architecture finding against the code before building the fix

Two of the three deferred findings from the session-104 architecture review did not survive contact
with the source. The counters candidate rested on "alarm logic is untestable" (it is pure and has 10
exact-number assertions already) and "the deck double-counts withdrawals as a workaround" (the second
count is a per-response field the web renders — a different thing, not a workaround). A review that
reads *shapes* — a big module, a repeated-looking number — generates plausible findings that a look at
the tests and the consumer falsifies in minutes. Re-verify each finding at build time, and write the
refusal down with its evidence so the next review does not re-propose it.

## The obvious home for a moved helper may be the one that creates an import cycle

The review said discovery's question-ordering rule belonged in `discovery.ts`. But
`eligibilityDiscovery.ts` already imports `discovery.ts`, so moving it there would have inverted a
dependency into a cycle. The right home was the *importing* module, beside the function generating the
questions being ordered. Check the existing import direction before naming a destination module.

## Never `git add -A` in this repo — stage the files you touched, by name

Sessions leave working artifacts at the repo root and under apps/web (screenshots, .scratch scripts,
council reports, .tokensave/.impeccable state, `.claude/worktrees/` embedded repos). A `git add -A`
on 2026-08-12 committed and pushed 100+ of them, including two embedded git repos that would break
clones. The sweep class is gitignored now, but the habit is the real fix: stage explicit paths, and
treat "145 files changed" on a surgical refactor as a stop sign before pushing.

## A pointer-drag guard held in React state is already stale when the click fires

The confirm deck guarded its card's `onClick` with `!dragging` — but `setDragging(false)` runs in
the pointer-release handler, and the browser dispatches the synthetic click *after* that, against the
re-rendered state. Every completed swipe therefore also fired the tap action (QA caught it live; unit
gates cannot — web has no unit runner). Guard drag-vs-click with a ref set at release when movement
crossed the activation threshold, checked-and-cleared inside the click handler. State is for
rendering; event-ordering races need refs.

## Throwaway workspace copies must live outside the repo

A QA agent duplicated `apps/web` to `apps/web-qa161` inside the repo to build against its own ports.
pnpm discovers workspaces by glob, saw two packages named `@jobcrush/web`, and every whole-tree gate
(test, typecheck) failed at resolution — blocking an unrelated slice's push until the copy was gone.
Scratch copies of a workspace package go in the session scratch dir, never under the repo root.

## Both miners end in the same data marker — match prompts affirmatively, not by marker

`claim-miner.md` and `job-block-miner.md` both terminate in `===CV-TEXT===`. qa-main's stage-aware
fake routed on that marker alone, so the job-block prompt silently fell into the claim-miner branch
and returned the wrong document shape. Any prompt-routing fake must match each stage by its own
opening line (an affirmative, stage-unique string), with shared data markers checked last.

## Focus after a conditional render belongs after the commit

The language door saved correctly and called `requestAnimationFrame(() => door.focus())` immediately
after `setAsking(false)`. On a fast local render that looked reliable. On Linux CI, the animation frame
ran before React committed the button replacing the form, so the ref was still null and focus stayed
on `body` forever.

When an action swaps the focused surface for its return target, arm the intent first, change state,
then restore focus from an effect keyed to the committed state. A timer or animation frame is not a
React commit boundary. Prove it with repeated save **and cancel** cases, because both exits owe the same
accessibility contract.

## The authority that shows a card must also own every action on it

A real provider job first appeared in the retrieval metadata but not the rendered cards. After that
was fixed, the card rendered but `/want` and Tailor still searched the fixture pool and returned 404.
After *that* was fixed, stale snapshots stayed actionable during refresh; then the first Tailor answer
changed the retrieval fingerprint and orphaned the selected job itself.

The recurring mistake was treating “the deck” as a render problem. A displayed external record opens
an authority chain: **retrieve → render → select → continue → finish**. Test the whole chain with one
identity, including a second state-changing action and a stale/fingerprint-changed snapshot. One
session-owned pool should decide all of it; otherwise each endpoint quietly invents its own truth.

## Job vocabulary is not language evidence

`project manager`, `agile`, `scrum`, `cloud` and even an English-looking heading travel freely inside
French, Indonesian and other job adverts. A ratio over that vocabulary opened the English deck to
non-English posts; a function-word ratio then failed on repeated Spanish `a`.

For a fail-closed language gate, require **distinct language evidence**, positively label the cheap
supported cases before testing English, and treat advert jargon only as shape evidence under a much
narrower structural rule. Every new English rescue case needs an adversarial foreign case through the
same eligibility boundary, not only a detector unit test.

## A failure artifact is not evidence until the host can open it

The shared journey driver finally wrote HTML on crashes, but it wrote PASS before browser cleanup and
used a timestamp ending in `.`. On Windows the resulting report directory existed yet normal
PowerShell and `rg` could not traverse it. The artifact was present and operationally absent at once.

Failure reporting has its own acceptance seam: record cleanup errors **before** final totals, make
finish idempotent, remove global handlers, force the process non-zero, and then reopen the artifact
with the ordinary tools used on the target host. Existence alone is not a usable CI artifact.

## A measurement that moves two variables answers neither

#160 compared today's CV reader against a prototype and reported **0.77×**, read as *"the richer read
is cheaper."* It wasn't a verdict on richness at all. Cost is the **product** of two dials —
**granularity** (records per CV) and **richness** (fields per record) — and the comparison moved both:
*few × rich* against *many × lean*. The cell the product actually needs, *many × rich*, was never
measured, and **both measured shapes were unshippable** under constraints we had already decided.

The tell, and it generalises: before trusting a comparison, **name every dimension that differs between
the two arms.** If more than one does, the number is real but it does not answer the question — and the
danger is that a real number reads as a settled one.

Two habits that would have caught it: state the dials explicitly in the report's headline rather than as
a caveat at the bottom (the caveat *was* there and it did not travel), and ask *"can we actually ship
either arm?"* — if neither is shippable, the comparison cannot decide anything.

## A test gate that mocks the network does not exercise what you built for it

We checked in a fake-model API so the e2e suite could run, wired the route-mocked specs into CI, and
they went green. But those specs mock **every** pipeline call — **the fake model was never invoked.**
It could have returned `"{}"` for everything and the deploy gate would have stayed green.

The fix that generalises is not "make the gate drive the model." Route-mocked specs are the right cheap
tier. It is: **when a gate deliberately does not exercise something, assert that** — a post-run step now
fails the job if the fake was touched at all. The weakness became a checked invariant instead of a
comment nobody reads, and if a future spec starts hitting it, we hear about it.

Same family as the repo's standing rule: *found nothing* must differ from *did not run*. Here the third
state was worse — **ran, proved nothing, reported success.**

## A test double that reads ambient env will find your production infrastructure

The QA server isolated the model and the upload directory, then called `storageFromEnv()` and
`mailerFromEnv()`. Both read ambient config — so run it in a shell with `R2_*` or `RESEND_API_KEY`
exported (an ops shell, routinely) and the "costs nothing, touches nothing" run **writes to the
Cloudflare bucket shared with the sibling project and sends real email.** The same shape was then found
in `guestbook`, reading `DATABASE_URL`.

**A `*FromEnv()` helper is an ambient-authority hole in anything that claims to be isolated.** Construct
the local implementation directly — `new LocalDiskStorage(...)`, `new DevMailer(...)` — so isolation is
structural rather than dependent on a clean shell. And when you find one, **grep for the whole family**;
they cluster.

Related, same session: the QA server defaulted to production's own port, and `/healthz` answered
identically on both — so a health-wait could pass **against the real API** and a "never spend money" run
would spend. **A liveness probe must prove *which* server answered**, not that something did.

## Tests nobody can run rot, and the missing piece is usually smaller than a strategy

33 e2e files sat in this repo; CI ran none. It looked like a testing-culture problem. It was one missing
file: **there was no checked-in way to start the API with a fake model**, so every QA session hand-built
a throwaway one and deleted it. Running the suite meant rebuilding scaffolding first, so nobody did.
Once a ~140-line entry existed, **10 previously-unrunnable journeys passed on the first try** and the
full sweep found **zero real defects** — the product was fine, the tests had simply rotted.

Before proposing a testing initiative, **check whether the tests already exist and are merely
unreachable.** And measure before building: the sweep also overturned two assumptions this session had
stated confidently — that all the browser specs needed a paid key (only 1 of 9 did) and that a spec
file's failures were all staleness (6 of 7 were a rate limiter poisoning the run).

## A schema default cannot tell "deliberately empty" from "never arrived"

Relaxing a required field to allow an empty value is not the same as making it optional. `z.string()`
allows `""` while still rejecting a **missing key**; `z.string().default("")` silently manufactures the
empty value when the key is absent — and on an LLM boundary, absent is exactly what a truncated or
retried response produces. The default then swallows the validation error that would have driven the
retry, and the empty result is byte-identical to a correct one.

The tell: when the empty value is a **decision the producer must state**, a default is wrong, because
it lets a non-answer impersonate an answer. Reach for the default only when absence genuinely means
"caller didn't supply this", never when it means "the model failed to say".

This is the same shape as the repo's standing rule that *found nothing* must be distinguishable from
*did not run* — the third time that rule has been broken in a new place. Both review axes caught this
one independently, which is an argument for keeping the two axes unmerged.

## Fix the path production takes, not the one that reads like the implementation

A rule removed from a template that only runs as a **fallback** is not removed from the product. The
grill's date question is LLM-phrased in production (`makeGrillPhraser`); `templateQuestion()` fires
only when the model fails — so deleting the banned phrasing from the template left the shipped question
free to say it, while a test asserting on the template passed.

Before claiming a behavioural rule is enforced, trace which code the deployed wiring actually reaches
(`main.ts` is the honest map here) and pin the test **there** — for a prompt-shaped rule, by capturing
the real prompt sent to a fake LLM. A test on the fallback is a test on the error path.

## A startup guard must assert what the code CAN do, never what this environment DID construct

A guard checking "was a driver instance constructed" conflates two conditions that need opposite
responses: **no implementation exists anywhere** (a build-time defect — fail fast, loudly) and **the
implementation exists but declined for a config reason** (a legitimate runtime state the system already
degrades honestly for). Asserting on constructed instances turned a missing `TECHMAP_RAPIDAPI_KEY` into
a boot crash — converting one paid provider's absent key into a whole-API outage, on a repo where a
green push auto-deploys.

Assert on **capability, derived from the code itself** (here: each driver class's `static readonly
providerId`, so a phantom id cannot exist without a class declaring it), and run the check **before**
constructing anything, so config is structurally unable to reach it. Fail-fast belongs to defects that
are always mistakes; anything an environment may legitimately lack must degrade, not crash.

Corollary worth the ten lines: **nothing proved `main.ts` called the guard at all** — deleting the
try/catch left the entire suite green. An entry point's wiring is usually untested; a source-level
assertion in the `onboardingRatchet.test.ts` idiom is cheap and beats trusting it.

## A ticket's blockers can outlive the work that satisfied them

Eleven build tickets sat blocked on a design register whose five items had all been decided weeks
earlier and posted onto the tickets they bind — the register was simply never closed. Nothing in the
tracker notices that a blocker has become vacuous, so the frontier reads as empty while the real
constraint is bookkeeping.

When a frontier looks thin, check whether the blockers are still *true* rather than merely *open* —
and when closing such a ticket, hunt for anything **routed back to it**. This one carried an open
residual that the close would have orphaned; it needed a new home first. "Close only when the items
have somewhere better to live" is a condition to verify, not a formality.

## A durable background claim needs a lease, an owner, and the raw replacement coordinate

A persisted `in_flight` boolean or fingerprint is not recoverable state. If the worker dies, it stays
set forever; if a later worker takes over, the old worker can still publish unless completion proves
ownership. The complete shape is a bounded lease, a unique owner token, and compare-and-set completion.

There is a less obvious companion: safe parsing can reject an old snapshot while its durable request
fingerprint remains valid coordination data. Throwing that raw fingerprint away makes replacement
impossible because the next claim compares `null` with the stored value. Parse the payload fail-closed,
but preserve the raw replacement coordinate. The same instant-versus-representation rule applies to
timestamps across store drivers: normalize valid timestamps before ordering them, never compare offset
strings lexicographically.

## With zero fresh results, incomplete coverage outranks stale evidence

Stale records answer "what did we know before"; coverage answers "did every eligible source answer now."
When there are no fresh postings and even one source failed, the honest result is `provider_unavailable`,
not `stale_data`: otherwise an outage disappears behind weaker old evidence. Outcome unions need an
explicit precedence table and mixed-state tests, not only one test per arm.

## A tool that anchors on `</body>` finds nothing in a file the browser renders fine

The impeccable live-mode injector writes its script before `</body>` — and 14 of our 17 prototype
files never had one (browsers auto-close, so nothing ever looked wrong). The injector reported
overall success while silently skipping them; the symptom was "I don't see any bar" on exactly the
file the owner opened. Two takeaways: **prototype HTML gets real closing tags from now on** (they
cost nothing and every anchor-based tool assumes them), and when a tool reports success over a
file set, check *per file* — the found-nothing/didn't-run distinction this project keeps relearning
applies to third-party tooling too.

## A style probe varies material and type, or it shows nothing

Round 1 of the North Star probe held layout/type/material constant and swapped palette tokens —
correct discipline for comparing a *control*, and exactly wrong for comparing a *world*: the owner's
verdict was "they all look the same." A world lives in type voice, materials, shapes, and one
signature detail each; and side-by-side phones beat a switcher for style questions, because nobody
compares moods from memory. (Controls stay switcher-compared; worlds go side by side, turned up
loud, tuned down after the pick.)

## Before rationing something, check the pipeline can see it

#153 spent its whole brief on how to split a per-role bullet budget, and the research it commissioned
recommended the fix every serious competitor uses: **stop capping bullets, cap the page.** The recommendation
is correct and it is unfollowable here — **we have no page.** The tailored CV renders as a scrolling HTML
document: no print stylesheet, no `@page`, no PDF export, no pagination, no page counter. The `pages` field
in the codebase reads the *uploaded* PDF and never our own output. So the two-page rule that has sat in the
prompt and the authoring rules the whole time **has never been checked by anything**, while the per-role cap
beside it is enforced three times over, including as a hard schema rejection.

That asymmetry — **a tight enforced constraint standing in for a loose unenforced one** — is what actually
caused the damage, not the number. It is worth looking for by name: when two constraints are meant to work
together and only one is real, the real one silently does the other's job, badly.

The generalisation for a research brief: **a competitor's mechanism is a finding about their pipeline, not
about ours.** Both products the research pointed at render to LaTeX/PDF and count pages for real. Check the
seam exists here before adopting the rule that rests on it.

## Nothing can check a rule about text the model rewrote, unless the rewrite carries its sources

The owner asked what looked like a small clarifying question — *"merge only two bullets that genuinely
overlap: how do we define that, is it just LLM judgment?"* Checked in code, the answer was worse than yes.
`buildTailorInput()` sends the tailor `- [role] text` — **the claim ids exist on the object and are stripped
on the way out** — and a printed bullet is `z.array(z.string())`. So the thread between what the person wrote
and what prints is **cut at both ends**: the tailor is never told which sentence is which and could not say
so if it wanted to.

The consequence is not that one rule is unverifiable. It is that **a merge, a silent drop and an outright
invention are byte-indistinguishable** on every tailored CV the product has ever produced — and *three*
separate written rules (merge-never-drop, the conservation principle, supported-only rendering in #66) are
all phrased as though someone were checking.

The tell, reusable: **if a rule constrains how one text relates to another, and the second text carries no
pointer to the first, the rule is decoration.** ADR-0004 clause 1a already says this for structured facts —
*a fact pointing at nothing is a defect, not a low-confidence result.* The same test applies to rendered
prose and nobody had applied it. ⚠️ And the honest ceiling: the model assigns those pointers, so tying the
thread buys **checkable**, not **correct**.

## Ladder the spend, not the cap

Twice on map #127 a recency rule was written as per-item numbers (*newest 8, normal 4-6, old 3-4*; then the
owner's *newest 10, next 9, next 8*). Both encode a true instinct — recent work deserves more room — and
both break the same two ways: they **contradict the total budget** (10+9+8 = 27 against a ~24-bullet page)
and they **need a new table for every list length** (six roles = 45 bullets, nearly four pages).

Moving the ladder from the **cap** to the **spend** — *"the newest gets first call on the budget, each older
one less, nothing over the guard rail"* — fixes both at once: it can never exceed the total because the total
is the rule, and it holds for three roles or eight with no new number.

Two riders learned with it. **A per-item cap set at the average is the worst possible number**, because it
forbids exactly the unevenness that makes the artifact good. And **"should try to reach the maximum" is a
floor**, not a target — every padding and squishing pathology on this map traces back to a floor.

## When a rule, an ADR and the running code all answer one question, there are three answers

#143 asked what to do about a missing month. The project had **three live answers and did not know it**:
#128 decided *every missing month is asked*; ADR-0003 clause 5 overruled that to *ask only when a bar or a
suspected gap turns on it*; and `apps/api/src/grill.ts` does **neither** — it asks only when a role has no
dates **at all**, and the question it asks says ***"Roughly is fine."***

The two written answers were easy to find because both are documents and documents cite each other. **The
third was invisible because nobody had written it down** — it is not a decision, it is what the code
happens to do, and no artifact describes it. It was also the one that mattered most: *"roughly is fine"* is
the product **manufacturing** the coarse dates the CV rules then spend three paragraphs handling.

The sibling lesson below (*a claim copied into a third document*) is about a written claim that gained false
corroboration. This is the inverse: **the code is a position in the argument, and it never files a brief.**
Before reconciling two documents, read the code as a third party to the disagreement — not to check whether
the documents are right, but because it may be saying something neither of them says.

## A phrase that appears only in the rules is not a mechanism

`cv-authoring-rules.md` says three separate times that a year-only date must *"raise a fix-this item asking
for the months"*. #143 was about to design around that mechanism — where it should appear, whether it counts
as asking, how it interacts with ADR-0003's blank.

**`fix-this item` appears nowhere in the product.** The shipped review surface (`apps/api/src/audit.ts`) only
ever comments on **bullets**; it has no route to a date and no place to put one. The rule has been written,
cited and reasoned about for months, and has never once run.

The cost of not checking is not a wrong decision — it is a decision **about nothing**, indistinguishable from
a real one until someone tries to build it. **One `grep` for the noun separates a rule that runs from a rule
that has only ever been read.** Same shape as *research the repo depends on must be committed*: the artifact
exists, the wiring does not, and nothing complains.

## "Every X asks for Y" is a measurable claim, and this repo has the X sitting in it

`docs/cv-brain/tailoring-reasoning.md` §4 throws away an entire class of CV content — budget,
stakeholder management, agile familiarity — on a stated justification: they are dropped *"precisely
because every PM ad asks for it"*. The rule was ported, read once, misread once, re-clarified, and
built on. **Nobody counted.**

Counted against the seventeen real postings in `apps/api/data/sample-postings.json`: **budget appears
in 7, Agile in 3** — and one of those three is motivational boilerplate rather than a requirement. The
universal that justified the rule is false in our own corpus, and the corpus was in the repo the whole
time.

**The generalisable part: a justification phrased as a universal is a hypothesis wearing the clothes of
a premise.** *Every*, *always*, *never*, *by definition* read as settled and pass review unchallenged,
because arguing with them feels like arguing with a definition rather than with a measurement. The tell
is that they are usually the *load-bearing* sentence — the one clause that makes the rest of the rule
safe — which is exactly why nobody pokes at it.

**The tell to reuse:** when a rule's justification contains *every* or *never* about the outside world,
ask **what would count as a counterexample** and **whether the repo already holds enough data to look**.
In a product built on a corpus, the answer to the second is usually yes. Counting took ten minutes and
invalidated a premise two design sessions had rested on.

## The schema tells you what the code can do; the CV brain tells you what it is supposed to do

The owner asked whether a `Project Achievements` sub-heading would survive onto a tailored CV. Reading
the `Draft` schema in `apps/api/src/preview.ts` gives a clean answer — a job holds a flat array of
bullet strings, there is no sub-heading slot, so no. **That answer was wrong**, and it was delivered
with confidence because the schema is unambiguous.

`docs/cv-brain/cv-authoring-rules.md:37-39` had already specified the construct in full: sub-groups
render as a standalone italic line, the canonical term is **"Key Deliveries"**, use only when there are
2+ achievements, at most one per role, and it counts toward the bullet cap. The rules even anticipate
the abuse. The renderer simply never implemented any of it, and **nothing anywhere records that gap** —
so the schema reads as the complete truth.

**The generalisable part: in this repo the code is downstream of a specification that lives in prose,
and an unimplemented rule leaves no trace in the code.** Absence in the schema is therefore ambiguous
between *"decided against"* and *"never built"*, and those two produce opposite answers to a design
question. `CLAUDE.md` says `docs/cv-brain/` is *"what the pipeline must stay true to"*; a gap between
them is a defect in the pipeline, not a decision.

**The tell to reuse:** before answering *"can the product do X?"* from a schema, grep the CV brain for
X. And when a rule turns out to be unimplemented, that is a **ticket**, not a footnote — a written rule
with no implementation and no warning is worse than either having it or deleting it, because the next
reader will cite it as live. (#155 is the one this produced.)

## A count over a corpus is not a distribution, and the ratio can be one document

[#150](https://github.com/adrien-mounier/jobcrush-app/issues/150) opened with a number that looked
decisive: **~3 standalone project entries against ~21 nested inside jobs, about 7 to 1.** The count was
honest and correctly measured. It was also, on inspection, **~18 of the ~22 from a single CV** — a façade
draughtsman in France and Switzerland. Across the five CVs in the market this product actually serves, the
same count is **zero**.

The ratio survived a research pass, a ticket brief, an ADR's consequences section and two rounds of design
argument before anyone asked which documents it came from. **Nothing about the number was wrong; the
inference from it — *"this is the shape our users write"* — was never checked.**

**The same read exposed a second version of the same error.** The ticket described those nested projects as
carrying *"a client, dates and their own bullets"*. Read at source: **0 of 18 carry a date of their own**
(the dates belong to a client block), **10 of 18 have no bullets at all**, and the rich shape exists **four
times in the whole corpus**. We were within one ticket of building a date field for values no document
contained.

**The generalisable part: an aggregate over a small corpus hides its own concentration.** With six
documents, one outlier *is* the statistic. The failure is not miscounting — it is treating a corpus-wide
ratio as a per-user frequency when a single document can supply the entire numerator.

**The tell to reuse:** before designing to a ratio, ask **how many documents produced it** and **how many
of those are in the market you serve**. If the answer is *one* and *none*, the number is describing
somebody else's users. And when a ticket summarises a source artifact, **re-read the artifact** — a summary
is where a shape gets tidier than it really is.

## When a rule forbids one shape from reaching a dangerous slot, check what else has that shape

[ADR-0006](docs/adr/0006-a-project-is-a-container-not-a-fact.md) clause 5 exists to stop a **project name**
becoming an employer the person never worked for — a real observed parser failure, taken seriously, written
as a rule. The rule names projects, because projects were what the ticket was about.

**The hazard sitting beside it was never named.** The same CV carries `ASSYTEM (client) - 02/2021 -
05/2021` — a **name plus a date range nested under an employer**, which is byte-for-byte the shape of an
employment block, and rather *more* job-like than a project title. Nothing anywhere forbids a client
reaching the same slot. It is blocked today only by an accident: the contract requires a title, and a
client block has none — so the fabrication fails validation rather than being caught by a rule, and the
record it depends on is scheduled to be rewritten.

**The generalisable part: a guardrail written during one investigation inherits that investigation's
subject.** It protects the slot from the thing you were looking at, not from the slot's actual shape. The
neighbour that shares the shape is invisible precisely because nobody was asking about it.

**The tell to reuse:** when writing *"X must never become a Y"*, stop and ask **what a Y looks like
structurally**, then scan the same source for anything else matching that description. And treat *"the
contract happens to reject it"* as an unguarded case, not a guarded one — a shape that fails validation by
luck is one schema change away from succeeding.

## A rule with two settings will invent a fallback, and the fallback is where the user gets hurt

[#131](https://github.com/adrien-mounier/jobcrush-app/issues/131) inherited a one-line rule — *never ask
for what you can compute* — and framed the answer as a switch: a fact is **computed**, or it is **asked**.
The framing survived a ticket brief, a blocked-by wiring and two sessions of map edits before it was walked
through a real person.

**It fails on the first case where the computation cannot run.** Mei's middle position has no dates, so
years of experience is uncomputable. The rule has exactly one move left — ask her — and her answer is
**deleted by the next recalculation**, because the same map had already decided the total is a regenerable
copy whose source facts always win. **The two-setting rule does not merely give a poor answer; it
manufactures a question that was never going to count.**

**The generalisable part: when a binary rule meets a case neither branch covers, it does not error — it
silently picks the nearer branch.** That is worse than a gap, because the gap is invisible in review and
only appears as a user losing something they typed. The fix was not a better fallback but a **third
category** (*read* / *worked out* / *asked*) plus an absolute: **a worked-out value is never asked, under
any circumstance, including the one where we cannot work it out.**

**The tell to reuse:** ask what happens when the primary mechanism is unavailable. If the answer is *"then
we do the other one"*, check whether the other one's output survives contact with the first one coming back.

## A ticket can be half-resolved by a later ticket, and nothing tells you

#131's stated danger was the machine asserting a fact from a document that merely implied it — *"her CV is
written in English, so she is fluent in English"*. That was live and real when the ticket was written.

**It was closed two days later by [#140](https://github.com/adrien-mounier/jobcrush-app/issues/140), which
was about something else.** ADR-0004 clause 1a requires every structured fact to point at its origin and
rules that one pointing at **nothing** is a **defect**. The English-fluency inference cites no words, no
answer and no facts underneath — so it was already forbidden, mechanically, by a clause written for skills
and generalised the same day.

Nobody updated #131. Its brief still argued for a test that already existed, and a session that trusted the
brief would have designed a second overlapping rule — **two tests for one question, drifting apart on the
first element that stresses either.**

**The habit this buys:** on a long map, re-read a ticket's *danger* against the ADRs written **after** the
ticket, not just the ones it cites. On #127 this is now the **second** time a ticket's premise had decayed
before it was worked ([#135](https://github.com/adrien-mounier/jobcrush-app/issues/135) found its brief's
central claim false), and both times **finding it out was most of the ticket's value**.

## When a market's convention is the finding, read it in that market's own language

English-language sources agree that Vietnamese CVs carry a photograph, a date of birth and a marital
status. Our deep-source research read the statute and reached a compatible answer. Both were describing
Vietnam from outside.

**The `/last30days` half read Vietnamese career sites in Vietnamese, and found something else.** CareerLink
(27/5/2026) tells candidates to drop ethnicity and religion **completely**, omit the detailed date of birth,
and give marital status only if the advert asks — citing Vietnam's own Labour Code. JobsGO, equally
mainstream, still lists the date of birth as required. **Two major domestic career sites describing the same
convention differently in the same year is a convention in motion, not a settled one** — and no
English-language source said so.

**The check:** when a decision turns on *what people in market X actually do*, at least one source must be
in X's language and dated. An English description of a non-English market is a translation of someone else's
observation, usually older than it looks.

⚠️ **And do not read silence as agreement.** English-language social returned effectively **nothing** on
Vietnamese CV convention. That is not corroboration of the English-language description — the domestic
sources contradict it.

## Two research passes disagreeing is worth more than one passing cleanly

The two halves of the same research ticket returned **opposite answers on the only market that diverged**:
one kept Vietnam's date of birth on a statutory duty, the other found domestic advice split and citing a
different article of the same code.

**Resolving it took one question — which moment does each rule govern?** The disclosure duty (Labour Code
Art 16(2)) applies *before an employment contract is concluded*; the anti-discrimination rule (Art 8)
governs *recruitment*. **A CV is a recruitment artifact**, so the statutory keep was weaker than it read.

**The reusable part is the question, not the answer.** When two sources give a rule about "what an employer
may ask", establish **at which stage** each one bites — advert, application, interview, offer, contract.
Rules that look contradictory usually govern different moments, and a rule quoted without its stage is the
most confidently-wrong kind of evidence.

**And the cheap heuristic that came out of it:** run both halves even when the first looks conclusive. This
map has now run six research legs; the two that changed a decision were both the *second* pass contradicting
the first.

## A regulation names a penalty, not a defendant — check who it binds before designing around it

A whole ticket was built on Singapore's Workplace Fairness Act: *in force ~end-2027, **SGD 50,000 per
violation**, on a collision course with the current CV convention in our primary market.* Every fact was
true. It was carried on the map for two days as **the only ticket with an external deadline attached**,
and it was written into the map body twice.

**And the obligation points at employers.** They must strip age, date of birth, gender, race, religion,
marital status and photograph from applications, and must not select on nationality. **Nothing stops a
candidate writing any of it on their own document.** The fine was never ours and never theirs.

**What that changed:** not the design — we still withhold — but *why*, and therefore *how hard*. A
compliance deadline argues for a blanket rule, shipped by a date, with no override. A **CV-quality**
finding argues for a default the person can reverse, shipped when it is ready. Same output, opposite
posture, and the wrong posture had already made the ticket look urgent.

**The check, and it costs one sentence:** before writing a regulation into a design, name **the party it
binds** and **what happens to our user if they ignore it**. If the answer is *"a third party has to
handle it"*, it is a quality argument, not a deadline.

**And the tell that it went unchecked here:** the ticket's own text said *"puts the current Singaporean
CV convention on a collision course with the law"* — a convention cannot collide with a law that does not
address it. **A regulation summarised without a subject is a regulation nobody has read as applying to
anyone.**

## Before designing to preserve a fact's value, check whether another fact already delivers it

The strongest argument against never printing nationality was that it proves the right to work — the
single most valuable line on a Singapore CV for a foreigner, and **ADR-0002's own worked example**
(*"authorised to work in Singapore"*). That argument made a market-conditional rule look necessary.

**It was false, and one grep settled it.** `work-rights` is already an eligibility dimension: we already
ask *"Can you already work in {city} without visa sponsorship?"*, already store the answer, and already
withdraw jobs on it. **Nationality was never needed to say the useful thing** — a different, better,
already-shipped fact says it, legally and precisely.

**The general shape:** a fact's apparent value is often the value of something it *stands in for*. Before
building machinery to preserve that value, look for the thing it proxies. If the product already holds
it, the expensive design evaporates — and if it does not, you have found a better element than the one
you were about to protect.

⚠️ **This is the same class of error as #135's and #146's premise corrections** — three of this map's six
were *"the code already does this"*, found by reading rather than reasoning. **The pattern is not bad
luck; it is what happens when a design conversation runs longer than the last time anyone opened the
file.**

## `archived: true` is not evidence of abandonment — read the description for a MOVED pointer

This repo called JSON Resume dead **twice**, in two separate research passes, and wrote it into a
shipped ADR: *"fully dead (`resume-schema` **and** `resume-cli`, archived the same day; 27 of 32 org
repos archived)"*. Every one of those facts was true.

**And the conclusion was wrong.** Both archived repos carry a description reading **"MOVED to
jsonresume/jsonresume.org"**, and that monorepo was pushed 2026-07-29 with the npm package published
2026-07-22. A large project consolidating into a monorepo archives its old repos **as the last step of
staying alive** — which looks identical, through the API, to a project that stopped.

**Why it survived two passes:** `archived` is a boolean on the repo object, so it is the easiest signal
to collect and the easiest to sort on. The MOVED pointer is free text in `description`, which nobody
queries. **The cheap signal and the true signal live in different fields.**

**The check, and it costs one request:** before calling a project dead, read the repo *description* and
the package registry's *last publish date*. If either points somewhere, follow it before writing the
verdict down.

**And state liveness as two facts, not one** — *the old home is archived* and *the new home is active
but thin* are both true here, and collapsing them into "dead" or "alive" loses the thing a reader needs.
The honest verdict was **"not a live standard to adopt, but a design worth reading"** — which mattered,
because it is the cleanest published proof of a split (projects vs links) this repo went on to adopt.

⚠️ **Related trap, same session:** the two figures cited for the same repo's stars differed (2.4k vs
4,719) across two agents. When two passes disagree on a number that should be fixed, at least one read
the wrong object — say so rather than picking one.

## "X is impossible here" needs the full list of ways X could happen, not the first one you checked

#146 spent **two rounds** of owner grilling on a fork built from one sentence: *a project can never
satisfy ADR-0001 rule 4's "used in matching" gate, because no advert tests projects.* The evidence for
it was real and verified — 0 of 17 adverts mention projects, no ATS anywhere filters on them, and the
five eligibility dimensions have no slot for one.

**All true, and the conclusion was still wrong.** This product has **two** matching mechanisms. Beside
the eligibility gates that *withdraw* a posting sits the **judged score**, where an LLM grades each
advert requirement against the visitor's confirmed sentences — and its headline rule is *"the
candidate's own phrasing counts"*. Project paragraphs are already mined as claims, so a project already
reached that grader. **The gate was met before the argument started.** The owner ended it by asking why
a project could not just be a bullet.

**The failure is not an unverified premise** — the premise was checked. It is an **incomplete
enumeration**: one path was confirmed blocked and treated as the only path.

**The tell:** the claim has the shape *"the system cannot do X"* and the evidence has the shape *"this
component does not do X"*. Those are different claims. Before spending a decision on the first, list
every component that could do X and check each — `grep` for the capability, not for the component you
had in mind. **Two rounds of a human's time were spent on a fork that reading one more file dissolved.**

## A container is not a fact, and the fact/preference sorting test has no answer for it

ADR-0001 rule 5 sorts every new thing into a **fact** (an advert could test it) or a **preference** (it
only narrows what you are shown). #146 forced a personal project through that test for two rounds and
got no answer, because a project is **neither** — and the sorting test is not broken, it is simply not
about this.

**A container holds no fact of its own.** A project is a name with sentences hanging off it, exactly as
a job is an employer-and-title with sentences hanging off it. Asking *"could an advert test this?"* of a
container is asking what an advert makes of a bracket.

**The tell, and it is cheap to apply:** if the new thing would hold **nothing but a name and the
sentences beneath it**, it is a container. Shape it, print it, and skip the sorting test entirely. If it
holds a value something could be compared against — a level, a date, a country, a credential — it is a
fact and the test applies.

**Why it cost so much here:** "is it a fact or a preference?" is a well-formed-sounding question, so
nobody asks whether it is the right question. The two rounds produced a genuine hole in ADR-0001 — but
a much smaller and more boring one than the "third kind of fact" the session went hunting for.

## An absence cannot fail the way a check can

The obvious design for #141's stretch leak was: keep the stretch in the profile, mark it, and **filter
it out** on adverts it was not approved for. It was rejected, and the argument generalises well beyond
stretches.

**A filter is a thing that runs.** When it does not run — a code path that skips it, a locale it was
never added to, a new reader that does not know about it — the filtered item is simply *present*, and
nothing announces that anything went wrong. The evidence was already in this repo: `career-ops`'
anti-fabrication gate failed three separate times in thirty days (once missing from 16 of 18 prompt
files, once inert in five locales) and still reported `pass`. *"It manufactures confidence."*

**Not storing the thing in that place at all has no failure mode**, because there is no step to skip.

**The same argument then decided a second question one level down.** Given "stretches live somewhere
else", the follow-up was *beside the profile* or *inside it with a marked separation*. A separation
inside one store is a **convention**, enforced by every future reader remembering it — which is a filter
again, wearing different clothes. *Beside* means the consumer physically cannot reach the thing.

**The tell:** whenever a design says *"X is stored here, and everyone who reads here must skip X"*, ask
what happens the day one reader forgets. If the answer is *"X leaks silently"*, the structural option is
usually worth its cost — and the cost should be stated (here: *"everything we know about you"* and
*"everything we have ever said about you"* became two different lists, on purpose).

## Two steps that find the weakest item and then replace it will always find a victim

ADR-0005 clause 4 judges whether a stretch is worth adding, then finds the least-relevant bullet to
displace. Written as those two steps alone, it has a hole that is easy to miss and impossible to see in
the output: **nothing ever compares the two.** Step 1 says *"this is relevant"* — asked in isolation, a
model says yes far too readily — and step 2 dutifully produces the weakest existing item. A swap happens
every time, including when the thing being evicted was better.

**An implicit comparison does not happen.** If two ranked judgements are meant to settle a contest
between their subjects, the contest has to be its own step, stated out loud.

**The tell:** a pipeline where every stage returns a *winner within its own set*, and the final action
depends on a comparison *across* the sets that no stage was asked to make.

## A rule written from one example quietly inherits that example's limits

ADR-0004 clause 1 was written while shaping **skills**, from research about **parsed CVs**. The rule it
produced: *every normalised skill carries the exact span of the **document** that produced it.*

The reasoning behind it had nothing to do with skills or with documents — it was about the machine never
writing down something the person did not claim. But the sentence encoded **both** the element it was
discovered in and the input it was discovered from, as if they were part of the rule. Nobody chose those
limits; they came along for free.

**Both were wrong, and one was actively harmful.** A skill volunteered in a grill answer has no span in
any document, so the rule as written **would have flagged the visitor's own answer as a defect** — the
exact opposite of its intent. And it fails worse over time: owner decision 6 makes the CV a starting
point rather than the record, so **most facts will eventually arrive from the person, not from a parsed
file.** The rule would have been wrong for the majority of its subjects in the target state.

The owner caught both in one sentence, by supplying a scenario the rule had never been tested against.

**The tell:** a rule whose *statement* names a narrower thing than its *reasoning* does. The reasoning
here said “the machine never adds silently”; the statement said “skill” and “document”. Whenever those
two do not match in scope, the statement is probably carrying the accident of where it was found.

**And the generalisation was not merely tidier — it answered a question the narrow version could not.**
Once the rule became *every fact points at its origin*, origin turned out to decide **whether a fact may
be reused across adverts**, which is exactly the boundary #141 needed. Widening a rule to its real scope
can reveal that it was already answering a second question.

## A claim copied into a third document starts looking like three sources

Three documents said `certification` was a hard gate wired to withdraw jobs — *"the same half-wired
shape that produced #125's live job-deleting bug"*: #140's ticket body, ADR-0003's consequences, and
map #127. By the time it reached the third, it read as corroborated, and it was carried into an ADR on
that basis.

**It was false, and one `grep` disproved all three at once.** `withdrawal.ts:82` returns `false` for the
dimension unconditionally, with a comment recording that as deliberate, and `ASK_DIMENSIONS` excludes
it entirely. No certification fact can ever withdraw a posting. #125's bug was live because it had
**both** an explicit-no mapping **and** a surface that wrote `none`; certification has neither half.

The mechanism is worth naming because it is invisible from inside: **each document cited the previous
one, so the claim gained apparent corroboration purely by being copied.** Nobody was careless — the
first statement was a reasonable inference, and everyone after it was reading a source that already
existed. A claim about running code, repeated across three artifacts, still has exactly one origin, and
whether it is true is a property of the code and nothing else.

The tell to watch for: **a claim about the codebase that no document attributes to a file and a line.**
Every one of the three described behaviour; none of them cited where. That absence is cheap to notice
and cheap to resolve, and it is what separates this from the sibling lesson above — there the
constraint was unchecked once, here it was unchecked three times *and looked better each time*.

## Research the repo depends on must be committed, not just written

ADR-0003 lists `docs/research/cv-elements-existing-data-standards.md` under **Evidence**. That file had
never been committed, so the link was dead on GitHub for anyone reading the ADR, and four research
documents from #137 and #138 — two full research sessions, commissioned and paid for — existed on one
laptop only.

They were produced by background agents told (correctly) not to touch git, and then nobody made the
commit. The gap is structural rather than anyone's oversight: **the agent that creates an artifact is
the one told not to persist it, and the session that reads the artifact assumes it is already in the
repo because a committed document links to it.**

Worth checking whenever a decision cites evidence: `git status` the file the ADR points at.

## "We can't change this later" is a claim about stored data — check that the data exists

Map #127 carried #139 for four sessions as **"the map's only unfixable-later decision"**, and the label
was load-bearing: it set the ticket's priority, its ordering, and how carefully it had to be worked.
The reasoning was sound — ADR-0001 rule 2 forbids rewriting stored records, so a fact's shape must be
settled when that fact is first shaped.

**But the record it was unfixable about had never been built.** #126's job record does not exist:
parsed employment blocks sit in an in-memory blob (`roles`, from the miner) and are discarded after one
use, leaving only a count. Nothing was stored in the wrong shape, so every decision was still free —
one `grep` away from being known, and nobody ran it across four sessions.

Nothing was lost here; the decisions were worth taking carefully either way. The cost is the one that
compounds: **an unchecked constraint sets priority for real.** #139 was worked ahead of tickets that
were genuinely blocking, on the strength of a migration cost that did not yet exist.

This is the sibling of the lesson below about a premise hardening across sessions — same mechanism, but
about a *constraint* rather than a *fact*, which is harder to spot because a constraint sounds like
caution rather than a claim.

**Before pricing a change as expensive, check whether the thing you would be migrating has ever been
written.** Found 2026-08-04 resolving #139.

## When a decision has two sides, ask which side has evidence — the measured half hides the unmeasured one

Map #127 spent four sessions shaping a CV data model. Every **advert-side** decision rested on a
17-advert corpus with a research doc behind it (`docs/research/eligibility-dimensions-from-the-corpus.md`,
`languages-from-the-corpus.md`). The **CV side** rested on **one synthetic 1,135-character document** —
that was the entire `apps/api/test/eval/cvs/` corpus. Nobody noticed across four sessions, three of
which produced ADRs.

The rigour of the measured half is what hid it: the map *felt* evidence-based, because half of it was.

The cost was real and compounded twice. Six real CVs overturned the live ticket's own table within the
hour (it recorded education as having *"no driver named"*; education is on **6/6** CVs). Commissioned
research then overturned the six-CV numbers within the day: Europass/Cedefop, **n=353,518 — 12% of real
CVs have no work experience at all**, so *"work history 6/6"* was a sample-size artefact and any shape
assuming one employment entry **breaks for one CV in eight, at ingestion**.

**Ask which half of a decision carries evidence, not whether the decision carries evidence.** Found
2026-08-04 grilling #130.

## Before designing a test that excludes things, check its axis is the one that matters

#130 asked for a named driver per element. The test proposed was *"what is broken today that structuring
this fixes?"* — defensible, cheap, evenly applied, and it put **certifications out of v1** on frequency
(1/6 CVs, 1/17 adverts). The owner overruled it on instinct, without an argument.

The research then showed **why the test was wrong, not merely why the answer was**: certifications run
~7% frequency *and* are one of the criteria employers **explicitly configure their systems to filter
on**. **Low frequency, high consequence — frequency was never the axis that mattered.**

A test can be consistent, cheap and evenly applied and still measure the wrong dimension. Its very
consistency is what makes that hard to see from inside. Found 2026-08-04.

## When a user reports a flaw, look for where the design chose it deliberately

The owner hit a live bug: an approved *stretch* — a light finance-trading exposure, written for one
banking advert, which **worked** (it won the interview and an offer) — kept appearing on later,
unrelated adverts, and **displaced a genuine fact** he considered more relevant.

Reading `JobCrush/contracts/enrichment_proposal.schema.md` found the cause **stated as a feature**:
proposals are *"keyed to the claim graph, **not to any one offer** — so they persist across offers and
dedup recurring asks."* Worse, the contract **records `originOffer` on the proposal and then discards
it on approval**, when the claim becomes an ordinary graph node.

**The information needed to prevent the leak was captured, and thrown away at the exact moment it
started to matter.** The fix is un-choosing a trade-off whose cost was never priced — not adding a new
mechanism. Read the contract before designing a repair. Found 2026-08-04, filed as #141.

## A published benchmark may be measuring a harder task than the one you have

Skills extraction was reported to the owner as near-hopeless, on a peer-reviewed **F1@5 = 0.72** (state
of the art, five guesses allowed). The owner asked why an LLM could not simply read and judge it.

He was right, and the number was misapplied: 0.72 is for placing a free-text phrase at the correct node
in **ESCO's 13,890 labels** — a taxonomy-assignment task. Ours is *does this experience cover what this
advert asks*, a judgement between two texts, which `judge.ts` and `familyLearning.ts` already perform.

**The real constraint survived the correction and was a different one:** a skill judged fresh at scoring
time is not **listable, traceable or correctable** — the map's three fixed promises. The question for
skills was never *"can the machine understand it"* but *"what gets written down."* Check what a
benchmark's task actually is before importing its pessimism. Found 2026-08-04.

## A binary "no" defined by a bar you chose is a silent deleter when the other side has no bar

`#123` asks *"Which of these can you work in professionally? Tick every one you could run a meeting
in"*, and `languageFacts()` writes `none` for every unticked language. `withdrawal.ts` then treats
`none` as an absolute *"I don't speak this"* and withdraws every posting with a blocking requirement
for that language.

The two halves are individually reasonable and jointly wrong. The question's `none` means **"not at
the run-a-meeting bar"**. The withdrawal's `none` means **"not at all"**. Nothing converts between
them, because `AdRequirementV1` carries **no level for a language at all** — so an advert wanting
*basic Japanese* and an advert wanting *native Japanese* are the same demand. A candidate with real
B1 Japanese answers honestly, and loses the job she was qualified for, silently. Found 2026-08-04
while grilling #125; live on Mandarin, Cantonese and Vietnamese, held back only by a *"Not sure?
Tick it."* nudge on the screen.

**The generalisation:** whenever you compress an answer to a boolean, the bar you compressed it at
becomes invisible in the stored value — and any consumer is free to read your `false` at *its own*
bar. That is safe only while both sides agree on the bar, which nothing enforces and nobody writes
down. Before storing a boolean for anything graded, ask what the *consumer* will read the `false` as.
If the two bars can differ, store the grade, not the boolean. The fix here is a ladder of concrete
situations where **not answering reads unknown** and only an explicit bottom rung is a no — the same
shape as this repo's standing rule that an unknown must never withdraw a card (#86 decision 3).

## A second element that shares a shape is not a second element — the stress test confirms nothing

Map #127 chartered #125 as its **stress test**: the deliberately different second element the growth
rule (ADR-0001) had to be walked through, on the principle that a rule nobody has applied twice is an
untested claim. The walk was mechanical, no argument — and that result was **worthless**, because a
volunteered language is not a second element. It is the *same* element as the market tick-list, with a
different origin: same store row, same shape, same dimension. The rule was never asked to do anything.

The real test arrived by accident, from the owner's own domain knowledge: *a language has a level*.
That is a shape change on a shipped element — precisely the case ADR-0001 already says it does not
cover — and it fired the ADR's boundary clause on a second element after the employer case.

**The generalisation:** when you pick a case to falsify a rule, check that the case actually exercises
the mechanism the rule governs, not merely that it *sounds* different from the first one. "A language"
and "a job" sound like different elements; as far as the growth rule is concerned, adding a language to
an existing language store is nothing at all. The test to apply before spending a session: **name which
clause of the rule this case can make fail.** If you cannot, the case is a demonstration, not a test.

**Postscript, 2026-08-06 — it happened twice more, and the test was retired.** #140 shaped five
elements and turned out to be a mechanical application of **ADR-0003**, not ADR-0001. #146 chose
personal projects precisely *because* they looked structurally unlike everything else — no
organisation, no dates — and they turned out to be a **container**, not a new kind of fact, so rule 3
was satisfied before work began and rule 4's hardest gate was already met.

**Three attempts, three misses, and the pattern in them is the finding:** every candidate that was
cheap enough to walk on paper was cheap *because* it reused something already built. **A rule about the
cost of extension cannot be tested by an extension chosen for being cheap to imagine.** The owner
retired the paper test from the map's destination and moved it to the first element added after build.

**The generalisation, stronger than the original:** if a rule prices *future* work, a paper walk can
only ever confirm the cases you can already picture — which are the cheap ones. **Price it against
something real, or accept that you are shipping it untested and say so out loud.** Retiring a
verification you cannot perform beats performing a fourth one that proves nothing.

## A single control byte makes a source file invisible to every search — and the failure is silent

`apps/api/src/eligibility.ts` line 83 uses a **raw NUL byte** as a key separator inside a template
literal. It compiles, it runs, its tests pass, and the file reads normally — the Read tool renders the
NUL as whitespace, so the source *appears* to use a space.

But one NUL makes the file **binary** to `grep` and `ripgrep`, and therefore to the Grep tool,
`/code-review`, and every agent that searches this repo. `grep` prints `Binary file ... matches` with
no line numbers; ripgrep omits it from results **entirely**.

Measured on 2026-08-04 while grilling #129: a repo-wide search for `CREATE TABLE IF NOT EXISTS` across
`apps/api/src` returned twelve tables and **silently omitted `eligibility_facts`** — the only file
declaring it is unsearchable. An earlier search for `ELIGIBILITY_DIMENSIONS` returned a bare
`Binary file matches` line that is easy to skim past. This is the file holding the eligibility
dimension vocabulary that #86, #96, #102, #129 and the ad-requirements contract all rest on. Filed as
[#136](https://github.com/adrien-mounier/jobcrush-app/issues/136).

**The generalisation, and it is the same family as the fabricated-emptiness lesson below:** a search
that returns nothing is not evidence that nothing is there. Here the tool did not even fail loudly —
it produced a shorter, plausible, wrong answer. When a search result will be *acted on* as an absence,
confirm the file you expect is actually in the searched set. And never write a raw control byte into
source: use the escape, so the separator is visible in the file and the file stays greppable.

## A field name is not a measurement — read the VALUE before designing on it

Sibling of the lesson below, from the other direction: there, a *negative* premise went unchecked;
here, a *positive* one did.

The 2026-08-02 provider probe listed which `jsonLD` keys Techmap returns and stopped there.
`applicantLocationRequirements` *sounds* like a work-eligibility signal, so it was written into #99,
#100 **and** the research doc as *"a work-eligibility signal that feeds #86 decisions 3/4 and #96"* — a
load-bearing claim in three documents, never once checked against an actual value.

The first live call (2026-08-04) measured it: **`"HKT Timezone"`**. A working-hours overlap statement,
not eligibility, not right-to-work. It was also a **bare string, not an array**, so `asStringArray`
discarded it on every record — a field written empty on every posting from the day it shipped, feeding a
consumer (`providerWorkRightsSignal`/AC5) that had already been deleted a day earlier for unrelated
reasons. Nobody noticed, because nothing errored.

Two rules:

1. **A schema.org-style field name tells you the vendor's *intent*, not their data.** Any field a design
   depends on must be read, not listed. "The key exists" is not evidence.
2. **Design the shape against the real payload, or defer the field entirely.** The resolution was to
   **remove** it rather than keep it empty: a field named after the wrong concept had already misled
   three documents, and an empty placeholder reads to the next person as *"we have this data"*.

Corollary measured in the same session: **`size` was ignored entirely** (asked 1, 20, 50 — always got
10), while the code carried `DEFAULT_PAGE_SIZE = 20` and believed it. A constant nobody measured is a
number that will be planned against.

## Verify a ticket's "we don't have X at all" premise before you design around it

[#126](https://github.com/adrien-mounier/jobcrush-app/issues/126) opened with *"we do not store dates.
At all"* and a grep that backed it up (`claims.ts` and `packages/contracts/src/` have no `startDate`).
The grep was right and the conclusion was wrong: **the CV reader already extracts employer, title and
dates-as-written on every upload** — `MinedRole`, in the very contracts directory that was searched —
and `grill.ts`, `discovery.ts` and `preview.ts` all consume it. What is actually true is narrower and
more useful: the dates are never made *measurable*, and they are held in `job.progress`, which is
**in-memory only** (`jobs.ts` has no Postgres driver, unlike claims/sessions/eligibility/judgements/
postings).

Designing from the stated premise would have produced a "build date storage" plan. Designing from the
real one produced *"stop discarding what we already read"* — a smaller change with a **live data loss**
sitting inside it that the original framing hid completely.

**Generalises:** a ticket's premise is an assertion by its author, not a finding. A *"we have no X"*
claim is the highest-value one to check, because it is usually derived from a search for the **name**
X rather than for the **capability** X — and the capability is often already there under another name.

**Second instance, same map, 2026-08-04 — and this one had already hardened into an ADR.**
[#135](https://github.com/adrien-mounier/jobcrush-app/issues/135) opened with *"the CV writer reads
claims and nothing else… there is currently no route from a structured fact to a printed CV, for any
element."* Two routes were already in production: `buildTailorInput()` sends the tailor a structured
`Roles:` block alongside the claim sentences, and `answerToClaim()` already turns a grill answer into a
visitor-authored claim. Two greps found it.

What makes this worse than #126 is the propagation. The premise was written by an **earlier session of
this same map**, then restated as fact in **ADR-0001's** closing section (*"The CV writer reads claims
(sentences) only and cannot see structured facts at all"*) and in the map body. By the time it was
checked it was asserted in three places and read as settled. Designing from it would have produced a
bridge that already existed — and missed the real hole, which was that the existing bridge is **fed
from the wrong end** (the miner's original read, not the corrected records).

**So the check is not only for premises written by someone else.** A premise you or a sibling session
wrote is *more* dangerous, because it accumulates citations instead of scrutiny. When a claim about
what the system cannot do turns up in an ADR, that is not corroboration — ADRs copy premises, they do
not test them.

## A rule that forbids something the owner explicitly wants is drawn on the wrong axis

Grilling [#135](https://github.com/adrien-mounier/jobcrush-app/issues/135), the first rule offered was
*"a structured fact prints into a labelled compartment, never into prose"* — a rule about **where on
the page** a fact lands. It looked well-grounded: it described what production already did, and it made
honesty sound mechanical — *"a compartment cannot invent, it has nowhere to put a verb."*

The owner's confusion killed it in two strokes.

1. **The "mechanical" guarantee was asserted, not implemented.** Nothing stops the model writing prose
   from a structured fact: it receives the `Roles:` block and the claim sentences **in the same
   prompt**, and *"render only from the claims"* is a prompt instruction with no lint behind it for the
   summary. A guarantee you describe as structural must be checked as structural — otherwise you are
   selling a prompt as a constraint.
2. **The rule forbade what the owner wanted, for no good reason.** A visitor typing *"I led a project
   at HSBC"* should become a CV line. Under the compartment rule it could not — even though the
   substance was the visitor's own, which is the honest case.

The rule was not too strict. It was **measuring the wrong variable**. The right axis is **provenance** —
where the substance came from — which permits exactly what the owner wanted (their typed words) and
forbids exactly what is dishonest (the machine inventing precision), on both tracks. Page position
turned out to be a *separate and independent* question, settled later as its own clause.

**Generalises:** when a rule you have drafted forbids something the owner explicitly asks for, do not
negotiate an exception to it. Check the axis. A clean-sounding rule that immediately starts growing an
exception list is measuring the wrong variable, and it will keep producing exceptions forever. The
tell in a grilling session is the owner saying *"I don't understand why"* about a consequence — twice
here, that meant the rule was wrong, not that the explanation was.

## An output field with no rules is a latent bug waiting for its first consumer

`claim-miner.md` tells the model to emit `roles: [{employer, title, dates_as_written, dates_missing}]`
— and that field appears **exactly once in the whole prompt**, inside the output-shape example, with
**no rule governing what belongs in it**. Worse, the two rules that touch the concept contradict each
other: rule 6 says a `role` is *"which employment **or education** block the claim belongs to"*, rule 8
says education entries are `role: "profile"`.

This has been harmless for the field's entire life, because nothing does **arithmetic** on it — it is
only counted, checked for missing dates, and rendered into the tailor prompt. All three tolerate a
university appearing in the list. The moment years-of-experience is computed from it, an undescribed
field becomes the input to the product's **headline number**, and a three-year degree makes someone
read three years more experienced than they are — silently, with nothing failing.

**Generalises:** in an LLM-facing prompt, an unspecified output field is not "flexible", it is
undefined behaviour with a plausible-looking value. Grade the risk by what **consumes** it: display and
counting hide the ambiguity indefinitely; the first consumer that *calculates* converts it into a wrong
number nobody can see. Audit a prompt's field rules whenever a new consumer starts doing maths.

## Deferring to "the X work" is only safe once X has a ticket — this repo has now been bitten three times

An owner deferred the job-classification label to *"the cluster engine work as a whole"*. There was no
cluster-engine classifier ticket: the family-floors half shipped (#58–#62), the per-ad half is #86, and
the piece that decides *"this job title is project management"* was a `resolveFamily()` stub —
**hardcoded to return the same constant for every input** — that nobody owned.

The roadmap already records the identical failure twice: 2026-08-01 (*"the per-ad half of the cluster
engine … had never been filed on the tracker, so a tracker-only frontier query could not see it"*) and
2026-08-02 (*"#85 defined the retrieval contract and picked Techmap, then closed; nobody filed the work
to build it"*). Each time the decision was real, recorded, and invisible to every query anyone ran
afterwards.

**Generalises:** *"defer it to X"* is only a decision if X is a **tracker object**. If X is a roadmap
phrase, an epic name, or a doc section, the deferral is a deletion with a friendly face. Before
accepting one, run the frontier query for X — and if it returns nothing, file it in the same breath as
the deferral.

## A "did we get nothing?" check must be page-local — a whole-query total is the wrong denominator

When a provider returns a page of items and **every one fails to parse**, that is a shape drift, not an
empty result — and the two must never collapse, because reporting a drift as "no jobs" tells a user with
real matches there are none. The instinct is to compare against the envelope's own `totalCount`. **That
is wrong in both directions**, and it survived two code-review axes on 2026-08-04 before QA caught it:

- `totalCount` is the **whole query's** total, not the page's. `{totalCount: 50, result: []}` is an
  ordinary empty page of a non-empty query — page 1 of a 15-result, size-20 search. Gating on
  `totalCount > 0` false-fails it, and the failure only appears once someone paginates.
- It leaves the real hole open whenever the field is **absent, `0`, or a non-numeric string** — exactly
  the conditions a drifting vendor is likely to produce.

The correct guard uses only what is in front of you: **`items.length > 0 && parsed.length === 0`**. Keep
the vendor's total for the log line; never put it in the condition.

Generalises: when distinguishing "genuinely nothing" from "we failed to read it", the denominator must
be the thing you actually received, not a number the other side told you about.

## An in-process budget over a window longer than your deploy cycle is false confidence

This repo auto-deploys on every green push, restarting the API's single machine. A per-**month** spend
counter held in process memory therefore resets several times a day and reports a spend far below the
real one. On 2026-08-04 (#100, the first paid third-party service) the deliberate choice was to enforce
per-second/minute/day in process, **leave per-month unenforced, and say so loudly in code** rather than
ship a counter that looks like protection and isn't — with a follow-up ticket (#132) for a durable
`(providerId, yearMonth) → count`.

The rule: **a budget's window must be shorter than the process's lifetime, or the counter must be
durable.** Anything else is worse than an honest absence, because it stops anyone from looking.

## A smoke test that accepts a fallback value proves nothing

A normaliser with sensible fallbacks (`jsonLD.identifier` → else top-level `id`) makes non-empty
assertions worthless: the field is populated whether or not the path you care about exists. #100's first
staging-smoke draft asserted "every field is non-empty" and would have passed while silently reading
every value from the fallback. It must assert **provenance** — re-derive from the path under test and
fail if the value doesn't match — and fail loudly when the fallback fires.

Second half of the same lesson: don't hard-fail on fields that are **legitimately absent** (an advert
with no stated expiry is ordinary). Sample several items and fail only if the field is empty across all
of them, or the smoke cries wolf on its first real run and gets ignored.

## `gh api | ConvertFrom-Json | Select-Object` silently prints blank rows — it invents a confident "nothing is there"

The worst kind of bug: a read that **fabricates a negative answer** instead of failing. In this shell,

```powershell
gh api "repos/O/R/issues/120/dependencies/blocked_by" | ConvertFrom-Json |
  Select-Object number, state, title | Format-Table -AutoSize | Out-String
```

prints a header, a divider and an **empty row** — while `gh api "…" --jq '.[].number'` against the same
endpoint at the same moment correctly returns `127`. The record exists; `Select-Object` resolved every
named property to null and `Format-Table` rendered the blank line as if the collection were empty.
Nothing errors, nothing warns, and the output reads exactly like "no results".

This cost real damage on 2026-08-04: it was used to "confirm" that a dependency edge had not been
created, which produced a wrong diagnosis (below), a fallback mechanism that wasn't needed, and four
documents asserting a GitHub feature was broken when it was not.

**Always use `--jq` for `gh api` reads whose *emptiness* you intend to act on.** `--jq` runs inside
`gh`, on the real JSON, before PowerShell can mangle it. If you must post-process in PowerShell, print
the raw body first and check it is non-empty — never let `Format-Table` be the thing that tells you a
set is empty.

## GitHub's `dependencies/blocked_by` 422 "Target issue has already been taken" means the edge ALREADY EXISTS

Not "the write failed" — the opposite. `POST /issues/<n>/dependencies/blocked_by` rejects a **duplicate**
with `422 Validation failed: Target issue has already been taken`, confirmed deliberately by re-posting
an edge known to be present. The message names a Rails uniqueness validation and reads like a
mysterious failure, so it is easy to mistake for the feature being unavailable — especially when paired
with the blank-row read above.

**Native issue dependencies work fine on this repo**, and `/wayfinder` should use them as
`docs/agents/issue-tracker.md` says: they render the frontier visually in GitHub's own UI, and
`issue_dependencies_summary.blocked_by` gives an exact "is this takeable" gate that no body-text
convention can match. On a 422 from this endpoint, **read the current edges with `--jq` before
concluding anything** — the usual answer is that the edge you wanted is already there, possibly wired
by an earlier session.

## `gh issue comment --body @'...'@` silently shatters into 11 arguments on PowerShell

## `gh issue comment --body @'...'@` silently shatters into 11 arguments on PowerShell

A PowerShell here-string passed straight to `gh` as `--body` fails with `accepts 1 arg(s), received 11`
— the shell splits it before `gh` ever sees it. This bit on the first attempt of every long comment.
**Write the body to a file and use `--body-file`** (same for `gh issue create`/`edit --body-file`). Also
avoid piping JSON into `gh api --input -`: PowerShell's pipe encoding produces `Problems parsing JSON
(HTTP 400)`. Write the JSON to a file and pass the path.

## A cache invalidated by a build-time version is guarded by nothing — the redeploy already cleared it

#114 added a negative cache so an unreadable advert stops costing two model calls on every deck
request. Its entries carry the `adReaderVersion()` they failed under, and the ticket's own safety AC
was written around that field: *"given a prompt or contract version bump, a previously-failing advert
**is** retried — a negative cache must never make a fixed advert permanently invisible."* The code
compares the versions, the comparison is correct, and it can **never fire**. `adReaderVersion()` is a
memoised hash of a prompt file plus a hand-bumped constant, so it cannot change inside a running
process; the only way to bump it is a redeploy, and a redeploy restarts the process, which empties
the in-memory cache anyway. By the time a new version is running there is no stale entry left to
rescue. The Spec reviewer found it by tracing the call path instead of trusting the comment; the
developer had reported the AC "met at the unit level", and the unit test passes — it exercises a
branch production cannot reach.

**The general shape:** when an in-memory cache is keyed on a version that only changes at build or
deploy time, the version check is decoration. The process lifetime is already a stricter invalidator
than the key. Before writing that guard, ask what would have to happen for the two values to differ
*within one process* — if the answer is "nothing can", the real guarantee has to come from somewhere
else. Here it does: the backoff caps at 60 minutes, so nothing stays invisible longer than that, and
QA confirmed it against a 30-day simulated clock (worst case after a fix: 15 minutes). The field was
kept as defense-in-depth for a future hot-reloadable prompt, with a comment saying plainly that it is
unreachable today.

The wider trap is a ticket writing its own AC around a mechanism that turns out not to exist. An AC is
a statement about *behaviour a user or operator can observe*; when it names an implementation instead,
you can satisfy the words while the guarantee rests on something else entirely — and nobody notices
until someone re-derives the call path. Restate the mechanism-shaped AC as the outcome it wanted
("a fixed advert becomes visible again within X"), then check what actually delivers X.

## Rewriting a `find()` lookup as a `Map` silently flips duplicate-key precedence

Same slice, caught by the same review round. `loadAllAdRequirements().find(r => r.adId === adId)`
returns the **first** matching entry; the replacement built a `Map` in a loop, and `map.set()` keeps
the **last**. Both read as "look it up by id". Nothing in the diff looks like a behaviour change, no
test moved, and the fixture file happens to hold ten unique ids so it was latent.

It mattered here because the index also records *invalid* entries: a copy-pasted broken duplicate
would have shadowed a good earlier one, turning a resolvable card into a dropped one — #86 names
silently deleting a winnable job as this engine's worst failure. The fix is explicit precedence, not
restored insertion order: a valid entry now beats an invalid one whatever the file order, and among
same-validity duplicates the first wins.

Whenever a linear scan becomes a keyed structure, duplicate handling is a decision you are now making
whether or not you notice. Write down which one wins and why — the container silently picks for you
otherwise.

## The affordance that lives "after you answer" does not exist for the last question

#123's designer specced a lock-in confirmation and a "Fix that?" undo into the ask dock's notice slot —
the same slot #106 established and #120 already flags as reaching only one answer back. It rendered in
**zero** runs. The languages question is *always last*, and answering the last question flips the
session to the deck handoff, which replaces the notice area outright. So the affordance wasn't
sometimes-missed; it was structurally unreachable, and only a live browser drive found it — every unit
test passed, because the state it asserts is real, just never painted.

**The general shape:** any affordance whose home is "the slot that appears after answering" is
unreachable for the final item in the flow, because answering the final item *is* the transition away.
Whenever a confirmation, an undo, or a "what just happened" line matters most on the last step — and it
usually matters most there, because that step commits everything — it has to live on the **destination
screen**, not the origin's notice slot. Check where the flow *goes*, not where the component sits.

Corollary worth keeping: when the undo turned out to need real new capability (reopening an answered
question with its prior answer intact), the right move was to **not wire the link** and say so. A dead
"Fix my languages" would have re-opened the exact trust problem the fix existed to close.

## A blanket `data/` ignore silently drops shipped runtime config — and the obvious fix is also wrong

#123 added `apps/api/data/languages-by-market.json`, which the API reads at runtime. Every test passed;
`git add -A` picked up nothing. The root `.gitignore` carries a repo-wide `data/` rule, and the existing
files in that directory are only tracked because they predate it. A green local run proves nothing about
what actually ships — the deploy would have 500'd on ENOENT at the first language question.

Two traps, in order:

1. **`git check-ignore -v` is a bad oracle here.** With `-v` it prints the matching pattern and exits 0
   even when the match is a *negation* — i.e. when the file is **not** ignored. Use `git add --dry-run`,
   or `git status --porcelain`, which answer the question you actually have: *would this ship?*
2. **A negation cannot reach inside an excluded directory.** `data/` then `!apps/api/data/*.json` looks
   right and is a no-op — git never descends into the excluded directory to evaluate it. The first fix
   here added `!apps/api/data/` to un-exclude the directory, which silently turned the block into a
   **blanket un-ignore with a whitelist-shaped comment**: a stray `.md`, `.db` or scratch dump in that
   folder would have been committed. Code review caught it. The working shape is un-exclude the
   directory, **re-exclude its contents**, then whitelist by extension:
   `data/` → `!apps/api/data/` → `apps/api/data/*` → `!apps/api/data/*.json`.

Verify a `.gitignore` change by probing **both** directions — a file that must ship, and a file that must
not — before trusting the comment you just wrote.
## A shape that is ported but not golden-tested is not actually governed by the oracle

The repo rule says the `.mjs` oracle is the contract spec and the zod port is wrong on any
disagreement. That rule only has force where a **golden test actually compares them**. #99 shipped four
new shapes and golden-tested only the outer result union; the other two were written, exported, and
never run against their ports — and had already drifted, because `z.number()` accepts `Infinity` while
`_lib.mjs`'s `isNumber` requires `Number.isFinite`. Nothing was red. Two independent reviewers found it
by reading, not by a failing test.

The trap is that writing both artefacts *feels* like satisfying the rule. It isn't: an untested port
is a second, silently diverging spec. **Adding a shape to `packages/contracts/src` means adding it to
the mutation list in `golden.test.ts` in the same change** — and the mutation list must assert both
`zod.success === oracle.ok` *and* that the mutated value is actually rejected, or a vacuous test passes
while comparing two validators that both accept everything.

Where zod and the hand-written oracle predictably disagree, worth checking every time: `z.number()`
admits `Infinity`/`-0` where `isNumber` does not; `.default()` makes a key optional in the port, so the
oracle must treat absent-vs-present identically; and `.strict()` has to be matched by an explicit
unknown-key check on the oracle side. A differential fuzzer over the pair is cheap and worth it — QA's
found no further disagreement across 43,510 generated inputs, which is the evidence that made the
alignment believable rather than asserted.

## A derived identifier that is only *typed* as a string is not derived

Related, same slice. `PostingV1.id` is specified as `posting:<canonicalKey>` with `canonicalKey` being
a sha256 of normalized content. Both validators initially checked only the string relation between the
two fields — so the shipped fixture passed with a `canonicalKey` that was **not** the hash of its own
content, and nothing noticed. If a contract says a field is derived, the validator has to recompute the
derivation; otherwise the field is decorative and the invariant lives only in the one function that
happens to build it correctly today.

The related failure to check when a key is built by joining fields: **the delimiter must be impossible
to forge from field content.** `sha256(company + "|" + location + "|" + title)` merged two genuinely
different jobs because `normalize` stripped `,.()` but not `|`. Either strip the delimiter during
normalization (what #99 did) or length-prefix the parts — but do not assume real-world employer and
title strings won't contain your separator, because job titles like `"Project Manager | Fintech"` are
ordinary.

## Two facts that share a name do not share a granularity — and matching them deletes silently

This repo has now hit the same trap twice. #106 tried to join a provider's `applicantLocationRequirements`
(*which countries this job accepts applicants from*) to the visitor's answer (*can I work in MY city
without sponsorship*) and deleted the seam in review. #107 then wrote the withdrawal rule against that
same `work-rights` answer — discovery asks **one city-scoped question** and stores it at the global
scope — and would have silently removed every right-to-work-demanding **Australian** posting from an
Australian job-hunting in Hong Kong. Both times the two values shared a dimension name, looked
joinable, and were not: one is scoped to a city, the other to a country.

The rule: **before matching a stored fact against a requirement, check that both sides name the same
subject at the same granularity.** If either side cannot name it, refuse to match. The dangerous shape
is a fallback to a *global* scope when the subject is unknown — that turns "I don't know what this is
about" into "this applies to everything", which is precisely how a correct-looking rule deletes things
it was never meant to touch. #107's fix is the pattern worth copying: `scopeFor()` returns `null`
rather than `ANY_FAMILY`, and a null scope can never withdraw.

The generalisable smell: **a lookup whose key is a category (`language`, `work-rights`) rather than a
thing (`Mandarin`, `Hong Kong`).** A category key silently matches the wrong instance.

## When a hard fact corrects a model's number, attenuate — never replace

#107 needed a visitor's stated years to override a judged fit that was blind to digits. The obvious
move — replace the fit with `years / bar` — is wrong in a way that only shows up in one direction:
someone *over* the bar had a model's honest 0.2 on an out-of-family advert inflated to a perfect 1.0.
A replacement has no direction. `fit * min(1, years/bar)` does: it can only ever lower, so being wrong
about scope costs a slightly harsh score instead of a fabricated match.

Also worth pinning: `min(modelFit, ratio)` looks like the safe version and isn't — whenever the model's
fit is the smaller of the two, five years and nine years collapse to the *same* number, silently
failing the very requirement the rule was written for. Multiplication keeps them distinct.

And guard the divisor against what the *contract* permits, not what you expect: `comparable.value` is
only `isNumber`, so `0` was reachable, and `0/0` yields a `NaN` that sails through a `< threshold`
coverage guard and serialises a pinned-number field as `null`.

## Never move product data to make a test meaningful

#117 raised the deck's paid-scoring ceiling above the size of the job pool, which left the test for
"the ceiling holds when the pool exceeds it" with nothing to prove. The fix reached for was to append
six synthetic adverts to `apps/api/data/sample-postings.json` — a file that looks like a fixture, sits
next to fixtures, and is **loaded at runtime by `preview.ts` as the live job pool**. Six invented job
listings would have been served to real people looking for work. It never reached a commit, but only
because someone read the diff and asked what that file actually was.

The rule, and it is absolute: **if a test needs a world that does not exist, the test constructs that
world; the product does not move to meet it.** The right fix here was to make the ceiling injectable
(`OnboardingDeps.judgeMaxCards`, never set in `main.ts`) so a test can set it to 3 and exercise the
real selection path against the real, untouched pool.

The generalisable smell: **a change whose blast radius is "what users see", in service of a goal that
is purely internal.** Test coverage, a green suite, a metric — none is worth a byte of fabricated
content in a path a user can reach. Worth knowing where the line sits in this repo specifically:
`apps/api/data/*.json` is product data, not test data, and `preview.ts` / `e5stub.ts` read it at runtime.

## The lever that looks like the fix often moves the wrong way — measure before you spend

#117's deck showed too few real scores on first view. The obvious lever was the cap on how many scores
we pay for, so it went 8 → 20. Measured on staging: the first deck got **emptier** (3 scored instead of
6) and cost **114% more**. The cap was never the constraint — the deck's shared 8-second in-request
budget was. Paying for 15 judgements instead of 8 just meant more were still in flight when the wall
came down, since the concurrency limit turns them into waves sharing one deadline. Buying more moved
cards from *never scored* to *not scored yet*; it could not move them to *scored in time*.

Two things to carry. **First: when a number disappoints, work out which constraint actually binds
before spending money on the one that is easiest to change.** A capacity lever and a latency lever look
identical on a dashboard and behave oppositely. **Second: an acceptance criterion can be unsatisfiable
by the ticket that carries it.** #117's AC6 asked for a ratio no value of the cap could deliver. The
honest close was to record it unmet with the three-run table proving why, and file the real fix
separately (#121) — not to redefine the metric until it passed. The *purpose* behind AC6 was fully met;
its literal ratio never could be, and saying both plainly is the whole job.

## A test that hardcodes a calendar date against a freshness window is a bomb with a fuse, not a flaky test

`judgementStore.test.ts`'s "already fresh" case seeded `last_used_at` from a fixed
`2026-08-02T00:00:00Z` and asserted the store performed no redundant write. That is true only while
wall-clock now is inside `TOUCH_STALE_AFTER_MS`'s 24h window of that literal date. The suite was green
at 02:23 on 2026-08-03 and **deterministically red by 10:57 the same day** — same code, same commit,
no edit in between. It reads as flakiness and is the opposite: it will now fail on every run, forever.

Worth knowing because of how it presents: a green baseline at session start is not evidence the suite
will still be green at session end, and "the tests were passing this morning" is not proof you broke
something. If a failure's expected value is a literal date in the past, look at the clock before you
look at the diff. Seed relative to `now()` when the assertion is about freshness.

## A keyword count is not a measurement — read the sentence

#106's ticket recorded "2 of 16 adverts state a work-authorisation requirement", and the whole question
set was to be derived from counts like it. Both hits were the word *sponsor* meaning the **executive who
backs a project** ("the project sponsor", "stakeholders, sponsors, and management") — not visa
sponsorship. The real count is **0**. The same corpus has a twin: searching `fluen` for "fluent" matches
inside **Confluence**, a tool named in several adverts' tooling lists.

Both traps survive a plausible-looking regex and produce a number nobody re-checks, because a number in
a ticket reads as measured. When a derivation is load-bearing — here it decided which questions every
visitor is asked — read the surrounding sentence for every hit, and record the false positives in the
doc so the next person's regex doesn't quietly restore the wrong answer.

## A per-request budget is not a per-visitor budget the moment the client is allowed to retry

#117 caps paid judgements at 8 per deck request. The first implementation ranked the paid set over the
cards the cache had **not** already resolved — which reads as obviously correct, and is, for exactly one
request. The same slice added a client poll that re-fetches the deck while judgements are still landing.
So poll 2 found round 1's cards cached, which *freed bound slots*, which bought the next 8; by poll 3 or
4 the visitor had paid for all 15 adverts — **the precise cost the ticket existed to eliminate, with
every "at most 8 per request" unit test still green.** The tests weren't weak; they asserted the
property that was actually implemented. The property that mattered was one level up.

The general form: **any budget, quota, rate limit or cap scoped to a single request is silently voided
by anything that can issue more requests** — a poll, a retry, a refresh, a reconnect, a second tab. The
budget has to be scoped to the thing you actually care about not over-spending (a visitor, a session, a
fact set), or the request-level cap has to be *idempotent* — deriving the same answer every time so a
repeat costs nothing new. The fix here was the second: rank the paid set over **every** candidate rather
than the unresolved remainder, making it a pure function of (fact set, requirement sets). A poll then
re-derives an identical set, finds it all cached, and spends nothing. Idempotence turned out to be
cheaper and more robust than adding session state to count spend.

Two process notes worth keeping. **The bug was invisible to the engineer who built both halves,
because each half is correct alone** — it lives only in the interaction, which is exactly what the
two-axis review is for; the Standards axis caught it by reading the diff against the client's retry
behaviour, and the Spec axis (checking ACs) missed it entirely. And **a test written by the author of
the fix is not independent evidence of the fix** — QA counting real model calls across 10 consecutive
deck loads is what actually proved it, and that's the check worth demanding whenever the claim is
"this now costs less".

## If the design rests on a seam, a test that never crosses that seam proves nothing

#118's whole value is knowing *which visitor* spent the money. Attribution rode request-scoped
`AsyncLocalStorage`, established in Fastify's `onRequest` hook with `enterWith` — called after an
`await`. That does not survive the hook-to-handler transition, so every ledger row would have recorded
a null visitor: `costForVisitor` returning 0 forever, `scrubVisitor` with nothing to scrub, the ticket's
central question unanswerable. The unit tests were thorough and all passed, because they set the
visitor and ran the meter **in one unbroken async context** — they exercised the mechanism and never
the seam. Two independent reviewers caught it by reading; no test would have.

The general form: when a property only holds *across* a boundary — an HTTP request, a process, a
worker hand-off, a transaction — the test has to cross that boundary, even when the unit underneath is
fully covered. Ambient/implicit context (`AsyncLocalStorage`, thread-locals, request-scoped DI) is the
sharpest case, because the failure is silent and plausible: you get a valid-looking row with a null
where the answer should be. The fix is cheap and worth making a habit: **revert the fix and watch the
new test fail.** A test you haven't seen fail for the right reason is a test you haven't verified. In
Fastify specifically, the callback-form hook calling `storage.run(value, done)` as its last synchronous
action is the shape that works; a plain async hook with `enterWith` after an await is the shape that
silently doesn't.

## Your in-process database substitute can hide a real data-corruption bug

A malformed `LLM_PRICING_JSON` override produced a `NaN` cost. **pg-mem rejected the insert; real
Postgres accepted it** — and once one `NaN` lands in a `double precision` column, every `SUM` over that
table is `NaN` forever. The suite runs on pg-mem, so it never saw the failure mode that matters. QA
only found it by standing up a real Postgres 16 in Docker and asking the database directly for
non-finite rows.

pg-mem is right for the fast store tests and should stay. But it is a *substitute*, and substitutes
agree with the real thing on the happy path and diverge exactly at the edges — invalid values, type
coercion, constraint and overflow behaviour. So: for anything that writes a **numeric or otherwise
corruptible value that later aggregates**, verify the hostile cases against a real engine at least
once before shipping. Cheap heuristic for when it's worth the container — ask whether a single bad row
can poison every future read. Here it could, and the price of finding out in production would have been
a cost figure that silently stopped being a number.

## A test case that also lives in the prompt is a case the model has been handed the answer to

#105's five regression rows — the measured failures the whole slice exists to fix — were checked in
as a fixture *and* written into `card-judge.md` as worked examples, one of them with its target band
spelled out. Both decisions were individually right: the prompt needs concrete examples to steer on,
and the rows needed to stop being prose in a markdown table. Together they made the only test that
could certify judgement quality an open-book exam, and it would have passed. The damage wasn't local:
slice 9's whole purpose is choosing a model on measured evidence, and it would have inherited a green
these rows never earned.

Nothing about the code was wrong, so no code review would have found it — it needs someone comparing
the *test data* against the *prompt text* and asking whether the model has seen this before. Do that
comparison whenever a prompt and a fixture describe the same examples. Keep the worked examples in the
prompt (they earn their place) and certify against a **hold-out set in a different domain**, with the
contaminated rows kept but labelled as proving nothing on their own. The general form: when the thing
under test is a model's judgement, the fixture is only evidence if the model hasn't read it.

## The safety net you add for one property can quietly break another

Three times in one slice, a correct fix re-introduced the failure the slice existed to remove.
Purging judgement rows by age — a genuine privacy requirement — silently re-judges a stable card for
a returning user who changed nothing, which is the unexplained-drop failure the ticket was written to
kill. A concurrency cap added to stop a rate-limit burst turned one 15s deadline into three sequential
waves and pushed the deck past the web proxy's 30s budget, so the main screen returned nothing at all.
And falling back to the old scorer to avoid dropping cards let the *over-scoring* old numbers outrank
honest ones, so the deck led with the card we understood least.

Each was found by asking "what does this guard do on the path it wasn't written for?" — the returning
user, the cold cache, the mixed list. When you add a guard, name the property it protects, then name
the property most likely to be in tension with it and check that one explicitly. In a slice whose
whole point is a stability guarantee, every new mechanism is a candidate for breaking it.

## A rate whose numerator feeds its own denominator can never cross its threshold

#115 split timeouts out of the read-failure counter, then added a timeout alarm rating
`timed_out / (timed_out + read_succeeded)`. But an overrunning read is never cancelled — it finishes
in the background and increments `read_succeeded` **itself**. So every timeout eventually contributed
one to each side, the rate asymptoted to exactly 0.5 from below, and the threshold was 0.5 with a
strict `>`. The alarm was mathematically incapable of firing in the only scenario it was added for,
and it read as "not firing" — indistinguishable from healthy. It survived one code review and was
caught only because the arithmetic was worked through by hand against the *self-healing* behaviour
the rest of the fix depends on.

When you add a rate alarm, write down what its numerator and denominator count in one sentence each,
then ask whether one event can increment both. If it can, the rate has a ceiling — compute it, and
compare it to the threshold before shipping. Here the fix was the **denominator, not the threshold**:
count the outcome at the decision point (`read_in_time` vs `read_timed_out`, both at the deadline
site) rather than mixing a decision-point count with a completion count from a different population.

## A reproduction that fails to reproduce is a result, not a dead end

#115's ticket ranked four candidate causes for a 43% advert-read failure rate, led by strict-schema
rejection. Driving all seven adverts through the real path produced ten reads, ten successes, zero
retries — and *that* was the finding: the failure was a 15s deadline against a 15–27s task, a
subsystem the hypothesis list never mentioned. The timings in the "successful" run were the evidence,
not the successes.

Log per-attempt wall time even when you expect to be diagnosing content, and treat a non-reproduction
as data about *where* the fault isn't. Also: the harness fell back to the CLI driver with no API key
available, so absolute timings didn't transfer — but the disconfirmation did. Be explicit about which
half of a result survives the environment difference, because the two halves have very different
strengths.

## A guard needs a test that it can be *passed*, not only that it fires

#104 enforces the blocking definition in code as well as in the prompt: a requirement the model calls
`blocking` is down-classified unless it carries a hard-gate eligibility dimension. The prompt,
written separately, told the model that field was optional and that "most requirements are NOT
eligibility dimensions" — so nothing would ever have satisfied the guard. Blocking would have been
**unreachable**, the operator's blocking-rate counter would have read 0 forever, and 0 reads as
"the prompt is behaving". Every test written pointed the same way (a capability gets clamped);
none asked whether a genuine hard gate survives. When you add a clamp, a filter, or a validator,
write the test for the value that must get **through** it first — the failing-input tests will pass
even when the guard is stuck shut.

## A second store driver only tests what both drivers actually do

#104's Postgres driver validated a stored row against the current schema on read; the in-memory
driver didn't. So a contract bump — the exact case the stored `version` field exists for — would
have thrown out of every read on staging, been swallowed by a route-level catch, and silently
emptied the deck, while the store-contract test stayed green because both drivers run against the
*same* schema at test time. A shared contract test proves the drivers agree on the cases it
exercises; it says nothing about a driver doing extra work the other doesn't. Grep the two
implementations for asymmetric work (parsing, coercion, defaulting) before trusting the contract
test to cover a migration.

## Count failures where the alarm can see them, and only where they belong

Two ways the same alarm went wrong in one slice. The failure counter was incremented by fixture
parse errors, which feed the numerator but never the denominator — one malformed fixture would pin
the rate at 100% with zero model calls made, pointing the operator at the wrong subsystem. And the
store reads that could fail hardest (a database outage removing every uncurated advert from every
deck) sat outside the try, so they counted nothing at all and the rate stayed at a healthy 0%.
When a counter exists to make a silent failure loud, check both directions: what can move it that
shouldn't, and what should move it that can't reach it.

## Derive a cache-invalidation version from the thing it versions

A hand-maintained `PROMPT_VERSION` constant is a bug waiting for the first person who edits the
prompt and forgets — and the symptom is invisible: every advert keeps being served from a stale
cache. Hash the prompt text **actually sent to the model** (after stripping the human-facing header
comment) and the version maintains itself: a comment edit costs nothing, a real wording change
re-reads the pool. Keep the contract half explicit, since that one is a deliberate decision.

## A filter test is only real if the thing it excludes would otherwise be included

#103's headline AC — a non-English advert stays in the pool and never becomes a card — is trivially
satisfiable by a vacuous test. A card exists only where a posting **joins a requirement set by
`adId`**, and today only 8 of 16 postings have one, so a new non-English posting with no requirement
set would be absent from the deck for a reason that has nothing to do with the gate, and the test
would stay green with the filter deleted. The fixture therefore had to be given a requirement set on
purpose. Prove it empirically rather than by reading the code: re-run the real candidate pipeline
with the filter widened (`["en","zh"]` → 10 candidates) and narrowed (`["en"]` → 8). Whenever you
test that something is excluded, first establish it would have been included.

## "The rule lives in one place" is a claim about every path, not the one you're looking at

#103 put the language gate on the deck, on `/want`, and on the tailor target — and missed
`matchPosting()`, which the pre-signup preview uses to pick an advert **and burn a real LLM call on
it**. Unreachable today only by an accident of tie-breaking. Two habits catch this: grep for every
caller of the underlying loader (not of the route), and note that a path with no session still needs
the rule — which is why the product's *served* languages exist as a named constant separate from a
*user's* languages. A single-entry-point claim is worth exactly as much as the search that backs it.

## A heuristic tuned on curated fixtures is untested, not proven

#103's English detector scores 0.181–0.329 on all 16 corpus adverts and looked solid. QA fed it
realistic shapes the fixtures happen not to contain: an ATS bullet list scored **0.032**, a bare
skills blob **0.000** — both labelled undetermined and therefore hidden from every user. The corpus
was hand-picked prose; real feeds are not. Two rules follow. Never sign off a heuristic against the
sample it was written beside — invent the adversarial inputs, or have QA do it. And when a heuristic
has a "can't tell" bucket, **count it separately from its confident outcomes**: folding "we don't
know" into "we know it's foreign" would have buried this behind a number that reads as routine.
Relatedly, a single non-Latin character is not evidence of a non-English document — in an APAC
market a company name or address in Chinese is normal in an English advert, so script detection has
to be proportional, not first-match-wins.

## A rename that feeds a computed number needs the number pinned, not its type

`expect.any(Number)` and shape-only `{met, total}` assertions pass through *any* value-mapping
error. #102 unified three band vocabularies specifically to delete a hand-written mapping whose
failure mode is "reports a plausible wrong percentage, crashes nothing" — and the route suite
would have stayed green through exactly that failure, because it only ever asserted that a
percentage *was a number*. Removing a translation removes the risk; it does not install the
detector. When an enum rename or a mapping change flows into a derived figure, add a
characterization test pinning the **exact** derived values, and say in the comment which future
ticket is expected to re-baseline them — otherwise the next author reads a hard-coded number as
brittleness and loosens it back.

## A missing `.mjs` named export is invisible under vitest and fatal under `node`

`validate_ad_requirements_v1.mjs` imported `readJsonArg` from `_lib.mjs`, which never exported it.
Under plain `node` that is a link-time `SyntaxError` before a line runs; under vitest's SSR
transform the missing binding merely becomes `undefined`, so the golden tests passed over a module
that could not execute. Two of the pre-existing oracles had the same defect and nobody noticed for
months. Since the repo rule is that the `.mjs` oracles **are** the contract spec, a spec that only
runs inside the test runner is not a spec — run every oracle standalone (`node validate_x.mjs
fixture.json`, checking the exit code) at least once when touching one.

Turbo's cached typecheck replayed green while production discovery passed a `production_research`
floor into an engine still typed for `test_fixture`. Runtime tests were green, but a forced clean
typecheck caught the invalid boundary. When a generic engine starts consuming a second validated
contract variant, type its input to the smallest structural fields it actually uses and run an
uncached typecheck; do not widen the source discriminator or cast the mismatch away.

## Held-out placement examples validate a classifier; they are not the classifier

The first live-wiring attempt recognized target roles by exact lookup in the publication's held-out
evaluation cases. That leaks validation data into runtime policy, recognizes only research strings,
and silently turns ambiguous examples into the wrong product path. Published evaluation artifacts
authorize a floor only after a separate server-owned placement service confirms it. If that service
does not exist in the current slice, fail closed honestly; never manufacture runtime coverage from
the test corpus.

## A checked-in evaluation table is not reproducible until raw inputs generate it

Recording target roles, thresholds, scores, and expected/observed outcomes in JSON can still be a self-authored all-pass matrix. For a production activation gate, check in the raw held-out inputs and pinned evaluator configuration, deterministically generate scores/outcomes plus a dataset hash, and make publication regenerate and exact-match that output before computing quality metrics. Validate identity fields such as case IDs as unique; otherwise a later map/join can silently corrupt an otherwise reproducible evaluation.

## Do not use pg-mem to prove PostgreSQL transaction rollback

`pg-mem` exercises this repo's SQL shape well, but it did not roll back an `UPDATE` after a later injected audit insert failure even when the store used one checked-out client with `BEGIN`/`ROLLBACK`. A green pg-mem rollback assertion would therefore test the emulator, not production semantics. For mutation-plus-audit invariants, keep pg-mem for schema/query contracts and add a deterministic transaction-boundary fault harness (or a real `DATABASE_URL`-gated PostgreSQL integration) that distinguishes pending from committed state and proves rollback leaves the committed row unchanged.

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

## The tracker is not the whole memory — reconcile it against the roadmap before claiming a frontier

**Session 57, 2026-08-01.** A frontier query built purely from GitHub issues showed a clean
seven-ticket dependency chain (#63 → … → #69) and no blockers. It was wrong. The **E5 per-ad
engine** — the thing #63 actually needs to put a number on a job — was named in `roadmap.md` as
`JC-33/34/35` and in `CLAUDE.md` as *"S3 (the hunt) is the next slice — E5 cluster engine first"*,
but had **never been filed as issues**. Invisible to `gh issue list`, so invisible to the plan. It
surfaced only when a sub-agent read `e5stub.ts`'s header comment — the slow, expensive path to a
fact that was on page one of the project's own instructions and already loaded into context.

**Do this:** start a frontier check from `roadmap.md`'s stated *next* slice and use the tracker to
verify it, not the reverse. A gap between the two is a finding to report immediately. And when work
is named in the roadmap but has no issue, **file it** — an unfiled plan item is an invisible one,
and the next session will re-derive it or step over it.

## Check the repo's own data before asserting market or domain context

**Same session.** Two full rounds of provider research were briefed against *"UK and EU"* — an
assumption invented by the orchestrator, never stated by the owner, and contradicted by data
already committed: `apps/api/data/sample-postings.json`, the corpus backing the published
`it-project-delivery` floor, is 16 postings from Hong Kong, Vietnam, Sydney and APAC-wide, with
**zero UK or EU**. The wrong assumption was passed into sub-agent briefs as a *requirement*, so the
error propagated with authority and produced two obsolete shortlists (Adzuna, then JSearch/SerpApi
— none of which names a single SE/East Asian board as a source).

**Do this:** before asserting market, geography, or domain context in a brief, open the data the
repo already has. A fixture corpus, a seed file, or a golden test is a statement about the domain.
Injecting an unchecked assumption into a sub-agent brief is worse than holding it yourself — the
agent has no way to know it wasn't verified.

## Job titles do not identify the job — measured, not theorised

**Same session, from a live probe of Techmap's API.** Of the first ten Hong Kong postings matching
`title:"project manager"`, only **three or four** were IT/digital delivery. The rest: a power-station
maintenance role, two construction firms, an interior design & build firm, a skincare company, and
the Hong Kong Girl Guides Association. Real relevant volume is roughly **a third** of any
title-filtered headline count.

No provider-side filter fixes this — it is exactly what per-ad understanding (#86) exists to do.
Quote this when anyone proposes shipping a match count off a title search.

Related: **role vocabulary is regional.** "Programme manager" and "delivery manager" are near-absent
in Hong Kong, Singapore and Vietnam (0–3/day combined vs. dozens of "project manager"). Family-floor
synonyms and discovery's role question must be built on the market's own words.

## Fixtures authored alongside an algorithm cannot falsify it

`sample-ad-requirements.json` made `matchtick.ts` look sound — the three hand-authored requirement
sets were phrased in candidate-shaped vocabulary, so token overlap fired and scores were clean. The
scorer's real behaviour (0% for a correct fit worded naturally, 100% for "wrote a blog post about
X", 100% for a construction project against enterprise software, 100% for 3 years against "8+
years") only appears on ad text nobody wrote with the algorithm in mind. `docs/card-quality-taste-test.md`
found the same thing in July and named the cause: *"card quality is entirely a function of vocabulary
alignment between ad text and confirmed facts."* When a fixture set and the code that consumes it
were authored together, the fixtures encode the code's assumptions and prove nothing about them —
adversarial inputs, or real-world data, are the only evidence. Corollary: a curated launch pool that
makes a demo look good is a measurement hazard, not just a guardrail.

## Demonstrate a defect by running the code; a table of real outputs ends the argument

Arguing that a scorer is wrong takes paragraphs and invites debate. Running it — a throwaway vitest
importing the real function, deleted straight after — produced a five-row table that settled it in
one glance and became the spec's justification and #89's regression cases. Cheap, and the output is
reusable as acceptance criteria in a way prose never is.

## Check recent ticket numbers before filing; a collision means someone already filed adjacent work

Four new E5 children were expected to land on #92–#95 and came back #95–#98. The three numbers in
between were #92 dedup rate, #93 Japan/China in-language, #94 Korea provider — all filed by the
prior session's research pass, and #93 covered the same in-language ground as the ticket just
created. Listing the recent range first would have surfaced the overlap before creating it (the two
are now cross-linked: #93 owns the *decision*, #95 the *architecture*). A number coming back higher
than expected is a signal, not a formality.

## The payload you want may not be in any top-level field

Probing Techmap for advert text, a scan of top-level fields found nothing longer than `title` — the
honest-looking conclusion was "this provider returns no description". Wrong: the full 2,700-character
advert was inside `jsonLD`, a nested schema.org/JobPosting object the string scan skipped because it
is not a string. One more look before reporting turned "the engine is capped by its input" into "the
input is fine, and here are three structured fields we were about to pay a model to infer"
(`applicantLocationRequirements`, `validThrough`, `skills`). When a response looks like it is missing
the thing you need, enumerate nested objects before concluding — and for job data specifically,
check `jsonLD` first, since schema.org markup is where aggregators park the full text.

## Record the endpoint, not just the finding

Session 57b's probe produced trustworthy measurements and wrote up the numbers, but not the URL,
headers, or path it called. Reproducing it cost two wrong guesses: the path is case-sensitive
(`/api/v2/jobs/search` works, `/api/v2/Jobs/Search` 404s), and the BASIC plan rate-limits **per
second**, so firing eight probes at once returns 429s that a naive check reads as "endpoint exists".
A measurement nobody can re-run is a claim, not evidence. Write down the exact call and keep the
script.

## "Mirror the JD's terms" and "restate the JD's sentences" are opposite rules

Reading `tailor.ts`, a tapped "Yes" restating the requirement verbatim looked like one defect. It is
two rules that happen to touch the same line. **Carrying the advert's hard terms is required**: ATS
keyword-matches, so if the advert says SAP and the candidate has SAP, the literal token must appear
in the CV — `docs/cv-brain/research/2026-05-03_it-pm-cv-best-practices.md` says *"mirror JD
terminology exactly; embed keywords in bullets, not keyword clouds"*. **Restating the advert's whole
sentence is the defect**, and only because it exists to make an internal token counter fire. The test
that separates them: *who is this copying for?* The employer's ATS (keep it) or our own detector
(kill it). Removing the detector must not remove the keyword rule — they look identical in a diff and
one of them is load-bearing for whether anyone gets an interview.

## A nullable column in a composite primary key stops enforcing uniqueness

Scoping eligibility facts by job family, the obvious shape was `family_id text` nullable, NULL for
facts that apply regardless of role. In Postgres two NULLs are never equal, so `PRIMARY KEY
(session_id, dimension, family_id)` would enforce uniqueness on every family-scoped row and silently
stop enforcing it on exactly the global ones — the rows most likely to be written twice. Use a
non-null sentinel (`'*'`, matching the "serves anywhere" convention already in the provider
registry) instead of a nullable key column.

## Driver-parity tests only pay off if the fixture is as sloppy as production isn't

The claims store-contract test builds claims by hand, so its helper omitted the nullable
structured-field trio. In-memory spread the object and returned `undefined`; Postgres returned
`null`. Production never hits it — zod requires the fields present — but the divergence was real and
invisible until a test asserted on a field the helper didn't set. Two drivers behind one interface
drift wherever a test fixture is loose; normalise in the driver rather than tightening the fixture,
or the contract test stops testing the thing it exists for.

## A quality bar that ignores context will fail the thing that is working

The spike bar counted "strong CV scored under 40" as an undersell, full stop. It never asked whether
the advert was in the candidate's field — so the engine correctly scoring an IT project manager low
on a business-analysis role was recorded as a defect, and the metric reported 5/8 failures on a
scorer that had just fixed every rank inversion. The criterion was penalising the family-fit feature
for doing its job. When one part of a system exists to reject inputs, every downstream quality metric
has to be scoped by that rejection, or it reads correct behaviour as regression.

## Pin the definition of any classification whose false positive is destructive

Asking a model for `"blocking": <bool>` with no definition made it classify "Drive regular, clear
communication with all stakeholders" as blocking — 4 blocking requirements on one advert. The same
prompt *with* a definition ("only a hard gate like a language, right to work, or a legally required
licence; years of experience is NOT blocking") produced 1 across eight adverts. Undefined, the label
collapses into the nearest familiar concept — here, "must-have". That is fine for a label that only
sorts a list, and unacceptable for one wired to a destructive action: blocking withdraws the posting
entirely, so the loose reading silently deletes jobs the user could have got. Treat the definition as
part of the contract, regression-test the boundary case, and count how often the label fires — a
sudden rise is a prompt regression that otherwise surfaces only as things quietly disappearing.

## Verify the suspicious number before believing the summary statistic

The spike's headline said the strong CV was undersold on 5 of 8 adverts. Hand-checking the one
in-family case (a 26 on a Basel III regulatory-reporting role) showed the score was right — the
candidate genuinely lacked every domain requirement, and the OLD scorer's higher 39 was the wrong
answer, built on the words "project", "manage" and "stakeholders". The aggregate said "regression";
the per-requirement verdicts said "correctly penalising domain mismatch, which the previous scorer
could not see at all". Ten minutes on one row changed the conclusion drawn from the whole table.

## A closed decision ticket is not a filed implementation — check, don't infer

#85 researched the retrieval contract, picked a provider, and closed. Its body referred to "#85 and
its implementation tickets", and #86's spec repeated that phrase — so two documents asserted the
build work existed and neither had checked. It did not exist, and the engine that reads job adverts
was scheduled ahead of anything that fetches them. This is the second instance in two days (the E5
gap on 2026-08-01 was the first), and the earlier lesson — reconcile the tracker against the roadmap
— did not catch it, because the false claim was inside a ticket rather than a roadmap line. **When a
research or decision ticket closes, the same session files the implementation tickets or writes down
that it deliberately did not.** Treat any phrase of the form "…and its implementation tickets" as an
unverified claim: `gh issue list --search` costs seconds, and the failure mode is a frontier query
that reports work as buildable when its prerequisite was never created.

## Producing a skill's output by hand is not running the skill

Asked to design a spec and slice it, I wrote a spec into the issue and wrote ticket bodies by hand —
then told the owner "that needs `/to-tickets`", implying `/to-spec` had run. Neither had. The content
was fine; what was missing was the part of the skill that is not content. `/to-spec` **pins the test
seams and requires confirming them with the user**, because `/orchestrate-team` drives `/tdd` at
exactly those seams — skipping it leaves every ticket to invent its own test boundary. `/to-tickets`
enforces **vertical** tracer-bullet slices; hand-slicing produced layers (contract, then client, then
orchestration) that I presented as a virtue and that no rule in the repo endorses. Before saying a
lifecycle step "needs" doing, check which ones actually ran — `ls ~/.claude/skills/` costs a second,
and a workflow's value is usually in its constraints, not its output format.

## Hand off through the tracker, not the conversation

Re-slicing needed a fresh session precisely because this one had spent an hour defending the wrong
slicing and would have anchored on it. That only worked because the spec and its design record were
already on the issue rather than in the chat, and the skill fetches an issue with `--comments`. The
handoff comment then had to carry what the spec body could not: which existing tickets are wrong,
which are already built, and which measured findings would be silently lost by regenerating from the
spec alone. When work will continue in a session that cannot see this one, the durable artifact has
to name the traps, not just the destination.

**The receiving session's duty is the mirror of it: move the evidence before closing the ticket.**
Re-slicing #86 replaced nine tickets, several carrying measurements that cost real effort — a
prompt-wording experiment, a corrected pass bar, a set of regression rows. Closing them with a
"superseded by #N" pointer would have been enough for navigation and useless for building: nobody
opens a closed issue to find the reason a prompt is worded a particular way. Each finding was copied
**inline into the replacing ticket first**, and only then were the originals closed. A pointer
preserves the audit trail; only a copy preserves the working knowledge.

## Find the tracer bullet by looking for the number that visibly changes

Slicing #86 vertically was easy the moment the code was read rather than the spec: the corpus holds
**16 postings and 8 hand-authored requirement sets**, so eight postings could not become cards at
all. That made "read an advert nobody curated" a slice with an immediate, demoable landing — the deck
goes from 8 cards to 16 — instead of an architectural milestone with nothing to show. A spec
describes capabilities; the data shows where a capability first becomes visible. When a slice's demo
is hard to state in one sentence, the seam is probably in the wrong place, and the fixtures usually
know where the right one is.

## One idea with three names is a wrong number waiting to happen

The same notion of rank was spelled three ways across three contracts — `must`/`should`/`nice`,
`essential`/`standard`/`nice-to-have`, `essential`/`desirable` — reconciled by a hand-written mapping
at each boundary that no test checks. That class of defect never crashes: it reports a plausible
wrong match percentage, and neither a reader nor a green suite can see it. **Test whether the
divergence is meaningful or accidental by asking if the mapping carries information.** Here it did
not — the card build already squashed `must` → essential and everything else → desirable, so the
three vocabularies encoded one idea and nothing else. Accidental divergence gets unified; only a
genuine difference in meaning earns separate names. Note the internal vocabulary and the words shown
on screen are different decisions — unifying the first must not silently rewrite the second.

## Cap a batch operation against the pool it will have, not the pool it has

"Re-score the user's deck when their profile changes" is free today: the corpus is 16 fixture
postings. Against a live provider pool it is thousands of paid model calls every time someone
corrects a typo — the most expensive behaviour in the product, introduced by a sentence that looked
harmless. The cap (top N by existing score) belongs in the ticket that introduces the batch, not in a
later optimisation pass, because by then the cost is in production and the fix is a behaviour change
rather than a constant. Whenever a per-item cost meets a set that is about to grow by two orders of
magnitude, size the rule for the future set while it is still cheap to write down.

## A model answer stored under a hash of the unsubstituted prompt goes silently stale

The ad reader versions each stored answer by hashing its prompt file — but the hash was computed
BEFORE the `{{KNOWN_FAMILIES}}` list was substituted in, so changing the vocabulary the model
answers FROM invalidated nothing: every advert kept its answer from the old closed list forever,
and no test can catch it because every individual read is correct at the moment it is made. The
rule: **whatever the model actually read belongs in the version hash** — template AND substituted
data — or the substituted data needs its own hand-bumped token. Same trap anywhere a cached LLM
answer depends on a list, a registry, or config spliced into the prompt at call time (#243; the
judge's fingerprint already got this right by hashing the rendered input).

## Two LLM surfaces that must agree on a vocabulary should be wired from one expression

The reader answered families from a test fixture (`["IT Project Manager"]`) while the placer
answered from the published registry (`it-project-delivery`) — so the field connecting them
compared unequal strings for a year and the code that consumed it had to be written NOT to
(#243's whole defect). The repair that makes the class of bug unrepresentable is wiring both
call sites from the same `publishedFamilies(store)` expression in main.ts: any family one surface
can name, the other can match, with no mapping table to drift. When a review later claimed a
"word-search decks get emptied" hole, the shared-source argument was the two-line disproof.
