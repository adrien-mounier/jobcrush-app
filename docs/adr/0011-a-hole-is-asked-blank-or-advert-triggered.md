# ADR-0011 — A hole is asked now, shown as a blank, or asked when an advert makes it matter

- **Status:** Accepted
- **Date:** 2026-08-07
- **Decided in:** owner grilling during the `/to-tickets` pass on map
  [#127](https://github.com/adrien-mounier/jobcrush-app/issues/127) — the map's last fog item
  (*"which holes get a question, and which get a visible blank"*), resolved so the ingestion build
  ticket could be written clean
- **Depends on:** [ADR-0008](0008-how-a-fact-arrives-read-worked-out-or-asked.md) (a silence is
  *askable*; this ADR decides which silences are *asked*), [ADR-0002](0002-how-a-structured-fact-reaches-the-cv.md)
  clause 2 (a hole can show as a visible blank), [#125](https://github.com/adrien-mounier/jobcrush-app/issues/125)
  decision 4 (an advert may trigger a question at the moment it matters), owner decision 8 on #127
  (ingestion is chunked, resumable, gamified), [#143](https://github.com/adrien-mounier/jobcrush-app/issues/143)
  (the unknown-end hole is always asked, with the reason said aloud),
  [#137](https://github.com/adrien-mounier/jobcrush-app/issues/137) (announced length drives drop-off;
  answer quality decays by position; no reliable abandonment number exists — instrument our own)
- **Does not decide:** the wording, layout, or reward design of the ingestion experience (the design
  effort, [#157](https://github.com/adrien-mounier/jobcrush-app/issues/157)); which topics exist as
  chunks (that follows the element list); anything about capture (#130's *capture the maximum* stands)

## Context

ADR-0008 clause 4 made every silence in every element **permitted** to become a question — and
explicitly did not decide that it happens. With *capture the maximum* across five elements, the gap
between *permitted* and *actual* is the gap between a sign-up someone finishes and one they abandon.
This was the one genuinely undecided item left on map #127 when its build tickets were written, and it
is the decision that sets how long sign-up actually is.

Three channels already existed in decided form, each in a different place: ask during ingestion
(#128's *every missing month is asked*), show the hole as a visible blank the person may fill
(ADR-0002 clause 2), and let an advert trigger the question at the moment it matters, with the reason
(#125 decision 4, for language levels). What was missing was the sorting rule.

## Decision

### 1. Three channels, sorted by consequence

A hole found at ingestion goes down exactly one of three paths:

- **Asked now** — only when the answer **changes what the machine can do for the person**: it moves an
  eligibility gate, the years-of-experience total, or a level adverts test. (#143's always-asked hole —
  a job with an unknown end — is this clause applied: that silence zeroes years of a career.)
- **A visible blank** — every presentation-only hole. It shows on the **profile / master CV view**,
  fillable whenever the person likes, and **never prints on a tailored CV** (#143 already decided
  this for dates; it now governs every blank).
- **Advert-triggered** — a hole an advert tests is asked **at the moment that advert appears**, with
  the reason said aloud (*"this advert wants Mandarin — how comfortable are you running a meeting in
  it?"*). #125's language pattern, generalised to every tested hole.

The cost, accepted knowingly: the profile is less complete on day one, and cards say *"this bar wasn't
tested"* more often in the early days. The gain: sign-up length stops being unbounded, because the
long tail of *could ask* moves to *an advert will ask when it matters*.

### 2. Ingestion asks about facts, never quality

The polish question — *"anything to add to this bullet? A number helps"* — never fires at ingestion.
It moves to the **moment of application**: when a thin sentence is load-bearing for a real advert, the
product asks then, with the reason (*"this advert leads on cost reduction — your bullet mentions it
with no number"*). The answer is the person's own fact, arrived **asked** (ADR-0008), permanent, and
strengthens every later CV — it is sharpening their own claim, not a stretch, and it needs none of
ADR-0005's machinery.

### 3. A chunk is bounded by its topic, never by a number

*"Let's do your job at Standard Chartered"* ends when that job's holes are done — one question or
five. **No total question count is ever announced** (#137: announced length is the abandonment
driver); progress reads as **topics done**, never questions left. Chunks run **most consequential
first**: the most recent job, then the gated basics (work rights, a silent degree), then older jobs —
so quitting early costs the least consequential answers.

### 4. A skip means "not now" — and "stop asking" cannot exist without its undo

A skipped advert-triggered question may be asked again by a **later** advert that tests the same
thing (the reason is genuinely fresh), and **never twice for the same advert**. Answering closes it
permanently — which is #125's *asked once per language ever*, kept: *once ever* counts answers, not
skips.

**"Stop asking about this" ships only together with the surface that undoes it**: a muted question is
a visible, listed, one-tap-reversible entry on the person's profile — the *declared, restorable*
shape ADR-0007 clause 4 uses for withheld facts, reused not invented. Until that surface exists,
every skip is "not now". The rationale is #120's live harm and the owner's own decline-wording
objection: a misread or mistapped permanent control silences a question that could win a later job,
invisibly. The control's wording and confirmation design belong to the design effort (#157 item 2 is
the same shape).

### 5. The absorption is measured, not assumed

Owner decision 8's premise — chunking absorbs the question volume — is untested, and #137 found no
industry number to borrow. The ingestion build ships **with its own instrumentation as acceptance
criteria**: per-topic completion rates, where in a chunk people quit, per-question skip rates, and
mute-list usage once it exists. A bet that is not measured stays untested forever, on live users,
silently — the *found-nothing vs did-not-run* failure shape this map kept finding elsewhere.

## What this rule does NOT change

- **Capture is untouched.** A hole not asked about is still a hole we hold and show; nothing here
  discards content (#130).
- **ADR-0008 is untouched.** Every silence remains *askable*; this ADR decides which permitted
  questions actually fire, and through which channel.
- **The always-asked holes stand.** #143's unknown job end (asked, reason aloud) and #128's missing
  months on a job the person is narrating are clause 1's *asked now* channel, not exceptions to it.
- **Nothing here permits the machine to infer.** An unasked hole stays a hole — never a guess.

## Alternatives rejected

| Rejected | Why it was attractive | What it cost |
|---|---|---|
| **Ask everything askable** (clause 1) | Maximally complete profile on day one. | An unbounded sign-up — the thirty-question wall decision 8 exists to prevent, now with ADR-0008 clause 4 having made every silence in every element askable. |
| **Polish questions die entirely** (clause 2) | Cheapest; ingestion stays short with no relocation. | The product can only rearrange weak material, never improve it — while the far riskier stretch machinery exists. Helping strengthen the person's own claims is the product. |
| **A numeric cap per chunk** (clause 3) | Predictable worst case. | The 5-cap was already overruled by owner decision 7; a number silences whichever question happens to come last, regardless of consequence. The topic is the honest bound. |
| **Announce the question count** (clause 3) | Feels transparent. | #137: it is the *announced* length that drives drop-off. Progress as topics is the honest version of not announcing. |
| **A skip closes the question forever** (clause 4) | Quiet; no nagging, ever. | One distracted tap permanently silences a question about a real capability — #120's mistap harm, relocated. |
| **"Stop asking" with no mute list** (clause 4) | Ships sooner. | A permanent, invisible, irreversible user choice — the exact shape this product forbids the machine, now offered to accidents. |

## Verification

- No ingestion question aims at *quality* — every one points at a hole in a fact.
- No surface ever shows a total question count remaining.
- A skipped advert-triggered question never re-fires on the same advert; an answered one never
  re-fires anywhere.
- No "stop asking" control exists in any build before the profile's mute list does.
- The ingestion funnel numbers (per-topic completion, quit points, skip rates) are queryable — a
  funnel that shows nothing must be distinguishable from instrumentation that did not run.
