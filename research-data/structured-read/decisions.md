# Keying rulings — what counts as one captured bullet

**Who fills this in:** the owner. **How long:** about 20 minutes.
**Why it exists:** the readers disagreed by 73 vs 114 bullets on one CV. That is not a bug. They are
answering questions nobody has decided. Below are the decisions. Everything else in #202 waits on
them.

Fill in the **Ruling** and **Why** columns. Leave everything else alone.

---

## Decision 1 — the same duty printed under two jobs

Thomas Chauviere's CV prints the **same bullet list twice**, under two different jobs at two different
employers. This is not an extraction glitch; it is what the CV says. 19 bullet lines are repeated,
one of them three times.

Example — this exact line is printed under both jobs:

> ·Réaliser des plans de soumissions pour Appels d'Offres (Autocad)

The whole 73-to-93 spread is this one question:

| If the ruling is… | The true count is | Which readers "match" |
|---|---|---|
| Count it **once** — it is one fact about him | **73** | the employer-name reader (73/73) |
| Count it **per job** — it is evidence in both roles | **93** | the job-number reader (93) |

**Neither is wrong.** They serve different purposes: 73 describes the person, 93 describes the page.

**Worth knowing before you choose:** the tailored CV prints bullets under a job heading. If the answer
is 73, something later has to decide which job a shared duty prints under, or it prints under none.

| | |
|---|---|
| **Ruling** | *(once / per job)* |
| **Why** | |

---

## Decision 2 — a bullet that describes two or more actions

> ·Soumettre les quantitatifs, analyser et négocier les offres des fournisseurs
> *(Submit the quantities, analyse and negotiate the suppliers' offers)*

That is three actions on one printed line. Today every reader keeps it whole. The live reader is told
the opposite — `claim-miner.md` line 15 says *"Split compound bullets."* **Those two disagree, and
nobody has noticed.**

| | |
|---|---|
| **Ruling** | *(keep whole / split into separate facts)* |
| **Why** | |

---

## Decision 3 — a line that wraps onto a second printed line

**What it looks like.** One sentence is too wide for the column, so the page breaks it in two. The
text comes out of the PDF as two separate lines. From Thomas's CV, exactly as extracted:

```
line 1:  ·Réaliser des plans de positionnement de lattages assurant un parfait alignement des éléments de
line 2:  fixation
```

That is **one sentence** — *"Produce batten positioning drawings ensuring perfect alignment of the
fixing elements"* — printed as two lines. The word `fixation` on its own is not a fact about anyone.

From Giuliana's CV, the same thing in English:

```
line 1:  • Cost control: Drive a 10% COGS reduction roadmap via negotiation, contract structuring
line 2:  sourcing
```

There are 14 of these on Thomas's CV and 4 on Giuliana's.

**What this ruling is for.** It fixes the **unit being counted**, so that two people keying two CVs
produce comparable numbers, and so a reader that splits a sentence in half is scored as wrong rather
than as unusually thorough. Without it, "the CV has 93 bullets" is not a checkable statement.

**What it is *not* about, and this is the honest part.** ⚠️ **No reader currently gets this wrong.**
All four rejoin the two lines and keep the tail — `fixation` is present in every captured version.
So this ruling is **preventive**: it protects the score's meaning, it does not fix an observed
defect. If you would rather rule on it only when it actually breaks, that is a defensible answer and
you should write that down instead.

**Why it still matters for the product, not just the measurement.** Whatever the reader captures is
what later prints on the tailored CV. A half-sentence stored as a fact becomes a half-sentence
printed under a job heading — the kind of defect nobody catches in a test but every reader of the CV
sees immediately.

| | |
|---|---|
| **Ruling** | *(one bullet / two bullets / defer until it breaks)* |
| **Why** | |

---

## Not decided here

- **Whether a line is an achievement or a duty** — that is [#206](https://github.com/adrien-mounier/jobcrush-app/issues/206), deliberately separate.
- **How a skill is split** — undecided, and the reason skills are excluded from the answer key.
- **`counts_as_work`, country, certificate validity** — machine cannot know these; they belong on the
  confirm screen (#157 item 3), not in a ruling.

---

## Where the numbers above came from

`research-data/structured-read/` — the six-CV, four-prompt corpus from #196. Counted directly from
the cached CV text and the 53 stored responses. No new API calls, no money spent.

- 93 bullet lines printed on Thomas's CV; 73 distinct texts; 19 texts printed twice, 1 printed 3×.
- One reader returned 114, which is **more than the page contains** and is not yet explained. It is
  the only count above that nobody can account for, and it is worth one look before the key is built.
