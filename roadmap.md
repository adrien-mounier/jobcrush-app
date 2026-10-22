# Roadmap — jobcrush-app

_Last updated: 2026-10-21 (spec #301's last four shipped: #397 #399 #400 #401)_

One screen. The GitHub tracker owns tickets, order and blocking; this page points, never copies.
`#n` = `https://github.com/adrien-mounier/jobcrush-app/issues/n`. What shipped: closed issues + git log.

## Goal

**v1 (owner re-scope, 2026-09-26) is the product that works for its one real user:** the owner pastes
a real posting he'd apply to, runs it end to end, and gets a CV good enough that he chooses to send it
himself. Prepared-apply only. No real visitors while this holds; #288 un-parks first the day it changes.
**Built for one user, designed for many:** no schema, contract or code path hardcodes the owner's
case. Full text: `CLAUDE.md`, "v1 scope and the golden rule". The destination is unchanged.

## Now / Next

**Now: polishing the check-mode walk on the owner's staging feedback** (check mode itself shipped
2026-10-14, spec #375, [ADR-0018](docs/adr/0018-the-profile-is-the-master-cvs-home.md)). Shipped since:
~~#387~~ ~~#389~~ ~~#393~~ ~~#394~~ (2026-10-15) and ~~#392~~ ~~#396~~ (2026-10-16): discovery is now only the
job-count wait and moves on by itself; while the CV review runs, check mode is a reading-lamp loading
screen; source tags read "from BRED…". #392 and #396 went live **by hand, CI skipped** at the owner's
request — the next normal push runs the full suite over them.

- Owner checked both on staging after the deploy: "it looks ok now" (2026-10-16).
- ~~#389~~ closed 2026-10-16: the four build calls kept as built; its "keep the Continue screen" was
  replaced by #392. #394 AC7: the per-item "from X" tags stand (#396); a per-group source line is a
  ticket only if the owner asks.
- **Next build:** finish v1 first (owner, 2026-10-21) — see "Finish line, what remains" below; then
  Chat with JobCrush.
- **Agent, when asked:** #395 broken journeys still waiting for questions #376 removed (Opus 5.5, medium).
- Still open from spec #332 (V6): #359 scan message (Opus, medium) · #345 two test accounts (Opus,
  medium; needs the owner mid-ticket) · #369 · #367 · #374 extras cap (check it still applies after #378).

**Next: Chat with JobCrush** (spec [#350](https://github.com/adrien-mounier/jobcrush-app/issues/350)):
talk to improve the master CV; replaces #316/#317 *Add something new*. Its doors move from the review
page to the profile (ADR-0018). `/to-spec` → `/to-tickets` → `/implement-spec`. Small and independent:
[#348](https://github.com/adrien-mounier/jobcrush-app/issues/348) a sign-in door on the landing page.

**The v1 spine** (spec #301): every ticket shipped (~~#315~~ 2026-10-18, ~~#314~~ 2026-10-17).
**The finish line ran 2026-10-19** on staging with the real key, his real CV and a real posting: the
journey held end to end, the report cost **$0.46 per application** (measured), but the gate said NO-GO on
two defects, both fixed the same day (6c7991c the email talked about "printed" and "held-back" lines;
d7af930 long skill ids could not be edited). Follow-ups: #400 a paste with no title line (owner's call),
#397 two scores for one job, #398 check-mode reads on his CV, #399 draft nits. Owner calls made
2026-10-21: #400 the app works out the title, says it guessed, and asks him to confirm; #401 a denied
requirement gets a nearest-true sentence, an unplaced job says "Job location unknown", the
"Check before you send" notices move to the top of the email.
~~`/implement-spec #301` (#397 #399 #400 #401)~~ shipped 2026-10-21 (3fb5389): the paste door asks
for a title it had to work out, one job shows one score, the report hands a denied requirement a sentence and
says when it cannot place the job, the notices open the email.
**Finish line, what remains (v1 before the chat):** ~~`/implement #398`~~ shipped 2026-10-22 (a5d3568) → one more real
report on staging → `/qa-gate` GO. (The old GRADION record that still read "Title not stated" was deleted
from staging 2026-10-22, with its derived rows; the same text can be pasted again and will be asked its title.)

**Model rule:** Fable for builds that can ship subtly wrong and still pass; Opus for the rest and for
every grill/spec/map. Name versions: Fable 5.1, Opus 5.5 (current as of 2026-10-06). No ticket starts at max effort. Fable quota spent → Opus, one effort step higher.
**Build mode:** a ticket set under one parent is built with `/implement-spec <parent>` (one model for the
run); `/implement` is for a lone ticket. Never point `/implement` at a parent or spec issue (#54, #86,
#127, #301, #332, #375).

## Milestones

- S0–S2.5 **done** (Jul 2026); S2.75 CV quality: A **done** (#11), B (how `cv-authoring-rules.md` is fed) **open, unticketed**; Phase 1 live-deck honesty **done** (Aug 2026; #250 parked).
- V1 — the spine (map #290, spec #301): V3 and V4 **done**; V5 **done** (#312, #313, #314, #315, 2026-10-18); #316/#317 replaced by #350. Finish line run 2026-10-19 (NO-GO, fixed); its four follow-ups under #301 **done** 2026-10-21; #398 **done** 2026-10-22; the re-proof on staging is next.
- V6 — discovery redesign (#326 decided, spec #332): **built**, 12 of 13 closed (#345 left); its review page was replaced by V6b.
- V6b — the profile's check mode (ADR-0018, parent #375): **done** 2026-10-14 (482ca57).
- S3 the hunt / S4 every day, everywhere — the original destination milestones: open, text in the archive.
- Phases 2–6 — the profile gets rich (#127), the deck gets cheap and trustworthy, the live-jobs chain (#54), where the jobs come from, the next products: **parked 2026-09-26, not cancelled** — see archive.

A parked item comes back only by the **pull rule** (one of the owner's real drafts shows the lack;
first candidates #171, #168, #203) or when real visitors return, and then #288 goes first.

## Backlog

- Parked pool: #250 · #276 · #277 · #286 · #288 · #289 · #298 · #318 — not yet ordered: #275 · #328 · #329 · #330 · #331
- Unticketed ideas (archive, "Later"): an advisory "improve your profile"; how `cv-authoring-rules.md` is fed (S2.75 question B, near #328)

## Live risks / ops notes

- **Techmap quota:** 100 calls/month, not 1000 (81 left on 2026-10-10) → #366.
- **CI minutes:** solved 2026-10-08, repo made public (free Actions minutes). Nothing secret goes in a tracked file.
- **Real visitors gate:** #288 (sign-in refusal reads as a crash) and #298 (warm machine, $7.23/month) un-park before anyone but the owner is let in.
- **Tablet widths are untested:** no browser check drives 641–899px (#318). Un-park it on the first slice that restyles a top bar.

Full pre-2026-10-06 roadmap (phase tables, ordering constraints, design history): [`docs/archive/roadmap-2026-10-06.md`](docs/archive/roadmap-2026-10-06.md).
