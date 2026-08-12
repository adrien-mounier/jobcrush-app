# Council Transcript

**Session:** 2026-07-22 22:58:40  
**Question:** Run a five-role adversarial council on the JobCrush UX/UI decision in the handoff below.

The council must answer the open question exactly, under the eight locked constraints in the handoff. Do not re-open the eight locked reward-structure decisions unless you find a real contradiction that invalidates one.

The parent recommendation to stress-test is candidate A: two visible numbers only: a Level/progress gauge about how much JobCrush knows about the user, and a Match % per job card. The CV quality scores (Well made and Aimed at this job) stay internal workbench-only.

Required verdict shape:
1. A number: how many numbers the user sees, and which.
2. Naming and framing for each visible number, especially whether a "how much we know about you" gauge survives real-user interpretation without becoming a grade.
3. The honesty question: does hiding CV quality from the user protect them or cheat them? If it cheats them, what shape tells the truth without demotivation?
4. Failure modes, especially month-two returning-user problems.
5. Any contradiction in the eight locked decisions, if one is real.

Use the repository context from C:\Users\adrie\AI\Projects\jobcrush-app. I have already read the named repo references (`docs/cv-quality-kickoff.md`, `roadmap.md`, `session-log.md`, `CLAUDE.md`) and the parent reward-structure handoff; the full current handoff is the authoritative brief.

=== CURRENT HANDOFF ===
# Handoff — council verdict wanted: how many numbers does the JobCrush user see, and what are they?

**Repo:** `C:\Users\adrie\AI\Projects\jobcrush-app` (branch `main`, at `f13c1f5`)
**Date:** 2026-07-22
**Parent session:** the reward-structure grill (`/grill-me`), handoff at
`C:\Users\adrie\AppData\Local\Temp\jobcrush-reward-structure-handoff.md`
**Your job this session:** take the single open question below to a **council**
(`/multi-llm-adversarial-validation`), get a reasoned verdict, and hand the verdict back. Do **not**
re-open the eight locked decisions — they are the constraints the answer must fit inside.

---

## Product in 60 seconds

JobCrush turns anyone into a candidate: the user gives us facts about themselves, we score real job
ads against them, and behind each job sits a CV already tailored to that ad. Live today on staging:
landing → upload CV → progress → watermarked preview → signup wall → confirm deck → grill → verified
root CV. Fastify API + Next.js web (`apps/web/app/`). The CV-reasoning source of truth is
`docs/cv-brain/`.

The parent session redesigned **onboarding's reward structure** — what actually pulls a stranger
through the questions. Eight decisions got locked. The ninth is open and is where you come in.

## The eight locked decisions (constraints — do not re-open)

1. **One flow.** Everyone walks the same road. A CV is a *shortcut that auto-answers questions*, not
   a separate path for a separate user type.
2. **Cards are the payoff, the CV is the by-product.** A "card" = one job (Tinder-style), carrying a
   **match %** and a tailored CV behind it. Nobody wants a CV; they want a job. Every question must
   read as *unlocking jobs*, not *polishing a document*.
3. **Earn the cards.** No grey/locked teaser cards. ~5 questions first, then three real, fully
   visible, **scored** cards.
4. **Three feedback speeds, always moving** (the anti-boredom engine, explicitly modelled on the
   Tinder/video-game loop the user asked for):
   - *instant* — a line writes itself into the profile document, every single answer;
   - *slow* — a level bar fills, every few answers;
   - *rare* — cards unlock at milestones.
   Build order: bar → document → unlock.
5. **Endless levels, never a finite "100% complete" bar.** The bar only ever measures distance to the
   **next** unlock ("Level 2 · 4 answers to unlock your next 5 jobs"). This *is* the grill's stopping
   rule: we never stop asking, the user stops whenever they like, and always leaves holding something.
6. **The wall sits after the reveal, on the actions.** Five questions uninterrupted → three scored
   cards fully visible → account required to *save / apply / see the rest / get alerts*. **Google
   OAuth leads**, magic link is a quiet secondary (firing an email at peak curiosity is the
   known-fragile path). Answers persist **server-side from question 1** (it is the only version that
   tells us where people quit). No mid-flow soft capture in v1. Anonymous scoring rides the existing
   rate limiter. **Reversal condition:** if v1 cards are not obviously better than a LinkedIn search
   within ten seconds, the wall moves *before* the reveal — a promise beats disappointing proof.
7. **Front door = two entry points rendered as one door.** A big central invitation to *be
   interviewed* ("ready?"), plus a small secondary CTA — *upload your CV to skip ahead*. The user is
   never asked to choose a path.
