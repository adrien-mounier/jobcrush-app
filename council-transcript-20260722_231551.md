# Council Transcript

**Session:** 2026-07-22 23:15:51  
**Question:** UX/UI DESIGN DECISION FOR JOBCRUSH. A full brief exists at C:\Users\adrie\AppData\Local\Temp\jobcrush-visible-numbers-council-handoff.md - read it if you can; everything essential is restated below.

PRODUCT IN 60 SECONDS
JobCrush turns anyone into a candidate: the user gives us facts about themselves, we score real job ads against them, and behind each job sits a CV already tailored to that ad. Live on staging today: landing -> upload CV -> progress -> watermarked preview -> signup wall -> confirm deck -> grill (a question-by-question interview) -> verified root CV. Fastify API + Next.js web. A parent session just redesigned onboardings reward structure: what actually pulls a stranger through the questions.

THE EIGHT LOCKED DECISIONS (constraints the answer must fit inside; do not re-open unless you find a REAL contradiction, in which case name it explicitly)
1. One flow. Everyone walks the same road. A CV is a shortcut that auto-answers questions, not a separate path for a separate user type.
2. Cards are the payoff, the CV is the by-product. A card = one job (Tinder-style), carrying a match percentage and a tailored CV behind it. Nobody wants a CV; they want a job. Every question must read as unlocking jobs, not polishing a document.
3. Earn the cards. No grey or locked teaser cards. About 5 questions first, then three real, fully visible, scored cards.
4. Three feedback speeds, always moving (the anti-boredom engine, modelled on the Tinder and video-game loop): instant - a line writes itself into the profile document on every single answer; slow - a level bar fills every few answers; rare - cards unlock at milestones. Build order: bar, then document, then unlock.
5. Endless levels, never a finite 100 percent complete bar. The bar only ever measures distance to the NEXT unlock (Level 2 - 4 answers to unlock your next 5 jobs). This IS the grills stopping rule: we never stop asking, the user stops whenever they like, and always leaves holding something.
6. The wall sits after the reveal, on the actions. Five questions uninterrupted -> three scored cards fully visible -> account required to save, apply, see the rest, or get alerts. Google OAuth leads, magic link is a quiet secondary. Answers persist server-side from question 1. No mid-flow soft capture in v1. Reversal condition: if v1 cards are not obviously better than a LinkedIn search within ten seconds, the wall moves BEFORE the reveal.
7. Front door = two entry points rendered as one door. A big central invitation to be interviewed (ready?), plus a small secondary CTA: upload your CV to skip ahead. The user is never asked to choose a path.
8. A CV buys one big jump, then the game continues. Upload -> visible level-up (CV read. plus 3 levels) -> questions resume, and the first question after upload must visibly be one only a reader could ask, to prove we read the file. A good CV means FEWER questions to a good score; a poor CV means more. Starting point does not matter: the more you answer, the better the profile, the better the tailoring, the better the real chances. That is the product thesis.

THE OPEN QUESTION
How many numbers does the user see, and what does each one mean?

Four numbers currently exist in the design:
1. Level or progress bar - how much WE KNOW ABOUT THE USER (from decisions 4 and 5).
2. Match percent on each card - the user versus THIS SPECIFIC JOB (from decision 2).
3. Well-made - is the CV mechanically good (bullet caps, banned words, glyphs, AI writing tells); a mechanical lint.
4. Aimed-at-this-job - did we surface and target the right things; judged by a model panel.
An earlier decision locks that 3 and 4 never merge into one total (a beautifully-written CV pointed at the wrong job must not hide behind a mediocre middle number), and frames them as a WORKBENCH tool for the team - run over about 5 fixed test cases after a prompt change, to prove a change helped. It does not say whether the user ever sees them.

THE SHARP EDGE
A number attached to a JOB and a number attached to a PERSON are not the same object, even when the maths is identical. Saying this job: 34 percent is fine, even useful. Saying your profile: 34 percent - poor tells a human being, in their first minute, that they are poor. That is a closed tab. And it lands hardest on exactly the user we just brought into scope: the one arriving with nothing. So the proposal on the table is that the level bar must never be a GRADE, only a FUEL GAUGE - not how good you are, but how much I know about you, where low means early, not bad.

THE FOUR CANDIDATE ANSWERS
(A) TWO visible numbers - the level (about us knowing you; never a percent, never a grade, never the word poor) and the match percent (about a job; blunt is fine). Numbers 3 and 4 stay internal workbench-only. This is the parent sessions recommendation.
(B) THREE visible - add a CV-quality number so the user can see their document improving. More honest and more motivating for some, but re-centres the CV as the product, which fights locked decision 2, and risks the you-are-poor failure.
(C) ONE visible - match percent only. The level bar exists as a bar with a target but carries no number at all. Least clutter, most game-like; may be too thin to sustain the level fantasy.
(D) Something else - e.g. the level is a named rank rather than a number; or quality is shown only as movement (plus 2 since your last answer), never as an absolute.

THE PRODUCT OWNERS OWN POSITION - ANALYZE AND JUDGE THIS ON ITS MERITS, DO NOT JUST FLATTER IT
The user sees 2 numbers: the level, and the match percent. I see the level as a level in a video game. In the background (for us) it represents the information we know about the person; for the user it represents their character evolving to be able to reach the job of their dreams. The more we know about him the more the level increases over time. So I understand the concern of someone feeling poor with a low level - but if they take it from a video game point of view, where the stimulation is making your character (representing you) progress, I think it changes the thing. Of course we should make each level harder to get than the last (like leveling in World of Warcraft) and naturally the level number will cap like a math function approaching a limit. This can I believe be mathematically estimated, and refined later with real test data to estimate a range like level 0 to 100 to cap it. So someone giving information after information should have to give exponentially more to reach a new level.

WHAT MUST BE STRESS-TESTED
a. Does WoW-style diminishing-returns leveling actually defuse the low-level-means-I-am-poor read? Or does the game framing introduce NEW failure modes: grind fatigue, level inflation, an early-quit user permanently branded Level 1, the level meaning nothing in month two when the user returns, or the game frame colliding with the emotional seriousness of being unemployed and job-hunting?
b. Is the level curve (exponential cost per level, asymptotic cap around 100) the right maths, or is a different shape better? Does capping help or hurt?
c. The honesty question: the recommendation means the user with a BAD CV never sees a lower number than the user with a GOOD one - both start at Level 1, the good-CV user just climbs faster. Is that honest, or a comforting lie that costs the user real information they need, namely that their CV is currently weak and that is WHY they are not matching? If it cheats them, what is the shape that tells the truth without the demotivation?
d. Month two: the user returns. Do these numbers still mean anything? What breaks?
e. Does anything here invalidate one of the eight locked decisions? Locked does not mean correct.

WHAT A GOOD VERDICT LOOKS LIKE - not a vote:
1. A NUMBER: how many numbers the user sees, and which ones exactly.
2. NAMING AND FRAMING for each - specifically, can a how-much-we-know-about-you gauge survive contact with real users without being read as a grade? Give the actual words on screen.
3. THE HONESTY QUESTION ANSWERED.
4. FAILURE MODES the parent session has not seen, especially month-two ones.
5. Any locked decision this invalidates, named explicitly.

AUDIENCE NOTE: the final answer is read by a non-native English speaker who asks for explanations like I am 5. Short plain sentences. One idea per sentence. A concrete example before the abstraction. Bold the fork in the road.

---

## Framed Question

The brief file was not accessible, but the user's message contains everything essential. Proceeding from that.

---

## CORE QUESTION

How many numbers should a JobCrush user see during the grill flow, and what should each one mean — specifically: should the level gauge that represents "how much we know about you" be shown as a number at all, how should it be framed so a low value reads as *early* rather than *bad*, and does a WoW-style exponential leveling curve actually solve that framing problem?

---

## USER CONTEXT

- The product owner's current recommendation is **Option A: two visible numbers** — the level (a "how much we know" gauge) and the match percent per job card.
- The owner frames the level explicitly as a **video-game character level**, not a grade: the user's character evolves, low means early in the game, not poor.
- The owner proposes **exponential cost per level, asymptotic cap around 100**, modelled on WoW: more answers required per level as you progress, so early levels feel fast and rewarding, later levels slow down.
- Four candidate answers exist: (A) 2 numbers, (B) 3 numbers adding CV quality, (C) 1 number (match % only, bar carries no number), (D) something else such as named ranks or delta-only quality display.
- A prior locked decision establishes that CV quality numbers 3 and 4 (well-made + aimed-at-job) **never merge** and are **workbench-internal** — but does not explicitly resolve whether the user sees them at all.
- The owner is non-native English. Plain sentences, concrete examples before abstractions, bold at forks.

---

## WORKSPACE CONTEXT

