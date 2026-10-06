# A family floor may name equipment; a family scope may not

Status: accepted (owner design pass, 2026-08-21, issue #259)

> **Amended by [ADR-0016](0016-the-cv-is-reviewed-not-asked.md)** (2026-10-04): the family floor no
> longer gates the reveal — it feeds the drafter, and the review gates the reveal (see 0016's "What
> this rule does NOT change").

A **family floor** item may name a concrete tool, language or platform — "Have you used SQL?" for
business analysis, "Do you have experience in Java?" for backend engineering — whenever the
**demand count** earns it. The **scope** sentence that says what the job family *is* may never name
one.

## Why this is not obvious

A future reader will open a published family, see SQL on the floor and no SQL in the scope, and
reasonably conclude that one of the two is a mistake. It is not. The two fields do different jobs:

- **The scope decides membership.** It is the sentence the labeler is told decides the family
  (`familyLabeler.ts` — "what this family covers (THIS decides the family)"). Put SQL in it and the
  family's edge moves: data analysis is SQL-heavy, and business analysis starts swallowing it.
- **The floor builds the person's CV and gates the reveal.** It is asked of the person, and its
  answers write root-CV lines. A business analyst who cannot say they use SQL has a weaker CV than
  the market expects, whatever the family's definition says.

The floor questions *are* also shown to the labeler, but explicitly as illustration — the same
prompt calls them "illustration, NOT a checklist the role has to pass". That is what makes the split
safe rather than merely convenient, and it is a property of the prompt that this ADR now depends on:
if that framing ever changes, this decision must be re-examined.

## The decisions, and the roads not taken

1. **The demand count is the only filter on equipment.** A tool that clears the floor threshold
   across the whole **floor corpus** is part of the occupation; a tool that does not is one
   employer's stack. One bank's Copilot ask appears in 1 advert of ~120 and never clears the bar.
   Java at 90% of backend adverts clears it easily.

2. **A hand-written "tools are skills, not occupations" rule was proposed and rejected**
   (this ADR's first draft, corrected by the owner the same day). It would have dropped SQL from
   business analysis and Java from backend engineering — the two clearest cases where the market's
   equipment *is* the occupation's equipment. Worse, it was a judgment call layered on top of the
   evidence, and #259 exists precisely to remove judgment calls that no one can audit. **When the
   count and a hand-written rule disagree, the count wins.**

3. **The guard is one line in the runbook, not a product change.** Splitting the floor into
   occupation items and equipment items — so equipment never reaches the labeler at all — was
   considered and rejected as premature: it costs a contract version, an oracle change and a gate
   change to remove a risk the prompt's own "illustration" framing already contains. Revisit only
   if a published family is measurably distorted by an equipment question.

4. **Equipment questions are not restricted to yes/no.** The floor contract already allows any set
   of answer options and a `skills` CV destination, so "professional / study project / none" is
   expressible today with nothing built. Exposure to a tool is genuinely graded in a way an activity
   is not, and the floor should say so.

## Consequences

- Every family published from here on may carry equipment items. Both families published before this
  ADR (business-analysis v1, it-project-delivery v1) carry none; neither is wrong, and neither is
  corrected by this decision — a widened floor is a new version through the normal gates.
- A run that finds itself writing a tool name into a scope sentence has left the runbook.
- The one dependency to watch: `apps/api/prompts/family-labeler.md`'s "illustration, NOT a checklist"
  framing. This decision rests on it.
