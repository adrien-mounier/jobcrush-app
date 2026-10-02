# ADR-0006 — A project is a container, not a fact

- **Status:** Accepted
- **Date:** 2026-08-06
- **Decided in:** [#146](https://github.com/adrien-mounier/jobcrush-app/issues/146) (owner grilling), under map [#127](https://github.com/adrien-mounier/jobcrush-app/issues/127)
- **Depends on:** [ADR-0001](0001-growth-rule-for-structured-facts.md) (the growth rule), [ADR-0002](0002-how-a-structured-fact-reaches-the-cv.md) (how a fact reaches the page), [ADR-0003](0003-the-shared-parts-organisation-date-level.md) (organisation, date, level), [ADR-0004](0004-each-elements-own-parts.md) (each element's own parts), [#126](https://github.com/adrien-mounier/jobcrush-app/issues/126) (a job is its own record)
- **Evidence:** [`docs/research/personal-projects-on-a-cv.md`](../research/personal-projects-on-a-cv.md), [`docs/research/last30days-personal-projects-on-a-cv.md`](../research/last30days-personal-projects-on-a-cv.md), [`docs/research/projects-umbrella-section-naming.md`](../research/projects-umbrella-section-naming.md), [`docs/research/last30days-projects-umbrella-section-naming.md`](../research/last30days-projects-umbrella-section-naming.md) (all four commissioned mid-decision as [#147](https://github.com/adrien-mounier/jobcrush-app/issues/147) and [#148](https://github.com/adrien-mounier/jobcrush-app/issues/148)), six real CVs in `data/cvs/`, the 17-advert corpus
- **Does not decide:** whether a project done *for an employer* gets a named entry inside the job ([#150](https://github.com/adrien-mounier/jobcrush-app/issues/150)) — **since decided by [ADR-0009](0009-a-work-project-stays-a-bullet.md): it stays a bullet**, and clause 5 below is extended there to cover a **client** as well as a project; what happens to a part of a CV we cannot classify ([#149](https://github.com/adrien-mounier/jobcrush-app/issues/149)); whether an expired or sensitive fact prints ([#144](https://github.com/adrien-mounier/jobcrush-app/issues/144))

## Contents

- [Context](#context)
- [Decision](#decision)
  - [1. The section is `Projects`](#1-the-section-is-projects)
  - [2. A project is a named container, exactly parallel to a job](#2-a-project-is-a-named-container-exactly-parallel-to-a-job)
  - [3. A project's sentences are ordinary claims — there is no new sentence type](#3-a-projects-sentences-are-ordinary-claims-there-is-no-new-sentence-type)
  - [4. The container holds a name and an optional link. It holds no date.](#4-the-container-holds-a-name-and-an-optional-link-it-holds-no-date)
  - [5. A project is never an employment entry](#5-a-project-is-never-an-employment-entry)
  - [6. A project never counts towards years of experience](#6-a-project-never-counts-towards-years-of-experience)
  - [7. The tailor may drop a project; the conservation lint must learn to watch the section](#7-the-tailor-may-drop-a-project-the-conservation-lint-must-learn-to-watch-the-section)
  - [8. 🚨 A link is not a project, and this is the clearest finding in the research](#8-a-link-is-not-a-project-and-this-is-the-clearest-finding-in-the-research)
  - [9. ADR-0001's *used in matching* gate is satisfied by either matching mechanism](#9-adr-0001s-used-in-matching-gate-is-satisfied-by-either-matching-mechanism)
  - [10. The map's destination drops the paper stress test](#10-the-maps-destination-drops-the-paper-stress-test)
- [Consequences](#consequences)
- [Alternatives rejected](#alternatives-rejected)
- [Verification](#verification)

## Context

Map #127 promised the growth rule would be *stress-tested on paper against a second element*. #146 was
that test, with **personal projects** as the subject — a section on a real CV in our own corpus that
the pipeline models nowhere.

**The headline result is two results, and they point in opposite directions.**

1. **The shape is settled and it is small** — smaller than anything else on this map.
2. 🚨 **The stress test missed, for the third consecutive time.** A project is not a new *kind of fact*
   at all, so ADR-0001 was barely exercised. See [Verification](#verification), which is the most
   important section of this ADR.

## Decision

### 1. The section is `Projects`

The word *Personal* is dropped, including from the owner's own CV.

**Evidence.** In-window GitHub repo counts: `resume projects` **2,661** against `"personal projects"`
**25**, `"online presence"` **8**, `"side projects"` **4**. The two apparent rivals were checked and
discarded rather than banked: *portfolio* is measuring personal-website templates (`portfolio website`
alone = 44,670) and *open source* is a licence phrase in all ten top hits. The deep half agrees
independently — `Projects` is the **only** name with multi-source support (HR Open's section codelist,
LinkedIn's profile sections, MIT CAPD, JSON Resume); the alternatives have **zero**, anywhere.

The most-circulated style guide in the space names the owner's exact heading and rejects it:
*"This section should be named Projects, not Academic/Engineering/Notable/**Personal**/Relevant/
Selected/Technical Projects."*
⚠️ **That quote is single-sourced** — #147's half found the same wiki blocked (403, mirrors 404), so it
is *unread, not absent*, there. The repo counts stand alone.

🚨 **`Portfolio` is rejected outright for this market.** It is a defined **PMI** term (a collection of
projects and programmes) *and* a banking term (investments, clients). Under owner decision 8 the section
name is **read aloud** during chunked ingestion — *"today let's do your portfolio"* is ambiguous between
three meanings, two of which are our users' day job. Confirmed independently: in a 248-post
project-management corpus, `portfolio` means a **PMO book of work**.

### 2. A project is a named container, exactly parallel to a job

Three levels, not two:

```
PROFESSIONAL EXPERIENCE                     PROJECTS                                  ← section
  BRED Banque Populaire, Senior PM            Multi-LLM Agent Orchestration Framework ← container
    • Lead end-to-end banking IT projects…      • Designed a personal multi-AI…       ← sentences
```

The container is what lets the product know **which paragraph belongs to which title**, and print three
entries rather than three loose lines. Without it, three sentences arrive with no way to group them.

### 3. A project's sentences are ordinary claims — there is no new sentence type

A project bullet has the **same shape as a job bullet**: the person's words kept unchanged, plus where
it came from, how much the machine touched it, and how well evidenced it is.

**This is the whole reason this element is cheap.** ADR-0001 rule 3 (*structuring a fact never removes
its sentence*) is **already satisfied before any work is done** — the miner's rule 8 (*every section of
the CV must be mined*) already turns the three project paragraphs into claims.

### 4. The container holds a name and an optional link. It holds no date.

| Part | Status |
|---|---|
| **Name** | required |
| **Link** | optional |
| **Date** | **not held** — if the person wrote one it stays inside their sentence, as their words |

**Evidence.** The live product at **40,041★** ships a project item that is name + free-text period +
optional link + one description — and it is **the only element type in that entire schema with a
required name and no organisation slot**, every other dated item having one. Its own sample writes all
three projects as a **single prose paragraph, no bullets**, and one entry ships with an **empty link**.
That is Adrien's CV, near-identically.

🚨 **The richer project model is the dead one.** Archived JSON Resume defined `entity`, `roles[]`,
`keywords[]`, ISO-8601 dates, separate `highlights[]` and `type`; the live product collapsed all of it
to free text. **Building fields moves against the direction of travel.**

**The link is a field of the project**, not a member of a links section — `resume-lm` puts `github_url`
on the résumé *and* on the project, same URL, two meanings. (The *other* kind of link — a GitHub profile
or personal site — is contact detail, see clause 8.)

**Accepted cost, named:** a skill demonstrated **only** in a project never gets a *last used*. ADR-0004
computes skill recency from where a skill appeared in a **dated** work history, and a project supplies
no date to compute from.

**Rejected: an optional date field.** #130's *capture the maximum* pulls toward it. It was declined
because none of the six CVs' standalone project entries carries a date (**0 of 3**), pulling a date out
of prose is exactly where the machine invents precision (#128 §1 — `2022–2024` is easy, a bare `2022` or
*"last year"* is not), and each field costs a full pass of rule 4's four gates.
⚠️ **This is not free to revisit.** Adding the date later rewrites nothing, so it is **not** a migration
in ADR-0001's sense — but it still costs a full round of the four gates.

### 5. A project is never an employment entry

The container must not reach the miner's `roles[]` array or the Draft's `experience` block.

**The failure it prevents:** `Multi-LLM Agent Orchestration Framework` printing as an **employer the
person never worked for**. That is owner decision 9's one clause that is not a guardrail — *the machine
never adds silently; the human owns every stretch* — and it is #138's observed real-parser failure
(*"normalizing to a title or skill the candidate never claimed"*), not a hypothetical.

### 6. A project never counts towards years of experience

It is not paid work. **The mechanism already exists**: #126 marks every dated block ***is this work?***,
correctably — the same switch that keeps a degree out of the count.

This is #148's discriminator, adopted: *"A Projects section is for unpaid personal and school projects.
An Experience section is for paid work."* **Paid vs unpaid, not employer-vs-none** — which is also why
clause 5 matters, since an employer-less thing that inflated a career total would be invisible harm.

### 7. The tailor may drop a project; the conservation lint must learn to watch the section

A project is **selectable, like a job bullet** — the tailor already picks which bullets survive, and a
project irrelevant to an advert should be allowed to go, because CV length is a constraint this product
already enforces.

🚨 **But nothing currently watches.** `conservationIssues()` checks certifications, languages and the
most-recent-role bullet floor. **Projects are invisible to it** — all three could vanish from a tailored
CV and nothing would say a word. The lint must gain a projects check, the same shape as the existing
recent-role bullet floor: *dropped one* is allowed, *dropped everything* is not silent.

### 8. 🚨 A link is not a project, and this is the clearest finding in the research

Every system that models both puts them in **structurally different places**, with **no dissent in any
source**. Five shipping tools were read at source level (reactive-resume 40,041★, rendercv 17,283★,
yamlresume 1,488★, resume-lm, ats-screener) and **all five split them**.

The cleanest proof: in JSON Resume both live in one file and the author had to choose — `projects` is a
**top-level section**, `profiles` sits **inside `basics`**, next to email and phone. `rendercv`'s own
docstring calls a personal website a *"contact method… contact channel"*. And `ats-screener` — which
simulates Workday, Taleo, iCIMS, Greenhouse, Lever and SuccessFactors — returns GitHub and website **in
the same object as the phone number**.

**So a GitHub profile, a personal website and a portfolio URL are contact detail, not projects.**
`Portfolio` is not a section anywhere — it is a **URL *type***, and Greenhouse's candidate object and
LinkedIn's website dropdown independently converged on nearly the same enum
(`personal / company / portfolio / blog / other`).

⚠️ **Not shaped here.** The contact-detail kind has **no name in any surveyed system** because nobody
makes it a section, and this ADR does not invent one. It is recorded so a future session does not
re-derive the split.

### 9. ADR-0001's *used in matching* gate is satisfied by either matching mechanism

**This product has two, and #146 spent two rounds arguing from only one.**

| Mechanism | What it does | Reached by a project? |
|---|---|---|
| **Eligibility gates** (`years-experience`, `work-rights`, `language`, `certification`, `degree`) | Hard bars that **withdraw** a posting | **No** — 0 of 17 adverts mention projects; no ATS anywhere filters on them |
| **The judged score** (`judge.ts` + `prompts/card-judge.md`) | An LLM grades **each advert requirement** against the candidate's **confirmed sentences**, 0–1 | ✅ **Yes, already, today** |

`judgeFacts()` receives `deps.claims.confirmed(session.id)`, and `card-judge.md`'s headline rule is
***"the candidate's own phrasing counts"*** — its worked example scores a full meaning-match at **zero
shared words**. Since project paragraphs are already mined as claims (clause 3), **a project already
reaches the grader**.

**Therefore rule 4's second gate is met with no new machinery**, and future elements must check **both**
mechanisms before concluding they cannot match.

### 10. The map's destination drops the paper stress test

Map #127's destination promised the growth rule would be *"stress-tested on paper against a second
element"*. **That promise is retired.** See [Verification](#verification) for the three misses that are
its stated reason. The test transfers to **the first element added after build**.

## Consequences

**The honest cost of shipping projects: one small container, one new CV section, one contract change.**
Rule 4's four gates, walked one at a time for the first time on this map:

| Gate | Status |
|---|---|
| Stored, listed, corrected | **Small** — the sentences are already stored; the new part is a name and a link |
| Used in matching | ✅ **Already met** (clause 9) — nothing to build |
| Prints on the tailored CV | **Real work** — `Draft`'s sections are a closed list and `Projects` is not one; `experience` requires an `employer` |
| Passes contract validation | **Bounded** — the zod port **and** the `.mjs` oracle, per the repo rule that the oracle is the spec |

⚠️ **This contradicts ADR-0001's own stated cost.** That ADR records rule 4 as making adding an element
*"a multi-session project"*, and that sentence is **load-bearing** — it is the reason #130 was called the
most consequential ticket on the map. Projects cost roughly **one** session. **The cost is per-element,
and ADR-0001 states it as universal.** See the scope note below.

**Two scope notes on ADR-0001 — footnotes, not amendments**, following the precedent ADR-0004 set for
ADR-0003 clause 8:

1. **Rule 5 sorts *facts* from *preferences*. A container is neither**, and does not go through the
   sorting test. The rule quietly assumes every new thing is one of its two kinds; some new things are
   organisational rather than factual. ⚠️ **This is a genuine hole, and it is smaller and more boring
   than the one #146 spent two rounds hunting.**
2. **Rule 4's *multi-session project* cost is per-element, not universal.** Projects are cheap because
   matching came free; another element may not be.

**Not decided here, and now unblocked:** [#150](https://github.com/adrien-mounier/jobcrush-app/issues/150)
(a project done for an employer — named entry inside the job, or just a bullet?), which is the **more
common shape by ~7:1** in our own corpus and was conflated with this one until the owner separated them.

⚠️ **Since decided by [ADR-0009](0009-a-work-project-stays-a-bullet.md): it stays a bullet, and nothing is
built.** 🚨 **The ~7:1 in that sentence does not mean what it looks like** — ~18 of the ~22 nested mentions
are **one CV from another market** (façade engineering), and across the five CVs in banking / IT-PM the
count of named project sub-entries is **zero**. ADR-0009 clause 3 carries the recount.

**Live consequences:**
- **A project sentence has nowhere to say it belongs.** A claim's `role` is *"which employment/education
  block this belongs to, or `profile`"* (miner rule 6). A project is none of those, so the reader must
  guess — and the dangerous guess is `roles[]`, which is exactly clause 5's failure. **The minimum build
  item is extending that existing slot to name a project, not adding a new element.**
- **The miner prompt gains a projects instruction**, and it must be written so a project can never be
  emitted as a role.
- **`conservationIssues()` gains a projects check** (clause 7), and it needs the **negative test**
  ADR-0004 clause 1 already demands — a check that cannot tell *found nothing* from *did not run* is the
  failure `career-ops` shipped three times in one month.
- **Nothing screens on projects anywhere**, so this element earns its place through the judged score and
  the printed page alone. In a 248-post project-management corpus `"projects section"` appears **0**
  times, and banking produced **one** question in 30 days at 1 upvote. ⚠️ **People in our market write
  projects on their CVs and never discuss them** — our own corpus proves the practice, so absence of
  discourse is not absence of the practice. **Capture cheaply; do not invest further.**

## Alternatives rejected

| Rejected | Why it was attractive | What it cost |
|---|---|---|
| **A project is a *fact*** (clause 2) | Keeps ADR-0001's two categories intact; nothing reopens. | It is not a fact — it is a place to put sentences. Forcing it through rule 5 produced two rounds of argument and no answer. |
| **A project is a *preference*** | The only other category the rule offers. | Preferences get **no CV route at all** (rule 5). A project that can never print is pointless, and a project filters nothing. |
| **A project is a third kind of *fact*, "evidence"** | The session's own recommendation for two rounds. | The research weakened its mechanism — project-as-mention-site is **one vendor** (RChilli), while Textkernel anchors skills to **jobs and degrees only**. And the category was unnecessary once clause 3 was seen. |
| **A project is *part of a job*** | 7:1 in our corpus; no new element at all. | **Incoherent for a personal project, by definition** — it has no employer. The owner caught the session conflating two different things. It is the right answer for the *other* thing, now [#150](https://github.com/adrien-mounier/jobcrush-app/issues/150). |
| **A flat list of sentences under a `Projects` heading** (clause 2) | No container to design at all. | Three sentences arrive with no way to know which title goes with which paragraph, or that they belong together. Cannot print three entries. |
| **An optional date on the container** (clause 4) | #130's *capture the maximum*; it would give a project-only skill a *last used*. | 0 of 3 standalone entries carry one; extracting a date from prose is #128 §1's forbidden invention of precision; and each field costs a full pass of rule 4. |
| **Projects always print in full** (clause 7) | Nothing can ever be silently lost. | On an advert where they are irrelevant they take space from something that matters, and CV length is already an enforced constraint. |
| **Keep trying to stress-test ADR-0001 on paper** (clause 10) | The map promised it, and shipping an untested rule is the risk the map exists to reduce. | Three misses, and **no candidate remains** — everything genuinely a *fact* is already an element, and awards/publications/volunteering are containers like projects. Continuing is ritual, not testing. |

## Verification

🚨 **This ADR is the record of a test that did not run, for the third consecutive time. That is its most
important content.**

Map #127's destination promised the growth rule would be *stress-tested on paper against a second
element*. Three attempts:

| Attempt | Why it missed |
|---|---|
| [#125](https://github.com/adrien-mounier/jobcrush-app/issues/125) — a volunteered language | **The same element with a different origin.** Adding a *level* to an existing element is changing a shape, which ADR-0001 explicitly does not cover. |
| [#140](https://github.com/adrien-mounier/jobcrush-app/issues/140) — each element's own parts | **A mechanical application of ADR-0003**, not ADR-0001. All five elements were already on the v1 list. |
| [#146](https://github.com/adrien-mounier/jobcrush-app/issues/146) — personal projects | **Not a new kind of fact at all** — a container for sentences the product already holds. Rule 3 was satisfied before work began; rule 4's hardest gate was already met. |

**ADR-0004 predicted this and was overruled.** Its own Verification section concluded the test *"should
be claimed by the first element added after build — not by anything on map #127."* #146 was created
against that advice and missed the same way.

**The retirement is therefore evidence-based, not convenience:** everything that is genuinely a *fact* is
already an element, and every remaining candidate (awards, publications, volunteering, patents) is the
same class as projects — a container. **There is nothing left on paper to test the rule with.**

**The test transfers to the first element added after build**, where it will be a live test rather than
a paper one — which ADR-0001's own employer case already showed is where the rule gives real answers.

**What #146 did deliver, so the miss is not read as failure:** the shape above · the **fifth premise
correction** on this map (clause 9's matching mechanism, which would have bitten a build ticket) · the
first real cost number for rule 4 · and two spun-out tickets
([#149](https://github.com/adrien-mounier/jobcrush-app/issues/149),
[#150](https://github.com/adrien-mounier/jobcrush-app/issues/150)).