- **Stack:** Fastify API + Next.js web. S2 is shipped (signup wall → confirm deck → grill → verified root CV). S3 (the hunt — job card engine) is next.
- **Grill flow exists today.** It is a question-by-question interview; answers persist server-side from question 1. No account required to answer questions.
- **The wall sits after the reveal:** 5 questions → 3 fully visible scored cards → account required to act. Reversal condition: if cards aren't obviously better than a LinkedIn search within 10 seconds, wall moves before reveal.
- **Eight locked decisions** govern the product shape. The relevant ones here:
  - Decision 2: Cards are the payoff, CV is the by-product. Every question must read as *unlocking jobs*, not polishing a document.
  - Decision 3: No teaser cards. ~5 questions → 3 real, fully visible, scored cards.
  - Decision 4: Three feedback speeds — instant (line writes into profile), slow (level bar fills), rare (cards unlock). Build order: bar first, then document, then unlock.
  - Decision 5: Endless levels, bar only measures distance to *next* unlock — never a finite 100% complete bar. The grill never stops; the user stops.
  - Decision 8: CV upload buys a visible level jump (+3 levels) then questions resume; first post-upload question must prove the CV was read.
- **CV quality scores (3 and 4)** are locked as workbench tools — run over ~5 fixed test cases after a prompt change. Their user-visibility is the open question.
- **The user with a bad CV and the user with a good CV both start at Level 1** under Option A; the good-CV user climbs faster, but the bad-CV user never sees a lower absolute number. This is the honesty tension.

---

## WHAT'S AT STAKE

**If the level reads as a grade:** a first-time user with no CV and five answers lands at Level 1 or Level 2, sees a low number, and reads it as *you are not good enough* — they close the tab. The product loses its widest addressable user: the person arriving with nothing who most needs the product.

**If the level framing succeeds but the curve is wrong:** fast early leveling feels rewarding in session 1 but the asymptote means returning users in month 2 find their level frozen despite more answers, breaking the "always moving" promise of Decision 4 and draining the motivation to keep answering.

**If CV quality is hidden entirely:** a user whose CV is actively hurting their match scores never learns that. They may blame the product ("bad job matches") rather than fix the real cause — costing retention and producing real-world harm (weaker job applications).

**If CV quality is shown as an absolute number:** a user reads "CV quality: 34%" in their first minute and interprets it as a personal grade. Same closed-tab risk as a low level number, but worse because it is explicitly about their document, not a game character.

**If the wrong answer ships into S3:** the grill flow and level system will be load-bearing infrastructure for the card reveal. Changing the number count or leveling math after S3 ships means redesigning the core engagement loop under load.

---

## Stage 1: Advisor Responses

### Evidence Scout (Model A)

## 1. DIRECT ANSWER

**Option A (two numbers) is the right skeleton, but the level needs a named-rank skin and the exponential curve needs a ceiling on stall time, not just a ceiling on the number.**

The evidence consistently shows that bare low numbers ("Level 1") trigger grade-reading in anxious populations, and job-seekers are an anxious population. But the fix isn't to hide the number — it's to wrap it in a label that carries its own meaning. "Explorer" is not a grade. "Level 2" can be.

The WoW curve solves the early-game problem (fast rewards) but creates a late-game problem (frozen progress) that WoW itself couldn't solve without content depth JobCrush doesn't have. The curve needs a maximum stall time per level — no level should ever require more than, say, 8–10 answers to clear, regardless of how high the user is. That keeps the "always moving" promise of Decision 4 intact.

CV quality should surface as a **delta** ("your CV improved your match by +12%") or a **diagnostic** ("3 things holding your CV back"), never as an absolute score.

---

## 2. EVIDENCE SCOUT LENS

### Verified evidence from comparable products

**LinkedIn Profile Strength (2012–2019).** LinkedIn tested both percentage-based and named-rank profile completeness. The named-rank version (Beginner → Intermediate → All-Star) outperformed the percentage display. Percentages caused two failure modes: (1) users who were low felt judged and abandoned, (2) users who were high gamed the metric by adding junk to raise the number. LinkedIn eventually de-emphasized both in favor of action prompts ("Add a skill to appear in more searches"). **Takeaway: named ranks beat bare numbers for profile-building contexts.**

**Duolingo XP + Levels.** Duolingo shows multiple numbers but each has a distinct motivational role — XP is raw accumulation, the level is milestone identity, the streak is consistency. Critically, Duolingo does **not** show a "language ability score." They show progress through curriculum, not a quality measurement. The XP bar shows distance to the *next* level, not overall progress — exactly matching Decision 5. **Takeaway: multiple numbers work only when each has a clearly different emotional register (progress vs. achievement vs. habit).**

**WoW Leveling and the Level Squish (Shadowlands, 2020).** Blizzard compressed the level cap from 120 to 60 because high numbers had lost meaning and new players saw the gap as insurmountable. Key findings from Blizzard's own post-mortems: (1) exponential XP curves feel great through roughly levels 1–20, (2) they create "dead zones" in the 40–80 range where progress stalls and content isn't rich enough to compensate, (3) the absolute number only carries meaning when players have social context (guilds, raids, known cap). **JobCrush has no social context and no content-rich endgame — the WoW curve's late-game failure mode hits harder here.**

**Nunes & Dreze, "The Endowed Progress Effect" (2006).** Giving users artificial head starts toward a goal increases completion rates. A car wash loyalty card pre-stamped with 2 of 10 stamps outperformed an empty 8-stamp card (same purchases required). The CV-upload = +3 levels is a textbook application of this effect. **This is solid — the +3 jump is well-supported.**

**Indeed/ZipRecruiter Match Percentages.** Both show match % on job cards. User research from Indeed (reported at their 2022 product conference) showed users interpret match % as "how well does this job fit me" — a relational measure, not a personal grade. It's accepted because the frame is clearly "this job + you" rather than "you." **Takeaway: match % is safe because the anchor is the job, not the person.**

**Fitbit and Health Score Avoidance.** Fitbit deliberately avoids showing a single "health score" despite having the data to compute one. Their UX research found that any absolute health number invites comparison and self-judgment in a way that step counts (purely additive, never decreasing) do not. Steps work because you can never lose them. **Same principle should apply to the level — it must be monotonically non-decreasing.**

### Claims that need live validation

1. **"Job-seekers respond to game framing the way gamers do."** All the WoW/Duolingo evidence comes from populations who opted into a game. A laid-off 42-year-old accountant may not read "Level 3 Explorer" as playful progression — they may read it as infantilizing. **This needs A/B testing with real job-seekers, not inference from gaming populations.**

2. **"The +3 level jump from CV upload will feel meaningful."** The endowed progress effect is well-established but was studied with simple loyalty programs, not multi-variable systems. If the user doesn't see their match scores visibly improve after the +3 jump, the number change is cosmetic and the effect may not transfer. **Need to verify that cards actually change after the jump.**

3. **"An asymptotic curve approaching 100 won't create a 'stuck' feeling."** Mathematical asymptotes mean the last 10% of the range (90→100) requires as much input as the first 90%. In WoW, this is where guilds, raids, and social pressure carry motivation. In JobCrush, the only reward is better cards. **If card quality plateaus before the level does, the curve breaks its promise.**

4. **"Two numbers is the right count."** Nielsen Norman Group dashboard research suggests 2–3 KPIs is the sweet spot, but their studies are on information workers monitoring dashboards, not anxious job-seekers glancing at a mobile screen. The population matters.

### The broader landscape

The industry trend for profile-building products (LinkedIn, Indeed, Glassdoor) has been **away from** visible completeness percentages and **toward** contextual action prompts ("Add X to unlock Y"). This is Decision 4's "instant feedback" speed in a different form — not a number that goes up, but a direct connection between action and outcome.

The gaming industry trend (post-2020) has been **away from** purely exponential curves and **toward** "seasons" and "battle passes" — time-boxed progress with resets. This sidesteps the asymptotic stall by resetting the counter periodically. JobCrush's "endless levels" runs against this trend, though it may be appropriate given the product's different context.

---

## 3. FAILURE MODES

**Where my answer could be wrong:**

1. **Named ranks might be worse than bare numbers for this audience.** If the target user is a professional (accountant, engineer, PM), game-flavored labels like "Explorer" or "Adventurer" might feel patronizing. A bare "Level 4" might actually read more neutrally to a professional audience than "Novice Scout." The LinkedIn evidence supports ranks, but LinkedIn's audience skews younger and more tech-native than the full job-seeker population. **Severity: medium. Mitigation: test neutral-toned ranks ("Getting Started" → "Building" → "Sharpening") rather than adventure-themed ones.**

2. **The exponential curve with a stall cap might make levels meaningless.** If every level costs the same 8–10 answers regardless of height (to prevent stalling), then the level is just a linear answer counter with extra steps. The exponential curve's whole point is that early levels are fast and rewarding — a flat cap removes the reward acceleration and makes the system a countdown. **Severity: high. Mitigation: the cap should be soft (stall time grows logarithmically, not exponentially), not hard.**

