# What the structured CV read would cost per upload

_Research for [#160](https://github.com/adrien-mounier/jobcrush-app/issues/160), commissioned as a
blocker on the 11-ticket structured-fact build ([ADR-0003](../adr/0003-the-shared-parts-organisation-date-level.md),
[ADR-0004](../adr/0004-each-elements-own-parts.md)) because the owner set no cost ceiling on that
build ("accuracy wins") and recorded that as a real, unmeasured cash risk. This is a one-off
measurement — a prototype prompt run against the real corpus, then thrown away. No product code
changed to produce it._

## For the owner, in plain terms

Six real CVs were run through two things: **the CV reader we use today**, and **a stand-in for the
much fuller reader the new design calls for** — one that writes down every job, skill,
certification, language and education entry, with a note on exactly which words on the page each
one came from.

**What we measured: the fuller reader cost about the same as today's reader — a little less, on
average.** Today's reader averaged **21 cents** per CV upload; the fuller, structured reader
averaged **16 cents** — roughly **0.8×** today's cost, not several times more. On five of the six
CVs the structured reader was cheaper; on one (an unusually list-heavy CV) it ran about 25% higher.

**That is the good-news headline, but it comes with a real asterisk.** The tool used to run this
test (explained below) is not our production billing path, and it adds its own overhead on top of
the real cost. Correcting for that overhead, the best estimate of the *actual* production cost is
**about 18 cents today, about 13 cents for the fuller reader** — still comparable, still not the
feared multiple, but a second-hand estimate rather than a direct reading of a real bill.

**What would change this number:** the fuller reader stayed cheap by writing a short record per
fact (the text plus where it came from) rather than the long per-item record today's reader writes
for its own review-screen needs. If the real build ends up copying that longer record for every
new structured fact, the fuller reader would very likely become the more expensive of the two.

The rest of this document is the working behind that headline — how it was run, what it assumes,
and what it deliberately does not cover.

## Headline numbers

| | Today's reader (measured) | Structured reader (measured) | Multiple |
|---|---:|---:|---:|
| **Average cost per CV** | $0.2065 | $0.1598 | **0.77×** |
| Average, adjusted for the test tool's own overhead (estimate, see Assumptions) | $0.1794 | $0.1312 | **0.73×** |

Both multiples say the same thing: in this test, the fuller read was **not more expensive** than
what runs today — it came in a bit cheaper, on average, with one CV out of six as the exception.

## Per-CV cost (as measured)

Six real CVs from `data/cvs/`, same model (`claude-sonnet-5`) for every call.

| CV | Size | Today's reader | Structured reader | Multiple |
|---|---:|---:|---:|---:|
| 2024-Thomas Chauviere CV.pdf | 9,673 chars / 3 pages | $0.2496 | $0.3063 | 1.23× |
| ADRIEN MOUNIER SENIOR PROJECT MANAGER CV 2026.pdf | 8,412 chars / 3 pages | $0.2498 | $0.1583 | 0.63× |
| CV_Piierre_MOUNIER.pdf | 4,286 chars / 1 page | $0.1751 | $0.1148 | 0.66× |
| Giuliana_DELRE_Resume V3.pdf | 4,415 chars / 2 pages | $0.2082 | $0.1139 | 0.55× |
| Kulpakorn Ngamvijit CV.pdf | 4,352 chars / 1 page | $0.1426 | $0.1200 | 0.84× |
| Resume_Remy_IM_IT.pdf | 5,709 chars / 2 pages | $0.2138 | $0.1457 | 0.68× |
| **Average** | 6,141 chars | **$0.2065** | **$0.1598** | **0.77×** |

Token detail (averages across the six CVs): today's reader spent ~6,035 prompt tokens and
**~11,112 output tokens** per CV; the structured reader spent ~6,417 prompt tokens (near-identical
— same CV text, a longer instruction prompt) and **~7,822 output tokens** — noticeably fewer. The
gap is almost entirely on the output side; see "Why the structured read wasn't pricier" below.

## Assumptions — state these plainly enough to re-run later

- **Model:** `claude-sonnet-5` for every call, both readers, no exceptions.
- **LLM seam used: the Claude Code CLI fallback, not the Anthropic API.** No `ANTHROPIC_API_KEY` was
  set in this environment, so every call went through the same local-dev fallback
  `apps/api/src/llm.ts`'s `llmFromEnv()` already uses when no key is present — `ClaudeCliLlm`, which
  shells out to `claude -p`. **This is the most important caveat in this document** — it means
  these numbers are not a direct reading of what the production API bills. Two specific corrections
  were needed and are described below.
- **CLI flags:** `-p --output-format json --model sonnet --tools "" --strict-mcp-config
  --disable-slash-commands --system-prompt ""` — tools, skills, MCP servers and the default system
  prompt were all stripped as far as the CLI allows, to get as close as possible to the production
  driver's actual request shape (`AnthropicLlm.request()` sends no system prompt and no tools at
  all). Despite that, a **fixed, irreducible overhead of ~1,799 tokens per call** remained,
  measured directly with two calibration calls (a trivial "reply OK" prompt under the identical
  flags: 1,804 and 1,793 tokens). That overhead is baked into the "as measured" column above; the
  "adjusted" column subtracts it.
