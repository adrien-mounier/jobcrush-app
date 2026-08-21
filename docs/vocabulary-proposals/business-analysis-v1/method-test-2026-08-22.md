# Method test: the written family-research method, run on Business Analyst

_#260. A dry run of `docs/vocabulary-growth-runbook.md` §3 on a family the owner has already
approved. **This is a test of the method, not a correction of v1.** v1 stands until the owner says
otherwise._

> **A note on dates.** This file, its filename and `corpus/_provenance.json` say 2026-08-22, the
> session's working date. The probe and pull files themselves record **2026-08-21** (machine clock,
> ~20:00 UTC); the two disagree by a timezone or clock offset. Nothing in the findings depends on
> which is right, but the published `measuredOn` fields carry **2026-08-21**, because that is what
> the instrument actually recorded and that field exists to be audited. See
> `../family-rename-2026-08-21.md`.

## The short version

The method reproduces v1's four items. All four clear both thresholds, and nothing in the ranked
list argues v1 is wrong.

But the run found **three holes in the written method** that decided the answer. Two of them changed
which items cleared the bar, and neither is written down anywhere:

1. **The corpus is polluted by the shared job title.** 19 of 99 adverts filed under "Business
   Analyst" are a different occupation (financial planning, BI reporting, pricing strategy,
   application support). §3.2 says pull every advert filed under a title that measured above 0, and
   has no step for throwing the wrong ones back. Left in, they drag every count down by 14–18
   points and push v1's fourth item off the floor.
2. **"Count" is never defined.** §3.3 writes the two thresholds precisely and never says how you
   recognise that an advert is asking for a thing. On the same corpus, a strict reading and a
   generous one put `requirements elicitation` at 40% or 63% — the difference between off the floor
   and on it.
3. **The same advert arrives more than once.** 117 adverts pulled were 99 distinct ones; the
   duplicates are re-listings under different provider IDs. Nothing in §3.2 says to de-duplicate,
   and the inflation is not evenly spread.

One measured claim in the runbook is now **falsified**: §3.3 says SQL clears the bar for business
analysis. It does not — SQL is named in 20% of in-family adverts, nowhere near 50%.

## The full ranked list

Corpus: **80 in-family adverts** (99 distinct, 19 off-family excluded — see below).
Thresholds as written in §3.3: on the floor at **≥50% of the whole corpus**, off it if **any market
with 10+ adverts is below 30%**.

| # | Item | Demand count | HK | SG | AU | Verdict |
|---|---|---|---|---|---|---|
| 1 | requirements elicitation | **76 of 80 — 95%** | 100% | 96% | 93% | on the floor |
| 2 | process mapping / analysis | **68 of 80 — 85%** | 65% | 96% | 86% | on the floor |
| 3 | solution validation (UAT) | **65 of 80 — 81%** | 85% | 93% | 66% | on the floor |
| 4 | analysis to specification | **64 of 80 — 80%** | 70% | 82% | 83% | on the floor |
| 5 | stakeholder facilitation | **41 of 80 — 51%** | 30% | 46% | 72% | clears, but see the warning |

Nothing else cleared. The next items down, with their counts, kept because they are the natural
first candidates for a future version:

| Item | Count | Why it failed |
|---|---|---|
| jira | 19 of 80 — 24% | below 50% |
| **sql** | **16 of 80 — 20%** | below 50% — see "the ADR-0015 answer" |
| confluence | 14 of 80 — 18% | below 50% |
| excel | 11 of 80 — 14% | below 50% |
| visio / BPMN tooling | 8 of 80 — 10% | below 50% |
| BI tools (Power BI, Tableau) | 8 of 80 — 10% | below 50% |
| python | 3 of 80 — 4% | below 50% |

**Item 5 is not safely established.** It clears both bars by the smallest possible margin — exactly
51% of the corpus, and Hong Kong at exactly 30%, which passes only because the rule says *below*
30%. It is also the one item that fails both robustness checks below. Treat items 1–4 as measured
and item 5 as unresolved.

