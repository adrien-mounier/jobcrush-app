# Onboarding reward structure — design decisions

_Grilling session 2026-07-22 → 2026-07-23. Locked decisions only; open questions at the end._

This is **open question A** from [`docs/cv-quality-kickoff.md`](cv-quality-kickoff.md) — the grill's
stopping rule and onboarding UX — answered. It is a **design, not built code**; nothing here has
shipped.

The question it set out to answer:

> What actually pulls a user through the onboarding questions?

Today the reward is early and free: upload a CV → watch the preview appear. That moment is what makes
a stranger keep going, and everything hard (signup, deck, grill) comes after it. Three things put
pressure on it: the **no-CV user is now fully in scope** and has nothing to render; **input order**
(CV first vs job first) was open; and the journey now runs to **"first card seen"**, so two rewards
compete — the preview (a CV) and the cards (jobs).

---

## The shape — read this first _(amended 2026-07-23)_

Prototyping the onboarding screen ([wayfinder ticket #8](https://github.com/adrien-mounier/jobcrush-app/issues/8))
showed there is no single onboarding screen. The journey is **three screens with three different
jobs**, and that changed several decisions below. Where a section is amended, it says so.

| | Screen | On it | Not on it |
|---|---|---|---|
| **0** | **The front door** | The invitation, writing itself, then **Ready?**, then the CV shortcut | No questions — the first one is on the other side (§10.1) |
| **1** | **Discovery** | The CV, writing itself, and the questions | **No cards — none exist yet** |
| **2** | **The deck** | Swipeable job cards: the job, the score, where you fit and where you don't | No questions |
| **3** | **Tailor** | Job + score on top, the CV below, questions aimed at *this* job | No countdown |

Discovery runs until the **root CV** is good enough — it covers what the job family expects
(`docs/cv-brain/tailoring-reasoning.md` §4 is the hand-written PM version of that floor). Then:
*"3 jobs just matched you."* Swipe right on one and you land on Tailor.

**Layout: split bands** — a fixed top band, the CV in the middle, questions docked at the bottom. Two
rejected alternatives: the CV as a full-screen stage with a question sheet, and a sealed-deck stage
showing face-down cards during discovery.

**Visual direction: ink and glass.** The shipped `packages/ui` tokens were rejected as not good
enough — this starts from scratch. Deep charcoal chrome that recedes, the CV as **warm lit paper, the
only bright object on screen**, because it is the thing being made. Marigold for anything earned, since
the metaphor is already loot. Serif for the document — a serif typing itself reads as *written*, not
*saved* — platform sans for the HUD, mono for counts.

**The loop that emerged from building it, not from planning:** the card's **weak fits become the
tailor screen's questions**. Answer one and a grey `?` on the card in front of you flips to a gold `✓`.
You repair the card you are looking at. It turns "where you don't fit" from a verdict into a to-do
list.

## 1. One flow

Everyone walks the same road. **A CV is a shortcut that auto-answers questions, not a separate path.**

Two flows would be two products to design, build, and keep good — and the second always rots because
it gets less traffic. And "I have a CV" is not a clean split anyway: half the people who have one have
a bad, three-year-old one and need the same asking as someone with nothing.

## 2. Cards are the payoff, the CV is the by-product

A **card** = one job, Tinder-style. It carries a **match %**, and behind it sits a CV already tailored
to that ad.

Nobody wakes up wanting a CV. A CV is a tool; people want a job. This fixes the meaning of every
question in the middle: *"do you know C?"* reads as **unlocking jobs**, never as *polishing a
document*. And it is true — the answers really do widen the search.

## 3. Earn the cards, then reveal them fully

No grey teaser cards, no locked scores. **Questions uninterrupted → real, fully visible, scored
cards.** No mid-flow soft capture in v1.

> **Amended 2026-07-23.** This said "~5 questions". Discovery now runs until the root CV is good
> enough — see *The shape*. The principle is untouched: work first, then cards that are fully visible
> and already scored.

The alternative considered and rejected: show real-but-unscored cards immediately ("here are 12 jobs,
answer 3 questions to see if you'd get them"). It gives the reward before the work, but the cards are
what any job board shows — the risk is a stranger thinking *this is just Indeed* and leaving. The
score is the thing Indeed cannot do, so the score is what we lead with.

**Reversal condition:** if v1 cards are not obviously better than a LinkedIn search within ten
seconds, the wall moves *before* the reveal. **A promise beats disappointing proof.**

## 4. Three feedback speeds

The design brief, stated plainly: build the Tinder loop — *tiny action → instant visible response →
tiny action*. The user should want to answer one more question because something visibly takes form at
each one.

Games solved this with three speeds at once, not one — XP → level → loot. One meter alone goes stale
in about six questions.

| Speed | What the user sees | When |
|---|---|---|
| **Instant** | A line **writes itself letter by letter** into the CV, and the card's % climbs | Every single answer |
| **Slow** | The countdown bar advances | Every answer, toward the next drop |
| **Rare** | Cards unlock — *"3 new jobs matched you"* | Every 5 answers |

Build order, cheapest first: **bar → CV typing → unlock.**

## 5. Endless, and always nearly there

The bar **never reaches a finish line and never says "complete"**. It only ever measures the distance
to the *next* drop.

Both failure modes are real. LinkedIn's profile-strength meter never lets you finish, so people stop
believing it. A bar that hits 100% says *done*, and the user stops answering permanently — but we
always want more, because more answers means better matches next month.

Games escape both: you never finish, yet you are always close to finishing, because the bar measures
only the next step and each step hands you something real.

**This is the stopping rule.** We never stop asking; the user stops whenever they want, and always
leaves holding what they earned. Nothing is ever "incomplete" — they are simply mid-countdown.

> **Amended 2026-07-23.** Discovery *does* complete — that is how you reach the deck. The rule
> survives because **completion is a door, not a finish line**: hitting it opens the Tinder phase,
> which is the actual product, so it never tells the user they are done. Past that door there is no
> countdown at all: the tailor screen's line is *"Tell me more and this CV gets stronger for this
> job"*, and the user stops whenever they want via the always-present *"I'm done — use this CV"*.

## 6. Pacing _(rewritten 2026-07-23)_

Originally: *5 questions → 3 cards, every time, no curve, no cap.* **Dead.** The three-screen split
replaced it, because a fixed pace cannot serve two phases with different jobs.

- **Discovery** is as long as the root CV needs. A user arriving with a good CV answers fewer
  questions; one arriving with nothing answers more. **Where you start does not matter** (§11) — the
  door is the same distance from wherever you are.
- **Progress is shown as the CV's own sections filling** — professional summary / professional
  experience / skills / education — not as a count of questions. The bars carry the section names, so
  filling a bar and filling a section are one event shown twice. You are completing a page.
- **The CV opens with that skeleton already visible and empty**, ruled. You see the shape of the thing
  you are filling before you fill it. (The canonical section list is the core CV structure — its own
  ticket; the four above are a stand-in.)
- **A promise carries the middle**, since no cards exist yet: *"142 project manager jobs are open in
  Paris right now."* Not proof, not a card — a reason to keep going, which is the same
  promise-beats-disappointing-proof rule as §3's reversal condition.
- **Tailoring** has no pace at all. It ends when the questions run out or when the user says stop.

> **Amended 2026-07-23** ([#6](https://github.com/adrien-mounier/jobcrush-app/issues/6)): the empty
> skeleton is **not ruled**. Dashed rules read as a form to fill in; blank space reads as a page not
> written yet. Section headings only, then space.

### 6.1 The first question _(decided 2026-07-23, [#6](https://github.com/adrien-mounier/jobcrush-app/issues/6))_

**One free text box. No preset job options.** Built and pressed twice; both rounds killed a list.

**Why no list.** A closed list of job titles is wrong for most visitors, because at this point we know
nothing about the field they are in. Worse, bolting a *"Something else"* escape onto it does not fix
it: building the escape showed it only ever opens **the same free box** the boxless shapes lead with —
reached two taps later, after the screen has told the user they are unusual. So there is no escape
hatch to design. **The box is the question.** A model places whatever is typed into a family.

**The ask is wide, not narrow.** The placeholder is the teaching device — *"e.g. IT project manager in
Paris, mostly ERP, I use Jira and MS Project"* — and every extra thing volunteered pays out its own
line in its own section. One answer became three facts across two sections in the prototype.

The decisive argument is not richness, it is §6's promise. It reads *"142 project manager jobs are open
**in Paris** right now"*, and **nothing anywhere else in this flow asks where the user is.** A
title-only question 1 leaves the promise with no city; the wide one gets it for free.

**Suggestions are the family, not near-spellings.** Type *nurse* and the whole nursing family appears
under a label saying **same kind of job**. The label is load-bearing: without it, offering *other*
titles reads as *"your words were not found"*. With it, the list is the net we cast — and it teaches
the family mechanic before the copy explains it. The family stays visible as the answer grows into a
sentence, so detail can be added without losing it. A title that matches nothing is accepted in
silence — no "not found", because the model places it.

Under the question, in words: *"I search the whole family, not just your words — say **project
manager** and I'll also read IT project manager, programme manager, delivery manager."*

**The promise fires immediately after question 1**, which is its earliest possible slot (§6) and now
also its actual one: question 1 supplies both the family and the city. It arrives a beat late, because
placing the family is a model call — that is fine, and §8.2 is not violated: the **typing** is instant
because it is composed from the user's own words and never waits on the model.

**No name on the CV.** We do not know it here, and asking a stranger for it is a signup-shaped question
that pays nothing back. §12 keeps account out of the flow until the wall, and Google OAuth hands the
name over for free at that point. So the role line — written by question 1 — is the first line on the
page.

*The classifier that maps a typed answer to a family is a clustering + classification model, and its
own effort. The prototype's hand list is a stand-in.* Prototype:
`apps/web/prototypes/first-question.prototype.html`.

## 7. One visible number

Four numbers existed across this design and `cv-quality-kickoff.md`. The user sees **one**.

| Number | About | Shown? |
|---|---|---|
| **Match %** on a card | the user vs *this job* | **Yes — the only number in the product** |
| Profile level / strength | how much we know about the user | **No — killed** |
| "Well made" | mechanical CV lint over `cv-brain` | No — workbench only |
| "Aimed at this job" | model-panel judgement | No — workbench only |

Why: **a number attached to a job and a number attached to a person are not the same object, even at
identical maths.** *"This job: 34%"* is useful — skip that one. *"Your profile: 34%"* tells a human
being, in their first minute, that they are poor. That is a closed tab, and it lands hardest on the
user we just brought into scope: the one who arrived with nothing.

So the bar carries **no digit** — no level count, no rank name. Its copy is a **countdown, not a
score**:

> **3 answers until your next jobs.**

## 8. The video-game feeling lives in the collection

Removing the level number does not remove the progression — it moves it onto things that only ever
grow.

- **The CV writes itself, letter by letter.** Every answer types a real line into a real CV, on
  screen, while the user watches: *"Managed a €2M budget across 4 teams."*
- **The profile fills up.** Everything the user has ever told us lands there and stays. It never
  resets, it only grows. After 30 questions they can scroll a page of themselves that did not exist an
  hour ago.
- **The cards are loot.** Jobs you unlock stay unlocked. *"You have 12 jobs"* only ever goes up — and
  that number is safe, because it counts things the user earned.
- **The percentages climb.** You saw a job at 34%. You answer four more questions. It says 51%. Real,
  visible progression that never grades the person, because the number stays attached to the job.

That last one is also the **month-two answer**: a returning user's visit is meaningful because their
old cards move. It requires **re-scoring existing cards when the profile changes** — genuine
engineering, and it belongs in **S3 with E5**.

### 8.1 The profile and the CV are two different objects

They were one thing ("the document") for most of this session. They are not, and conflating them
breaks the design.

| | **The profile** | **The CV** |
|---|---|---|
| What | everything the user ever told us | a condensed selection of it |
| Size | unbounded | bounded — 2 pages, and that is the point |
| Rule | **accumulates**, never drops a fact | **selects**, aimed at one job |
| Backend | the claim graph (S2, Postgres) | the rendered draft |

A toy box and a school bag. The box keeps every toy forever; the bag holds a few, chosen for today.

**Consequence to design for, not paper over:** a fact can land in the profile and *not* appear on the
CV, because the CV is bounded and had to choose. The user will notice, and if we say nothing the
typewriter looks broken. It needs an honest line — *"saved to your profile — it'll be used when a job
asks for it."*

### 8.2 The typewriter is a requirement, not a flourish

**The line must be seen writing itself, letter by letter.** It is the *instant* speed of §4 — the only
feedback that fires on every single answer — and the whole point is watching the CV take form under
your own words. A line that simply appears, already complete, is a different and much weaker product:
it reads as *data being saved*. The typing is what makes it read as *being written*.

Two constraints that follow:

- **The line must be available instantly.** The typing cannot wait on a model round-trip, or the
  animation starts two seconds late and the causal link to the answer is broken. Compose it cheaply
  and locally from the confirmed answer, let the polish pass rewrite it later — the same split §9 uses
  for the match tick: **fast where it is felt, accurate where it matters.**
- **A line, once written, is never silently rewritten on screen.** Same family of rule as the match %
  never going down.
- **The CV scrolls to the line, then types — in that order.** Smoothly, and it keeps following as the
  line wraps onto a second row. Typing that happens below the fold is worse than no animation: the
  user paid for a reward they never saw.

### 8.3 Screen budget: what is visible and what is a badge

Four things want the screen — the question, the CV, the profile, the cards — and a phone has room for
about two. So one of them is hidden behind a signal.

The game answer is **loot and inventory**: you kill something, the item *flies* into your bag, the bag
count ticks up. The item is never shown in full; you open the bag when you are curious. The flight is
the entire notification and it costs no layout.

On every answer:

- **The CV types its line, live, in place.** The star of the screen.
- **The card's % climbs, and the card's contents update**, right beside it (§9) — on the tailor screen,
  where a card exists.
- **A chip flies into the profile badge**, which grows. That is the whole profile notification.
- **Tap the badge** and the full profile opens as its own screen.

**The badge is a pile that only ever gets taller, with the count beside it** — decided 2026-07-23
([ticket #9](https://github.com/adrien-mounier/jobcrush-app/issues/9)). A bare number in a circle is
meaningless: 24 what, out of what? So the count carries a unit — the word *facts* sits next to it for
the first few answers, then collapses away, teaching once and then getting out of the way.

Two shapes are banned. **Anything that fills** — a jar, a battery, a silhouette becoming solid — has a
full state, so a half-full one reads as *you are 40% of a person*: §7's grade-on-a-person coming back
through the side door. And **anything document-shaped**, because a page icon would compete with the CV
already on screen. A pile has no capacity and looks like nothing else here, so it can only grow.

Why this way round: the CV is what the user *cares* about seeing, because it is what an employer
receives. A profile is a store, and stores are satisfying to **open**, not to watch. And the count
climbing is a safe number under §7 — it counts things earned.

**Naming: "your profile".** Deliberately boring, because a stranger must understand it with zero
thinking — a name is a door handle, it should not be clever. Be interesting *inside* it instead:
*"47 things you've told me."*

**This screen gets maximum design effort.** The profile must not read as a list of text being
scrolled — the target feeling is *my character is evolving*, and that lives in original animation and
layout work, not in the data.

### 8.4 The CV on screen follows the card

Through discovery no cards exist, so there is nothing to aim at: the CV is the **root CV** (S2 already
builds one). **On swipe-right the CV re-aims** at that job.

Why it must follow the card rather than stay generic: the user answers, watches a line appear in the
CV **for this job**, and sees **this job's %** jump right next to it. Cause and effect, one motion,
one screen. A generic CV puts the line over here and the number over there, connected by nothing.

The re-aim moment is itself worth designing — *the CV visibly turns to face the job.*

Cost accepted: every job the user takes needs its own CV kept fresh.

> **Amended 2026-07-23.** Was "when the first cards land, the CV re-aims at the card on top, and swaps
> when the user swipes". The deck is now its own screen with no CV on it, so the re-aim happens once,
> on the swipe that takes you into tailoring.

### 8.5 Exits: two ways to stop, one place they land _(added 2026-07-23)_

Tailoring has no countdown, so it needs an ending. Both routes to it are the same ending:

- **The user stops.** A quiet *"I'm done — use this CV"* sits under the answers **from the very first
  question**. Always available, never shouting. §5's rule — the user stops whenever they want.
- **We stop.** When there is nothing left worth asking. The algorithm is its own ticket.

Both land on: **Apply with this CV** (primary) or **Save it and come back later** (secondary), with a
line saying what was achieved — *"you closed 2 of the 3 gaps this job asked about."*

A third, deliberately quiet exit: **Drop this job**, small and grey, never competing with Apply. It
must say what survives — *"everything you told me stays on your profile"* — because it does. You lose
the job, never the work.

*Where a saved application lives is out of scope here — it sits past this design's boundary.*

## 9. The card on screen is alive

The visible card **re-scores on every answer**. The user watches 34% → 41% → 51% tick up while they
answer. Watching a number you care about move because of something you just said is the strongest
feedback in the design — arguably stronger than the typed CV line.

Doing that through a model on every answer would be slow and expensive. It does not have to be:

- **The tick is a lookup, not a judgement.** When the user confirms "yes, €2M budget", we already know
  which requirements that satisfies — E5 produces a **ranked requirement list per ad**, so the match
  moves deterministically, instantly, for free.
- **The honest model re-score runs in the background.**

**Constraint: a visible number must never go down.** The cheap tick and the real re-score can
disagree, so the cheap tick is always **conservative — it under-promises**.

**The requirement list is also the question list.** The same ranked requirements that move the score
are what the card shows as *where you don't fit yet* — and those are exactly what the tailor screen
asks about. One artefact doing three jobs: it scores the match, it explains the gap, and it chooses the
next question.

> **Amended 2026-07-23.** Was "cards re-score" — three of them, at once, on a screen that also held
> the CV. The deck/tailor split means only one card is ever live, which is both cheaper and clearer.

## 10. The front door

**Two entry points, rendered as one door.** The user is never asked to choose a path.

- **Primary:** a big central invitation to *be interviewed* — worded so a stranger *wants* to
  participate.
- **Secondary, small, same screen:** *upload your CV to skip ahead.*

### 10.1 The door: an invitation, and the way through it _(decided 2026-07-23, [#7](https://github.com/adrien-mounier/jobcrush-app/issues/7))_

**The door is an invitation with a "Ready?" on it. It is not question 1.** The first question waits on
the other side, on the discovery screen.

> **This reverses the first resolution of the same ticket, taken earlier the same day.** That one made
> the door *be* question 1, on the reasoning that a Start button is a tap returning nothing — the
> inverse of §4's *tiny action → instant visible response*. Building five shapes and pressing them
> showed the reasoning was too narrow: **the tap is only dead if it gives nothing back.** Here it buys
> a designed moment, and a screen the invitation does not have to share.

The decided screen, everything centred:

> ## Answer questions. **Collect jobs.**
>
> ### ( Ready? )
>
> <sub>Already have a CV? **Upload it** and skip the questions it already answers.</sub>

**It arrives in three beats, in this order:** the invitation writes itself letter by letter → **Ready?**
fades up → the CV shortcut appears, last, at the bottom edge. The order is the argument: the main path
is fully offered before the side door is mentioned at all.

**Pressing Ready parts the invitation like a door** — "Answer questions." lifts away, "Collect jobs."
drops away — and discovery arrives through the gap.

#### Why a Ready screen beat the fused door

- **The invitation gets the whole screen.** Nothing competes with it, which is what a first screen is for.
- **"Ready?" asks for consent, and consent is not the same as an answer.** Agreeing to be interviewed
  is a small promise, and people keep small promises. Tapping an answer commits you to nothing.
- **The tap is not dead.** It buys the transition, which is a real thing to buy.

#### The typing is a requirement, not an effect

The line must be seen **writing itself**, for the same reason the CV must (§8.2). The door is the first
time anyone sees this product move, and it moves the way the whole product moves. **It teaches the
mechanic before explaining it** — so when the CV later writes itself under the user's own answers, they
already know that language.

#### Three things building it proved, which no amount of arguing would have

- **Centred text that types itself jitters.** Every new letter re-centres the line, so it wobbles
  left-right the whole way. Each line carries a **hidden copy of its finished text** to hold the width
  open, and the letters fill that fixed box. Measured drift after the fix: 0.00px.
- **The animation must be skippable.** It is ~1.5s before the button exists, which is a long time to
  sit still on a first screen. A tap anywhere finishes it instantly, and `prefers-reduced-motion` skips
  it outright. Nobody impatient is made to wait for the button to exist.
- **The CV shortcut goes at the bottom edge, never under the button.** Directly beneath "Ready?" it
  reads as the second of two choices — the fork §10 exists to forbid. At the bottom it is plainly a
  footnote.

#### The words, and what they may never say

Four wordings were written and read on the real screen. **"Answer questions. Collect jobs."** won, and
survived the change of shape unchanged. It is the only candidate whose headline **never mentions a
CV** — questions in, jobs out — so the user §1 brought into scope, the one arriving with nothing, is
never told they are missing something. It also names the loop the whole design is built on (§8: *the
cards are loot*) in four words. Rejected: *"Which jobs would you actually get?"* (sharpest statement of
the differentiator, but *"actually get"* can be heard as *"probably none"* — §7's grade-on-a-person
through the side door), *"Let me ask you about your work"* (true to the interview framing, but names no
payoff), *"You don't need a CV to start"* (best line for the no-CV user, but leads with the CV, which
§2 says nobody wants).

**Three things the door may never say**, each a consequence of a decision made elsewhere:

- **No count and no duration.** §6 made discovery variable-length, so *"5 questions"* and *"takes two
  minutes"* are promises we would be caught breaking.
- **Nothing about account, price or signup.** §12 walls after the reveal — saying *"free"* invites
  *why?*, and *"no signup"* plants the word.
- **The skip-ahead says what it actually does** — it skips *the questions the CV answers*, not the
  process. §11: a CV buys one jump, it does not end the game. *"Skip ahead"* alone would promise being
  done.

The screen is deliberately empty above the invitation. We know nothing about this person yet, so
anything there would be generic marketing; §6's promise (*"142 project manager jobs are open in Paris
right now"*) cannot fire until question 1 tells us the family, which now happens one screen later.

#### Rejected shapes

All four alternatives were built and pressed, not argued about — `apps/web/prototypes/front-door-options.prototype.html`
holds them.

| Shape | Why not |
|---|---|
| **The door is question 1** | The original resolution. Fewest taps, and the first tap really does buy the paper — but the invitation has to share its screen with a question, and nothing is ever consented to. |
| **A button where the thumb is** | A large pulsing target mid-screen that grows into the panel the question arrives in. Genuinely good; lost because the headline sits up top and reads as chrome rather than as the invitation. |
| **The door writes itself, then rewrites into the question** | Same typing idea carried through the threshold. Lost on time — the rewrite adds a second wait right after the first. |
| **The paper is placed in front of you** | A blank sheet slides up and settles, then the question docks under it. Beautiful, but it spends the CV's arrival before the user has done anything to earn it. |

## 11. A CV buys one jump, then the game continues

Upload → a visible level-up moment (*"CV read."*) → questions resume.

The alternatives both fail. **Skipping to near-complete** ends the game before it starts, and it
treats a CV as a full profile — exactly what `cv-quality-kickoff.md` forbids, since users arrive
under-reported and out of date. **Silently pre-filling with no payout** makes the user feel we ignored
their file.

What makes the jump land: **the first question after upload must be one only a reader could ask** —
*"your CV mentions a migration project in 2024, what was your actual role on it?"* That single
question proves we read the file better than any progress bar could.

A good CV means fewer questions to a good match; a poor CV means more. **Where you start does not
matter.** The more you answer, the better the profile, the better the tailoring, the better the real
chance of matching — that is the product thesis, and the reason the ladder has no top.

## 12. The wall

**After the reveal, on the actions.** Questions uninterrupted → scored cards fully visible → an
account is required to **save, apply, see the rest, or get alerts**.

> **Open again after 2026-07-23.** This was written when the reveal was three cards after five
> questions. With discovery variable-length and the deck its own screen, the exact moment needs
> re-picking — most likely entering the deck, or the first Apply/Save. The *principle* is untouched:
> reward first, wall on the actions.

- **Google OAuth leads.** The magic link stays as a quiet secondary link, deliberately less visible so
  people choose Google — firing an email at peak curiosity is the known-fragile path.
- **Answers persist server-side from question 1.** Not localStorage: server-side is the only version
  that tells us *where people quit*.
- **Anonymous scoring rides the existing rate limiter.**

This keeps the shape S2 proved — give the magic free, charge for keeping it — and puts the ask at the
moment the user has just seen something worth keeping, which is the cheapest moment to ask for
anything.

---

## What this changes

- **Input order is decided** (it was an open ticket): **job intent first**, CV as an accelerator on the
  same screen. §10.
- **The preview is no longer the hook.** The magic-mirror moment does not disappear — it becomes the
  live-typing CV of §8.2, arriving line by line instead of all at once.
- **The stopping rule is decided** (open question A): there is none *for the product*. Discovery has a
  door (the root CV is covered); past it the user stops whenever they want. §5, §6, §8.5.
- **S3/E5 gains requirements:** re-scoring existing cards when the profile changes, and the ranked
  requirement list per ad doing triple duty — it scores the match, it renders as the card's *where you
  don't fit yet*, and it chooses the tailor screen's next question. §9.
- **The claim graph gets a face.** S2 built it as backend truth; §8.1 makes it a screen the user opens,
  which means it needs a readable, human rendering it has never had.
- **The root CV becomes a user-facing milestone.** S2 built it as a pipeline artefact; §6 makes
  "the root CV is good enough" the gate that opens the deck, so the family floor in
  `docs/cv-brain/tailoring-reasoning.md` §4 has to be a list that actually terminates.
- **The existing design system is out.** `packages/ui/src/tokens.css` is not a constraint on this
  work — see *The shape*.

## Pending — before any product code

**Score 20 real job ads against 3 real CVs, print the 9 cards, look at them.** Half a day, no product
code. This is the evidence behind §3's reversal condition: if the cards are not obviously better than
a LinkedIn search in ten seconds, the wall moves before the reveal.

## Open

Tracked as tickets on the wayfinder map
[Onboarding journey: landing to first card](https://github.com/adrien-mounier/jobcrush-app/issues/5).

- ~~**The onboarding screen itself**~~ — **done 2026-07-23**, see *The shape*
  ([#8](https://github.com/adrien-mounier/jobcrush-app/issues/8)). Prototype:
  `apps/web/prototypes/onboarding-screen.prototype.html`.
- ~~**The front door — its words and its shape.**~~ — **done 2026-07-23**, see §10.1
  ([#7](https://github.com/adrien-mounier/jobcrush-app/issues/7)). *"Answer questions. Collect jobs."*,
  centred, writing itself, with **Ready?** arriving after it and the CV shortcut last.
- **What the discovery questions are, how they're chosen, and when we stop.** One mechanism: pick the
  next question from the gap between the family floor and what we know; stop when the gap closes.
  ([#6](https://github.com/adrien-mounier/jobcrush-app/issues/6))
- **The profile — badge and screen.** The badge is decided (§8.3); the screen has never been shown to
  a user at all. ([#9](https://github.com/adrien-mounier/jobcrush-app/issues/9))
- **The job card's contents** — what it shows and why it beats a job board.
  ([#10](https://github.com/adrien-mounier/jobcrush-app/issues/10))
- **Where the wall sits now.** §12 needs re-picking against the three-screen shape.
- **The core CV structure** — the canonical section list discovery renders empty. Belongs to the CV
  brain / S2.75, not this design, but discovery cannot be built without it.
- **Where a saved application lives.** Ruled out of scope for this design; §8.5's exits assume it.