- **The CLI also prices every call with a cache-write premium** (it marks the whole prompt
  cacheable by default; the production driver never sets `cache_control` at all, so it never pays
  this). The "adjusted" column re-prices the same measured token counts at the plain, uncached
  standard rate instead.
- **Pricing:** the standard (non-promotional) `claude-sonnet-5` list rate — $3.00 / million input
  tokens, $15.00 / million output tokens — the same figures `apps/api/src/llmPricing.ts`'s own
  `DEFAULT_PRICING` uses, deliberately not the temporary $2/$10 introductory rate (running through
  2026-08-31 as of this writing), for the same reason that file gives: a number tied to a promotion
  goes stale the day it ends. Sourced from the `claude-api` skill, cached 2026-06-24.
- **Whether thinking was on: yes, and this is a real, unresolved gap against production.**
  `apps/api/src/llm.ts` explicitly disables thinking for this exact pipeline
  (`thinking: {type: "disabled"}`) on the API driver, with a comment explaining why: on a long CV,
  thinking tokens were eating the output budget and truncating the miner's JSON. The CLI exposes no
  equivalent switch, so these calls ran with Claude's default (adaptive) thinking on, and the CLI's
  aggregate usage report does not separate thinking tokens from final-answer tokens. Some share of
  the output-token figures above is thinking that a production call would not pay for. Not
  correctable with the data this run captured.
- **Prompt shape — today's reader:** the live `apps/api/prompts/claim-miner.md`, read directly from
  the repo at run time (not copied by hand), header-stripped the same way `miner.ts`'s
  `minerPrompt()` does. Unmodified.
- **Prompt shape — structured reader:** a new prompt written for this ticket only, never added to
  the repo, asking for one record per fact across the five elements
  [ADR-0004](../adr/0004-each-elements-own-parts.md) names (jobs, education, skills,
  certifications, languages), each with a verbatim source quote per ADR-0004 clause 1a (every
  structured fact points at its origin), dates carrying their own precision and a three-state end
  date per [ADR-0003](../adr/0003-the-shared-parts-organisation-date-level.md) clauses 5–6, a job's
  location with a resolved-country guess per ADR-0003 clause 7, a certification's validity state
  per ADR-0004 clause 5, and a language's level stored verbatim, never mapped to a rung, per
  [ADR-0008](../adr/0008-how-a-fact-arrives-read-worked-out-or-asked.md) clause 6. Skills carry no
  level field at all, per ADR-0004 clause 2. **This is this author's own reading of the decided
  shape, not a reviewed spec** — see "What this does NOT measure."
