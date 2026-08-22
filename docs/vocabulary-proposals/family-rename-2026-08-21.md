# Both families renamed after the role, not the activity — v2 publication record

_Owner instruction, 2026-08-21, out of #260's write-up. Not a research pass and not a re-scoping:
a rename, shipped as a version because the label is placement-affecting data. This file is the
**spend receipt and measurement record** the standing budget rule requires — it exists because
`/qa-gate` found the new market numbers had no receipt anywhere (Finding B)._

## What changed

| | Was | Now |
|---|---|---|
| `business-analysis` | "Business analysis" (v1) | **"Business Analyst"** (v2) |
| `it-project-delivery` | "IT project delivery" (v1) | **"IT Project Manager"** (v2) |

The owner's words: *"We call this role 'business analyst' not 'analysis', it is not a role name
describing someone['s] role. The same way we don't say Product Ownership, we say Product Owner."*

`familyId` is deliberately **unchanged** on both. It is an internal key that stored placements,
eligibility facts and the labeler's closed vocabulary all reference; renaming it would orphan
existing data and buys nothing, because no visitor ever sees it.

## Why a version and not an edit in place

#258 decision 3 allows amending a live family in place only for publication data that **cannot**
change a family placement. A label can: it is injected into the labeler's own prompt
(`familyLabeler.ts` `describeFamilies` → `### {label}`) and matched by question 1's type-ahead
(`discoveryEngine.ts` `matchesQuery(floor.label)`). So it takes a version.

Stored placements keep the version they were made under (ADR-0014 decision 7), so anyone already
placed is untouched; v2 reaches new placements only. **Every version is loaded at boot, oldest
first** — dropping v1 would strand every placement already made against it. The runbook's §6.2 says
"point the existing load at the new file", which would have done exactly that; it is wrong and is
ticketed as part of #261.

## Spend receipt

Both families needed freshly measured market words — #244 refuses a re-publication carrying copied
measurements, and refuses it on **dates**, so the numbers below are recorded here to make them
auditable as well as fresh.

- **Business Analyst**: reused the probes already made for #260's research run. **0 additional calls.**
- **IT Project Manager**: needed its own. **8 calls · 80 postings · USD 0.08.**
- Priced from `apps/api/data/posting-providers.json` at spend time (techmap,
  `perThousandPostings` @ USD 1). **Neither limit bound** — 8 of 1000 calls/month = 0.8%.
- **Session total across #260's research and this rename: 59 calls · 590 postings · USD 0.59.**
- **Ledger note:** all of these were made outside the app and bypass `provider_monthly_calls`, so
  the internal counter reads 59 low against the vendor's. Vendor dashboard not read this session.

### The numbers, as the provider reported them (probed 2026-08-21)

**IT Project Manager** — the published title set is unchanged from v1; only counts and dates moved.
"delivery manager" measured above 0 in all four markets but is published for **AU only**, exactly as
v1 had it: adding a market word changes what the product searches, which is not a rename.

| Market | Title | Adverts | Published? |
|---|---|---|---|
| HK | project manager | 29 | yes |
| HK | delivery manager | 3 | no — not in v1's set |
| SG | project manager | 95 | yes |
| SG | delivery manager | 6 | no — not in v1's set |
| VN | project manager | 15 | yes |
| VN | delivery manager | 1 | no — not in v1's set |
| AU | project manager | 104 | yes |
| AU | delivery manager | 3 | yes |

**Business Analyst** — same title set as v1; full probe table, including the titles that measured 0
and the ones deliberately excluded, is in
[`business-analysis-v1/method-test-2026-08-22.md`](business-analysis-v1/method-test-2026-08-22.md).

| Market | Title | Adverts |
|---|---|---|
| HK | business analyst · senior business analyst | 34 · 10 |
| SG | business analyst · senior business analyst | 58 · 3 |
| VN | business analyst | 4 |
| AU | business analyst · senior business analyst | 46 · 16 |

### A date correction, recorded rather than quietly fixed

The publications were first stamped `measuredOn: 2026-08-22`. Every probe file actually records
**2026-08-21** (machine clock, 20:20 UTC), and the session's own working date was 2026-08-22 — the
two disagree, probably a timezone or clock offset. `measuredOn` means *the advert day the probe
sampled*, and the only evidence of that is what the instrument recorded, so both publications now
carry **2026-08-21**. It still satisfies #244 (business-analysis v1 was 2026-08-20;
it-project-delivery v1's newest was 2026-08-14). Flagged here because a field that exists to be
audited should never carry a date nothing recorded.

## What was NOT byte-identical to v1, and why

Everything except the label, the version, the market measurements and the review stamp is unchanged
— **with one deliberate exception.** `business-analysis`'s scope drew its own edge by naming the
sibling family: *"owning the delivery schedule (IT project delivery)"*. Left byte-identical, the
labeler prompt would have read `### IT Project Manager` in the heading and the old name twenty
lines below, in the sentence the prompt marks as deciding the family. That is now
*"(IT Project Manager)"*. Found by `/qa-gate` (Finding A), not by the build assertion, which was
only checking that nothing changed — not that everything that should change had.

## The accepted risk — MEASURED, and it did not land

"IT Project Manager" names a family whose scope deliberately covers scrum master, agile coach,
delivery lead and release manager. The owner was told a single-role name may read as narrower than
the family is — to the labeler and to a visitor — and chose it anyway.

**The 64-case labeler grid was run against the renamed prompt on the production model**
(`accounts/fireworks/models/minimax-m3`, the model `familyPlacementLlm()` actually wires — not a
stand-in). **It passes every bar ADR-0014 sets:**

| Measure | Result | Bar |
|---|---|---|
| Comparable accuracy | **97.8%** | 95% |
| Stranger recall | **94.7%** | 90% |
| False-unknown rate | **0.0%** | 5% |
| Confidence accuracy | 66.7% | reported, no bar |
| Placements naming >1 family | 8 | watched, no cap |

**The rename did not narrow placement.** 19 of the 64 cases are exactly the titles at risk — Scrum
Master, Scrum Coach, Release Manager, Technical/Solution/Digital Delivery Manager, four Delivery
Leads, IT Programme Manager, and the dual-family Product Owner cases. **All 19 passed.** The two
misses are neither of them a narrowing:

- **`amb-07` "Delivery & Product Operations Lead"** — expected `it-project-delivery` alone, got
  `it-project-delivery + product-management`. A *widening*, on the synthetic two-family vocabulary,
  and the case's own note records that the bake-off models split 5–3 on it.
- **`str-13` "Business Analyst"** — expected `unmapped`, got `confirmed (business-analysis)`.
  **This is not the rename's doing, and it was proven rather than assumed.** Re-running that single
  case against the OLD v1 labels (`"Business analysis"` / `"IT project delivery"`) returns
  `confirmed (business-analysis, v1), certain`. The expectation went stale on **2026-08-20 when
  #255 published the second family** — the grid file was last touched at `34bdd3c` (#231,
  2026-08-15), and its own `vocabularies.published` description still reads *"it-project-delivery v1
  alone"*. It went unnoticed for two days because the eval lane is deliberate and never runs on a
  push. **It is owner-arbitrated data (ADR-0014: drafted by the agent, arbitrated by the owner), so
  it has not been silently flipped** — filed for the owner instead.

**Cost: USD 0.05** — 64 cases plus one attribution call, priced from the repo's own measured figure
for this model (`eval/bakeoff-result.json`: MiniMax M3 at **USD 0.04889 per 60 cases**, 84,753 in /
19,557 out). Note for anyone re-quoting this: it was first estimated at ~USD 0.65 by applying a
frontier-tier price to a Fireworks model — **13× too high**. Price the labeler from
`bakeoff-result.json`, not from an Anthropic tariff.
