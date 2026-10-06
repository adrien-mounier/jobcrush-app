# ADR-0017 — The CV chat proposes, from the person's own words only

- **Status:** Accepted
- **Date:** 2026-10-06
- **Decided in:** [#346](https://github.com/adrien-mounier/jobcrush-app/issues/346) (owner grilling,
  2026-10-06)
- **Amends:** [ADR-0016](0016-the-cv-is-reviewed-not-asked.md) clause 6 — see [Amendments](#amendments)
- **Depends on:** [ADR-0005](0005-a-stretch-belongs-to-its-advert.md) (a stretch belongs to its
  advert — upheld here, clause 5), [ADR-0007](0007-what-prints-is-decided-per-application.md) (what
  prints is decided per application; nothing is removed silently),
  [ADR-0016](0016-the-cv-is-reviewed-not-asked.md) clauses 3–5 (ticked and kept lines; R1–R6)
- **Replaces:** the *Add something new* flow ([#316](https://github.com/adrien-mounier/jobcrush-app/issues/316),
  [#317](https://github.com/adrien-mounier/jobcrush-app/issues/317),
  [`docs/design/add-something-new.md`](../design/add-something-new.md)) — its date rules and its
  recall step carry over (clause 6)
- **Does not decide:** free and paid modes, or moving sign-in when a chat gets long (parked in
  [#349](https://github.com/adrien-mounier/jobcrush-app/issues/349)); the tab's wording and layout

## Contents

- [Context](#context)
- [Decision](#decision)
- [Amendments](#amendments)
- [Alternatives rejected](#alternatives-rejected)
- [Verification](#verification)

## Context

The owner updates his CV today by talking to a general-purpose assistant outside the product. The
**CV chat** (shown to the person as *Chat with JobCrush*) brings that inside: the person talks, and the
product proposes changes to the **master CV**. The defect it must never have is the silent version —
the person says *"at BRED I also handled the vendor contracts"* and the CV gains "Managed vendor
contracts and budgets": an invented word, applied without being shown.

## Decision

1. **Two doors, one tab.** "+ tell us more" on one thing (a job, a line, the letterhead) opens a chat
   about that thing only; "+ add" on a section (jobs, skills, languages, education, …) opens a chat
   that adds something new of that kind. Both doors sit on the review screen and on the profile, and
   both open the same bottom tab. Using it is never required: the review completes without it.
2. **Scope follows the door.** Talk that turns to another thing gets a button opening that thing's
   tab with the person's sentence carried over — never an edit made from the wrong door.
3. **What it may change:** add lines, reword lines, add a whole job, and correct a job's dates,
   employer or title, or a letterhead detail. **It never unticks or deletes** (ADR-0007 clause 4).
4. **Everything is a chat proposal; nothing applies until tapped.** Each shows the words it came from
   (in the language they were said; the line itself is written in the CV's language). A reword or a
   corrected fact shows before → after and is undone in one tap; a reworded line, once the new one is
   ticked, moves the old one to *kept*. A new job arrives whole, its lines unticked. A changed date
   may move years of experience and therefore scores; that is correct, not a side effect to hide.
5. **Its only source is the person's own words.** It puts what was said into CV language, keeps the
   person's own numbers, and adds nothing unsaid. **It offers no stretch:** the master CV holds what the
   person did; a stretch is made at tailoring time for the advert that needs it, as ADR-0005 decides.
   No line repeats one the job already has, and verbs follow the seniority of that job. **No line cap**
   applies to what the person said — the master CV may hold more than any application prints, and
   which lines print is decided per advert (ADR-0007). A merge is suggested only for true duplicates,
   never applied.
6. **A contradiction with a stored "No" interrupts once** (the recall step decided for #317): *I have it
   now* keeps the "No" at its original date and dates the new fact; *I meant something else* erases
   the mistake. Dates follow the *Add something new* rules: a job asks start and end, a certificate
   its printed date, the month always optional and never padded.
7. **The proposals are the memory; the conversation is not.** What is kept is each proposal with its
   quoted words, ticked or not. The transcript is dropped when the tab closes, so a half-said "I think
   about 10 people, not sure" never becomes a hidden fact (the #324 defect's shape).
8. **It runs on its own configured model and budget**, not the review's: a reply must arrive while the
   person waits. A per-person daily spending cap is a safety setting, not a product feature.

## Amendments

| Amended clause | Old rule | New rule |
|---|---|---|
| [ADR-0016 clause 6](0016-the-cv-is-reviewed-not-asked.md#6-the-jobs-wait-for-a-completed-review) | *The review can be reopened later; it is the only place CV lines are edited.* | CV lines are edited only in the **CV chat's tab** (and the review's own fixes and ticks). The review screen and the profile are both ways into it. The deck gate is unchanged. |

## Alternatives rejected

| Rejected | Why it was attractive | What it cost |
|---|---|---|
| **The chat writes straight onto the CV as the person talks** | Fastest; feels like talking to an editor. | The silent version — invented words land unseen and surface when a recruiter asks. |
| **Stretches offered on the master CV, with an "if asked" note** | Stronger wording everywhere, no per-advert step. | The ADR-0005 leak: a stretch made for one advert printed on an unrelated one and displaced a real fact. |
| **Keep the whole conversation and read it back next time** | The chat "remembers". | A guess said aloud becomes a fact nobody confirmed. |
| **Only the review screen gets doors; the profile reopens the review** | One screen, ADR-0016 clause 6 untouched. | The profile is where a person returns; it would hold no way in. |
| **Dates, employer and new jobs stay in forms** | Structured input gets dates exactly right. | The person is sent out of the conversation for the most common update — a new job. |

## Verification

This ADR is wrong if a chat changes the master CV without a tap, if a chat proposal names something the
person did not say, if a chat offers a stretch, if the chat unticks or deletes, or if a stored
conversation is read back as a fact. Each is checkable on the stored proposals and the rendered CV.
