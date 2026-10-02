# ADR-0009 — A project done for an employer stays a bullet

- **Status:** Accepted
- **Date:** 2026-08-06
- **Decided in:** [#150](https://github.com/adrien-mounier/jobcrush-app/issues/150), under map [#127](https://github.com/adrien-mounier/jobcrush-app/issues/127)
- **Depends on:** [ADR-0001](0001-growth-rule-for-structured-facts.md) (the growth rule, and its employer case), [ADR-0004](0004-each-elements-own-parts.md) (each element's own parts), [ADR-0006](0006-a-project-is-a-container-not-a-fact.md) (the personal project, which deferred this one), [#126](https://github.com/adrien-mounier/jobcrush-app/issues/126) (a job is its own record)
- **Evidence:** [`docs/research/work-projects-inside-a-job.md`](../research/work-projects-inside-a-job.md) (deep sources), [`docs/research/last30days-work-projects-inside-a-job.md`](../research/last30days-work-projects-inside-a-job.md) (recent movement), six real CVs in `data/cvs/` re-read first-hand, the 17-advert corpus, this repo's own grader and contracts
- **Does not decide:** what happens to a part of a CV we cannot classify ([#149](https://github.com/adrien-mounier/jobcrush-app/issues/149)); how a coarse date is written on the page ([#143](https://github.com/adrien-mounier/jobcrush-app/issues/143)); anything about the **personal** project, which is [ADR-0006](0006-a-project-is-a-container-not-a-fact.md)'s

## Contents

- [Context](#context)
- [Decision](#decision)
  - [1. A project done for an employer stays a bullet](#1-a-project-done-for-an-employer-stays-a-bullet)
  - [2. 🚨 The ticket's description of the corpus is wrong in the one detail the design hung on](#2-the-tickets-description-of-the-corpus-is-wrong-in-the-one-detail-the-design-hung-on)
  - [3. 🚨 The 7:1 count is real, and it is one document from outside our market](#3-the-71-count-is-real-and-it-is-one-document-from-outside-our-market)
  - [4. The corpus row #147 got wrong is corrected here](#4-the-corpus-row-147-got-wrong-is-corrected-here)
  - [5. Naming it buys nothing in matching, and that is checkable rather than argued](#5-naming-it-buys-nothing-in-matching-and-that-is-checkable-rather-than-argued)
  - [6. The gain that does exist is presentation, and presentation is not this map's](#6-the-gain-that-does-exist-is-presentation-and-presentation-is-not-this-maps)
  - [7. 🚨 A client line is never an employment entry — the guardrail this research actually earned](#7-a-client-line-is-never-an-employment-entry-the-guardrail-this-research-actually-earned)
  - [8. The confidentiality case is answered, and it cuts the other way](#8-the-confidentiality-case-is-answered-and-it-cuts-the-other-way)
  - [9. This is decided before #126 ships, deliberately](#9-this-is-decided-before-126-ships-deliberately)
- [Consequences](#consequences)
- [Alternatives rejected](#alternatives-rejected)
- [Verification](#verification)

## Context

ADR-0006 decided the **personal** project and explicitly left this one open: a project done **for an
employer** sits inside that job, so does it get its own named entry — with a client, dates and its own
bullets — or does it stay a plain bullet?

The owner raised it in his own words as *"a detail, but it is worth to check how we want to design it"*,
and that framing is recorded in the ticket so a future session does not inflate it. #150 also warned that
the cheap answer — leave them as bullets — was a legitimate outcome.

**It is the cheap answer, and the evidence is not close.** But the research produced two corrections and
one hazard that matter more than the answer, and they are the reason this ADR exists rather than a
one-line note on the ticket.

## Decision

### 1. A project done for an employer stays a bullet

No named container inside a job. No project name field, no client field, no project dates, no nested
bullet group. A work project is written the way our market already writes it — inside the sentence.

**How the five CVs in our actual market already do it**, all read first-hand:

| Shape | Example from the corpus |
|---|---|
| Inside the bullet | `Chatbot FINDER: Coordinated development of a chatbot…` |
| In parentheses | `a trading platform (Lao Forex Exchange)` |
| As a suffix on the job title | `Business Analyst - Banking Mobile Application` |

**The bullet is not a compromise we are settling for. It is what this market does.**

### 2. 🚨 The ticket's description of the corpus is wrong in the one detail the design hung on

#150 states that Thomas Chauviere's `Projets:` entries carry *"a client, dates and their own bullets"*.
Read at source, the three parts are attached to different things:

- **0 of 18** named projects carries a date of its own. Dates belong to a `(client)` block.
- A **client appears in one of his eight jobs**, not throughout.
- **10 of the 18** named projects have no bullets at all — they are five names on one comma-separated line.

**The rich shape the ticket describes exists four times in the whole corpus**, all inside one job of one
CV. A project date field would have been built for values our documents do not contain.

### 3. 🚨 The 7:1 count is real, and it is one document from outside our market

#147 counted ~3 standalone against ~21 nested. Recounted for the **work** project: **~18 of the ~22 nested
mentions are Thomas Chauviere alone** — a façade-engineering draughtsman in France and Switzerland.

**Across the five CVs in the market we serve** (banking / IT-PM; Bangkok · Paris · Singapore · Lisbon),
named project sub-entries carrying a client, dates and their own bullets: **zero**.

⚠️ **The design was being argued from a ratio produced by a single document in another profession.** This
does not make #147 wrong — the count was honest — it makes the *inference* from it wrong.

### 4. The corpus row #147 got wrong is corrected here

Adrien's `Project Achievements` heading was counted as a second nested case. It is **a label over a second
bullet list**, not a set of named project entries. [`personal-projects-on-a-cv.md`](../research/personal-projects-on-a-cv.md)
carries a correction note pointing here.

### 5. Naming it buys nothing in matching, and that is checkable rather than argued

ADR-0006 clause 9 established that the **judged score** is the only matching mechanism a project can reach.
`buildJudgeInput()` (`apps/api/src/judge.ts:66-75`) hands the grader a flat list of `id` / `text` lines and
**passes no employer, no job, no dates and no grouping — not even which role a sentence belongs to**.

**The job container is already invisible to the matcher.** A project container nested inside an invisible
container cannot change a single score. No ATS surveyed exposes a project as a search or filter field, and
nothing in the 17-advert corpus asks for a named project (16 of 17 use the word *project*, every one of
them about the job on offer).

### 6. The gain that does exist is presentation, and presentation is not this map's

A named entry can make a dense page tidier and gives the person a nicer unit to edit. Both are real and
neither is a fact-model question. **#150's own Q3 said so in advance:** *if the answer is "it looks
tidier", that is a presentation choice and belongs to the design effort.* It does.

### 7. 🚨 A client line is never an employment entry — the guardrail this research actually earned

ADR-0006 clause 5 forbids a **project** reaching `roles[]` or `Draft.experience`. **Nothing forbids a
client**, and the client is the one that looks exactly like a job:

```
ASSYTEM (client) - 02/2021 - 05/2021
TRACTEBEL (client) - 10/2018 - 12/2020
```

**A name plus a date range nested under an employer is byte-for-byte the shape of an employment block.**
If it lands, the CV prints two employers the person never worked for — decision 9's *the machine never
adds silently*, and #138's observed real-parser failure.

⚠️ **Today this is blocked by an accident, not a rule.** `MinedRole.title` is `z.string().min(1)`
(`packages/contracts/src/candidateClaims.ts:10-15`) and a client block has no title, so the **contract**
rejects the fabrication. That is not a guardrail; it is a shape that happens to fail. **#126 rewrites this
record.**

**So clause 5 of ADR-0006 is extended: neither a project name nor a client name may become an employment
entry**, and the check must be a rule the reader states, not a validation that happens to reject.

### 8. The confidentiality case is answered, and it cuts the other way

#150's Q5 asked whether the design breaks when the client cannot be named — the banking and consulting
case, which is exactly our market. **It does not.** The convention is uniform with no dissent found:
sanitise the client to a descriptor (*"a leading global bank"*, *"a medium-sized commercial bank"*) and
keep the engagement.

⚠️ **But note the direction.** This **removes an objection to building**; it supplies **no reason to
build**. And it makes clause 7 worse, not better — a descriptor line for a client is one more
name-plus-date-range sitting under an employer.

### 9. This is decided before #126 ships, deliberately

Carving a named container out of what are today job bullets is **ADR-0001's employer case** — its own
stated limit, where promoting part of an existing fact into its own kind is a migration the rule does not
make cheap. **It is free right now only because #126's job record does not exist yet, so there is nothing
to migrate.**

Concretely: the miner's `role` is a **free string** (`packages/contracts/src/candidateClaims.ts:31`), so a
project name could be written into it today at **zero contract cost**. `MinedRole` requires `employer` and
`title`; the Draft has no project or client slot; `conservationIssues()` watches neither.

**The cheap version is a naming convention inside an existing string. The expensive version is a new part
on the job record. Only the first is free, and we are building neither.**

**The decision is cheap today and expensive after #126. That is the whole reason it is being recorded now
rather than left on the ticket.**

## Consequences

**Nothing is built. Two things are written down, and one existing rule grows.**

- **ADR-0006 clause 5 is extended to clients** (clause 7). This is the one build consequence, and it lands
  with **#126**, not here: when the job record is written, it must be impossible for a `(client)` line to
  become an employment entry, and the check must **distinguish *found nothing* from *did not run*** — the
  failure `career-ops` shipped three times in one month, which ADR-0004 clause 1 already demands.
- **The project name must survive into the bullet.** It already does — the miner keeps the person's words
  — but nothing currently *states* it, so a future tailor rewrite could drop `Chatbot FINDER:` as a
  redundant prefix and nobody would notice. **`conservationIssues()` counts fact classes and would not
  catch it**, exactly as ADR-0005 records for a bullet-for-bullet stretch swap.
- **`Draft.experience` gains no project or client slot**, and the miner prompt gains no work-project
  instruction. ADR-0006's projects instruction stands and is unaffected — it governs the **personal**
  project and the `Projects` section.
- **The tailor may still drop a work project**, because a work project is a job bullet and the tailor
  already selects bullets. No new lint. ADR-0006 clause 7's projects check remains owed for the
  **section**, unchanged by this ADR.

⚠️ **A scope note on [ADR-0001](0001-growth-rule-for-structured-facts.md), a footnote and not an amendment**,
following the precedent ADR-0004 set for ADR-0003 clause 8 and ADR-0006 set for rules 4 and 5:

> **Rule 4's four gates can be walked to a "build nothing" answer, and that is a pass, not a skip.** #150
> is the first element on this map where every gate was checkable and the honest total was *no*. The rule
> is written as though its output were a cost estimate; **its output may also be a refusal**, and a refusal
> reached by walking the gates is the rule working.

**What this does not touch:** #130's *capture the maximum* stands in full. Nothing here reduces what the
miner reads off a CV — a named work project is captured exactly as the person wrote it. **This is a
decision about structure, not about capture.**

## Alternatives rejected

| Rejected | Why it was attractive | What it cost |
|---|---|---|
| **A named project container inside the job**, with client, dates and its own bullets | It is the shape the ticket described, and 7:1 looked decisive. | The ticket's shape exists **four times, in one job of one CV** (clause 2); the 7:1 is **one document from another profession** (clause 3); **zero** occurrences in our market's five CVs. Building for values the corpus does not contain. |
| **A named container with no date**, mirroring ADR-0006's personal project | Consistency — the same container shape in both places, one model to explain. | The whole reason a personal project needs a container is that three loose paragraphs have no way to group. **A work project already has a container: the job.** The second container groups nothing that is not already grouped. |
| **A project name field only** (no client, no dates) | Cheapest possible version; would let the name survive as data rather than prose. | It is the **employer case** the moment #126 exists (clause 9), and it buys nothing the matcher can see (clause 5). The name already survives — in the person's own sentence, which is where ADR-0004 clause 1a wants it to point. |
| **A client field on the job** | Thomas's CV genuinely carries clients; #130 says capture the maximum. | It is the **hazard**, not the feature (clause 7). A client is a name plus a date range under an employer, and the one thing standing between it and a fabricated employment entry today is a `min(1)` that #126 rewrites. |
| **Defer until after #126** | The build ticket would show the real cost instead of an estimated one. | Backwards. After #126 this becomes a migration; **before it, the decision is free** (clause 9). Deferring converts a cheap decision into an expensive one and gains nothing. |
| **Treat "it looks tidier" as sufficient** | It is a real gain, and dense CVs genuinely read better with sub-headings. | #150's own Q3 pre-committed against it, and the map is a **fact model**. Presentation is the design effort's, and routing it there loses nothing (clause 6). |

## Verification

⚠️ **This is not a stress test of the growth rule, and must not be counted as a fourth attempt.**
[ADR-0006](0006-a-project-is-a-container-not-a-fact.md) clause 10 retired the paper stress test after three
misses and recorded that **no candidate remains**; the test transfers to the first element added after
build. #150 proposes **no new element at all** — it is the growth rule declining one. ADR-0007 had to make
the same disclaimer for the same reason.

**Falsifiable checks — three, each mechanical:**

1. `Draft` (`apps/api/src/preview.ts`) must contain **no project or client slot inside `experience`**.
2. `MinedRole` must never be constructible from a line whose only parts are **a name and a date range**.
   After #126 this stops being guaranteed by `title: z.string().min(1)` and must become a stated rule.
3. A work project's name must appear **inside a claim's own text**, never as a field beside it.

**What #150 delivered, so "build nothing" is not read as a wasted ticket:**

- **Two corpus corrections** (clauses 2 and 3), one of which invalidates the inference the design was being
  argued from, and one row corrected in an existing research document (clause 4).
- **The client hazard** (clause 7) — a real fabricated-employer path that **no existing rule covers**, found
  because someone read the CVs rather than the ticket's summary of them.
- **The first "build nothing" pass through rule 4's gates**, and the scope note that this is the rule
  working rather than being skipped.
- **A timing conclusion the owner can act on** (clause 9): decide before #126, build never.