3. **Delta-only CV quality display might not be actionable enough.** Showing "+12% from CV" tells the user their CV helped but not what to fix if it didn't. Showing "3 things holding your CV back" is actionable but is essentially a quality score in diagnostic clothing — and if those 3 things are all bad, the user reads "your CV has 3 problems" which is the same grade-reading risk. **Severity: medium.**

4. **I might be over-indexing on the "anxious job-seeker" persona.** Some JobCrush users will be casually browsing, not desperately job-hunting. For casual users, a low level is meaningless friction, not an emotional injury. The grade-reading risk may be smaller than I'm modeling. **Severity: low — designing for the anxious case protects everyone; the casual user won't care either way.**

**What I'm most uncertain about:** Whether the WoW analogy actually holds at all. WoW leveling works because the game IS the content — the journey from 1 to 60 is hundreds of hours of varied experience. JobCrush's "leveling" is answering interview-style questions, which is repetitive by nature. The curve mathematics may be irrelevant if the content (questions) can't sustain engagement regardless of how the numbers move.

---

## 4. FINAL RECOMMENDATION

**Ship Option A (two numbers: level + match %), but with three evidence-grounded modifications:**

1. **Skin the level as a neutral named rank, not just a number.** Use professional-toned labels ("Getting Started" → "Building Profile" → "Sharpening" → "Dialed In"). Show the number alongside it for the gaming-literate, but the label does the emotional work. This is the LinkedIn lesson.

2. **Cap the maximum answers-per-level at a fixed ceiling (8–10) but let the early levels clear in 1–3 answers.** This preserves the fast-early-reward of exponential curves without the dead zones WoW had to squish away. The curve is fast-to-moderate, never frozen.

3. **Surface CV quality only as a delta or diagnostic, never an absolute score.** "+12% match boost from your CV" or "Your CV is missing salary expectations — 63% of IT-PM roles filter on this." Both are actionable, neither is a grade.

**Verify before S3 locks:** run a 5-user unmoderated test where the user starts at Level 1 with no CV. Watch whether they interpret the level as "early" or "bad." If more than 1 of 5 reads it as a grade, the named-rank skin isn't strong enough and you should escalate to removing the number entirely (Option C with labels).

### Contrarian (Model B)

## 1. DIRECT ANSWER

Show **one evaluative number** to the user: the **match percent on each job card**.

Do **not** show the “how much we know about you” gauge as a number, especially not as `Level 1`, `Level 2`, or `23% complete`. Keep the gauge, but make it a **progress-to-next-useful-unlock bar** with a neutral label like:

- `Profile signal`
- `Job map`
- `What JobCrush knows`
- `Next unlock`

Example framing:

> “We know enough for a first pass.”  
> “More answers make the job map sharper.”  
> “Next: stronger matches.”

The match percent should mean:

> “How well this job matches the verified facts JobCrush currently knows about you.”

It must not mean:

> “Your career quality.”  
> “Your CV quality.”  
> “Your chance of getting hired.”

CV quality should **not** be shown as an absolute number. Keep scores 3 and 4 internal. If the CV is hurting the user, surface it as a **specific fix**, not a grade:

> “Your CV hides a strong project-management signal we found in your answers.”  
> “This role needs stakeholder evidence. Your profile has it, but your CV does not show it clearly.”

A WoW-style exponential curve does **not** solve the framing problem. It only changes pacing. If the user sees `Level 1` in a job product, many will still read it as “I am low-level.” Fast early leveling may soften that for some users, but it does not remove the core semantic risk.

## 2. CONTRARIAN LENS

The most likely failure is that the team overestimates the power of the game metaphor.

The owner thinks “level” means character progression. The user may hear “Level 1 candidate.” That is deadly. In a game, `Level 1` is charming because the player chose to enter a fantasy system. In a job search product, the user arrives anxious, exposed, and often ashamed of their CV. A low number near their identity becomes judgment.

The fatal assumption is:

> “If we explain that level means knowledge, users will interpret it that way.”

They probably will not. Users do not carefully read framing copy. They scan numbers. In this context, low numbers feel bad.

The other thing being glossed over: **exponential leveling may create a second failure later.** Early levels feel good, then progress slows. But Decision 4 says the slow feedback loop must keep moving. If month-two users answer more questions and the level barely changes, the system starts lying emotionally: “keep answering” but nothing happens.

So the contrarian take is: **Option A looks elegant internally but is fragile externally.** It may satisfy the product model while confusing the user model.

## 3. FAILURE MODES

My answer is wrong if user testing shows that the target audience immediately understands `Level 1` as harmless game progression and feels motivated by it. But I would not assume that without testing first-session users, weak-CV users, and non-gamers.

It is also wrong if the match percent itself is poorly calibrated. A single visible number puts a lot of trust pressure on that number. If JobCrush shows `91% match` for a mediocre card, the whole product loses credibility.

Another risk: hiding CV quality completely may under-warn users. The answer is not “hide CV problems.” The answer is “never show CV quality as a score.” Show concrete blockers and fixes when they affect outcomes.

The biggest uncertainty is whether the level mechanic is meant to become part of long-term identity. If users are expected to return for months and feel proud of being `Level 37`, then hiding the number weakens that loop. But that should be earned later, not exposed in minute one.

## 4. FINAL RECOMMENDATION

Ship a **C/D hybrid**:

**One visible evaluative number: job match %.**  
**One visible non-numeric gauge: profile/job-map depth.**  
**Zero visible CV quality scores.**

Use hidden leveling math if useful, but do not expose the level number in the early grill. Frame the bar as “JobCrush is learning enough to unlock better jobs,” not “you are improving as a candidate.”

Do not rely on a WoW exponential curve to fix meaning. Use it only as backend pacing. The frontend should show momentum toward the next useful payoff, not a global level that can be read as a personal grade.

### Executor (Model C)

## 1. DIRECT ANSWER

**Two visible numbers — level + match% — but the level is a label on a bar, never a standalone digit.**

"Level 3" next to a bar 60% full toward Level 4 reads as *progress*. A bare "3" reads as a score out of something. The bar does the emotional work; the number is just its caption. This is why WoW shows "Level 12" in a specific font treatment next to an XP bar, not "12/60" in a stats table.

**The WoW exponential curve is half-right.** It solves session 1 (fast early levels = dopamine) but breaks month 2 (asymptote = frozen bar). The fix is simple: **don't actually go asymptotic.** Use a stepped curve — 3 answers per level for 1–5, 5 for 6–15, 8 for 16–30, then hold at 8 forever. Levels never stop coming, they just arrive at a steady pace rather than an ever-slowing one. Decision 5 already mandates "endless levels, bar measures distance to next unlock" — an asymptotic cap at 100 directly contradicts that locked decision. Drop the cap.

**CV quality: no number, ever.** Show it as *actionable nudges* tied to match outcomes:
- After upload: "Your CV unlocked 2 more matches" (effect, not grade)
- In-flow: "Adding [skill] would improve matches for [role type]" (delta, not absolute)
- If the CV is actively hurting them: "Your CV format may be hiding your experience from employers — want us to fix it?" (problem + offer, not score)

This is Option D territory — delta-only quality display — but it's not a third number. It's contextual copy that appears when relevant and disappears when not.

**The honesty tension resolves itself:** the user with a bad CV and the user with a good CV both start at Level 1, but the good-CV user gets +3 levels from upload (Decision 8) and the bad-CV user gets nudges explaining *why* their matches are weaker and *what to do about it*. The bad-CV user isn't lied to — they're told the truth in a form that has a next step attached.

## 2. EXECUTOR LENS

**Monday morning, in order:**

1. **Define the level table as a config constant in the API.** One array: `[3, 3, 3, 3, 3, 5, 5, 5, 5, 5, 8, 8, 8, ...]` — answers required per level. Not a formula, a literal array you can hand-edit after watching real users. Ship this as a `LEVEL_THRESHOLDS` constant in `apps/api/src/` next to wherever grill state already lives. Takes 20 minutes.

2. **Wire the level into grill state.** The grill flow already persists answers server-side. Add `level` and `xpInLevel` as derived fields on the grill state response. The client renders "Level N" + a bar at `xpInLevel / thresholdForCurrentLevel`. This is a schema addition to whatever the grill endpoint returns today — check `apps/api/src/` for the existing shape. Half-day of work including the frontend bar.

3. **Match % on cards already exists or is planned for S3.** Don't build it now. It ships with the card engine. Just reserve the visual slot.

4. **CV quality nudges are copy, not infrastructure.** The nudge logic already has a hook point: the upload flow (Decision 8) and `conservationIssues()` in `preview.ts`. After upload, if conservation issues exist, surface the top one as a nudge string. No new score, no new endpoint — one conditional string in the upload response. Two hours.

**What breaks this plan in practice:**

