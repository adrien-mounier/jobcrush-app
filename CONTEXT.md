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