8. **A CV buys one big jump, then the game continues.** Upload → visible level-up ("CV read. +3
   levels") → questions resume, and the first question after upload must visibly be one only a reader
   could ask, to prove we read the file. A good CV means *fewer* questions to a good score; a poor CV
   means more. Starting point does not matter — **the more you answer, the better the profile, the
   better the tailoring, the better the real chances**. That is the product thesis.

## The open question

> **How many numbers does the user see, and what does each one mean?**

Four numbers currently exist in the design, from two different sessions:

| # | Number | About | Where it came from |
|---|---|---|---|
| 1 | **Level / progress bar** | how much *we know about the user* | locked decision 4/5 |
| 2 | **Match %** on each card | the user vs *this specific job* | locked decision 2 |
| 3 | **"Well made"** | is the CV mechanically good (bullet caps, banned words, glyphs, AI tells) — mechanical lint over `docs/cv-brain/` | `docs/cv-quality-kickoff.md` §5 |
| 4 | **"Aimed at this job"** | did we surface and target the right things — model-panel judged | `docs/cv-quality-kickoff.md` §5 |

`docs/cv-quality-kickoff.md` already locks that **3 and 4 never merge into one total** (a
beautifully-written CV pointed at the wrong job must not hide behind a mediocre middle number), and
frames them as a **workbench** tool — run over ~5 fixed test cases after a prompt change, to prove a
change helped rather than feeling that it did. It does *not* say whether the user ever sees them.

### The sharp edge

A number attached to a **job** and a number attached to a **person** are not the same object, even
when the maths is identical.

- *"This job: 34%"* — fine, even useful. Skip that one.
- *"Your profile: 34% — poor"* — that tells a human being, in their first minute, that they are poor.
  That is a closed tab. And it lands hardest on exactly the user we just brought into scope: the one
  arriving with nothing.

So the proposal on the table is that the level bar must never be a **grade**, only a **fuel gauge** —
not *how good you are*, but *how much I know about you*, where low means early, not bad.

### The candidate answers

- **(A) Two visible numbers** — the **level** (about us knowing you, never a %, never a grade, never
  the word "poor") and the **match %** (about a job, blunt is fine). Numbers 3 and 4 stay internal
  workbench-only. *This is the parent session's recommendation.*
- **(B) Three visible** — add a CV-quality number so the user can see their document improving. More
  honest and more motivating for some, but re-centres the CV as the product, which fights locked
  decision 2, and risks the "you are poor" failure.
- **(C) One visible** — match % only. The level bar exists as a *bar with a target* but carries no
  number at all. Least clutter, most game-like; may be too thin to sustain the level fantasy.
- **(D) Something else** — e.g. the level is not a number but a named rank; or quality is shown only
  as movement ("+2 since your last answer"), never as an absolute.

### What the parent session wants tested

The recommendation (A) has one consequence worth stress-testing, because it may be a mistake dressed
as kindness: **the user with a bad CV must never see a lower number than the user with a good one.**
Both start at Level 1; the good-CV user simply climbs faster because the upload jumps them (locked
decision 8). Is that honest, or is it a comforting lie that costs the user real information they need
— namely, that their CV is currently weak and that is *why* they are not matching?

## What a good verdict looks like

Not a vote. The parent session needs:

1. **A number.** How many numbers the user sees, and which.
2. **Naming and framing** for each — specifically, whether a "how much we know about you" gauge can
   survive contact with real users without being read as a grade.
3. **The honesty question answered:** does hiding CV quality from the user protect them or cheat
   them? If it cheats them, what is the shape that tells the truth without the demotivation?
4. **Failure modes** the parent session has not seen — especially anything that breaks in month two,
   when the user returns and the numbers have to still mean something.
5. Anything in the eight locked decisions that this question **invalidates**. Locked ≠ correct; if the
   council finds a real contradiction, name it explicitly rather than working around it.

## Repo references (do not re-summarise, read them)

- `docs/cv-quality-kickoff.md` — the 11 CV-quality decisions from earlier the same day; §5 (two scores
  that never mix), §6 (who grades what — anything countable gets counted, never judged), §7 (the
  workbench) are the directly relevant ones.
- `roadmap.md` — **S2.75 (CV quality, the ruler)**, and the open items **A** (the grill's stopping
  rule + onboarding UX) and **B** (feeding `cv-authoring-rules.md`).
- `session-log.md` — session 12 (2026-07-22).
- `CLAUDE.md` — repo conventions, git workflow (stay on `main`, push only when
  `pnpm test && pnpm typecheck` are green; a push auto-deploys staging), and the session-hygiene rule
  that governs how this session's output must be written back.
- `C:\Users\adrie\AppData\Local\Temp\jobcrush-reward-structure-handoff.md` — the parent handoff that
  started the grill.

## Working notes for whoever runs this

- **Adrien is not a native English speaker and will ask you to "explain like I'm 5."** Pre-empt it:
  short plain sentences, one idea each, a concrete example before the abstraction, and bold the fork.
  Dense analytical prose costs a round-trip.
- There is an unrelated cheap experiment already agreed and still pending, worth keeping visible:
  **score 20 real job ads against 3 real CVs, print the 9 cards, and look at them.** Half a day, no
  product code. It is the evidence behind locked decision 6's reversal condition.
- When the verdict lands, it gets written back to the repo the same way the rest of the day's work
  did — a `docs/` design doc plus `roadmap.md` and `session-log.md` updates, committed and pushed only
  when both gates are green.

## Suggested skills

- **`/multi-llm-adversarial-validation`** — the point of this session. Feed it the question, the eight
  constraints, and the four candidate answers.
- **`/grill-me`** — to resume the one-question-at-a-time grill with Adrien once the verdict is in;
  the parent session was paused mid-question.
- **`/prototype`** — if "what does the level actually look like on screen" becomes the crux, a
  throwaway artifact to react to beats more abstract argument.
- **`/domain-modeling`** — if the verdict coins vocabulary (level, fuel gauge, match score) that
  should land in `CONTEXT.md` or an ADR.
- **`/close-session`** — at the end, to sync the context files and the three memory docs.


=== PARENT HANDOFF FOR BACKGROUND ONLY ===
# Handoff — grill the reward structure of JobCrush onboarding

**Repo:** `C:\Users\adrie\AI\Projects\jobcrush-app` (branch `main`, at `f13c1f5`)
**Date handed off:** 2026-07-22
**Your job this session:** grill Adrien to a decision on **where the reward sits in onboarding, and
what it is**. One question at a time. Do not chart a wayfinder map — that is happening in the parent
session.

---

## The question

> What actually pulls a user through the onboarding questions?

Four candidate answers surfaced in the parent session, unresolved:

- **(a) The preview stays the hook.** Show something CV-shaped as early as possible, even a thin one
  built from a handful of answers. Keeps today's proven "magic mirror" moment.
- **(b) The cards become the hook.** *"Answer these to see jobs you can actually get."* Job cards
  motivate more than a CV — nobody wants a CV, they want a job. But cards need enough profile to
  exist, so the reward lands much later.
- **(c) Rewards drip.** Something back every few questions — a card, a line of CV, a score rising.
  Motivation topped up continuously rather than one big payoff.
- **(d) Something else / a mix** — the parent session suspected this is genuinely open.

Adrien asked for this to be its own session because it is load-bearing: several other onboarding
decisions hang off it.

## Why it is hard right now

Today the reward is early and free: upload a CV → watch the preview appear. That moment is what makes
a stranger keep going, and everything hard (signup, deck, grill) comes after it. Three decisions made
earlier today put pressure on it:

1. **The no-CV user has no preview.** Nothing to render. They face questions with zero reward. This
   user is now **fully in scope** (decided this session) — Path B was previously a coming-soon door
   deferred to S4.
2. **Input order is open.** "CV first vs job first" is undecided — so the preview may not be able to
   come first. Job-first gives far better questions ("this job needs C, do you have any?") but the
   first step becomes work instead of magic.
3. **The journey now runs to "first card seen"**, so there are *two* possible rewards — the preview
   (a CV) and the cards (jobs) — and they compete.

## Context you need — read these first

- **`docs/cv-quality-kickoff.md`** — 11 decisions locked earlier today. Most relevant: quality = fit
  to the job; the enricher asks "do you have any C, even a school project?"; suggested details are
  switch-off chips; users are lazy and under-report so we must never infer a thin profile from a thin
  answer.
- **`roadmap.md`** — see **S2.75 (CV quality)** and the promoted backlog item *"Grill A: the grill's
  stopping rule + onboarding UX (Tinder/Bumble as prior art)"*.
- **`session-log.md`** — session 12 entry (2026-07-22) is today's session.
- **Today's shipped flow:** landing → upload CV → progress → **preview** → signup wall → deck →
  grill → ready. Built in S2, polished in S2.5, live on staging. Web app lives in `apps/web/app/`.

## Decisions already locked in the parent session — do not re-open

These are settled. Treat them as constraints:

1. The onboarding map covers the **whole journey**, landing → first card seen.
2. **Everything is on the table** — the map may conclude the current step order is wrong, and a
   rebuild is an acceptable outcome.
3. The map ends at a **design**, not built code.
4. **Input order (CV first vs job first) is open** — it will be its own ticket.
5. **The no-CV user is fully in scope.** The flow must work for someone arriving with nothing.

## How to run it

- **`/grill-me`** — one question at a time, wait for the answer, restate what got locked, then ask the
  next. Push back on vagueness; do not accept "we'll figure it out later."
- **Adrien is not a native English speaker and will ask you to "explain like I'm 5."** Pre-empt it:
  short plain sentences, one idea each, concrete example before the abstraction, bold the fork. Dense
  analytical prose costs a round-trip.
- **Prior art is fair game and probably necessary.** Dating apps (Tinder/Bumble) run account setup
  before the first swipe — progressive profiling, one question per screen, deferred/optional fields,
  momentum and completion cues. Duolingo, LinkedIn's profile-strength meter, and TurboTax-style
  wizards are also in the neighbourhood. Adrien floated gamification, levels, visible progression, and
  effort/reward. If the discussion needs facts about how these actually work, a `/research` subagent is
  appropriate.
- Consider `/prototype` if "what does the reward look like on screen" becomes the crux — a rough,
  throwaway artifact to react to beats more abstract argument.

## What to hand back

A decided answer to the reward question, plus anything it invalidates or newly opens. Write it into
the repo the same way today's session did — `docs/` design doc, plus `roadmap.md` and `session-log.md`
per the repo's session-hygiene rule in `CLAUDE.md`. Commit and push when `pnpm test && pnpm typecheck`
are green (a push auto-deploys staging, so the green gate is non-negotiable).

Then Adrien returns to the parent session to finish charting the wayfinder map.

## Suggested skills

- **`/grill-me`** — the primary driver for this session.
- **`/research`** — subagent, if prior art on onboarding/gamification patterns is needed.
- **`/prototype`** — if the discussion needs a concrete artifact to react to.
- **`/domain-modeling`** — if new vocabulary emerges that should land in `CONTEXT.md` or an ADR.
- **`/close-session`** — at the end, to sync context files and the three memory docs.

---

## Framed Question

## CORE QUESTION

Should the JobCrush onboarding surface two visible numbers to the user — a Level/progress gauge ("how much we know about you") and a Match % per job card — while keeping both CV quality scores (Well made, Aimed at this job) as internal workbench-only metrics? And specifically: does hiding CV quality protect the user or cheat them, and can the Level gauge survive real-user contact without being read as a grade?

---

## USER CONTEXT

- **Candidate A is the recommendation to stress-test:** two visible numbers only — Level (fuel gauge, never a grade, framed as "how much I know about you") and Match % (per job card, blunt is fine). CV quality scores stay internal.
- **Four possible answers are in scope:** (A) two numbers, (B) three numbers including CV quality, (C) one number (match % only, level is a bar with no number), (D) something else (e.g. named ranks, relative movement only like "+2 since your last answer").
- **The sharp edge the parent session wants tested:** the user with a bad CV must never see a lower Level number than the user with a good CV — both start at Level 1, the good-CV user simply climbs faster. The parent session wants the council to decide if this is honest or a comforting lie that costs the user real information.
- **The council must answer five specific things:** (1) how many numbers and which, (2) naming/framing for each — specifically whether the "how much we know about you" gauge survives real-user interpretation without becoming a grade, (3) the honesty question answered directly, (4) failure modes especially in month two, (5) any real contradiction in the eight locked decisions.
- **Eight decisions are locked constraints** — do not re-open unless a real logical contradiction is found. The council may flag contradictions explicitly.
- **A cheap pending experiment exists:** score 20 real job ads against 3 real CVs, print 9 cards, look at them. Half a day, no product code. Relevant to the reversal condition in locked decision 6.

---

## WORKSPACE CONTEXT

**Product state:** S0–S2 complete (signup wall → confirm deck → grill → verified root CV). Live on staging. S3 (the hunt / job cluster engine) is next. The current flow: landing → upload CV → progress → watermarked preview → signup wall → confirm deck → grill → audited root CV.

**The four numbers in the design:**

| # | Number | About | Source |
|---|---|---|---|
| 1 | Level / progress bar | how much the system knows about the user | Locked decisions 4 + 5 |
| 2 | Match % per job card | user vs. this specific job | Locked decision 2 |
| 3 | Well made | mechanical CV lint (bullet caps, banned words, AI tells) | `docs/cv-quality-kickoff.md` §5 |
| 4 | Aimed at this job | model-panel judgment of targeting fit | `docs/cv-quality-kickoff.md` §5 |

**`docs/cv-quality-kickoff.md` locked decisions directly relevant:**
- §5: Numbers 3 and 4 never merge into one total — a beautifully written CV pointed at the wrong job must not hide behind a mediocre combined score.
- §6: Anything countable gets counted, never judged. Mechanical scores are objective; targeting scores are model-panel judged.
- §7: Both scores are framed as a workbench tool — run over ~5 fixed test cases after a prompt change to verify regression, not as a user-facing instrument. The kickoff doc does not settle whether users ever see them.

**Eight locked onboarding decisions (constraints):**
1. One flow — CV is a shortcut that auto-answers questions, not a separate path.
2. Cards are the payoff; the CV is the by-product. Every question reads as "unlocking jobs."
3. Earn the cards — ~5 questions first, then three real fully visible scored cards. No locked teasers.
4. Three feedback speeds: instant (a line writes into the profile document), slow (level bar fills every few answers), rare (cards unlock at milestones).
5. Endless levels, never a finite 100% bar. The bar measures distance to the next unlock only ("Level 2 · 4 answers to unlock your next 5 jobs").
6. The wall sits after the reveal, on the actions. Google OAuth leads, magic link secondary. Answers persist server-side from question 1. Reversal condition: if v1 cards are not obviously better than a LinkedIn search within ten seconds, the wall moves before the reveal.
7. Front door = two entry points rendered as one door (interview invitation + quiet CV upload CTA).
8. CV upload buys one big jump ("+3 levels"), then questions resume. The first post-upload question must visibly prove the file was read. Better CV = fewer questions to a good score, but endless improvement is always possible.

**Tech stack:** Fastify API + Next.js web (`apps/web/app/`). CV reasoning in `docs/cv-brain/`. Push auto-deploys to Fly staging; green gate (`pnpm test && pnpm typecheck`) is non-negotiable before push.

**Roadmap:** S2.75 (CV quality, the ruler) is listed. Open items A (grill stopping rule + onboarding UX) and B (feeding `cv-authoring-rules.md`) are pending.

---

## WHAT'S AT STAKE

**If the council gets it wrong toward over-exposure (candidate B):** showing CV quality scores to users re-centres the CV as the product — fighting locked decision 2 — and risks delivering a grade ("your CV is poor") to a first-minute user who arrived with nothing. That user closes the tab. The user most hurt is the one the product most needs to retain.

**If the council gets it wrong toward under-exposure (candidate C or minimal A):** the Level gauge carries no number, or the system shows so little feedback that the gamification loop (locked decision 4/5) has nothing to sustain it past the first session. Month-two returning users face a bar that either feels frozen (they're level 7, nothing has changed) or meaningless (they don't remember why they're here).

**The honesty cost:** a user whose CV is weak gets identical Level progression to a user whose CV is strong (both start at Level 1; the strong-CV user simply climbs faster via locked decision 8's jump). If the product withholds the signal that the CV is weak, it may leave that user applying through tailored CVs that still underperform — and they won't know why. They may blame the product rather than understanding what to improve.

**The naming cost:** if "how much we know about you" is interpreted by real users as "how good you are at this" — a plausible misread — the Level gauge becomes a grade by another name, and the framing protection evaporates in practice.

**The verdict is load-bearing:** the number and naming decisions made here directly shape what gets built in S2.75 (the ruler) and S3 (the hunt). A wrong answer here means either a demotivating UX that closes tabs, a dishonest UX that costs users real career information, or a gamification shell that collapses when users return after a month.

---

## Stage 1: Advisor Responses

### Fundamentalist (Model A)

[ERROR โ€” RuntimeError: primary Fireworks (accounts/fireworks/models/glm-5p2) failed (RuntimeError: FIREWORKS_API_KEY is not set.); fallback Claude (opus) [high] also failed (TimeoutExpired: Command '['C:\\Users\\adrie\\AppData\\Roaming\\npm\\claude.CMD', '--print', '--model', 'opus', '--output-format', 'text', '--no-session-persistence', '--effort', 'high']' timed out after 120 seconds)]

### Contrarian (Model B)

[ERROR โ€” RuntimeError: primary Fireworks (accounts/fireworks/models/deepseek-v4-pro) failed (RuntimeError: FIREWORKS_API_KEY is not set.); fallback Claude (opus) [high] also failed (TimeoutExpired: Command '['C:\\Users\\adrie\\AppData\\Roaming\\npm\\claude.CMD', '--print', '--model', 'opus', '--output-format', 'text', '--no-session-persistence', '--effort', 'high']' timed out after 120 seconds)]

### Executor (Model C)

[ERROR โ€” TimeoutExpired: Command '['C:\\Users\\adrie\\AppData\\Roaming\\npm\\claude.CMD', '--print', '--model', 'opus', '--output-format', 'text', '--no-session-persistence', '--effort', 'xhigh']' timed out after 120 seconds]

### Evidence Scout (Model D)

Live web search isn't permitted in this session (permission denied), so I can't run the fresh searches I'd normally lead with. I'll flag every claim below as **[needs live verification]** where it rests on memory rather than a source I can pull right now, and I'll name the exact searches the parent session should run to confirm them. That's the honest version of an Evidence Scout report with the primary tool cut off.

---

## 1. DIRECT ANSWER

**Candidate A is right, with one modification: ship it as A, but the Level gauge must show *movement*, not a *number* — which is really candidate D wearing A's clothes.**

Two visible instruments:
- **Match %** per job card — keep it, blunt is fine, it's the payoff.
- **Level** — but the load-bearing element users should see is the *delta* ("+2 since your last answer", "3 answers to unlock 5 more jobs"), with the absolute level number present but demoted to a small ordinal, never the hero figure.

Keep both CV quality scores internal. **Hiding CV quality protects the user in month one and cheats them in month two** — so the correct design isn't "hide it forever," it's "the CV quality signal must surface *as a fixable next action*, never as a *grade*, and only once the user has earned enough cards to have context for it." That's the real answer to the honesty question: you don't withhold the signal, you *change its grammar* from noun (a score you are) to verb (a thing you do next).

The honesty test the parent session posed — "bad-CV user sees the same Level 1 as good-CV user" — is **honest, because Level measures what the *system* knows, not how *good the user* is.** Two people who have answered zero questions genuinely are equally unknown to the system. The lie would be claiming the *cards* are equally good when they're not. As long as Match % is blunt and honest per card, the weak-CV user gets the true signal ("these jobs match you at 40%") through the number that's actually about them. Level was never the right place to carry CV-quality truth.

---

## 2. EVIDENCE SCOUT LENS

Comparable cases from the landscape (all **[needs live verification]** — flagged individually):

**a) LinkedIn "Profile Strength" / All-Star ladder.** This is the closest precedent to your Level gauge and it's instructive: LinkedIn deliberately used a *named ordinal ladder* (Beginner → Intermediate → All-Star), **not a percentage**, precisely because a percentage reads as a grade and stalls users who can't hit 100%. The named-rung approach (your candidate D) is battle-tested at massive scale for exactly this "how complete is your profile" use case. **[needs live verification — search: "LinkedIn profile strength All-Star levels history percentage removed"]**

**b) The goal-gradient effect (Kivetz et al., 2006, *Journal of Marketing Research*).** People accelerate effort as they near a visible goal. This is the strongest *empirical* support for your locked decision 5 (endless levels, bar shows distance-to-next-unlock). The catch the literature also documents: **post-reward reset pause** — after a goal is hit, effort *drops* before re-accelerating. This is your month-two risk, and it's a documented phenomenon, not a guess. **[needs live verification — "goal gradient effect Kivetz 2006 post-reward reset"]**

**c) Credit scores / Grammarly score / Headspace — the "number becomes identity" failure.** When a completeness/quality number is shown as a persistent figure *about the person*, users anchor on it and it becomes an identity grade. Grammarly's document score is the cautionary case: users chase the number instead of the writing. This is direct evidence *for* keeping CV-quality internal — a visible "Well made: 62" would do to CVs exactly what Grammarly's score does to prose. **[needs live verification — "Grammarly score gaming writing behavior criticism"]**

