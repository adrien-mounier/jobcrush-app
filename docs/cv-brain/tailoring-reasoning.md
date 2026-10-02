# CV tailoring — reasoning framework

> **Provenance.** Copied from the JobCrush repo's `CLAUDE.md` (§2 Target Roles, §3 Content
> Classification, §7 Decision Rules, §8 Gap Handling) on **2026-07-18**, the day the CV brain
> was forked (see `README.md`). This is the durable reasoning the tailoring pipeline rests on —
> the *why* behind the schema, the miner prompt, and the tailor prompt. JobCrush-internal plumbing
> (file conventions, agent/command wiring) was intentionally left out; only the transferable
> reasoning is here. From here on this file evolves with **the product**, independently of JobCrush.

## Contents

- [1. What tailoring produces](#1-what-tailoring-produces)
- [2. Target roles (the role taxonomy the tailor reasons over)](#2-target-roles-the-role-taxonomy-the-tailor-reasons-over)
- [3. Content classification (the 5 levels)](#3-content-classification-the-5-levels)
- [4. Decision rules (which role language the CV adopts)](#4-decision-rules-which-role-language-the-cv-adopts)
- [5. Gap handling](#5-gap-handling)
- [6. The conservation principle (product-specific, added at the fork)](#6-the-conservation-principle-product-specific-added-at-the-fork)
- [7. Reading a dated block (#161, added at the durable-record build)](#7-reading-a-dated-block-161-added-at-the-durable-record-build)
- [8. A denied capability (#287, decided 2026-09-27)](#8-a-denied-capability-287-decided-2026-09-27)
  - [The document](#the-document)
  - [What the person is told](#what-the-person-is-told)
  - [The door](#the-door)
  - [The application report](#the-application-report)
  - [Not decided here](#not-decided-here)

## 1. What tailoring produces

Every tailoring run produces two things that must never be mixed without labelling:

1. A tailored CV draft — the best honest positioning of the candidate for one role.
2. A verification record — every claim not directly supported by the source CV, surfaced for the
   candidate to confirm before the CV reaches an employer.

Never present proposed content as unquestionably true. Anti-fabrication governs what reaches
**employers**, not what the candidate may see on their own screen (a watermarked, non-exportable
preview of unconfirmed content is fine; a submitted CV of unconfirmed content is not).

## 2. Target roles (the role taxonomy the tailor reasons over)

**Core:** IT Project Manager, Project Manager, IT Product Owner, Product Owner, IT Product Manager,
Product Manager.

**Adjacent:** Program Manager, Delivery Manager, Scrum Master, Technical Project Manager, Digital
Project Manager, Digital Product Manager, Technical Product Owner, Technical Product Manager.

When the posting's title is hybrid, note the blend rather than forcing one label.

_(This taxonomy is the initial coverage. A multi-tenant product will extend it as users bring roles
outside PM/PO/PdM; the classification and decision machinery below is role-agnostic and carries over.)_

## 3. Content classification (the 5 levels)

Classify every piece of CV content consistently across the evidence map, the draft, and the audit.

| Class | Definition |
|---|---|
| `Verified` | Directly supported by the source CV or a grounding file. No review needed. |
| `Derived` | Stronger phrasing, reordered bullets, or synthesis not materially beyond the source. No review needed; note it. |
| `Partially Supported` | Adjacent or indirectly evidenced — a related skill, a similar tool, a comparable scope. Must appear in the verification record. |
| `Unsupported but Plausible` | Not in the source, but a reasonable addition given the candidate's trajectory and the role. Must appear in the verification record with risk level and recommended action. |
| `Unsupported` | No evidence and not safe to assume. Do not include in the draft. Flag as a gap. |

The boundary that matters most: **asserting is not evidencing.** A fluffy self-description the CV
merely states ("experienced in stakeholder management", with no supporting role or outcome) is
`Partially Supported`, never `Verified`.

## 4. Decision rules (which role language the CV adopts)

> **This is a discriminator, not a family floor** — _clarified 2026-07-23, after it was read as one
> and a design was built on top of that reading
> ([#6](https://github.com/adrien-mounier/jobcrush-app/issues/6))._
>
> The signals below decide **which role's language** the CV adopts. They are the words that
> *separate* PM from PO from PdM. A **family floor** is the opposite material: what *every* job in a
> family expects — largely the shared baseline this section deliberately throws away. **Budget is
> dropped here precisely because every PM ad asks for it, and that is exactly why a PM CV cannot be
> missing it.**
>
> So do not read the clusters below as a checklist of what a CV must cover. A discriminator is a tally
> you compare; a floor is a checklist you tick off. That floor is the **discovery floor** —
> the same one `docs/onboarding-reward-design.md` §6 ranks and adaptive discovery walks. It is
> built and versioned (`apps/api/src/familyFloors.ts`, `FamilyFloorV1`); the note that it
> "does not exist yet" was true when this clarification was written and is not true now.
>
> **Covered is not the same as printable — settled 2026-09-27
> ([#287](https://github.com/adrien-mounier/jobcrush-app/issues/287)).** §6 counts a floor item as
> covered by an explicit *"No"*, stored as a first-class **non-renderable** negative — so a fully
> covered floor can contain items that print nothing. Ticking the floor off is therefore not
> sufficient instruction for a CV write. **§8 is that instruction**, and it governs every negative,
> not only a floor item's.

Signals are additive. Tally per cluster; the dominant cluster sets the CV's language. Note secondary
clusters.

**Shared baseline (ignore — too generic to discriminate):** budget, user stories as a format,
stakeholder management, requirements gathering, agile familiarity.

**Project Manager:** delivery accountability, RAID log, milestone/schedule planning, WBS, steering
committee, change control, resource/capacity planning, programme governance, budget governance
(spend, not P&L).

**Product Owner:** sprint ceremonies, backlog ownership, acceptance criteria, definition of done,
velocity tracking, squad collaboration.

**Product Manager:** roadmap ownership, discovery/user research, KPIs/OKRs, P&L ownership,
go-to-market, product lifecycle, competitive analysis.

**Technical framing (add on top of any of the above):** architecture decisions, build-vs-buy,
engineering collaboration at design level.

When two clusters score similarly, name both and lean to the stronger. If genuinely ambiguous, use
closest-fit and note the alternative.

## 5. Gap handling

`Unsupported`: exclude from the draft; record as a gap; generate a candidate follow-up question. If
confirmed, reclassify as `Verified`, persist to the grounding source, and list under "confirmed
additions". If unconfirmed, note the gap and prepare an interview-answer strategy.

`Unsupported but Plausible`: include only if it materially improves fit and can be defended at
interview. Always surface it in the verification record. Default for High-risk items: ask the user.

## 6. The conservation principle (product-specific, added at the fork)

The tailor may rephrase, reorder, merge, and select for the posting. It may **not** silently delete a
class of facts the source CV had — certifications, languages, or the density of the current role.
"Tailor by emphasis, not amputation." Skills are the one deliberate exception: they are *curated* to a
focused 8-12, not exhaustively conserved. This principle is enforced mechanically by the conservation
lint in `apps/api/src/preview.ts` (`conservationIssues`) and is the direct lesson of the JC-2 rating
failure that prompted this fork.

## 7. Reading a dated block (#161, added at the durable-record build)

Before #161, a dated entry (a job, a school, a client engagement) was read as four loose strings and
discarded after one use. The durable job record decomposes each dated block into five independent
machine decisions — employer, title, start, end, kind — and two reading rules from that ticket belong
here because they are CV-reading judgement, not storage plumbing:

- **Precision is never invented.** "2021 – 2023" is read at year precision; a month is only recorded
  when the CV states one ("Jan 2019 – Mar 2022" is month precision). The record must print no more
  than it knows — the same conservatism `cv-authoring-rules.md` asks of writing applies to reading.
- **A client line nested under an employer is never a job.** `ASSYTEM (client) - 02/2021 - 05/2021`
  sitting inside a consulting role is a name plus a date range, byte-for-byte the shape of an
  employment block — but it is read as `kind: client`, never `kind: job`, so it can never fabricate a
  second employer the candidate never worked for (ADR-0009). The miner is told to look for the parent
  employer around an ambiguous name+date block before deciding.

The full mining contract lives in `apps/api/prompts/job-block-miner.md` and
`packages/contracts/src/jobBlock.ts`; this section records only the reading judgement behind it, per
the repo rule that a change to the reading rules is recorded here, not left implicit in the prompt.

## 8. A denied capability (#287, decided 2026-09-27)

A **user-resolved fact** may be a negative: the person answered *"No — I have never done this."*
`docs/onboarding-reward-design.md` §6 counts such an answer as covering a family floor item and stores
it as a first-class, non-renderable negative, so a **fully covered floor can contain items that print
nothing**. §4's *tick the floor off* is not sufficient instruction for a CV write. This section is that
instruction.

**It governs every negative, not only a floor item's** (owner call, 2026-09-27). A "No" given in
discovery about a family floor item and a "No" given in the Tailor step about one posting's requirement
are stored the same way and are indistinguishable to the person. A rule that split them would give the
door below to some important gaps and not others, one line apart on the same screen, with nothing to
explain the difference — the inconsistency #287 exists to close. The ticket's title says *floor item*;
the ruling is wider.

### The document

1. **A denied capability never prints.** Already enforced mechanically: a `Negative` node in
   `packages/contracts/src/claimGraph.ts` must carry `renderable: false`, golden-tested against
   `oracle/validate_graph.mjs`. Nothing below weakens it, and no per-application override exists.
2. **A denied capability is never implied either.** Printing the claim is blocked by machine; implying
   the capability is not. A summary reading *"data-driven business analyst"*, or a skills group
   carrying *"reporting and analytics"*, hands a recruiter the denied capability without ever citing
   the denied claim. The ban therefore lives in `cv-authoring-rules.md`'s **hard rules**, which are
   auto-injected on every CV edit, and a check looks for the denied item's own words anywhere on the
   finished page. **The ceiling, stated rather than papered over: the check catches the words, never a
   paraphrase.**
3. **A denied capability is never the subject of a stretch.** ADR-0005's machinery softens something
   true and thin. A denial means there is nothing to stretch from, so a softened version is an
   invention the person would have to defend in the room. **This is not a guardrail on stretching** —
   map #127 decision 9 stands unqualified. The adjacent *true* fact (*"worked alongside the analysts
   who built the reporting"*) stays fully available and prints on its own merit.

### What the person is told

4. **Named where it matters, silent everywhere else.** A denied capability appears on a job card only
   when that posting asks for it, under the heading **"You told me you don't have this"**. Before this
   ruling, every negative in the session appeared on every card in the deck (`buildJobCard`'s
   `askedClosed`) — the same defect the eligibility answers were already filtered for, and the
   discovery answers were missed.
5. **Never asked again.** ADR-0011 clause 4 already rules that an answer closes its question
   permanently and only the person may reopen it. ⚠️ **Written, not enforced.** A floor negative is
   keyed on the claim's semantic key; a Tailor answer is keyed on `(advert, requirement)`. So today a
   person who denied SQL in discovery **is** asked about SQL again by the first posting that wants it.
   The spine build owns the fix.
6. **Every row carries its own door: "Changed? Add it."** A profile grows. A "No" given in 2026 may be
   false in 2027, and the product owes her a way to say so while she is looking at the gap.

### The door

7. **The door is the existing answer path, not a second mechanism.** The row becomes a question again,
   she answers, the line appears in the CV beside her, the card re-scores, the ledger prints its
   `+N%`. She never leaves the Tailor step, and the fact lands on her profile permanently — it is
   hers, not a stretch, so it helps every later posting.
8. **The door belongs with the questions, before the draft is written.** A door on the approve screen
   arrives too late: reopening a capability there means redrafting the CV she has just read.
9. **The "No" is kept; the new fact is dated.** Erasing the "No" makes the record claim she always had
   the capability. Keeping it and dating the new fact is both honest and a **stronger** CV line — a
   recently acquired skill reads as someone still learning. `ClaimStore.reopen`'s mistap path still
   erases, and the two must stay distinguishable: *I tapped the wrong thing* and *I grew* are not the
   same event.
10. **The date is asked, never stamped.** *"Since when?"* with coarse choices (this year · 1-2 years ·
    3 or more). Stamping the day she told us records the wrong fact — it prints *"since September
    2026"* over a capability she may have held since 2024, making a true line read weaker than it is.
    This is `cv-authoring-rules.md`'s *never infer a month*, applied to an asked fact.

### The application report

11. **The report names the gap and hands her a sentence.** Being told she has a gap is worthless — she
    knows. The report gives the line she cannot produce under pressure: *"This job asks for SQL. You
    have told me you have never used it, so nothing about it printed. If they raise it, say …"* That
    is the whole value of #293's interview-prep section, and it costs one more item in a model call
    the report already makes.
12. **The prepared sentence never invents a bridge.** Where nothing adjacent exists, the honest line is
    *"you have nothing close to this — expect it to come up"*, never a manufactured connection.
    Clause 2's ban applies to the report exactly as it applies to the page.

### Not decided here

The profile screen grows **no** door to this list. The owner kept the ruled-out items hidden there
(2026-09-27), so that screen's own law — *no "what you lack" list exists anywhere on this screen* —
stands untouched. The hole it leaves (a person who learns SQL before any posting asks) is closed by a
separate feature, [#299](https://github.com/adrien-mounier/jobcrush-app/issues/299): a guided
**"Add something new"** flow that recognises a denied capability at the moment she types it. A design
session owns its screen-versus-sheet question.