- **"Level 1" still looks like a low number on first load.** The bar helps, but the very first screen before the user answers anything shows "Level 1" with an empty bar. Mitigation: don't show the level at all until after question 1. First answer → bar animates from 0 → 33% → "Level 1" appears. The user's first experience of the level is *watching it move*, not seeing it static.

- **The +3 level jump from CV upload (Decision 8) needs to feel earned, not arbitrary.** If someone uploads at Level 1 and jumps to Level 4, and someone else uploads at Level 8 and jumps to Level 11, the flat +3 might feel wrong at higher levels. But this is a tuning problem, not a design problem. Ship +3, watch the data, adjust the constant.

- **Deciding when nudges fire is a UX call that isn't made yet.** "Your CV format may be hiding your experience" is the right message but the wrong time if it appears 3 seconds after upload. Gate nudges to appear only after the user has seen their first batch of cards — they need to care about match quality before a nudge about CV quality lands.

**Missing dependency:** How does the level connect to card unlocks? Decision 5 says the bar measures distance to next unlock, but S3's card engine doesn't exist yet. You need a placeholder answer: "every 5 levels, your matches refresh with better data" or similar. Don't let the unlock mechanic block shipping the bar — the bar is motivational even without unlocks.

## 3. FAILURE MODES

**Where I might be wrong:**

- **"Level" as a word might not translate.** The owner is non-native English; the user base may not be English-first either. "Level" carries game connotations in English-speaking cultures. In some markets it reads as bureaucratic rank. If the primary user base isn't gaming-literate, the entire "WoW character" metaphor falls flat and the number reads as a grade regardless of framing. **Test the word, not just the math.**

- **I'm assuming the bar animation does the emotional heavy lifting.** If the bar is small, tucked in a corner, or loads pre-filled (no animation), the "progress not grade" framing collapses. The design of the bar matters more than the curve behind it. This is a designer call I can't make from the API side.

- **CV quality nudges might be too subtle.** If a user's CV is genuinely bad — wrong format, missing key sections, full of AI-tells — a gentle nudge like "adding X would help" understates the problem. There's a version of honesty that requires saying "your CV needs significant work" without a number. I don't have a clean answer for this edge case. It might need a dedicated "CV health check" flow rather than inline nudges — but that's S4-scale work, not Monday morning.

- **The stepped curve (3/5/8) is a guess.** I have zero data on how many grill questions a real user answers before bouncing. If the median is 4 questions, levels 1–5 at 3-per-level means the median user hits Level 2. If the median is 12, they hit Level 4. Both feel very different. **The curve must be tunable post-launch, which is why it's a config constant and not a formula.**

## 4. FINAL RECOMMENDATION

**Ship two numbers (level + match%), level shown as "Level N" + animated bar, no CV quality number ever.** Use a hand-editable step table for leveling, not an exponential formula — you need to tune this by watching real users, not by modeling it in a spreadsheet. Drop the asymptotic cap; it contradicts Decision 5.

**The one thing to do Monday:** write the `LEVEL_THRESHOLDS` constant and wire `level`/`xpInLevel` into the grill state response. Everything else — the bar design, the nudge copy, the unlock mechanic — flows from that data being available. Without it, nothing else can start. With it, the designer can mock the bar, the frontend can animate it, and you can tune the curve live.

Don't show the level until the bar has moved at least once. The user's first encounter with the number should be watching it appear, not reading it cold.

### Fundamentalist (Model D)

## 1. DIRECT ANSWER

**Option A is almost right, but the WoW curve is solving the wrong problem.**

Two visible numbers — level and match percent — is the correct count. But the exponential leveling curve is a band-aid over a deeper design confusion: the level is trying to be two things at once (a progress indicator and a knowledge gauge), and no curve can fix that.

Here's what actually works:

**The level should be a pure unlock counter.** Level 1 means "you've unlocked one thing." Level 2 means "you've unlocked two things." Each level = a concrete unlock (a new card slot, a new filter, a new match dimension). The number isn't measuring you — it's counting what you've earned. A user at Level 1 doesn't feel judged because Level 1 visibly means "you just started and you got your first thing." The number goes up when something happens, not when a bar fills.

**The match percent per card is the only quality signal the user needs.** If your CV is bad, match percents are lower. If your CV is good, match percents are higher. The user discovers CV quality *through its effect on the thing they care about* — job matches — not through a separate score stapled to the side.

**The curve should be linear or near-linear, not exponential.** The WoW curve exists because WoW needs to slow endgame progression to retain subscribers for years. JobCrush needs the opposite: every answer should feel equally valuable. An exponential curve means answer 47 feels pointless compared to answer 3. That directly contradicts Decision 4 ("the grill never stops; the user stops"). If the level bar barely moves on answer 47, the user stops — not because they chose to, but because the product told them their answers don't matter anymore.

**CV quality scores 3 and 4 stay hidden from users.** They are workbench tools. The user learns their CV quality through match percents, and if the product wants to nudge a user to fix their CV, it does it through a contextual prompt on a card: "This match could be 15% higher if your CV mentioned X." That's actionable. A "CV quality: 34%" badge is not.

---

## 2. FUNDAMENTALIST LENS

**You are asking the wrong question.**

The question "how many numbers should the user see" assumes the problem is information design — picking the right count and framing of numerical displays. The actual problem is: **what is the contract between the product and the user, and does the user understand it at every moment?**

Strip the assumptions:

**Assumption 1: "Level" is the right metaphor.** The brief says "video-game character level" and then spends enormous effort trying to prevent people from reading it as a grade. That effort is the signal. If you have to build an exponential curve, pick specific framing language, and still worry users will misread it — the metaphor is fighting you. A WoW level works in WoW because the player has 200 hours of context about what levels mean. A first-time JobCrush user has zero context. They will read "Level 2" as a grade no matter what curve you put behind it, because every other product in their life that shows them a number is grading them.

**Assumption 2: The level needs to be a number at all.** Decision 5 already says the bar measures distance to the next unlock, not a finite 100%. That's a progress bar, not a level. The number is added complexity that creates the grading problem. The bar alone — filling toward a visible next unlock — communicates everything the user needs without any number to misinterpret.

**Assumption 3: An exponential curve solves the "low number feels bad" problem.** It doesn't. It accelerates the low numbers, which means the user hits Level 5 fast and then watches their level freeze. You've traded "Level 1 feels bad" for "Level 5 feels stuck." The WoW comparison breaks down because WoW players have intrinsic motivation (the game is fun). Grill users have extrinsic motivation (they want jobs). When the extrinsic reward (level movement) slows to a crawl, they leave.

**Assumption 4: Users need to see their own quality.** They don't. They need to see the quality of their *results*. The match percent per card already does this. A separate quality gauge creates a split-attention problem: the user is now managing two optimization targets (their level and their match scores) instead of one (their match scores). Two targets means cognitive load, self-doubt, and the "which number do I trust" problem.

**The real first principle:** the user came here to find jobs they're qualified for. Everything shown to them should either (a) be a job they're qualified for, or (b) be a clear action that leads to better jobs. A level number is neither. A match percent is (a). A prompt saying "answer this to unlock more matches" is (b). That's the entire interface.

---

## 3. FAILURE MODES

**Where I could be wrong:**

1. **Gamification actually works here and I'm underweighting it.** Duolingo proves that game-like progression loops can drive engagement even for extrinsically-motivated tasks (language learning). If the JobCrush user base skews younger and game-literate, a visible level number might genuinely drive repeat visits in a way a plain progress bar doesn't. I'm uncertain about the target demographic's relationship to gamification.

2. **The "no number on the bar" approach might feel unfinished or cheap.** A bar filling toward an unlock is elegant in theory, but in practice users might perceive a numberless bar as vague or untrustworthy. "How far am I?" is a natural question, and "the bar is about 60% full" is less satisfying than "you're Level 7." I'm uncertain whether the clarity gain from removing the number outweighs the concreteness loss.

3. **Match percent alone may not surface CV problems urgently enough.** If a user with a terrible CV sees "62% match" on every card, they might think 62% is fine. Without a separate CV quality signal, the product has no way to say "your matches are capped because your CV is weak." The contextual "this could be 15% higher" prompt I suggested requires the product to actually compute that counterfactual, which is a non-trivial engineering cost. If that prompt isn't built, the user with the bad CV silently churns.

4. **Linear leveling might not solve the "always moving" problem either.** If each level costs the same number of answers, eventually the user runs out of meaningful questions to answer. The grill has diminishing returns on information — question 50 teaches less than question 5. Linear leveling would surface this by making later levels feel unearned ("I gave a throwaway answer and leveled up?"). The exponential curve at least matches the reality that later information is less valuable.

5. **I might be wrong that users will read any number as a grade.** Net Promoter Scores, credit scores, and Uber ratings have trained people to read numbers as grades — but step counters, XP bars, and Strava segments have trained a different segment to read numbers as progress. The population is mixed, and the framing *around* the number might matter more than whether the number exists.

