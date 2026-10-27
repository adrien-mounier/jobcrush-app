# Roadmap — jobcrush-app

_Last updated: 2026-10-27 (owner confirmed #425's "Chinese" rule; #446 decided: spec #450)_

One screen. The GitHub tracker owns tickets, order and blocking; this page points, never copies.
`#n` = `https://github.com/adrien-mounier/jobcrush-app/issues/n`. What shipped: closed issues + git log.

## Goal

**v1 (owner re-scope, 2026-09-26) is the product that works for its one real user:** the owner pastes
a real posting he'd apply to, runs it end to end, and gets a CV good enough that he chooses to send it
himself. Prepared-apply only. No real visitors while this holds; #288 un-parks first the day it changes.
**Built for one user, designed for many:** no schema, contract or code path hardcodes the owner's
case. Full text: `CLAUDE.md`, "v1 scope and the golden rule". The destination is unchanged.

## Now / Next

**Now: the v1 finish line. The last build, ~~#425~~ (the language rule, c74cb64), shipped; the owner's re-proof is next.** The owner's staging run (2026-10-22) found six
defects. Five shipped and were owner-checked the same day (~~#403~~). The sixth became a decision:
~~#408~~, decided 2026-10-23 in [ADR-0020](docs/adr/0020-the-cv-is-written-first-only-stretches-are-suggested.md).
The CV is written first, and only stretches are suggested beside it. Its build, spec
~~[#412](https://github.com/adrien-mounier/jobcrush-app/issues/412)~~ (#413–#420, plus #411), shipped 2026-10-24 (d411ecc).
Then ~~#423~~ (9469733): the Tailor screen takes the #408 prototype's layout, with "Your CV | The job" tabs and
each suggestion's number on the job line it answers (it closes ~~#422~~). Both are live on staging (CI green, 2026-10-24).

**Finish line, what remains (v1 before the chat):**
1. ~~**Owner:** type `/implement-spec #412` (Fable 5.1, high).~~ Shipped 2026-10-24 on a `/qa-gate` GO.
2. ~~**Agent:** #425. A job that requires a language not on your profile leaves the deck, and a working
   language on the CV is not asked again.~~ Shipped 2026-10-24 (c74cb64) on a `/qa-gate` GO. Owner
   confirmed 2026-10-27: a job asking for "Chinese" counts as met by Mandarin or Cantonese.
3. **Owner:** one more real report on staging, on a fresh account. Sign in as
   `adrien.mounier91+test1@gmail.com` in a private window; any new address is a new, empty account,
   so #345 is not needed for this. Runs so far found ~~#428~~ and, on 2026-10-25, ~~#431~~–~~#434~~,
   all live now: resume from a fresh account, through to the email arriving.
4. **Agent:** `/qa-gate` GO on the whole journey (Opus 5.5).

**Live 2026-10-25 (8466cdb, CI green):** the re-proof's finds are fixed: ~~#431~~ ~~#434~~ the job being
tailored no longer turns into "unknown card" · ~~#432~~ Approve survives a malformed report answer · ~~#433~~
the suggestion numbers, the approve moment, Ready to send · ~~#427~~ the stretch step no longer retries (a CV
keeps fewer stretches: owner accepted) · ~~#435~~ #431's journey runs in tier 2. **Step 3 above is next.**

**Owner's defect list (2026-10-26), after the re-proof:** spec ~~#443~~ shipped 2026-10-27 on a `/qa-gate`
GO: ~~#437~~ the open suggestion number gold again · ~~#438~~ a ◆ on lines a suggestion changed · ~~#439~~ the
centred letterhead · ~~#424~~ · ~~#410~~. **Owner:** check the downloaded PDF's letterhead on staging (only
the print gate printed it locally). #409 left the batch after four NO-GOs; owner decided 2026-10-27 that
the model reads the name and city, Your details loses its title field, and the headline becomes the job
ad's own title: spec [#450](https://github.com/adrien-mounier/jobcrush-app/issues/450) (#409 #444 #446),
tickets #451 → #452, #453, #454; **Owner:** `/implement-spec #450` (Fable 5.1, high). The eval grid's
source waits on branch `t/409-letterhead`. The CV email's design: ~~#441~~ prototype done (B2,
branch `prototype/report-email-441`); ~~#442~~ live 2026-10-27 (a139ee0). **Owner, when you can:** #455, one real email read in
Gmail on a computer and a phone, dark mode too. Next build: #448 (each
person keeps their own apply link). A CV with a photo: parked, #440.

- **Agent, when asked:** #395 broken journeys still waiting for questions #376 removed (Opus 5.5, medium) · #421 withdrawal journey rotted in no tier · #318 tablet widths (641–959px) have no browser check (both
  Opus 5.5, medium) · #426 a CV
  line naming two languages at two levels (Opus 5.5, low) · #429 "Look again"
  keeps the old failure message beside the wait screen (Opus 5.5, low) · #430 a stretch delay in qa-main, so tier 2 sees the "suggesting" phase (Opus 5.5, medium) ·
  #436 no test proves /sessions/me withholds the
  kept Tailor job (Opus 5.5, low) · #449 the two email journeys sit in no CI tier (Opus 5.5, medium).
