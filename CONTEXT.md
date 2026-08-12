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
answer the person typed.

⚠️ **Scope, and a recorded deviation, owned by [#134](https://github.com/adrien-mounier/jobcrush-app/issues/134).**
This entry used to read *"length of experience is always experience in a family, never a career
total"*. As built (#162), the worked-out total is a **career total**, stored at the global scope
(`ANY_FAMILY`). The family-scoped reading remains the intended end state and the rule above remains
the target — it is **deferred, not abandoned**.

Why it could not be built with #162, and this is the fact that settles it: **there is exactly one job
family in the entire system, and it is a constant.** `resolveFamily()` ignores its input and returns
`STUB_FAMILY`; `placeFamily` defaults to `unmapped`. So every dated job would be placed in the same
one family, and a family-scoped number would be **numerically identical to the career total for every
visitor**. #126 §5 reached this same conclusion and the owner deferred the kind-of-work label to
**#134**, the classifier ticket, for exactly this reason.

**What must change when #134 lands** (the years half of it): place each dated job record in a family;
store one `years-experience` fact per family instead of one at `ANY_FAMILY`; and make
`resolveUserYears` (`apps/api/src/deck.ts`) read the scope of the ADVERT's own family
(`adRequirements.familyFit`) rather than the global one. The eligibility store is already keyed by
scope, so it needs no change. Until then, a years bar on an out-of-family advert is tested against the
career total — too generous, never too strict, so it can add a job to a deck but never delete one.
_Avoid_: Screening answer, source-supported fact

**Posting family fit**:
The judgement of whether a live posting belongs to a job family at all, carried with the posting
alongside a confidence. Producing it is part of reading the advert; deciding what a weak verdict
means for the feed is a separate decision that does not belong to the engine that produced it.
_Avoid_: Relevance score, title match, family placement
