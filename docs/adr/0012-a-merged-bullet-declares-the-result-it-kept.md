# ADR-0012 — A merged bullet declares the result it kept

- **Status:** Accepted
- **Date:** 2026-08-12
- **Decided in:** [#154](https://github.com/adrien-mounier/jobcrush-app/issues/154) (owner grilling)
- **Depends on:** [ADR-0004](0004-each-elements-own-parts.md) clause 1 (a fact pointing at nothing is a defect; a silent loss must not be byte-identical to a deliberate compression), [ADR-0007](0007-what-prints-is-decided-per-application.md) (choosing is legal, and reversible per application), [ADR-0002](0002-how-a-structured-fact-reaches-the-cv.md) clause 5 (our failures are visible to the visitor)
- **Fills:** the arbitration `cv-authoring-rules.md` never had. Two rules it states both bind, and when a role overflows they demand opposite things.
- **Does not decide:** the bullet budget itself ([#153](https://github.com/adrien-mounier/jobcrush-app/issues/153), closed); putting a held-back fact back on the draft for one application (its own ticket).

## Context

Two rules this product enforces contradicted each other, and no code arbitrated.

**Merge, never drop** (the tailor prompt, pre-#153): when a role has more to say than fits, fuse
weak or overlapping bullets rather than lose one. **Outcome-led bullets** (`cv-authoring-rules.md`):
action verb + scope + outcome, never a responsibility-only line.

When a role overflows, the first forces a merge, and the merge destroys what the second requires.
Measured on the owner's own CV: four source bullets fused into one went from **514 characters to
172**. Every keyword survived. Every outcome clause died — *strengthening customer security*,
*improving customer autonomy and reducing support workload*, and two more. The result is a
responsibility-only scope list: exactly what the outcome rule exists to prevent, and it passed every
gate we had.

Three mechanisms each missed it for a different reason. `conservationIssues()` counts **classes** of
fact, and a merge preserves the class. The judged score receives a flat list of sentences with no
notion of what a bullet used to be. **Nothing anywhere checked for the presence of an outcome.**

#153 moved half of this: *"merge, never drop"* was withdrawn in favour of choosing, and every
printed bullet began carrying the ids of the claims it came from — which made *"did this merge drop
an outcome the source stated?"* an answerable question for the first time. It did not answer it. A
two-bullet merge could still eat a result, silently.

## Decision

**1. The outcome rule wins, and a merge may not be the way it loses.** A line built from more than
one claim must state what was achieved.

**2. The writer declares the surviving result, and containment is what is checked.** The bullet
carries an `outcome` field, and those exact words must appear **inside the printed text**. Checking
that the field is *filled in* would pass a clean result in the data beside a scope list on the page
— a passing check and an unchanged CV. Containment is mechanical, unarguable, and forces the result
onto the page the employer reads.

**3. When no source states a result, do not combine.** Print one claim, hold the other back. This is
the clause that keeps the rule honest: any rule demanding an outcome from duty-only sources hands
the machine one obvious way out — **invent one**. An invented result is a system inference wearing a
source-supported fact's clothes, which ADR-0004 clause 1 forbids outright, and it breaks the owner's
own clause: *the machine never adds silently.* ADR-0007 is what makes the honest way out available —
choosing is legal, and the person is told.

**4. The rule is two claims per line; the alarm is four.** Enforcement deliberately sits looser than
the rule. The miner mines *atomic* claims and splits compound bullets, so one honest sentence
routinely draws on two or three claims — "more than one claim" is not evidence of a squish. A false
warning spends a retry and prints a warning about a line that was fine, and a person who reads two
false warnings stops reading the true one. Four is where the squish is unarguable; it is the owner's
own BRED case.

**5. A failure ships the CV and tells the person; it never withholds the CV.** These checks sit in
the lossy lane, not the malformed lane. On a CV where every fact is duty-only the machine will fail
twice, and no CV is worse than a weak line.

**6. What the rule cannot prevent is disclosed, per job, on the screen showing the CV.** The block
carries: how many facts the profile holds about that job and why they cannot all print; the facts
held back, in the profile's **own** wording, behind a count that opens; and, for an over-full line,
the printed sentence beside the profile's original sentences.

**7. A choice and a fault are worded differently, on purpose.** Facts held back are a **choice** —
*"the ones that matter least for this job"*. An over-full line is a **fault of ours** — *"we could
not fit these four facts and keep what they achieved"*. Explaining the fault as a relevance decision
would make a silent loss indistinguishable from a deliberate compression **in prose**, which is
ADR-0004 clause 1's failure in a new medium.

## Consequences

**Accepted ceilings, both deliberate:**

- **One surviving result per line is guaranteed, not all of them.** A line combining three claims and
  keeping one result passes. The remaining loss is *disclosed*, not prevented. Preventing it means
  forbidding combination outright, which is the bullet-budget question #153 already settled against.
- **A three-claim squish is tolerated silently.** Bought deliberately, to protect the credibility of
  every warning that does fire. If measurement later shows three-claim lines are usually squishes,
  the alarm moves; the written rule does not have to.

**Vocabulary this pins.** The fact pool is **"your profile"** — not "your CV", which on the draft
screen means the document the person is looking at, and which is wrong anyway: facts arrive from the
upload *and* from the interview. "Master CV" stays the name of the verified full document.

**What it does not fix.** Nothing yet checks that printed ∪ held-back **covers** the source: a claim
dropped without being listed still passes silently, and the fact count shown is derived by matching
the employer. And the disclosure is read-only — the person can see what was held back and cannot yet
put one back.

**Where it lives.** Rule in `docs/cv-brain/cv-authoring-rules.md`; the tailor prompt carries it in
full (the writer never sees that file) and names it as the source of truth; checks and disclosure in
`apps/api/src/preview.ts`; the block in `apps/web/app/preview/[jobId]/page.tsx`.