## Side by side with what v1 shipped

| v1 item | Did the method find it? |
|---|---|
| 1. requirements elicitation | **Yes — 95%, the strongest item in the family.** |
| 2. analysis to specification | **Yes — 80%.** |
| 3. stakeholder facilitation | **Yes, barely — 51%,** and unstable under both checks. |
| 4. solution validation | **Yes — 81%.** |
| — | The method also surfaces **process mapping at 85%**, which v1 folds into item 2 rather than asking separately. It is the second-strongest signal in the family. |

**Outcome shape: same four items.** Per the ticket, that means the method is proven well enough to
use on the next family — with the three fixes below applied first.

## The ADR-0015 answer: no equipment item cleared

ADR-0015 says a tool is judged by its demand count like anything else, and the count wins over any
hand-written "skills aren't occupations" rule. This is the first real test of that, and the count
says **no tool belongs on the Business Analyst floor**. SQL, the runbook's own worked example of a
tool that clears, reaches 20%.

The mechanism is right and worth keeping — it just did not fire here. The runbook sentence claiming
SQL clears needs correcting, because it currently reads as a measured fact and is not one.

## How much to trust item 5: two robustness checks

**Check 1 — does the off-family exclusion decide the answer?** Yes, for one item.

| Item | In-family corpus (80) | Whole corpus (99, the runbook as literally written) |
|---|---|---|
| requirements elicitation | 95% | 77% |
| process mapping | 85% | 69% |
| solution validation | 81% | 66% |
| analysis to specification | 80% | 65% |
| stakeholder facilitation | **51%** | **41% — falls off the floor** |

Items 1–4 survive either way. Item 5 exists only because the off-family adverts were removed, by a
step the method does not currently contain.

**Check 2 — were the counts still moving at the cap?** Yes, for the same item.

Singapore's "business analyst" measured 58 adverts and was cut to 50 by §3.2's cap, so this is the
one place the cap bound. Comparing the first half of the Singapore corpus with the second:

| Item | First half | Second half | Movement |
|---|---|---|---|
| requirements elicitation | 100% | 93% | stable |
| solution validation | 93% | 93% | stable |
| process mapping | 100% | 93% | stable |
| analysis to specification | 79% | 86% | stable |
| stakeholder facilitation | **57%** | **36%** | **21 points — still moving** |

§3.2 requires this to be said out loud rather than buried: for four of five items the cap is
comfortably past the point where more reading changes anything. For item 5 it is not, and the run
cannot tell you where it settles.

## Markets

| Market | Adverts pulled | In-family | Votes? |
|---|---|---|---|
| Singapore | 33 | 28 | yes |
| Australia | 36 | 29 | yes |
| Hong Kong | 26 | 20 | yes |
| Vietnam | 4 | 3 | **no — under 10, informs the reading but does not vote** |

Vietnam is genuinely that thin: the whole market carried 4 adverts under "business analyst" and 0
under every other title probed. Its three in-family adverts are consistent with the floor above,
but three adverts cannot carry a vote and were not given one.

## What was measured, and what the market words say

Probed 2026-08-22, one quoted title per market, advert counts as the provider reported them:

| Title | HK | SG | VN | AU |
|---|---|---|---|---|
| business analyst | 34 | 58 | 4 | 46 |
| senior business analyst | 10 | 3 | 0 | 16 |
| requirements analyst | 0 | 0 | 0 | 0 |
| process analyst | 0 | 0 | 0 | 0 |
| functional analyst | 0 | 0 | 0 | 0 |
| business systems analyst | 0 | 0 | 0 | 0 |
| system analyst | 9 | 1 | 0 | 0 |
| systems analyst | 1 | 2 | 0 | 1 |

Two things the owner should see here:

