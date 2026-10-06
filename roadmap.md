# Roadmap — jobcrush-app

_Last updated: 2026-10-06_

One screen. The GitHub tracker owns tickets, order and blocking; this page points, never copies.
`#n` = `https://github.com/adrien-mounier/jobcrush-app/issues/n`. What shipped: closed issues + git log.

## Goal

**v1 (owner re-scope, 2026-09-26) is the product that works for its one real user:** the owner pastes
a real posting he'd apply to, runs it end to end, and gets a CV good enough that he chooses to send it
himself. Prepared-apply only. No real visitors while this holds; #288 un-parks first the day it changes.
**Built for one user, designed for many:** no schema, contract or code path hardcodes the owner's
case. Full text: `CLAUDE.md`, "v1 scope and the golden rule". The destination is unchanged.

## Now / Next

**Now: "Your CV, reviewed"** (spec #332, 5 of 13 tickets done): discovery stops asking, the CV is reviewed instead.

1. [#338](https://github.com/adrien-mounier/jobcrush-app/issues/338) the review screen (layout C, the marked-up CV) — `/implement`, Fable, high
2. [#340](https://github.com/adrien-mounier/jobcrush-app/issues/340) review prompt + blind test on the owner's real CV, ≈ $1.40/run — `/implement`, Fable, high
3. [#339](https://github.com/adrien-mounier/jobcrush-app/issues/339) discovery stops asking — `/implement`, Opus, high
4. [#341](https://github.com/adrien-mounier/jobcrush-app/issues/341) the review runs in the background — `/implement`, Fable, xhigh
5. [#342](https://github.com/adrien-mounier/jobcrush-app/issues/342) drafted lines for missing must-haves, then [#343](https://github.com/adrien-mounier/jobcrush-app/issues/343) (Opus) and [#344](https://github.com/adrien-mounier/jobcrush-app/issues/344) (Fable)
6. [#345](https://github.com/adrien-mounier/jobcrush-app/issues/345) two test accounts — Opus, medium; old test answers wiped only after the owner confirms what
7. ~~#346 grilling — talk to the product to improve your CV~~ decided 2026-10-06 (ADR-0017).

**Next: Chat with JobCrush** (spec [#350](https://github.com/adrien-mounier/jobcrush-app/issues/350),
owner call: right after #332, ahead of the rest of the spine): talk to improve the master CV; it replaces
#316/#317 *Add something new*. `/to-spec` → `/to-tickets` → `/implement-spec`. Small and independent:
[#348](https://github.com/adrien-mounier/jobcrush-app/issues/348) a sign-in door on the landing page.

**Still open on the v1 spine** (spec #301): #314 over two pages, tighten once then ship and tell ·
#315 the application report.
**Finish line:** one real posting end to end, `/qa-gate` GO on the whole journey.

**Model rule:** Fable for builds that can ship subtly wrong and still pass; Opus for the rest and for
every grill/spec/map. Name versions: Fable 5.1, Opus 5.5 (current as of 2026-10-06). No ticket starts at max effort. Fable quota spent → Opus, one effort step higher.
Never point `/implement` at a parent or spec issue (#54, #86, #127, #301, #332).
**Build mode (2026-10-06):** finish #332 with `/implement`, one ticket at a time (per-ticket model
rule; #340 and #345 need the owner mid-ticket). From the next spec on, `/implement-spec <spec>`
builds a whole spec in parallel; #301 is wired for it (sub-issues linked).

## Milestones

- S0–S2.5 — foundation, magic mirror, own your facts, UX cleanup: **done** 2026-07-17 → 07-19.
- S2.75 — CV quality: question A **done** (#11); question B (how `cv-authoring-rules.md` is fed) **open, unticketed**.
- Phase 1 — make the live deck honest: **done** Aug 2026 (only #250 left, parked).
- V1 — the spine (map #290, spec #301): V3 and V4 **done**; V5 half done (#312, #313); #314–#317 open.
- V6 — discovery redesign (#326 decided, spec #332): **in progress**, 5 of 13.
- S3 the hunt / S4 every day, everywhere — the original destination milestones: open, text in the archive.
- Phase 2 — the profile gets rich (#127 fan-out): parked 2026-09-26, not cancelled — see archive.
- Phase 3 — the deck gets cheap and trustworthy: parked 2026-09-26, not cancelled — see archive.
- Phase 4 — finish the live-jobs chain (#54): parked 2026-09-26, not cancelled — see archive.
- Phase 5 — where the jobs come from: parked 2026-09-26, not cancelled — see archive.
- Phase 6 — the next products: parked 2026-09-26, not cancelled — see archive.

A parked item comes back only by the **pull rule** (one of the owner's real drafts shows the lack;
first candidates #171, #168, #203) or when real visitors return, and then #288 goes first.

## Backlog

- Parked pool: #250 · #276 · #277 · #286 · #288 · #289 · #298 · #318 — not yet ordered: #275 · #328 · #329 · #330 · #331
- Unticketed ideas (archive, "Later"): an advisory "improve your profile"; how `cv-authoring-rules.md` is fed (S2.75 question B, near #328)

## Live risks / ops notes

- **CI minutes:** private repo, metered, $0 limit; a code push costs ~60 Actions-minutes, so ~33–50 pushes a month. Owner decision open (pay overage ~$0.48/run, run the slow journeys less often, or go public). Until then, budget pushes; docs-only pushes run nothing.
- **Real visitors gate:** #288 (sign-in refusal reads as a crash) and #298 (warm machine, $7.23/month) un-park before anyone but the owner is let in.
- **Tablet widths are untested:** no browser check drives 641–899px (#318). Un-park it on the first slice that restyles a top bar.

Full pre-2026-10-06 roadmap (phase tables, ordering constraints, design history): [`docs/archive/roadmap-2026-10-06.md`](docs/archive/roadmap-2026-10-06.md).