**d) Duolingo's month-two problem is real and documented.** Duolingo's own retention work centers on the streak precisely because *level/XP alone doesn't retain* — the variable, loss-averse mechanic (streak) does the heavy lifting past week one. Implication for you: a Level bar that only fills is a *weak* retention mechanic by itself; the *card unlocks* (your rare-speed feedback) are your streak-equivalent and must carry month-two, not the bar. **[needs live verification — "Duolingo retention streak vs XP levels engagement"]**

**e) Dark-patterns / deceptive-design literature (Brignull; and the FTC's 2022–23 dark patterns reports).** The relevant test they apply: is information *withheld that a reasonable user needs to make a decision in their own interest*? A hidden CV-quality score fails this test *only if* the user has no other honest signal about outcome quality. Since Match % is blunt and honest, and (in my recommendation) CV-quality surfaces as actionable fixes, you stay on the right side of the line. A *merged, hidden* quality total with *no* honest outcome signal would cross it. **[needs live verification — "FTC dark patterns report 2022 information withholding"]**

**f) The cheap pending experiment is the right instrument and has precedent.** "Print 9 cards, look at them" is a paper-prototype / Wizard-of-Oz test — the highest-ROI method in the UX-research canon (Nielsen Norman Group has published for two decades that 5 users / low-fi artifacts catch most issues). It directly de-risks locked decision 6's reversal condition ("cards beat a LinkedIn search in 10 seconds"). **Run it before building any gauge.** **[well-established, NN/g paper-prototyping]**

