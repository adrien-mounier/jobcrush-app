# Session log — jobcrush-app

Newest first. Last ~10 sessions, ≤ ~10 lines per entry. Older entries: `docs/session-log/YYYY-MM.md` (moved unedited; under docs/ so CI stays inert).

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

## 2026-10-04 — #333: ADR-0016 + glossary — the CV is reviewed, not asked

Docs only. **ADR-0016** records the "Your CV, reviewed" design: discovery keeps only work rights and
languages; the review (fixes, quality-only untick suggestions, drafted lines under R1–R6, vague-phrase
choices); ticked/kept line states with a server-side print gate; the jobs gate becomes "review
completed"; drafted lines generated once and stored. It amends ADR-0011 clause 2, ADR-0013 clause 2 and
ADR-0002 clause 2, each now carrying a pointer at the clause; it states ADR-0007 stands whole and notes
ADR-0015's "the floor gates the reveal" is superseded. `CONTEXT.md` gains **review**, **drafted line**,
**ticked line**, **kept line**; **family floor** no longer gates the reveal — it feeds the drafter and
keeps matching/scoring. Next frontier: #334, #335, #336, #337.

## 2026-10-04 — #326 grilling: discovery stops asking, the CV is reviewed instead

`/grilling` on **#326**, five rounds, every branch decided and confirmed by the owner. **The
decision:** the four family-checklist questions are removed. After the CV read, the app reviews the
CV job by job: it fixes spelling and grammar (applied, listed, undo each), suggests unticking weak
lines (quality only — weak, duplicate, aim without result; fit is decided per advert), and **drafts**
one line per must-have a job does not show, under six rules (duties only; every word true for anyone
at that level, variable duties as their own OPTIONAL line; seniority verbs; industry guesses flagged;
never repeat; never pad, max 10). Vague phrases in a drafted line carry CV-first suggestions plus a
text box. Nothing prints until ticked (server-side). Journey: CV read → job and area → work rights →
languages (pre-ticked only at Native/Fluent/Professional) → mandatory "Your CV, reviewed" →
reveal/wall/deck → tailor. The countdown and "your CV saved you N questions" are removed.

**Evidence, blind.** The session model's first simulation was contaminated — written after reading
the real BRED lines — and is kept, labelled as such. The re-run hid the BRED lines from every
generator: 16 Claude runs and 10 Fireworks open models, scored against the real lines. Only Fable 5.1
max and Opus 5.5 max never stated a guess as a fact; Fable max also recovered the owner's distinctive
BRED facts; no open model matched it (best open: Kimi K3). **Model:** Fable 5.1 max for the product at
≈ $1.40 per CV (the full review measured on Opus 5.5 max at $1.39–1.41 and ~10 min; Fable estimated,
because the Fable week was 97% used); tests run on Opus 5.5. Fireworks spend: 10 calls, ≈ USD 0.25.
**Found on the way:** the language conservation check only looks for a Languages line, not each
language (owner: every language prints, always); the app's Anthropic call disables thinking, which
Fable rejects. Everything is in `docs/cv-brain/research/2026-10-03_thin-job-line-generation/`.
Next: `/to-spec`.

## 2026-10-03 — #323: two degrees are two facts — the false import conflict, and the silent drop

`/implement` -> `/code-review` (both axes) -> `/qa-gate` (**GO**, first run) on **#323**. The owner's
CV showed its Master's as a "question": the miner tagged two education entries with one field key,
the proof read that as a contradiction, and reconciliation kept only the last of the two. Three
cuts: (1) the miner's repair step strips field tags from any claim of a kind that can repeat (the
prompt's own `edu-`/`cert-`/`lang-`/`skill-` ids), so neither reader can misfire whatever the model
tags — and the prompt rule now says so (v3.1); (2) reconciliation keeps two claims that share a
field key with different values — a genuine contradiction is two facts for the deck, not one fact
read twice — under stable value-named ids (`search-area-london`), collapsing only to the person's
own stored answer; (3) a conflict on the record reads as a question naming both values ("Search
area: your CV says Bangkok and also London. Which one is right?") with the values carried as the
choices. **Decision inherited from #325 and taken here:** no screen asks the conflict; both claims
go to the deck, where the person's review decides. The import-resolution route stays, server-side
only, ready for a screen if one is ever wanted. **Live proof, no API money:** the owner's real CV
mined twice through the local CLI — both degrees as plain facts, no conflict, 49 of 49 kept.
Written-only gap: jobs have no id prefix, so only the prompt protects them from a field tag.

## 2026-10-02 — #325: a good CV read goes straight to the job-and-area question

`/implement` -> `/code-review` (both axes) -> `/qa-gate` (NO-GO on AC4, then **GO**) on **#325**.
The front door's import proof screen (counts, "From your CV" lines, conflict field, "Ask me what's
missing") is gone: a good read keeps "Reading your CV…" up until the job question opens, with a
retry if that hand-off fails. Kept: could-not-read, nothing-useful and read-in-part screens, each
with its retry. A reload after a good read lands on the job question, and never pulls a later stage
back (spec-review catch). API: always-zero `skippedQuestionCount` deleted; the other proof fields
and the import-resolution route stay, with their readers named on the `ImportProof` type — the
conflict question is now asked nowhere, and #323 inherits that. **Fake-stack caveat:** the fake
miner's recorded read always comes back "partial", so Tier 2 journeys walk the partial screen; the
QA-left `import-straight-to-intent.mjs` relabels the outcome to drive the good-read path live.

## 2026-10-02 — Skill-guidance pass: contents lists on long docs, QA checklist (no ticket)

Studied Anthropic's updated skill best practices (via the Simon Scrapes video of 2026-10-01) and
applied two of its rules. **Contents lists** added to the 17 agent-read docs over 100 lines (every
ADR, `CONTEXT.md`, `cv-brain/` rules, reasoning and the IT-PM research note); `CLAUDE.md` left
without one on purpose (see `lessons.md`). **QA tester brief** (`~/.claude/agents/qa-tester.md`,
outside the repo) now carries a copy-and-tick checklist and a go-back line: a failed browser step
cannot be ticked and sends the tester back to the gates. Rule still under design, not applied: a
**self-correcting CV brain** — a failed draft proposes the missing authoring rule for the owner to
approve. Docs-only; no CI, no deploy.

