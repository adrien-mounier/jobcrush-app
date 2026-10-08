# Session log — jobcrush-app

Newest first. Last ~10 sessions, ≤ ~10 lines per entry. Older entries: `docs/session-log/YYYY-MM.md` (moved unedited; under docs/ so CI stays inert).

## 2026-10-08 — First real-CV run on staging: miner hotfix (bef04fb) + six defects filed

Repo made public (free Actions minutes; CLAUDE.md d6fa300). The owner's real CV failed upload: the miner
returned null `semantic_key`; `repairClaims` now falls back to the claim id (QA GO, hand-deployed API).
Second upload reviewed fine: BRED and SG placed as IT Project Manager, both COMPLETE ✓, 1 suggestion.
Defects filed: #359 (any read failure blames a scan), #360 (letterhead swallows summary), #361
(Product Owner unplaced → no must-haves), #362 (failed review shows "0 to check"), #363 (Fly
auto-stop kills a running review, killed call burns an attempt), #364 (unit failure reason not
kept; SG failed first attempt twice). ~USD 2.80 spent. **Next:** #361–#364 before #344.

## 2026-10-08 — #358: the two review journeys run in the tier-2 CI set (b5432c5)

`drafted-lines-gate-journey.mjs` and `word-choices-journey.mjs` now run on every deploy, each with
its "earns its slot" note. They are the only journeys that read the master CV back after the
review's new lines are handled. Added CI time: ~3.5 min (106s + 103s locally). The QA gate caught a
narrowing the first draft made: `qaReviewAnswer.ts` had been unmapped, so it selected every journey.
It now sits in the shared REVIEW area, which selects all 13 review-carrying journeys. QA gate **GO**.
Still to confirm: a green CI run with both journeys in it. **Next:** #344 (Fable).

## 2026-10-08 — #343: word choices on a drafted line's vague phrase (ddfa8ac)