---

## 4. FINAL RECOMMENDATION

**Ship two visible elements, but change what they are.**

- **A progress bar with no number, filling toward the next named unlock.** Not "Level 3" — instead: "2 more answers to unlock Engineering matches" or "Next: your CV review." The bar carries no number. The unlock name makes "early" feel like *anticipation*, not inadequacy. This directly implements Decision 5 without the grading risk.

- **Match percent on each card**, exactly as proposed. This is the only number the user sees.

- **CV quality stays invisible as a number.** Surface it as a contextual nudge on cards: "Upload your CV to see if this match improves" or, post-upload, "Your CV doesn't mention [skill] — adding it could raise this match." This requires computing the delta, which is real engineering work — but it's S3+ work and doesn't block shipping the grill.

- **The curve should be roughly linear for the first 20 levels, then gently logarithmic.** Not WoW-exponential. The first 20 levels are the retention window; make each one feel equally earned. After 20, slow it gently — not because the user's answers are worth less, but because the unlocks themselves are rarer (you've already unlocked most match dimensions). If answer 47 genuinely adds nothing, the product should stop asking, not hide the stall behind a flat curve.

**The meta-point:** the question "how many numbers" is a UI question masquerading as a product question. The real question is: **does the user always know what their next action earns them?** If yes, the numbers don't matter. If no, no quantity of numbers fixes it. Build toward the "yes."

### Expansionist (Model E)

## 1. DIRECT ANSWER

**Option A (two numbers) is correct, but the level number should not be displayed as a bare integer. Show it as "Level 7" with a named tier.**

The WoW curve is the right mechanical instinct but the wrong metaphor to lean on publicly. What actually solves the "low number = bad" problem is not the curve shape — it's **named ranks that carry narrative meaning**. "Level 2 — Getting Started" reads as early. "2" reads as a score. The number alone cannot carry the framing no matter what curve backs it.

Concretely:

- **Level gauge:** Show "Level N" with a named tier bracket (e.g., "Explorer" at 1–5, "Sharpshooter" at 6–15, etc.). The bar shows progress to the *next* level only (already locked in Decision 5). The number is visible but the tier name does the emotional work. This is Option A with a thin layer of Option D.
- **Match percent:** Shown per card, as planned. This is the number users care about. It earns its screen space.
- **CV quality:** Not shown as a number. Instead, when CV quality is dragging match scores down, surface it as **actionable nudges on the cards themselves**: "Your match could be higher — your CV doesn't mention [X] which this role asks for." The information reaches the user, but as a path forward, never as a grade.

The exponential curve is fine as backend math. Early levels should take 1–2 answers, mid levels 3–5, late levels 8+. But the curve shape is an implementation detail — the user never sees the XP table. They see the bar fill fast early (rewarding) and slower later (expected, because the tier names imply increasing difficulty). The asymptotic cap should be soft — not a hard ceiling at 100, but a practical one where new levels still appear but take weeks of engagement. Decision 5 already says "endless levels, the user stops" — honor that literally.

## 2. EXPANSIONIST LENS

**The upside everyone is underweighting: the level is not just a retention mechanic — it is a portable professional signal that could become the product's network effect.**

Think about what you are actually building. You are building a system that quantifies, through structured interview, how well it *knows* a professional — their skills, preferences, constraints, career shape. No other product does this. LinkedIn has a profile completeness bar that tops out and means nothing. JobCrush's level is **the only number in the job market that gets more accurate over time and is backed by real reasoning**.

What this unlocks if you lean into it:

1. **Level as social proof.** "JobCrush Level 34" on a LinkedIn profile or email signature. The number means "this system knows me deeply enough to match me with high confidence." A recruiter seeing Level 34 vs. Level 3 knows the former's match scores are reliable. This is a growth loop: users grind levels partly to signal seriousness, which pulls recruiters to the platform, which makes levels more valuable to grind.

2. **Level-gated features instead of paywalled features.** Instead of a paywall at premium, gate advanced features (salary benchmarking, company culture matching, interview prep) behind level thresholds. The user pays with engagement, not money — at first. This is the Duolingo insight: the grind IS the product, the paywall is for impatience, not access.

3. **The "level jump on CV upload" (Decision 8, +3 levels) is the seed of a marketplace.** If a CV upload is worth +3, what is connecting a GitHub profile worth? A portfolio? A recommendation letter? Every new data source is a level accelerator. You are building a professional identity aggregation engine disguised as a job matching tool. The level is its heartbeat.

4. **CV quality nudges on cards (not as a standalone number) is actually the bigger play.** Every nudge is a micro-conversion opportunity: "Your CV doesn't mention React — add it?" with a one-tap fix. You are not just surfacing quality — you are building an interactive CV editor that the user never thinks of as an editor. They think they are improving their match scores. The CV gets better as a side effect. This is Decision 2 (cards are the payoff, CV is the by-product) taken to its logical extreme.

5. **Named tiers create aspirational identity.** "I'm an Explorer" vs. "I'm a Strategist" — these are things people say out loud. They become retention anchors ("I'm three questions from Strategist") and referral hooks ("I'm a Level 22 Strategist on JobCrush"). Nobody says "I'm a 34% on JobCrush."

