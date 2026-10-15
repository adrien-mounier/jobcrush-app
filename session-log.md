# Session log — jobcrush-app

Newest first. Last ~10 sessions, ≤ ~10 lines per entry. Older entries: `docs/session-log/YYYY-MM.md` (moved unedited; under docs/ so CI stays inert).

## 2026-10-15 — #393 shipped: no skills group is named after its own section

`/implement #393` (Fable 5.1, high). Root cause confirmed: the fallback bucket for a skill with no group was literally named "Skills", and a tool copied out of a job by its review call (#383 `moveTools`) always landed in it, after the sections call had already named the ungrouped skills. Fix: the fallback label is the neutral "Other" (renamable like any group); each job's review answer names the Skills group its tools belong in (`toolsGroup`, an existing group when one fits — a list's own label still wins); one gate (`usableGroupName`) refuses the section's own name on the rename and move doors and on the model's names, which also makes the boot-time backfill of old "Skills" rows safe to re-run. `/code-review`: no hard findings; its soft points (stale e2e fixtures on the old literal, a negative-only test, a shadowed name, the 60 cap in three places) were fixed before the gate; the Spec axis found the every-boot backfill would have renamed a person's own "Skills" group — closed by the gate above. Known ceiling: a CV whose own label is "Other" reads as ungrouped (ponytail note in skillsSplit.ts). QA GO on tree bd8169f: 6 new tests red on HEAD (the owner's defect reproduced over HTTP) and green on the fix, api 2099, typecheck 7/7, check-mode+profile specs 130/130 (one timing flake under the parallel run, 3/3 alone), the gate's journey 23/23 at 1280 and 390, the backfill proven on a throwaway Postgres. Tier 2 gains `qa-393-skills-groups-journey.mjs` (QA-gate-born). Residual: whether the real model fills `toolsGroup` is unproven locally (no key) — if it leaves it empty the tools sit under "Other", never "Skills".
**Next:** owner re-runs the real CV on staging; `/implement 392` (Opus 5.5, medium); then Chat with JobCrush (#350).

## 2026-10-15 — #387 shipped: a fact added while tailoring joins the profile (eb977f1)

`/implement #387` (ADR-0018 clause 9). The tailor screen's "Yes" already wrote a fact; it now carries the requirement's section and the job it was added for, so the profile lists it under Experience/Skills/Education/About you wearing "Added while tailoring for <title> at <company>" (row, chip, detail sheet). A "No" never shows; the next job's questions and draft use it like any fact. No screen approves a stretch today, so AC2 is proven only by "the draft writes nothing to the profile" (test guards it). `/code-review`: no hard findings; stale comments, a draft-level AC3 test and the detail-sheet line fixed. QA was NO-GO first: check mode invented a job headed "profile" for the joined Experience fact (D1) — fixed in readPaper (listed with About you; the profile page gives it no employer block). GO on tree 0737687: api 2096, typecheck 7/7, new journey 21/21, check-mode 80/80, full walk 126/126, profile+check-mode specs 130/130. Tier 2 gains `tailoring-fact-joins-profile-journey.mjs` (QA-gate-born). Edge cases the gate noted, not blockers: a summary-section "Yes" files under About you and an About you save would step it aside (Put back one tap away); a review run after tailoring would read the answer as CV summary text.
**Next:** Chat with JobCrush (#350), or the owner's staging feedback (#392, #393).

## 2026-10-15 — Owner staging feedback filed: #392 job counter, #393 fake "Skills" group

Owner uploaded the AI-transformation-lead CV on staging. Two remarks → tickets, no code. #392: the standalone "N new jobs are open" step goes; owner decision: the count becomes a live counter that climbs during the loading wait, and must count the same jobs the deck shows (the #246 trap) or not show. #393: Salesforce CRM and JIRA sat under a sub-group named "Skills" inside Skills. Probable cause: tools moved out of a job (#383 `moveTools`) keep the internal fallback group, and the group-naming step only covers skills ungrouped before the move.
**Next:** `/implement 392` (Opus 5.5, medium) and `/implement 393` (Fable 5.1, high); then #387.

## 2026-10-15 — Preview as CV + #389 follow-ups shipped: spec #389, tickets #390 and #391

`/implement-spec #389` built #390 (Preview as CV, ADR-0019) and #391 (old summary lines step aside on About you save; summary quotes read "About you"; the full check-mode walk in tier 2) in two worktrees on `spec/389`. `/code-review` found one real bug (a failed job start left the preview's in-flight reservation stuck until restart), three standards gaps (no response schemas, a silent PDF refusal, a hold that still offered Try again) and spec drift (the family's scope sentence fed to the tailor); one fix agent took all of it (5209487). QA was NO-GO first on two looks: the new door glued to "Check your CV", and the preview page without its theme (its tokens lived only on `.jobdeck`). Fixed in eda2363, which also adopts the gate's `cv-preview-journey.mjs` into tier 2 (the only flow running the preview route, store and document maker for real). GO on tree 47980ca: api 2088, typecheck 7/7, guards 15/15, 10 tier-2 journeys green, full walk 126/126.
Owner-pending calls recorded on #389: Put back for the moved About you lines lives in check mode, not on the profile page (ADR-0018 / #377); a job with an unknown end date is not "current"; the lines move on the first About you save only; the preview's language is English for now.
**Next:** #387 (a tailoring fact joins the profile), then Chat with JobCrush (#350).

## 2026-10-14 — Check mode shipped: spec #375, 15 tickets (482ca57)

`/implement-spec #375` built all 15 sub-issues on one branch, followed by `/code-review`, where one fix agent took the 3 standards breaches and 7 spec findings. QA was NO-GO first: an unanswered market did not hold the want, tailor and draft doors (fixed in 11b36ad). Then GO on tree 35bdff5 (full walk at 1280 and 390 px, 38/38 tier-2, 247 mocked, api 2072). Main went 0c6532b..482ca57, CI was green and staging was confirmed by /healthz.
Paid evals on staging: 2 calls, USD 2.34. On the real CV, no removal suggested (#380 PASS), and About you has no lint issues (#371). On the DOB fixture, exactly that one line was suggested as personal data. All 15 sub-issues and #375 are closed.
The owner calls that remain are in **#389**. Re-upload edge cases are in #388 (filed). Retired journeys: eligibility-questions and cv-languages-preticked. New: check-mode-{journey,gate-doors,work-rights-journey}, plus the QA full walk, which is committed but not in tier-2 (#389 item 9). Cleanup: 17 worktrees and every build branch deleted.
**Next:** the owner answers #389, then Chat with JobCrush (#350) or the V6 leftovers.

## 2026-10-12 — ADR-0018 written; check mode broken into tickets #377–#387 (docs-only)

ADR-0018: the profile is the master CV's home; check mode (prototype V2.1) replaces the review page; items
are in or removed (no ticks); every suggestion must be answered before the jobs; edit and remove in place
(amends ADR-0017's chat-only editing); a fact added at tailoring joins the profile, a stretch never does.
`/to-tickets` from the ADR (no separate spec, parent #375): #377 walk (tracer) → #378–#384 in parallel,
with #371, #373, #376 → #385 re-upload, #383 moves → #386 retire the review page. #387 tailoring fact →
profile (outside this build). Owner: fixes show a quiet "Fixed" tag, never block. Closed as superseded:
#370, #372, #344. Code map: the profile has no edit/remove today; "kept" ≈ removed; the jobs gate lacks
work rights and unanswered drafts. No `/to-spec` was run: #375 + ADR-0018 serve as the spec, with its
15 sub-issues wired (#387 outside). I first gave per-ticket `/implement` lines; the owner caught that
`/implement-spec` was the rule (roadmap Build mode). **Next:** owner launches `/implement-spec #375` (Fable 5.1, high).

## 2026-10-11 — Prototype #375 v3: one suggestion card, "About you"; #371 rewritten (docs-only)

Owner grilling on the prototype's design. A tick means "applications may use this line" (legend: Ready to use /
Set aside / Suggested), never "on your CV". Every question uses one dashed suggestion card: add ("Only if
true") or remove (the line arrives unticked). The "untick a weak line" suggestion is dropped, because a weak line
costs nothing in a profile. A misplaced line moves automatically with a tag; an achievement stays under its job
and only its tool is copied to Skills. The summary becomes "About you": machine-written from the whole CV,
follows the writing rules, approved or edited (no tick), original viewable. Print still applies "earns its
place". Personal projects get a section. #371 rewritten (option C replaced); decisions on #375.
v5: details open as fields; skills split one per line by the machine (any separator), in groups named by the CV or
the machine, not an item to check; the removal card has a minus mark and strike-through, no box.
v6: no tick boxes at all. The profile is the store (keep / add / remove, removed items one tap from returning);
no "COMPLETE" stamp; V2 guided one screen per section; Languages back; work rights move into the profile and
the start stops asking → #376 filed.
v7 (V2): the footer button is the only confirm (no "These are right"); no "saved" words, motion instead;
job suggestions inline as in V1. Own facts (details, About you, work rights) in plain cards, gold kept for
suggestions; the removal has its own coral look; variants V2.1 (no step count) and V2.2 (named steps).
**Approved: V2.1.** Copy without contact details in `docs/design/profile-check-mode-prototype.html`.
ADR-0018 written (amends ADR-0016 cl. 1, 2, 3, 5, 6 and ADR-0017's edit rule); glossary: check mode,
removed item (ticked/kept retired). **Next:** `/to-spec`.

## 2026-10-11 — Direction: the profile may replace "Your CV, reviewed" — grilled, prototype #375

From the stored review (staging, read-only): COMPLETE stamps are right, but the model refused extras for reasons
the prompt doesn't hold (SG "nothing to accompany", Okoone R2/R5 misreads) → #374 (cap moves to print, 3 extras/job).
The owner proposed the profile as the master CV's home. `/challenge-with-codex`: home yes, but upload review ≠ storage.
Grilled: the profile in check mode, the gate = facts plus every proposal answered (changes ADR-0016 cl. 6), dismissed
stays dismissed for the same evidence, a tailor tick joins the profile, rebuild before v1 if the prototype wins. Prototype V1/V2/V3
is a private artifact, kept out of the public repo because it holds the owner's contact details. Paused #372/#368/#370.
**Next:** owner tries #375; meanwhile #373 + #360, #374, #371, #369.

## 2026-10-11 — Owner decisions on #332's open calls; #367, #368 filed (docs-only)

Confirmed: the two #340 review rules (ADR-0016 clause 4 now says a missing must-have always earns its
line, extras cap at 10, a fact from another job is OPTIONAL with its quote); the 4-attempt retry ceiling
(root causes → #367, not v1-critical); "Your CV, reviewed" heading on a partly unchecked CV. Asked: a
drafted line's source names its job → #368. Then: partial-run marks kept; a final failure is a log
error for the owner only, and a no-family job shows a green "Reviewed" tag (#369). Extras stay beside
COMPLETE, under one label, "Only if true", with a reason (#370, after #368). Flags stay internal.
Roadmap: the CI-minutes risk is retired (repo public since 2026-10-08). The owner's re-upload (screenshots 7–9):
the summary leaves the master CV (option C → #371, ADR first); import misfiles projects and nationality into
the summary (#373); subtitle says "as it will print" for a master CV holding ~16 BRED lines (#372).
**Next:** owner re-runs the real CV on staging; #366; then #360 → #359.

## 2026-10-10 — #361: Product Owner gets a family — product-management v1 published (13ea5a0, 55996df)

Vocabulary-growth run. The labeler was right to answer unmapped: the family was missing. Corpus: 13 techmap
calls + the owner's 600 LinkedIn ads → 477 distinct, 285 in-family. PO and PM are one occupation (every floor
item 63%+ for both titles; web research agrees). HK "Product Manager" is 27% bank-commercial jobs, and the scope edge
excludes them (verified live). Owner approved "Product Manager" with 5 must-haves (roadmap, backlog, discovery,
metrics, stakeholders). Grid 98/100/0 on minimax-m3; QA **GO** (2017 tests, live 14/14). Spend ≈ USD 0.40.
Found: the techmap plan is **100 calls/month**, not 1000 (81 left) → #366. Grid cases pm-01..04 + str-10 await owner
arbitration. Old sessions keep their stored "no family": re-upload the CV to see Okoone reviewed.
**Next:** owner re-runs the real CV on staging; #366; then #360 → #359.