- **Three of v1's five published aliases measure 0 adverts in every served market** — requirements
  analyst, process analyst, functional business analyst. That is not a fault: aliases are hint-only
  and are never sent to a provider or gated on advert counts (#258). It does confirm the market
  files this work almost entirely under one phrase.
- **"Senior business analyst" is a strict subset of "business analyst"** — the provider matches the
  phrase, so every senior advert is already inside the broader pull. Probing and pulling it
  separately cost 5 calls and added almost nothing. Worth knowing before budgeting the next family.
- **"System analyst" is a real, thin, separate title** (9 in HK). It was measured and then
  **excluded** from the corpus: v1's approved scope sentence does not name it, and widening the
  family is not this ticket's job. Flagging it as a question for the owner, not acting on it.

## The three fixes the method needs before the next family

1. **Add a relevance step to §3.2.** After pulling, judge each advert against the cluster's own
   scope sentence and set the off-family ones aside — kept in the corpus folder, marked, not
   counted. Without it the counts measure the job title, not the occupation, and the pollution rate
   here was 19%.
2. **Write the recognition rule into §3.3.** The one this run used, which held up across 99 adverts:
   *an item counts for an advert if the advert names that activity as a duty of the job or as a
   required or preferred skill; naming the artefact as someone else's output does not count.* Any
   rule would be better than none — the gap is that the choice is currently invisible and swings
   results by 20+ points.
3. **De-duplicate by content, not by provider ID, in §3.2.** 18 of 117 adverts here were
   re-listings of an advert already in the corpus.

Also worth a small edit: **correct the SQL sentence in §3.3**, which asserts as fact something this
run measured to be false.

## The two decisions this unblocks

**1. The floor's length.** Here is the curve, which is the thing #259 deliberately waited for:

```
95% ############################  requirements elicitation
85% #########################     process mapping
81% ########################      solution validation
80% ########################      analysis to specification
51% ###############               stakeholder facilitation   <- knife-edge, unstable
24% #######                       jira
20% ######                        sql
```

The gap is not between 4 and 5 items — it is between **80% and 51%**. Four items sit in a tight
band with nothing between them, then a 29-point cliff, then a long tail of tooling. If the owner
wants a rule for where to cut, this family suggests cutting at the cliff rather than at a fixed
number. On this evidence a floor of four is the natural read, and it is what v1 already ships.

**2. Whether v1 needs a v2.** On this run: **no.** All four shipped items clear. Nothing in the
ranked list contradicts v1's scope or its edge. The only candidate for a v2 conversation is whether
process mapping (85%) deserves its own question rather than living inside item 2's wording — a
genuine question, but an improvement, not a defect, and one that would cost a full paid
re-measurement of all four markets under the #244 gate.

## Spend receipt

- **Calls: 51** (24 probes + 8 follow-up probes + 19 corpus pulls) · **510 postings fetched**
- **Dollars: USD 0.51**, priced from `apps/api/data/posting-providers.json` at spend time
  (techmap, `perThousandPostings` @ USD 1)
- **Which limit bound: neither.** Calls were the tighter of the two — 51 of 1000/month = 5.1%,
  against USD 0.51 of the USD 10 petty-cash float = 5.1%. Both far from binding.
- The ticket estimated ~15 calls / USD 0.15 for §3.2; the pull came in at 19 calls, and the probe
  round the ticket did not price added 32 more.
- **Ledger note:** these 51 calls were made outside the app and bypass `provider_monthly_calls`, so
  the internal counter now reads 51 low against the vendor's. Vendor dashboard not read from this
  session.

## Evidence kept

`corpus/` holds all 99 distinct adverts, one file per market, each with its source URL, employer,
posting date, which titles it was found under, whether it was judged in-family, and its per-item
judgment. `corpus/_provenance.json` carries the probe figures, the per-title pull plan and the
spend. Every number in this document can be recomputed from those files.

## Decision

- [ ] Method proven — apply the three fixes to the runbook, then use it on the next family
- [ ] Method proven as-is — record the three findings but change nothing
- [ ] Not proven — annotate and return
