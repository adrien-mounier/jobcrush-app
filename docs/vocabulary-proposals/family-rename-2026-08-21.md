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

## The accepted risk, recorded

"IT Project Manager" names a family whose scope deliberately covers scrum master, agile coach,
delivery lead and release manager. The owner was told a single-role name may read as narrower than
the family is — to the labeler and to a visitor — and chose it anyway. That is a decision, not a
defect. What the evidence says so far: the four aliases still resolve to the family and are offered
its market titles at question 1, the scope sentence the prompt calls decisive still names all four
as inside, and the prompt delta is two heading lines. The instrument that would measure it properly
is the 64-case labeler placement grid (`pnpm --filter @jobcrush/api eval:labeler`, ~USD 0.65).