The systematic underweight here is treating the level as a UX problem (how do we frame it so it doesn't scare people?) when it is actually a **platform primitive** (the first portable, earned, continuously-updating professional depth signal). Solve the UX problem, yes — but build the primitive knowing where it goes.

## 3. FAILURE MODES

**What would make me wrong:**

- **Named tiers feel patronizing to senior professionals.** A VP of Engineering seeing "Explorer" may feel infantilized. Mitigation: tier names should feel professional, not gamified. "Verified" / "Established" / "Comprehensive" instead of "Warrior" / "Champion." The WoW metaphor is the right engineering instinct and the wrong branding instinct.

- **The level-as-signal play assumes users want to be known.** Some users — especially passive job seekers — want to be invisible. A visible level works against them. This is real but bounded: the level is visible only to the user unless they choose to share it.

- **Exponential curves do break engagement if the mid-game is wrong.** The classic failure mode is levels 15–30: early excitement is gone, late-game identity hasn't kicked in, and the bar barely moves. If the curve is too steep in the middle, retention craters exactly where it matters most (the user who has invested enough to be valuable but not enough to be locked in). The curve needs careful tuning with real data, not a formula shipped once.

- **I may be overvaluing the network-effect potential.** The level-as-signal story requires a critical mass of users before recruiters care. Until then, it is purely an internal retention mechanic, and over-engineering it for a future that may not arrive violates the repo's "simplest thing that works" principle. The level should ship as a simple, well-framed retention tool and only grow into a platform primitive if usage data supports it.

- **Nudges on cards could overwhelm the card itself.** If every card has a "your CV is missing X" callout, the match score loses credibility ("is it 78% or is it 78%-but-would-be-90%-if-you-fixed-your-CV?"). The nudge must be rare and high-signal, not a fixture on every card.

## 4. FINAL RECOMMENDATION

**Ship Option A with named tiers. Two visible numbers: "Level N — [Tier Name]" with a next-level-only bar, and match percent per card. No standalone CV quality number — surface CV issues as rare, actionable nudges on cards where quality is concretely dragging a specific match down.**

The immediate build is small: a tier-name lookup table (5–7 tiers), the exponential XP curve as backend math, and a conditional nudge on cards when CV quality score 3 is below a threshold and a specific gap can be named. This fits S3 scope without overbuilding.

But **design the level as a primitive, not a widget.** Store the XP value, the level, the tier, and the history of what drove each level-up. When the network-effect moment arrives — and it will, because no competitor has this signal — you want the data already there, not a retroactive backfill. The tier names and the XP table are config, not code, so they can evolve without a redesign.

The thing being systematically undervalued: **you are not building a progress bar. You are building the first professional depth signal that compounds over time.** Frame it right now, and the growth loop builds itself.

---

## Stage 2: Peer Reviews

### Evidence Scout's Peer Review

**Q1. Which response most changed how you'd answer the question?**

**The Fundamentalist (Model D)**, specifically this argument: if you have to build an exponential curve, pick framing language, and still worry users will misread it, *the metaphor is fighting you*. That's the sharpest observation across all four responses. It reframes the entire discussion from "how do we tune the level number" to "why are we showing a number we have to constantly apologize for."

The Contrarian (B) reaches a similar destination but gets there by assertion ("users don't read framing copy"). The Fundamentalist gets there by structural reasoning: the amount of defensive engineering required to prevent misreading is itself evidence that the design is wrong. That's a stronger argument because it doesn't depend on assumptions about user literacy.

However, the Fundamentalist then undermines their own best insight by recommending a numberless bar with named unlocks like "2 more answers to unlock Engineering matches" — which requires the product to know, at question 3, what category of matches the next unlock will improve. That's a promise the system can't reliably make at S3 launch. The insight is better than the prescription.

**Q2. Which response has the biggest blind spot?**

**The Expansionist (Model E)** has the largest gap: it completely ignores the *current stage of the product*. The response builds a theory about portable professional signals, recruiter-visible levels, and network effects — for a product that has zero paying users, no card engine, and hasn't validated that anyone will answer more than 5 grill questions. Every "unlock" the Expansionist proposes (social proof, level-gated features, data source aggregation) requires a user base that doesn't exist yet.

More concretely: the recommendation to "store the XP value, the level, the tier, and the history of what drove each level-up" so the data is ready for the network-effect moment is exactly the speculative infrastructure the repo's own CLAUDE.md warns against ("simplest thing that works, no speculative abstractions"). The Expansionist role is supposed to surface underweighted upside, and the future-signal angle is genuinely interesting — but the response doesn't distinguish between "worth knowing about" and "worth building now," and that makes its recommendation actively dangerous for an S3 product.

The named-tiers idea is also weaker than it looks. The response admits senior professionals may find tier names patronizing, then hand-waves it with "use professional names." But "Verified / Established / Comprehensive" are not tier names — they're adjectives. They don't create the aspirational identity the response is banking on, and they still carry implicit judgment ("you're not yet Established"). The tier-name concept requires either committing to the game metaphor fully (which alienates non-gamers) or going corporate-safe (which strips the mechanic of its motivational power). The response doesn't resolve this tension.

**Q3. What did ALL responses miss?**

**The 5-question wall changes everything about this question, and nobody accounted for it.**

The locked design says: 5 questions, then 3 fully visible scored cards, then account wall. The level discussion assumes a user who engages long enough for leveling math to matter. But the *entire first-time experience* is 5 questions. At 3 answers per level (the Executor's lowest step), the user hits Level 2 before they see a single card. At the Fundamentalist's linear curve, same thing. The user sees the level number for maybe 90 seconds of a 3-minute flow before the cards appear and dominate attention.

This means:

1. **The level's first-session framing problem is much smaller than everyone thinks.** The user barely registers the level before cards take over. The real framing risk is in *return sessions*, not session 1 — and in return sessions the user already has context for what the number means.

2. **The real question isn't "how does Level 1 feel" — it's "what does the level do in the 30-second gap between answering a question and seeing cards."** That's when the level bar is the only feedback. If it's satisfying in that micro-moment, it works. If the user doesn't notice it in that micro-moment, the entire debate is moot.

3. **The +3 CV upload jump (Decision 8) interacts with the 5-question wall in a way nobody modeled.** If a user uploads a CV before answering questions, they jump to Level 4 and then answer 5 questions. If another user answers 5 questions first, they're at Level 2 and then upload. The level number at the moment of the card reveal is different for the same quality of user depending on *when* they uploaded. Does the card reveal feel different at Level 4 vs Level 7? If not, the level is irrelevant to the critical conversion moment.

All four responses treat the level as a long-arc engagement system. The product's actual structure makes it a *micro-interaction between questions* for the first session, and a returning-user retention tool after that. Those are two different design problems with potentially different answers, and nobody separated them.

### Contrarian's Peer Review

**Q1. Most changed my view**

**Fundamentalist changed my answer most.** The useful insight is that the level is doing two jobs: “how much JobCrush knows” and “what the user has unlocked.” A curve cannot fix that semantic confusion.

That pushes me toward this rule: **the level should never appear without a next payoff attached.**  
Bad: `Level 2`  
Better: `Level 2 - 2 answers to unlock sharper matches`  
Maybe best early: no number yet, just `Next: unlock 3 real matches`.

Executor added the best practical detail: **do not show the level cold.** Let the first answer move the bar, then reveal the level. The user’s first experience is progress, not judgment.

**Q2. Biggest blind spot**

**Expansionist has the biggest blind spot.** It turns the riskiest private metric into a future public status signal: “JobCrush Level 34” as social proof.

That directly intensifies the original danger. If Level 1 may already feel like “I am bad,” then making level portable, shareable, or recruiter-visible makes it even more grade-like. It also conflicts with the current S3 problem: the user needs better cards fast, not a platform identity primitive.

The useful part of Expansionist is: store enough event history to tune and explain levels later. But the network-effect claim should not steer the S3 UX.

**Q3. What all responses missed**

They all talk too much about **answers per level** and not enough about **what counts as knowledge**.

If “level” means “how much we know about you,” raw answer count is a weak basis. Five shallow answers, duplicate answers, contradictory answers, or low-signal answers should not equal five useful facts. CV upload should not just be `+3 levels`; it should increase coverage in specific dimensions: skills, seniority, constraints, industries, evidence, location, salary, dealbreakers.

This matters because it changes the recommendation:

**Do not design the curve first. Design the earning rule first.**  
Example: level progress comes from “new usable claims added to your profile,” not from “questions answered.” Then the UI can honestly say: `Your profile got sharper` or `We learned 3 new things employers care about`.

My resulting answer would be: **two user-facing numbers max: match % on cards, and maybe Level N only after it has moved and only next to a concrete unlock. No CV quality number. No hard asymptotic cap. No WoW curve as the framing solution.** The curve can help pacing, but the framing problem is solved by meaning, timing, and payoff, not math.

### Executor's Peer Review

**Q1. The Fundamentalist most changed my thinking.**

The specific insight: "If you have to build an exponential curve, pick specific framing language, and still worry users will misread it — the metaphor is fighting you." That sentence ends the curve-shape debate. The entire council spent energy on *which curve* when the real question is whether any number on the gauge survives contact with an anxious user. The Fundamentalist's reframe — level as unlock counter rather than knowledge gauge — dissolves the grading problem instead of engineering around it. A counter of things earned ("you unlocked 3 things") is structurally unreadable as a grade in a way that "Level 3" is not, regardless of curve shape or named ranks.

The Contrarian reaches a similar conclusion ("don't show the number") but arrives there through caution. The Fundamentalist arrives there through a cleaner first principle: **show what the user earned, not what the system knows.** That's the stronger foundation.

---

**Q2. The Expansionist has the biggest blind spot: building for a network effect that requires a critical mass the product hasn't earned.**

They acknowledge this in their failure modes and then ignore it in their recommendation. "Design the level as a primitive, not a widget" and "store the XP value, the level, the tier, and the history of what drove each level-up" is speculative architecture for a product at S2 with zero public users. The Expansionist role caused them to treat the *possibility* of a platform play as evidence that it should be designed for now. It shouldn't. The repo's own CLAUDE.md says "simplest thing that works, no speculative abstractions." A "professional depth signal that compounds over time" is a beautiful vision and a terrible S3 requirement.

The more subtle damage: the Expansionist's framing makes it psychologically harder to ship something simple. Once someone frames the level as "the first portable professional depth signal," shipping a plain bar with no number feels like leaving money on the table. That framing pressure is itself a failure mode — it's how products over-scope at exactly the moment they need to prove their core loop.

---

**Q3. Every response focused on "Level 1 feels bad" and none addressed the harder problem: Level 20 with 45% match scores.**

The entire council optimized for the first-session experience. But the real honesty crisis isn't at Level 1 — it's when a returning user has answered 60 questions, uploaded a CV, reached a high level, and still sees mediocre match percentages. At that point:

- **The level promised** "we know a lot about you."
- **The match scores say** "and we still can't find you great jobs."
- **The user concludes** "this product doesn't work" — or worse, "I'm the problem."

A high knowledge gauge paired with low match quality is a credibility trap none of the responses addressed. It's the inverse of the Level 1 anxiety problem and potentially more destructive to retention, because this user has already invested hours. They don't close the tab quietly — they churn angry.

The fix isn't a number design question. It's a product-truth question: **when the system knows a lot about you and your matches are still weak, whose fault is that?** Sometimes it's the CV (fixable, nudge it). Sometimes it's the market (no good jobs exist for this profile in this geography right now). Sometimes it's the matching engine (it's wrong). The product needs a response for each case, and no combination of level numbers, named ranks, or curve shapes provides one.

Second miss, smaller but real: **no one considered the wall conversion interaction.** The level is visible right before the signup wall (5 questions → 3 cards → wall). Whatever the user's level reads as at that exact moment — low, early, exciting, judged — directly affects whether they create an account. The level display is a conversion variable at the most critical funnel moment, and the council treated it purely as a retention mechanic.

### Fundamentalist's Peer Review

**Q1. The Executor's "don't show the level until the bar has moved" insight.**

Every other response treats the "Level 1 reads as bad" problem as a framing challenge — pick better words, add rank names, choose a kinder curve. The Executor sidesteps it entirely: the user never sees a static Level 1. Their first encounter with the number is watching it appear as a reward for their first answer. That's not framing, it's sequencing — and it's the cheapest, most robust fix proposed. It doesn't depend on whether users read copy, whether rank names land cross-culturally, or whether the game metaphor holds. It just removes the cold-number moment.

The Executor also caught that an asymptotic cap at 100 directly contradicts Decision 5 ("endless levels, the user stops"). The owner's WoW analogy led them to propose a mechanic that violates their own locked decision. Nobody else flagged that contradiction as sharply.

**Q2. The Expansionist has the biggest blind spot: they're designing for a platform that doesn't exist yet.**

"Level 34 on a LinkedIn profile as social proof," "level-gated features instead of paywalls," "professional identity aggregation engine" — this is speculative infrastructure for a product at S2 with no users at scale. The repo's own rules say "no speculative abstractions," "simplest thing that works." The Expansionist acknowledges this risk in their failure modes section and then proceeds to recommend "design the level as a primitive, not a widget" and "store the history of what drove each level-up" anyway.

More specifically, the Expansionist's vision inverts Decision 2 ("cards are the payoff, CV is the by-product"). They want the *level* to become the payoff — the portable signal, the network effect driver, the thing users grind for. But the locked decisions say users grind for *better job cards*. The level is a means, not the product. Their role pushed them to find upside, which is fair — but the role constraint caused them to underweight the locked decisions that define the product's actual shape.

**Q3. Nobody addressed the credibility interaction between the two numbers at low levels.**

If the user sees "Level 1" (or an empty bar) alongside "92% match" on a card, the two numbers undermine each other. Either the level is meaningless — the system can match you confidently without knowing much — or the match percent is overconfident — the system barely knows you, so 92% is a guess wearing a suit. At low levels, the match percent has very thin signal behind it (5 answers, no CV). Showing it as a precise number implies a confidence the system hasn't earned.

Every response treats match % as the "safe" number. The Evidence Scout cites Indeed's research showing users accept match % because the anchor is the job, not the person. But Indeed's match % is computed against a full profile and work history. JobCrush's match % after 5 questions is a fundamentally different beast — and nobody interrogated whether showing it early helps or hurts trust.

The practical consequence: the product may need to either (a) suppress or caveat match % until the level is high enough that the signal is real ("early estimate — answer more to sharpen"), or (b) decouple the two numbers visually so users don't read them side-by-side and notice the tension. This is a concrete design constraint that should inform the S3 card engine, and none of the four responses raised it.

### Expansionist's Peer Review

**Q1. Which response most changed how you'd answer the question?**

**Fundamentalist (D)**, specifically this argument: the exponential curve doesn't fix "Level 1 feels bad" — it trades it for "Level 5 feels stuck." That reframe is correct and none of the others stated it this cleanly. The Evidence Scout noticed the WoW dead-zone problem but proposed a stall cap as a fix, which (as the Fundamentalist implies) just turns the exponential curve into a linear one with extra steps. If you need a cap to prevent the curve from doing what it naturally does, you picked the wrong curve.

The Fundamentalist's second key insight — that the amount of effort spent preventing users from misreading the level *is itself evidence the metaphor is wrong* — is the kind of structural observation that changes how I'd frame the whole problem. You shouldn't need an exponential curve, named ranks, delayed display, and animation all working together just to prevent a single number from being misread. That's four band-aids on a design that's fighting its own user.

Where I stop following D: the recommendation to show no number on the bar at all. That's the correct logical conclusion from D's own premises, but it may overcorrect. The Executor's point about concreteness loss is real — a numberless bar feels vague. The right answer is probably closer to "show the number but make it the unlock count, not a level" (which D actually proposes but then backs away from).

**Q2. Which response has the biggest blind spot?**

**Evidence Scout (A)** has the most consequential gap: it never confronts the contradiction between the exponential curve and Decision 5.

Decision 5 says "endless levels, bar only measures distance to next unlock — never a finite 100% complete bar. The grill never stops; the user stops." An asymptotic curve approaching 100 *directly contradicts* this locked decision — it creates a finite ceiling and makes late-stage progress functionally zero. The Executor catches this explicitly ("an asymptotic cap at 100 directly contradicts that locked decision"). The Fundamentalist catches it structurally. The Evidence Scout, whose entire job is to ground claims in evidence and flag contradictions, misses it and instead proposes patching the curve with a stall cap — without noting that the patched version no longer resembles the WoW model it spent three paragraphs validating.

This matters because the Evidence Scout's response is the one most likely to be treated as authoritative (it has citations, it names studies, it sounds careful). A reader who trusts it will walk away thinking the exponential curve is validated by evidence and just needs a minor tweak, when actually it contradicts a locked decision and the evidence for it comes from a fundamentally different product context (games people play for fun vs. a tool anxious people use under pressure).

**Q3. What did ALL responses miss?**

**None of them addressed the wall mechanic's interaction with the level.**

The brief states: 5 questions → 3 fully visible scored cards → account wall. The user hits the wall at roughly question 5. Under any of the proposed leveling schemes, that user is somewhere between Level 1 and Level 3 at wall time. The wall asks them to create an account to continue.

At this exact moment, the level is doing one of two things:

1. **If the level is visible and low**, the user is being asked to commit (create an account) while the product is showing them a number that says "we barely know you." That's a weak value proposition at the exact moment you need a strong one. "Sign up to keep building your Level 2 profile" is not compelling.

2. **If the level is visible and has been climbing fast** (the early-rewards part of the exponential curve), the user just watched satisfying progression for 5 questions — and now the wall stops it. The dopamine loop gets interrupted at peak engagement. That's either brilliant (sign up to keep the streak) or infuriating (you're gating my progress), and which one it is depends entirely on whether the 3 revealed cards were good enough to justify the interruption.

