# ADR-0016 — The CV is reviewed, not asked

- **Status:** Accepted
- **Date:** 2026-10-04
- **Decided in:** [#326](https://github.com/adrien-mounier/jobcrush-app/issues/326) (owner grilling,
  2026-10-03/04); spec [#332](https://github.com/adrien-mounier/jobcrush-app/issues/332)
- **Evidence:** `docs/cv-brain/research/2026-10-03_thin-job-line-generation/` — the blind test the
  drafting rules and the model choice come from
- **Amends:** [ADR-0011](0011-a-hole-is-asked-blank-or-advert-triggered.md) clause 2,
  [ADR-0013](0013-the-master-cv-improves-on-the-document-it-came-from.md) clause 2,
  [ADR-0002](0002-how-a-structured-fact-reaches-the-cv.md) clause 2 — see [Amendments](#amendments)
- **Depends on:** [ADR-0007](0007-what-prints-is-decided-per-application.md) (fit is decided per
  advert; nothing is removed silently), [ADR-0008](0008-how-a-fact-arrives-read-worked-out-or-asked.md)
  (how a fact arrives), [ADR-0013](0013-the-master-cv-improves-on-the-document-it-came-from.md)
  clauses 1 and 3
- **Does not decide:** the screen's wording or layout; which model runs the review (configuration,
  per #332); the per-advert questions Tailor asks (the #301 spine); re-proposing a kept line for an
  advert that needs it (parked)

## Contents

- [Context](#context)
- [Decision](#decision)
  - [1. Discovery asks only what the CV cannot answer](#1-discovery-asks-only-what-the-cv-cannot-answer)
  - [2. The CV is reviewed instead](#2-the-cv-is-reviewed-instead)
  - [3. Untick suggestions judge quality, never fit](#3-untick-suggestions-judge-quality-never-fit)
  - [4. A drafted line is pre-filled, unticked, cited and bound by R1–R6](#4-a-drafted-line-is-pre-filled-unticked-cited-and-bound-by-r1r6)
  - [5. Every line is ticked or kept; only ticked lines print](#5-every-line-is-ticked-or-kept-only-ticked-lines-print)
  - [6. The jobs wait for a completed review](#6-the-jobs-wait-for-a-completed-review)
  - [7. Generated once, stored](#7-generated-once-stored)
- [Amendments](#amendments)
- [What this rule does NOT change](#what-this-rule-does-not-change)
- [Alternatives rejected](#alternatives-rejected)
- [Verification](#verification)

## Context

After upload, discovery asked four **family floor** questions — *"did you own delivery end to end?"*,
*"which groups did you coordinate?"* — without reading the CV first. Walked with the owner's real
IT project manager CV, only two of six questions earned their place (work rights, languages); the CV
already answered the rest, often word for word. A free-text answer was stored as a confirmed fact even
when it said *"I don't know"*. The reverse case got no help: a job with a title, dates and one line was
handed a blank question to write its lines from scratch.

Three standing rules forced that shape: ingestion may not judge quality (ADR-0011 clause 2), anything
without a verbatim guard must be asked, never pre-filled (ADR-0013 clause 2), and a thin line shows
empty holes, never drafted substance (ADR-0002 clause 2). The research run showed a drafter bound by
explicit rules (R1–R6 below) recovers the person's own facts without inventing them — on the models
that flag a guess as a guess. Under those rules, a drafted, cited, unticked line is a proposal on a
screen the person is looking at, which is exactly what ADR-0013 clause 3 already calls *not silent*.

## Decision

### 1. Discovery asks only what the CV cannot answer

The four family-floor questions leave discovery. Discovery keeps the **eligibility** questions: work
rights once per chosen market, and languages — pre-ticked where the CV says Native, Fluent or
Professional, shown unticked with the CV's own level otherwise. Every question offers **"Not sure"**,
which stores nothing. No countdown of answers remaining is ever shown.

The family floor keeps its matching and scoring roles; its must-haves now feed the drafter
(clause 4) instead of a question queue.

### 2. The CV is reviewed instead

Before any jobs are shown, a mandatory **review** walks the CV: the letterhead first, then each job in
turn. Per job it carries spelling and grammar **fixes** (applied, listed original → corrected, each
undoable), **untick suggestions** (clause 3), **drafted lines** (clause 4) with **vague-phrase
choices**, a missing-end-date question, and any import conflict. A job that needs nothing says so —
that is where the upload visibly pays off.

The review runs in the background from the moment the CV is read, using the whole CV as context for
every job, checkpointed per job so a retry never re-spends finished work. If it fails after retries,
the screen still opens with the CV's lines as read and nothing else, and the person can still finish —
silently, per the *never show the kitchen* rule.

### 3. Untick suggestions judge quality, never fit

The review may suggest unticking a line only for a **quality** reason — weak, duplicate, or an aim
with no result — stated in one sentence. **Fit to a target job is never a reason**: fit is decided
per advert (ADR-0007). A suggestion is never applied by the machine; the line arrives ticked and the
person decides. An unticked line is **kept**, never deleted, and can be re-ticked at any time —
ADR-0007 clause 4's *nothing is removed silently, and the candidate can put it back*, applied to the
master CV.

### 4. A drafted line is pre-filled, unticked, cited and bound by R1–R6

For each must-have of a job's **own** family placement that the job does not already show, the review
drafts one line. A job placed in no published family gets fixes and judgements but no drafted lines.

Every drafted line obeys the drafting rules:

- **R1 — duties only.** No number, achievement, system, client or certification the CV does not name.
  A skill listed anywhere on the CV may be used.
- **R2 — true for anyone at that level.** A duty that varies (owning a budget, managing people,
  choosing vendors) is its own line, flagged **OPTIONAL**.
- **R3 — verbs follow seniority** in that job.
- **R4 — an industry-only guess is flagged** **INDUSTRY GUESS**.
- **R5 — never repeat** what the job already says.
- **R6 — never pad;** at most 10 lines per job.

Every drafted line **cites its source** — the must-have it covers and/or the verbatim CV words it came
from. It arrives **unticked**. A vague phrase inside it is tappable, offering choices with the CV's own
words first, then typical ones, each marked as which, plus a free-text box. The person may edit before
ticking; a ticked line becomes a **user-resolved fact**, its origin recording *drafted, then accepted*.

### 5. Every line is ticked or kept; only ticked lines print

Every CV line carries a state: **ticked** (prints) or **kept** (held in the profile under *kept for
when a job needs it*, never printed). Lines read from the CV arrive ticked; drafted lines arrive
unticked. **The gate is server-side:** the master CV, every tailored draft and every export render
ticked lines only, through the same gate that refuses unconfirmed content. A client cannot print an
unticked line by asking.

A fix is applied by default with its original stored, so undo restores it exactly.

### 6. The jobs wait for a completed review

The deck gate changes from *essential floor covered* to **review completed**: the person reached the
end of the review and confirmed it. Undecided drafted lines do not block completion — they simply do
not print. The gate stays server-side. The review can be reopened later; it is the only place CV lines
are edited.

> **Amended by [ADR-0017](0017-the-cv-chat-proposes-from-the-persons-own-words.md)** (2026-10-06): CV
> lines are edited only in the CV chat's tab, which the review screen and the profile both open. The
> deck gate is unchanged.

### 7. Generated once, stored

A drafted line is never regenerated behind the person's back — the same input gives different wording
each run, and what was ticked must stay what was ticked. A new upload re-runs the review; ticks, edits
and undone fixes carry over for every line whose original text is unchanged within the same job.

## Amendments

| Amended clause | Old rule | New rule |
|---|---|---|
| [ADR-0011 clause 2](0011-a-hole-is-asked-blank-or-advert-triggered.md#2-ingestion-asks-about-facts-never-quality) | *Ingestion asks about facts, never quality.* | The review **judges quality at ingestion**, as suggestions only: fixes are listed and undoable, untick suggestions are never applied by the machine (clause 3). Ingestion still *asks* only about facts. |
| [ADR-0013 clause 2](0013-the-master-cv-improves-on-the-document-it-came-from.md#2-improvement-never-means-invention) | *Where no verbatim guard is possible, the item is offered as a question, never pre-filled.* | A drafted line **may be pre-filled**, provided it arrives **unticked**, **cites its source**, and obeys **R1–R6** (clause 4). The verbatim guard still applies wherever it fits; *improvement never means invention* stands, now enforced by R1. |
| [ADR-0002 clause 2](0002-how-a-structured-fact-reaches-the-cv.md#2-thin-input-propose-the-shape-never-the-substance) | *Propose the shape, never the substance* — empty holes, nothing pre-filled. | A thin job gets a drafted line whose **vague phrases are choices** (CV words first, typical second, marked, plus free text) **instead of empty holes**. Clause 1's ban on invented precision stands, carried by R1. |

## What this rule does NOT change

- **ADR-0007 stands whole.** Fit is decided per advert — the review never judges a line by fit, and a
  kept line is held, not lost. Nothing is removed silently: an untick is the person's tap, never the
  machine's.
- **ADR-0008 stands.** A drafted line is neither *read* nor *worked out*; it becomes a fact only when
  the person ticks it, which is a user-resolved arrival.
- **Advert-triggered questions stand** (ADR-0011 clause 1). The review replaces ingestion questions
  about the person's own duties, not the questions an advert raises at the moment it matters.
- **The family floor still matches and scores.** Only its role as a discovery question queue ends.
  [ADR-0015](0015-a-family-floor-may-name-equipment-a-family-scope-may-not.md)'s *"the floor … gates the
  reveal"* now reads: the floor feeds the drafter; the review gates the reveal.

## Alternatives rejected

| Rejected | Why it was attractive | What it cost |
|---|---|---|
| **Keep the floor questions, but skip ones the CV answers** | Smaller change; the question machinery exists. | Still makes the person describe their own work, and a thin job still gets a blank box to fill from scratch. |
| **Empty holes, as ADR-0002 clause 2 had it** | Nothing drafted, so nothing to wave through. | The research run: a thin job stays thin. Choices drawn from the CV raise real material faster than a blank does. |
| **Apply untick suggestions automatically** | Tighter CV with no taps. | The machine removes silently — the defect ADR-0007 clause 4 forbids. |
| **Judge lines by fit to the target role** | One easy lens. | The research run marked a real revenue result "off-topic". Fit belongs to the advert (ADR-0007). |
| **Regenerate drafts on each visit** | Always the freshest wording. | What the person ticked changes under them. |

## Verification

This ADR is wrong if a drafted line prints without a tick, if an untick happens without the person's
tap, if an untick suggestion cites fit to a job, or if a drafted line names a number, system, client
or certification absent from the CV. Each is checkable on the stored review and the rendered CV.