**What genuinely needs live verification before the verdict is load-bearing:**
1. Did LinkedIn *remove* the profile-strength meter, and if so, *why*? (Strong signal either way.)
2. Any published A/B result on **ordinal ranks vs. percentage** for profile-completion gauges.
3. Current (2025–26) user sentiment on **job-match percentages** — are they trusted or dismissed as fake? (Reddit r/recruitinghell, r/jobs are the honest corpus.)

---

## 3. FAILURE MODES

What would make my answer wrong:

- **The naming still leaks into "grade."** "How much I know about you" is a *second-person* frame — and second-person completion gauges are exactly what users read as self-assessment. Even LinkedIn's *named* ladder got read as "am I good enough." My delta-first mitigation reduces but does **not** eliminate this. If the cheap test shows users reading Level 3 as "I'm a C student," candidate D (pure relative movement, no absolute number) becomes mandatory, not optional.
- **My "surface CV quality as fixable action" recommendation may itself violate locked decision 2** (CV is by-product, cards are payoff). If the fix-action UI grows into a CV-improvement dashboard, you've re-centred the CV. This is the sharpest tension and I'm genuinely uncertain where the line sits — it needs the parent session's judgment.
- **Match % honesty can backfire worse than a hidden quality score.** A blunt "40%" on every card for a weak-CV user in *minute one* may close the tab faster than any hidden grade would — this is the same retention risk you're trying to avoid, just relocated to number 2. I'm asserting Match % is "safe because it's about the job," but a first-minute user doesn't parse that nuance; they see a low number about themselves. **This is my least-confident claim.**
- **I can't currently verify the LinkedIn precedent.** My whole "named ranks beat percentages" argument leans on it. If LinkedIn's meter actually performed fine and was removed for unrelated reasons, my candidate-D lean weakens.
- **Month-two "frozen bar."** If a returning user is Level 7 and nothing has moved, the endless-level design *feels* worse than a finite bar, because there's no "you're 80% done" to pull them. The card-unlock mechanic must be the re-engagement hook, not the bar — and I haven't verified that unlock cadence can carry a 30-day-lapsed user.

---

## 4. FINAL RECOMMENDATION

