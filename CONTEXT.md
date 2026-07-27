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
