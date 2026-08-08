# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Job seekers — eventually anyone anywhere; the four launch markets (Hong Kong, Singapore,
Vietnam, Australia) are the beachhead, not the boundary. **Nothing may hard-code the four
markets**: market-specific behaviour is data (a per-country page), and the absence of a page
means nothing happens. No narrower persona is binding — the IT-PM/banking CV corpus in
`docs/cv-brain/` is test data, not the target audience (owner, 2026-08-08).

## Product Purpose

Upload a CV → an audited, owned set of facts ("own your facts") → a tailored, ATS-aware CV
draft per job advert. Success means the user lands interviews they would not have landed
otherwise. **Business model: undecided — recorded as open; do not invent pricing, paywalls,
or plans** (owner, 2026-08-08).

## Positioning

The CV is treated as a marketing document. When an advert wants a signal the person lacks,
the product **proposes** a defensible stretch with a prepared interview narrative — it never
refuses and never moralises. The claim a neighbouring product could not truthfully copy:
**every machine decision is visible and correctable; the machine never adds and never removes
silently**; an approved stretch belongs to the one application it was approved for, so the
leak onto later applications is structurally impossible rather than policed.

## Operating Context

A person applies to many adverts; each application runs the mine → tailor → render preview
loop. The CV-reasoning source of truth is `docs/cv-brain/` (authoring rules, tailoring
reasoning, market research). Product decisions live in `docs/adr/` (ADR-0001…0011).
Confirmation gates are server-side: no export/submit route exists for unverified content.

## Capabilities and Constraints

- Shipped: signup (magic link + Google OAuth), CV import, confirm deck, grill, audited root
  CV with claim graph, job discovery deck, tailored preview pipeline.
- Hard CV rules: two-page cap; the conservation principle (tailor by emphasis, not
  amputation — `conservationIssues()` lint); ATS constraints (no two-column tops, contact
  never in header/footer, no pipe separators).
- Terminology of record: stretch, claim, grill, confirm deck, mute list, withholding pass,
  strip-list. Definitions in `CLAUDE.md` and `docs/adr/`.
- Open product facts: business model (above); formal accessibility standard (below).

## Brand Commitments

Name: **JobCrush**. Voice — **observed practice, deliberately NOT binding** (owner,
2026-08-08): plain short words, warm register, the machine speaks in first person ("things
you've told me"), costs stated plainly at the moment of change, never moralising. This is
the current habit and a good default; future work may evolve it deliberately rather than
treating it as locked.

## Evidence on Hand

- Real CV corpus: six CVs under `docs/cv-brain/` (IT-PM/banking, SEA markets) — test data.
- Market research: `docs/research/market-strip-lists.md` and companions.
- No testimonials, case studies, customers, or usage numbers exist — never fabricate any.

## Product Principles

1. **Propose, never police.** The product proposes stretches and never moralises; the human
   owns every claim on their CV.
2. **The machine never adds or removes silently.** Every change is visible, explained, and
   reversible for that one application.
3. **A check that finds nothing must be distinguishable from one that did not run.**
4. **Facts are permanent and the person's own; what prints is decided per application.**
5. **Markets are data, not code.** Market behaviour comes from a country page; no page means
   nothing happens.

## Accessibility & Inclusion

Reduced motion is honoured across shipped surfaces; keyboard and focus management exist on
shipped screens. No formal standard has been adopted — recorded as open, not assumed.
