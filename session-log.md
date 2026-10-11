# Session log — jobcrush-app

Newest first. Last ~10 sessions, ≤ ~10 lines per entry. Older entries: `docs/session-log/YYYY-MM.md` (moved unedited; under docs/ so CI stays inert).

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

## 2026-10-09 — #362: a failed review is retried quietly; never reads as a clean check (e1ac06d)

A failed review run is reopened by the next read of /review and retried for its unanswered jobs only,
bounded at four paid attempts per job over its life (~USD 2/job worst case; owner to accept the
doubled ceiling). Never once the review is confirmed. The read gains `unchecked` (a part has no answer,
or no run): the counter then never reads "0 to check". Code review: no-run counted as unchecked too.
QA gate **GO**: API 1958, review.spec 20/20, journeys cv-review 83/83 + new
`review-unchecked-counter-journey.mjs` 10/10 (not in CI's tier2 lists yet), reopen on real PG17. CI
green on a side branch before main was pushed. Old run `53729e1f…` will now retry on its next open.
Open: heading "Your CV, reviewed" on an unchecked CV (owner's call). **Next:** #361 → #360 → #359.

## 2026-10-09 — #364: a review unit keeps why its last attempt failed (b0d1024)

Each `cv_review_units` row gains `last_error` (message + `cause`, capped 2000, ops-only, added on boot).
QA gate **GO** (gates-only: API 1954, migration on real PG16). SG cause, from the staging DB: the failed
attempt left no usage-ledger row, so its API call never returned (not the model's answer, not the
600 s deadline). Evidence on #364, closed on the owner's OK. The owner's next real upload (04:22Z)
settled it: every job answered first try with the keep-alive holding, so #365 closed as the #363 stop.
Its "no fixes, no drafts" checked: no typos in the CV; BRED/SG complete by design; Okoone is #361.
Old run `53729e1f…` still reads unfinished (opening it would pay ~2 Fable calls).
**Next:** #362 (owner running it in another session), then #361 → #360 → #359.

## 2026-10-08 — #363: a review holds the Fly machine up; a call cut by a stop costs no attempt (ed77ce0)

Fly's auto-stop reads load, not traffic (lessons.md "Staging ops"): short polls hold nothing, a held
request does. While a review runs, the API now keeps one request to its own public URL in flight
back to back (`/ops/keep-alive`, key in a header, 25 s hold cap, Fly-only wiring). Units count
attempts started and failures seen apart: a resume after a cut call asks the model once more; starts
cap at four per job. Staging's units table gains `failures` on boot. Code review caught an abort
listener accumulating per hold. QA gate **GO**: API 1952, review.spec 19/19, cv-review journey 83/83,
migration proven on real Postgres 16. **Proven on staging (f389b5d, 2026-10-09):** a 12-min self-hold
from the machine kept it up 14 min 44 s (23 holds in Fly's log, 25 s apart, no key logged); the proxy
stopped it 2 min after the hold ended. A real review's own hold is still unobserved. **Next:** #364.

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
