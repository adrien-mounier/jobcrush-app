# Prep for #202 — what has to be true before the accuracy experiment starts

_Reading legwork for [#202](https://github.com/adrien-mounier/jobcrush-app/issues/202). **Nothing was
run and nothing was spent.** No API calls, no product code, no prompt changes. Everything below comes
from files already on disk: the repository, and the #196 scratch directory, which turns out to have
survived intact._

> 🚨 **Two of #202's own statements did not survive contact with the raw data**, and both change what
> the experiment should do. They are in [The employer back-reference](#the-employer-back-reference--
> what-the-prompt-actually-says) and [The skill-splitting rule](#the-skill-splitting-rule). Read those
> two sections before planning the work.

---

## What #196 actually established, and the one finding that must not travel quietly

#196 asked one question — **what does the fuller CV read cost?** — and answered it properly, on the
real paid connection, 48 calls, six real CVs, two samples each
(`docs/research/structured-read-cost.md` lines 82–96).

**Settled, and safe to rely on:**

- The full read costs **about half** of what runs today per upload, and **0.44×** per fact
  (`structured-read-cost.md:89-92`). Cost is no longer an argument for a thinner record.
- The expense was never the number of fields; it was **how much opinion the model has to write per
  record** — today's reader spends 2.4× more per record because it composes a rewritten sentence, a
  classification and a follow-up hint for every claim (`structured-read-cost.md:121-129`).
- **Every fact in both per-decision cells pointed at real words on the page — 0 failures out of 336
  and 363** (`structured-read-cost.md:183-191`). This is the strongest positive result in the
  document and it is worth protecting.
- The cheapest variant (the shorthand one) **should not be taken**: its pointer back to the CV is
  wrong about 1 time in 17, silently, sometimes by eleven lines (`structured-read-cost.md:200-204`).

**The one finding that must not travel quietly — the recall loss.** The fuller reader **reads less
completely than the simpler one**, and on one CV it is severe: **11 achievement bullets captured
where the simple reader captured 31, out of 36 on the page — the same 11 on both samples**, so it is
the prompt, not luck (`structured-read-cost.md:246-262`). The document itself says the right thing in
the right place: *"Nobody should read this document as 'the new reader is ready'"*
(`structured-read-cost.md:68-74`, repeated at `:319-321`).

**Why this matters more than it sounds.** A reader that drops two-thirds of someone's achievements is
worse than an expensive one. The person never sees what was lost — there is no empty space on the
screen where the missing 25 bullets should be. It fails invisibly, which is the one failure mode this
product cannot absorb.

**#196 also corrected its own framing**, and that correction should be carried forward: today's
reader is *not* coarse. It writes 52.8 records against the new reader's 58.0. It batches **only skill
inventories** (`structured-read-cost.md:118-120`). Anyone re-opening this should not re-derive
"granularity versus richness" — that question is closed.

### What each neighbouring ticket settled, and what #202 inherits

| Ticket | State | What it settled | What #202 inherits |
|---|---|---|---|
| **#160** | closed 2026-08-10 | First cost estimate, `0.77×`. **Superseded** — measured on the local stand-in, one sample, and the comparison moved two dials at once. | The discipline, not the number. Its self-recorded failure — a headline travelling without its caveat — is exactly what #202 exists to prevent repeating. |
| **#196** | closed 2026-08-12 | Cost, properly. And the accuracy problem, discovered as a by-product. | The harness, the prompts, the raw outputs — **and an unfinished accuracy question it explicitly handed on** (`structured-read-cost.md:374-377`). |
| **#161** | **closed 2026-08-11** | The durable job record. **This shipped** — `apps/api/src/jobBlockStore.ts`, `apps/api/src/jobBlockMiner.ts` and a new live prompt `apps/api/prompts/job-block-miner.md` all exist in the repo today. | ⚠️ **#202's premise needs a correction.** #202 says it "blocks the schema freeze in #161". #161 is already closed and its schema is already running in production. #202 is no longer preventing a freeze — it is **grading something already shipped**. That is a different, and more urgent, conversation. |
| **#157** | closed 2026-08-10 | A register of five undesigned screens. Item 3 is the confirm deck's tiering. | The home for the judgment fields. #202 is right that `counts_as_work`, `resolved_country` and certification validity are **not gradeable by any prompt pass** — they need the person, on a screen #157 item 3 owns. |

---

## Harness rebuild: what exists, what is gone, and the honest gap list

**The good news, and it is better than #202 assumed.** #202 says the harness "lived in a scratch dir
outside the repo… rebuild from there", implying a rebuild from the Method section. **A rebuild is not
needed. The entire #196 scratch directory is still on disk, intact:**

**It has since been copied somewhere durable**, and that copy is now the working location:

```
research-data/structured-read/          ← use this one
```

It sits inside the repository folder so any agent can read it directly, and is listed in
`.gitignore` so it is never committed — git history is permanent and a 1.2 MB corpus of CV text does
not belong in it. The original temporary folder still exists but should be treated as expendable.

**On the CV data:** these are the owner's own CV and those of close friends, who know the documents
are used for this work and are content with them being processed by an AI system. The earlier
handling caveats in this note are therefore dropped: **read the corpus freely and quote from it when
it helps the analysis.**

### What is in it

| File | What it is | Status |
|---|---|---|
| `run.mjs` | The measurement runner. Mirrors production exactly — same endpoint, same model, thinking disabled, no system prompt. **Resumable** (never re-pays for an output already on disk) and has a **$20 spend ceiling** built in. | Works as-is |
| `prompt-rich.md`, `prompt-lean.md`, `prompt-compact.md` | The three throwaway prompts. | Works as-is |
| `cvs.json` | All six CVs' extracted text, cached. **Re-running costs no extraction and reads identical bytes to #196 and #160.** | Works as-is |
| `out/` | **All 53 raw responses**, with their billing blocks. | Complete |
| `analyze.mjs` | Cost and record-count tables. | Works, **but see gap 1** |
| `grounding.mjs` | The "does every fact point at real words" check. | Works as-is |
| `serialization.mjs` | The content-vs-formatting cost split. | Works as-is |
| `extract.mjs` | Re-extracts the PDFs if `cvs.json` is ever lost. | Works as-is |

The API key is read from the repo's own `.env`, which is present and populated. **The two named CVs
both exist**, at `data/cvs/Giuliana_DELRE_Resume V3.pdf` and `data/cvs/2024-Thomas Chauviere CV.pdf`,
alongside the other four. Their extracted text is also in `cvs.json`.

### Exact steps to get it running again

1. Work in `research-data/structured-read/` — already copied, nothing to set up.
2. `node run.mjs <cell> <cv> <samples>` — e.g. `node run.mjs perdecision-rich all 2`. Existing
   outputs are skipped, so nothing already paid for is paid for twice.
3. `node analyze.mjs` for the cost tables, `node grounding.mjs` for the source-words check.
4. A new prompt variant is a new `prompt-*.md` plus one line in `run.mjs`'s cell list (line 36–41).

A full rich sweep across six CVs at two samples is roughly **$1**.

### The honest gap list

1. 🚨 **Nothing counts achievement recall.** `analyze.mjs` counts total records, skills and jobs
   (lines 20–31) — **it never counts achievements**. Every recall number in #196's write-up was
   produced by hand, outside any script. **A recall counter has to be written before #202 can report
   a number**, and it is the piece the acceptance criteria depend on.
2. 🚨 **There is no answer key and no scoring code.** #196 compared prompts against *each other*.
   #202 requires comparing them against **the truth**, which needs both a key and something that
   matches an emitted bullet to a key line. Matching is not trivial — the model tidies punctuation
   and splits compound bullets, so exact string equality will under-count. **Budget for a
   fuzzy-matching decision and expect to argue about it.**
3. **"36 bullets in the CV" has no recorded provenance.** It appears in `structured-read-cost.md:253`
   with nothing behind it. Treat it as a starting hypothesis the answer key must confirm, not as a
   given.
4. **One number in the published table does not reconcile with the files on disk** — see the
   back-reference section below. It needs correcting when the document is amended.
5. **The live production prompts have changed since #196.** `apps/api/prompts/job-block-miner.md` was
   added by #161 and did not exist when #196 ran. Any re-measurement of "today's cost" is now
   measuring a different, larger production pipeline than #196's baseline. **#196's `1.00×` baseline
   is stale.**

---

## The employer back-reference — what the prompt actually says

This is the highest-value section, and it is where #202's plan needs revising.

### What the current research prompt does, quoted

`prompt-rich.md` line 26, the whole rule:

> `- **achievement** — one per bullet: \`text\`, plus \`employer\` naming the job it belongs to.`

and the output shape it demands, line 58:

> `"achievements": [{ "text": "…", "employer": "…", "source_quote": "…" }],`

So every achievement must repeat the **employer name as a string**. The shorthand variant does it by
position instead — `prompt-compact.md` lines 29–30:

> `- \`a\` **achievements** — \`[text, j, L]\` where \`j\` is the **index into the \`j\` array** of the
> job this bullet belongs to (\`-1\` if none).`

And the simple variant asks for **no back-reference at all** — `prompt-lean.md` line 22 gives
achievements only `text` and `source_quote`.

### 🚨 What the raw outputs actually show, and why the proposed fix is not supported

I counted the achievements in the Giuliana outputs already sitting in `out/`, grouped by whichever
back-reference each prompt used. Counts only; no CV content read.

| Cell | back-reference | sample 1 | sample 2 | sample 3 |
|---|---|---:|---:|---:|
| simple (`lean`) | **none** | **31** | **30** | — |
| full (`rich`) | employer **name** | **11** | **11** | — |
| shorthand (`compact`) | job **index** | **25** | **11** | **11** |

**The job-index variant lost exactly the same 11 bullets on two of its three samples.** #196's table
(`structured-read-cost.md:253`) reports compact as `25` for this CV — that is **sample 1 only**. The
other two samples are 11, identical to the prompt #202 is trying to fix.

**This breaks #202's named suspect.** #202 reasons: *name-based back-reference collapses four roles at
one employer → switch to a job index → the shorthand variant used an index and lost far less (25)*.
The evidence for "lost far less" is one sample out of three. **The index variant fails the same way,
two times out of three.**

**The pattern that does hold across all the data is different, and simpler:** the only cell that never
loses bullets on this CV is the one that asks for **no job attribution at all**. Both cells that
require the model to say which job a bullet belongs to — by name *or* by number — collapse to 11.

**So the working hypothesis should be re-stated:** it is not *name versus index*. It is that **making
the reader attribute each bullet to a job, in the same pass, costs recall.** That is the same
council-recorded blind spot #196 quoted about today's miner — asking one pass to extract *and*
classify lowers accuracy on both (#196 body).

If that is right, the fix is not a field type. It is **separating the two jobs**: read the bullets in
one pass with no attribution, attach them to job blocks in a second step (or in code, from position in
the document). **That is a bigger change than #202 budgeted, and it should be tested against the
alternative before anyone commits to it.** Cheap first experiment, roughly $1: run the rich prompt in
three variants on the two named CVs — employer name, job index, and **no attribution field at all** —
and see whether the third recovers the 31.

### Is the job-index fix small or a schema change?

**Two different answers, and the difference matters.**

**In the research harness: trivial.** Editing `prompt-rich.md` line 26 and line 58 to ask for a number
instead of a name is a two-line change to a throwaway file. No product code, no schema, no migration.

**In the product: this is not a hypothetical, and it is already shipped.** The live claim miner uses
**exactly the name-based shape** under suspicion — `apps/api/prompts/claim-miner.md` rule 6:

> `6. \`role\`: which employment/education block the claim belongs to (employer + title as written),
> or \`"profile"\` for skills/summary/contact claims.`

That string is stored in the database as a plain column (`apps/api/src/claims.ts:237`, `:264`).
Meanwhile #161 shipped a **separate** miner that gives every job block a stable id
(`apps/api/prompts/job-block-miner.md:61`, `"id": "kebab-slug"`, stored in
`apps/api/src/jobBlockStore.ts`). **The two do not reference each other.** A claim says which job it
belongs to by re-typing the employer and title; nothing links it to the job record's id.

Changing that link from a re-typed name to a real id **is a schema change** — a new column, a
migration, a backfill across stored claims, and a decision about what happens to claims whose role
string matches no block. It is not large, but it is not a prompt edit either.

**And there is a live exposure worth surfacing to the owner, which #202 does not mention.** If the
hypothesis above is right — that per-bullet job attribution costs recall — **today's production miner
has the same shape and may be losing bullets right now**, on every upload. That is checkable for free
from the raw outputs already on disk before anyone spends anything, and it should be checked first.
*(On this CV today's miner emitted 45–49 claims across 5–6 distinct role strings, so it is not
collapsing the same way — but it is one CV, and it is the only evidence either way.)*

---

## The skill-splitting rule

### 🚨 First, a correction to the ticket

#202 item 2 reads: *"The same CV gave 17 skill records on one sample and 44 on the next"*, in a
paragraph about the Giuliana CV. **The 17→44 swing is on a different CV — `Resume_Remy_IM_IT.pdf`.**
Counted from the raw outputs:

| CV | skill records, full prompt |
|---|---|
| `Resume_Remy_IM_IT.pdf` | **17 → 44** 🚨 |
| `Giuliana_DELRE_Resume V3.pdf` | 12 → 12 (rock stable) |
| `Kulpakorn Ngamvijit CV.pdf` | 28 → 28 |
| `2024-Thomas Chauviere CV.pdf` | 7 → 7 |
| `CV_Piierre_MOUNIER.pdf` | 9 → 9 |

**Four of five CVs are perfectly stable. One swings by 2.6×.** This is not a general instability — it
is one document with a specific shape, and Remy's CV is the *same document ADR-0004 clause 3 quotes*
(`(C#, XrmToolBox, Git)`, `docs/adr/0004-each-elements-own-parts.md:136`). **The skill rule must be
keyed against Remy's CV, not Giuliana's** — which is a change to #202's plan, since #202 names only
Giuliana and Thomas.

**And the swing has two causes, not one.** In the 17-record run the model mined skills from **7**
source lines; in the 44-record run, from **23**. So it varies both in *how finely it splits a line*
and in *which lines it treats as skills at all*. A rule that only says how finely to split fixes half
the problem.

### What is already decided

**ADR-0004 clause 3** (`docs/adr/0004-each-elements-own-parts.md:116-136`) decides three things and
warns about a fourth:

- We normalise against **our own vocabulary**, never an external taxonomy (best published accuracy for
  that is 23.55% — line 120).
- The two duplication problems in a real CV **are not the same problem**: five spellings of `C#` are a
  dictionary lookup, easy and safe. Prose is the risky half.
- ⚠️ The warning, verbatim (`:132-136`): *"Prose like 'Responsible AI usage in regulated environments
  (data sensitivity, tool selection)' is the risky half, and the right answer there is **not to
  atomise it at all**… **Atomising `(C#, XrmToolBox, Git)` is precisely the operation that strips the
  verb.**"*

Clause 2 (`:101`) adds: a skill **never** carries a self-assessed level. Clause 1a (`:51-99`) adds:
every skill must point at the source words that produced it.

**The two prior research documents do not answer the splitting question.** I read both. They answer
adjacent questions well and this one not at all:

- `docs/research/skill-shape-granularity-normalisation-levels.md` answers **one record or two**
  (one record, two fields — lines 22–30), **whether to buy a taxonomy** (no), **whether to ask for a
  level** (no), and **how to make invention detectable** (anchor every term to a span, lines 49–58).
  On how finely to split, its only statement is the same one ADR-0004 quotes: don't atomise prose.
- `docs/research/last30days-skill-shape.md` confirms the same shape is shipped by two large live
  projects and adds one directly useful observation (line 20): both projects **split a candidate's
  skills into "named in the skills section" versus "present only in the prose of a job" and treat the
  two differently.** That is the closest thing to a splitting rule anywhere in our research, and
  nobody has written it into ours.

**`docs/cv-brain/` does not constrain this at all.** Its skill rules — 2–4 categorised groups, 8–12
skills total (`cv-authoring-rules.md:34-36`, `:313`) — govern **what prints on the finished CV**, not
how the reader splits what it finds. Different end of the pipeline. No conflict, no help.

### What specifically remains undecided

One sentence: **when a CV writes several terms in one place, how many records does that become — and
does the answer depend on where on the page it appears?** Nothing decides it. ADR-0004 clause 3 warns
against one extreme (atomise everything) without naming the boundary, which is why the reader invents
a different boundary on each run.

### Three candidate rules, worked on `(C#, XrmToolBox, Git)`

**Rule A — split delimiter-separated proper nouns; never split a clause containing a verb.**
A comma, slash or semicolon between recognisable product, language or tool names is a boundary.
Anything that reads as a sentence stays whole.
- `(C#, XrmToolBox, Git)` → **3 records**: `C#`, `XrmToolBox`, `Git`. Each points at the whole
  bullet, verb included.
- `Responsible AI usage in regulated environments (data sensitivity, tool selection)` → **1 record**,
  the whole line. "data sensitivity" is not a product name, so the parenthesis is not a boundary.
- `Splunk, Control-M, Bash, Linux` → 4 records.
- ⚠️ **The weakness:** "is this a product name?" is a judgment the model makes fresh every run. That
  is the same class of decision that is already varying 17→44.

**Rule B — where it sits on the page decides, and only that.**
Text under a Skills heading yields one record per delimiter-separated item. Text inside a job bullet
yields **no skill records at all** — the bullet is the record, and the skills inside it are found
later by the dictionary lookup ADR-0004 clause 3 already calls easy and safe.
- `(C#, XrmToolBox, Git)` **inside a job bullet** → **0 skill records.** The bullet stays one
  achievement, verb intact.
- The same three terms **under a Skills heading** → **3 records.**
- `Responsible AI usage in regulated environments (…)` inside a bullet → **0 skill records**, the
  prose is never atomised — clause 3 satisfied by construction, with no judgment call.
- ⚠️ **The cost:** a tool that only ever appears inside a job bullet produces no skill record from the
  read. It is recoverable — the dictionary pass finds it later — but until that pass exists, it is
  genuinely missing.

**Rule C — split everything into atomic terms, always; every term must be a substring of the page.**
Maximum coverage, with the invention check ADR-0004 clause 1a already requires as the only guard.
- `(C#, XrmToolBox, Git)` → **3 records**, wherever it appears.
- `Responsible AI usage in regulated environments (data sensitivity, tool selection)` → forces
  either an invented umbrella term or a dropped line. **ADR-0004 rejects this explicitly**
  (`:365`) — it is the "store only atomised terms" alternative already turned down.
- Listed only so the owner can see the option that was already rejected, and why it will keep coming
  back as a "we're losing skills" argument.

### Which I would pick

**Rule B.** It is the only one of the three whose input is a **fact about the document** — which
section this text sits in — rather than a judgment about the text. Every judgment we ask the reader to
make fresh is a thing that varies between runs, and variance is the exact defect we are trying to
remove; Rule A leaves that judgment in place and would probably still wobble. Rule B also satisfies
ADR-0004 clause 3's warning by construction rather than by instruction — prose inside a job bullet is
never atomised because nothing inside a bullet is ever atomised, so the verb can never be stripped.
It matches what the two largest live projects already do
(`last30days-skill-shape.md:20`), and it explains the data we have: the run that found 44 skills mined
23 source lines against the other run's 7, which is precisely the behaviour "only mine the Skills
section" removes. **The price is real and should be stated to the owner: until the dictionary lookup
exists, a tool mentioned only inside a job bullet produces no skill record.** That is a known, visible,
recoverable gap, and it is a better trade than a reader whose output changes size by 2.6× between two
readings of the same document.

**Whichever is picked, ADR-0004 clause 3 must be amended or a superseding ADR written** — #202's own
acceptance criteria require it, and a rule living only in a throwaway prompt is a rule that will be
re-derived from scratch in three months.

---

## Answer key — how to build one

### The human is the adjudicator, not the typist

The first draft of this section asked a person to transcribe every job and every bullet by hand. That
was wrong, and the owner was right to reject it: **a machine copies text better than a human does, and
asking a human to do it wastes the only resource this ticket is actually short of.**

What a machine cannot supply is the set of rulings that the document does not contain. Every one of
these is a decision with no answer printed on the page, and **the headline recall score moves with
each one**:

- A bullet wraps onto a second line — one bullet, or two?
- A bullet has sub-bullets — do the children count, or only the parent?
- Four titles sit under one employer — one job, or four?
- A two-day training course — a certification, or not?
- A three-month French stint that never says `stage` — employment, or a student placement?

If those rulings are not written down, the two CVs get keyed to two different standards and the final
number is uninterpretable. **That is the human contribution: the rulings, and the check that the draft
obeys them.**

### 🚨 The one hard rule: the draft must not come from the reader being graded

A key drafted by the CV reader scores that reader 100% against its own blind spots. That is precisely
the #160 failure mode. Acceptable drafting sources: the raw text extract already cached in `cvs.json`,
or a plain mechanical line-split of it. **Not acceptable:** the miner prompt, either #196 variant, or
any LLM pass that decides what a job or a bullet *is*. The draft may split lines. It may not judge.

Second caveat, stated plainly: **on `2024-Thomas Chauviere CV.pdf` the cached text layer is out of
order.** A mechanical draft of that CV will be confidently wrong in places, and checking it against the
PDF page by page is most of the work regardless. The drafting saving is real on the English CVs and
close to zero on that one.

### Step 1 — write the rulings, before reading anything

One `decisions.md` for the whole exercise, not one per CV — the point is that all CVs are keyed to the
same standard. Fill it in first; append to it whenever a new case appears.

```markdown
# Keying rulings — structured-read answer key
Author: <name>    Started: <yyyy-mm-dd>

| # | Question | Ruling | Why | Added on |
|---|---|---|---|---|
| 1 | A bullet wrapping to a second printed line | one bullet | it is one sentence | <date> |
| 2 | Sub-bullets under a parent bullet |  |  |  |
| 3 | Several titles under one employer |  |  |  |
| 4 | A bullet containing a semicolon or two clauses |  |  |  |
| 5 | A training course vs a certification |  |  |  |
| 6 | A short stint that may be a placement |  |  |  |
```

**Rulings 1–4 must be settled before the first CV is keyed.** They are the ones that change the
headline number. 5 and 6 can be settled when first encountered.

### Step 2 — draft the tables mechanically, then correct them

One file per CV, in `research-data/structured-read/` beside the harness — durable, readable by any
agent, and git-ignored. Markdown is enough; no tooling required. Every table below arrives
pre-filled from the text extract; the human job is to **correct, not compose**.

```markdown
# Answer key — <CV filename>
Drafted by: <mechanical extract>   Adjudicated by: <name>
Date: <yyyy-mm-dd>   Time spent adjudicating: <minutes>
Source: data/cvs/<file>   Text read from: cvs.json (the same bytes the model saw)
Rulings applied: decisions.md as of <date>

## Jobs        [draft-filled — correct rows, add missing, delete phantoms]
| # | Employer (as written) | Title (as written) | Start | End | Location | Employment? | ✎ |
|---|---|---|---|---|---|---|---|
| 1 |  |  |  |  |  | yes / no / unsure |  |

Total jobs: __
✎ = mark every row you changed, and say what was wrong with the draft.
Notes: (roles at the same employer, promotions, client blocks nested under an employer)

## Achievement bullets — per job        [draft-filled]
### Job 1 — <employer> / <title>
| # | Bullet text, exactly as printed | ✎ |
|---|---|---|
| 1 |  |  |

Bullets in job 1: __
(repeat per job)

**TOTAL PRINTED BULLETS ACROSS ALL JOBS: __**   ← the headline number #202 is graded on
Bullets not attached to any job (profile, summary): __
Rulings invoked while correcting: (#1 on job 3, #2 on job 5 — cite the decisions.md row)

## Education        [draft-filled]
| # | School | Qualification (or "none stated") | Field | Dates | Grade as written | ✎ |
|---|---|---|---|---|---|---|

Total education entries: __
Notes: (entries with no qualification — exchange semesters — are their own entry, ADR-0004 clause 6)

## Certifications        [draft-filled]
| # | Name | Issuer | Award date | Does the CV state validity? | ✎ |
|---|---|---|---|---|---|

Total certifications: __
Borderline: (cite ruling #5 and the reason)

## Languages        [draft-filled]
| # | Language | Level, in the CV's exact words (or "none stated") | ✎ |
|---|---|---|---|

Total languages: __

## Skills — DELIBERATELY NOT KEYED
Per #202 item 2: the splitting rule is undecided, so there is no right answer to key against.
Revisit once the rule is chosen.

## Draft quality
How many rows did the mechanical draft get wrong? __ of __
(This is worth recording: if the draft is reliable, the next CV is cheap. If it is not, say so.)

## Anything the reader could reasonably get wrong
(bad text layer, two-column layout, dates in an unusual format, French terms)
```

### What "TOTAL PRINTED BULLETS" means, and what it deliberately does not

It is **the count of lines printed as bullets under a job**, after the rulings are applied. Nothing
more. It is not a judgement about whether a line describes a real achievement or a dull duty.

The reason is narrow and worth stating, because the field name invites the other reading: the defect
under investigation is that the reader **finds 11 and stops when 36 are present**. Proving that needs
only the true count of what is on the page. Grading which lines are genuine achievements is a
different and more interesting question — **it changes what the product stores, not merely how this
measurement is scored, and it belongs in its own ticket.** Folding it in turns a half-day measurement
into a schema redesign and still leaves the recall question unanswered.

### Which CVs, and why each one

| CV | Why it is in the set | Cost |
|---|---|---|
| `Giuliana_DELRE_Resume V3.pdf` | **The observed failure**: 11 bullets captured of ~36 present; 4 roles at 1 employer | **25–40 min** |
| `2024-Thomas Chauviere CV.pdf` | **The hard case**: 3 pages, 8 jobs, ~96 bullet lines, French, out-of-order text layer | **1.5–2.5 h** |
| `CV_Piierre_MOUNIER.pdf` | **Control**: 1 page, nothing should go wrong; if it does, the fault is broader than believed | **~15 min** |
| `Resume_Remy_IM_IT.pdf` | **Only after the skill rule is decided** — the sole document exhibiting the 17→44 instability | later |

### How long this honestly takes

**Nobody has done this before in this repo, so these are estimates, not measurements** — which is
exactly why #202's acceptance criteria demand the real figure be recorded.

| Item | Estimate |
|---|---|
| Writing `decisions.md` rulings 1–4, once | 20–30 min |
| Building the mechanical draft, once | 15–30 min |
| Adjudicating Giuliana | 25–40 min |
| Adjudicating Thomas | 1.5–2.5 h |
| Adjudicating Piierre (control) | ~15 min |

**Realistically half a day still, and it is genuinely tiring work** — #202 is right that the budget
here is human attention, not tokens. Mechanical drafting removes the typing, not the reading, and the
reading is what costs. **The Thomas CV dominates the estimate and is the least reliable figure**,
because the text layer is out of order and every row has to be cross-checked against the PDF.

**Record the real time taken.** #202's first acceptance criterion demands it, and the next pass cannot
budget honestly without it.

---

## What this prep does NOT cover

Stated plainly, so nothing here reads as more finished than it is:

- 🚨 **The answer key itself does not exist.** Nothing above was keyed. No `decisions.md` rulings are
  written, no mechanical draft has been built, and no CV has been adjudicated. That is the bulk of
  #202 and none of it is done.
- 🚨 **Nothing was re-measured.** Every number quoted here comes from #196's existing run or from
  counting records in raw outputs already on disk. **No new API call was made and no money was spent.**
- **The cost re-check is not done.** #196's `0.48× / 0.44×` was measured on a prompt that was losing
  content. A prompt that captures everything may cost more, and **whether it still beats today's
  reader is unknown.** Worse, the baseline has moved — #161 shipped a second miner since, so "today's
  cost" is no longer the number #196 measured.
- **No prompt was changed and no fix was tried.** The three-way experiment proposed above
  (name / index / no attribution) is a recommendation, not a result.
- **The judgment fields were not graded and cannot be** — `counts_as_work`, `resolved_country`,
  certification validity. #202 is right about this and right to refuse to pretend otherwise: they are
  defensible from the page and unknowable by machine, and they belong on the confirm screen
  (#157 item 3, ADR-0008). Nothing here changes that.
- **Whether the production pipeline is losing bullets today** — raised above as a real possibility on
  the strength of the shared name-based shape, **not established.** It is checkable cheaply and should
  be the first thing checked.
