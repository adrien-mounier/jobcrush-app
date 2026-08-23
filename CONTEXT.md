# JobCrush

Language for describing the evidence JobCrush uses to understand a person and compare that evidence
with job requirements.

## Language

**Source-supported fact**:
A statement explicitly present in information the user provided, or a defensible semantic equivalent
of that statement. It may receive full matching credit without implying independent verification.
_Avoid_: Verified fact, certified fact

**System inference**:
A new conclusion JobCrush draws from source-supported facts that the user's source did not itself
state or semantically entail.
_Avoid_: Imported fact, CV fact

**Corroborated fact**:
One source-supported fact independently present in more than one user-provided source. Multiple
sources increase confidence but never multiply matching credit.
_Avoid_: Duplicate fact, repeated evidence

**User-resolved fact**:
A fact whose active value the user explicitly corrected or accepted. It takes precedence over
conflicting imported values and may be used in certified output.
_Avoid_: Verified fact, approved import

**Target role**:
The kind of job the user wants JobCrush to search for next. Past roles do not establish it unless a
source explicitly states that intention.
_Avoid_: Current role, inferred role

**Search area**:
The location, remote arrangement, or relocation scope in which the user wants JobCrush to search.
The user's current residence may suggest it but does not establish it.
_Avoid_: Current location, home address

**Job family**:
A group of target roles that share one essential requirement floor for discovery and matching. Roles
may be related without belonging to the same job family.
_Avoid_: Career neighborhood, job title

**Family floor**:
The ranked checklist of what every job in a family expects, which discovery must cover before the
job reveal. One concept with two names: the CV brain (`tailoring-reasoning.md` §4) says "family
floor"; `onboarding-reward-design.md` §6 says "ranked essential floor" / "essential requirement
floor" and defines its shape (§6.2). It is the opposite of §4's role-language discriminators, which
separate roles within a family — misreading those as the floor is the documented mistake behind #6.
_Avoid_: Discriminator, role-language signals

**Career neighborhood**:
A broader group of related job families whose roles may be close in meaning or plausible career
transitions but do not share one essential requirement floor.
_Avoid_: Job family, cluster

**Unmapped target role**:
A target role that does not meet the acceptance threshold for any known job family. It must not be
forced into whichever family happens to be nearest.
_Avoid_: Unknown job, nearest family

**Word search**:
The posting search run on the words the visitor typed as her target role, used whenever there is no
usable published **family floor** to search with — an unmapped placement, a placement naming several
families, or a named family not yet published. It is an ordinary deck: same scoring, same ordering,
same provider budget, and no sentence, mark or message anywhere tells her which kind of search she
got. Decided in #230; the opposite of it is a **family search**.
_Avoid_: Fallback search, keyword fallback, degraded search, title search

**Family research request**:
The asynchronous work initiated for an unmapped target role to construct and validate a reusable job
family before discovery continues.
_Avoid_: Classification retry, onboarding job

**Family research candidate**:
An unmapped target role submission retained for relevance screening. A candidate becomes a family
research request only when it appears to describe a legitimate employment target worth learning.

_Avoid_: Family research request, raw search query

**Family learning**:
The reusable knowledge gained by researching and validating a job family. It benefits future users
whether or not the user whose submission prompted it creates an account.

_Avoid_: User-specific search, onboarding completion

**Family learning attempt**:
The traceable lifecycle that begins when a family research candidate is screened and ends when it is
rejected, fails validation, produces a published family, or is superseded by another attempt.

_Avoid_: Background job, successful family

