# Candidate job families — the standing list of occupations we know we do not cover

_The input to §2 of `../vocabulary-growth-runbook.md`, where the owner picks which clusters get
researched. **The owner picks; this list only makes sure nothing already known gets forgotten.**_

Two families are published today: **Business Analyst** (`business-analysis`) and **IT Project
Manager** (`it-project-delivery`). Everything else a visitor types comes back **unmapped**, which is
the honest answer and the thing that feeds the vocabulary-growth loop.

This file exists because candidates were being recorded in whichever document happened to discover
them — a rejected proposal's summary, a method write-up, a grid note — and a run that reads only the
unmapped-label feed would never see them. **A candidate found by reasoning is worth as much as one
found by the feed, and is easier to lose.**

## How a candidate gets on this list

Anything that meets one of these:

- A real occupation the labeler has nowhere honest to put, found while doing something else.
- An occupation the published scope deliberately excluded, with the exclusion recorded.
- A cluster the unmapped-label feed surfaced that the owner did not pick yet.

**Being on this list is not a decision to research it.** Research costs provider money and owner
review time, and §2 is explicit that the owner picks with no automatic threshold. This list is the
shortlist, not the queue.

---

## 1. Data / business intelligence

**Added 2026-08-21** (owner, out of #263/#265). The strongest candidate on this list, because it is
the one actively causing a wrong answer today.

**What it is:** working with data to describe what has happened — extracting and modelling data,
building dashboards and reports, defining metrics. Titles seen in the market: Business Intelligence
Analyst, Data Analyst, Analytics Analyst, MIS Analyst, Reporting Analyst.

**Why it is not Business Analyst work, measured rather than asserted.** #260's floor corpus, narrowed
to the 7 adverts that are purely BI / dashboard / reporting:

| Does the advert ask for it? | Business Analyst adverts (n=80) | Pure BI adverts (n=7) |
|---|---|---|
| Elicit requirements | 48% | **0 of 7** |
| Write a specification | 59% | **0 of 7** |
| Run workshops | 60% | 7% |
| Validate / UAT | 65% | 7% |

A business analyst works with **people** to decide what should change. A BI analyst works with
**data** to describe what happened. Different problems, different tools — and the overlap is real
enough that one person often does both, which is why the titles read as interchangeable.

**Evidence it exists in our own markets, already paid for.** #260 measured, and did NOT publish,
these titles while probing business analysis:

| Title | HK | SG | VN | AU |
|---|---|---|---|---|
| system analyst | 9 | 1 | 0 | 0 |
| systems analyst | 1 | 2 | 0 | 1 |

Thin on those exact words, but the occupation is much wider than them — BI/reporting was one of the
largest off-family groups in the corpus (part of the 19 of 99 adverts filed under "Business Analyst"
that were a different job). **A run on this family would need its own §3.1 probe round**; the numbers
above are not a market measurement of the family, only of two adjacent titles.

**What it is costing now:** #265 — a BI analyst typing their role is confirmed into Business Analyst
and then interviewed on requirements elicitation and UAT. Publishing this family is the clean fix;
#265 is the honest answer in the meantime.

## 2. Product management

**Added 2026-08-21, recording a decision already made** (owner, 2026-08-20, on the rejected
`it-project-delivery` product-ownership widening).

**What it is:** owning what gets built and why — the backlog, sprint and release priorities, the
product vision. Titles: Product Owner, Product Manager.

**Why it is a family and not a widening.** The owner **rejected** widening IT project delivery to
swallow product ownership. That proposal's own summary states the reason: the delivery family's floor
questions stay delivery-shaped (own delivery end to end, control risks), and *"a product owner can
answer them, but from the edge of their role, not its centre. If POs deserve their own questions, the
honest home is a future product-management family instead."* That is the same argument as data/BI —
a family is a shared set of questions, and borrowing another family's questions serves nobody.

**Evidence it exists:** 3 unmapped labels from 3 distinct sessions (all past jobs, 2026-08-20).
⚠️ **Honesty note carried from that proposal:** the three sessions are almost certainly the owner's
own test walks with the same CV, so the "3 people" weight is not organic demand.

**Already load-bearing in the test grid**, which is worth knowing before anyone researches it: the
labeler grid uses a **synthetic** `product-management` family for its `two-family` cases (defined in
`familyLabeler.eval.ts`, never in the production registry). Publishing a real one changes what those
cases measure — expect grid work alongside the proposal.

Also on the grid, as a stranger: `str-10` "Product Manager" → unmapped, noted as *"a real family, not
a published one — unmapped is the honest answer."* That expectation becomes wrong the day this
family publishes, exactly as `str-13` did when Business Analyst published (#263). **Whoever
researches this family owns that grid update.**

---

## The lesson #263 wrote into this file

`str-13` "Business Analyst" expected **unmapped** and was correct — until #255 published the analyst
family on 2026-08-20 and nobody revisited it. It carried a wrong expectation for two days, unnoticed,
because the eval lane is deliberate and never runs on a push.

**Publishing a family silently changes what every stranger case is being asked.** So: whoever
publishes a family from this list re-runs the labeler grid (~USD 0.05) and re-arbitrates any stranger
case that names the newly published occupation. That is part of publishing, not a follow-up.
