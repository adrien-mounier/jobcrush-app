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
session's pinned floor, else its target-role placement, since an advert's free-text `familyFit` is
not the closed vocabulary — total bars against the total. A **known zero is not an
unknown**: every job placed and none in the advert's family scores against zero; the career-total
fallback applies only while some years are genuinely unaccounted for (an unmapped job).
_Avoid_: Screening answer, source-supported fact

**Family placement**:
The judgement placing a person's target role or one of their dated job records in a job family:
confirmed or unmapped — never the nearest family. A confirmed placement names **one or more**
families (a job can genuinely be two kinds of work) and carries an ordinal **placement confidence**.
Nobody is ever asked to choose between families. It is worked out, stored on the job record as a
correctable fact, and a correction is never overwritten by a re-read (#134, ADR-0014 + amendment 1).
_Note_: the target role still holds exactly one family until #232 merges several families' floors.
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
the job family (kind of work). Drawn from a closed vocabulary whose entries carry relatedness
(banking is near finance, far from chemicals). Designed in ADR-0014; its labeler is future work.
_Avoid_: Sector, kind of employer, employer type

**Posting family fit**:
The judgement of whether a live posting belongs to a job family at all, carried with the posting
alongside a confidence. Producing it is part of reading the advert; deciding what a weak verdict
means for the feed is a separate decision that does not belong to the engine that produced it.
_Avoid_: Relevance score, title match, family placement
