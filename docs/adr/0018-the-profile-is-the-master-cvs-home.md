# ADR-0018 — The profile is the master CV's home; the review becomes its check mode

- **Status:** Accepted
- **Date:** 2026-10-11
- **Decided in:** [#375](https://github.com/adrien-mounier/jobcrush-app/issues/375) (owner grilling
  and prototype, 2026-10-11, V2.1 approved), [#371](https://github.com/adrien-mounier/jobcrush-app/issues/371)
  (About you), [#376](https://github.com/adrien-mounier/jobcrush-app/issues/376) (the start stops asking)
- **Evidence:** [`docs/design/profile-check-mode-prototype.html`](../design/profile-check-mode-prototype.html),
  the approved prototype (contact details replaced), holding every version the decisions were made on
- **Amends:** [ADR-0016](0016-the-cv-is-reviewed-not-asked.md) clauses 1, 2, 3, 5 and 6;
  [ADR-0017](0017-the-cv-chat-proposes-from-the-persons-own-words.md)'s amendment of ADR-0016 clause 6
  — see [Amendments](#amendments)
- **Depends on:** [ADR-0005](0005-a-stretch-belongs-to-its-advert.md) (upheld, clause 8),
  [ADR-0007](0007-what-prints-is-decided-per-application.md) (what prints is decided per application),
  [ADR-0011](0011-a-hole-is-asked-blank-or-advert-triggered.md) clause 1 (advert-triggered questions),
  [ADR-0013](0013-the-master-cv-improves-on-the-document-it-came-from.md) clause 1 (a fact may move to
  the section a reader expects), ADR-0016 clauses 4 and 7 (R1–R6; generated once)
- **Does not decide:** exact wording and motion (the prototype is the reference); the extras cap and
  where it applies ([#374](https://github.com/adrien-mounier/jobcrush-app/issues/374)); where and at
  what cost "About you" is generated (#371's open points); how existing review data migrates (the spec)

## Contents

- [Context](#context)
- [Decision](#decision)
- [Amendments](#amendments)
- [What this rule does NOT change](#what-this-rule-does-not-change)
- [Alternatives rejected](#alternatives-rejected)
- [Verification](#verification)

## Context

ADR-0016 replaced discovery questions with a **review** of the uploaded CV, on its own page ("Your CV,
reviewed"): every line ticked (prints) or kept (never prints), drafted lines unticked. Run on the
owner's real CV (2026-10-08 and 2026-10-11), the page read as a second copy of the CV, the ticks read
as "on my CV" although the profile holds far more than any CV prints, and the profile, where a person
returns, held none of it. The owner proposed the profile as the master CV's one home; a
`/challenge-with-codex` pass agreed on the home but warned that checking an upload is not the same as
storing it. That split is kept: the profile stores, and **check mode** is how an upload is checked
inside it. Seven prototype versions settled the shape; the owner approved **V2.1**.

## Decision

1. **The profile is the master CV's one home.** Its sections follow the CV: Your details, About you,
   each job, Personal projects, Skills, Education, Languages, Additional information. The "Your CV,
   reviewed" page goes. The constellation view stays; check mode runs in the sorted list.
2. **What is shown is in.** There are no tick boxes. Each item is **in** the profile or **removed**.
   The person may edit an item's words or remove it in place. A removed item is held, listed under
   "N removed · Show" at the end of its section, and put back in one tap. No application uses a removed
   item. Which items print is decided per application (ADR-0007).
3. **After an upload, the profile opens in check mode,** a guided walk with one screen per section in
   the order above, a progress line and one button. Each screen's button **confirms that screen**;
   cards carry no confirm button of their own. The button stays disabled, saying what is left, until
   every suggestion on the screen is answered and every required field is set. After the last screen
   the profile is a normal profile. A re-upload brings check mode back for new items only.
4. **The machine suggests two things, and they look different.**
   - **Add** (dashed gold frame, ⊕): a drafted item for a job, bound by ADR-0016 clause 4 (R1–R6,
     cited, "Only if true" for OPTIONAL and INDUSTRY GUESS). Answers: *Add it*, *Edit first*,
     *No thanks*. A suggestion is not in the profile until added.
   - **Remove** (coral bar, ⊖): only for an item that belongs nowhere in a profile: a duplicate, a
     fragment broken by reading the PDF, or personal data that hurts on any CV (date of birth, marital
     status). Answers: *Remove it*, *Keep it*. **A true but weak item is never suggested for removal**;
     each application leaves it out when it does not fit.
   *No thanks* means the same suggestion is never made again from the same evidence. A job ad, the CV
   chat (ADR-0017) or a re-upload with new text may raise it again.
5. **The person's own facts are not suggestions.** Your details are editable fields from the start.
   **About you** is written by the machine from the whole CV (#371), kept or edited, with "See what your
   CV said" showing the original; it has no add or remove answer. **Where you can work** is pre-filled
   from the CV and confirmed per market. These sit in plain cards, never in a suggestion frame.
6. **Moves happen without asking, and show.** A fact in the wrong section moves to the one a reader
   expects (ADR-0013 clause 1), tagged with where it came from ("Moved from your summary", "Moved from
   BRED"). A tool list leaves its job for Skills; an achievement stays under its job and only the tool
   name is **copied** to Skills ("Taken from BRED"). Skills are split one per item whatever separator
   the CV uses, and grouped by the machine under the CV's group names or its own; grouping is not an
   item to answer.
7. **The jobs wait for check mode to finish.** The deck gate becomes: **every check-mode screen
   confirmed, every suggestion answered, and work rights confirmed for each target market.** Nothing may
   be left open. The gate stays server-side.
8. **The start asks nothing after the upload** (#376). Languages are a profile section read from the
   CV. Work rights move to the card in clause 5.
9. **A fact the person adds at tailoring joins the profile;** printing it is still decided per job ad.
   A **stretch** does not: it stays with its job ad (ADR-0005 stands whole).

## Amendments

| Amended clause | Old rule | New rule |
|---|---|---|
| [ADR-0016 clause 1](0016-the-cv-is-reviewed-not-asked.md#1-discovery-asks-only-what-the-cv-cannot-answer) | Discovery asks work rights per market, and languages. | Discovery asks nothing after the upload; both are answered in the profile (clauses 5 and 8). |
| [ADR-0016 clause 2](0016-the-cv-is-reviewed-not-asked.md#2-the-cv-is-reviewed-instead) | A mandatory review page walks the CV. | The review's work runs as before (background, checkpointed) but is shown as the profile's check mode (clause 3). No separate page. |
| [ADR-0016 clause 3](0016-the-cv-is-reviewed-not-asked.md#3-untick-suggestions-judge-quality-never-fit) | Untick suggestions for weak, duplicate or no-result lines. | Untick suggestions end. A removal is suggested only for an item that belongs nowhere (clause 4); a misplaced item moves (clause 6). Fit is still never a reason. |
| [ADR-0016 clause 5](0016-the-cv-is-reviewed-not-asked.md#5-every-line-is-ticked-or-kept-only-ticked-lines-print) | Every line is ticked (prints) or kept (never prints). | Every item is in or removed (clause 2). Removed items are never used; in items are used per application. The print gate stays server-side and refuses removed items and unanswered suggestions. |
| [ADR-0016 clause 6](0016-the-cv-is-reviewed-not-asked.md#6-the-jobs-wait-for-a-completed-review) | The jobs wait for a confirmed review; undecided drafted lines do not block. | The jobs wait for finished check mode; **every suggestion must be answered** (clause 7). |
| ADR-0017's amendment of ADR-0016 clause 6 | CV lines are edited only in the CV chat's tab. | The person may also edit an item's words and remove it in place in the profile (clause 2). The chat stays the way to add or reword by talking, and still never removes. |

## What this rule does NOT change

- **ADR-0016 clause 4 (R1–R6) and clause 7 (generated once) stand.** Drafted items keep their rules,
  citations and flags, and are never regenerated behind the person's back.
- **ADR-0007 stands.** The profile holds more than any CV prints; each application picks. Nothing is
  removed silently: a removal is the person's tap.
- **ADR-0011 clause 1 stands.** A job ad may still ask what it tests and the profile does not show.
- **The profile's "no what-you-lack" rule stands** outside check mode: suggestions appear only there.

## Alternatives rejected

| Rejected | Why it was attractive | What it cost |
|---|---|---|
| **Keep the review page; fix its bugs** | Built and tested. | Two homes for one CV; ticks read as "on my CV"; the profile, where people return, held nothing to check. |
| **Tick boxes in the profile** | One familiar control. | A tick meant "used", "printed" or "added" depending on who read it. The owner found every reading confusing. |
| **Suggestions only at tailoring** | No work at upload. | Gaps found once per job ad, never fixed in the profile; the same question asked again and again. |
| **The whole profile on one page with a to-check bar (prototype V1, V3)** | Everything visible at once. | The owner chose to be taken by the hand, one section at a time (V2.1). |
| **Undecided suggestions don't block** (ADR-0016 clause 6) | Faster to the jobs. | Suggestions left open forever; the profile never settles. |

## Verification

This ADR is wrong if a removed item or an unanswered suggestion reaches any rendered CV; if the deck
opens with a suggestion unanswered, a screen unconfirmed or a market's work rights unset; if the machine
removes an item without the person's tap; if a removal is suggested for a true item on quality or fit
grounds; if a dismissed suggestion returns from unchanged evidence; or if a stretch appears in the
profile. Each is checkable on the stored profile, the gate's refusal and the rendered CV.
