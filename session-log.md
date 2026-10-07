# Session log — jobcrush-app

Newest first. Last ~10 sessions, ≤ ~10 lines per entry. Older entries: `docs/session-log/YYYY-MM.md` (moved unedited; under docs/ so CI stays inert).

## 2026-10-07 — #339: discovery stops asking (c520a1d)

Discovery now asks question 1, then work rights once per chosen market and languages once — the floor
questions, the reader-only question, the countdown and its section rail are gone (web + wire). "Ask me
later" stores nothing (no claim, no fact): the screen moves past it for the visit, a later visit asks again
— owner confirmed 2026-10-08 that re-asking is fine. The floor-coverage jobs gate is deleted; the completed
review is the one gate, and coverage left the retrieval fingerprint so it can't buy a paid search.
Ratchet 648 → 536. ~90 API tests and ~45 journeys moved onto real fact sources (CV via `factsFromCv`,
tailor answers); discovery-earns-reveal-gate and non-answer-skip deleted. QA gate GO (46/46 live checks).
The push hit GitHub "Internal Server Error" on every route for ~1 h (status page green), then went through.
**Next:** `/implement #341` (Fable, xhigh). Owner: #354 empty-profile copy.

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

## 2026-10-05/06 — V6f: "Your CV, reviewed" layout decided (C, the marked-up CV); #346 filed

`/prototype` for #332's review screen: three layouts side by side at phone width, same real content (the
owner's CV + the research run's review output, Société Générale thinned to play the thin job): **A** one
page of cards, **B** one job at a time, **C** the CV on paper with every review item a mark. **Owner
picked C.** One change before recording: each drafted line shows its source without a tap (the spec
requires it). Decision + screenshots + a part-by-mark table on
[#338](https://github.com/adrien-mounier/jobcrush-app/issues/338#issuecomment-5999242382); #341/#342/#343
each note their part. Prototype on branch `prototype/cv-review-332` (commit `d8d9cf2`) — **keep the
branch**, the screenshots are served from it. Layout calls carried, not vetoed: confirm locked while the
review runs; the uncovered-family job says nothing and gets no "complete" stamp; end-date/conflict pills
work before the AI finishes; an untick reason is never fit (the research run's "ad revenue off-topic" is
the forbidden kind).

The owner then asked for a way to **talk to the product** to add to his root CV (free mode limited, paid
unlimited; sign-in moving to the review screen after N exchanges; strict editing rules). Filed as grilling
**[#346](https://github.com/adrien-mounier/jobcrush-app/issues/346)**, roadmap row V6f2 — optional before
V6g, blocks nothing; on the review screen it can only add a per-job "+ add" door.

Gotcha worth keeping: a worktree **outside** the project folder can't be committed from — the shell
resets to the project root, so the QA-gate hook reads the main tree (clean) and blocks even an exempt
prototype commit. A worktree under `.claude/worktrees/` works.

## 2026-10-04 — #337: every language prints; a missing one is a fatal conservation issue

A tailored CV that loses a language the person holds is now refused: the conservation check counts each
`lang-` claim's language, finds it by name on any "additional" line (the label's wording never decides),
and a missing one is **fatal**. The draft step refuses it after the retry, and the export gate returns
409 `lint_failed` through the HTTP path. Lives in `conservationIssues` (`preview.ts`); the name list is
`isKnownLanguageName` in `cvLanguages.ts`. Brain doc `tailoring-reasoning.md` §6 updated.
**The hard part was refusing correct CVs, not catching lost languages.** QA gave NO-GO twice: first
because a line the reader misparses ("Fluent in English, French and German", "Mother tongue: Polish")
became a junk required name, then because the "clean name" shape test still let "Mothertongue: Polish"
and "Anglais (courant)" through as required. Final rule: a name is demanded only if it is a real English
language name from the runtime's own CLDR data (636 names, built once, ~130ms, full ICU confirmed on the
production `node:22-slim` image); everything else falls back to the old non-fatal "some Languages line
exists" check. **Declared ceilings** (`ponytail:` comment): a synonym the tailor swaps in (Chinese →
Mandarin, Norwegian Bokmål → Norwegian, Persian → Farsi) is still demanded and fails the draft if the
model keeps it on the retry. The fix is an alias table, if a real CV hits it. A line holding two languages
checks only the first. Any additional line naming the word counts. Not measured: how often the real model
keeps a synonym on both tries (no live calls made).