A vague phrase in an unticked drafted line now wears a dotted gold underline; a tap opens the sheet on
its choices: From your CV first (with the CV words), then Typical, each tagged, plus "Or type your own".
A pick or typed words replace the phrase through the draft's edit door, persist, and print once ticked.
The choices ride on the stored review checkpoint, so opening them makes no request and no AI call; a
review stored before #343 shows none. A picked choice stays tappable to change (code review caught it
missing); typed words do not (Edit changes them). QA gate **GO**: API 1945, review.spec 19/19, three
journeys green incl. the tester's new `word-choices-journey.mjs`. Filed #358: neither review journey
(#342's, #343's) sits in a CI tier. **Next:** #344 (Fable).

## 2026-10-08 — #342: drafted lines for missing must-haves — unticked, source-cited, tick to accept

A job's drafted lines now land on the paper as claims in a third line state, `drafted`: on the paper,
printed nowhere (the one print gate refuses them — proven red through the master CV, the tailored
draft and the export), left alone by the confirm, ticked only through the review's own door, which
makes a confirmed `drafted-accepted` fact in the person's own wording if they edited it first. Dashed
gold boxes at the end of the job with a + to tick, flags inline, the source under each without a tap,
Edit and Tick in the sheet, the "new" tag once ticked, the COMPLETE stamp decided by the model's own
must-have account (code review caught the stamp reading off surviving drafts). QA gate **GO**: API 1944,
spec 17/17, six journeys green incl. a new `drafted-lines-gate-journey.mjs` (reloads, wrong-way doors,
master CV). Filed #357 (the wording polish could reword a rewritten draft; off the v1 path); noted the
re-upload draft-id carry-over on #344. **Owner to confirm:** a complete job may still show OPTIONAL /
INDUSTRY GUESS boxes beside its stamp; "From your CV:" does not name which job the quote came from.
**Next:** `/implement #343` (Opus, medium): word choices; #344 after it (Fable).

## 2026-10-08 — #341: the review runs in the background — fixes with undo, untick suggestions (32b1457)

The CV review (`cv-review.md`, the "review" step) now starts from the import the moment the lines are
stored and the jobs placed: one call per job in parallel, the sections on the first, checkpointed per job
in a new store (`cvReviewStore.ts`), retried once, resumed after a restart for unfinished jobs only, never
re-asked once answered; a run that fails after its retries leaves the lines as read and says nothing. On
the paper: fixes applied by default to the line's own text (undo restores the exact original), the
corrected word green; untick suggestions as an amber band with their reason, the line ticked until the
person acts; a progress card while it runs, unanswered jobs greyed, the confirm locked (409 server-side).
Code review: `start()` never rejects into the pipeline; one fake reviewer (`qaReviewAnswer.ts`) for the
QA stack and the HTTP tests; the review deadline 30 → 10 min (a hung provider locked the jobs for an hour).
QA gate **GO** (API 1937, spec 12/12, journeys 65/0 + 23/0, Postgres probe); it found #356 ("Next ↓" never
leaves the letterhead, shipped with #338) and a journey-hold hygiene item (noted on #355). **Owner to
confirm:** a partly failed run keeps the finished jobs' marks (spec says "no fixes"); per-job calls may cost
more than #340's one-call $1.0–1.4 — measure the first real run on staging; the marks' colours and the
band's amber edge are the prototype's, outside DESIGN.md (the design hook flags them).
**Next:** `/implement #342` (Fable, xhigh): drafted lines; `/implement #354` (Opus, medium) is independent.

## 2026-10-07 — #339: discovery stops asking (c520a1d)

Discovery now asks question 1, then work rights once per chosen market and languages once — the floor
questions, the reader-only question, the countdown and its section rail are gone (web + wire). "Ask me
later" stores nothing (no claim, no fact): the screen moves past it for the visit, a later visit asks again
— owner confirmed 2026-10-08 that re-asking is fine. The floor-coverage jobs gate is deleted; the completed
review is the one gate, and coverage left the retrieval fingerprint so it can't buy a paid search.
Ratchet 648 → 536. ~90 API tests and ~45 journeys moved onto real fact sources (CV via `factsFromCv`,
tailor answers); discovery-earns-reveal-gate and non-answer-skip deleted. QA gate GO (46/46 live checks).
The push hit GitHub "Internal Server Error" on every route (both protocols, any branch) for ~1 h with the
status page green; a plain retry later went through. Owner decisions: re-asking a put-off question each
visit is fine (only work rights + languages can come back); #354 empty profile points to the CV
("Add your CV"), ready-for-agent. Filed #355 (journey hygiene).
**Next:** `/implement #341` (Fable, xhigh); `/implement #354` (Opus, medium) is small and independent.

## 2026-10-07 — CI red five pushes on one journey; cause found from the report, staging deployed (9e9bf04)

Four pushes to `main` (f7fd59c → 28235df) failed `discovery-plan-split-journey` on "the deck is in the same
order" — 59% before, 49% after, never reproducible locally (both 49%, even CPU-saturated). Two fixes built on
reasoning were wrong (c5d0cd4: wait for the labelers; d9de015: wait for a settled deck). The diagnostics
pushed in 28235df found it: when a session's facts grow, `judge.ts` re-grades only the still-unmet
requirements (#117), and the fake judge covers the FIRST requirement it is handed — each partial re-grade adds
one met requirement; the journey's own answers grow the facts. The real judge grades content; the product is
unaffected (QA gate asked that question directly: no defect). 9e9bf04 asserts membership + search family, the
ticket's claim; the lesson is rewritten; #353 (years-fact race) closed as a disproven hypothesis. The other
session's front-door focus fix (17efba2) rode along. **CI green, staging on 9e9bf04** — the first deploy since
524cc55: #338, #340, the Fireworks streaming fix. Cost: ~6 pushes ≈ 6 h of CI minutes on one test.
**Next:** `/implement #339` (Opus, high); first real paste on staging checks the Fireworks labeler streams.

## 2026-10-06 — #340: the review prompt (R1–R6) + blind-test script, proven on the owner's real CV

The CV review's brain is in: `apps/api/prompts/cv-review.md` reviews the whole CV job by job — fixes,
quality-only untick suggestions (weak / duplicate / aim-without-result, **never fit**: the research run's
"ad revenue off-topic" is the forbidden kind), one drafted line per missing must-have of each job's
**own** family under R1–R6, vague phrases as CV-first / TYPICAL options — answering JSON per job named in
JOBS TO REVIEW, so #341 can checkpoint and retry per job. Brain doc `tailoring-reasoning.md` §9 states
the rules; a guard test pins both copies. `scripts/blind-test.mjs` runs any input against any model
through the app's own drivers and prices it from the providers' pages (dated in the script).
**Measured on Fable 5.1 max via the API (from staging, which holds the key):** whole real CV 214 s /
USD 1.00; thin BRED 293 s / USD 1.39, 8 drafted lines, 5 of 6 personal facts recovered as flagged
options, zero slips, zero inventions. #332's "≈ $1.40 / ~10 min" corrected to **$1.0–1.4 / 3.5–5 min**.
Spend: 6 calls, ≤ USD 3.9 (two lost calls: Fly's proxy stopped the machine mid-run; Node's 5-min header
timeout killed a non-streamed Fireworks call → the Fireworks driver now streams, lessons filed). Code
review: letterhead/sections `null` when not requested; R6 reads "a missing must-have always earns its
line, extras stop at 10" (owner can veto). Two calls made in the prompt, flagged to the owner: R4's
cross-job clause (a fact under another job is OPTIONAL with its quote, never plain) and the R6 reading.
QA: round 1 NO-GO (the guard test read a `docs/**` file — a CI-ignored path, so a docs-only push could
have left `main` red; dropped), round 2 **GO** (API 1935, targeted 26, typecheck 7/7, gates-only: no UI).

## 2026-10-06 — #338: "Your CV, reviewed" with lines as read; the jobs wait for a completed review

The journey is CV read → job and area → work rights → languages → **Your CV, reviewed** → jobs. The
screen is layout C (the CV on paper, every review item a mark, one sheet): letterhead as read, each job
with its lines ticked, untick → kept / re-tick, the end-date pill on the job's own card ("Not sure"
sends nothing), the import conflict settled once, the confirm. It is also the silent-failure state for
#341. **The gate:** a session that brought a CV sees no posting until the review is completed —
`reviewOpensJobs` sits inside the one predicate every posting reader passes through, so the deck, the
want door, the tailor, and a job the person pasted are all held (code review found the pasted-job hole;
closed). The floor gate stays beside it until #339. Completing confirms the lines as read; an open
conflict's two readings stay off the CV until settled (code review). The date question left discovery:
the spine shrank, ratchet 664 → 648. Every CV-carrying journey now completes the review over the wire
(`qa.completeReview()`); `cv-review-journey.mjs` walks it as a person. QA: round 1 NO-GO (the paste-a-job door still scored a job against an unreviewed CV — closed at the paste read,
test shown to fail), round 2 **GO** (API 1930, specs 84, gate-doors 23/23, review 30/30, paste-door 26/26).
CI on the push went red on one Tier 2 journey (discovery-plan-split: its first deck snapshot now lands
before the industry labeler, 59% vs 49% — a pre-existing race the shorter discovery exposed); the
journey waits for the labelers now, scoped GO, pushed as the follow-up commit. Lesson filed.
**Correction (2026-10-06, later session):** that wait did not hold — CI failed the same way on the next two
pushes; the years facts land after the placements. The journey now waits for a settled deck (see lessons).
**Correction 2 (2026-10-07):** the settled-deck wait failed too (runs 37494790890, 37559882744). The real cause,
read off the report's diagnostics: the fake judge covers the first requirement it is handed and #117's superset
reuse re-grades only the unmet ones, so the journey's own answers move scores and order. The assertion now
checks membership, which is the ticket's claim; the lesson is rewritten.
That run then went red on a pre-existing front-door flake (focus moved on a frame timer, CODING_STANDARDS
forbids it): fixed for the hand-off error, scoped GO; the four sibling spots are #352.
Not built here, by the layout comment's split: the legend and the AI marks (#341–#343); a name field with
its own Edit (no name store exists); job-level date conflicts (the proof holds one field conflict).

## 2026-10-06 — Retro of 10 agent sessions: environment fixes landed (`524cc55`); #351 follow-ups

`/retro` found the environment, not the product work, costing the time. Landed (owner: "go ahead for
everything"): the QA gate on main is now git's own pre-commit/pre-push hooks (`.claude/githooks/`) —
code reaches main only byte-identical to what the qa-tester tested (`record-go.mjs` fingerprints the
tested tree); Playwright starts its own fake-model stack on private ports; miner recordings follow the
prompt's id prefixes (+ test); `sourceHygiene` test replaces the dead lint; `.gitattributes`, PYTHONUTF8,
ADR index, CLAUDE.md/issue-tracker fixes. QA: rounds 1-5 NO-GO on the gate (a command-text parser is
unwinnable — four rounds found new shapes; the git-hook redesign ended it), round 6 GO. **Git's hooks
also gate the owner's own terminal commits on main** (docs pass; override `SKIP_QA_GATE=1`).
Follow-ups (low): #351.

## 2026-10-06 — #346 grilled: Chat with JobCrush decided (ADR-0017); spec #350 next after #332

The owner wants to talk to the product instead of updating his CV in outside Claude sessions. Decided:
"+ tell us more" (one thing) and "+ add" (a section) on both the review screen and the profile, one tab;
it may add/reword lines, add a job, fix dates/employer/title/letterhead, never untick or delete; every
change is a tapped **chat proposal** quoting his words; **no stretch** (ADR-0005 upheld after a late
conflict check — the owner had first said yes); proposals kept, transcript not; own AI step (~$0.14 per
exchange est.), $5/day cap. ADR-0017 amends ADR-0016 clause 6. #316/#317 closed as replaced. Filed:
#348 landing sign-in door (he can't sign in from a new browser), #349 free/paid + sign-in move (parked
behind #288/#298), #350 the spec. Glossary: Master CV ("root CV" avoided), CV chat, Chat proposal.
