# ADR-0010 — What we cannot classify is kept, printed faithfully, and reviewed by kind

- **Status:** Accepted
- **Date:** 2026-08-07
- **Decided in:** [#149](https://github.com/adrien-mounier/jobcrush-app/issues/149), under map [#127](https://github.com/adrien-mounier/jobcrush-app/issues/127)
- **Depends on:** [ADR-0004](0004-each-elements-own-parts.md) (every fact points at its origin; a check that finds nothing must be distinguishable from one that did not run), [ADR-0007](0007-what-prints-is-decided-per-application.md) (the machine never removes silently; the strip list; declared withholdings), [ADR-0008](0008-how-a-fact-arrives-read-worked-out-or-asked.md) (a person's answer outranks any later re-read), [#130](https://github.com/adrien-mounier/jobcrush-app/issues/130) (capture the maximum), [#148](https://github.com/adrien-mounier/jobcrush-app/issues/148) (the umbrella research that sized the unclassifiable space)
- **Evidence:** all six CVs in `data/cvs/` re-read first-hand for this ticket — the measurement §5 of the ticket asked for and nobody had done
- **Does not decide:** the alert channel (Telegram, email, a dashboard — interface, handed to the design effort with the rest of [#157](https://github.com/adrien-mounier/jobcrush-app/issues/157)); the shape of any element a kind may one day graduate into (that is ADR-0001's growth rule, per verdict 4)

## Contents

- [Context](#context)
- [Decision](#decision)
  - [1. Nothing is discarded — the block is captured whole, with an origin](#1-nothing-is-discarded-the-block-is-captured-whole-with-an-origin)
  - [2. The kind is the unit — machine-proposed, owner-curated](#2-the-kind-is-the-unit-machine-proposed-owner-curated)
  - [3. Alerts are per kind, never per case](#3-alerts-are-per-kind-never-per-case)
  - [4. The default is `additional`, faithfully corrected — an owner decision, overruling the session's recommendation](#4-the-default-is-additional-faithfully-corrected-an-owner-decision-overruling-the-sessions-recommendation)
  - [5. An LLM sanity gate catches only the obviously absurd — and its removals are declared](#5-an-llm-sanity-gate-catches-only-the-obviously-absurd-and-its-removals-are-declared)
  - [6. The gate also flags the seven strip-list names inside homeless content](#6-the-gate-also-flags-the-seven-strip-list-names-inside-homeless-content)
  - [7. Review has four verdicts, verdicts apply retroactively, and waiting is honest](#7-review-has-four-verdicts-verdicts-apply-retroactively-and-waiting-is-honest)
  - [8. The negative test — for the classifier and the gate both](#8-the-negative-test-for-the-classifier-and-the-gate-both)
  - [9. Three interface requirements are named and handed to the design effort](#9-three-interface-requirements-are-named-and-handed-to-the-design-effort)
- [Consequences](#consequences)
- [Alternatives rejected](#alternatives-rejected)
- [Verification](#verification)

## Context

The owner raised this inside [#146](https://github.com/adrien-mounier/jobcrush-app/issues/146), in his
words: *"anything that we couldn't classify should be flagged and stored somewhere in our backend and
raise an alert to me by telegram for example. And we could see case by case how we would treat /
classify them. And if we can classify them at all, by default we would put them in 'additional'."*

No existing rule covered it: ADR-0001 rule 7 covers a **rollback** (the code once knew this kind),
#130 covers an entry **inside a known element**, and miner rule 8 flags only a section that yields
**zero claims** — an `Interests` block mines perfectly well, so it never flags. Not knowing what a
thing *is* was uncovered.

**The measurement, done for this ticket (2026-08-07), reframed the design before any decision was
taken.** Against every decided home — contact + links, summary, experience, education, certifications,
skills, languages, projects, additional, and the named personal-detail facts — the six-CV corpus
splits cleanly:

- **4 of 6 CVs carry zero unclassifiable content** (Adrien, Remy, Kulpakorn, Giuliana).
- **2 of 6 — the two French-style CVs (Thomas, Pierre) — carry real homeless blocks**, and they are
  the same few kinds: **interests/hobbies** (both), **travel** (Pierre a whole section, 19 countries),
  **driving licence + own vehicle** (both), **availability / notice period** (Thomas, *"disponible
  sous 1 mois"*).

So the rate is **1 CV in 3 — the owner's own "noise" hypothetical, exactly** — but it is **a short
head of recurring kinds, not a stream of novelties**. That single fact decided clause 3.

⚠️ One correction made during the session and kept for the record: **a date of birth and a photograph
are NOT homeless.** ADR-0007 already names them — when the reader *recognises* them they become facts
and the per-market strip page handles them as decided. What survives is narrower: a strip-list name
hiding **inside a blob the reader failed to classify** would print unscreened, because the withholding
pass screens recognised facts, not opaque text. Clause 6 closes that.

## Decision

### 1. Nothing is discarded — the block is captured whole, with an origin

A part of a CV with no decided home is stored complete: its **heading as written**, the **person's
words under it**, and **where it sat** in the document. Its record carries a machine-read origin
pointing at the exact source words — ADR-0004 clause 1a applies unchanged, **no new origin kind is
added**, and a homeless block pointing at nothing is a defect. This clause is what makes clause 7's
retroactivity possible: old CVs can be re-decided only because everything was kept.

### 2. The kind is the unit — machine-proposed, owner-curated

The reader proposes a kind label for each homeless block (`interests`, `driving-licence`,
`availability`); new cases attach to existing kinds. The owner can **rename or merge kinds at
review** — the labels are working handles, not a taxonomy the machine is trusted to get right.

### 3. Alerts are per kind, never per case

First sighting of a new kind alerts the owner; every later case **silently attaches and increments a
visible count**. At the measured 1-in-3 rate, per-case alerting is one alert per ~3 uploads — almost
all repeats — and the channel dies of noise while the one genuine novelty drowns. Per-kind is a
handful of alerts ever, and **the count is the build-priority signal** (*"interests: waiting on 40
CVs"*). The channel itself is an interface choice and is not decided here.

### 4. The default is `additional`, faithfully corrected — an owner decision, overruling the session's recommendation

While a kind awaits review, its content **prints**, as line(s) in the tailored CV's `additional`
section. The session recommended withheld-by-default; **the owner overruled it** — the CV is the
person's marketing document and their content ships by default.

The machine's touch is bounded to **faithful correction**: spelling, syntax, spacing, and translation
into the CV's language — **never strengthening, never summarising, never rewording.** The test is the
miner's own verbatim boundary: the person reads the line and says *"yes, that's what my CV says."*
Anything beyond cosmetics (translation included — this is content the machine understands *least*, so
a mistranslation is exactly what it cannot check) is **shown beside the original** on the review
screen.

- `Titulaire permis B / Véhiculé` → `Driving licence: B (own vehicle)`, French original one tap away.
- `…United-States, Brasil…` → `…United States, Brazil…`.
- `International exposure across 19 countries` — **never**: the machine wrote a claim the person
  never made. Decision 9's silent add, ruled out flat.

### 5. An LLM sanity gate catches only the obviously absurd — and its removals are declared

The gate exists for copy-paste accidents and manifest mistakes (*"Interests: I like to play with
water"*, a stray keyboard-smash — the corpus already contains a real one, Remy's `ssss(Power
Platform)`, albeit in a classified section). Flagged content is **withheld by default, declared to
the person, and restorable with one tap for that application** — ADR-0007's decided removal
machinery, not a new mechanism. **The gate never deletes from the record** (#130 stands), and its
scope is *big obvious mistakes*, explicitly not taste, tone, or judgment about what helps the
application. The owner accepts it is non-deterministic; a wrong call costs one visible tap, not a
lost fact.

### 6. The gate also flags the seven strip-list names inside homeless content

If one of ADR-0007's seven names — date of birth, age, marital status, photograph, race, religion,
gender — appears **inside** a block that failed classification, the gate flags it so the per-market
withholding pass can treat it as recognised. This closes the one leak the measurement surfaced:
without it, a strip name inside an unclassified blob prints unscreened in a market whose page strips
it as a fact.

### 7. Review has four verdicts, verdicts apply retroactively, and waiting is honest

When the owner reviews a kind:

1. **Re-home** — it belongs in an existing element (Thomas's `Formation Revit Intermédiaire` is
   arguably a certification). Future CVs read straight in; **waiting CVs are re-read too**, with
   anything new going through the person's normal confirm flow — a person's own answer outranks any
   re-read, per ADR-0008.
2. **Bless the default** — interests, travel: the additional line is right, permanently. The kind
   stops being "unreviewed"; no further alerts.
3. **Never print by default** — junk made standing. Still captured, still declared per person with
   put-back; just never on by default.
4. **Promote to an element** — the expensive door: ADR-0001's growth rule in full, a multi-session
   build. Until it ships the kind stays at its blessed default, so the person experiences no gap.

**A kind may wait indefinitely at its default.** *"Nothing happens for six months"* is an acceptable,
stated answer — the queue cannot become a graveyard because nothing in it is lost or hidden, and the
count says what to build next. Two people with the same CV get the same treatment regardless of
upload date; **no-retroactivity was rejected** for exactly that unfairness.

### 8. The negative test — for the classifier and the gate both

Every upload's record states that the classifier **ran** and what it found. **"Found nothing" must be
distinguishable from "never ran"** — the `career-ops` failure ADR-0004 clause 1 already carries,
observed three times in one month: a silent loop looks exactly like a clean corpus. The same holds
for the sanity gate.

### 9. Three interface requirements are named and handed to the design effort

The *"we couldn't place this section"* wording · the one-tap put-back control · the
tidied-versus-original view for beyond-cosmetic corrections. They join [#157](https://github.com/adrien-mounier/jobcrush-app/issues/157)'s
collection — this map fixes promises, not screens.

## Consequences

- **This is a holding state, not an element.** Nothing here walks ADR-0001 rule 4's gates, and this
  must not be counted as a stress-test attempt (ADR-0006 clause 10 retired the paper test; ADR-0007
  and ADR-0009 made the same disclaimer). Verdict 4 is the only door into the growth rule.
- **`conservationIssues()` is declared to, never surprised.** An additional line born from homeless
  content, a gate withholding, and a never-print-by-default verdict are all **declared** to the lint,
  exactly as ADR-0007 requires for withheld facts — otherwise a deliberate removal is byte-identical
  to the loss the lint exists to catch.
- **The plumbing half-exists and the build must finish it.** `parser_flags` is real and contractual,
  reaches `buildImportProof()` in `pipeline.ts` — **and is then discarded**; the proof keeps the
  outcome, not the flags. The build must persist per-kind records and their counts. Ticket #149's
  body carries the verified detail.
- **Miner rule 8 is not extended.** Its `uncovered-section` flag covers a section that yields
  nothing; this mechanism triggers on *no decided home*, a different condition. Both stand.
- **The corpus baseline is recorded:** 2 of 6 CVs, four kinds — interests, travel, driving licence +
  vehicle, availability. The first real-traffic numbers should be read against it.

## Alternatives rejected

| Rejected | Why it was attractive | What it cost |
|---|---|---|
| **Per-case alerts** (the owner's original phrasing, read literally) | Maximum visibility; simplest to state. | At the measured 1-in-3 rate the channel is mostly repeats within a week; the genuine novelty drowns. The kind, not the case, is the decision unit. |
| **Withheld-by-default until reviewed** (the session's recommendation) | Nothing unscreened reaches a rendered CV; reuses ADR-0007's machinery wholesale. | Overruled by the owner: the CV is the person's marketing document and their content ships by default. The screening argument survives only as the narrow leak clause 6 closes for less. |
| **Print verbatim, untouched** | Zero machine touch, zero drift risk. | Pierre's `Brasil` and Thomas's French sidebar print as-is on an English CV we produced. The typos become ours. |
| **Rephrase / strengthen** | Reads better; it is what a human editor would do. | The machine writes a claim the person never made, about content it understands least. Decision 9's silent add. |
| **A silent LLM filter** | Cheapest way to keep nonsense off the page. | The machine removing without telling is ADR-0007's named bug, and a wrong silent call is an invisible lost fact instead of a visible tap. |
| **No retroactivity** | Cheaper build; verdicts only shape the future. | Two people with identical CVs treated differently by upload date. Clause 1 makes retro cheap: the source never left. |

## Verification

**Falsifiable checks — four, each mechanical:**

1. Every upload's import record **states the classifier ran and what it found**; a zero-found result
   is a positive record, and an absent record means *did not run*. Same for the sanity gate.
2. Every homeless block's record **points at its source words**; one pointing at nothing is a defect
   (ADR-0004 clause 1a).
3. An `additional` line born from homeless content passes the verbatim test — the person's words,
   faithfully corrected, **never strengthened or summarised** — and any beyond-cosmetic change has
   the original attached.
4. Every gate removal has a corresponding **declared, restorable** entry on the review screen. A
   removal with no declaration is the bug, wherever it appears.