## 2026-10-04 — #336: languages pre-ticked from the CV's own level

The languages question now carries the CV's languages (`cvLanguages` on the question), each with the
CV's own level word. Native / Fluent / Professional (plus bilingual, mother tongue) are pre-ticked;
"limited", "semi", "not", "non", "basic", "elementary" pull a level back below working; any other
level shows unticked with its word; no level shows unticked and bare. Nothing is stored until the
person submits. **Design choice:** the structure is parsed on read from the stored `lang-` claim text
(`apps/api/src/cvLanguages.ts`), not stored in a new column. No contract change, and CVs already
imported get it too. QA first NO-GO: the real claim miner writes sentence-style lines for
sentence-style CVs ("fluent in English", "Native Polish speaker"), which the first parse read as
the language name. Fixed by reading level words wherever they sit; real-miner output is now a test
case. Discovery reads moved from the onboarding route to `discoveryEngine.ts` (ratchet 679 → 664).
Local e2e: run against `qa-main.js`, not `main.js`, or the 12/hour anonymous-session limit fails
the spec halfway. New journey `apps/web/e2e/cv-languages-preticked-journey.mjs` (not in Tier 2: it
injects the CV languages, so the route-mocked spec already covers it).

## 2026-10-04 — #335: ticked and kept CV lines, enforced by the server-side print gate

Every claim now carries `lineState` (`ticked` | `kept`, a text column defaulting to `ticked`, so
existing rows backfill and keep printing). The print rule is `prints` (confirmed AND ticked) inside
`claims.confirmed()`, the one list the master CV, the tailored draft and the export all read, so a
kept line reaches none of them. **Owner-visible consequence:** a kept line also stops counting as
evidence for job matching and tailoring, and an untick changes the deck's search fingerprint (one
fresh search on the next deck read), the same as a confirm or reject does today. `PUT /cv/lines/:id`
`{state}` records the person's tap (session-scoped, 404 for unknown/foreign). Confirming, editing,
re-seeding or re-answering never re-ticks a kept line. The correction sweep (`heldSentences.ts`) now
scans kept lines too, otherwise a re-tick brought back a superseded value. **Owner decision:** the
profile's not-yet-confirmed grey reads "Not on your CV yet" (captions, detail, hero line, sorted-list
note); "Kept for when a job needs it" now means only an unticked line, shown last in its job or
section. CV-brain rule added (`cv-authoring-rules.md`). QA: first NO-GO (About you didn't split kept
lines), fixed. New journey `apps/web/e2e/ticked-kept-lines-journey.mjs`. Three older profile
journeys (constellation-sky, list-style-b, shape-a) crash on fixture data stale since #188 — outside
every CI tier, not fixed here.

## 2026-10-04 — #334: per-step AI configuration (provider, model, reasoning, limits, streaming)

Each AI step now reads its provider, model, reasoning level, output cap and deadline from
`apps/api/data/ai-steps.json`; main.ts builds every step with `llmForStep(step)`. Existing steps are
configured to their old values (sonnet-5, thinking off, 32k, Fireworks MiniMax M3 at 8k/60s);
`JUDGE_MODEL` / `FAMILY_PLACEMENT_MODEL` still override. The Anthropic call now **streams** and sends
the configured level as adaptive thinking + effort ("off" keeps thinking disabled). A stream that
errors or ends before `message_stop` fails the call. A **review** step exists: Fable 5.1 at max, or
Opus 5.5 at max under `AI_PROFILE=test`. The settings file is checked at boot: a Claude step must name
a reasoning level and a Fireworks step must not. QA GO: 1850 API tests, 8 mutations all went red, the
compiled app boots, CLI fallback and one Fireworks call ran live (~$0.0001). **Not proven:** a real
Fable/Opus streamed call, because there is no Anthropic key locally. #340 (blind test) is the first
real run. Fable's `refusal` stop reason is not handled yet; it would come back as empty text, so #341
must handle it. The endpoints' own `fallbacks` option was not enabled.
