# Session log — jobcrush-app

Newest first. Last ~10 sessions, ≤ ~10 lines per entry. Older entries: `docs/session-log/YYYY-MM.md` (moved unedited; under docs/ so CI stays inert).

## 2026-10-25 — #432 built on a local branch: a stray newline or tab in a model answer is repaired, not retried (8e7e1fa)

`/implement 432` (Opus 5.5) under the owner's no-CI, no-deploy, no-paid-calls constraint. The named base `fix/431-tailor-target` did not exist; owner chose `fix/432-report-json` = `fix/431-unknown-card` + #427's 972e97f copied (faacbff; docs conflicts kept #431's side).
- `extractJson` (every step reads answers through it) escapes raw control characters inside JSON strings before parsing. Test red on the old code with staging's exact error, green now.
- The report's and stretch step's final failure lines go through `failureReason`: cause only, never the answer. `/code-review` caught the report's "talks about the document" refusal quoting the model's line into the log; now names only the matched phrase.
- QA **GO** on tree 0fe4dcb: api 2265, contracts 60, typecheck 7/7; no browser pass (no screen, a live run needs a paid call).
- Not pushed. #427's commit carries `Closes #427`, so both close when main gets the branch.
**Next:** the owner ships the branch → CI → staging; the re-proof resumes (first Approve press is the live check).

## 2026-10-25 — #431 shipped: a deck job stays tailorable past the deck's 5-minute search window (a415f26)

`/implement 431` (Opus 5.5), on its own branch off main so #427 (still waiting on the owner) does not ride along. The Tailor step read its job through the deck's "search again?" rule, so five minutes after the deck's search every Tailor door answered "unknown card".
- The Tailor step now reads the session's last search, kept past the window. Each job is still held to its own liveness (expiry, its source's freshness window), and a search made for a different request is still refused (#101). The deck's 5-minute rule is unchanged.
- `/code-review` caught the Tailor profile answer's "Hidden N jobs" count, which would have read an empty pool past the window and said 0. Fixed and tested. The want door shares the lookup, so a card picked from a deck page left open over 5 minutes now works.
- QA **GO** on tree bc38fc4: api 2257; a live drive waiting 6 min 20 s, then edit, It's true, Undo, Use, No, Approve, with the email sent at 7 min 13 s (20/20); six Tailor journeys green.
- Filed #434 (a later deck search that fails or drops the job still turns it into "unknown card") and #435 (the new 9-minute journey is in no tier). The #427 branch's four docs commits were cherry-picked here, so main's roadmap is current.
**Next:** CI → staging; #432; then the owner's re-proof resumes.

## 2026-10-24 — #428 shipped: the Tailor step's CV and its suggestions arrive at once (e2920ec)

Owner's re-proof (`+test6`): a deck job's Tailor step showed the CV, then ~40 s later a closed "Ready to send" panel, every suggestion "Not answered, left out"; he read it as no suggestions. The staging log showed the step had run. Cause: #418 showed the draft on "suggesting" and reported "running", which spent the page's once-only auto-open; a failed step spent it too, so "Look again" also landed closed.
- Owner's call: the CV and its suggestions arrive at once. The wait screen holds until the job completes, the "running" rail state is gone, and only a view that ran spends the auto-open.
- No test saw it: mocked specs answer at once, and qa-main's fake finishes before the stream connects (lesson added). Two specs red on the old code, green now; QA **GO** on tree fc86206 (live with the step held 15 s: 45/45).
- Also on the run: the stretch call retried once (#427); ~1 min of Anthropic "credit balance too low" just before (recovered by itself; owner to check billing).
- Filed #427, #429 (Look again keeps the old failure message beside the wait screen), #430 (a stretch delay in qa-main; #428's journey into tier 2).
**Next:** CI → staging; the owner resumes the re-proof.

## 2026-10-24 — #425 shipped: a job that needs a language you don't have leaves the deck (c74cb64)

`/implement 425` (Opus 5.5). A required language must be on the CV (any line not rejected, printed or not) or the profile, or the job leaves the deck. The reveal names each language with its count and "Yes, I speak <X>" (`POST /review/languages/spoken`), also on the empty and widened decks. "I don't speak this one" still wins over the CV; pasted jobs never leave.
- A working word on the CV (native, fluent, professional, bilingual) settles the language: no Tailor question, the card shows it met ("Your CV says: …"), the report never says "Not checked". One rule, `unsettledLanguage`.
- The "existing language-name rules" the ticket cited did not exist. New, in `languageLevel.ts`: Putonghua = Mandarin; "Chinese" is met by Mandarin or Cantonese (owner to confirm); "X and Y" / "X or Y"; words around a name ("fluent English").
- `/code-review`: an unguarded save door, the brought-job line naming a gap he never confirmed, sentence-style CV lines. All fixed. QA **NO-GO** once: the report still matched by whole phrase. Fixed, then **GO** on tree e06a338: api 2252, owner journey 22/22, ladder 56/56, report 31/31.
- New tier-2 `cv-language-level-journey.mjs`; the gate's `owner-language-filter-journey.mjs` kept on demand (its email check needs `MAIL_LOG`). Filed #426 (two languages at two levels on one CV line).
**Next:** CI → staging; then the owner's re-proof on a fresh staging account (roadmap finish line, step 3).

## 2026-10-24 — Owner's re-proof on staging stops at languages: #425 filed and decided

No code. On a fresh staging account (Hong Kong), the first card needed Cantonese, which isn't on the CV, and Tailor asked about English though the CV says "English (Fluent)". Diagnosed from staging rows and the request log: the code follows the rules as written.
- #123 (Aug 4) withdrew a job for an unticked language. #165 (Aug 12) narrowed that to an explicit "I don't speak this one", because one mistap was silently deleting jobs. #376 (Oct 14) moved the languages question off the start, so nothing asks before the deck, and 12 stored HK jobs that require Cantonese reach every new deck.
- Owner decisions (on #425): a job that requires a language not on the profile leaves the deck, with a one-time "I left out N jobs that need X — do you speak it?" line. A working level word on the CV (native, fluent, professional, bilingual) meets the requirement, with no question.
- Mistake to learn from: my first question framed this as a new rule. It was the original one, and the owner had to ask me to check the history.
**Next:** `/implement 425`; then the owner's re-proof on a fresh staging account.

## 2026-10-24 — #423 shipped: the Tailor screen takes the #408 layout, with "Your CV | The job" tabs (9469733)

`/implement 423` (Opus 5.5). The owner's call after spec #412, prototype variant E:
- The CV starts right under the bar, with only the tabs between. #411's breakdown and folded ad are off this screen (the deck and the job's own screen keep theirs), and the ageing line moves to the rail.
- The job shows the job's text line for line. Each pending suggestion's numeral sits on the job line it answers, and the open one is lit. The line comes from the server: `TailorRequirement.line`, found from the reader's stored `sourceSpan`, word by word, else the longest line it starts with.
- Phone: a one-line bar, 61px (it was ~230px; #422 closed into this). "See where the job asks this" jumps to the lit line, "Read the job" to the top.
- `/code-review`: tests pinned exactly, the heading-steals-the-numeral case fixed, T added to the keys test. A self-inflicted journey crash taught a lesson: a spec run rebuilds `.next` under a live journey stack.
QA **GO** on tree 3d37dc5: api 2221, mocked 299/299, six Tailor journeys plus the new `tailor-the-job-tab-journey.mjs` 78/0. Filed #424 (4px tab clip on a phone; the swap line while The job shows). `spec-301-finish` was rewritten but not run (needs `QA_PDF_PAGES=3`).
Pushed `afff42d..9f85927`, which also carried another session's unpushed 1b4f466 (the watermark removal). CI run 40076699572 was green and deployed it to staging. The leftovers from other sessions were killed on the owner's word: the #411 worktree's `next start` on 34110 and a stuck `stretch-use` journey on 34220.
**Next:** the owner's re-proof on a fresh staging account (roadmap finish line, step 2).

## 2026-10-24 — Spec #412 shipped: the CV is written first, only stretches are suggested (#413–#420, #411; d411ecc)

`/implement-spec 412` (Fable 5.1, then Opus 5.5 xhigh after the Fable quota ran out). Nine tickets in worktrees on `spec-412`.
- **#413/#416:** years bars by family (each job counted once) and degree levels decided by rule in `recordBars.ts`. Reader `adreq/5`, judge `judge/2`, so each stored card is re-judged once (~$0.02).
- **#414:** a job can be both kinds of work, with a *Kind of work* row on the job page. Labeler eval: bars hold, but confidence fell (comment on #414).
- **#415:** yes/no queue gone; the draft starts by itself; "Also asked" list and "Where you fit" sheet.
- **#417–#420:** stretch step (`stretch-suggestions.md`, `StretchProposalV2`) with Use, It's true and Edit wording. **#411:** breakdown on the Tailor screen.
- `/code-review`: 13 fixes, including the deck list reading stretches (onboarding.ts ratchet 523 → 515), carried answers on a redone step, refusing answers after approval (409), and a 20-per-session cap on paid rewrites.
QA **GO** on tree 911c990: api 2218, mocked 292, 25 journeys, live drive 84/0 at both widths, migration checked on real Postgres. Filed #421 (withdrawal journey rotted in no tier) and #422 (phone top bar too tall).
Staging-only, still open: the owner's real CV and Hong Kong job, the stretch step's measured cost, the report email body. Screen order follows #411 (the ageing line and "Read the ad in full" stay), not the prototype.
**Next:** owner re-proof on a fresh staging account; then Chat with JobCrush (#350).

## 2026-10-23 — #408 grilled and decided: ADR-0020, the CV is written first; spec #412 filed (#413–#420, #411)

No code. `/grill-with-docs 408` (Opus 5.5): nine owner calls, plus a two-round prototype (`/impeccable` critique 24/40 → round 2 approved). The decision is on #408, which was closed by hand:
- The Tailor step asks only work rights and a required language, then writes the CV from true facts.
- One more AI step suggests stretches beside the draft (line in / line out / what to say). The answers are Use for this job (raises this job's % only; *met by a stretch*; owner's call against the agent's recommendation), It's true (master CV), or No (this job only).
- Years bars count every named field, each job once, decided by the number alone; a job can be both kinds of work.
- "Also asked, not on your CV" has no button until #350.

Staging evidence: 7 questions, 0 real gaps. The scorer cannot see dates (years 0.475 for 9.8 years held); the degree scored 0.3–0.9 across runs.
Docs cbb922a: ADR-0020 and its amendment notes (ADR-0011 cl. 1–2, ADR-0005 cl. 3/5/9, tailoring-reasoning §5/§8), GLOSSARY *Stretch*. Prototype: branch `prototype/stretch-suggestions-408`. #350 gains the gap-list door.
**Spec #412:** waves #413 #414 #415 → #416 #417 #411 → #418 → #419 #420. Suggestion step ≈$0.05 per CV (estimate).
**Next:** owner types `/implement-spec #412` (Fable 5.1, high); then his re-proof on a fresh staging account.

## 2026-10-22 — Spec #403 shipped: five screen fixes from the owner's staging run (#404 #402 #405 #406 #407)

`/implement-spec #403` (Fable 5.1, medium): three implementers in worktrees on `spec/403-staging-fixes`, no merge conflicts. **#404/#402** `splitLetterhead` splits on a spaced dash too, but only on a line that carries an email or phone (a title like "Purchasing Manager - Ingredients & Packaging" stays whole); the English label list is gone — any run of `word:` labels left after the contact is taken out is dropped, so "Natel:", "Portable :" never reach the title. **#405** `cv-review.md` v3: About you is a third-person pitch (identity opener, two or three results, no closing list); the printed summary keeps its strict rules; brain doc updated. **#406** the stored advert already had its line breaks; one `white-space: pre-line` on the shared card shows them on the deck, the job screen and the tailor. **#407** Where you fit = the requirements the scorer counts as met, each with the verdict's `reason`; the bubble's first half is that reason or nothing; `CardFact` gains an optional `reason` in zod + oracle + golden (additive, no version bump — owner to confirm that reading of "change contracts only by versioning"); `card-judge.md` now writes reasons to the person as "you".
`/code-review`: golden mutation missing, a label-in-the-middle regression, two nits — fixed. QA gate 1 **NO-GO**: the reason's class `why` collided with the tailor screen's eyebrow label (uppercase) and broke `tailor-journey`; plus a trailing " -" on the phone, the title cut at a spaced dash, "E-mail:" behind a comma. All fixed; QA gate 2 **GO** on tree 3b5eb66: api 2161, typecheck 7/7, mocked card specs 75/75, `spec-403-staging-fixes-journey.mjs` 33/33 (committed, not in tier 2), tailor 53/53, grow-door 23/23.
**Filed:** #409 two-column letterhead reads the address as the title, #410 two phones on one contact line. **Cost note:** the judge prompt changed, so every judged card is re-judged once on staging.
CI green on efa4696 (run 39753904814, all 42 tier-2 journeys, ~85 min), staging serves that sha. **Owner re-proofed on staging the same day: "the defects I raised look ok"** — the three staging-only ACs (#405 About you on his real CV, #407 his real judged card, #404 fresh account) are covered by that check.
**Next:** grill #408 (Opus 5.5) in its own session — the Tailor step's question queue; then its spec and build.

## 2026-10-22 — Owner's staging run: six defects, #403 (five fixes) and #408 (decision) filed

No code. Root causes traced in code before filing. **#403** parent, one `/implement-spec` run: #404 location keeps the letterhead's " - " separators (`splitLetterhead` splits on `|·•` only); #402 moved in (same function); #405 About you becomes a third-person pitch (owner's call; rule F of `cv-review.md` had applied the strict summary rules on purpose); #406 the advert in full loses its line breaks (plain `<p>`); #407 "Where you fit" was every confirmed fact unfiltered (`buildJobCard`'s `fit`) and the bubble quoted the fact the scorer cited, often About you; the verdicts' `reason` already holds what both need.
**#408 (grilling):** the Tailor step asks every requirement under fit 0.8 with the #13-era "Does that describe you?" template; partial matches and possibly a low years figure land as questions. The agreed rule (#301/#292, ADR-0011) was "ask only what the CV does not answer"; the owner now wants the CV written and only stretches proposed.
**Next:** `/implement-spec #403`; grill #408.

## 2026-10-22 — #398 shipped: four check-mode reads on the owner's real CV (a5d3568)

`/implement #398` (Opus 5.5, medium). (1) The letterhead reader drops contact labels ("Mobile:", "Email:") before picking the title — his CV now reads "SENIOR PROJECT MANAGER", not "- Mobile:". (2) Root cause of the BRED bullet under Personal projects, confirmed by a read-only staging query: the miner gave it the id `project-status-reporting-steering-committee` under the BRED role, and `kindTag` trusted the `project-` prefix. A `project-` id now counts only on a no-job (`profile`) claim — staging's 14 real personal projects all are; `edu-` lines carry their school as role, so the rule is not widened. Read-time, so his stored line moves back with no data step. No "Move to <job>" control was built. (3) A removal reason names a line by its words; an unknown bracketed id reads "another line". (4) The tailor screen says "Saving your answer…" while an answer posts. QA **GO**: api 2155, tailor.spec 26, check-mode.spec 65, full walk 126/130 at both widths, new `tailor-answer-saving-journey.mjs` 8/8; every new test red against the old code.
**Follow-up:** #402 non-English labels ("Natel:" on a Swiss CV) still read as the title. Old removal reasons stored before this keep their ids until a re-run.
CI green on c5c867e (run 39718932472): live on staging. Owner asked for the test-account ticket (#345): not needed for the re-proof — any new email address (Gmail `+test1`) is a fresh, empty account; #345 stays for repeat runs and the old-data wipe.
**Next:** owner signs in on staging as `adrien.mounier91+test1@gmail.com` (private window), uploads his CV, pastes a job, approves → `/qa-gate` GO on the whole journey; then Chat with JobCrush (#350).