**Ship candidate A, but render Level as movement-first (candidate D's mechanic inside A's two-number frame), and run the 9-card cheap test *before* building the gauge — using it to A/B two Level treatments on real users: (i) absolute number "Level 3" vs. (ii) pure delta "+2, 3 to next unlock."** Let real interpretation, not the council, settle whether the absolute number survives.

On honesty: **you are not lying by giving both users Level 1** — Level truthfully measures system knowledge, and both users are equally unknown at answer zero. Keep CV-quality scores out of the user's face *as scores*, but do not withhold the *information*: convert it into the next question or a concrete fix-this action so the weak-CV user learns *what to improve* without ever being handed a grade. The only real dishonesty available here would be dressing up a weak card as a strong match — so keep **Match % blunt**, and treat the first-minute low-Match-% reaction as the top thing the cheap test must watch for.

**No hard contradiction in the eight locked decisions** — the closest is the pressure between "surface CV quality as action" and decision 2 (CV is by-product); flag it, don't re-open it. Get the three verification searches run (LinkedIn meter history, ranks-vs-percentage A/B evidence, 2025–26 match-% sentiment) before the S2.75 build commits, since my key precedent is currently unverified.

### Expansionist (Model E)

## 1. DIRECT ANSWER

**Candidate A is correct, with one modification: CV quality stays out of onboarding but must not stay hidden forever — it surfaces at the workbench moment (editing/exporting a tailored CV for a specific job), reframed as fixes, never as a grade.**

Resolving the three sub-questions directly:

**How many numbers, which:** Two visible, as proposed. But they are not two of a kind — and that is the whole justification. The Level gauge measures *information completeness* (endless, no ceiling). Match % measures *bounded job-fit* (finite, per-job). They measure different objects on different scales, which is exactly why they can coexist without competing. CV quality (well-made / aimed-at-job) is a *third kind* — a quality judgment of an artifact — and the onboarding surface is the wrong place for it.

**The honesty question, answered directly:** Withholding the Level *number* from a weak-CV user is **honest**, because Level is not a quality signal — it tracks how much the system knows, and at question one it genuinely knows nothing about either user. Both starting at Level 1 is a true statement about data completeness, not a comforting lie about merit. The strong-CV user climbing faster is also true: the upload gave the system more to know.

But there is a real honesty cost, and it is *not* the Level gauge — it is the **absence of any CV-quality feedback at the point of action**. If a user ships tailored CVs that underperform and the product never tells them their source material is weak, that is cheating them of career information. The protection ("don't grade a first-minute user") is right for *onboarding*. It becomes a lie if it persists into the *workbench*, where the user is staring at one specific CV for one specific job and is ready to act on a fix. So: hide at onboarding = protect. Hide at workbench = cheat. The line is the moment, not the number.

**Can "how much we know about you" survive real users:** Only if the number is **never shown bare**. "Level 7" alone reads as a grade. "Level 7 · 4 answers to unlock your next 5 jobs" (locked decision 5) reads as distance-to-reward — the number is attached to the *unlock*, not to the *person*. The framing protection lives in that attachment, not in the word "Level." Enforce it as a rule: the Level integer never appears without its "N answers to next unlock" clause. A bare Level number is a grade; a Level-with-remainder is a fuel gauge.

## 2. EXPANSIONIST LENS

Everyone is treating these as two *display* decisions. They are two *flywheels*, and their compounding upside is being systematically underweighted.

**The Level gauge is a data-acquisition moat disguised as a progress bar.** Every answer enriches the claim graph — proprietary, structured, first-party career data that no LinkedIn keyword search can replicate. The onboarding conversation isn't UX polish; it's the mechanism that builds the one asset competitors can't scrape. Frame Level internally as *"depth of the moat,"* and you'll resist every instinct to shorten the grill. The user experiences "unlocking jobs"; the product is accumulating an un-copyable dataset. That reframing changes what you optimize.

**The adjacent opportunity nobody named: graft relative movement (candidate D) onto Match %, not onto Level.** The most motivating number in the entire product is unbuilt: *"This job was 61% for you last week. You answered 3 questions. You're now 74%."* That single line turns the grill from a chore into visible ROI — the user watches their own answers move a real needle on a real job. It's honest (the match genuinely improved), it's blunt (locked decision 2 allows it), and it's the strongest retention hook in the design. The council is debating whether to *show* Match %; the bigger win is showing Match % *in motion*.

**The "internal" CV quality scores are a latent premium tier.** Kept as a regression harness today, they are the raw material for a future coach mode: *"Your CV is well-made (9/10) but weakly aimed at this role (4/10) — here's why."* The onboarding decision to withhold them isn't a dead end; it's the bottom rung of an upsell ladder. Free users get matches; the workbench surfaces fixes; a paid coach mode surfaces the full diagnostic. You are not hiding a number — you are staging its reveal.

**Success beyond expectations:** the product stops being a CV tailor and becomes a *career-fit instrument*. Match-%-in-motion trains users to understand which questions move which jobs — they learn their own market. That's a defensible position no résumé tool occupies, and it's unlocked purely by making one already-computed number visible and animating a second.

## 3. FAILURE MODES

**What would make my answer wrong:**

- **Blunt Match % backfires exactly like a grade.** A first-minute user who sees "23%" on every job closes the tab for the same reason a "your CV is poor" would send them away. If real match scores cluster low, blunt is not honest-and-fine — it's demotivating. **This is what the cheap experiment must test** (score 20 ads × 3 CVs, print 9 cards, look): not "are the cards better than LinkedIn" but "does the *number* on a real weak-CV user read as an insult." If most cards score under 50%, Match % needs curation (show only jobs above a floor) or good-news framing, and my "blunt is fine" concession is wrong.

- **The workbench-reveal is load-bearing and unbuilt.** My whole "protect not cheat" argument depends on CV quality surfacing *later* as fixes. If S2.75 ships the internal scores and never wires the workbench reveal, then Candidate A *is* the dishonest version the parent session feared — a user shipping weak CVs blind. The honesty verdict is conditional on building the reveal, and I'm most uncertain whether that's actually on the roadmap or just implied.

- **The framing rule erodes under UI pressure.** "Never show Level bare" is easy to state and easy to violate the first time a designer wants a compact header badge. One "Lvl 7" chip and the grade is back. Low confidence this survives contact with real layout constraints unless it's a lint rule, not a guideline.

- **Month-two frozen bar.** The Level gauge is a first-session instrument; a returning level-7 user has nothing filling. My mitigation — pivot the hero number to "new matches this week" (a freshness number) by month two — is asserted, not validated. I don't know if the discovery engine (S3) produces enough weekly new matches to sustain it.

**Contradiction to flag (genuine, in locked decision 8):** Decision 8 promises *"better CV = fewer questions to a good score."* Under Candidate A there is **no visible CV score** — so "a good score" has no referent the user can see. It either secretly means CV quality (contradicting "keep it internal") or it means Match % (which is per-job, not per-CV). The phrasing leaks the very concept Candidate A hides. **Reword decision 8** to: *"better CV = higher starting Match % on more jobs, fewer answers to unlock them."* That removes the phantom score and keeps the promise honest.

## 4. FINAL RECOMMENDATION

**Ship Candidate A — two numbers — but treat it as three moves, not two:**

1. **Level**, shown only as "Level N · X answers to unlock your next 5 jobs." Never the bare integer (make it a lint rule, not a convention). It's a fuel gauge and a data moat; it retires gracefully by month two when the hero number becomes "new matches this week."
2. **Match %, animated.** Don't just show it — show it *moving* after answers ("61% → 74%"). This is the highest-upside unbuilt feature in the design and turns the grill into visible ROI.
3. **CV quality: internal at onboarding, revealed at the workbench as fixes.** Withholding protects the first-minute user; the deferred reveal is what keeps it honest. Building that reveal is non-negotiable — without it, A becomes the lie.

