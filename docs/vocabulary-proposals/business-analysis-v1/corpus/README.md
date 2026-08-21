# Floor corpus — business analysis

Kept per `docs/vocabulary-growth-runbook.md` §3.4: the adverts the demand counts were distilled
from, so every number in `../method-test-2026-08-22.md` can be re-checked rather than trusted.

Pulled 2026-08-22 for #260. Provider: techmap. 51 calls, USD 0.51 — the full receipt and the
per-title pull plan are in `_provenance.json`.

## Files

| File | What |
|---|---|
| `hk.json` `sg.json` `vn.json` `au.json` | The advert texts, one file per served market |
| `_provenance.json` | Probe counts per title/market, the pull plan, corpus arithmetic, spend |

## Each advert record

| Field | Meaning |
|---|---|
| `n` | Index into the de-duplicated corpus — the ID used throughout the write-up |
| `title` `company` `location` `sourceUrl` `datePosted` | As the provider returned them |
| `foundUnderTitles` | Which market-title probes this advert came back under |
| `inFamily` | `false` = a different occupation filed under the shared title "Business Analyst" (FP&A, BI reporting, pricing strategy, application support, contract admin, executive strategy). Excluded from the counts, kept here so the exclusion is auditable |
| `judged` | Per-item yes/no for the five candidate floor items, `null` for off-family adverts |
| `text` | The advert body, tag-stripped |

## Corpus arithmetic

```
117  adverts returned by the provider
-18  content duplicates (same advert re-listed under a different provider ID)
 99  distinct adverts        <- everything in these files
-19  off-family (inFamily: false)
 80  in-family               <- the denominator for every demand count
```

## The recognition rule the `judged` flags were applied with

An item counts for an advert if **the advert names that activity as a duty of the job or as a
required or preferred skill**. Naming the artefact as someone else's output does not count.

The rule was written before judging and applied to all 99 by reading. It is not in the runbook —
that it is missing is one of the run's findings.
