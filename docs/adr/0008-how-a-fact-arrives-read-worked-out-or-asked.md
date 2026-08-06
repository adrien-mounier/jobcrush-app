# ADR-0008 — How a fact arrives: read, worked out, or asked

- **Status:** Accepted
- **Date:** 2026-08-06
- **Decided in:** [#131](https://github.com/adrien-mounier/jobcrush-app/issues/131) (owner grilling), under map [#127](https://github.com/adrien-mounier/jobcrush-app/issues/127)
- **Depends on:** [ADR-0004](0004-each-elements-own-parts.md) clause 1a (every fact points at its origin), [#128](https://github.com/adrien-mounier/jobcrush-app/issues/128) §3 (a correction sticks), §4 (a derived value is never a second source of truth), §5 (*never ask for what you can compute*), [#126](https://github.com/adrien-mounier/jobcrush-app/issues/126) (a job is its own dated record), [#125](https://github.com/adrien-mounier/jobcrush-app/issues/125) (a language carries a level, and the machine never settles it alone)
- **Refines:** #128 §5. *"Never ask for what you can compute"* is kept, but its scope is narrowed to what it can actually carry — see clause 2.
- **Does not decide:** how many decisions the confirm screen costs, or which read facts get an individual card versus a batched line (**interface** — handed to the design effort, see [Consequences](#consequences)); which silences get a question versus a visible blank (map fog, still open); how a coarse date is written on the page ([#143](https://github.com/adrien-mounier/jobcrush-app/issues/143))

## Context

#128 established a rule in one line — *never ask for what you can compute* — and #131 was opened to
find out which facts it actually reaches. The ticket framed the answer as a switch with two settings:
a fact is **computed**, or it is **asked**.

**That framing is wrong, and finding out why was most of this ticket's value.** Two settings force a
fallback, and the fallback destroys the visitor's answer:

> Mei's CV has three positions. The middle one has no dates. Years of experience is *computed*, so we
> do not ask — but we cannot compute it either, because a position is undated. The two-setting rule has
> one remaining move: **ask**. We ask Mei how many years she has. She says **10**. We store 10.
> A month later she supplies the missing dates and the positions sum to **8**. #128 §4 already decided
> that the total is a regenerable copy and **the positions always win**. Mei's 10 is thrown away.
>
> **We asked her a question that was never going to count.**

This ADR is small because the shape it needs was already decided. **ADR-0004 clause 1a** requires every
structured fact to point at its origin and names five legitimate origins — and rules that a fact
pointing at **nothing** is a *defect*, not a low-confidence result. That clause already forbids #131's
most-feared failure (*"her CV is written in English, so she is fluent in English"* — which cites no
words, no answer, and no facts underneath). What remained was the practical half: **which facts are
asked, which are worked out, and what happens at the boundary.**

## Decision

### 1. A fact arrives one of three ways, and keeps that way permanently

- **Read** — the value is present as words in the person's document.
- **Worked out** — the value is derived from other facts we hold.
- **Asked** — the person supplied it.

These are ADR-0004 clause 1a's origins seen from the capture side (*read* = machine-read; *worked out*
= computed; *asked* = the person said it, or corrected it). **This clause adds nothing to that list.**
What it adds is that **the way a fact arrives is a property of the fact, not a preference that varies
per visitor**: years of experience is worked out for everyone, always. There is no visitor for whom it
is asked.

### 2. Never ask for a value the machine will regenerate on its own

**The binding rule of this ADR, and the reason it exists.** Referred to in discussion as *the Mei rule*.

A **worked-out** value is a regenerable copy (#128 §4) — the facts underneath always win. So asking a
person for it produces an answer with **no chance of surviving**. The question is not merely redundant;
it is dishonest, and it destroys something the person typed.

**This is the correct scope of #128 §5.** That rule was read as *"asked and computed are alternatives,
prefer computed"*. They are not alternatives. Read the other way round it is absolute: **a worked-out
value is never asked, under any circumstance, including the circumstance where we cannot work it out.**

### 3. When the calculation cannot run, ask for the missing parts underneath — never the answer on top

The failure in clause 2's worked case is not that we asked. It is that we asked the **wrong question**.

Mei's undated position is a hole in a *dated position*, which is a **read** fact — and #128's *every
missing month is asked* already governs it. So the question is *"when did you start at Standard
Chartered?"*, whose answer is permanent and feeds the sum, not *"how many years do you have?"*, whose
answer is deleted by the next recalculation.

**The tell, for a future element:** if the answer to a question would be overwritten by a rebuild, the
question is aimed one level too high. Aim it at the facts underneath.

### 4. A silence in the document is asked, and the answer outranks any later re-read

A **read** fact whose document says nothing **is asked**. This is not a fallback under clause 2, and
the two cases are not alike:

|  | Worked-out value | Read value |
|---|---|---|
| Is it rebuilt? | **Yes** — from the facts underneath | **No** — nothing regenerates it |
| So an asked answer is… | destroyed at the next rebuild | **permanent** |

#128 §3 already guarantees the second row: a correction sticks, and **no re-read overwrites it**. So a
person who tells us about a degree her CV omitted keeps that degree even if she later uploads a CV that
still omits it.

⚠️ **A silence is never read as an absence.** `eligibility.ts` already holds this doctrine — an unknown
is not a "does not have it", and #86 decision 3 forbids an unknown from withdrawing a card. Clause 4
makes the silence *askable*; it does not make it answerable by the machine.

### 5. Where the five gated dimensions fall, today

| Dimension | How it arrives | Note |
|---|---|---|
| **`years-experience`** | **Worked out** — from the dated positions (#126) | The **total** is never asked. Missing **dates** are (clause 3) |
| **`work-rights`** | **Asked**, always | Essentially never stated on a CV, and #106 established that an advert's location requirement and the visitor's own status are **different kinds of fact** — one does not resolve into the other |
| **`degree`** | **Read** when stated · **asked** when the document is silent | 🚨 New behaviour — see Consequences |
| **`certification`** | **Read** when stated · **asked** when the document is silent | 🚨 New behaviour — see Consequences |
| **`language`** | **Split** — see clause 6 | |

### 6. A language and its level are two facts, arriving different ways

The **language** is read: *"Languages: Mandarin"* cites real words. The **level** is asked — #125
decided that the machine never settles it alone, that an advert triggers the question and explains why
*that* advert cares, and that it is asked **once per language ever**.

**A level word printed on the CV does not settle the level.** *"Mandarin (fluent)"* is read as a
sentence and stored as one; it does not become a graded level the matcher compares against an advert's
bar. #125's scale is **concrete situations** (*can run a meeting in it*), and "fluent" does not answer
one. Taking the CV's own adjective at face value would be reading a level the person never placed
themselves at — the shape ADR-0004 clause 1a calls a defect.

**This is the only one of the five where a single element splits across two arrival kinds**, and it
splits cleanly because a language and a level are two facts (ADR-0003's level is a shared part).

## What this rule does NOT change

- **Capture is untouched.** #130 decision 5's *capture the maximum* stands in full. This ADR governs
  where a value comes from, never whether it is kept.
- **ADR-0004 clause 1a is the origin authority.** This ADR does not add, rename, or re-scope an origin.
  *Corrected*, and *proposed and approved*, are untouched.
- **Nothing here permits the machine to infer.** A fact that can point at neither words, nor an answer,
  nor facts underneath remains a defect.
- **The five dimensions are not the element list.** Clause 5 covers what adverts **gate** on. Skills,
  projects and the rest arrive by the same three ways but are not eligibility dimensions.

## Consequences

🚨 **Degrees and certifications become askable, and today they are not.** `ASK_DIMENSIONS` in
`apps/api/src/eligibilityDiscovery.ts` holds exactly three — `years-experience`, `work-rights`,
`language`. A `certification` is a **hard gate** on the advert side (`adReader.ts`) that the visitor is
**never asked about**: when an advert demands one, we do not know, we do not ask, and the card reports
that the bar was not tested. Clause 4 permits the question. **A build ticket must add it.**

⚠️ **This enlarges the fog item *"which holes get a question, and which get a visible blank"***, and
does not resolve it. Clause 4 makes every silence in every element *permitted* to become a question;
it does not decide that it *does*. With *capture the maximum* across five elements, the difference
between permitted and actual is the difference between a sign-up someone finishes and one they abandon.
Owner decision 8 (chunked, resumable, gamified) is what absorbs the volume — **not** this ADR.

⚠️ **The confirm screen's cost is handed to the design effort, not decided here.** The shipped deck
(`apps/web/app/deck/[jobId]/page.tsx`) already tiers **sentences**: machine-touched claims get an
individual yes/edit/remove card, verbatim claims batch by CV section, and a typical CV must stay under
**15 individual decisions**. Structured facts break that test, because one quoted line carries several
machine decisions the person never sees — *Jan 2019 – Mar 2022 · Regional PM · Standard Chartered* is a
quote as a sentence, but as a fact the machine has chosen a start, an end, a title, an employer, and
**whether this counts as work at all**, which moves her years-of-experience total. **The promise stays
in scope and is already taken** (ADR-0004 clause 1a: nothing the machine decided is unattributable, and
#127's promise 2 requires every fact be traceable and correctable). **The tap count is interface**, and
this map has ruled interface out of scope twice — the correction screen and the decline wording.

⚠️ **The get-preferred-over-asking seam is still unbuilt.** `eligibilityDiscovery.ts` records that
*"dimension.get() preferred over asking is real work for #99-101"* and that the provider work-rights
signal was **removed rather than fixed**, because a posting's accepted locations and a visitor's own
status are different facts. Clause 5's `work-rights` row is the decision that keeps it that way.

✅ **The growth rule gains a question it did not ask.** ADR-0001 rule 4 makes an element shippable only
when it can be stored, matched, printed and validated. A new element must now also state **how it
arrives** — and if the answer is *worked out*, clause 2 forbids the question that would otherwise look
like the cheap way to fill it.

## Alternatives rejected

| Rejected | Why it was attractive | What it cost |
|---|---|---|
| **Two settings: computed or asked** (clause 1) | The ticket's own framing, and it reads naturally. | Forces a fallback when the calculation cannot run, and the fallback asks a question whose answer is deleted. The worked case is Mei, above. |
| **A fresh test standing on its own, not leaning on ADR-0004** (clause 1) | A self-contained rule is easier to read in one place. | Two overlapping tests for one question, drifting apart on the first element that stresses either. The origin rule already answers the dangerous half. |
| **Ask for the total when the dates are unreadable** (clause 3) | The person plainly knows their own career length, and it fills the gate immediately. | Creates the second source of truth #128 §4 exists to forbid, and silently destroys her answer at the next rebuild. |
| **Treat a silent document as "does not have it"** (clause 4) | No question at all; the gate resolves immediately. | Converts our own parsing gaps into user harm, and breaks the unknown-is-not-absence doctrine `eligibility.ts`, `withdrawal.ts` and #86 decision 3 all rest on. |
| **Read the CV's own level word as the level** (clause 6) | Free — the adjective is already on the page, and it costs no question. | Grades her at a level she never placed herself at, against a scale of concrete situations that *"fluent"* does not answer. Overturns #125's *the machine never settles her level alone*. |
| **Decide the confirm screen's tiering here** (Consequences) | It is the first place the read/worked-out split becomes visible to a real person. | This map fixes promises, not interfaces — the limit the owner set twice already. Deciding it here designs a screen nobody has drawn. |

## Verification

**Writing the degree question must be a mechanical walk through this ADR** — a silence, a question,
a permanent answer, and nothing else. **If it turns into a fresh argument about whether a silent CV
means the person has no degree, clause 4 is wrong and #131 reopens.**

Second check, cheaper and earlier, and it is falsifiable in one line: **`years-experience` must never
appear in `ASK_DIMENSIONS`.** If a build ticket adds a *"how many years of experience do you have?"*
question — for any reason, including an unreadable work history — clause 2 was not read, and the next
rebuild will delete the answer it collected.
