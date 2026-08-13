# What the structured CV read would cost per upload — and per fact

> ✅ **THIS DOCUMENT WAS RE-RUN AND REPLACED, 2026-08-12, on the real production API
> ([#196](https://github.com/adrien-mounier/jobcrush-app/issues/196)).**
>
> Everything below the banner is the **new** measurement. It supersedes
> [#160](https://github.com/adrien-mounier/jobcrush-app/issues/160)'s headline (`0.77×`), which was
> correctly computed but **confounded across two dials** and measured on the Claude Code CLI rather
> than the production billing path. #160's numbers are preserved, clearly marked, in
> [Appendix — the superseded #160 measurement](#appendix--the-superseded-160-measurement); there is
> deliberately only one document, and this is it.
>
> **What changed, in one line: the cell the product actually needs was measured, and it is cheap.**
> *Per-decision × rich* — many records, each carrying the full field set ADR-0003/0004/0008 require —
> costs **$0.1016 per upload against today's miner's $0.2105**, i.e. **less than half**, on 48 real
> API calls with thinking disabled.
>
> 🚨 **Amended 2026-08-13 by [#202](https://github.com/adrien-mounier/jobcrush-app/issues/202) with
> the accuracy result, which changes the recommendation.** Measured against an answer key rather than
> against each other, **the fuller reader captures 75% of one contested CV and 50% of the other,
> while today's live miner captures 99% and 100%.** The cheap reader is not yet the accurate one. See
> [Accuracy against an answer key](#accuracy-against-an-answer-key-202). Two statements #196 made
> about that loss — the "36 bullets" figure and the job-index fix — were wrong and are corrected
> there.
>
> **And #196's own framing needed one correction, recorded here rather than buried:** today's miner
> is *not* meaningfully "few records" overall (52.8 records per CV against the rich reader's 58.0).
> It batches **only skill inventories**. The cost gap is not granularity and not richness — it is
> **how much the model writes per record**, and today's miner writes 2.4× more.

_Research for [#196](https://github.com/adrien-mounier/jobcrush-app/issues/196), which exists because
a five-model adversarial council (2026-08-11) found #160's comparison could not settle the schema
question [#161](https://github.com/adrien-mounier/jobcrush-app/issues/161) has to answer. As with
#160, this is a one-off measurement — throwaway prompts run against the real corpus, then discarded.
**No product code changed to produce it.** The only file this work adds or edits anywhere in the
repository is this one._

## For the owner, in plain terms

Six real CVs were read four different ways, on the real paid connection to Anthropic — not the
local stand-in #160 had to use. Each way was run at least twice per CV, 48 calls in total.

The four ways were:

1. **Today's reader**, exactly as it runs in production right now.
2. **The full new reader** — one record per fact, and each record carries everything the design
   decisions actually call for: when a job started and ended and *how precisely we know that*,
   which country it was in, whether it counts as work at all, whether a certificate is still valid,
   the person's own word for their language level, and the exact words on the page each fact came
   from. **This is the one nobody had ever measured, and it is the one we are going to build.**
3. **A stripped-down reader** — one record per fact, but only the words and where they came from.
   Cheap, and unusable: it carries none of the judgments the confirm screen needs.
4. **A shorthand reader** — same facts as (2), but written in a compressed notation that a backend
   expands afterwards. Included because two council members guessed that up to half the bill was
   being spent on repeating field names and quoting the CV back at us.

**The headline: the reader we want costs about half of what we run today.** Roughly **10 cents** per
CV upload against today's **21 cents**. Measured, on a real bill, not estimated.

**Per fact — the number #160 never gave — it is even better.** Today's reader spends about
**0.40 cents per fact**; the new reader spends **0.18 cents**, while writing *more* facts and
carrying far more useful detail in each one.

**Why is the fuller reader cheaper?** Because today's reader writes a small essay about every
claim — a rewritten sentence, a classification, a "does this need a follow-up question" flag and a
hint for that question, plus bookkeeping keys. That machinery exists for today's review screen. Per
record it costs about **2.4× more** than simply writing down a job's start date, end date, country
and source words. **The expense was never the detail — it was the commentary.**

**The shorthand reader is cheaper still — about 6 cents — and you should not take it.** It saves
real money (roughly 62% of the writing bill), but it pays for that with a pointer back to the CV
that is **wrong about one time in seventeen**, sometimes by eleven lines. Our whole correction and
trust story rests on being able to show someone the exact words a fact came from. A cheap pointer
that quietly points at the wrong line is the one defect this product cannot absorb.

**The honest bad news, and it is not small.** The fuller reader is cheap but it **reads less
completely than the simple one on some CVs**. On one corpus CV it captured **11 achievement bullets
where the simpler reader captured 31** — the same result twice, so it is a real property of the
prompt, not luck. The cause looks identifiable and fixable (that CV has four roles at the same
company, and asking each bullet to name its employer made the reader collapse them). **But it means
the cost question is now settled and the accuracy question is not.** Nobody should read this
document as "the new reader is ready".

**What this costs to decide wrong is unchanged and still the real risk:** the records are written by
the model, so re-shaping them later means re-paying for every stored CV — and a re-read can destroy
corrections a person already made.

The rest of this document is the working.

## Headline numbers

Six real CVs from `data/cvs/`, `claude-sonnet-5`, production API path, thinking disabled, two
samples per cell (48 calls). Priced at the standard $3.00/M input and $15.00/M output.

| Cell | $/upload | vs today | Records/CV | $/fact | vs today | Output tokens/fact |
|---|---:|---:|---:|---:|---:|---:|
| **batched × rich — today's miner** | **$0.2105** | 1.00× | 52.8 | **$0.00398** | 1.00× | 249.5 |
| **per-decision × rich — 🎯 the missing cell** | **$0.1016** | **0.48×** | 58.0 | **$0.00175** | **0.44×** | 103.3 |
| per-decision × lean (#160's prototype shape) | $0.0824 | 0.39× | 61.3 | $0.00134 | 0.34× | 80.1 |
| compact-emission variant | $0.0583 | 0.28× | 64.7 | $0.00090 | 0.23× | 48.6 |

**The shippable shape costs less than half of what runs today, on both measures.** The fear that
motivated #160 — that a fuller read would be several times more expensive — is not supported, and
this time it is a reading of a real bill rather than a corrected estimate.

## Which dial actually drives the difference

#196 framed this as granularity versus richness. **Measured, it is neither**, and saying so plainly
is the main result.

**Richness is cheap.** Holding granularity fixed at one-record-per-fact and moving only the field
set, lean → rich costs:

| | lean | rich | change |
|---|---:|---:|---:|
| $/upload | $0.0824 | $0.1016 | **+23%** |
| $/fact | $0.00134 | $0.00175 | **+31%** |
| output tokens/fact | 80.1 | 103.3 | **+29%** |

Every field ADR-0003, ADR-0004 and ADR-0008 argued over — date precision, the three-state end,
resolved country, `counts_as_work`, certification validity, verbatim language level — costs about
**a quarter more**, not a multiple. **That is the answer #161 was waiting for.**

**Granularity is close to free, and today's miner is not actually coarse.** This corrects #196's own
premise. Today's miner averages **52.8 records** per CV against the rich reader's **58.0** — within
10%. It batches **only skill inventories** (2–4 skill claims where the rich reader writes 7–22),
exactly as its rule 8 permits; for job bullets it is already one record per bullet.

**What actually drives the cost is per-record verbosity.** Today's miner spends **249.5 output
tokens per record** against the rich reader's **103.3** — 2.4×. Its ~12-field claim carries a
rewritten `text` sentence plus `semantic_key`, three field slots, `machine_touch`, `classification`,
`needs_grill` and `grill_hint`: **judgment and review-deck machinery, generated prose rather than
copied values.** The rich structured record is mostly short copied values plus a quote.

> **The one-sentence finding: the cost lives in what the model has to *compose*, not in how many
> fields it has to *fill*.** A schema that asks for more slots is cheap; a schema that asks the model
> to write an opinion about each fact is not.

## Per-CV cost (mean of 2 samples)

| CV | Size | Today's miner | per-decision × rich | per-decision × lean | compact |
|---|---:|---:|---:|---:|---:|
| 2024-Thomas Chauviere CV.pdf | 9,673 chars / 3 pages | $0.4002 / 109f | $0.1531 / 96f | $0.1371 / 108f | $0.1605 / 128f |
| ADRIEN MOUNIER … CV 2026.pdf | 8,412 chars / 3 pages | $0.2200 / 52f | $0.1149 / 64f | $0.0922 / 68f | $0.0550 / 69f |
| CV_Piierre_MOUNIER.pdf | 4,286 chars / 1 page | $0.1487 / 38f | $0.0719 / 39f | $0.0499 / 38f | $0.0281 / 36f |
| Giuliana_DELRE_Resume V3.pdf | 4,415 chars / 2 pages | $0.1814 / 47f | $0.0519 / 30f | $0.0565 / 52f | $0.0253 / 37f |
| Kulpakorn Ngamvijit CV.pdf | 4,352 chars / 1 page | $0.1289 / 27f | $0.0936 / 49f | $0.0781 / 49f | $0.0329 / 49f |
| Resume_Remy_IM_IT.pdf | 5,709 chars / 2 pages | $0.1838 / 44f | $0.1239 / 71f | $0.0804 / 54f | $0.0479 / 70f |
| **Average** | 6,141 chars | **$0.2105** | **$0.1016** | **$0.0824** | **$0.0583** |

**The rich reader beat today's miner on all six CVs** — including the list-heavy Thomas Chauviere
CV, which was the single exception in #160 (1.23× there; 0.38× here).

**Run-to-run variance**, the caveat #160 could not address with one sample: mean per-CV spread was
**6.1%** (today's miner), **4.7%** (lean), **5.2%** (rich) — and **24.2%** for compact, which is not
noise but a specific failure described below.

## The compact-emission variant: how much of the bill is serialization

Measured directly on the rich cell's own emitted output, using Anthropic's `count_tokens` endpoint
(the same tokenizer that produced the bill; the reconstructed totals matched the billed
`output_tokens` to within 4 tokens).

| Share of the *per-decision × rich* output bill | |
|---|---:|
| **Content** — every leaf value, no JSON syntax at all | **65.3%** |
| **Serialization** — field names, braces, quotes, indentation, repeated quote text | **34.7%** |
| &nbsp;&nbsp;of which: repeated verbatim `source_quote` text | 23.3% |
| &nbsp;&nbsp;of which: keys, braces, indentation | 11.4% |

**The council's 40–50% estimate was high but directionally right: 34.7%.**

**What the compact variant actually recovered: 62.1% of the rich cell's real billed output** — more
than the pure serialization share, because it also compresses the *content* (a line-number pointer
replaces the quoted text entirely, dates become self-describing strings, enums become single
letters, records become positional arrays with no keys at all).

⚠️ **And it is not recommended, on the strength of its own accuracy result.** See below.

## Accuracy spot-check

The check #160 explicitly never ran. Two mechanical tests plus a manual read of the two most complex
CVs.

### Does every fact point at real words? (ADR-0004 clause 1a, as a runnable test)

Every `source_quote` was tested as a substring of the source CV; every compact line pointer was
tested against the line it names. Punctuation was normalised first, so a model tidying a typographic
`’` into `'` is not scored as a fabrication.

| Cell | Facts not correctly grounded |
|---|---:|
| per-decision × rich | **0 / 336 (0.0%)** |
| per-decision × lean | **0 / 363 (0.0%)** |
| batched × rich (today) | 6 / 277 (2.2%) |
| compact-emission | **22 / 371 (5.9%)** |

🚨 **Richness did not degrade grounding at all — both per-decision cells were perfect.** This is the
cleanest positive result in the document.

🚨 **Today's miner produces quotes the CV never contained**, and it is a direct consequence of
batching: **7 of 113 claims** on the Thomas Chauviere CV carry a **stitched** `source_quote` — two
non-adjacent fragments joined with `...`, e.g. a job's project list rendered as
`"Projets: Grands Bois ... La Combaz A9 (…)"`, and one claim splicing two different job titles into
one quote. A quote assembled from two places is not the verbatim origin ADR-0004 clause 1a requires.
**The batched shape causes this; the per-decision shapes cannot.**

🚨 **The compact variant's source pointer is unreliable — this is why it is not recommended.** 5.9%
of pointers named the wrong line. Most were off by 1–2 lines, but the worst case was **11 lines
off**, and on one CV three separate job records all pointed at wrong lines. A pointer the backend
expands into "the words this fact came from" is worth nothing if it silently resolves to a different
line, and it fails *invisibly* — the expanded record looks perfectly well-formed.

### Reading the two most complex CVs

**`2024-Thomas Chauviere CV.pdf`** (list-heavy, French, 96 bullet lines, badly ordered text layer):

- ✅ **Date precision handled exactly as ADR-0003 clause 5 requires.** `06/2021 - 12/2023` became
  month precision; the current role became `{"state":"present"}`; year-only education dates stayed
  year-precision and were **never padded** to January.
- ✅ All four cells agreed on **8 jobs** — except **today's miner, which returned 8 roles on one
  sample and 12 on the other.** Today's reader is the least stable of the four on this CV.
- ⚠️ **The rich reader captured fewer achievement bullets than the lean one** — 73 and 73, against
  the lean reader's 79 and 91 and the compact reader's 93 and 114.
- ⚠️ **A borderline classification, worth flagging rather than scoring:** a `Formation Revit
  Intermédiaire Structure` (Nov 2020) entry was read as a certification by three cells and by the
  rich reader on only one of its two samples. It is a *training course*; whether that is a
  certification is a real judgment, not an obvious miss.
- 🚨 **`counts_as_work` was set `true` on all 8 entries, including four 2–4 month stints from
  2012–2017** that read like French `stages`. **The CV never uses the word**, and they sit under
  *Expériences Professionnelles*, so the reading is defensible from the page — but this is precisely
  the flag that moves years-of-experience and therefore eligibility. **The measurement cannot tell
  us whether it is right; only the person can.** This is direct evidence for ADR-0008 /
  [#157](https://github.com/adrien-mounier/jobcrush-app/issues/157) item 3: `counts_as_work` must
  reach the confirm screen as its own visible decision, never be batched away inside a job line.

**`ADRIEN MOUNIER SENIOR PROJECT MANAGER CV 2026.pdf`** (longest):

- ✅ All four cells agreed: **3 jobs, 2 education entries, 4 languages.**
- ✅ **Every ADR-mandated field came back correct.** Year-precision starts (`2023`, not `2023-01`),
  `present` for the current role, resolved countries for all three jobs, and the **exchange semester
  kept as its own entry with a null qualification** — ADR-0004 clause 6, unprompted by any
  CV-specific instruction.
- ✅ **Language levels stored verbatim** (`Native` / `Fluent` / `Conversational` / `Beginner`), never
  mapped to a rung — ADR-0004 clause 8 / ADR-0008 clause 6. Today's miner also preserved them.
- ✅ **No skill carried a level field**, per ADR-0004 clause 2. 22 skill records against today's
  miner's 4 skill claims.
- ⚠️ Rich captured 34 and 31 achievements against lean's 39 and 39.
- 🚨 **The contrast that settles the shape question:** today's miner stores this job's dates as
  `dates_as_written: "2023 - Present"` — **one opaque string**, with no precision, no three-state
  end, no country and no `counts_as_work`. It is structurally incapable of exposing the five
  decisions #157 Design A and ADR-0008 require, **and it costs 2.07× the shape that does.**

### 🚨 The one finding that should change the build plan

**The rich prompt systematically reads fewer achievement bullets than the lean prompt**, and on one
CV it is severe. Raw record counts, as observed in #196:

| CV | lean | rich | compact |
|---|---:|---:|---:|
| Giuliana_DELRE_Resume V3.pdf | 31 / 30 | **11 / 11** | 25 / 11 / 11 |
| 2024-Thomas Chauviere CV.pdf | 79 / 91 | 73 / 73 | 93 / 114 / 93 |
| ADRIEN MOUNIER … CV 2026.pdf | 39 / 39 | 34 / 31 | 37 / 37 / 34 |

The Giuliana case returned **11 both times**, so it is a property of the prompt, not variance.

> ⚠️ **Two claims made here in #196 were wrong, and are corrected by
> [#202](https://github.com/adrien-mounier/jobcrush-app/issues/202) below.**
> **(a)** This table originally carried a *"bullets in CV"* column reading **36** for Giuliana and
> **96** for Thomas. Both were unsourced. The counted figures are **25** and **93**.
> **(b)** This section originally named the cause as *"four roles at the same employer"* and
> recommended a **back-reference by job index** as "the obvious thing to try". **Do not build it.**
> The compact variant already uses a job index and collapses to 11 on two of its three samples —
> the 25 was sample 1 of 3. The measured cause is different and is described in
> [Accuracy against an answer key](#accuracy-against-an-answer-key-202) below.

A second instability, same family: skill atomisation swung from **17 to 44 records** across two
samples of the same CV in the rich cell (and 18 → 42 in compact) — the reader has no stable rule for
how finely to split a parenthesised skill list. Lean was stable at 14. ADR-0004 clause 3's warning
about atomising `(C#, XrmToolBox, Git)` is visible in the data.

## Accuracy against an answer key (#202)

> ✅ **Added 2026-08-13 by [#202](https://github.com/adrien-mounier/jobcrush-app/issues/202).** #196
> compared the prompts **against each other**, which cannot say which one is right. This section
> compares them **against a key built from the raw CV text**, so recall is an absolute number.
> **No API call was made and no money was spent** — the 53 stored responses were re-scored on disk.

### What the key is

A per-fact list of what the two contested CVs actually print, built from the cached PDF text extract
in `research-data/structured-read/cvs.json` — **the same bytes every graded reader saw, and never
from any reader's output.** Full key, the job-by-job breakdown and the appendix of judgement calls:
`research-data/structured-read/answer-key.md` (the scripts are `key-draft.mjs` and `score.mjs`
beside it — measurement code only; **nothing was added or changed under `apps/` or `packages/`**).

**Who built it and how long it took:** the Claude agent (`claude-opus-5`), **~35 minutes wall-clock,
unattended**. The prep note budgeted 2–3 hours of owner attention for the same job. **The owner
adjudicated it on 2026-08-13** — all 7 judgement calls were reviewed row by row in the appendix and
**accepted as drafted**, the one flagged as weakest included. The key stands at **Thomas 67 /
Giuliana 22**. One condition would reopen it: if [#206](https://github.com/adrien-mounier/jobcrush-app/issues/206) rules a duty and an achievement
are different records, Giuliana's three duty↔achievement merges reverse together and her key becomes
**25** — a ~2-point shift that changes no reader's rank.

It applies the three rulings settled in `research-data/structured-read/decisions.md`: **count once**
(a duty printed under several jobs is one fact, including semantically equivalent wordings),
**capture whole** (a line with three actions is one fact), **one bullet** (a page-wrapped sentence is
rejoined).

| | Thomas | Giuliana |
|---|---:|---:|
| Bullet lines printed under a job | 93 | 25 |
| …after exact duplicate collapse | 71 | 25 |
| **…after semantic merges — the key** | **67** | **22** |
| Jobs / Education / Certifications / Languages | 8 / 4 / 1 / 3 | 4 / 1 / 0 / 2 |

The 93 confirms `decisions.md` exactly. Thomas's distinct count is **71, not 73** — two pairs the
earlier hand count separated are the same text under the rulings (a stray trailing full stop, and one
page-wrap whose tail begins with a capital: `…selon les normes` / `SIA)`).

### Recall — every sample, not an average

**Read down the column, not across.** Each cell is *facts from the key found anywhere in that
response*, matched on ≥60% content-word overlap and deliberately generous: it asks "is the fact in
the output at all", not "is it in the right field".

| Prompt | Thomas s1 | s2 | s3 | Giuliana s1 | s2 | s3 |
|---|---:|---:|---:|---:|---:|---:|
| **today's live miner** (`batched-rich`) | **66/67 · 99%** | 60/67 · 90% | — | **22/22 · 100%** | **22/22 · 100%** | — |
| **the fuller reader** (`perdecision-rich`) | 50/67 · 75% | 50/67 · 75% | — | **11/22 · 50%** | **11/22 · 50%** | — |
| the stripped reader (`perdecision-lean`) | **67/67 · 100%** | **67/67 · 100%** | — | **22/22 · 100%** | **22/22 · 100%** | — |
| the shorthand reader (`compact`) | **67/67 · 100%** | **67/67 · 100%** | 66/67 · 99% | **22/22 · 100%** | 11/22 · 50% | 11/22 · 50% |

**Structural fields, against the key** (jobs / education / certifications / languages):

- Thomas 8/4/1/3 — matched by every sample except **today's miner's sample 2, which returned 12 roles
  instead of 8**, and the fuller reader's sample 1, which returned 5 education entries and 0
  certifications.
- Giuliana 4/1/0/2 — matched by every sample. The stripped reader returns 3 education entries by
  promoting the thesis and specialisation bullets to entries of their own; that is a defensible
  reading, flagged rather than scored.

### 🚨 Is the Giuliana collapse fixed? **No — and the diagnosis in #196 was wrong.**

**The fuller reader still captures exactly half of Giuliana's CV, on both samples.** Nothing has been
changed to fix it, and this measurement shows the previously suspected cause is not the cause.

Scoring the misses individually shows the loss is not random and not about employers at all. On
Giuliana the fuller reader captured **every line printed under a `Key Achievements:` sub-heading —
all 11 — and not one of the 11 unlabelled duty bullets above them.** Job 4 has no `Key Achievements`
heading and contributed nothing. On Thomas the same reader dropped **one entire job's bullets** —
all 23 under BTM Consultant, which are printed under `Projet:` headings rather than an employer
heading — and captured the other seven jobs cleanly.

> **The mechanism is the word *achievement*, not the employer back-reference.** The fuller prompt
> asks for "achievements", and the reader takes the CV's own headings literally: it collects what the
> page labels as an achievement or prints directly under a job, and skips everything else. The
> collapse is a **section-recognition** failure, not an attribution failure.

That matters for the fix. #196 recommended switching the back-reference from employer name to job
index; the measurement shows the index variant fails the same way (`compact` samples 2 and 3, 11/22),
so **the recommended fix would not have worked.** Rewording the prompt to ask for every bullet line
under a job — duty or achievement, labelled or not — is the change worth testing, and it is a prompt
edit rather than a schema change.

**The uncomfortable result: today's production miner is the joint-best reader in this test** — 99%
and 100% on the two hardest CVs, beaten only by its own instability (12 roles instead of 8 on one
sample). #196's "the fuller reader is cheaper" stands; **"and it reads at least as well" does not.**
The cost result must keep travelling with this one.

### What was NOT graded, and why

**`counts_as_work`, `resolved_country` and certificate `validity` were not scored, and cannot be.**
They are not printed on the page — they are judgements about it. Thomas's CV never uses the word
`stage`, yet four of his entries are 2–4 month stints that read like French internships; whether they
count as work experience moves his years-of-experience and therefore his eligibility, and **only he
can say.** Same for a country the CV never names and a certificate whose expiry it never states.
Grading them would mean inventing a truth and then measuring agreement with the invention. They
belong on the confirm screen as visible decisions —
[#157](https://github.com/adrien-mounier/jobcrush-app/issues/157) item 3, ADR-0008 — which is where
this measurement leaves them.

**Skills were not keyed either**, because the splitting rule is undecided (the 17→44 swing above).
`docs/research/202-accuracy-prep.md` proposes three candidate rules and recommends the section-based
one; whichever is picked amends ADR-0004 clause 3.

### One live contradiction this leaves open

`apps/api/prompts/claim-miner.md` line 15 still reads **"Split compound bullets"**, which ruling 2
("capture whole, split when writing") now contradicts. **#202 deliberately did not edit it** — it is
a product file and changing it changes what every upload stores. It needs a decision on timing.

### Limits of this accuracy result

- **Two CVs, not six.** Thomas and Giuliana were keyed because they are where the readers disagree.
- **The key is machine-built and unreviewed by a human.** Its judgement calls — 7 semantic merges,
  and the job↔bullet assignment on Thomas's out-of-order text layer — are listed individually in
  `answer-key.md` so each can be checked. Reversing any single merge moves the key by one fact and
  changes no prompt's rank.
- **Recall only.** Nothing here scores precision: a reader that emits the right facts plus twenty
  invented ones scores 100%. Grounding — whether emitted facts point at real words — is measured
  separately above, and both per-decision cells were perfect on it.
- **Whether a line is an achievement or a duty is not graded** — that is
  [#206](https://github.com/adrien-mounier/jobcrush-app/issues/206). Three of the Giuliana merges
  pair a duty with an achievement; if #206 rules they are different records, that key becomes 25 and
  no prompt's rank changes.
- **Nothing was re-run.** These are #196's stored responses, re-scored.

## A production-relevant robustness finding

**`thinking: {type:"disabled"}` stops the *thinking feature*; it does not stop the model writing its
reasoning as ordinary output text.** One call (compact, Thomas Chauviere, sample 2) emitted a
**24,714-character `<think>` block as plain text** before its JSON — **~70% of that call's output
tokens**, nearly quadrupling its cost against its own sibling sample ($0.2446 vs $0.0764). It
happened on 1 of 53 calls, only on the hardest CV.

`extractJson()`'s first-`{`-to-last-`}` rule recovered the JSON correctly, so this fails as **cost**,
not as breakage — but it is the entire explanation for the compact cell's 24.2% variance, and a
production pipeline will occasionally pay it on any prompt. Worth a `max_tokens` guard and a
cost alarm rather than a prompt change.

## Assumptions

- **Model:** `claude-sonnet-5`, every call, every cell.
- **LLM path: the real production one.** Direct HTTPS `POST https://api.anthropic.com/v1/messages`,
  mirroring `apps/api/src/llm.ts`'s `AnthropicLlm.request()` field for field — `max_tokens: 32000`,
  `thinking: {type:"disabled"}`, a single `user` message, **no system prompt, no tools, no
  `cache_control`**. This closes #160's largest caveat: these are billed tokens read from each
  response's own `usage` block, not a corrected estimate.
- **Pricing:** $3.00/M input, $15.00/M output — the standard (non-promotional) `claude-sonnet-5`
  list rate. **Cross-checked against `apps/api/src/llmPricing.ts`'s `DEFAULT_PRICING` at run time,
  which still carries exactly these figures**, deliberately not the introductory $2/$10 rate, for
  the reason that file gives.
- **Samples:** 2 per cell per CV — 48 calls — for every number in the headline tables. A 3rd sample
  was started and abandoned when the API began returning `529 Overloaded`; the 5 extra calls that
  did complete are **excluded** from every table so the cells stay balanced (they moved the compact
  average from $0.0583 to $0.0540, i.e. in the direction already reported).
- **Prompt — today's miner:** the live `apps/api/prompts/claim-miner.md`, read from the repo at run
  time, header-stripped and concatenated exactly as `miner.ts`'s `minerPrompt()` and
  `buildMinerInput()` do. **Unmodified.**
- **Prompts — the other three:** written for this ticket only, never added to the repo, built by
  reading ADR-0003 (clauses 5–7: date precision, three end states, location), ADR-0004 (clause 1a
  source quote, clause 2 no skill level, clause 5 certification validity, clause 6 education with no
  qualification, clause 7 resolved country) and ADR-0008 (clause 6 verbatim language level).
  **This is one author's reading of the decided shape, not a reviewed spec** — see limits.
- **The compact variant's input differs by design.** It receives the CV with line numbers prepended
  so it can emit line pointers, which raises its *input* tokens relative to the other cells. That
  cost is included in its figures; it still wins on total cost, and loses on accuracy.
- **Text extraction:** each CV extracted **once**, with the product's own `pdf-parse` call
  (`apps/api/src/extract.ts`'s `extractText()`), and the identical text reused across all cells and
  samples. Character counts match #160's exactly, so both documents read the same bytes.
- **Fact counting:** one emitted record = one fact. For today's miner that is `claims.length` (its
  `roles` array is the in-memory blob ADR-0003's consequences describe as discarded after one use).

## What this does NOT measure

Read this before treating any number above as a committed budget line.

- 🚨 **Whether the rich reader is accurate enough to ship. It is not, yet.** The achievement-loss
  finding above is unresolved, and the cost result must not be allowed to travel without it — which
  is the exact failure mode #160 recorded against itself.
- **Whether the prompts here are the right prompts.** Cost is a property of the schema *and* the
  prompt, and these prompts had one pilot pass and no tuning. A better-written rich prompt would
  plausibly fix the achievement loss; whether it stays at +23% while doing so is **untested**.
- **Whether `counts_as_work`, `resolved_country` or `validity` are *correct*** — only that they are
  populated and defensible from the page. Judging them needs the person, which is the point of the
  confirm screen.
- **Retry cost.** All 53 calls produced valid JSON on the first attempt, so no retry appears here.
  Production retries once at full price on a schema failure.
- **Whether a real zod schema would validate any of this output.** These prompts were graded on
  parseability and field presence, not against a contract — the contract does not exist yet.
- **Prompt-caching, batch pricing, or a cheaper model for part of the job.** All four cells paid
  full standard rates on every call. The cheapest number here is not the cheapest number available.
- **Everything after the first read** — grill answers, corrections, re-uploads, tailoring calls, and
  the re-payment cost of a future re-shape (the risk #196 flags as the real one).
- **Non-PDF input.** All six corpus files are PDFs; DOCX and paste were not exercised.
- **Statistical power.** Six CVs, two samples: enough to separate a 2× effect confidently, **not
  enough to trust the +23% richness figure to the percentage point.** Treat it as "roughly a
  quarter more", not as 23%.
- **A second run on a different day.** Variance was measured within a single session; the API was
  visibly degraded (`529`s) near the end, and per-call latency is not stable.

## Method (for re-running)

1. Extract each `data/cvs/*.pdf` once via `apps/api/src/extract.ts`'s `extractText()` (`pdf-parse`);
   cache and reuse across all cells and samples.
2. Build four inputs per CV: today's `buildMinerInput(cvText)`, and `${prompt}\n${cvText}\n` for the
   lean and rich prompts; the compact prompt gets `${prompt}\n${lineNumbered(cvText)}\n`.
3. POST each to `https://api.anthropic.com/v1/messages` with the exact `AnthropicLlm.request()` body
   (`claude-sonnet-5`, `max_tokens: 32000`, `thinking: {type:"disabled"}`, one user message, no
   system prompt, no tools). Retry on `429`/`5xx` with exponential backoff — an errored response
   carries no `usage` block and costs nothing.
4. Persist every raw response with its `usage`; price at $3/M in, $15/M out; count records per cell.
5. Ground-truth each `source_quote` as a normalised substring of the CV, and each compact line
   pointer against the nearest line actually containing the record's headline value.
6. Decompose the rich cell's output with `POST /v1/messages/count_tokens` (free) into full text,
   quote-blanked JSON, and bare leaf values.

Total cost of the experiment itself: **$5.66 over 53 calls.** Scripts, prompts and all raw outputs
lived in a scratch directory outside the repository and are not checked in.

## Judgment calls for the owner

1. **Cost is no longer a reason to prefer a thin schema.** The full ADR-shaped record costs **half**
   of today's reader per upload and **0.44×** per fact. #160's closing worry — *"if the real build
   copies today's heavier per-claim shape onto every structured fact, the advantage disappears"* —
   was aimed at the wrong thing. **Copying today's *field count* is cheap; copying today's
   *per-claim commentary* is what costs.** If the confirm deck needs a classification or a grill
   hint per fact, that is where the budget goes, and it should be decided deliberately.
2. **Do not adopt the compact-emission variant, despite it being cheapest.** It saves ~43% against
   the rich shape but its source pointer is wrong 5.9% of the time, invisibly. Revisit only if the
   pointer can be made verifiable — a backend that *checks* the expanded quote against the line, and
   rejects a mismatch, would turn a silent defect into a loud one and might make it viable.
3. **The next question is accuracy, not cost, and it is now the blocker.** The rich prompt loses
   achievement bullets on at least one real CV and has no stable skill-splitting rule. **Budget a
   prompt-and-eval pass before #161's schema is frozen**, and reuse this harness — it is 6 CVs and
   about $1 per full rich sweep.
   **Updated by #202:** the accuracy pass has now run and the loss is **measured, not fixed** —
   75% and 50% recall against the key. The cause is the word *achievement* making the reader read
   only the CV's labelled achievement sections, so **the fix is a prompt rewrite, not a schema
   change, and it is cheap to test**. Until it is tested and measured, today's miner is the better
   reader and the cost saving is not available.
4. **This measurement supports making `counts_as_work` a visible confirm-screen decision.** It was
   set `true` on four entries that look like internships, from a document that never says so. Cheap
   to get wrong, and it moves eligibility.

---

## Appendix — the superseded #160 measurement

Kept for provenance. **Do not cite these numbers**; they were measured on the Claude Code CLI
fallback with thinking on, at one sample per cell, and the comparison was confounded (*many × lean*
against *few × rich*, reported as a verdict on richness).

| | Today's reader | Structured reader | Multiple |
|---|---:|---:|---:|
| Average per CV (as measured, CLI) | $0.2065 | $0.1598 | 0.77× |
| Adjusted for harness overhead (estimate) | $0.1794 | $0.1312 | 0.73× |

#160's per-CV detail, its CLI-overhead calibration (~1,799 tokens/call) and its cache-write
re-pricing are preserved in that ticket's closing comment and in this file's git history
(commit `2c8922c`).

**What still stands from #160, and this run confirms it:** the structured read is **not cheap
because it captures less**. Job counts agreed across all four cells on both complex CVs; language
and certification counts agreed on nearly every CV; and the structured readers found **substantially
more individual skills** than today's miner (22 vs 4 on one CV, 28 vs 4 on another) because today's
miner is explicitly allowed to batch a whole skill inventory into one claim. **The fuller read does
more work and costs less** — that sentence survives the re-run intact, and is now measured on a real
bill.
