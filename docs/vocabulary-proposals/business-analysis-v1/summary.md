# Vocabulary proposal: Business analysis (v1)

**Kind**: new job family
**Cluster**: business analysis — 5 labels from 1 distinct person (2× typed target role — the run's
only demand signal — plus 3 senior-BA past jobs). All labels arrived during the owner's own test
walks on 2026-08-20; the demand signal is real but single-source.

## What this family covers, and where its edge is

Analysing what a business needs and specifying what gets built: eliciting and documenting
requirements, mapping processes, writing functional specs / user stories / use cases, and
validating the delivered solution (UAT). Any industry; junior to lead; hybrid titles included
(requirements analyst, process analyst, digital/functional BA). **The edge, drawn on purpose:**
deciding *what* the business needs is inside; owning the delivery schedule stays with IT project
delivery, and owning the product vision stays with product management (both out).

## Evidence

- **Postings**: 4 postings from 4 distinct employers — DBS Bank (Hong Kong), altech (HK),
  TEKsystems (SG), ABeam Consulting (SG) — all captured 2026-08-20, all current (posted 2026-08-18),
  each with normalized requirements in the data file.
- **Market search words** (probed 2026-08-20, one quoted title per market):
  - HK: "business analyst" — **29** · "senior business analyst" — 4
  - SG: "business analyst" — **58** · "senior business analyst" — 2
  - VN: "business analyst" — **3**
  - AU: "business analyst" — **17** · "senior business analyst" — 7
- **Not measured (budget)**: nothing — the run stayed far under cap. NB "senior business analyst"
  measured **0 in VN** and is therefore *not proposed* for that market (the gate would refuse it).

## Evaluation grid (for owner arbitration — drafted by the agent, the bars are ADR-0014's)

Training cases: a plain "Business Analyst" and a "Senior Business Analyst - Banking" should come
back **confirmed** (strong same-family signals); a "Process Analyst" should come back **needs
clarification** (real overlap with operations work); an "Office Administrator" should come back
**unmapped**. Held-out cases: BA-insurance / digital BA / requirements analyst → **confirmed**;
"Data Analyst" and "Product Manager" → **needs clarification** (the two genuinely adjacent
occupations — dashboards-and-SQL and roadmap-and-vision are near misses, not members);
marine engineer / HR coordinator / sales director → **unmapped**.
(NB "needs clarification" is the evaluator's historical calibration bucket only — #231 deleted it
from the live placement contract.)

## Spend receipt (whole run, both proposals)

- Calls: **22** · Dollars: **USD 0.15** (145 postings fetched × USD 1/1000, priced from
  `posting-providers.json` at spend time)
- Which limit bound: **neither came close** — calls were fractionally the tighter cap (22 of
  1000/month ≈ 2.2%, vs USD 0.15 of 10.00 = 1.5%)
- Ledger note: these 22 calls bypass `provider_monthly_calls` (made outside the app). Vendor
  dashboard not readable from this session — worth a glance on the next RapidAPI login.

## Decision

- [x] **Approved** — owner, 2026-08-20 (#255 pilot run). Published as `apps/api/research/business-analysis-v1.json`; this folder keeps the summary as the decision record.