**Unmapped label**:
One recorded unmapped placement — the words a person's target role or past job carried when no
published job family fit them. Kept durably, linked to the person who caused it, as feed for
vocabulary growth (#218).
_Avoid_: Failed placement, classification error

**Vocabulary-growth run**:
The owner-triggered research session that groups the accumulated unmapped labels, researches the
groups the owner picks, and produces vocabulary proposals. It never publishes anything itself.
_Avoid_: Auto-publish, background research, scheduled job

**Vocabulary proposal**:
A complete, evidence-backed package proposing one change to the published vocabulary: a new job
family, or a new version of an existing one (wider scope). It enters the vocabulary only by owner
approval and only through the publish gates — the machine never adds silently.
_Avoid_: Auto-added family, draft family, suggestion

**Floor corpus**:
Every job advert a **vocabulary-growth run** read to distil one **family floor** — the whole of each
served market for the job titles the run measured, not a sample. Kept beside the **vocabulary
proposal** so a floor question can be checked against the demand that earned it, and distinct from
the handful of posting-evidence records that go in the published file to prove real employers hire
for the family (#259).
_Avoid_: Evidence, sample, posting evidence

**Demand count**:
How many adverts of a **floor corpus** asked for one **family floor** item, out of the corpus total
("111 of 120"). It is the reason a question is on the floor, and the number the floor's threshold is
measured against (#259).
_Avoid_: Recurrence, frequency, score

**Important gap**:
A job requirement that the user's current evidence does not cover and that may materially reduce
their chances. It must be explained on the job card but does not prevent truthful tailoring or an
application.
_Avoid_: Fatal mismatch, stretch match

**Blocking requirement**:
A requirement the user must meet for the job to be available to them at all. An unmet blocking
requirement withdraws the posting from that user's deck entirely, however well they match otherwise.
It is established only when the advert states the requirement as mandatory and the user has
explicitly said they do not meet it; a vague advert or an unasked question never establishes one.
_Avoid_: Important gap, hard filter, knockout

**Eligibility fact**:
A fact about the user that adverts test as a gate rather than as evidence of capability — right to
work, language fluency, length of experience, a mandatory certification. It does not vary by advert,
so it is reused across every posting. How one *arrives* differs by dimension (ADR-0008): most are
**asked** once, but **length of experience is worked out**, never asked — computed from the dated job
records (`apps/api/src/yearsWorked.ts`), because a value the machine regenerates would delete any
answer the person typed. **Length of experience is experience in a family, plus the career total**
(#222, ADR-0014 amendment 1): one fact per family with a dated job — a job carrying two families
counts fully toward each, so the family numbers do not sum to the total and no surface may present
that sum — and the total at the global scope, each job counted once. A years bar is tested at its
own scope (`yearsScope` on the requirement): family bars against the advert's family's number — the
session's pinned floor, else its target-role placement; the advert's own `familyFit` decides deck
membership (#243), never which years fact a bar tests — total bars against the total. A third scope, **industry**,
exists on the requirement from #284: the advert reader names a published industry id (or none, when
the advert names an industry we do not publish, which leaves the bar untestable). Nothing is scored
against it until #285 — an industry bar is answered as a career-total bar until then. A **known zero is not an
unknown**: every job placed and none in the advert's family scores against zero; the career-total
fallback applies only while some years are genuinely unaccounted for (an unmapped job).
_Avoid_: Screening answer, source-supported fact

**Family placement**:
The judgement placing a person's target role or one of their dated job records in a job family:
confirmed or unmapped — never the nearest family. A confirmed placement names **one or more**
families (a job can genuinely be two kinds of work) and carries an ordinal **placement confidence**.
Nobody is ever asked to choose between families. It is worked out, stored on the job record as a
correctable fact, and a correction is never overwritten by a re-read (#134, ADR-0014 + amendment 1).
For a plural target role, discovery asks the de-duplicated essential items of every usable family
floor in placement order; the first family remains the single downstream search family (#232).
_Avoid_: Job label, classification, posting family fit, needs clarification (deleted in #231)

**Placement confidence**:
How sure the labeler is about a family placement — *certain / likely / possible*, an ordinal, never
a number. It attenuates the **ranking** (a job we are less sure about sinks in the deck) and never
the years fact, which stays a whole honest number. Nothing is ever filtered out by it. A person's
own correction is always certain. Owner-decided weights: certain x1.0, likely x0.9, possible x0.75 —
an 80% card reads 60% at *possible*, deliberately (ADR-0014 amendment 1 decision 5). Stored by #231,
applied to a card's score by #222.
_Avoid_: Confidence score, probability, match strength

**Industry**:
The kind of business an employer is (banking, finance) — the second axis of a job, distinct from
the job family (kind of work). Drawn from a **closed, versioned vocabulary** published as reviewed
data: each entry carries a stable id, a display name, a one-line scope sentence saying what it
covers and where its edge is, a version, and exactly one **industry group**. Designed in ADR-0014,
shaped by its amendment 2, first published by #280.
_Avoid_: Sector, kind of employer, employer type

**Industry group**:
The set an industry belongs to — exactly one, never two. The group is the whole definition of
relatedness: two industries are near *because* they share a group, so a group must stay tight
enough that "near" honestly means transferable experience. A group carries an id, a display name
and a one-line scope sentence, and a group drawn wide enough to swallow unrelated businesses is
split before it publishes (ADR-0014 amendment 2 decision 3).
_Avoid_: Sector group, category, cluster

**Industry closeness**:
How close a person's industry is to the one an advert asks for. Three answers and no others:
**exact** (the same industry), **near** (a different industry in the same group), **far**
(everything else). Read off the published group tree as arithmetic — a judgement the owner made
once, at publication. Nothing asks a model how close two industries are at scoring time, ever.
_Avoid_: Relatedness score, similarity, industry match

**Industry placement**:
What the labeler decides a job's industry is — the industry half of the same shape a **family
placement** has: `confirmed`, carrying one or more industry-version references and a **placement
confidence**, or `unmapped`. A job may honestly carry two (the employer's own industry and the
industry the work was served into), and its years count in full toward each. Nobody is ever asked
which industry their employer was in; correction is the only lever.
_Avoid_: Industry tag, employer classification, sector label

**Employer lookup**:
What the open web says an employer's business is, in plain words — one web search per company,
looked up when a job is placed and then cached durably and read by everyone, so a company is paid
for once, ever. It answers *what is this employer*; the person's own CV lines answer *what industry
was the work in*, and where they differ the job honestly carries both. The lookup is sent the
employer name and nothing else, because the row it writes is read by strangers. A lookup that fails,
times out or finds nothing is never stored, and the job is still placed on the CV lines alone.
Designed in ADR-0014 amendment 3, built by #282.
_Avoid_: Company enrichment, employer profile, firmographics

**Posting family fit**:
The judgement of whether a live posting belongs to a job family at all, carried with the posting
alongside a confidence — a published family id or "none of these" (#243), never free text.
Producing it is part of reading the advert; what a verdict means for the feed is decided separately
(#243): **identity deletes, confidence orders** — an advert naming another family (or none) leaves
the deck it doesn't belong to entirely, and a weak confidence on the right family sinks the card's
rank without ever removing it or touching its score. The family compared against is the one the
deck was searched for, never the visitor's own.
_Avoid_: Relevance score, title match, family placement
