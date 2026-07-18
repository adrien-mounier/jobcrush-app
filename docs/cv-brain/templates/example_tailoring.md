# Worked Example — Full Tailoring Flow

This example illustrates the end-to-end tailoring workflow for a typical offer.

---

## Input — `job_offers/2026-05-03_acme_senior-product-owner.md`

```
Senior Product Owner — Acme SaaS (Paris, hybrid)
Permanent. We are looking for a Senior PO to own the backlog of our billing
platform. You will work with engineering, finance, and customer success to
prioritize features, refine user stories, and run sprint ceremonies. Required:
5+ years in Product Owner role, Scrum, Jira, strong stakeholder management,
fluent English. Nice to have: SAFe, billing/FinTech background, SQL.
```

## Extracted requirements

- **Hard**: 5+ years PO experience, Scrum, Jira, stakeholder management, fluent English.
- **Preferred**: SAFe, billing or FinTech domain, SQL.
- **Domain signals**: SaaS, billing platform, finance/CS stakeholders.

## Tailoring logic

- Promote PO bullets that show backlog ownership, refinement cadence, and ceremony facilitation.
- Use **Product Owner** dominant framing per §10 of CLAUDE.md.
- If billing/FinTech is in source, promote it. Otherwise list as gap.
- If SAFe is in source, include explicitly. Otherwise omit silently and flag in report.
- Include "Jira" in tools only if present in source.

## Expected outputs

- `job_offers/2026-05-03_acme_senior-product-owner/tailored_cv/cv_mounier_acme_senior-product-owner_v1.md`
- `job_offers/2026-05-03_acme_senior-product-owner/report.md`
