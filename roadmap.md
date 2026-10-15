# Roadmap — jobcrush-app

_Last updated: 2026-10-15 (#389 answered; #390, #391 ready)_

One screen. The GitHub tracker owns tickets, order and blocking; this page points, never copies.
`#n` = `https://github.com/adrien-mounier/jobcrush-app/issues/n`. What shipped: closed issues + git log.

## Goal

**v1 (owner re-scope, 2026-09-26) is the product that works for its one real user:** the owner pastes
a real posting he'd apply to, runs it end to end, and gets a CV good enough that he chooses to send it
himself. Prepared-apply only. No real visitors while this holds; #288 un-parks first the day it changes.
**Built for one user, designed for many:** no schema, contract or code path hardcodes the owner's
case. Full text: `CLAUDE.md`, "v1 scope and the golden rule". The destination is unchanged.

## Now / Next

**Now: check mode is live** (V6b, spec #375, [ADR-0018](docs/adr/0018-the-profile-is-the-master-cvs-home.md);
shipped 2026-10-14 in 482ca57, all 15 sub-issues closed; real-CV evals passed). The profile is the master CV's home; its check
mode replaced "Your CV, reviewed"; the jobs open once every screen is confirmed, every suggestion
answered and every market's work rights set.

- **Owner: launch `/implement-spec #389`** (Fable 5.1, high). #389's answers are recorded: #390 Preview as CV, a
  CV tailored to your own job, downloadable ([ADR-0019](docs/adr/0019-the-master-cv-previews-as-a-cv-for-the-persons-own-job.md));
  #391 old summary lines step aside, the quote label, the full walk in CI. Re-upload edge cases: #388.
- Outside that build: #387 a fact added while tailoring joins the profile (tailoring spine).
- Still open from spec #332 (V6): #359 scan message (Opus, medium) · #345 two test accounts (Opus,
  medium; needs the owner mid-ticket) · #369 · #367 · #374 extras cap (check it still applies after #378).

**Next: Chat with JobCrush** (spec [#350](https://github.com/adrien-mounier/jobcrush-app/issues/350)):
talk to improve the master CV; replaces #316/#317 *Add something new*. Its doors move from the review
page to the profile (ADR-0018). `/to-spec` → `/to-tickets` → `/implement-spec`. Small and independent:
[#348](https://github.com/adrien-mounier/jobcrush-app/issues/348) a sign-in door on the landing page.

**Still open on the v1 spine** (spec #301): #314 over two pages, tighten once then ship and tell ·
#315 the application report.
**Finish line:** one real posting end to end, `/qa-gate` GO on the whole journey.

**Model rule:** Fable for builds that can ship subtly wrong and still pass; Opus for the rest and for
every grill/spec/map. Name versions: Fable 5.1, Opus 5.5 (current as of 2026-10-06). No ticket starts at max effort. Fable quota spent → Opus, one effort step higher.
**Build mode:** a ticket set under one parent is built with `/implement-spec <parent>` (one model for the
run); `/implement` is for a lone ticket. Never point `/implement` at a parent or spec issue (#54, #86,
#127, #301, #332, #375).

## Milestones

- S0–S2.5 **done** (Jul 2026); S2.75 CV quality: A **done** (#11), B (how `cv-authoring-rules.md` is fed) **open, unticketed**; Phase 1 live-deck honesty **done** (Aug 2026; #250 parked).
- V1 — the spine (map #290, spec #301): V3 and V4 **done**; V5 half done (#312, #313); #314–#317 open.
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
