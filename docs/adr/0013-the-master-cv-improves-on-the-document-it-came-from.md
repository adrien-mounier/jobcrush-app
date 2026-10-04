# ADR-0013 — The master CV improves on the document it came from

- **Status:** Accepted
- **Date:** 2026-08-13
- **Decided in:** [#211](https://github.com/adrien-mounier/jobcrush-app/issues/211) (owner grilling)
- **Depends on:** [ADR-0001](0001-growth-rule-for-structured-facts.md) rule 3 (the sentence always survives), [ADR-0002](0002-how-a-structured-fact-reaches-the-cv.md) (how a fact reaches the page), [ADR-0004](0004-each-elements-own-parts.md) clause 1a (a fact points at its origin)
- **Does not decide:** what prints for a given advert ([ADR-0007](0007-what-prints-is-decided-per-application.md)); how a stretch is proposed and scoped ([ADR-0005](0005-a-stretch-belongs-to-its-advert.md)); how a merged bullet declares what it kept ([ADR-0012](0012-a-merged-bullet-declares-the-result-it-kept.md))

## Context

This is the oldest unwritten rule in the product. It has decided two tickets and was never recorded,
so both were argued from first principles instead of from it.

The owner stated it plainly during #211: *"what I expect from our product is that the master CV we
build should be **better** than the uploaded CV."* Worked on the case in front of him — a person whose
CV names `C#` inside a job bullet and nowhere else: *"A minimum thing is to add C# in the SKILLS
section. **Not for the machine, but for the human who will read it.**"*

That sentence is the whole rule, and it is the reason the #211 design nearly went the wrong way. The
question had been framed as *how many records does the reader make* — an internal question, answered
by picking whichever rule varied least between runs. The winning answer to that question produced a
master CV with **no `C#` in its Skills section**, which is a defect the person can see. **A rule that
optimises the store while degrading the page is answering the wrong question.**

## Decision

**The master CV is an improvement on the document it came from, not a transcription of it.** It is
the version the person could not have written alone. Three obligations follow, and they bind any
ticket that shapes what the master CV holds.

### 1. A fact stated anywhere in the source may reach the section a human reader expects it in

A tool named only inside a job bullet belongs in the Skills section too. A qualification named only in
a summary line belongs under Education. **Where the source happened to put it does not cap where it
may appear** — the source's layout is an accident of how that person writes, and correcting it is
most of the value we add.

The bullet is never destroyed to achieve this (ADR-0004 clause 3): the fact appears in both places,
and the second appearance carries its origin (clause 1a).

### 2. Improvement never means invention

> **Amended by [ADR-0016](0016-the-cv-is-reviewed-not-asked.md)** (2026-10-04): a drafted line may be pre-filled when it arrives unticked,
> cites its source and obeys drafting rules R1–R6. *Improvement never means invention* stands.

Everything the master CV adds must already be present in the person's own material. #211's mechanical
form of this is the strictest available and should be preferred wherever it fits: **the added string
must appear verbatim in the source.** Where no such guard is possible — nothing in the source to check
against — the item is **offered as a question, never pre-filled** ([#213](https://github.com/adrien-mounier/jobcrush-app/issues/213)).

### 3. The improvement is proposed, and the person owns it

Consistent with the owner philosophy the product is built on: the machine proposes, visibly, and the
person keeps or removes. What survives is a user-resolved fact. **Visible is the requirement; silence
is the defect.** A pre-filled proposal on a screen the person is looking at is not a silent add.

## Consequences

- **[#211](https://github.com/adrien-mounier/jobcrush-app/issues/211)** — decided by clause 1. A tool
  found only in job prose reaches the Skills section (ADR-0004 clause 10).
- **[#210](https://github.com/adrien-mounier/jobcrush-app/issues/210)** — the same demand, for shape
  rather than coverage: a messy bullet the person uploaded must not print back unchanged. Its fix is
  at the render, and this ADR is why the render is obliged to act.
- **A measure of "no worse than the upload" is not a measure of this.** Conservation
  (`conservationIssues()`) checks that the tailored CV loses nothing. That is the floor, not the
  promise. Nothing today measures whether the master CV is *better*; the first such number is #211's
  coverage count, landing in #202's answer key.
- **This is a page-facing rule, not a store-facing one.** It constrains what the person reads. It says
  nothing about record shapes beyond requiring that they not make clause 1 impossible — which is
  exactly the trap #211 walked into.

## Alternatives rejected

| Rejected | Why it was attractive | What it cost |
|---|---|---|
| **Leave it unwritten** | It is obvious, and everyone already agrees with it. | It has now been re-derived from scratch twice (#210, #211), and in #211 the recommendation was wrong until the owner restated it. An unwritten rule loses every argument it is not present for. |
| **The master CV is a faithful transcription; improvement happens per application** | Clean separation; ADR-0007 already owns per-application choices. | The master CV is the document the person reads first and trusts. Handing him back his own weaknesses, then fixing them silently per advert, means he never sees the product work. |
| **Write it as an ADR-0004 clause** | Skills are where it surfaced. | It binds education, projects, certifications and shape (#210) too. Filed under skills, it would not be found by the tickets that need it. |

## Verification

This ADR is wrong if a ticket cites clause 1 to move a fact into a section **whose text does not
appear in the source** — that is invention wearing this rule as cover, and clause 2 is the boundary
it crossed. It is also wrong if the coverage number #211 hands to #202's answer key shows the master
CV holding *fewer* facts in the reader-visible sections than the upload did.
