# ADR-0001 — The growth rule: adding a new kind of structured fact

- **Status:** Accepted
- **Date:** 2026-08-04
- **Decided in:** [#129](https://github.com/adrien-mounier/jobcrush-app/issues/129) (owner grilling), under map [#127](https://github.com/adrien-mounier/jobcrush-app/issues/127)
- **Depends on:** [#128](https://github.com/adrien-mounier/jobcrush-app/issues/128) (where a structured fact comes from), [#126](https://github.com/adrien-mounier/jobcrush-app/issues/126) (a job is its own record)
- **Does not decide:** how a structured record becomes text on a tailored CV — that is [#135](https://github.com/adrien-mounier/jobcrush-app/issues/135)

## Context

The owner's requirement for the CV data model: *"this data model should be flexible enough so we can
make it evolve in the future"* — adding a new kind of fact later must not be a migration or a rewrite.

Two elements had already been shaped ([#128](https://github.com/adrien-mounier/jobcrush-app/issues/128),
[#126](https://github.com/adrien-mounier/jobcrush-app/issues/126)) without the rule for adding a third
being written down. This ADR is that rule.

**Scope.** It governs structured facts and preferences JobCrush holds about a visitor. It is not
scoped to CV-derived facts only — see rule 5.

## Decision

### 1. Every new kind of fact gets its own shape, designed once

A certification has a name, an issuer, an expiry. A job has a title, an employer, a start and an end.
Each element is designed deliberately. There is **no generic key/value envelope** and no open key
space.

### 2. Adding a new fact never rewrites what is already stored

New facts are stored **beside** existing ones. Nothing already saved changes shape. This is the
no-migration promise, and it is the reason rule 1 is worth its cost.

### 3. Structuring a fact never removes its sentence

If the visitor's CV said it, we keep **their words** and add the record. Both, always. A record is
never a replacement for the prose it was derived from.

This forbids a failure this repo has already had: claim-miner prompt v1 silently skipped an entire
"Additional Skills" block, and the tailored draft lost languages and skills the original CV had (see
the header of `apps/api/prompts/claim-miner.md`). Turning prose into records *instead of* keeping it
is the same failure with a better excuse.

It also keeps [#126](https://github.com/adrien-mounier/jobcrush-app/issues/126)'s detach-not-delete
rule coherent: deleting a job detaches its sentences rather than deleting them, which is only
meaningful if the sentences exist independently in the first place.

### 4. A new element is not released until every reader understands it

Four readers, all four before ship:

1. it can be **stored, listed and corrected**;
2. it is **used in matching**;
3. it **prints** on the tailored CV;
4. it passes the **contract validation** (the frozen `.mjs` oracles).

**Chosen against the recommendation.** The alternative — ship when listable and correctable, let the
rest catch up — was offered and declined. Owner decision, taken with the cost stated below.

### 5. Two categories: facts and preferences

- A **fact** is something an advert could test about the visitor — languages, years of experience,
  right to work, a certification. Facts follow this whole rule.
- A **preference** only narrows which adverts the visitor is shown — target locations, minimum salary.
  Preferences are lighter: **stored, listable, correctable, and nothing else.** No provenance stamp,
  no CV route, no contract validation.

**The sorting test, so this does not become an argument each time:**

> **Could an advert test this about the visitor?** If yes it is a fact. If it only narrows which
> adverts they see, it is a preference.

Worked: *right to work in Singapore* → an advert tests it → **fact**. *Wanting to work in Singapore* →
an advert does not test it, it filters → **preference**. *Speaking Mandarin* → **fact**. *Minimum
salary* → the advert states a salary and the visitor filters on it; it tests nothing about them →
**preference**.

**Known soft edge:** *"remote only"* sits on the line. Called a **preference**. If a future advert
genuinely gates on willingness to relocate, that is a new fact, not a reclassification of this one.

### 6. New advert-side bars are allowed, at a stated price

Adverts can currently gate on five dimensions (`years-experience`, `work-rights`, `language`,
`certification`, `degree`). **That list is open** — a sixth (a security clearance, a driving licence,
visa sponsorship) may be added.

**The price, which is the whole reason this is a decision and not a shrug:** the list is duplicated in
three places (`apps/api/src/eligibility.ts`, `packages/contracts/src/adRequirements.ts`, and the frozen
oracle `packages/contracts/oracle/validate_ad_requirements_v1.mjs`), and every stored advert read in
`ad_requirements` carries the reader version it was read under. Adding a dimension bumps that version,
so **every already-read advert goes stale and must be re-read with a model call, at cost.**

**Re-read policy: lazy.** A stale advert re-reads only when a deck actually needs it. No bulk re-read,
no single large bill; adverts nobody looks at are never paid for.

**Accepted consequence:** for a period after the bump, two adverts on the same deck can disagree about
whether they test the new dimension. Self-heals as decks are browsed.

**Rejected: closing the list.** Cheaper, and it would force the first genuinely new gate to be bodged
into `certification`. That is how a vocabulary rots.

### 7. An unrecognised fact is shown, never acted on

When code meets a stored fact whose kind it does not know — the live case is a rollback across a
dimension addition, where last week's build reads this week's rows:

- **show it**, using the human-readable `label` stored alongside it (the column already exists, so
  this is free);
- **never score on it**;
- **never withdraw a posting because of it.**

This is not a new rule so much as the correct application of an existing one:
[#86](https://github.com/adrien-mounier/jobcrush-app/issues/86) decision 3 — an unknown must never
withdraw a card. An unrecognised fact is an unknown, not a "no".

**The principle underneath it, which generalises:**

> Showing a visitor too many jobs is annoying and recoverable. Hiding a job they could have taken is
> invisible and unrecoverable. When unsure, show too many.

Same shape as [#126](https://github.com/adrien-mounier/jobcrush-app/issues/126)'s *an unreadable
history never lowers a score, but the card says the bar wasn't tested*.

### 8. A rollback never deletes data

Data written by a newer build and not recognised by the running one is **left alone**, never tidied up
as part of reverting. Without this, the safe-by-construction story in rule 7 is false: the answers
survive the rollback only if nobody cleans them out.

Verified safe today for the shared eligibility store: `put`/`remove` operate on a single
`(session, dimension, family)` row, so an older build writing a language answer cannot overwrite or
delete an unrecognised clearance answer. There is no bulk-replace path. **Any future bulk write to a
shared fact table must preserve this.**

## What this rule does NOT cover — read this before assuming it does

**Promoting part of an existing fact into its own kind is a migration, and this rule does not make it
cheap.**

The map set this as the rule's first concrete test: today an employer is held as a *name on the job*
([#126](https://github.com/adrien-mounier/jobcrush-app/issues/126) §1), and *"same employer"* is
recovered by matching that name — which strands a correction when `HSBC` and `HSBC Holdings plc`
appear across two CVs (#126 §8).

Walking that through the rule: rule 1 gives employer its own shape, fine. **Rule 2 does not hold.**
Existing job records hold an employer *name*; making employer an entity means those records must stop
holding a name and start pointing at an entity. That is a rewrite of stored data — precisely the thing
rule 2 promises never happens.

**This is an honest negative result, and it was cheap to find here.** The rule covers *adding a new
kind of fact*. It does not cover *changing the shape of a fact that already exists*. So:

> **Whether a part of a fact deserves to be its own kind must be decided when that fact is first
> shaped. Changing your mind later is a migration, and this rule will not save you.**

Consequence: the employer question cannot be deferred cheaply. It belongs in the v1 element list
([#130](https://github.com/adrien-mounier/jobcrush-app/issues/130)), not in a later round.

## Consequences

**Cost, accepted knowingly.** Rule 4 makes adding an element a multi-session project. The owner's
original requirement was that the model be *flexible enough to evolve*; this rule keeps the
**no-migration** half of that promise in full and gives up the **cheap** half.

**Therefore [#130](https://github.com/adrien-mounier/jobcrush-app/issues/130) — which elements are in
v1 — is the most consequential ticket left on the map.** Anything omitted from v1 is expensive to add
later, and anything mis-shaped in v1 (see the employer case) cannot be fixed without a migration.

**Not decided here:** how a structured record becomes a line of text on a tailored CV. The CV writer
reads claims (sentences) only and cannot see structured facts at all —
[#135](https://github.com/adrien-mounier/jobcrush-app/issues/135) owns that, and rule 4's third reader
is unbuildable until it lands.

**Favourable finding:** the claim graph is **never persisted** — `buildClaimGraph()` rebuilds it from
confirmed claims on each request. Changing its shape therefore costs code in two places (the zod port
and the `.mjs` oracle, per `CLAUDE.md`) and **no stored data**. The oracle-versioning worry in #129's
brief applies to the ad-requirements contract (rule 6), not to the claim graph.

## Alternatives rejected

| Rejected | Why it was attractive | What it cost |
|---|---|---|
| **One generic envelope for all structured facts** | New elements need no design conversation; nearly free to add. | Nothing downstream can interpret a new element, so `expires March 2028` becomes decoration — an expired certification stays on the CV. Cheapest to add, impossible to keep honest. |
| **Thin key/value slots only; refuse anything richer** | Cheapest to maintain; the five-dimension store already exists. | A job (title + employer + start + end) does not fit, so [#126](https://github.com/adrien-mounier/jobcrush-app/issues/126) would have been unimplementable. Already refuted by work done. |
| **Ship an element when listable and correctable** (rule 4) | One session per element instead of several; the CV route can catch up. | Declined by the owner. Would have shipped a typing box that changes nothing the visitor can see. |
| **One rule for facts and preferences alike** (rule 5) | Nothing to sort; no boundary arguments. | Preferences would carry provenance stamps and a CV route they can never use — real work, every time, for nothing. |
| **Closing the advert-side dimension list** (rule 6) | No contract bumps, no re-read bill, ever. | The first genuinely new gate gets bodged into an existing dimension. |

## Verification

The stress test is [#125](https://github.com/adrien-mounier/jobcrush-app/issues/125) — adding a
volunteered language. If applying this rule to it turns into a fresh argument rather than a mechanical
walk, **this ADR is wrong and #129 reopens.** That outcome is a success for the map, not a setback.
