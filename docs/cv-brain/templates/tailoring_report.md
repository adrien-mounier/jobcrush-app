# Tailoring Report Template

Use this template for every tailoring run. Saved inside the offer's own folder as `job_offers/YYYY-MM-DD_company_jobtitle/report.md` (per-offer container, CLAUDE.md §9; `report_vN.md` for re-runs).

---

```markdown
# Tailoring Report — {company} / {job_title}
Date: {YYYY-MM-DD}
Offer: {path to offer file}
CV: {path to tailored CV}
Dominant framing: {Project Manager | Product Owner | Product Manager | Hybrid}

## Match Summary
- Strong matches:
  - {requirement} → {evidence from source}
- Partial matches:
  - {requirement} → {adjacent evidence}
- Gaps:
  - {requirement} → not evidenced in source

## User-confirmed additions
- {skill / tool / experience} — confirmed by candidate on {YYYY-MM-DD}; persisted to {/context/file.md}; used in {section of CV}.

## Keyword Coverage
- Covered: [{keyword}, ...]
- Not covered (truthfully omitted): [{keyword}, ...]

## Intentional Omissions
- {item} — reason: {not in source | not relevant to role | redundant}

## Ambiguities
- {note any role ambiguity and the chosen framing}

## Follow-up Questions
1. {question to candidate to close a gap}
2. {question to candidate to confirm a partial match}

## Suggested Persistence
- Add to /context/: {confirmed facts worth keeping for future runs}
```
