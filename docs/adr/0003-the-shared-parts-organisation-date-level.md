# ADR-0003 — The shared parts: an organisation, a date, a level

- **Status:** Accepted
- **Date:** 2026-08-04
- **Decided in:** [#139](https://github.com/adrien-mounier/jobcrush-app/issues/139) (owner grilling), under map [#127](https://github.com/adrien-mounier/jobcrush-app/issues/127)
- **Depends on:** [#128](https://github.com/adrien-mounier/jobcrush-app/issues/128) (where a structured fact comes from), [#126](https://github.com/adrien-mounier/jobcrush-app/issues/126) (a job is its own record), [#125](https://github.com/adrien-mounier/jobcrush-app/issues/125) (a language has a level), [#130](https://github.com/adrien-mounier/jobcrush-app/issues/130) (every element is in), [ADR-0001](0001-growth-rule-for-structured-facts.md), [ADR-0002](0002-how-a-structured-fact-reaches-the-cv.md)
- **Evidence:** [`docs/research/cv-elements-existing-data-standards.md`](../research/cv-elements-existing-data-standards.md), [`docs/research/cv-elements-what-cvs-contain-and-what-employers-screen.md`](../research/cv-elements-what-cvs-contain-and-what-employers-screen.md), [`docs/research/eligibility-dimensions-from-the-corpus.md`](../research/eligibility-dimensions-from-the-corpus.md), six real CVs in `data/cvs/`
- **Does not decide:** what any individual element is made of — that is [#140](https://github.com/adrien-mounier/jobcrush-app/issues/140)

## Contents

- [Context](#context)
- [Decision](#decision)
  - [1. An organisation is one kind of thing; the role lives on the link](#1-an-organisation-is-one-kind-of-thing-the-role-lives-on-the-link)
  - [2. The typed name is always stored; the organisation record is an addition](#2-the-typed-name-is-always-stored-the-organisation-record-is-an-addition)
  - [3. Two names are the same organisation when the visitor says so](#3-two-names-are-the-same-organisation-when-the-visitor-says-so)
  - [4. Organisation *names* are shared; organisation *answers* are private](#4-organisation-names-are-shared-organisation-answers-are-private)
  - [5. A date carries its own precision](#5-a-date-carries-its-own-precision)
  - [6. A date range has three end states, not two](#6-a-date-range-has-three-end-states-not-two)
  - [7. Every fact carries when we learned it and from whom; a correction supersedes, never replaces](#7-every-fact-carries-when-we-learned-it-and-from-whom-a-correction-supersedes-never-replaces)
  - [8. A claimed capability is a ladder; an awarded grade is verbatim](#8-a-claimed-capability-is-a-ladder-an-awarded-grade-is-verbatim)
  - [9. A stretch carries two independent labels](#9-a-stretch-carries-two-independent-labels)
  - [10. An overlap is normal](#10-an-overlap-is-normal)
- [What this rule does NOT change](#what-this-rule-does-not-change)
- [Consequences](#consequences)
- [Alternatives rejected](#alternatives-rejected)
- [Verification](#verification)
- [✅ Verification result — both tests ran 2026-08-06 (#140 / ADR-0004)](#-verification-result-both-tests-ran-2026-08-06-140-adr-0004)

## Context

An employer, a school and a certificate issuer are all organisations. A job, a degree and a
certificate all have dates. A language has a level, a degree has a class, a skill has a proficiency,
and a stretched claim has a distance from the truth.

Shape each element separately and every one of those shared parts gets answered three or four times,
differently. That is the *five half-models that do not compose* failure map #127 exists to prevent.
This ADR answers each shared part **once**, before any element is shaped.

**Why it had to be answered before building rather than after.** ADR-0001 rule 2 forbids rewriting
what is stored, and #129 established the negative result that follows: promoting a *part* of an
existing fact into its own kind is a migration the growth rule explicitly does not make cheap. So
whether a part of a fact deserves to be its own kind must be settled when that fact is first shaped.

**The one piece of luck, and it was nearly spent.** #126's job record does not exist yet — parsed
employment blocks sit in an in-memory blob and are discarded after one use. Nothing is stored in the
wrong shape, so every decision below was still free at the moment it was taken. It would not have
been a month later.

## Decision

### 1. An organisation is one kind of thing; the role lives on the link

There is **one** kind of organisation record. An employer, a school and a certificate issuer are the
same kind of thing. What an organisation *was* to the visitor is a property of the job, the degree or
the certificate that points at it — never of the organisation itself.

**Evidence, unusually strong for this map:**

- **LinkedIn ran the other design at planetary scale and reversed it.** Their school-specific URN
  carries the tombstone *"Deprecated. Please use `organization`"*, and their certification record
  points its issuer at the same organisation URN (the field is literally named `company`). They shipped
  two types and merged them.
- **Credential Engine's own handbook demonstrates one organisation holding several roles at once** —
  the case a type-per-role design cannot express, because the type would have to be two things
  simultaneously.
- The only dissenter is schema.org's `EducationalOrganization`, and its motive is visible: schema.org
  is a *search* vocabulary, where a university must be findable **as** a university on the open web.
  That is a publishing concern, not a career-record one.

**Accepted cost:** nothing records that Université de Nantes is a university, so nothing can ever
answer *"is this a real university"* or *"is this issuer accredited"*. Consistent with #130 — we store
what we cannot classify and simply do not compare it.

### 2. The typed name is always stored; the organisation record is an addition

Every job, degree and certificate stores **the words the visitor typed or the CV gave, verbatim,
always**. It *additionally* points at an organisation record when one can be resolved. An unresolved
name is still stored, still shown, still printed — it merely does not group.

This is #130's *capture the maximum, compare where we can*, applied to organisations: a failed match
loses nothing.

**Two consequences fall out for free, both of which were open worries on map #127:**

- **Rebrands work with no extra machinery.** A person who worked at *Facebook* 2015–19 and *Meta*
  2021–23 keeps each name on its own job, so the old job still prints *Facebook* — which is what was
  true — while both point at one organisation. Owner decision 6 (a record spanning decades) makes this
  the normal case rather than an edge case, and the research found **no prior art** for it.
- The typed name is the only thing still true about *"I worked at Anadarko in 2018"*, a company that
  no longer exists.

This is LinkedIn's shipped design (`company` URN **and** `companyName` free text, both optional),
which the research calls *"the only design that survives contact with a real CV"*.

### 3. Two names are the same organisation when the visitor says so

Matching runs in two steps:

1. **Spelling.** Fuzzy matching handles stylistic drift on the same name.
2. **Ask the visitor.** *"You've written Amundi — is this the same employer as Amundi Asset
   Management?"* Asked once, never again.

**The trigger: only when it matters** — when two records would group, or when the visitor corrects
one. Never at upload time, for names nobody has looked at. This is #125's pattern: let the moment
raise the question.

**Rejected: a company registry (GLEIF / OpenCorporates) as the resolver.** Not on cost — on
correctness. Practice puts the ceiling of string matching plainly: *"fuzzy matching handles stylistic
drift on the same name; it can't handle unrelated brand vs legal entity pairs"* — *Google* vs
*Alphabet Inc.*, *HSBC Bank plc* vs *HSBC Holdings plc*, or a company since acquired. A registry does
hold those links. But **it answers a different question than the one we are asking.** For a CV,
*HSBC Bank plc* and *HSBC Holdings plc* are usually the same employer; legally they are not. The
reading that matters here is the one the visitor would defend in an interview, and only they know it.

**This dissolves the parent-vs-subsidiary question rather than answering it.** #138 concluded
*"someone must decide which reading this product uses."* Nobody does. The visitor decides, per case.

**A registry stays addable later without a migration** — it contributes an id *beside* what is
already stored, which is ADR-0001 rule 2 satisfied. If it is ever built: star counts invert reality in
this tooling niche. `dedupe` (4,491 stars) has been unmaintained for a year; `splink` is where the
work is.

### 4. Organisation *names* are shared; organisation *answers* are private

There is **one** growing pool of organisation names, which every visitor's records point into. It
improves with use — better suggestions, fewer questions — and it is the only cheap route to a registry
later.

But *"these two are the same employer"* is stored **on the visitor's own record**. One person's answer
never rewrites another person's history.

**Privacy, which matters because our market is HK/SG:** the shared pool holds **organisation names
only**. Who worked where lives on the visitor's own job record and never moves. A list of company
names is not personal data; the link between a person and an employer is, and it stays private.

### 5. A date carries its own precision

Every date on a CV is either a **moment** (*graduated 2017*, *certified June 2019*) or a **stretch**
(*Oct 2019 – June 2023*) — and a stretch is two moments. So one shape serves everything: a **job** is
two of them, a **degree** is two of them, a **certificate** is one of them.

**The moment stores exactly what is known, and knows how precise that is.** *2013* is stored as
*2013*, marked as a year. *Oct 2019* is stored as *Oct 2019*, marked as a month. **We never pad.**

**Why this is the whole decision.** A CV says *"Amundi, 2013–2015"*. Stored as *1 Jan 2013 → 1 Jan
2015* it reads as 24 months; stored as *31 Dec* it reads as 12. The truth is somewhere between 12 and
36 and **nobody knows which — including us, an hour later**, because the fact that we only knew the
year was thrown away. That value is the input to years-of-experience, the one number that gates jobs.

Only with stored precision does #126's rule actually work: **widest when testing a bar** (2013 → the
whole of 2013, so we never wrongly disqualify), **narrowest when printing** (print *2013*, never
invent *January*).

**The field agrees near-unanimously** — JSON Resume, HR Open and SmartRecruiters all explicitly accept
year-only dates, and HR Open goes furthest by making *a year* and *a year-month* genuinely different
types, so a value's type *is* the statement of what we know. **The exception is instructive:** ELM
(Europass) can only store a full timestamp, so a degree awarded "in 2015" gets a fabricated instant.
The EU's flagship career model forces false precision onto every historical fact. That is the failure
this clause refuses.

**We still ask for the month — when it changes something** (owner amendment, and the narrowing of
#128's *every missing month is asked*):

| Trigger | Why |
|---|---|
| A bar turns on it | The coarse reading spans 4.8–5.2 years and the advert wants 5+. The month decides whether he is shown the job — **ask, and say why.** |
| A gap might not be one | *2013–2015* then *2016–2018* is either a fourteen-month gap or none. That is the difference between a CV a recruiter questions and one they do not. |
| Anything else | **Do not ask.** Show the month as a visible blank on the CV line (ADR-0002 clause 2), which costs no question at all. |

If he answers, that month is stored with its origin (#128 stamps origin per part) and **sticks**: a
re-uploaded CV still saying *2013* never overwrites his *March 2013*.

**Stated risk, accepted knowingly:** this is exactly the shape of "the machine decides it does not
need to ask" that #128 rejected once, on the grounds that it can fail silently. It is taken here
because the failure is **visible** — the unfilled blank sits on his own CV where he can see it.

### 6. A date range has three end states, not two

| State | Builds experience? | Prints as |
|---|---|---|
| **Still there** | yes, and keeps growing | *Present* |
| **Ended, we know when** | yes, fixed | the date, at whatever precision clause 5 holds |
| **Ended, we do not know when** | **no** | a visible blank (ADR-0002 clause 2) |

**Why the third state is not optional.** *"Present"* is the one word on a CV that goes stale by
itself: a snapshot is read once, but owner decision 6's record runs for years, so a job stored as
"ongoing" keeps accruing experience long after the person left. Meanwhile a job added from 2003 whose
end the person genuinely cannot remember produces the **same empty field**. Two opposite meanings, one
blank — and the safest-looking reading (empty means ongoing) is the one that silently inflates
experience.

Consistent with #126: an unreadable history never lowers a score, but the card says the bar was not
tested. HR Open is the only standard shipping both mechanisms — an open-end type documented as
*"unknown or uncertain"* **and** a separate `current` flag — for exactly this reason.

### 7. Every fact carries when we learned it and from whom; a correction supersedes, never replaces

The research found **no standard anywhere models supersession or when-we-learned-it**, and both are
implied by owner decision 6. They are ours to design; this is the design.

**The case that forces it.** The CV says his title was *Project Manager*. He corrects it to *Senior
Project Manager*. Four months later he uploads an updated CV — which still says *Project Manager*,
because he never fixed the document. With the old value discarded, we cannot tell a conflict worth
asking about from a correction he already made, so we ask him again, on every upload, forever. **#128
§3 promised a correction sticks; it cannot, if we have forgotten what it was correcting.**

This is not a new principle so much as the one this repo keeps re-deriving: #126 *detaches* a deleted
job's sentences rather than deleting them · ADR-0001 rule 3 keeps the sentence when a fact is
structured · rule 8 never deletes on rollback. The pattern is already *never destroy, only supersede*.
This makes it the rule for every fact rather than a habit three decisions happened to share.

It also pays for clause 6: knowing **when** he told us he was at Amundi is what lets us ask *"you said
this eighteen months ago — still there?"* without nagging someone who told us last week.

**The one deliberate exception: erasure on request really deletes.** HK's PDPO and Singapore's PDPA
both give people a right to have their data erased. *Never destroy* is a rule about corrections, not
about a person asking us to forget them — that deletes superseded values too. Written in explicitly so
nobody reads the rule the wrong way later.

**Accepted cost:** every fact gets bigger, and every screen must know to show only the current value.
Get that wrong once and someone sees a stale title on their own CV.

### 8. A claimed capability is a ladder; an awarded grade is verbatim

Three different things get called *a level*, and they are not one shape:

**(a) A capability the visitor claims → one ladder, used everywhere.** Ordered rungs written as
concrete things a person can do, the visitor places themselves on it, **asked once ever**, stored on
the profile, compared when an advert states a bar, and **being below the bar never withdraws a job**
(#125).

The same ladder covers **degree level** — the rungs being *bachelor's / master's / doctorate*, with
Thomas placing his French *Licence* on it himself. That is #130's decision (*don't teach the machine
that a Licence equals a bachelor — ask him once*) turning out to be #125's language ladder wearing
different rungs. **Two of the map's four level cases collapse into one shape**, which is the outcome
this ticket existed to find.

**(b) A grade someone else awarded → stored verbatim, never compared.** *First Class Honours*,
*Merit* and *Dean's Commendation for Academic Excellence* are three real results from one CV, from
three systems that do not convert.

The evidence for not trying: **zero of seventeen adverts in our corpus test degree classification.**
All four that gate on `degree` test **level and field** — *"Bachelor's degree or above"*, *"in
Business, IT, or related field"*. And no standard on earth made classification comparable — every one
surveyed punts to free text. So we store his words, print his words, and compare nothing. This is
*capture the maximum, compare where we can*, exactly as written.

*(Noted, not adopted: ELM's `ShortenedGrading` — percentage of students graded lower/equal/higher —
is the one idea found that makes an unfamiliar national grade interpretable without mapping it. It
needs data no CV carries.)*

**(c) How well a claim is backed up → already exists**, on the enrichment proposal, not on the person.
See clause 9.

**Whether skills carry a level at all is [#140](https://github.com/adrien-mounier/jobcrush-app/issues/140)'s
question, not this ADR's.** If they do, they use ladder (a) — and #140 should expect the shape to be
stress-tested there, because *ask him once* is easy for one degree and hard for forty skills. Research
context for that decision: **no interoperable skill scale exists** (HR Open defines a *container* for a
scale and declines to define the scale), and LinkedIn retired its skill assessments in 2024.

### 9. A stretch carries two independent labels

Owner decision 9 (the CV is a marketing document; the product proposes stretches) raises a *degré de
maîtrise* on a stretched claim — [#141](https://github.com/adrien-mounier/jobcrush-app/issues/141).
It is **two labels, and both already exist**:

- **How big the stretch is** — the enrichment contract's existing evidence grade (*partially
  supported* / *plausible but unevidenced*).
- **How good the visitor actually is** — ladder (a) from clause 8, applied to a proposed skill.

**They cannot collapse into one number, and the proof is that all four combinations are real:**

| | beginner | genuinely good |
|---|---|---|
| **well documented** | *"exposure to trading"* — state it plainly, small | *"trading experience"* — state it boldly |
| **a stretch** | state it lightly, prepare hard | **the owner's real case** — state it confidently, prepare the story |

Being excellent at something a CV never proved is precisely the situation a stretch exists for.

**The practical payoff, which is why the distinction earns its place:** the **stretch size** decides
how carefully to word the line and whether an interview narrative is mandatory (the enrichment
contract already makes a narrative-less proposal invalid). The **mastery** decides how boldly to word
it.

### 10. An overlap is normal

Overlapping date ranges are **never flagged, never questioned, never corrected**. They are ordinary:
exchange years, dual degrees, freelance alongside a job, a promotion recorded as two rows sharing a
boundary. Real case: Kulpakorn Ngamvijit studied at Chulalongkorn 2015–2019 *and* at Queensland
2017–2018, one nested entirely inside the other.

#126 already handles the only place an overlap changes a number: work totals count **calendar time
actually worked**, so overlapping jobs merge instead of double-counting. Education totals nothing, so
there is nothing to do at all.

**The case that looks like a date problem and is not:** whether Kulpakorn's Queensland year is a
*second degree* or *part of the first*. That is a question about what the entry **is**, not about its
dates — [#140](https://github.com/adrien-mounier/jobcrush-app/issues/140)'s.

## What this rule does NOT change

**ADR-0001 rule 1 stands: every element still gets its own shape.** This ADR defines shared *parts*
(an organisation, a date, a level), not a generic envelope. There is still no open key space, and
#140 still designs each element deliberately.

**ADR-0002 is untouched.** Clause 5 above changes what is *stored*; how a date reaches the page is
still ADR-0002's, and the printing rule for a coarse date is a cv-brain authoring rule, not this one.

**Preferences are unaffected** (ADR-0001 rule 5). A target location or a minimum salary carries none
of this.

## Consequences

**Nothing here is buildable against the current storage, because the storage is not there.** #126's
job record does not exist; the mined `roles` array (`{employer, title, dates_as_written,
dates_missing}` in `prompts/claim-miner.md`) is an in-memory blob discarded after one use, leaving
only a count. Every clause above lands in the build ticket that creates that record for the first
time.

**Clause 5 makes the cv-brain date contradiction decidable.** `cv-authoring-rules.md` requires dates
as *Month YYYY* and forbids inventing dates four lines later — irreconcilable while the record could
not say what it did not know. It now can, so the authoring rule can be written (*print what is known,
never pad*). Graduated out of map #127's fog as its own ticket.

**Clause 7 is the largest new mechanism on this map** and the only one with no prior art anywhere. It
touches every stored fact, not one element.

**Clause 3 adds a question type that does not exist today.** The grill asks about content; nothing
asks *"are these two names the same organisation?"*, and it fires outside ingestion — at the moment two
records would group. Owner decision 8's chunked, resumable ingestion is where it lands.

**Clause 8 makes #125's language ladder a shared asset rather than a one-off.** Whatever #140 builds
for language rungs is reused by degree level, and by skills if they get a level. It also means getting
the ladder's shape wrong is now a multi-element mistake.

**~~`certification` remains a hard gate with no guest list.~~** — ⚠️ **This paragraph was factually
wrong and is corrected here, 2026-08-06, by [#140](https://github.com/adrien-mounier/jobcrush-app/issues/140)
/ [ADR-0004](0004-each-elements-own-parts.md).** It claimed certification was *"wired to withdraw jobs…
the same half-wired shape that produced #125's live job-deleting bug."* The code says otherwise:
`withdrawal.ts:82` returns `false` for the dimension **unconditionally** (with a comment recording that
as deliberate), and `eligibilityDiscovery.ts`'s `ASK_DIMENSIONS` excludes it, so nothing ever asks.
**No certification fact can ever withdraw a posting.** #125's bug was live because it had *both* an
explicit-no mapping *and* a surface that wrote `none`; certification has neither. The accurate
statement is milder — a door with no guest list, and the bouncer told to wave everyone through:
**safe by construction, not half-wired.** ADR-0004 clause 5 gives it its guest list.

## Alternatives rejected

| Rejected | Why it was attractive | What it cost |
|---|---|---|
| **Employer as a name on the job, nothing more** (clause 1–2) | Free, nothing to maintain; it is today's shape. | *HSBC* and *HSBC Holdings plc* are two employers forever, a correction to one never reaches the other, and *"how long at this company"* is a fresh string match every time. |
| **Employer as an entity, replacing the name** (clause 2) | Clean; one source of truth per organisation. | A failed match loses the only thing still true about a dissolved company. Breaks rebrands: the 2015 job would print *Meta*. |
| **Separate lists for employers, schools and issuers** (clause 1) | Each list can validate its own kind. | The reader must pick a list *before* storing, and a wrong guess is harder to fix than a wrong spelling. Every new element reopens *"do we need a fourth list?"*. LinkedIn shipped this and deleted it. |
| **A company registry as the resolver** (clause 3) | Genuinely solves acquisitions and rebrands, which grow with the record. | Answers the *legal* question, not the CV one. Plus a live external dependency, a per-lookup bill on a shared account, and thin coverage for small HK/SG firms. Addable later at no migration cost. |
| **Fully private organisation lists** (clause 4) | No merge can ever cross between people. | The thousandth person to type *HSBC Holdings plc* is asked the same question as the first; no route to a registry later. |
| **Fully shared, answers included** (clause 4) | Learns fastest. | One person's wrong merge is visible in someone else's history. |
| **Store a padded full date and remember it was rounded** (clause 5) | Every date is one type; arithmetic is trivial. | The padding *is* the invented precision, and the marker is the thing that gets dropped. ELM proves the endpoint: the EU's own model fabricates an instant for every year-only fact. |
| **Ask for every missing month** (clause 5) | #128's rule as literally written; no cleverness that can fail silently. | Six year-only jobs is twelve questions before he sees a single posting. Decision 8's chunking softens it; it is still twelve. |
| **Never ask, always show a blank** (clause 5) | Zero friction; ADR-0002 clause 2 already supports it. | The blank that decides whether he clears a 5-year bar is the one blank worth interrupting for. |
| **Empty end date means "still there"** (clause 6) | One less state; matches every standard's default. | A job added from 2003 with a forgotten end accrues experience forever. The safest-looking reading is the one that silently inflates. |
| **Replace on correction** (clause 7) | Simplest; the record stays small and every screen shows one value. | A re-uploaded CV cannot be told from a conflict, so the same question is asked forever — and #128 §3's *"a correction sticks"* becomes false. |
| **One ladder for all four level cases** (clause 8) | Maximum reuse; one thing to build. | Degree classification is unordered across systems, untested by any advert in our corpus, and unsolved by every standard. Forcing it onto a ladder means inventing a conversion nobody else managed. |
| **One number for a stretch** (clause 9) | Simpler for the CV writer to act on. | All four squares of the mastery × evidence grid are real. Collapsing them loses the owner's own case: a big stretch he was genuinely good at. |
| **Flag overlapping ranges for review** (clause 10) | Overlaps do sometimes indicate a parsing error. | They much more often indicate a real life. Flagging trains the visitor to dismiss warnings. |

## Verification

[#140](https://github.com/adrien-mounier/jobcrush-app/issues/140) — shaping each element — must be a
**mechanical application** of this ADR for every shared part: an organisation slot is clause 1–4, a
date slot is clause 5–6, a level slot is clause 8. If shaping education or certifications turns into a
fresh argument about what an organisation or a date is, this ADR is wrong and #139 reopens.

The stronger test is the one map #127 has been carrying unrun: **skills**. Clause 8 sends skills to
ladder (a), and *"ask him once"* is not obviously survivable at forty skills. If it breaks there, the
break is in ladder (a)'s trigger, not in its shape.

## ✅ Verification result — both tests ran 2026-08-06 ([#140](https://github.com/adrien-mounier/jobcrush-app/issues/140) / [ADR-0004](0004-each-elements-own-parts.md))

**Test 1 passed. This ADR does not reopen.** Shaping education required **no new decisions at all**,
and no element turned into a fresh argument about what an organisation or a date is. The
store-the-typed-words-always pattern (clauses 2–4) was decided here for organisations and then covered
**skills, places and levels** without being stretched — four uses, no strain.

**Test 2 broke, exactly as predicted, and exactly where predicted: the trigger, not the shape.**
*Ask once each* costs 4 questions for languages, 1 for a degree and ≤5 for certifications — and **45
for skills**. **Volume is the whole discriminator.** ADR-0004 clause 2 therefore never asks for a skill
level, capturing one only when the CV already states it.

**Recorded as a scope footnote rather than an amendment:** clause 8 is **asked-once** for languages,
degree level and certifications, and **never-asked** for skills. The ladder itself is unchanged and in
use by three elements; amending a sound clause to record a scope note is how a rule loses its
authority.
