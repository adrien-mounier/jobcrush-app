# Session log — jobcrush-app

Newest first. Last ~10 sessions, ≤ ~10 lines per entry. Older entries: `docs/session-log/YYYY-MM.md` (moved unedited; under docs/ so CI stays inert).

## 2026-10-26 — #441 prototype: the CV email's design chosen (B2), #442 ready to build

`/prototype` + `/impeccable` (Opus 5.5), on the owner's real MSCI report from staging; branch `prototype/report-email-441` (427a148, pushed).
- Four email directions sent to his Gmail via staging's Resend (8 sends, $0, free plan): A Paper, B Night masthead, C Scorecard, D Dashboard.
- Owner's pick **B2**: B + Phosphor filled icons (strong / weak / be-ready points), a score panel (93%, Strong match; gauge at the card's 50/70 bands; Essential 5/5 · Desirable 7/9 requirement map), and Check before you send always shown (empty = one gold-tick line).
- Found: the report carries no score, and its lists omit requirements met by added lines — the first prototypes' "4 of 6" was really 12 of 14. #442 passes the route's card through; no new model call.
- #441 closed with the decision; #442 rewritten with the design + ACs, `ready-for-agent`.
**Next:** `/implement 442`; the owner's re-proof and `/implement-spec #443` stand.

## 2026-10-26 — The owner's defect list filed as tickets: spec #443 (#437–#439 + #424 #409 #410), email #441 → #442, photo parked #440

No code. The owner's four defects, checked against HEAD and the prototype branches first.
- Numbers: #433 took gold off the suggestion numbers (black/white discs); the #408/#412 prototypes had the open one gold. #437 brings it back (designer call: open = gold, waiting = outline; the gold ceiling holds because Approve is gold only with no card open).
- Used-line mark: the #408 prototype's `.pin.used` ◆ was never built → #438 (screen only, never the PDF).
- Letterhead: every produced CV already has one shape (one template) and a photo is already dropped (text layer only); #439 is the centred name / contact / job title. Photo → #440, parked.
- Email: sent as plain text only; #293's designed HTML template sits unshipped on its prototype branch. #441 is an owner-led prototype session (ready-for-human), #442 the build, blocked by it.
- Batched under spec #443 with #424, #409, #410 (same surfaces); #438 blocked by #437.
**Next:** the owner's re-proof; then `/implement-spec #443`.

## 2026-10-25 — Shipped #427 #432 #433 #434 #435 in one CI run (8466cdb, live); #427's probe, the re-proof's triage, lessons 48 → 39

One long session (Opus 5.5), the owner's rule throughout: build on branches, one CI run when he says ship.
- #427 (972e97f, re-applied as faacbff): a read-only probe on staging (exact production input, fingerprint-matched; 17 calls ≈ $0.92) found 6/10 first answers refused for two harmless slips; repaired, not retried. Owner accepted fewer stretches per CV. This entry was lost when #432's branch kept #431's side of a docs conflict; rewritten here.
- Owner's re-proof: Approve said "unknown card". Staging logs + a read-only DB read showed the deck's 5-min search window (#431) and a report answer with a raw control character (#432). The probe had hit the same "unknown card" that morning and worked around it unfiled (lesson added).
- `/impeccable critique` of the Tailor screen (27/40) on the owner's real draft: suggestion numbers collide with bullet dots, cut off on a phone, stack in the job tab. Owner's calls (one polish ticket, banner hidden, unanswered suggestions said plainly) filed as #433.
- Lessons trimmed 48 → 39, eight rules promoted to CLAUDE.md / CODING_STANDARDS.md; a cherry-pick later resurrected a superseded lesson, removed (34e6e11).
- Shipped: main fast-forwarded to 8466cdb (the code #435's QA GO covered; tests 2271), CI green in 83 min, staging serves 8466cdb; #427 #432–#435 closed; all `fix/*` branches deleted.
**Next:** the owner's re-proof on staging from a fresh account, through to the email arriving.

## 2026-10-25 — #435 built on a local branch: #431's journey joins tier 2, ~2 min instead of ~9 (1af8304)

`/implement 435` (Opus 5.5) under the owner's no-CI, no-deploy, no-paid-calls constraint, on `fix/435-journey-tier` cut from `fix/434-tailor-target-kept`'s tip.
- Option 1 chosen over deleting the journey: only it presses every Tailor door past the deck's search window in a browser. The QA stack's `POST /qa/stack` takes `deckSearchWindowMs` (test-only; qa-main is not shipped, the production window stays 5 minutes, proven by a unit test). The journey arms 20 s and puts it back on finish, crash or kill.
- Selector before: the journey in no run, picked by no change. After: in the list (44), picked by changes to search, deck, Tailor, draft, export and report code.
- `/code-review`: the stack now echoes the window the code reads, report files mapped, `ForTest` naming. The builder's own mutation run found the window left armed after a crash; fixed (reset from Node, not the page).
- QA **GO** on tree c9aed23: api 2271, typecheck 7/7, selection 15/15; live 20/20 in 2 min 19 s on the fake model. Red only when both #431's and #434's protections are undone (either alone still keeps the job).
**Next:** the owner ships the branch (#427, #432, #433, #434, #435) → CI → staging; the re-proof resumes.

## 2026-10-25 — #434 built on a local branch: the job being tailored survives a later deck search (9ac32a8)

`/implement 434` (Opus 5.5) under the owner's no-CI, no-deploy, no-paid-calls constraint, on `fix/434-tailor-target-kept` cut from `fix/433-tailor-polish`'s tip.
- A deck search that failed, or no longer returned the job, replaced the search the Tailor step read its job from: every Tailor door answered "unknown card". The want door now keeps that job's own copy beside the target (new nullable session column, no backfill); its liveness and the request still decide.
- `routes/onboarding.ts` sat at its 515-line limit: the kept copy rides back on the existing lookup's answer instead of a new import there.
- `/code-review` caught a re-pick of the same job overwriting a good kept copy with one from an older search: fixed. The copy is frozen at the pick (ceiling marked in code).
- QA **GO** on tree e74fef0: api 2270, typecheck 7/7, new tests red on the old code; live drive 14/14 (deck down, then a search without the job, then Approve sent); 5 Tailor journeys + 65 browser specs green; migration checked on a throwaway Postgres 16. Filed #436 (no test proves /sessions/me withholds the kept copy).
**Next:** the owner ships the branch (#427, #432, #433, #434) → CI → staging; the re-proof resumes.

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
