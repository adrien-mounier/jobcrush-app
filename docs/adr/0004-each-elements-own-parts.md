# ADR-0004 — Each element's own parts: work history, education, skills, certifications, languages

- **Status:** Accepted
- **Date:** 2026-08-06
- **Decided in:** [#140](https://github.com/adrien-mounier/jobcrush-app/issues/140) (owner grilling), under map [#127](https://github.com/adrien-mounier/jobcrush-app/issues/127)
- **Depends on:** [ADR-0001](0001-growth-rule-for-structured-facts.md) (the growth rule), [ADR-0002](0002-how-a-structured-fact-reaches-the-cv.md) (how a fact reaches the page), [ADR-0003](0003-the-shared-parts-organisation-date-level.md) (organisation, date, level), [#126](https://github.com/adrien-mounier/jobcrush-app/issues/126) (a job is its own record), [#128](https://github.com/adrien-mounier/jobcrush-app/issues/128) (where a fact comes from), [#125](https://github.com/adrien-mounier/jobcrush-app/issues/125) (a language has a level), [#130](https://github.com/adrien-mounier/jobcrush-app/issues/130) (every element is in)
- **Evidence:** [`docs/research/skill-shape-granularity-normalisation-levels.md`](../research/skill-shape-granularity-normalisation-levels.md) and [`docs/research/last30days-skill-shape.md`](../research/last30days-skill-shape.md) (both commissioned mid-decision as [#145](https://github.com/adrien-mounier/jobcrush-app/issues/145)), [`docs/research/cv-elements-existing-data-standards.md`](../research/cv-elements-existing-data-standards.md), [`docs/research/cv-elements-what-cvs-contain-and-what-employers-screen.md`](../research/cv-elements-what-cvs-contain-and-what-employers-screen.md), six real CVs in `data/cvs/`
- **Does not decide:** whether a fact that must not print exists at all ([#144](https://github.com/adrien-mounier/jobcrush-app/issues/144)); how a stretch is scoped to one advert ([#141](https://github.com/adrien-mounier/jobcrush-app/issues/141)); how a coarse date is written on the page ([#143](https://github.com/adrien-mounier/jobcrush-app/issues/143))

## Contents

- [Context](#context)
- [Decision](#decision)
  - [1. A skill is one record with two labels, and it must show its working](#1-a-skill-is-one-record-with-two-labels-and-it-must-show-its-working)
  - [1a. 🚨 Every structured fact points at its origin, and "nowhere" is a defect](#1a-every-structured-fact-points-at-its-origin-and-nowhere-is-a-defect)
  - [2. Skills carry no self-assessed level, and we never ask for one](#2-skills-carry-no-self-assessed-level-and-we-never-ask-for-one)
  - [3. Do not target an external skills taxonomy](#3-do-not-target-an-external-skills-taxonomy)
  - [4. ADR-0003 clause 8's ladder holds; its *trigger* does not scale](#4-adr-0003-clause-8s-ladder-holds-its-trigger-does-not-scale)
  - [5. A certification carries its validity, in three states, confirmed by the person](#5-a-certification-carries-its-validity-in-three-states-confirmed-by-the-person)
  - [6. An education entry with no qualification is kept, and never compared](#6-an-education-entry-with-no-qualification-is-kept-and-never-compared)
  - [7. A job carries where it happened](#7-a-job-carries-where-it-happened)
  - [8. A stated language level is stored verbatim and confirmed, never mapped](#8-a-stated-language-level-is-stored-verbatim-and-confirmed-never-mapped)
  - [9. No jobs and an unreadable CV are different states](#9-no-jobs-and-an-unreadable-cv-are-different-states)
  - [10. The reader mines the Skills list; a tool inside a bullet is *proposed*, and the person owns the list](#10-the-reader-mines-the-skills-list-a-tool-inside-a-bullet-is-proposed-and-the-person-owns-the-list)
- [Corrections to what this repo previously believed](#corrections-to-what-this-repo-previously-believed)
- [Consequences](#consequences)
- [Alternatives rejected](#alternatives-rejected)
- [Verification](#verification)

## Context

ADR-0003 answered the parts every element shares. This ADR answers what each element holds on its
own — the last shaping decision on map #127 before build tickets.

**The headline result: it was a mechanical walk, and that was the test.** ADR-0003's own verification
clause said that if shaping education or certifications became *"a fresh argument about what an
organisation or a date is"*, ADR-0003 was wrong and #139 reopened. It did not. Education needed **no
new decisions at all**. One pattern — *store what the person typed, always; add a resolved value only
when someone who genuinely knows can supply it* — covered organisations (ADR-0003), and then skills,
places and levels here, without being stretched.

**Two of this ticket's own premises were wrong, and finding that out was most of the early value.**
Both are corrected below: certifications are not a live job-deleting bug, and skills are much smaller
than the map feared.

## Decision

### 1. A skill is one record with two labels, and it must show its working

A skill record holds **the term as the person wrote it** and **a normalised term**, which is simply
**empty when nothing matched**. This is ADR-0003 clause 2's organisation pattern, reused: a failed
match loses nothing.

**This is not two records.** The verbatim *line* was never a skill — it is the sentence, which
ADR-0001 rule 3 already keeps. The cost #140 originally attributed to this option (*"every skill
exists twice; every screen must know which to show"*) was an artefact of framing and does not exist.

**Every normalised skill must point at where it came from** — see clause 1a, which generalises this
beyond skills.

**Evidence:** Textkernel's live Skills API returns confidence (0–1), a tunable threshold (default
0.5), and a `Matches` array with start/end positions. Alibaba's HR platform (240–300 résumés/minute)
runs the blunt form: discard any extracted record whose fields cannot be found in the source text.

⚠️ **And the warning attached to it, which is not optional.** `santifer/career-ops`' anti-fabrication
gate failed **three separate times in the 30 days before this decision** — once failing truthful CVs,
once missing from 16 of 18 localized prompt files, once completely inert in five locales. Their words:
*"it says `pass`, which is worse than saying nothing: it manufactures confidence."*
**An origin check that finds nothing must be distinguishable from one that did not run.**

### 1a. 🚨 Every structured fact points at its origin, and "nowhere" is a defect

> **AMENDED 2026-08-06, same day, by the owner.** This clause was first written as *"every normalised
> skill carries the exact span of the **document** that produced it"* — **scoped to skills, and to
> documents.** The owner caught both errors in one observation: *a skill can be present in your profile
> and point at an answer you gave during the grill, then be reused in a tailored CV for a specific
> advert* — and *this logic shouldn't be applicable only for skills, experience too.* The narrow
> wording would have **flagged the visitor's own answer as a defect**, and it fails outright under owner
> decision 6, where most facts eventually arrive **from the person, not from a parsed file.** The
> generalised clause below is the binding one.

**Every structured fact this product holds must point at its origin. A fact that points at nothing
cannot exist, and is a *defect* — not a low-confidence result.**

This applies to **every element**, not skills alone: a job, a title, a date, a degree, a certification,
a language level, a location. Wherever the machine writes something down, it records what produced it.

**The legitimate origins are the ones already decided** (#128's three, plus decision 9's fourth), and
this clause adds only what each must point *at*:

| Origin | Points at | Notes |
|---|---|---|
| **Machine-read** | the **exact source words** in the uploaded document | The strong form. A read term no source words produced is the failure #138 observed in real parsers. |
| **The person said it** | the **answer**, and the question that prompted it | The owner's case. Substance is the visitor's, so ADR-0002 clause 1 lets it be written up into a real CV line. |
| **The person corrected it** | the **superseded value** it replaced | ADR-0003 clause 7 — a correction supersedes, never replaces, so the thing it corrected is still there to point at. |
| **Proposed and approved** | the **proposal**, its evidence grade, and its **interview narrative** | Decision 9's fourth state. The enrichment contract already makes a narrative-less proposal invalid. |
| **Computed** | the **facts it was derived from** | #128 §4 — a derived value is a regenerable copy, never a second source of truth, so its origin is the facts underneath. |

**Why this is the most consequential clause in this ADR.** It converts owner decision 9's core clause —
*the machine never adds silently; the human owns every stretch* — from a promise into a **mechanical
test**, checkable in code the way `conservationIssues()` is. #138 observed real parsers *"normalizing
to a title or skill the candidate never claimed"*; requiring an origin makes that **detectable** rather
than merely forbidden.

**And it draws the line #141 needs.** Origin decides whether a fact may be **reused across adverts**:

- A fact the person **stated, corrected, or that we read from their CV** is theirs, permanently, and
  belongs on every tailored CV where it helps. **The owner's grill-answered skill is this case** — it is
  a real fact about them, so reusing it for a specific advert is correct behaviour, not a leak.
- A **proposed-and-approved stretch** was made for one advert and carries that advert's scope. Reusing
  it elsewhere is the leak [#141](https://github.com/adrien-mounier/jobcrush-app/issues/141) exists to
  stop.

**So the answer to *"can this appear on this CV?"* is a property of the fact's origin, not of the
element it belongs to** — which is ADR-0002's own axis (*provenance decides the route; the page does
not*) applied one level further.

⚠️ **Not yet built.** This is a decided shape, not running code. Nothing checks origins today, and the
map ends at build tickets. A future session must not assume the check exists.

### 2. Skills carry no self-assessed level, and we never ask for one

A level is recorded **only if the CV already states one**. We never ask a person to rate themselves on
a skill.

- No system surveyed collects self-assessed proficiency across 40+ skills.
- Zell & Krizan 2014 (22 meta-analyses, >330,000 people): self-rated ability against measured
  performance correlates at **r = .29**.
- LinkedIn ran the objective alternative — Skill Assessments — for four years and **retired it in
  2024**.
- `career-ops` puts *"proficiency / fluency / expertise"* on a **stoplist as noise**.

*(Deliberately not argued from Dunning-Kruger, which is contested as largely a statistical artefact.
Zell & Krizan says what is needed without it.)*

### 3. Do not target an external skills taxonomy

Normalisation resolves against **our own vocabulary**, not ESCO / O*NET / Lightcast.

- Mention-level ESCO linking is **23.55% top-1** (Zhang et al., EACL 2024 Findings, 1,824
  human-annotated mentions) — materially worse than #138's F1@5 = 0.72 implied.
- GitHub, in the 30 days before this decision: **4,046** repos pushed matching `resume ATS`, **1,179**
  matching `resume parser` — against **11** for `ESCO skills`, 9 for `O*NET`, **1** for `Lightcast`.
- #137 already established that Greenhouse, Lever and iCIMS hold **no structured skill object at all**.

**So our skills only ever need to be comparable to our own adverts.** Both large live projects use a
~90-token hand-curated vocabulary and explicitly refuse umbrella aliases — *"cloud"* must never count
as knowing AWS, because *"a generous map silently suppresses real gaps."*

⚠️ **The two duplication problems in a real CV are not the same problem.** `JS` / `JavaScript` /
`Javascript`, and five spellings of `C#`, are an **alias lookup** — a dictionary, no model, no
silent-upgrade risk. Prose like *"Responsible AI usage in regulated environments (data sensitivity,
tool selection)"* is the risky half, and the right answer there is **not to atomise it at all**.
`career-ops` names the failure: **"tool-of-trade conflation (user uses X → user built X)"**, its top
guardrail and *the most common fabrication pattern*. Atomising `(C#, XrmToolBox, Git)` is precisely
the operation that strips the verb.

> ⚠️ **Refined 2026-08-13 ([#211](https://github.com/adrien-mounier/jobcrush-app/issues/211)).**
> *"Not to atomise it at all"* binds the **bullet**, and only the bullet. The sentence is never
> replaced by its terms, never loses its verb, and remains the record. Clause 10 additionally allows a
> tool name found inside that sentence to be **proposed as a separate skill record beside it** — the
> bullet survives untouched, so nothing this note warns about occurs. The alias-lookup half of this
> note is now binding rather than illustrative: spelling merges are a dictionary, never a model.

### 4. ADR-0003 clause 8's ladder holds; its *trigger* does not scale

The ladder's **shape** is unchanged and correct. What breaks is **when we ask**:

| Element | Items per person | Ask-once cost | Verdict |
|---|---|---|---|
| Languages | ~4 | 4 questions, ever | **Ask** (#125) |
| Degree level | ~1 | 1 question, ever | **Ask** (#130) |
| Certifications | 0–5 (Remy: 5) | ≤5 questions, ever | **Ask** (clause 6) |
| Skills | ~45 (Remy: ~45, Adrien: ~50) | **45 questions** | **Never ask** (clause 2) |

**Volume is the whole discriminator.** *Asked once each* is unremarkable at four items and
unaffordable at forty-five. This is recorded as a **footnote on ADR-0003, not an amendment**: clause 8
is asked-once for languages, degrees and certifications, and never-asked for skills.

**This is ADR-0003 creaking exactly where clause 8 predicted it would**, and it is the **trigger**,
not the shape. **ADR-0001 (the growth rule) is not implicated and does not reopen.**

### 5. A certification carries its validity, in three states, confirmed by the person

A certification holds **name + issuer (an organisation, ADR-0003 clauses 1–4) + award date (a moment,
clause 5) + validity**, where validity is ADR-0003 clause 6's three states in different words:

| State | Meaning |
|---|---|
| **Still valid** | held today |
| **Expired, we know when** | lapsed on a known date |
| **Expired, we do not know when** | lapsed, date unknown |

**We ask *"do you still hold this?"* — which people can answer — and never *"when does it expire?"*,
which nobody remembers.** The person confirms; the machine never decides it.

**The case that forces it.** Remy's CV reads `PL 300 – POWER BI DATA ANALYST ASSOCIATE, Feb 2023`.
PL-300 is a Microsoft *associate* certification and expires annually; three of his other four
(AZ-900, DP-900, MB-910) are *fundamentals* and never expire. He has either renewed it three times or
it lapsed in early 2024, and **his CV reads identically in both cases.** ADR-0001's own rejected-
alternatives table already named this failure — *"`expires March 2028` becomes decoration — an expired
certification stays on the CV"* — and nothing had been shaped to prevent it.

Clause 6's reasoning transfers without modification: *"Present" is the one word that goes stale by
itself.* A certification with blank validity silently reads as *currently held*, forever. That is the
same silent inflation clause 6 refuses for jobs.

**Rejected: computing expiry from the certification's name.** We know PL-300 is annual. Deriving it
would be #128 §1's forbidden invention of precision, and wrong for everyone who renewed.

### 6. An education entry with no qualification is kept, and never compared

Education needed **no new decisions**. School = ADR-0003 clauses 1–4. Dates = clauses 5–6. *"Is a
Licence a bachelor's?"* = #130's ask-once, on clause 8's ladder. Grade = clause 8(b), verbatim, never
compared.

The one judgement call: an entry may carry **no qualification at all**. Adrien's own CV:

```
KMUTT University, Bangkok, Thailand     2016
Exchange Semester
```

School and year, and nothing that is a degree. Kulpakorn's Queensland year is the same shape.

**Such an entry is stored, shown, printed, and never compared** — it cannot satisfy a degree bar
because it never claimed to be a degree. This is #130's *capture the maximum, compare where we can*
applied per entry, exactly as that decision specified.

**It stays its own entry and is never folded into the neighbouring degree.** That is how the person
wrote it, and merging would be the machine deciding their history had a different shape than they
stated. ADR-0003 clause 10 already established that the overlap itself is normal and never flagged.

### 7. A job carries where it happened

A job holds **the location as written, always** — `Singapore`, `Paris, France`, `Bangkok, Thailand` —
**plus a resolved country when one can be matched.** The organisation pattern, third use.

**The case:** Remy worked at **Amundi Asset Management / Singapore** (2023–2025) then **Amundi Asset
Management / Paris, France** (2025–present). Same employer, two countries. #126 already gives two rows;
nothing held *where*.

**Why it earns its place:** we sell into Hong Kong and Singapore, where *"has this person actually
worked here"* separates a local hire from one needing relocation and possibly sponsorship. Location is
also the one part of a work entry that **every standard surveyed agrees on** (#138 §2.1) and that no
decision on this map had covered.

**Why it had to be decided now:** ADR-0001 is explicit that whether a part of a fact deserves its own
kind must be settled when the fact is first shaped. #126's job record still does not exist, so this
was free; a month later it is a migration.

**Country granularity is deliberate and sufficient.** Singapore and Hong Kong are countries in this
sense, so our actual market gets city precision without anyone owning a cities database.

**[#124](https://github.com/adrien-mounier/jobcrush-app/issues/124) (target locations) inherits this
shape** rather than re-deriving one, per map #127's note that it sits outside this effort but should be
governed by it.

### 8. A stated language level is stored verbatim and confirmed, never mapped

The CV's own word is **stored exactly as written and never mapped to a rung by the machine**. When an
advert tests that language, the person is asked **using their own word**: *"Your CV says Fluent. This
job needs you to run client meetings in English — does that fit?"*

**The evidence that mapping is not safe:** four CVs use **nine different words** — `Native`, `Fluent`,
`Conversational`, `Beginner`, `Proficient`, `Basic`, `Professional working proficiency`, plus lowercase
variants. Adrien writes `English (Fluent)`; Remy writes `English (Proficient)`. Nothing establishes
those are the same rung.

**This reconciles two rules that pointed opposite ways** rather than trading one off:

- #125: *the machine never settles her level alone.* Mapping `Fluent` to a rung violates it.
- #130 decision 7 and #137: **people resent answering twice far more than answering** — the market's
  loudest complaint is *"upload your resume, fix the parsing, then recreate the same information on 37
  subsequent fields."* Ignoring a stated `Fluent` and asking anyway is exactly that.

Storing the word and confirming it is **not asking twice** — it is confirming once, triggered by a real
advert that explains why it cares, which was #125's own requirement.

### 9. No jobs and an unreadable CV are different states

| What happened | Years of experience | Behaviour |
|---|---|---|
| Document read successfully, other content extracted, **no employment entries** | **Zero — a fact** | Compared normally; correctable |
| Document **failed to convert** or yielded almost nothing | **Unknown** | Never lowers a score; the card says the bar was not tested (#126) |

**The discriminator is whether the document parsed and produced other content, not whether jobs were
found in it.** A CV yielding a name, a school and twenty skills but zero jobs is stating something
true. A CV yielding almost nothing is reporting our own failure.

**Why this is not an edge case.** Europass/Cedefop, n=353,518: **12% of real CVs have no work
experience at all** (#137). Students, career changers, returners. And ~30% of parsing failures happen
before the model sees anything — scanned PDFs, two-column layouts, table-based documents, all present
in our own fixtures.

**The two harms are asymmetric and point in opposite directions,** which is why one rule cannot serve
both:

- Calling a genuine zero *unknown* fills a graduate's deck with roles wanting ten years. They conclude
  the product does not work for them. **Annoying, visible, recoverable.**
- Calling a failed read *zero* silently strips every senior posting from a nine-year project manager's
  deck. **Invisible and unrecoverable** — the exact harm ADR-0001 rule 7 exists to prevent, and the
  reason #126's AC5 was flagged as unmeetable as written.

**This closes #126's AC5.** It was recorded as *"will not be met as written"*; the resolution is that
the criterion conflated two states, and separating them satisfies its intent.

### 10. The reader mines the Skills list; a tool inside a bullet is *proposed*, and the person owns the list

*Added 2026-08-13, [#211](https://github.com/adrien-mounier/jobcrush-app/issues/211) (owner
grilling). Depends on [ADR-0013](0013-the-master-cv-improves-on-the-document-it-came-from.md), which
is the requirement this clause serves.*

**The defect this closes:** nothing decided how many records `(C#, XrmToolBox, Git)` becomes. The
reader therefore decided afresh on every run, and the same CV (`Resume_Remy_IM_IT.pdf`) yielded **17
skill records on one read and 44 on the next** — a 2.6× swing on an unchanged document
(`docs/research/structured-read-cost.md`). The instruction it was following is not disobeyed, it is
*permissive*: `claim-miner.md` rule 8 says one claim per group **is fine**, which licenses both
answers.

**a. The read is narrow, and its boundary is a fact about the page.** Skill records come from the
CV's skills inventory: one record per delimiter-separated item under a skills heading. **Job bullets
yield no skill records at the read.** "Which section is this text in" is a property of the document;
every judgement we ask the reader to make fresh is a thing that moves between runs, and movement is
the defect being removed.

**b. A tool named inside a job bullet is proposed as a skill, not read as one.** The model reads the
confirmed bullets and proposes the tool names in them. **Every proposal must be an exact string
already present in the CV** — the mechanical guard against invention, and the only guard that does
not itself require a judgement. The bullet is untouched and remains the record (clause 3's note).

Rejecting the alternative matters more than choosing this one: a hand-curated vocabulary is
deterministic and would end the swing outright, and both large live projects ship one (~90 terms,
`last30days-skill-shape.md`). It fails on the long tail that real CVs are made of. Remy's CV names
**`XrmToolBox`**. No ninety-term list contains `XrmToolBox`, and its absence would be **silent** —
the person cannot see a skill that was never offered. A visible list the person prunes beats an
invisible list he cannot audit.

**c. The proposals arrive selected, as one screen, at ingestion.** The person removes what he does
not want. This is not a silent add — *"the machine never adds silently"* forbids the invisible, not
the pre-filled, and the screen is the visibility. Arriving **unselected** would mean a person who
closes the screen keeps a master CV no better than his upload, which is ADR-0013's whole prohibition.
Batched items cost nothing against `claim-miner.md` rule 9's ≤15 individual decisions, so one screen
of ~26 items is affordable at ingestion — and ingestion is the right moment, because a later offer
means the **first** master CV he ever sees is the weak one.

**d. What the person keeps is a permanent record, and this — not the read — is what ends the swing.**
An accepted skill becomes a user-resolved fact. The CV is read once; the person prunes once; the set
is then his. A second read cannot revise it. The profile screen, the master CV
(`apps/api/src/rootcv.ts`) and every tailored draft read that one list, so the three surfaces cannot
disagree.

**e. Spelling merges are a dictionary. Never a model.** `JS` / `JavaScript` / `Javascript`, and the
five spellings of `C#`, resolve by alias lookup (clause 3's note). The printed form is the person's
own spelling.

**What this costs, stated plainly.** The read still moves between runs — clause b is a model
judgement, and a hand-curated vocabulary was the only candidate that removed it. Clause d makes the
movement survivable rather than absent: it happens once, in front of a person, who closes it. **So
the measure changes with the rule.** #211's own acceptance criterion asked for the same *count* on
two reads; under ADR-0013 a low count is the defect and a high one is not. The number to measure is
**coverage** — how many tools written anywhere on the CV reach the Skills section — and it is measured
by adding skills to #202's answer key, which excluded them precisely because this clause did not
exist.

**Amends [#164](https://github.com/adrien-mounier/jobcrush-app/issues/164) in part**, and the ticket
records it: its *"the model merges near-duplicate spellings"* becomes clause e's dictionary; its
prose-mining stays with the model but moves from the read to clause b's guarded proposal. #164
remains the build ticket for all of clause 10.

**Does not decide** the person whose CV names no tools at all, and therefore yields nothing for
clause b to propose — a different source, no possible guard, and the opposite default. That is
[#213](https://github.com/adrien-mounier/jobcrush-app/issues/213), blocked by #134. Nor the group
labels the Skills section prints under (#164).

## Corrections to what this repo previously believed

**🚨 `certification` is NOT a live job-deleting bug, and three documents say it is.** #140's body,
ADR-0003's consequences, and map #127 all describe it as *"a hard gate with no guest list… the same
half-wired shape that produced #125's live job-deleting bug."* The code says otherwise:

- `withdrawal.ts:82` — `if (dimension === "certification") return false;` — unconditional. **No
  certification fact can ever withdraw a posting**, by design, with a comment recording it as
  deliberate (*"wired through on purpose (D3) … dead in practice, not silently absent from the
  switch"*).
- `eligibilityDiscovery.ts:128` — `ASK_DIMENSIONS` excludes `certification`. Nothing ever asks.

#125's language bug was live because `isExplicitNo("language", "none")` returns **true** *and* an
unticked box wrote `none`. Certification has neither half. The true statement is milder: **a door with
no guest list, and the bouncer instructed to wave everyone through.** Safe by construction, not
half-wired.

**Skills is smaller than the map feared, not larger.** #140 and ADR-0003 both expected skills to be
where the growth rule was genuinely stress-tested and where cost would balloon. Clauses 2 and 3 remove
the level question and the taxonomy target entirely.

## Consequences

**Nothing here is buildable against current storage, because the storage is not there.** #126's job
record still does not exist; mined roles sit in an in-memory blob discarded after one use. Every clause
lands in the build ticket that creates that record for the first time.

**Clause 1a is a new obligation on every writer of facts, not a new field.** The reader must return the
source words for anything it read; the grill must keep the answer and the question; a correction must
keep what it superseded; a proposal must keep its narrative. It also needs its own **negative test** —
a check that cannot distinguish *found nothing* from *did not run* is the failure `career-ops` shipped
three times in one month.

**Clause 5 hands an open question to [#144](https://github.com/adrien-mounier/jobcrush-app/issues/144):
does an expired certification print?** We can now hold the fact that it lapsed; whether it reaches the
page is *what we hold is not what we print*, which #144 owns.

**Clause 1a hands [#141](https://github.com/adrien-mounier/jobcrush-app/issues/141) its boundary, and it
is sharper than a mechanism: *origin decides whether a fact may be reused across adverts.* A fact the
person stated, corrected, or that we read from their CV is theirs permanently and belongs on every CV
where it helps — **including a skill they gave in a grill answer, which is a real fact and not a leak.**
Only a **proposed-and-approved stretch** carries the scope of the advert it was made for. Prior art
exists — `Resume-Matcher`'s `verify_skill_target_plan()` stamps four provenance states
(`existing` / `jd_added` / `supported_by_resume` / `unsupported`) with a deterministic non-LLM verifier
and shows additions in a **diff before save**. `career-ops` needs only three because it never
auto-adds; we do, so we need the fourth.

**Clauses 2 and 4 move [#131](https://github.com/adrien-mounier/jobcrush-app/issues/131) (which facts
may be computed rather than asked).** Skill level is now neither asked nor computed — it is captured
only if stated. Skill recency, by contrast, is **computed and never asked**: production parsers derive
*last used* from where the skill appeared in a dated work history. Remy's
`(Splunk, Control-M, Bash, Linux)` on a dated 2023–2025 job is exactly that input.

**Mention-sites are adoption, not invention.** #145 Q4's premise (*"no surveyed standard models it"*)
is true of **standards** and false of the **production layer** — Textkernel `FoundIn`, RChilli
`Evidence`, and LinkedIn's skills-on-positions, shipped as the *stated replacement* for retired Skill
Assessments. Neither large OSS project records *which* job, so the precise form remains open.

**The claim graph is not persisted** (ADR-0001's favourable finding), so shaping skills costs code in
the zod port and the `.mjs` oracle, and **no stored data**.

**Liveness, for anything built on this:** ~~JSON Resume is fully dead (`resume-schema` **and**
`resume-cli`, 4,719★, archived the same day; 27 of 32 org repos archived).~~
> 🚨 **CORRECTED 2026-08-06 by [ADR-0006](0006-a-project-is-a-container-not-a-fact.md)'s research —
> *"fully dead"* was wrong. JSON Resume **relocated**; it did not die.** The archiving is real
> (`resume-schema` and `resume-cli`, 2026-06-12, 27 of 32 org repos), **but both archived repos carry a
> `MOVED to jsonresume/jsonresume.org` pointer**, and that monorepo is **live** — pushed 2026-07-29, npm
> `@jsonresume/schema` published 2026-07-22. It is also **thin**: one active org repo, 288★. The star
> figure above is disputed (2.4k vs 4,719).
> **The accurate reading: not a live standard to adopt, but a design worth reading** — and per ADR-0006
> it is the cleanest published proof that projects and links are two different things.
> ⚠️ **The lesson, because this repo got it wrong twice: `archived: true` is not evidence of
> abandonment. Read the repo description for a MOVED pointer before calling a project dead.**

CareerGraph is now 37 repos,
**all at 0 stars** — nobody has prior art on the living record. **HR Open moved**: a *Skills Proficiency
Data API Schema* pre-released 21 Jan 2026, still a container with no named scale and no implementers —
clause 2 stands, but **recheck in six months**.

## Alternatives rejected

| Rejected | Why it was attractive | What it cost |
|---|---|---|
| **Store only the person's line** (clause 1) | Nothing to normalise; zero fabrication risk. | An advert asking for *Chain-of-Thought* never matches a stored paragraph. #86's word-coincidence problem survives untouched — the sole driver for having skills at all. |
| **Store only atomised terms** (clause 1) | One clean list; every term matchable. | *"Responsible AI usage in regulated environments"* atomises into nothing, forcing an invented name or a dropped line. And atomising `(C#, XrmToolBox, Git)` strips the verb — `career-ops`' top fabrication pattern. |
| **Two records: the line and the term** (clause 1) | Faithful to both readings. | Four entries for one skill on Remy's CV; every screen needs a rule for which to show, and he sees duplicates of himself. The shipped design is one record, two fields. |
| **Ask the person to rate each skill** (clause 2) | Consistent with #125 and ADR-0003 clause 8; the person owns their own level. | 45 questions. And the answers are worth r = .29 against measured ability. LinkedIn spent four years on the objective version and killed it. |
| **Normalise against ESCO / Lightcast** (clause 3) | Interoperability; a maintained vocabulary nobody has to curate. | 23.55% top-1 accuracy, and no employer consumes structured skills anyway (#137). A generous alias map *"silently suppresses real gaps"*. |
| **Amend ADR-0003 clause 8** (clause 4) | One rule, no footnote. | The ladder's shape is correct and used by three elements. Only its trigger fails, and only on volume. Amending a sound clause to record a scope note is how a rule loses its authority. |
| **Award date only, no validity** (clause 5) | Cheapest; matches what CVs actually print. | A possibly-lapsed credential prints as current on a document defended in an interview — the failure ADR-0001 already named and shaped nothing against. |
| **Compute expiry from the certification's name** (clause 5) | We genuinely know PL-300 is annual. | #128 §1's forbidden invention of precision, and wrong for everyone who renewed. |
| **Merge an exchange semester into the neighbouring degree** (clause 6) | One entry per real qualification; a tidier record. | The machine deciding the person's history had a shape they did not state. ADR-0003 clause 10 already made the overlap itself unremarkable. |
| **No location on a job** (clause 7) | Nothing to maintain. | *"Has he worked in Singapore?"* is unanswerable in the market we actually sell into, and the printed job line loses something the CV showed. |
| **Location as a full place entity** (clause 7) | Cities, regions, timezones, distance. | A cities database for a market where country granularity already resolves to city. Addable later beside what is stored, per ADR-0001 rule 2. |
| **Map the nine level words to rungs ourselves** (clause 8) | No question at all; instant comparison. | The machine settling her level alone, which #125 forbids — and a guess: `Proficient` could be two different rungs and we would never learn which we got wrong. |
| **Ignore a stated level and always ask** (clause 8) | The purest reading of #125. | Throws away something she told us, then asks her for it — the market's single loudest complaint (#137). |
| **Treat no-jobs as unknown** (clause 9) | Safe-looking; never lowers anyone's score. | A graduate's deck fills with ten-year roles and they leave. It also discards a fact we actually hold. |
| **Treat no-jobs as zero unconditionally** (clause 9) | One rule, trivially implementable. | Converts our own parsing failures into silent, unrecoverable user harm — #126's AC5, and the reason it was unmeetable as written. |

## Verification

This ADR's own test has already run, and it passed: **education required no new decisions**, which is
precisely what ADR-0003's verification clause asked #140 to check. ADR-0003 does not reopen; clause 8
gains a scope footnote (clause 4 above) rather than an amendment.

**ADR-0001 has still not had a genuine stress test.** #125 turned out to be the same element with a
different origin; this ADR shaped five elements as a mechanical application of ADR-0003 and never
exercised *adding a new kind of fact a year later*. That test remains unrun, and should be claimed by
the first element added after build — not by anything on map #127.

**The one number that would most sharpen clause 1 does not exist publicly:** per-skill linking accuracy
on **CV parentheticals** (as opposed to job-ad prose). It is cheap to generate against the six CVs in
`data/cvs/` and should be measured before the skills build ticket is sized.
