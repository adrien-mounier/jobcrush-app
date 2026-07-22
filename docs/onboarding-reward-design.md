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

No grey teaser cards, no locked scores. **~5 questions uninterrupted → three real, fully visible,
scored cards.** No mid-flow soft capture in v1.

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

## 6. Flat pace

**5 questions → 3 cards. Every time. No curve, no cap.** No escalating cost per drop, no diminishing
returns, no ceiling where the game ends.

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

### 8.3 Screen budget: what is visible and what is a badge

Four things want the screen — the question, the CV, the profile, the cards — and a phone has room for
about two. So one of them is hidden behind a signal.

The game answer is **loot and inventory**: you kill something, the item *flies* into your bag, the bag
count ticks up. The item is never shown in full; you open the bag when you are curious. The flight is
the entire notification and it costs no layout.

On every answer:

- **The CV types its line, live, in place.** The star of the screen.
- **The card's % climbs, and the card's contents update**, right beside it (§9).
- **A chip flies into the profile icon**, which grows — a number, a visual, or both. That is the whole
  profile notification.
- **Tap the icon** and the full profile opens as its own screen.

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

During the first questions no cards exist, so there is nothing to aim at: the CV is the **generic root
CV** (S2 already builds one). **When the first cards land, the CV re-aims** at the card on top — and
swaps when the user swipes.

Why it must follow the card rather than stay generic: the user answers, watches a line appear in the
CV **for this job**, and sees **this job's %** jump right next to it. Cause and effect, one motion,
one screen. A generic CV puts the line over here and the number over there, connected by nothing.

The re-aim moment is itself worth designing — *the CV visibly turns to face the job.*

Cost accepted: every visible card needs its CV kept fresh, and the swipe needs a CV swap animation.

## 9. Cards on screen are alive

Visible cards **re-score on every answer**. The user watches 34% → 41% → 51% tick up while they
answer. Watching a number you care about move because of something you just said is the strongest
feedback in the design — arguably stronger than the typed CV line.

Doing that through a model on every answer would be 3 calls per question: slow and expensive. It does
not have to be:

- **The tick is a lookup, not a judgement.** When the user confirms "yes, €2M budget", we already know
  which requirements on which visible cards that satisfies — E5 produces a **ranked requirement list
  per ad**, so the match moves deterministically, instantly, for free.
- **The honest model re-score runs in the background**, landing at the next drop.

**Constraint: a visible number must never go down.** The cheap tick and the real re-score can
disagree, so the cheap tick is always **conservative — it under-promises**.

## 10. The front door

**Two entry points, rendered as one door.** The user is never asked to choose a path.

- **Primary:** a big central invitation to *be interviewed* — the "ready?" framing, worded so a
  stranger *wants* to participate. (Exact copy TBD, and it matters.)
- **Secondary, small, same screen:** *upload your CV to skip ahead.*

Rejected: **CV first** (a file picker is the most expensive first step that exists, especially on a
phone, and the no-CV user hits a wall at pixel one) and **two visible doors** (that is two flows
wearing a costume, and it makes a stranger decide something before we have given them anything).

Honest cost of leading with questions: 5 typed answers give a thinner profile than a parsed CV, so the
first three scores are cruder. See the pending experiment below.

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

**After the reveal, on the actions.** Five questions uninterrupted → three scored cards fully visible
→ an account is required to **save, apply, see the rest, or get alerts**.

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
- **The stopping rule is decided** (open question A): there is none. §5.
- **S3/E5 gains a requirement:** re-scoring existing cards when the profile changes, plus the ranked
  requirement list per ad doing double duty as the cheap live tick. §9.
- **The claim graph gets a face.** S2 built it as backend truth; §8.1 makes it a screen the user opens,
  which means it needs a readable, human rendering it has never had.

## Pending — before any product code

**Score 20 real job ads against 3 real CVs, print the 9 cards, look at them.** Half a day, no product
code. This is the evidence behind §3's reversal condition: if the cards are not obviously better than
a LinkedIn search in ten seconds, the wall moves before the reveal.

## Open

- **Copy for the front door.** The "ready?" invitation and the CV skip-ahead line. Wording is
  load-bearing here — it is the whole conversion of a stranger into a participant.
- **What the ~5 questions actually are**, and how they are chosen per user.
- **The onboarding screen itself** — the typing CV, the live card, the flying chip, the profile icon
  and where it sits, the re-aim moment. All the animation and layout work §8.2-8.4 calls for. A
  `/prototype` or `/impeccable` job, not a grill.
- **How the profile screen renders** — the claim graph has never been shown to a user. §8.1.
