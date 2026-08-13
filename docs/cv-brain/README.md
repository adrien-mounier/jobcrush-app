# CV brain — the product's CV-tailoring reasoning (forked, self-contained)

> **Decision (2026-07-18): this repo now owns the CV brain.**
>
> The CV-tailoring reasoning (how to mine a CV into claims, classify them, tailor them to a role,
> and write good CV prose) originated in the **JobCrush** repo, where it was developed and tested on
> the maintainer's own real job applications. On 2026-07-18 it was **forked**: the reasoning + research
> below were copied here once, JobCrush was **frozen** (it keeps running the maintainer's personal
> pipeline but gets no new CV-logic work), and from now on **this copy evolves independently with the
> product.** There is no sync back to JobCrush — the two are different products (JobCrush tailors one
> known, curated CV; jobcrush-app tailors arbitrary strangers' uploads at scale), so they are *meant*
> to diverge. This is a fork, not a duplicate to keep in step.
>
> **Consequence to remember:** do CV-reasoning work **here**, never in JobCrush. If JobCrush ever needs
> an improvement made here, port that one insight by hand — never re-establish a two-way sync (that is
> exactly the drift that caused the JC-2 rating failure). See JobCrush `docs/boundary-with-jobcrush-app.md`.

## Why this exists

This folder makes the product **self-contained**: everything the tailoring pipeline reasons from lives
here, so jobcrush-app has no runtime or authoring dependency on the JobCrush checkout existing.

## What the pipeline code implements from this

- `apps/api/prompts/claim-miner.md` — mines a raw CV into claims, one per printed line, compound
  lines kept whole (#208; implements the classification levels in `tailoring-reasoning.md` §3 and
  the section-coverage discipline).
- `apps/api/prompts/preview-tailor.md` — tailors the claims into a draft (implements the density,
  conservation, and writing-style rules in `cv-authoring-rules.md` and `tailoring-reasoning.md`).
- `apps/api/src/preview.ts` — the canonical Draft schema + `conservationIssues()` lint (the mechanical
  enforcement of "tailor by emphasis, not amputation").

When you change any of those, this folder is the reference they must stay true to — and a change to the
*rules* means editing this folder too, since it is now the source of truth.

## Contents

| File | What it is |
|---|---|
| `tailoring-reasoning.md` | The reasoning framework: role taxonomy, content classification, decision rules, gap handling, conservation principle. |
| `cv-authoring-rules.md` | The canonical CV output + writing-style rules (ATS compliance, length/density, formatting, banned words). |
| `research/2026-05-03_ats-parsing-pitfalls.md` | How ATS parsers break CVs and how to avoid it. |
| `research/2026-05-03_it-pm-cv-best-practices.md` | IT PM CV length, bullet formula, 2026 trends. |
| `research/2026-05-09_ai-writing-tells.md` | Banned-word and banned-opener lists (avoid AI-sounding prose). |
| `research/2026-06-09_cv-formatting-design-standards.md` | Visual formatting and section-design standards. |
| `templates/example_tailoring.md` | Worked tailoring example. |
| `templates/tailoring_report.md` | Tailoring-report template. |
| `templates/job_offer_intake.md` | Job-offer intake template. |

_Dated filenames are kept as-is from JobCrush for provenance; the dates are authoring dates, not
freshness stamps — the content is evergreen._