**Before any of this, run the half-day experiment — but test the right thing:** not "are the cards good," but "does a real Match % number on a real weak CV read as an insult." If scores cluster low, Match % needs a floor or curation before it ships blunt. And reword locked decision 8 to kill the phantom "good score."

---

## Stage 2: Peer Reviews

### Fundamentalist's Peer Review

Two of the four council members (Contrarian, Executor) returned only error strings — no content to evaluate. So this is effectively a two-response panel: Evidence Scout and Expansionist. I'll say so plainly rather than pretend there were four.

Worth noting up front: both surviving responses converged on nearly the same answer (ship A, keep CV quality internal at onboarding but surface it later as fixes, run the cheap test first). That convergence is weaker evidence than it looks — the two dead seats were the ones assigned to *disagree* (Contrarian) and to *ship the blunt thing* (Executor). The panel lost its dissent, so treat the consensus with suspicion, not comfort.

---

## Q1. Which response most changed how I'd answer?

**Expansionist — specifically the contradiction it found in locked decision 8.**

Decision 8 promises "better CV = fewer questions to **a good score**." Under Candidate A there is no visible CV score, so "a good score" has no referent the user can see. It either secretly means CV quality (breaking "keep it internal") or it means Match % (which is per-job, not per-CV). That's a genuine logical contradiction inside the locked set — exactly what the parent session asked the council to flag — and the Evidence Scout missed it entirely, saying "no hard contradiction." The Expansionist's reword ("better CV = higher starting Match % on more jobs, fewer answers to unlock them") is clean and removes the phantom score. That's the single most load-bearing catch in either response, because it's the one thing the parent explicitly authorized re-opening for.

The second update: **"animate Match %, don't just show it"** ("61% → 74% after 3 answers"). Both members agree the honesty signal for a weak CV should live in Match %, not Level. But only the Expansionist noticed that a *moving* Match % is what makes the grill feel like ROI instead of a chore — and it directly reinforces locked decision 4's "instant feedback" speed. That's a real design insight, not role decoration.

## Q2. Which response has the biggest blind spot?

**Evidence Scout — it declared "no hard contradiction" and missed the decision-8 phantom-score problem** that the Expansionist caught. Given that flagging contradictions was one of the five things the council was explicitly told to do, and this was the one real contradiction present, that's a material miss, not a stylistic one.

Its second blind spot is structural: **nearly the entire Scout report is self-admittedly unverified** ("[needs live verification]" on every substantive precedent). The LinkedIn-removed-the-percentage-meter claim is the load-bearing support for its candidate-D lean, and it flags that if that claim is wrong, the lean collapses. An Evidence Scout that can't run searches and leans its recommendation on an unverified memory is being honest — but the honesty doesn't repair the fact that its distinctive contribution (evidence) is the one thing it couldn't deliver. The parent should discount the Scout's *conclusions* and keep only its list of searches to run.

## Q3. What did both responses miss?

Three things, roughly in order of how much they'd move the recommendation:

1. **Neither questioned whether Match % can be computed honestly at onboarding at all.** Both treat Match % as a trustworthy per-job number that carries the honesty load. But at question ~5, the system has answered maybe five questions and read one CV. A Match % derived from that thin a profile is *itself* a comforting-or-insulting fiction — it's precise-looking noise. The honesty problem both members relocated onto Match % may not actually be solvable there yet, because the number isn't real yet. The cheap experiment (20 ads × 3 CVs) should test not just "does a low number insult" but "is the number even stable enough to show." That reframes the whole verdict: if Match % isn't trustworthy early, then *both* visible numbers are soft in month one and the honesty question has no honest home.

2. **Neither costed the "surface CV quality as fixes at the workbench" recommendation.** Both lean on it as the thing that keeps Candidate A honest — the Expansionist even calls building it "non-negotiable." But that reveal surface is unbuilt, unspecced, and unscheduled (S2.75 is "the ruler," not "the coach"). Both responses' honesty verdict is therefore *conditional on a feature that doesn't exist and isn't on the near roadmap*. Neither says: if you ship the internal scores in S2.75 and don't wire the reveal, you have shipped exactly the dishonest version the parent feared. That's a scheduling risk that should be a gating decision, not a footnote.

3. **Nobody asked what the returning month-two user actually sees on screen.** Both name the "frozen bar" risk and both wave at "pivot the hero to new-matches-this-week." But that's an S3 (the hunt) capability — a discovery engine producing fresh weekly matches — and neither checked whether S3 will actually generate enough new matches per week to fill that number for a lapsed user. The month-two mitigation both rely on is a dependency on an unbuilt engine's throughput. If S3 surfaces two new matches a month, the freshness number is as frozen as the bar.

Net: the surviving pair got the *shape* right (A, internal quality, cheap test first) and the Expansionist found the one real contradiction. But both built their honesty case on two things that don't exist yet (the workbench reveal, the S3 freshness feed) and one thing that may not be real when shown (an early Match %). The verdict is only as honest as those three unbuilt/unverified pieces — and neither response made that conditionality explicit enough to gate the S2.75 build on it.

### Contrarian's Peer Review

Two of the four seats returned errors (Fundamentalist and Executor both timed out), so this is really a two-response council — Evidence Scout and Expansionist — and the two that survived converged hard: both said "ship A, but render Level as movement not a bare number, and surface CV quality later at the workbench as fixes, not a grade." Convergence between two voices isn't corroboration when they're reasoning from the same priors, so I'm weighting their agreement lightly.

## Q1. Which response most changed how I'd answer, and why?

**Expansionist**, on two specific points.

First, its **decision-8 contradiction** is the single most useful thing either response produced, and it's exactly what the parent session asked the council to hunt for. Locked decision 8 says *"better CV = fewer questions to a good score."* Under Candidate A there is no user-visible score, so "a good score" has no referent — it either secretly means CV quality (breaking "keep it internal") or Match % (which is per-job, not per-CV). That's a genuine logical leak, not a stylistic quibble, and the proposed reword ("higher starting Match % on more jobs") actually resolves it. Evidence Scout explicitly said "no hard contradiction"; Expansionist found the real one. That updates my answer: there *is* a contradiction to flag.

Second, **relocating candidate-D's delta mechanic from Level onto Match %** ("this job was 61% last week, you answered 3 questions, now 74%") is sharper than Evidence Scout's "show the delta on Level." A moving number on the thing the user actually cares about (the job) is a better retention hook than a moving number on an abstract progress bar. That reframes what "movement-first" should attach to.

Nothing in Evidence Scout changed my view load-bearingly, because its most distinctive argument — the LinkedIn named-ranks precedent — is self-flagged "[needs live verification]," so it can't be weight-bearing yet.

## Q2. Which response has the biggest blind spot?

**Expansionist**, on its own flagship feature: **it asserts that animating Match % (61%→74%) is "honest (the match genuinely improved)" — and that's false, or at least unexamined.** Answering grill questions doesn't improve the match; it surfaces facts that were already true. The job fit didn't change — the system's *estimate* of it sharpened. Showing "61%→74%" tells the user *you got more matched* when the truth is *our guess got more accurate*. That is precisely the comforting-lie failure mode the parent session flagged, just relocated onto number 2. And it's worse than the Level case, because Level honestly measures system knowledge whereas an animated Match % actively implies user improvement that didn't happen. Expansionist stakes its "highest-upside unbuilt feature" on this being honest and never interrogates it — while simultaneously (correctly) warning that blunt Match % could insult a first-minute user. It didn't connect that a *moving* Match % has the same integrity problem as a bad Level gauge.