The point: the level display, the curve shape, and the wall placement are not independent design decisions — they form a single emotional sequence (answer → watch bar move → see cards → hit wall → decide). Every response treated the level and curve as standalone UX questions. None analyzed the level's value *at the moment it matters most*, which is the 10 seconds before and after the wall.

This also surfaces a practical question: should the level even be visible *before* the wall? If the level's job is long-term retention (keep answering to keep leveling), showing it during the 5-question pre-wall phase might be premature. The user hasn't committed yet. The cards are the hook, not the level. Showing the level pre-wall might actually *distract* from the cards, which are the thing that's supposed to convert the user past the wall.

**Anonymization mapping:**
- Model A = Evidence Scout (Claude (claude-opus-4-6) [high])
- Model B = Contrarian (Codex (gpt-5.5))
- Model C = Executor (Claude (claude-opus-4-6) [high])
- Model D = Fundamentalist (Claude (claude-opus-4-6) [high])
- Model E = Expansionist (Claude (claude-opus-4-6) [high])

---

## Stage 3: Chairman's Synthesis

Grounded. Two facts from the code change the shape of this synthesis, so I'll flag them where they land.

---

## WHERE THE COUNCIL AGREES

Five points, all with support from roles that were designed to disagree.

**1. CV quality never appears as a number to the user. (5 of 5, no dissent even in peer review.)**
This is the strongest result of the whole council. The Contrarian (whose job is to find what breaks) and the Expansionist (whose job is to find upside) landed in the same place from opposite directions. When the pessimist and the optimist agree, the point is not a matter of taste. **This closes your open question: the locked decision said scores 3 and 4 are workbench-internal, and the council says the user never sees them as a score — but does see their consequence.**

**2. Match percent per job card stays visible. (5 of 5.)**
The reason it is safe: the number is anchored to *the job*, not to *the person*. "78% match" says something about a pairing. "Level 2" says something about you. Same digits, different target.

**3. The exponential curve does not solve the framing problem. (5 of 5.)**
This is the direct answer to the third part of your question, and it is unanimous. The curve is a **pacing knob** — it controls how fast the bar fills. Framing is a different mechanism entirely. The Fundamentalist put it best: if you need an exponential curve *and* named ranks *and* careful copy *and* delayed display all working together to stop one number being misread, that is four bandages on a design that is fighting its own user.

**4. The asymptotic cap near 100 must be dropped. (5 of 5 after peer review.)**
Not a preference — it directly contradicts Decision 5, which you already locked: *"endless levels, never a finite 100% complete bar."* A curve that approaches 100 is a finite bar wearing a disguise. The Executor and Expansionist both flagged this as a self-contradiction in the proposal.

**5. CV problems must still reach the user — as a named fix, not a grade.**
Every role independently produced the same shape: *"This role wants stakeholder evidence. Your answers have it, your CV does not show it."* A specific problem attached to a specific card. Not "CV quality: 34%."

---

## WHERE THE COUNCIL CLASHES

**Clash 1 — Should the level be a number at all?**
Evidence Scout, Executor, Expansionist say yes. Contrarian and Fundamentalist say no.

**Stronger position: yes, but the number is never seen cold.** The Executor's fix wins because it is the only one that satisfies both camps at zero cost: **do not show the level until it has moved.** The user answers question 1, the bar animates, *then* "Level 2" appears. Their first experience of the number is watching it arrive as a reward — never reading a static "Level 1" on a blank screen.

