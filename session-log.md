# Session log — jobcrush-app

Newest first. Last ~10 sessions, ≤ ~10 lines per entry. Older entries: `docs/session-log/YYYY-MM.md` (moved unedited; under docs/ so CI stays inert).

## 2026-10-16 — #392 follow-up: the discovery screen goes; the count ends the wait (4f3b169, deployed by hand)

Owner on staging after ef915e5: "I still see the discovery screen" — AC1 ("no standalone step/screen … the flow goes straight on") had been read as the count sentence only. Now, once the role is known, discovery is only the wait: the #257 "We'll look for … in …" line over "Finding jobs like yours…", the count ticks and holds ~1.2 s, then it moves on by itself to check mode or the deck (router.replace, so Back skips it); no count → on at once. "Your search is set." + Continue are gone, which also settles #376 deviation 1. 17 journeys rewritten; QA was NO-GO first (six journeys pressed Save with the paced qa.click and missed the ~3 s screen — fixed with raw clicks, lesson filed), then GO on tree ac5b8d1 (23 tier-2 journeys, discovery.spec 10/10). Owner asked to skip CI for this one: pushed with [skip ci], web deployed to staging with flyctl from the local tree.
**Next:** owner looks at the flow on staging; Chat with JobCrush (#350). The next normal push runs the full CI over this change.

## 2026-10-16 — #392 shipped: the job count ticks up at the end of the loading wait (ef915e5)

`/implement #392` (Opus 5.5). Traced first: the search behind the count is one batched call (stored pool + one paid page for HK/SG/VN/AU, then dedupe/freshness/language filters, then counted) — nothing arrives in pieces, so a truly climbing count would need partial numbers that can drop and would not match the deck (AC3). Put to the owner with four options; he chose the count-up animation, knowingly overriding AC2 (decision commented on #392). Built: "Finding jobs like yours…" while waiting, then the real count ticks 0 → N (~0.9 s) with "jobs like yours found."; reduced motion shows the number at first paint; screen readers hear the final count once; the old "new jobs are open right now" / "Keep going" lines are gone. Server unchanged (#246 count). `/code-review`: a reduced-motion 0 flash and a loose mid-tick assertion — fixed; the spec now records every number shown in-page, both new tests proven red. QA GO on tree bb599ac: api 2102 uncached, typecheck 7/7, discovery.spec 9/9, tier2 promise-counts 32/0, search-area-coverage 28/0; new `qa-392-count-up-journey.mjs` (not in tier 2). onboarding-reveal-wall.mjs was already broken by #376 → #395.
**Next:** owner looks at the count on staging; Chat with JobCrush (#350).

## 2026-10-15 — #394 shipped: a fresh upload's skills no longer read under "Other" while the review names them

`/implement #394` (Fable 5.1). Two causes behind the owner's staging report: the miner sometimes dropped the CV's own group labels (kept only in the claim id), and check mode printed the fallback label "Other" over skills the running review had not named yet — a pending state that read as a wrong grouping. Fix: miner rule 8 keeps the label in the claim text ("Tools: Jira, …"), so a labelled CV is grouped at import; the review wire marks the fallback group `unnamed` and the Skills screen hides that heading while the run goes, under the existing "Checking your CV…" line (the profile page keeps "Other"); a tag ("Taken from <long employer>") wraps inside its item and chip instead of running out of the column (AC7 built as the default — per-item, wrapped — the owner's call stays open). `/code-review`: no hard blocker; the verbatim prompt pin was loosened to its load-bearing words, and the overflow tests now measure the column, not the container. Found on the way: the route's response schema silently dropped the new wire field, and the HTTP test that mapped the groups could not see it (lesson under Testing traps). QA GO on tree 89c1dd2: api 2102, typecheck 7/7, mocked specs 133/133 (the #394 ones red on old code), qa-393 journey 23/23 at 1280 and 390, live walk at both widths. Gate observations, not defects: at 390 headless skills listed after a named group read as that group's tail; the move dropdown still lists "Other" mid-run.
**Next:** owner re-runs the real CV on staging (AC5: no "Other" or "Skills" at any point of the walk; the long BRED tag wraps); `/implement 392` (Opus 5.5, medium); then Chat with JobCrush (#350).

## 2026-10-15 — #393 shipped: no skills group is named after its own section

`/implement #393` (Fable 5.1, high). Root cause confirmed: the fallback bucket for a skill with no group was literally named "Skills", and a tool copied out of a job by its review call (#383 `moveTools`) always landed in it, after the sections call had already named the ungrouped skills. Fix: the fallback label is the neutral "Other" (renamable like any group); each job's review answer names the Skills group its tools belong in (`toolsGroup`, an existing group when one fits — a list's own label still wins); one gate (`usableGroupName`) refuses the section's own name on the rename and move doors and on the model's names, which also makes the boot-time backfill of old "Skills" rows safe to re-run. `/code-review`: no hard findings; its soft points (stale e2e fixtures on the old literal, a negative-only test, a shadowed name, the 60 cap in three places) were fixed before the gate; the Spec axis found the every-boot backfill would have renamed a person's own "Skills" group — closed by the gate above. Known ceiling: a CV whose own label is "Other" reads as ungrouped (ponytail note in skillsSplit.ts). QA GO on tree bd8169f: 6 new tests red on HEAD (the owner's defect reproduced over HTTP) and green on the fix, api 2099, typecheck 7/7, check-mode+profile specs 130/130 (one timing flake under the parallel run, 3/3 alone), the gate's journey 23/23 at 1280 and 390, the backfill proven on a throwaway Postgres. Tier 2 gains `qa-393-skills-groups-journey.mjs` (QA-gate-born). Residual: whether the real model fills `toolsGroup` is unproven locally (no key) — if it leaves it empty the tools sit under "Other", never "Skills". Committed as 191bbcb, pushed, #393 closed; CI green and staging confirmed by /healthz at 14:28 UTC (88 min — the longest run yet, see lessons).
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
