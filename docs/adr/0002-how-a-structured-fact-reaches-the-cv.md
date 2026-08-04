# ADR-0002 — How a structured fact reaches the printed CV

- **Status:** Accepted
- **Date:** 2026-08-04
- **Decided in:** [#135](https://github.com/adrien-mounier/jobcrush-app/issues/135) (owner grilling), under map [#127](https://github.com/adrien-mounier/jobcrush-app/issues/127)
- **Depends on:** [#128](https://github.com/adrien-mounier/jobcrush-app/issues/128) (where a structured fact comes from), [#126](https://github.com/adrien-mounier/jobcrush-app/issues/126) (a job is its own record), [ADR-0001](0001-growth-rule-for-structured-facts.md) (the growth rule)
- **Satisfies:** ADR-0001 clause 4, reader 3 — *"it prints on the tailored CV"*. That gate was unbuildable until this ADR existed.

## Context

[#128](https://github.com/adrien-mounier/jobcrush-app/issues/128) §4 promised that a correction lands
on the fact underneath and *"the tailored CV follows automatically"*. Nothing in the backlog carried
that promise. ADR-0001 then made *printing* a release gate for every element — so with no rule for how
a record becomes text, "opt-in per element" would have silently meant "never".

**The brief's premise was wrong.** It held that the CV writer sees claims (sentences) only and cannot
see a structured fact at all. In fact two routes already run in production:

- `buildTailorInput()` (`apps/api/src/preview.ts`) sends the tailor a `Roles:` block — title, employer,
  dates — separately from the claim sentences, and the `Draft` schema has matching structured slots
  (`experience`, `certifications`, `education`, `additional`). A structured record already prints on
  every CV this product has produced.
- `answerToClaim()` (`apps/api/src/grill.ts`) already turns a grill answer into a visitor-authored,
  Verified claim the tailor may render as prose.

So the question was never *which bridge to build*. It was **which bridge applies when** — and the
answer is provenance, not element type.

## Decision

### 1. The bridge is chosen by provenance, never by element type

| Where the substance came from | What the machine may do with it |
|---|---|
| **A stored structured part** — dates, employer, title | Reformat it, and **compute** on it ("3 years at HSBC"). Nothing more. |
| **The visitor's typed words** | Write it up as a proper CV line. The substance is theirs; the machine only dresses it. |

**Forbidden on both tracks: inventing precision** — a number, a team size, a scope the visitor never
gave. This is #128 §1 applied to output rather than input.

Computing is not invention: #126 already decided years-of-experience is computed from the dated
history, so forbidding arithmetic here would contradict a decision already taken. What arithmetic
cannot produce is a **verb about what the visitor did** — *"led product delivery at HSBC"* does not
follow from a date range.

**This replaces the obvious-looking rule that a fact prints in a compartment and never in prose.** That
rule is about the *page*, and the page is the wrong axis: it forbids writing up something the visitor
actually typed, which is both honest and wanted.

### 2. Thin input: propose the shape, never the substance

When the visitor's own words are too thin to sell, show the **finished CV line with its holes visible
and empty**, for them to fill:

> `Piloté [quel projet ?] chez HSBC, [équipe de combien ?], [quel résultat ?]`

Nothing is pre-filled. An empty hole does not print — the thin-but-true line prints instead.

This is how the product sells without inventing: it raises the visitor's *real* material faster,
rather than drafting plausible material for them to wave through.

### 3. A sentence that contradicts a corrected fact is held, never edited

The bullet says *"Two years leading the payments team at HSBC"*; the corrected record says three and a
half years at HSBC.

**The machine must not repair the number.** The visitor may have joined in 2019 and taken the payments
team in 2020 — both numbers true, measuring different things. Only the visitor knows which span a
number in their prose refers to, so repairing it is inventing precision *inside their own words*.

Therefore: the corrected fact prints, the conflicting sentence is **held aside — not deleted** — and
the visitor gets a precise question. It returns the moment they answer.

A CV is never printed in a self-contradicting state. This is #128 §6's *word-matches / evidence-prints*
with the gap surfaced as an actionable prompt, plus: the held sentence is never rewritten.

### 4. Placement: the labelled line by default, the summary when the advert tests it

A new kind of fact lands in the generic labelled line at the foot of the CV (`Languages: …`,
`Clearances: …`). **This is free** — `additional[].label/value` already exists and takes anything.

When an advert **tests** that fact, it also rises into the summary. It stays in its usual place too.

**This is why ADR-0001 clause 4's print gate is cheap.** A new element needs no CV-template design,
no new section, and no per-element placement argument.

### 5. The conservation lint watches declared facts too, and it speaks

`conservationIssues()` counts mined claims only, so a corrected or volunteered fact is invisible to it
and can be silently dropped. It must be extended to structured facts.

And the failure behaviour changes: today `tailorDraft()` retries once, then ships the lossy draft with
a `console.warn` nobody reads. **New behaviour: ship the CV, and tell the visitor in plain sight** —
*"Your Mandarin could not be placed on this CV, although the advert requires it."* Send anyway, or
retry; their call.

Without this, clause 4 of ADR-0001 is unfalsifiable: we could never tell whether *"it prints"* holds.

## What this rule does NOT change

**No element needs a renderable-sentence part.** Facts print through labelled compartments, so
[#130](https://github.com/adrien-mounier/jobcrush-app/issues/130)'s v1 element list inherits nothing
from this ADR, and ADR-0001 rule 1 (*own shape per element*) is untouched.

**Preferences still have no CV route** (ADR-0001 rule 5). This ADR governs facts only — a target
location or a minimum salary never prints.

## Consequences

**The real hole was plumbing, not design.** The CV writer receives neither corrections nor declared
facts today: `tailorDraft()` is called with the mined claims document and nothing else, and eligibility
never touches the CV renderers. A volunteered language currently cannot reach the CV **in any
position**. Building the route is the bulk of the work, and the largest single item is feeding the
`Roles:` block from the stored, corrected job records instead of the miner's original read — which is
what makes #128 §4's *"the tailored CV follows automatically"* true.

**There is no door for declaring a wholly new line on a job.** `GapType` is
`"missing-dates" | "needs-info"`, both derived from an already-mined claim. Clause 2 defines what
happens when the visitor types *"actually I also led X"*; the input itself does not exist yet.

**Our failures become visible to the visitor** (clause 5). Accepted knowingly: a warning that fires
often will damage trust, which is the correct incentive and gives us a number we do not currently have.

**Selling is bounded to four moves** — choose which true facts to show, place them, phrase them
strongly, and **ask** for what is missing. A competitor that invents will produce a better-looking CV
faster; that is a real commercial risk, accepted because a line that collapses at interview costs the
visitor the job and costs us the visitor.

## Alternatives rejected

| Rejected | Why it was attractive | What it cost |
|---|---|---|
| **Structured facts never print; they only inform** (the brief's option 3) | Cheapest and apparently safest. | Falsified by production code — roles already print. Choosing it means un-shipping working behaviour, and it breaks #128 §4 outright. |
| **Every element carries a visitor-authored sentence** (the brief's option 2) | Honest by construction. | Makes the visitor write prose to correct a date, adds a mandatory sentence part to every element, and re-creates the stale-derived-value failure: correct the fact, the sentence now lies. |
| **A named CV section per element** (clause 4) | Full control of appearance and prominence. | Every element becomes a CV-template change on top of ADR-0001's cost; at ten elements the CV leaves the two-page budget. |
| **Fixed placement, never promoted** (clause 4) | Predictable; nothing to build. | On the advert that demanded Mandarin, the deciding criterion sits in the last line and a ten-second scan never reaches it. |
| **Ask the visitor what to promote** (clause 4) | Total control of what is sent. | Twenty applications become twenty decisions — saving exactly that time is the product's promise. |
| **Propose a complete drafted line for approval** (clause 2) | Fastest, and the most persuasive-looking. | To propose, the machine must first invent a precision. A tired visitor approves a plausible falsehood that collapses at interview. The only option that crosses clause 1's forbidden line. |
| **Repair the stale number inside the sentence** (clause 3) | Zero friction; the CV stays whole and coherent. | The machine must guess which span the number measured. Guess wrong and it writes a falsehood in the visitor's own words, discovered at interview. |
| **Print both and flag the conflict** (clause 3) | Nothing lost; truest to "never amputate". | The CV contradicts itself on paper until answered, and can be exported in that state. A self-contradicting CV is disqualifying; a missing bullet is not. |
| **Refuse to produce the CV on a lint failure** (clause 5) | Makes ADR-0001 clause 4 mechanically enforceable. | A machine failure on a minor fact leaves the visitor with nothing, for our error. |
| **Keep shipping silently** (clause 5) | Smoothest; it is today's behaviour. | The visitor sends a CV missing the advert's deciding criterion without knowing. |

## Open, carried to the build ticket — not a decision

**Promoting several facts at once turns the summary into a checklist.** The summary is capped at 55
words. An advert testing four dimensions the visitor satisfies yields *"Product Manager, 8 years'
experience. Fluent Mandarin. Right to work in Singapore. PMP certified."* — true, complete, and it
sells nothing, with no words left for a concrete proof. The wanted shape weaves them in: *"Product
Manager, 8 years in payments. Delivered the checkout replatform two months early. Fluent Mandarin, PMP,
authorised to work in Singapore."* Both fit.

This is a **CV-writing rule**, not a data-model decision. Its home is
`docs/cv-brain/cv-authoring-rules.md`, to be written against real summaries when the build ticket is
written. It does not gate map #127.

## Verification

[#125](https://github.com/adrien-mounier/jobcrush-app/issues/125) — a volunteered language reaching the
CV — must be a **mechanical walk** through this ADR: track 2 → the `Languages` compartment (exists) →
promoted when the advert tests language → verified by the lint. If it turns into a fresh argument about
wording, this ADR is wrong and #135 reopens.