- Still open from spec #332 (V6): #359 scan message (Opus, medium) · #345 two test accounts (Opus,
  medium; needs the owner mid-ticket) · #369 · #367 · #374 extras cap (check it still applies after #378).

**Next: Chat with JobCrush** (spec [#350](https://github.com/adrien-mounier/jobcrush-app/issues/350)):
talk to improve the master CV; replaces #316/#317 *Add something new*. Its doors move from the review
page to the profile (ADR-0018), and it now also carries the door on the Tailor step's "Also asked,
not on your CV" list (ADR-0020 clause 6). `/to-spec` → `/to-tickets` → `/implement-spec`. Small and
independent: [#348](https://github.com/adrien-mounier/jobcrush-app/issues/348), a sign-in door on the landing page.
Measured so far: the application report costs **$0.46 per application** (2026-10-19).

**Model rule:** Fable for builds that can ship subtly wrong and still pass; Opus for the rest and for
every grill/spec/map. Name versions: Fable 5.1, Opus 5.5 (current as of 2026-10-06). No ticket starts at max effort. Fable quota spent → Opus, one effort step higher.
**Build mode:** a ticket set under one parent is built with `/implement-spec <parent>` (one model for the
run); `/implement` is for a lone ticket. Never point `/implement` at a parent or spec issue (#54, #86,
#127, #301, #332, #375).

## Milestones

- S0–S2.5 **done** (Jul 2026); S2.75 CV quality: A **done** (#11), B (how `cv-authoring-rules.md` is fed) **open, unticketed**; Phase 1 live-deck honesty **done** (Aug 2026; #250 parked).
- V1 — the spine (map #290, spec #301): V3 and V4 **done**; V5 **done** (#312, #313, #314, #315, 2026-10-18); #316/#317 replaced by #350. Finish line run 2026-10-19 (NO-GO, fixed); its four follow-ups under #301 **done** 2026-10-21; #398 and #403 **done** 2026-10-22 and owner-checked on staging; #408 decided 2026-10-23 (ADR-0020); spec #412 and #423 **done** 2026-10-24, live on staging; the final whole-journey re-proof remains.
- V6 — discovery redesign (#326 decided, spec #332): **built**, 12 of 13 closed (#345 left); its review page was replaced by V6b.
- V6b — the profile's check mode (ADR-0018, parent #375): **done** 2026-10-14 (482ca57).
- S3 the hunt / S4 every day, everywhere — the original destination milestones: open, text in the archive.
- Phases 2–6 — the profile gets rich (#127), the deck gets cheap and trustworthy, the live-jobs chain (#54), where the jobs come from, the next products: **parked 2026-09-26, not cancelled** — see archive.

A parked item comes back only by the **pull rule** (one of the owner's real drafts shows the lack;
first candidates #171, #168, #203) or when real visitors return, and then #288 goes first.

## Backlog

- Parked pool: #250 · #276 · #277 · #286 · #288 · #289 · #298 — not yet ordered: #275 · #328 · #329 · #330 · #331
- Unticketed ideas (archive, "Later"): an advisory "improve your profile"; how `cv-authoring-rules.md` is fed (S2.75 question B, near #328)

## Live risks / ops notes

- **Techmap quota:** 100 calls/month, not 1000 (81 left on 2026-10-10) → #366.
- **Anthropic credit:** on 2026-10-24 (21:15–21:16 UTC) staging's calls were refused for "credit balance too low" for about a minute, then recovered. The owner is to check billing and auto-reload; at zero, every AI step fails.
- **CI minutes:** solved 2026-10-08, repo made public (free Actions minutes). Nothing secret goes in a tracked file.
- **Real visitors gate:** #288 (sign-in refusal reads as a crash) and #298 (warm machine, $7.23/month) un-park before anyone but the owner is let in, and #448 (each person keeps their own apply link) has shipped.
- **Stretch rewrites are capped at 200 per session** (failed calls count too; raised from 20 on the owner's call, 2026-10-24, since a session lasts for the life of the account): at most ~$1.60, or ~$3.20 if every call fails and retries. The FactBadge chip has no live surface since #415 removed the yes/no queue.
- **Tablet widths are untested:** no browser check drives 641–959px (#318). #423 gave the Tailor screen's 641–959 band the one-line phone bar, so #318 is un-parked (2026-10-24).

Full pre-2026-10-06 roadmap (phase tables, ordering constraints, design history): [`docs/archive/roadmap-2026-10-06.md`](docs/archive/roadmap-2026-10-06.md).