(Evidence Scout's comparable weakness — its candidate-D lean resting on an unverified LinkedIn precedent — I don't count as a blind spot, because it flagged it three times itself. A hazard you name isn't a blind spot.)

## Q3. What did ALL responses miss?

**Whether CV quality and Match % are even correlated — which is the actual hinge of the honesty question, and nobody made it the crux.**

Both surviving responses resolve honesty the same way: "the weak-CV user still gets the true signal, through Match %." That claim is only true if a weak CV reliably produces lower Match % across jobs. But that's an **empirical question, not an assumption** — and it decides everything:

- If CV quality and match are **correlated** (weak CV → visibly lower matches everywhere), then Match % already encodes the CV-weakness signal, hiding the quality score costs the user *zero* information, and Candidate A is unambiguously honest.
- If they're **orthogonal** (a well-made CV can still match nothing; a weak CV can match strongly on the right jobs), then hiding CV quality genuinely withholds career information Match % never conveys — and Candidate A is the comforting lie the parent session feared.

Neither response established which world we're in, yet both confidently declared the design honest. The tell: their entire "protect not cheat" resolution rests on a correlation they never checked.

And this is directly testable by the cheap experiment already on the table. Both responses said the 9-card test should watch "does a low Match % insult a weak-CV user." That's the right *second* question. The **first** question the same 9 cards answer for free: **does the weak CV actually score lower than the strong CV on the same ads?** Run the internal Well-made / Aimed-at-this-job scores alongside Match % on all 9 cards and check whether they move together. That's the same half-day, no new code — and it converts the honesty debate from philosophy into a scatter plot before S2.75 commits.

One structural note that reinforces this: per `cv-quality-kickoff.md` §7, the two CV-quality scores are defined as a **workbench regression harness** — run over ~5 fixed test cases after a prompt change — not a per-user, per-job production instrument. Both responses breezily propose "reveal them at the workbench as fixes," assuming the score is a latent asset ready to surface. It may not exist in a per-user form at all; making it trustworthy at real-user scale is unscoped engineering neither response priced in. So the "protect now, reveal later" honesty guarantee both responses lean on may be resting on a feature that isn't just unbuilt but undesigned.

### Executor's Peer Review

[ERROR โ€” TimeoutExpired: Command '['C:\\Users\\adrie\\AppData\\Roaming\\npm\\claude.CMD', '--print', '--model', 'opus', '--output-format', 'text', '--no-session-persistence', '--effort', 'xhigh']' timed out after 120 seconds]

### Evidence Scout's Peer Review

**Framing caveat first:** three of the four responses (Fundamentalist, Contrarian, Executor) failed with API/timeout errors and contain zero content. Only the Expansionist (Model E) produced an answer. So this isn't a four-way critique — it's an evaluation of one response, and the "council verdict" this was meant to cross-validate rests on a single seat. Flagging that plainly because it's load-bearing: you don't have a council result here, you have one model's take dressed as one.

---

**Q1. Which response most changed how I'd answer — and why.**

Only Model E is evaluable, and one argument in it genuinely updates my answer: **the contradiction in locked decision 8.** "Better CV = fewer questions to a good score" names a *score* the user is supposed to reach — but under Candidate A there is no visible CV score. So "a good score" either secretly means CV quality (breaking "keep it internal") or means Match % (which is per-job, not per-CV). That's a real logical leak, not a nitpick, and it's exactly the kind of contradiction the parent session asked the council to surface. Model E's reword — *"better CV = higher starting Match % on more jobs, fewer answers to unlock them"* — resolves it cleanly. I'd adopt that.

The second update is the **honesty reframe**: the line isn't the *number*, it's the *moment*. Hide CV quality at onboarding = protect; hide it at the workbench where the user is acting on one CV for one job = cheat. That dissolves the parent session's either/or ("honest or comforting lie") better than picking a side does — the answer is "honest here, would be a lie there, so build the there."

The Match-%-in-motion idea ("61% → 74% after 3 answers") is the most motivating single feature named, but it didn't change my *answer* to the core question — it's an addition to Candidate A, not a challenge to it.

**Q2. Biggest blind spot in the response.**

Model E never asks whether **Match % (visible, #2) and "Aimed at this job" (hidden, #4) are the same measurement.** Both score candidate-vs-this-specific-job fit. If they're the same construct, the whole "we hide CV quality" claim is half-false — you're already showing job-fit, just relabeled; and animating Match-%-in-motion *is* surfacing the targeting score, which §5 says stays internal. If they're genuinely different (Match % = does this job suit you; "aimed" = is this CV pointed well at it), then the design has two job-fit numbers that will diverge and confuse — a user at 74% match staring at a CV the internal panel rates 4/10 on aim. Either way it's a concrete, answer-changing gap: it determines whether Candidate A is even internally coherent, and Model E's whole "two numbers measure different objects" justification skips over it.

**Q3. What all responses missed.**

Beyond the process failure already flagged, one substantive omission that could shift the recommendation:

**The living number in month two is the job market, not the user.** All the worry about the "frozen bar" assumes the only sources of change are the user's answers and CV. But Match % over a *refreshing* set of jobs moves on its own — new postings appear, old ones fill. A returning level-7 user doesn't need a filling Level bar; they need "3 new jobs cleared your 70% bar this week." That requires no new gamification mechanic — it's just S3 (the hunt) running. This reframes the month-two failure mode from "we need a new hero number" (Model E asserts this but calls it unvalidated) to "the hunt engine already produces it, if it produces enough volume." The recommendation should make **S3's weekly new-match volume the explicit gate on the whole retention story** — and that's directly testable by the cheap experiment you already have queued, if you extend it to "how many of 20 ads clear a match floor per CV," not just "do the cards beat LinkedIn."

Net: I'd ship Candidate A with Model E's decision-8 reword, but I would not treat this exercise as a validated council verdict, and I'd resolve the #2/#4 overlap before writing a line of S2.75.

### Expansionist's Peer Review

**Meta-flag first (load-bearing): three of the four responses are error stubs.** Fundamentalist, Contrarian, and Executor all failed (missing `FIREWORKS_API_KEY` + Opus fallback timeouts). Only the Evidence Scout produced content. So this isn't a four-way council to cross-examine — it's a single response with three empty chairs. The adversarial value of the exercise (decorrelated blind spots) is gone. **Recommendation before anything else: re-run the council with the API key set and a longer fallback timeout.** The verdict is described as "load-bearing" for S2.75/S3 — don't build on a one-member panel. My answers below work with the one real response.

---

**Q1. Which response most changed how I'd answer, and why?**

Only the Evidence Scout could. Two of its moves genuinely updated me:

1. **The noun→verb reframing of CV quality.** "Don't withhold the signal, change its grammar — from a score you *are* to a thing you *do next*." That dissolves the binary the parent session posed (hide = protect vs. hide = cheat). The honest move isn't a visibility toggle; it's converting `Well made: 62` into the next question or a fix-this action. That's a better answer to the honesty question than either "show it" or "hide it."

2. **"Level measures what the *system* knows, not how *good the user* is — both are equally unknown at answer zero."** This is the clean kill on the parent's sharp edge. Giving both users Level 1 is not a comforting lie, because Level was never a claim about the user. That reframe is correct and I'd adopt it.

Both are reframes, not new evidence (the Scout couldn't search — every precedent is flagged `[needs live verification]`, so the LinkedIn/Grammarly/Duolingo scaffolding is memory, not sourced). But the reframes stand on their own logic.

---

**Q2. Biggest blind spot, and what it is?**

Evidence Scout — and it's a concrete one that breaks its own thesis:

**Match % is not "about the job." It silently encodes CV quality, and the Scout leans its entire honesty argument on the opposite claim.** The Scout says the weak-CV user "gets the true signal through the number that's actually about them" and that Match % is "safe because it's about the job." But Match % is a *composite* of (fit between candidate and role) × (how well the CV is tailored). A weak-CV user sees 40% on every card **not because they're a poor fit but because their CV isn't tailored yet** — and they have no way to decompose it. So blunt Match % doesn't discharge the honesty duty; it *misattributes* CV weakness to job fit. The user concludes "I'm a bad match for these jobs" when the truth is "my draft underperforms." That's exactly the "applies through weak CVs and blames the wrong thing" failure the parent session worried about — relocated into the number the Scout claims is the honest one.

Second, smaller, but it's an internal contradiction: the Scout says "run the 9-card cheap test *before* building the gauge" and "use it to A/B two Level treatments on real users." **A stack of 9 printed static cards has no Level gauge and no interaction — it structurally cannot A/B Level treatments.** The cheap test validates decision 6's reversal condition (do cards beat LinkedIn in 10 seconds) and nothing about Level naming. The Scout conflated two different tests.

---

**Q3. What did all responses miss?**

(With only one real respondent, this is "what the Scout missed that matters" — but it's genuinely load-bearing.)

**Nobody asked how Match % is computed — against the root CV or against the per-job tailored draft — and that single mechanical fact resolves most of the debate.**

- If Match % is scored against the **tailored draft**, then improving CV quality is *literally how the user raises Match %*. The two-number design already contains the CV-quality signal — implicitly, as a lever the user can pull. "Aimed at this job" (number 4) is just the internal instrument version of the same axis the user already sees as Match %. In that case the honesty problem largely evaporates: the user *does* have an actionable outcome signal, and hiding the internal score costs them nothing.
- If Match % is scored against the **root CV**, the two numbers are decoupled, the entanglement above bites hard, and the case for surfacing CV quality (as the Scout's fix-actions) gets much stronger.

The council answered a naming/visibility question while the actual crux is a **pipeline question** the workspace docs don't settle. Before S2.75 commits, the parent session should pin down: *what does Match % measure against, and is it recomputed after the user acts?* That answer, not the number-count debate, decides whether hiding CV quality cheats the user — and it's checkable in the cheap 9-card experiment for free (score each CV both ways, see if the spread differs).

One more all-missed item: **no one costed the "fix-this action" against locked decision 2.** The Scout flags the tension ("might re-centre the CV") but leaves it to the parent. The concrete test is simple — a fix-action stays legal under decision 2 only if it's phrased as *unlocking a card* ("answer this to raise these 3 matches"), never as *improving your CV*. Same information, and it keeps cards as the payoff. That's the guardrail the verdict needs and none of the (available) responses stated as a rule.

**Anonymization mapping:**
- Model A = Fundamentalist (Claude (opus) [high] [fallback from Fireworks (accounts/fireworks/models/glm-5p2)])
- Model B = Contrarian (Claude (opus) [high] [fallback from Fireworks (accounts/fireworks/models/deepseek-v4-pro)])
- Model C = Executor (Claude (opus) [xhigh])
- Model D = Evidence Scout (Claude (opus) [high] [fallback from Fireworks (accounts/fireworks/models/qwen3p7-plus)])
- Model E = Expansionist (Claude (opus) [high] [fallback from Fireworks (accounts/fireworks/models/kimi-k2p7-code)])

---

## Stage 3: Chairman's Synthesis

## WHERE THE COUNCIL AGREES
The usable council consensus is weaker than advertised because several primary responses failed, but Evidence Scout and Expansionist independently converge on the core shape: **ship Candidate A**.

Visible to users:
- **Level / progress**: how much JobCrush knows about them.
- **Match %**: per job card.

Internal only:
- **Well made**
- **Aimed at this job**

They also agree on the key honesty line: **hiding CV quality scores during onboarding protects the user; hiding CV quality problems forever cheats them.** The scores should not appear as grades, but the underlying issues must later become concrete fix actions before export/submission.

## WHERE THE COUNCIL CLASHES
The strongest clash is over whether Match % can carry the honesty burden. Expansionist treats Match % movement as motivating: “61% → 74%.” Contrarian correctly objects that this can imply the user improved, when really the system learned more. Stronger position: **show Match %, but be careful with movement language.** Say “updated with new evidence,” not “you improved.”

Second clash: whether Level can safely be numeric. Evidence Scout leans toward movement-first or delta-first. Expansionist allows “Level N” only when attached to next unlock. Stronger position: **Level can be visible, but never bare.** “Level 4 · 3 answers to unlock 5 jobs” is acceptable. A naked “Level 4” is a grade waiting to happen.

## BLIND SPOTS THE COUNCIL CAUGHT
The real contradiction is in locked decision 8: “better CV = fewer questions to a good score.” Under Candidate A, there is no visible CV score. Reword it to: **“Better CV = higher starting Match % on more jobs, fewer answers to unlock stronger cards.”**

The biggest unresolved product question: **does Match % measure candidate-job fit, CV-targeting quality, or both?** If it overlaps with “Aimed at this job,” then the product is hiding one job-fit score while showing another. That must be resolved before S2.75.

Month two is the danger zone. A Level gauge may feel frozen, fake, or exhausted unless S3 produces fresh job movement: new matches, changed matches, or clear next actions.

## THE RECOMMENDATION
**Ship Candidate A with guardrails. Confidence: medium-high.**

Use two visible numbers:
- **Level** as a knowledge/unlock gauge: “Level N · X answers to unlock your next jobs.”
- **Match %** per job card.

Keep CV quality scores internal during onboarding. Do not show “Well made: 62” or “Aimed at this job: 4/10” to first-minute users. But later, in the workbench/export moment, surface the same signal as fixable actions tied to jobs, not as grades.

The single reversal condition: **if the cheap experiment shows users read Level as personal merit, or Match % as insulting/fake noise, fall back to Candidate D: no absolute Level number, and use relative movement/actions instead.**

## THE ONE THING TO DO FIRST
Run the half-day experiment: score 20 real job ads against 3 real CVs, print 9 cards, and include internal Well-made/Aimed scores on the observer sheet. Test whether Match % is stable, whether weak-CV users get misleading signals, and whether “Level N · X answers to unlock jobs” is read as a grade.

---

## Council Composition

- Model A (Fundamentalist) โ’ Claude (opus) [high] [fallback from Fireworks (accounts/fireworks/models/glm-5p2)]
- Model B (Contrarian) โ’ Claude (opus) [high] [fallback from Fireworks (accounts/fireworks/models/deepseek-v4-pro)]
- Model C (Executor) โ’ Claude (opus) [xhigh]
- Model D (Evidence Scout) โ’ Claude (opus) [high] [fallback from Fireworks (accounts/fireworks/models/qwen3p7-plus)]
- Model E (Expansionist) โ’ Claude (opus) [high] [fallback from Fireworks (accounts/fireworks/models/kimi-k2p7-code)]
- Chairman -> Codex (gpt-5.5) [xhigh]