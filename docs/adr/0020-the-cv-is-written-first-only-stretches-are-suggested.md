# ADR-0020 — The CV is written first; only stretches are suggested

- **Status:** Accepted
- **Date:** 2026-10-23
- **Decided in:** [#408](https://github.com/adrien-mounier/jobcrush-app/issues/408) (owner grilling,
  2026-10-22/23, after his staging run of 2026-10-22), with the layout settled on the prototype
  branch `prototype/stretch-suggestions-408`
- **Amends:** [ADR-0011](0011-a-hole-is-asked-blank-or-advert-triggered.md) clauses 1 and 2,
  [ADR-0005](0005-a-stretch-belongs-to-its-advert.md) clauses 3, 5 and 9,
  [`tailoring-reasoning.md`](../cv-brain/tailoring-reasoning.md) §8 clauses 6–8; replaces the
  requirement half of spec [#301](https://github.com/adrien-mounier/jobcrush-app/issues/301)'s *one
  question queue* ([#292](https://github.com/adrien-mounier/jobcrush-app/issues/292))
- **Depends on:** [ADR-0005](0005-a-stretch-belongs-to-its-advert.md) (a stretch belongs to its
  application; it is shown with the line it pushes out; written once, frozen at render),
  [ADR-0007](0007-what-prints-is-decided-per-application.md) (what prints is decided per application),
  [ADR-0008](0008-how-a-fact-arrives-read-worked-out-or-asked.md) (a fact arrives read, worked out or
  asked; the machine never asks for a value it can work out),
  [ADR-0014](0014-the-job-labeler.md) (a job may be placed in more than one family),
  [ADR-0017](0017-the-cv-chat-proposes-from-the-persons-own-words.md) (the CV chat), map #127 owner
  decision 9 (the product proposes stretches; the machine never adds silently)
- **Does not decide:** the wording of the suggestion's controls beyond the three answers below; the
  chat's door on the gap list (it ships with [#350](https://github.com/adrien-mounier/jobcrush-app/issues/350)); the
  mute list ADR-0011 clause 4 requires before any "never again"

## Contents

- [Context](#context)
- [Decision](#decision)
  - [1. Only eligibility comes before the CV](#1-only-eligibility-comes-before-the-cv)
  - [2. Tailoring is silent; a stretch is only ever suggested](#2-tailoring-is-silent-a-stretch-is-only-ever-suggested)
  - [3. Suggestions sit beside the finished draft](#3-suggestions-sit-beside-the-finished-draft)
  - [4. Three answers, three scopes](#4-three-answers-three-scopes)
  - [5. A bar the record answers is never decided by the scorer](#5-a-bar-the-record-answers-is-never-decided-by-the-scorer)
  - [6. "Also asked, not on your CV" is a list with no button, for now](#6-also-asked-not-on-your-cv-is-a-list-with-no-button-for-now)
  - [7. The application-time sharpening question is deleted](#7-the-application-time-sharpening-question-is-deleted)
- [What this does NOT change](#what-this-does-not-change)
- [Alternatives rejected](#alternatives-rejected)
- [Verification](#verification)

## Context

The owner's staging run (2026-10-22) pasted a Hong Kong digital transformation project manager job
with 15 requirements. Before writing anything, the Tailor step asked him **7 yes/no questions** about
the job's own sentences — *"This job wants: 8+ years' experience in project management, consulting, or
business transformation. Does that describe you?"* None was a real gap:

- **5 were partial matches** the scorer rated 0.5–0.79. Anything under 0.8 was asked, so "mostly" read
  the same as "missing".
- **2 were false gaps.** The years bar was rated 0.5 because the scorer cannot see job dates (*"no
  explicit total years"*), then multiplied by 7.6/8 worked-out years, while his dated jobs hold 9.8
  years in the fields the job names. His Master's degree was scored 0.3, 0.6, 0.9 and 0.6 against a
  bachelor's requirement across runs.
- **His "Yes" was stored as the job's own sentence**, printed as a bullet, and never counted as met.

His target, in his words: *"I expect the tailored CV to be 90% generated; only some suggestions to
stretch the profile to fit the job ad perfectly should be suggested/asked."* The agreement before
(spec #301, from #292) was *ask only what the CV does not already answer*; the build asked every
requirement the scorer was unsure of. This ADR replaces that queue's requirement half rather than
tuning its threshold, because the answer to a requirement the CV does not meet is never a yes/no: it
is a line the person can choose to claim, or nothing.

## Decision

### 1. Only eligibility comes before the CV

Before the draft, the Tailor step asks at most two kinds of thing: **the right to work** in the job's
market and **a language the job requires**. Each is asked once ever and stored on the profile (#292's
rules stand: *"Not sure yet"* stores nothing and comes back next time). When neither is open, there is
**no question screen**: the draft is the first thing the person sees.

Never asked, on any job: a requirement as yes/no, years of experience (they are worked out from job
dates; asking is a bug, ADR-0008), a partially met requirement, a gap, or an "add a number" prompt.

### 2. Tailoring is silent; a stretch is only ever suggested

- **Tailoring** is saying the person's own facts in the job's words. The CV writer does it without
  asking — that is the product's job, and #290 ruling 7 found every stretch in nine real runs was this
  kind.
- **A stretch** is any line that claims a skill, field, scope, number or title the person's facts do
  not hold. The CV writer **never writes one**. It is only suggested, beside the draft, and reaches the
  CV only by the person's tap.

The word *stretch* means only the second. *Wording stretch* is retired (GLOSSARY.md).

### 3. Suggestions sit beside the finished draft

The CV is written first, from true facts only. Then **one more AI step** reads the finished draft
against the job's requirements it does not fully meet and proposes stretches. Each suggestion shows:

- the requirement it answers, and **why it fired** — what the job asks and what the CV shows
  (ADR-0005 clause 3: a stated reason is information, not a guardrail);
- **the line in**, written once and printed verbatim if used (ADR-0005 clause 6);
- **the line out** it would push from the same slot, in full — a bullet for a bullet under the same
  job, a summary line for a summary line; a skill may push out nothing (ADR-0005 clause 4);
- **what to say if asked** — the interview line that defends that exact sentence.

The suggestion is made only when the line in is **better for this job than the line out**, and that
comparison runs explicitly (ADR-0005 clause 4 step 3). A denied capability is never the subject of a
suggestion (`tailoring-reasoning.md` §8 clause 3). The person may edit the wording before using it; the
interview line is then rewritten to match the edited sentence, so the line printed is the line
defended (ADR-0005 clause 6).

On a computer the draft is the page and the suggestion being looked at previews in place on it; on a
phone the suggestions come one at a time. The rest is design, carried by the prototype.

### 4. Three answers, three scopes

| Answer | Scope | What it does |
|---|---|---|
| **Use for this job** | This application only (ADR-0005 clauses 1–2) | The line prints on this CV. The requirement counts as met on **this job's match only** and shows as *met by a stretch*; this job's % goes up and no other job's moves. The interview line goes into the application report's *Be ready to explain*. |
| **It's true: keep it on my CV for every job** | The person's profile | The person states it as their fact: it joins the **master CV** with the person as its origin (ADR-0008, *asked*), prints on this CV as an ordinary fact, and the requirement counts as plainly met. The line it pushed out on this CV stays on the master CV; which one prints is decided per application (ADR-0007). |
| **No** | This job only | Nothing changes. Another job may suggest the same line again. |

A suggestion still unanswered when the person approves the CV is **left out**, as a "No".

**The score moves because the CV moved** (owner's call, against the recommendation to score true facts
only). The % describes the CV he is about to send; the card says *met by a stretch*, so it is never
passed off as a plain match.

"It's true" is a permanent change behind one tap, the transition ADR-0005 clause 5 warns must not feel
incidental. It is therefore **never on the same row as "Use"**, and its confirmation carries an Undo.

### 5. A bar the record answers is never decided by the scorer

- **Years.** A years bar is met or short on the worked-out number alone. A bar naming several fields
  (*"project management, consulting, or business transformation"*) counts every job whose actual work
  falls in **any** field the job names that the product publishes, each job once; a field it does not
  publish adds nothing. The scorer's reading of a CV sentence never moves a years verdict.
- **A job can be two kinds of work.** Placement follows what the job's lines describe, never its title.
  A product owner job that also ran delivery is both kinds of work, and the person's correction may say
  so: the one-family correction is widened to accept more than one family. This does not reopen the
  2026-08-20 refusal to widen *IT project delivery* to cover product ownership: the vocabulary stays as
  it is, and the job is placed in both families because its work was both.
- **A shortfall is shown, never asked.** The card shows it; a stretch may bridge it.
- **Degree level.** A degree requirement is decided by the person's highest degree against the bar: a
  Master's meets a bachelor's.

### 6. "Also asked, not on your CV" is a list with no button, for now

Beside the draft, a short list names every requirement the CV does not meet — no fact and no used
stretch covers it — including a capability the person has denied. It has **no button** until the CV
chat ships: its door then opens the chat ([ADR-0017](0017-the-cv-chat-proposes-from-the-persons-own-words.md),
spec #350) on that requirement, and an added fact redrafts this CV. A disabled *coming soon* button was
rejected: a control that does nothing is noise.

### 7. The application-time sharpening question is deleted

ADR-0011 clause 2 moved the *"a number helps"* question to the moment of application. It was never
built, and it is now deleted: the application asks nothing but eligibility (clause 1). Strengthening the
person's own lines belongs to the CV review (ADR-0016, ADR-0018) and the CV chat (ADR-0017), where the
change lands on the master CV for every job.

## What this does NOT change

- **ADR-0005's core holds.** A used stretch belongs to its one application and never enters the
  profile; "It's true" is the person stating a fact, which ADR-0005 clause 5 already names as how a
  real fact supersedes a stretch.
- **A denied capability never prints and is never implied** (`tailoring-reasoning.md` §8 clauses 1–3).
- **The report keeps its sentence for every gap** (§8 clauses 11–12, #401): a requirement on the
  "Also asked" list still gets its nearest-true line in *where you are not strong*.
- **The conservation principle** (`tailoring-reasoning.md` §6) still governs the draft; a stretch's
  line out is shown, so it is not a silent amputation.

## Alternatives rejected

| Rejected | Why it was attractive | What it cost |
|---|---|---|
| **Keep the queue, lower the threshold** to ask only fits under 0.5 | Smallest change to a shipped spec. | Still a question per gap, and a yes/no is the wrong answer to a gap: the useful answer is a line to claim or nothing. No threshold fixes the two false gaps: they come from what the scorer cannot see. |
| **Suggest stretches before the draft** (#408's own proposal, §8 clause 8) | One screen of decisions, then a finished CV. | He judges a stretch without seeing the line it pushes out, which ADR-0005 clause 4 requires him to see; the draft must exist to name it. |
| **Write stretches into the draft and let him remove them** | No extra step to read. | The machine adds silently — the one clause of decision 9 that is the owner's own. |
| **Score true facts only; show the stretch beside the %** (the agent's recommendation) | The % stays a pure measure of the person. | Overruled by the owner: the % should describe the CV being sent, and *met by a stretch* already keeps it honest. |
| **One "Yes" that both uses the line and keeps it** | One button fewer. | Merges "for this job" with "for every job", the large transition ADR-0005 clause 5 says must not hide behind a small control. |
| **"Never suggest this again"** | Quiet; no repeats. | A permanent, invisible choice. ADR-0011 clause 4: no "stop asking" without the mute list that undoes it. |
| **A disabled "coming soon" button on the gap list** | Signals the door is coming. | A control that does nothing; rejected by the owner. |
| **Ask the years when short** | He knows his own career. | The dates already answer it; ADR-0008 forbids asking for a value the machine works out. |

## Verification

- On the owner's 2026-10-22 job, with work rights and language already on his profile, the Tailor step
  shows the draft with **no question screen**, and no requirement question exists in any build.
- A years bar the scorer rated 0.5 is **met** when the worked-out years in the named fields reach the
  bar, and short when they do not, whatever the scorer said.
- Every suggestion carries its requirement, why, line in, line out (or none for a skill) and what to
  say; a run where the suggestion step did not run is distinguishable from one that found nothing to
  suggest (ADR-0005's negative-test warning).
- "Use for this job" raises this job's % and labels the requirement *met by a stretch*; another job's %
  is unchanged; the interview line appears in that application's report.
- "It's true" puts the line on the master CV; the line it pushed out is still on the master CV.
- The "Also asked, not on your CV" list has no button in any build before #350's door ships.