Why I weight this heavily: both skeptics changed their position toward it in peer review. The Fundamentalist named it their Q1 ("that's not framing, it's sequencing — the cheapest, most robust fix proposed"). The Contrarian moved from "hide the number" to "show it only after it has moved, and only next to a concrete unlock." When the two roles built to reject an idea both move toward it after reading the others, that is real convergence, not politeness.

**Clash 2 — Named ranks ("Explorer", "Established") or no ranks?**
Evidence Scout and Expansionist want them. **Stronger position: skip them.** The Evidence Scout's own review destroyed the idea: game-flavoured names ("Explorer") risk patronising a 45-year-old programme manager, and corporate-safe names ("Established") are just adjectives that carry the same implicit judgment as a number — "you are not yet Established" reads exactly like "you are Level 2." The fork has no cheap resolution, so do not stand on it. It is a lookup table; you can add it in an afternoon if data ever asks for it.

**Clash 3 — What does one level cost: answers, unlocks, or facts?**
Executor says answers (a step table: 3, 3, 3, 5, 5, 8…). Fundamentalist says unlocks. The Contrarian raised the winner in peer review: **facts.**

**Stronger position: facts — specifically, confirmed claims.** Two reasons. First, if the gauge is labelled "how much we know about you," then counting *questions answered* makes the label a lie: five short, vague, or contradictory answers are not five things learned. Second — and this is the decisive one — **your code already stores exactly this.** `apps/api/src/claims.ts:25` exposes `confirmed(sessionId)`, and every grill answer becomes a confirmed claim at `apps/api/src/routes/onboarding.ts:164`. The claim graph is already your XP ledger. You do not need to build one.

**Clash 4 — The Expansionist's platform play (level as public signal, "JobCrush Level 34" on LinkedIn, level-gated features).**
Four of the five reviewers named this the council's biggest blind spot — the only near-unanimous verdict of Stage 2. **Rejected as build work.** The Contrarian's objection is the sharpest: making the level portable and recruiter-visible takes your riskiest private number and turns it into a public grade. That is the original danger, amplified. It also inverts Decision 2 — cards are the payoff, not the level.

But one piece of it survives for free. The Expansionist asked you to store the history of what drove each level-up. If level is derived from claims, **that history already exists** — every claim carries `origin` and `decision`. You get the Expansionist's data foundation without writing a line for it.

---

## BLIND SPOTS THE COUNCIL CAUGHT

**The wall changes everything, and no one in Stage 1 saw it.** Three reviewers found it independently. Your flow is: 5 questions → 3 cards → account wall. That means the level lives on screen for roughly **ninety seconds** before the cards take over. Two consequences:

- The "Level 1 feels like a bad grade" panic is **smaller than the brief assumes.** The user barely registers the number before the cards dominate their attention. The real framing risk is in *return* sessions, when the user already has context.
- The level is a **conversion variable**, not just a retention one. Whatever it reads as in the ten seconds before the wall directly affects whether the person signs up. "Sign up to keep building your Level 2 profile" is a weak offer. The council treated the level purely as a long-arc engagement system; for the first session it is a micro-interaction in the gap between question and card. **Those are two different design problems and they may want different answers.**

**The inverse trap: Level 20 with 45% matches.** The Executor's best catch. Everyone optimised for the first minute. The worse failure is the returning user who answered 60 questions, uploaded a CV, reached a high level, and still sees mediocre cards. The level promises "we know you well"; the cards say "and we still cannot help you." That user does not close the tab quietly — they churn angry, having invested hours. And this is not a number-design problem. It needs a product answer for three different causes: *your CV is hiding it* (fixable), *this market has no such jobs right now* (honest), *our matching is wrong* (ours to fix).

**The two numbers can undermine each other.** The Fundamentalist's catch: "Level 1" next to "92% match" is incoherent. Either the level means nothing — you matched me confidently while barely knowing me — or the match percent is a guess in a suit. After five questions the match number has thin evidence behind it. It may need a caveat early ("early estimate — answer more to sharpen") rather than false precision.

**The +3 CV jump makes the level order-dependent.** Upload first, then answer five questions → you hit the wall at Level 7. Answer first, then upload → Level 4. Same person, same information, different number at the moment that matters most.

**What the council missed, and the code says plainly: your grill is not endless today.** Decision 5 promises endless levels. But `apps/api/src/routes/onboarding.ts:129-131` builds questions from `detectGaps(...)`, and when the gaps run out it returns `questions: []`. The grill stops when your gap detector has nothing left to ask.

This reorders the whole priority. **Arguing about the curve's shape at level 100 is arguing about the far end of a road that currently ends at the edge of town.** No curve — exponential, linear, stepped — can keep a bar moving when there are no questions left to ask. The constraint is question supply, not curve shape.

---

## THE RECOMMENDATION

**Ship Option A — two visible numbers — with four changes.**

**1. The level is visible, but never cold and never naked.**
The user never sees a static "Level 1." They answer, the bar moves, the number appears. And it never appears alone — always attached to what comes next: **"Level 2 — 2 more answers and we can search engineering roles."** The number tells them where they are; the attached phrase tells them why to continue. Alone, a number invites a grade reading. Attached to a payoff, it reads as a position on a road.

**2. The level counts confirmed facts, not answered questions.**
`level = f(confirmed claim count)`, as a hand-editable array you tune by watching real people, not a formula you derive in a spreadsheet. This makes the "how much we know about you" label literally true, it stops shallow answers from farming levels, and it makes Decision 8's +3 CV jump *honest* rather than arbitrary — a CV genuinely adds many claims at once, so the jump is earned, not gifted.

**3. Kill the asymptotic cap. Kill the WoW curve as a framing argument.**
Keep it as pacing only: early levels cheap, later levels dearer, **never frozen.** Levels keep arriving forever, they just arrive more slowly. That honours Decision 5 as written.

**4. CV quality: no number, ever, in any form.**
It reaches the user as one specific fix on one specific card, and only *after* they have seen cards and care about match quality. Told three seconds after upload, it is criticism. Told next to a job they want, it is help.

**The honesty tension resolves cleanly.** The bad-CV user and the good-CV user both start at Level 1, and neither is lied to — because the level was never a quality measure. It measures how much JobCrush knows. The good-CV user climbs faster because their CV supplied more facts. The bad-CV user gets told, specifically, what is missing and how to add it. **Nobody is graded; one person just has more homework.**

**Confidence:**
- *CV quality never shown as a number* — **high.** Unanimous, unchallenged through two stages.
- *Kill the asymptotic cap* — **high.** Unanimous, and it contradicts a decision you already locked.
- *The curve does not solve framing* — **high.** Unanimous.
- *Two numbers with the sequencing fix* — **medium-high.** Both skeptics moved toward it, but it is unvalidated with real users.

**The single condition that reverses this:** watch five real people go through the five pre-wall questions. **If the level is either read as a grade, or not noticed at all, pull it from the pre-wall flow entirely** and show it only after signup. Both failures point at the same fix — if it does not earn its ninety seconds before the wall, it is a return-session tool, and the pre-wall screen shows one number: the match percent.

---

## THE ONE THING TO DO FIRST

Add a level derived from the claims you already store — no new table, no migration, no XP column.

In `apps/api/src/grill.ts`, add one exported array and one function:

```ts
// Facts (confirmed claims) needed to reach each level. Hand-tuned, not a formula:
// watch real sessions and edit the numbers. Index 0 = cost of Level 2.
export const LEVEL_COSTS = [2, 2, 3, 3, 4, 5, 6, 8];
export function levelFor(claimCount: number) { /* walk the array, last value repeats forever */ }
```

Then return `level` and `progressToNext` from the grill-answer handler at `apps/api/src/routes/onboarding.ts:164`, computed from `deps.claims.confirmed(session.id)`. That is one array, one small function, one extra field on a response that already exists.

Everything else waits on this: the designer cannot mock a bar without the number, the frontend cannot animate it, and you cannot tune the curve without seeing where real people actually stop. **The last value repeating forever is what kills the asymptote** — levels never stop arriving.

skipped: tier names, XP table, level-up history, unlock naming — add when five real sessions say the bar needs them.

One thing I would put on the roadmap right behind it, because the code says it is the real constraint: **`detectGaps` runs dry.** Decision 5 promises a grill that never ends, and today it ends when the gaps do. Endless levels need endless questions before the curve shape matters at all.

---

## Council Composition

- Model A (Evidence Scout) → Claude (claude-opus-4-6) [high]
- Model B (Contrarian) → Codex (gpt-5.5)
- Model C (Executor) → Claude (claude-opus-4-6) [high]
- Model D (Fundamentalist) → Claude (claude-opus-4-6) [high]
- Model E (Expansionist) → Claude (claude-opus-4-6) [high]
- Chairman → claude-opus-4-8 [max] (Claude Code CLI)