- **What was and wasn't included:** the full text of each PDF, extracted with the same library the
  product already uses (`pdf-parse`, via `apps/api/src/extract.ts`'s exact extraction call) — no
  new extraction code was written. One call per CV per reader (no retries fired; see below). All
  six corpus files happen to be PDFs, so DOCX/paste paths were not exercised.
- **Date of the pricing used:** 2026-06-24 (the `claude-api` skill's cached pricing table),
  cross-checked against `apps/api/src/llmPricing.ts`'s in-repo default, which agrees.

## Why the structured read wasn't pricier

This was the most useful thing to fall out of running the numbers, and it is a real content
finding, not a fluke of a lucky prompt:

- **Job and bullet coverage between the two readers is comparable, not one reader skipping
  content.** Spot-checked on the Adrien Mounier CV: the structured reader found 3 jobs / 31 bullets;
  today's reader found the same 3 jobs and 36 role-level claims. The structured read is not cheap
  because it captured less.
- **Both readers agree almost exactly on certifications and languages** — the two smallest,
  most enumerable elements. Remy's CV: 5 certifications, both readers. Every other CV: 0
  certifications, both readers, and identical language counts on all six. Neither reader is quietly
  dropping these.
- **The structured reader found noticeably *more* individual skills than today's reader** on every
  CV — e.g. Adrien: 21 vs. 4; Kulpakorn: 28 vs. 4. This is by design on both sides: today's miner's
  own rule explicitly allows batching an entire skill inventory into one claim ("one claim per
  group is fine") to protect its 15-decision review budget; the structured prompt asks for one
  record per skill unconditionally, which is the shape ADR-0004 actually decided on. So the
  structured reader is doing *more* work here, not less — and it still came out cheaper overall.
- **The reason it still came out cheaper: today's reader writes a heavier record per fact.** Each
  of its claims carries ten fields (id, semantic key, three field-slots, role, text, a
  machine-touch tag, a classification, a source quote, a grill flag and a grill hint) — machinery
  built for its own review-deck screen. The structured prototype's record is much shorter (the
  words as written, plus where they came from). That difference outweighs the extra skill records,
  on five CVs out of six.
- **The one CV where the structured reader cost more (Thomas Chauviere, 1.23×)** is the one this
  repo's own notes already flag as unusually list-heavy — many short named sub-projects nested
  inside job bullets (see the ADR-0009 corpus note in this repo's `CLAUDE.md`). Each short item
  became its own bullet-with-source-quote in the structured shape. Plausible, not independently
  re-verified here.
- **Neither reader's output was checked for correctness** — every count above is shape/coverage
  (how many jobs, skills, certificates, languages), never whether the extracted text is right.

## What this does NOT measure

Read this section before treating any number above as a committed budget line.

- **A real production API bill.** No API key was available; every call ran through the CLI
  fallback, which is not what a deployed upload uses. The "adjusted" column is a correction for the
  two differences that could be quantified (fixed harness overhead, cache-write premium) — it is a
  computed estimate, not a second real measurement.
- **The thinking-on-vs-off gap against production**, described above and left uncorrected.
- **Retry cost.** The production miner retries once, at full price, on a schema-validation failure.
  All twelve calls in this run produced valid JSON on the first attempt, so no retry cost appears
  here — a live pipeline will occasionally pay double on either reader.
- **Whether either reader's extracted facts are actually correct.** Only volume and shape were
  compared; nobody checked the JSON against the source CVs line by line.
- **The final structured-read schema.** The prompt used here is a prototype for this ticket, built
  from reading the ADRs, not a reviewed spec. A field-heavier final design (e.g. one that reuses
  today's classification/grill machinery per fact) would cost more, plausibly past 1× today's
  reader — see "What would change this number" above.
- **Anything beyond a single one-shot read.** This is the cost of the first extraction call only —
  not grill answers, corrections, re-uploads, or later tailoring calls.
- **Non-PDF uploads and non-corpus CVs.** All six corpus files are PDFs; DOCX and pasted-text input
  were not exercised, and this is six CVs, not a statistically representative sample.
- **Repeat-run variance.** Each CV/reader pair was run once. LLM output length (and therefore cost)
  varies call to call; this is a single sample per cell, not an average of repeated runs.

## Method (for re-running)

1. Extract full text from each of the six `data/cvs/*.pdf` files using the product's own
   `pdf-parse`-based extraction (same call as `apps/api/src/extract.ts`'s `extractText()`).
2. Build two inputs per CV: `${claim-miner.md content}\n${cvText}\n` (identical to
   `apps/api/src/miner.ts`'s `buildMinerInput()`) and `${structured-read prompt}\n${cvText}\n`.
3. Run each of the 12 inputs once through `claude -p --output-format json --model sonnet --tools ""
   --strict-mcp-config --disable-slash-commands --system-prompt ""`, capturing the CLI's own
   `usage` and `total_cost_usd` fields.
4. Calibrate the fixed per-call overhead with two no-op calls under the identical flags (a trivial
   prompt), average the two.
5. Compute the "adjusted" column by subtracting the calibrated overhead from
   (`input_tokens + cache_creation_input_tokens + cache_read_input_tokens`) and re-pricing the
   remainder plus `output_tokens` at the standard, uncached per-token rate.

No throwaway code from this exercise was added to the repository — the extraction script, the
structured-read prompt, and the raw per-call outputs lived entirely in a scratch directory outside
the repo and are not checked in.

## Judgment calls for the owner

1. **Is ~13–18 cents per upload (the adjusted estimate) an acceptable number** for the structured
   read, given no ceiling was set? It is comparable to — not several times — today's cost, contrary
   to the fear that motivated this ticket.
2. **The final schema is the lever that matters most.** Keeping structured facts to a short
   "words + source" record (as prototyped here) keeps cost at or below today's reader. Adopting a
   heavier per-fact record — closer to today's ten-field claim — would likely erase that advantage.
   Worth deciding deliberately when the schema is actually built, not by default.
3. **This estimate should be confirmed once a real production API key is available for a clean
   measurement** — the CLI-based correction here is a reasoned estimate, not a direct bill reading,
   and the thinking-on-vs-off gap in particular could not be corrected for at all.
