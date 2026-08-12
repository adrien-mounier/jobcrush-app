# Council Transcript

**Session:** 2026-07-22 23:31:41  
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

The brief file was not accessible, but all essential content was restated in the message. Framing from what was provided:

---

## CORE QUESTION

How many numbers should a JobCrush user see during the onboarding flow, and what does each one mean — specifically, can a "how much we know about you" level gauge survive contact with real users without being read as a grade, and does the WoW-style diminishing-returns leveling curve proposed by the product owner actually solve that problem or introduce new ones?

---

## USER CONTEXT

- **Eight locked decisions** govern the flow; the council must not re-open them unless it finds a real contradiction, and must name it explicitly if it does.
- **Four numbers exist in the current design:** (1) level/progress bar — how much the system knows about the user; (2) match percent per job card — user vs. this specific job; (3) well-made score — mechanical CV lint; (4) aimed-at-this-job score — model-panel judgment of targeting quality.
- **One prior lock:** numbers 3 and 4 never merge into a single total. They are framed as an internal workbench tool for the team, run over ~5 fixed test cases after a prompt change. Whether the user ever sees them is explicitly open.
- **Four candidate answers on the table:** (A) two numbers visible — level + match percent; (B) three visible — add CV-quality number; (C) one visible — match percent only, level bar carries no number; (D) something else — e.g. named rank instead of number, or quality shown only as movement/delta.
- **Product owner's position (to be judged on its merits):** show two numbers. The level is a video-game character level, not a grade. The stimulation is watching your character grow. Leveling should use WoW-style exponential cost per level, asymptotically capping around 100, so that early levels come fast and later levels require exponentially more answers. The framing shift from "how good am I" to "my character is evolving" is claimed to neutralize the low-level-equals-poor-candidate read.
- **The sharp edge:** a number attached to a job ("this job: 34%") reads differently from a number attached to a person ("your profile: 34% — poor"). The concern is hardest on users arriving with nothing — the exact users the product has just brought into scope.
- **Audience note:** final answer read by a non-native English speaker who asks for explanations simply. Short plain sentences, one idea per sentence, concrete example before abstraction, bold the fork in the road.

---

## WORKSPACE CONTEXT

- **Stack:** Fastify API + Next.js web. S2 ("own your facts") is complete: signup wall → confirm deck → grill → audited root CV → claim graph v1 in Postgres. S3 ("the hunt") is next — E5 cluster engine first.
- **The grill** is the question-by-question interview that builds the user's profile. It is already live. The level bar and unlock mechanic are being designed now, before S3 ships.
- **Decision 4 (three feedback speeds):** instant — a line writes itself into the profile document on every answer; slow — a level bar fills every few answers; rare — cards unlock at milestones. Build order: bar first, then document, then unlock.
- **Decision 5 (endless levels):** the bar measures only distance to the next unlock, never total completeness. The grill has no stopping rule; the user stops when they want and always leaves holding something real.
- **Decision 3 (earn the cards):** ~5 questions first, then three real, fully visible, scored cards. No grey or locked teaser cards.
- **Decision 2 (cards are the payoff):** every question must read as unlocking jobs, not polishing a document. The CV is a by-product.
- **CV quality workbench (docs/cv-quality-kickoff.md):** quality is defined as fit to the job. Scores 3 and 4 were explicitly framed as a team measurement tool, not a user-facing element, to avoid the "well-made but wrong target" score masking as a middling combined number.
- **User population now in scope:** everyone, including people arriving with no CV at all (decision 1: one flow, CV is a shortcut that auto-answers, not a separate path).

---

## WHAT'S AT STAKE

- **Opening-minute drop-off.** If the level is read as "how good a candidate you are" rather than "how much we know about you," users with thin profiles — exactly the users the product most needs to win — close the tab in the first minute. A level of 3 or 4 landing as "you are a poor candidate" is a conversion killer before the product has delivered anything.
- **The grind trap.** If WoW-style exponential leveling is adopted, early levels must arrive fast enough to feel rewarding. If the curve is wrong, users stall mid-flow, experience grind fatigue, and quit before reaching the card reveal. The level must always feel close, per decision 5.
- **The honesty cost of comfort.** Option A (two numbers, level framed as knowledge gauge) means a user with a structurally weak CV and a user with a strong one both start at Level 1 and both see the same match percentages at the same level. The strong-CV user climbs faster, but the weak-CV user never receives a direct signal that their document is the bottleneck. If the match percents are low and the user does not know why, they may churn blaming the product rather than understanding the gap — or, worse, walk into real applications with false confidence.
- **Month-two retention.** If a returning user's level number has no stable meaning — because the curve shifts, because the cap was recalibrated, or because the level simply stopped growing without explanation — the number becomes noise. A number that meant something in week one must mean the same thing in month two, or retention breaks.
- **Internal alignment.** Numbers 3 and 4 (well-made, aimed-at-this-job) are live in the system and will be used by the team. Any design that leaks them into the user-facing surface — even partially, even as deltas — must be intentional, because they carry the exact "you are poor" failure mode the question is trying to avoid.
- **Locked-decision coherence.** Any answer that re-centres the CV as the thing the user is improving (rather than the job cards as the payoff) is in tension with decision 2. Option B (add a CV-quality number) is the obvious candidate for this tension, but option D (show quality as movement/delta) may carry the same risk in a softer form.

---

## Stage 1: Advisor Responses

### Executor (Model A)

## 1. DIRECT ANSWER

**The level number will be read as a grade. The WoW framing does not fix this. Do not ship a level number.**

Here is the core problem. In a video game, your character is not you. If your character is Level 3, you do not feel like a bad person. You feel like a beginner. But in a job application tool, the character IS you. There is no separation. A user who arrives with nothing and sees "Level 3" next to their name does not think "my character is evolving." They think "I am a Level 3 candidate. That is low. I am bad."

The product owner's claim is: if we frame it as a character level, people will read it as growth, not judgment. This is a guess with no evidence behind it. Every instinct we have about how people read numbers attached to themselves says the opposite. A number attached to a person is a score. Framing does not override that.

**The WoW curve makes the problem worse, not better.** Here is why. The curve makes early levels come fast. This feels rewarding. But the reward (your level goes up) is disconnected from the payoff (you see good job matches). A user can grind to Level 20 and still see 30% match on every card because their actual profile is weak. Now the level is a lie. It says "you are progressing" while the matches say "you are not." That is worse than having no level at all.

**There is also a direct contradiction with a locked decision.** Decision 5 says "endless levels." The bar measures distance to the next unlock, with no stopping rule. But the WoW curve asymptotically caps at ~100. A number that approaches 100 but never reaches it is not endless. It is a bounded scale that slows to a crawl. A user at Level 97 who needs 500 answers for Level 98 has effectively stopped leveling. That is the grind trap the question itself warns about. I name this explicitly: **the PO's proposed asymptotic cap at 100 contradicts Decision 5's "endless levels."**

**My answer: Option C, modified.** Show one number to the user: match percent on the job card. Keep the level bar as a visual element — a filling bar with no number on it. The bar fills as you answer questions. When it fills, new cards appear. That is the whole feedback loop. No level number. No WoW curve. No CV-quality score visible to the user.

The bar without a number still communicates progress. It fills. It moves. Cards appear. That is stimulation without judgment. A filling bar says "keep going, you are getting somewhere." A number says "you are at 3 out of 100." Those are different messages.

**What about the honesty problem?** Option A has a real cost: a user with a weak profile and a user with a strong one both start at the same place, and the weak one never gets a direct signal that their CV is the bottleneck. This is real. But the fix is not to show CV quality as a number. That is the exact "you are poor" failure mode we are trying to avoid. The fix is a text nudge when match percents are consistently low across all cards. Something like: "Your matches are lower than they could be. The most common fix is adding more detail about what you actually did in your recent roles. Answer three more questions to see better matches." This points at the bottleneck without scoring the person. It is framed as unlocking better jobs, which is consistent with Decision 2.

## 2. EXECUTOR LENS

**Monday morning, 9 AM. Write a one-page spec. Title it: "Level Bar — No Number."**

The spec says four things:

1. The bar is a visual fill element. No numeric label. It fills based on questions answered since the last card unlock, divided by questions needed for the next unlock.
2. The fill animates on each answer. The animation is the stimulation. The bar moving is the reward.
3. When the bar fills, three job cards appear with match percents. The match percent is the only number the user sees.
4. The WoW curve is rejected. Two reasons are written down: (a) a level number attached to a person will be read as a grade regardless of framing; (b) the asymptotic cap at 100 contradicts Decision 5's "endless levels."

**That spec is the first step. It takes one hour. It unblocks the team.**

The full implementation sequence:

1. **Bar component (no number).** Build in Next.js. Fills on answer. Animates. Ships into the grill flow immediately. This is independent of S3. **This is the first thing to build.**
2. **Drop-off instrumentation.** Before any user touches the flow, add tracking at every question and at the card reveal. The key metric: what percent of no-CV users complete five questions and reach the card reveal. This must be in place before the first user sees the bar.
3. **E5 cluster engine.** S3's first build item. The match percent depends on it. Start this in parallel with the bar component.
4. **Match percent on cards.** Depends on the cluster engine. This is the single user-facing number. It attaches to the job card, not to the person.
5. **Low-match nudge.** After the first three cards are revealed, if all match percents are below a threshold (say 50%), show a text nudge pointing the user toward more detail. No number. No score. Just a direction.

**Where this plan breaks down in practice:**

The match percent is the real sharp edge, not the level bar. "This job: 34%" is attached to the card, not the person. But a user who sees 34% on every card still reads it as "I am a 34% candidate." The framing does not fully protect against this. The only real protection is making sure the first cards the user sees are not all bad matches.

This means the cluster engine has a hard job: after only five questions from a user with no CV, it must produce at least one card with a decent match percent. If it cannot, the match percent becomes the grade we were trying to avoid. **This is the dependency I cannot resolve from the design alone. It is an engineering question: can the E5 cluster engine produce a reasonable match from five answers of sparse profile data?**

If the answer is no, the fallback is: do not show a match percent number on the first three cards. Show a category label instead — "strong match," "possible match," "stretch." This is Option D applied to the match percent, not the level. It is a named rank, not a number. It is less precise but it is safer. The number can appear later, once the profile has enough signal to produce match percents that do not read as a personal grade.

**What is missing or unresolved right now:**

- The "questions needed for next unlock" count after the first unlock. Decision 3 says ~5 questions first, then cards. But how many for the second unlock? The tenth? This needs a rule. My suggestion: keep it constant at 5, not exponential. Five questions, three cards. Five more, three more cards. Simple, predictable, no curve to tune.
- Whether the cluster engine can produce decent matches from five sparse answers. This is the biggest unknown. It determines whether the match percent is safe to show on the first card reveal.
- The low-match threshold for the text nudge. What number triggers it? This needs to be set after seeing real data, not before.

## 3. FAILURE MODES

**What would make my direct answer wrong:**

The bar without a number may not provide enough stimulation. The product owner's instinct that users need a reward signal is correct. A filling bar with no number might feel too passive. If the drop-off data shows that no-CV users are quitting at question 3 or 4 — before the bar fills and before cards appear — then the bar is not enough, and we need to reconsider.

If that happens, the fix is not to add a level number. The fix is to make the bar more alive. Show a label on the bar: "3 more answers until your first job cards." This is a countdown, not a score. It says how far you are from the payoff, not how good you are. It is directional, not evaluative.

**The match percent may be read as a grade no matter where we attach it.** I am betting that a number on a job card reads differently from a number on a person. But I am not certain. If users who see three cards at 30-40% match drop off at the same rate as users who would have seen "Level 3," then the location of the number does not matter. The number itself is the problem. In that case, the answer shifts to Option D: named ranks on cards, no percents, at least for the first reveal. "Strong match / possible match / stretch" instead of "72% / 41% / 28%."

**I am most uncertain about the stimulation question.** The PO is right that users need to feel something happening. I am removing the level number, which is the PO's proposed stimulation mechanism. I am replacing it with a filling bar and card reveals. I believe this is enough. But I do not have data to prove it. The instrumentation in step 2 is not optional — it is the only way to know if the bet paid off.

**I am also uncertain about the constant-step recommendation.** I said: keep the unlock threshold constant at 5 questions, not exponential. This is simple and avoids the grind trap. But it may feel flat over time. If every five questions gives you exactly three cards, with no acceleration or deceleration, the rhythm may become monotonous. The WoW curve was trying to solve this — making early levels feel fast and exciting. My counter is: the excitement comes from the cards, not the bar. If the cards are good, the user does not need the bar to accelerate. If the cards are bad, no curve will save the experience.

## 4. FINAL RECOMMENDATION

**Ship the level bar with no number. Ship match percent on job cards as the only user-facing number. Do not build the WoW curve.**

Monday morning: write the one-page spec for the bar component. No number. Fill animation on each answer. Five questions to first card reveal. Send it to the team for pushback by end of day.

In parallel: ask the engineering team one direct question. **"Can the E5 cluster engine produce at least one match above 50% from five answers of a sparse profile?"** The answer to that question determines whether the match percent is safe to show on the first reveal, or whether the first cards need named ranks instead of numbers.

The WoW curve is rejected on two grounds: it does not solve the grade-read problem (a number on a person is a score, regardless of framing), and its asymptotic cap at 100 directly contradicts Decision 5's "endless levels." This contradiction is named explicitly. The resolution is: the bar measures distance to the next unlock, with no level count, which is fully consistent with Decision 5 as written.

### Expansionist (Model B)

## 1. DIRECT ANSWER

**Two numbers visible — match percent per job card (the star) and a level gauge (the fuel) — but the level should be a bar with a small number, not a headline number.** Option A, with a specific refincement: the level number is subordinate to the bar visualization, shown small inside or beside it, never as a standalone "You are Level 4" splash.

The reason is information architecture. The user has two questions in their head:

1. "Is this job good for me?" → match percent answers this. It is attached to the job, not to the person. Safe to show big and bold.
2. "Why should I keep answering questions?" → the level bar answers this. It shows cause and effect: you answered → the bar moved → your matches got better.

**The bar matters more than the number on it.** A bar at 40% says "we could learn more." A number "Level 4" says "you are a 4." Same data, completely different emotional read. The bar is the visual. The number is small type for people who want precision. The movement of the bar is the reward, not the destination.

**The WoW curve is directionally right but should mirror actual information gain, not arbitrary XP thresholds.** The first five questions (industry, seniority, top skills, location, target role) are worth enormous information to the matching engine. Questions 50–55 are worth much less. The curve should reflect this real diminishing return, which happens to produce the same shape as WoW leveling — fast early, slow later — but for an honest reason, not a game-design trick. This means the curve is self-calibrating: if a question teaches the system a lot (a surprising answer, a new skill cluster), the bar should jump more. The user learns that surprising answers are rewarded, which is exactly the behavior the system wants.

**Do not show CV quality (numbers 3 and 4) to users now.** Keep them as the team workbench. The moment to surface CV quality is after the user trusts the system — after they have seen good matches, after they have a real CV draft. At that point, "your CV could be stronger for this specific role — here's what to change" is a coaching feature, not a judgment. Premature exposure of quality scores is the fastest way to trigger the "you are poor" read that kills conversion.

---

## 2. EXPANSIONIST LENS

Everyone in this discussion is treating the level system as a UX problem — how to show a number without causing harm. **The upside being systematically underweighted is that the level system is a moat, not a progress bar.**

**What is hiding in plain sight:**

Every job board shows listings. Indeed, LinkedIn, Glassdoor — commodity. The thing none of them build is a persistent, growing model of who you are as a professional. The claim graph in Postgres is already this. The level is the user-facing proxy for the depth of that graph. If done right, it becomes:

- **A switching cost.** "I'm Level 35 on JobCrush" means you have invested dozens of answers. Starting over on another platform means losing all that context. This is the same lock-in that makes LinkedIn profiles sticky, but earned through conversation instead of manual data entry.
- **A trust signal that flows both directions.** Today it says "we know enough about you to give confident matches." Tomorrow it could say to an employer: "this candidate has a deep profile — our match confidence is high." A Level 40 profile carries more signal than a Level 8 profile, and employers would pay for that certainty. This is a B2B revenue path hiding inside a consumer UX element.
- **A natural re-engagement trigger.** When a user changes jobs, learns a new skill, or shifts industries, their level should reflect that the system's knowledge is now partially stale. Not by going down (punishing), but by showing a new growth opportunity: "You've changed — let's catch up." This is organic retention, not a push notification.

**The match percent is the output. The level is the input. Together they are a flywheel.** If users can watch their match percentages visibly improve as they level up, you have proven the product's core value proposition in real time, inside the onboarding flow, before the user has ever opened a job card. No other job platform does this. Most show you a wall of jobs and hope you click. JobCrush shows you that answering questions makes the wall of jobs get better. That is a fundamentally different product.

**The adjacent opportunity nobody mentioned:** the information-gain curve (how much each answer teaches the system) is itself a signal. If the system can detect that a user's answers are all in well-populated clusters (common skills, standard career paths), it can tell the user "we already have a good picture of people like you — your matches are solid." If the answers are in sparse clusters (unusual combinations, niche roles), the system can say "you're unusual — more answers will help a lot." This turns the diminishing-returns curve into a personalized experience. The IT project manager who is also a certified sommelier gets a different leveling feel than the standard software engineer — and both are honest.

**What does success beyond expectations look like?** The level becomes the thing users mention when they tell a friend about JobCrush. Not "it found me a job" (that is what every platform promises) but "it actually learned who I am." The level is proof of that learning. If you get the framing right, users will grind voluntarily — not because the game design tricks them, but because they can see their matches improving. The grind is the product working.

---

## 3. FAILURE MODES

**What would make my answer wrong:**

1. **The match percent might not visibly improve with leveling.** If the E5 cluster engine does not produce noticeably better matches after 20 more answers, the "answer → level up → better matches" flywheel is broken. The user levels up and nothing changes. The level becomes a vanity metric. This is the single biggest risk to the entire design, and it depends on S3 engineering, not UX.

2. **The "bar not number" distinction might not survive implementation.** In practice, a bar at 35% and a number "Level 7" might feel identical to users. If the bar fails to read as "how much we know" and still reads as "how good you are," the framing shift is cosmetic. I am uncertain whether visual design alone can carry the semantic difference, or whether copy/context around the bar is doing the real work.

3. **The information-gain curve might not be smooth enough to feel fair.** Real information gain is lumpy — one answer might be worth 10x another. If the bar jumps unpredictably (big jump on one answer, nothing on the next three), users will feel the system is arbitrary. Smoothing the curve for UX might disconnect it from the honest information-gain signal, and then it is just gamification with extra steps.

4. **I may be overvaluing the moat.** The switching cost only matters if users come back. If JobCrush is a one-shot tool (upload CV → get draft → leave), the level system never compounds. The moat thesis depends on the hunt (S3) creating repeat engagement. If S3 does not land, the level is a nice onboarding touch that never becomes strategic.

5. **Cultural risk with "the system knows you."** In privacy-sensitive markets or with users who have been burned by algorithmic hiring (bias, opaque rejections), "we know a lot about you" might read as surveillance, not service. The level bar could trigger distrust rather than engagement.

---

## 4. FINAL RECOMMENDATION

**Ship two numbers: match percent (big, per card) and level (small, inside a bar). Build the bar so it mirrors real information gain, not arbitrary XP. Keep CV quality scores internal until users trust the system enough to hear coaching without hearing judgment.**

The one thing to get right first: **prove the flywheel before polishing the gauge.** Before investing in the leveling curve, exponential scaling, or bar animations, validate that answering more questions actually produces visibly better match percentages in the E5 engine. If it does, the level system sells itself — users will see cause and effect. If it does not, no amount of WoW-style gamification will save it, because the core promise ("answer more → better jobs") is hollow.

Build the bar. Make it honest. Then watch whether users grind voluntarily. If they do, you are sitting on a moat no job board has.

### Contrarian (Model C)

## 1. DIRECT ANSWER

Show **one user-facing number during onboarding: the match percent on each job card**.

Example: “This job: 34% match” is acceptable.  
It is about the user plus one job.  
It does not say “you are 34% good.”

Do not show “Level 3” or “Profile 34%” in the first onboarding flow.  
A visible level attached to the person will be read as a grade by many users.  
The WoW curve does not fix that.  
It only changes how fast the number moves.

The progress bar can stay.  
But it should mean: “distance to the next job-card unlock.”  
It should not mean: “how complete or strong your profile is.”

Numbers 3 and 4 should stay internal.  
“Well-made CV” and “aimed-at-this-job” are workbench scores.  
They are too easy to read as personal failure.

**The fork in the road is this:** either the product is about unlocking better job cards, or it is about judging the user’s CV.  
JobCrush should choose job cards.

## 2. CONTRARIAN LENS

The fatal assumption is that framing controls meaning.

It does not.

If a user sees “Level 3,” they will not carefully think: “The system knows little about me.”  
Many will think: “I am low level.”  
In job search, that lands badly.

Games can make low level feel exciting because the user came to play.  
A job seeker did not come to be turned into a weak character.  
They came anxious.  
They want proof the product can help.

The WoW-style curve may make this worse.  
Early levels may feel good.  
Then the user hits the grind.  
That conflicts with the locked decision that the bar should always feel close to the next unlock.

The asymptotic cap around 100 also creates a hidden contradiction.  
Decision 5 says the bar is not total completeness.  
But a level system with a cap feels exactly like total completeness.  
Users will ask, “Why am I only level 12 out of 100?”

The product owner is solving pacing.  
The real problem is semantics.  
A person-number is dangerous.  
A job-number is safer.

## 3. FAILURE MODES

My answer is wrong if real user tests show that visible levels increase completion without increasing shame, confusion, or support questions.

It is also wrong if the audience strongly understands game levels as “knowledge gathered,” not “candidate value.”  
I doubt this in a job-search product.

The bigger uncertainty is the “honesty gap.”  
If users see low match percentages and no explanation, they may blame JobCrush.  
So the match percent needs reasons.

Example: “34% match. Missing: budget size, tools used, team size.”  
That tells the truth without saying: “Your CV is bad.”

Another risk: hiding quality scores may delay useful feedback.  
But the fix is not a CV-quality number.  
The fix is job-specific next steps.

## 4. FINAL RECOMMENDATION

Ship **Option C with reasons**.

Use only the job-card match percent as a visible number.  
Keep the onboarding progress bar unnumbered.  
Frame it as “next cards unlock soon,” not “your profile level.”  
Keep CV-quality scores internal.  
Expose their output only as plain job-specific guidance, not as scores.

Example user surface:

“34% match.”  
“Add examples about stakeholder management and delivery budget to improve this job.”

That keeps the payoff centered on jobs.  
It avoids grading the person.  
It still tells the truth.

### Evidence Scout (Model D)

## 1. DIRECT ANSWER

Show two numbers. 

The first number is the match percent for the job. 
The second number is the level of the user. 
But the level must not be a raw number like "Level 34". 
It must be a named rank like "Explorer" or "Builder". 

Think of a video game. 
You see "Level 5" and you feel good. 
Then you see "Level 6" and it takes ten hours. 
You feel stuck. 
This is the grind trap. 

The Product Owner's WoW-style curve creates this trap. 
An exponential curve means early levels are fast. 
Later levels take too much work. 
This breaks Decision 5. 
Decision 5 says levels are endless. 
An exponential curve always stops or slows to a crawl. 
The user will feel the slowdown. 
They will think the app is broken. 

**The fork in the road is whether we use a raw number with a steep curve, or a named rank with a flat curve.** 

Choose the named rank with a flat curve. 
This protects the user from feeling graded. 
It also keeps the levels feeling endless.

## 2. EVIDENCE SCOUT LENS

Look at real games and apps. 
World of Warcraft is the best example. 
Blizzard changed their leveling curve many times. 
They did this because players quit during the slow parts. 

Research on goal gradients proves this. 
A study by Bonezzi shows people work harder near a goal. 
If the goal is too far, they quit. 
An exponential curve pushes the goal too far away. 

Look at progress bars in apps. 
LinkedIn uses a "Profile Strength" bar. 
They do not use a raw number. 
They use words like "Intermediate" or "All-Star". 
This stops users from feeling graded. 
Words describe a state. 
Numbers measure a test. 

We need live validation for one thing. 
We do not know if job seekers like game words. 
A stressed job seeker might think "Explorer" sounds silly. 
We must test the names with real users.

## 3. FAILURE MODES

This answer could be wrong in three ways. 

First, the named ranks might still feel like a grade. 
If the names are "Novice" and "Expert", it is still a test. 
We must choose neutral names. 

Second, the honesty cost might be too high. 
A user with a bad CV gets a good level. 
They get a low match percent. 
They will not know why. 
They might blame our app instead of their CV. 
We must accept this risk to follow Decision 2. 
Decision 2 says cards are the payoff. 
We cannot fix their CV in the UI. 

Third, the backend might need a steep curve. 
Maybe the AI needs 50 answers to be accurate. 
If we flatten the curve, we give false match percents early on. 
We must check the AI model's data needs.

## 4. FINAL RECOMMENDATION

Show two numbers in the onboarding flow. 
Show the job match percent. 
Show the user level as a named rank. 
Drop the raw number for the level. 
Flatten the leveling curve. 
Make every level take the same amount of time. 
This keeps the flow endless. 
It stops the user from feeling graded. 
It prevents the mid-flow grind trap.

### Fundamentalist (Model E)

## 1. DIRECT ANSWER

Imagine a user named Priya. She has no CV. She opens JobCrush. She sees a bar at the top. It says "3 answers until your first jobs." She answers three questions. The bar fills. Three cards slide in. Each card says "68% match." She never sees a number on her own profile. She only sees the match number on the job.

**The fork in the road:** Either you put a number on the person, or you put a number on the job. You must choose the job.

Show exactly one number to the user: the match percent on each job card. Hide every number about the user. The level bar should carry no number. It should act as a simple visual countdown to the next unlock. The bar should fill at a flat, steady rate. One answer, one chunk. No exponential curve. No cap. No "Level 1." Just a bar that says "Next unlock in N steps."

## 2. FUNDAMENTALIST LENS

Imagine a hospital weighing patients in the waiting room and posting the weight on the wall as a "health score." Patients would riot. The hospital thinks it is measuring "how much data we have." Patients read "how much worth I have."

The question is wrong. It asks how to decorate a number. The real problem is first-minute survival. A user arrives feeling like a zero. They need proof the app will find them a job before they close the tab.

Three assumptions are broken.

First, a number on a person in a job search is always a grade. You cannot call it a character level. The user is not playing a game. They are trying to pay rent.

Second, the product owner wants a cap near 100. I name this contradiction explicitly: a cap near 100 is a total-completeness score. Decision 5 forbids total completeness. An endless system cannot have a cap. These two requirements are mutually exclusive.

Third, the product owner claims the level means "how much we know." But if a user with a rich CV starts at the same place as a user with no CV, the number is not knowledge. It is a lie. A number that lies becomes noise.

## 3. FAILURE MODES

I could be wrong if young users treat the level as a fun game and not a test. If the target audience is gamers who enjoy RPG stats, hiding the number might remove the hook.

I could be wrong if the flat bar feels boring. If users need the "ding" of a fast early level to stay, a flat bar might feel like a treadmill.

I could be wrong if the match percent alone is too brutal. If every job shows "12% match," the user has no other signal to tell them why. They might blame the app and leave.

## 4. FINAL RECOMMENDATION

Ship option C. Show one number only: the match percent on the job card. Kill the level number entirely. Replace the bar with a nameless visual countdown or a plain text label like "5 steps to your first jobs." Use a flat fill rate. Each answer moves the bar the same amount. This respects Decision 5. It removes the grade-read. It keeps the user focused on the payoff.

**The fork in the road:** You can measure the person, or you can measure the job. Pick the job. Everything else is decoration.

---

## Stage 2: Peer Reviews

### Executor's Peer Review

**Q1. Which response most changed how you'd answer the question, and why?**

The Contrarian (Model C) most changed my answer. 

The specific insight is adding actionable reasons to the match percent. 
Example: "34% match. Missing: budget size, tools used, team size." 

This updates my thinking because it solves the "honesty cost" problem. 
The prompt warns that users will churn if they see low match percents and do not know why. 
I previously thought fixing this required showing a CV quality score. 
That violates Decision 2, which says cards are the payoff. 

Contrarian's idea shows the user what the system does not know yet. 
It frames the gap as missing data, not a bad candidate. 
**The fork in the road is whether we explain a low match percent by grading the CV, or by listing what the system still needs to learn.** 
Choose the missing data. 
It solves the honesty problem without ever grading the person.

**Q2. Which response has the biggest blind spot, and what is it?**

The Expansionist (Model B) has the biggest blind spot. 

The gap is treating the level system as a long-term "moat." 
Expansionist imagines users saying "I'm Level 35" and grinding voluntarily. 

This ignores how job seeking actually works. 
Job seeking is an episodic, high-stress task. 
Users do not build profiles for fun. 
They want jobs, and they leave when they get one. 

Designing the onboarding flow for a cumulative moat ignores the real sharp edge. 
The real sharp edge is first-minute survival. 
**The fork in the road is whether we design the level for month-two retention, or for first-minute survival.** 
Choose first-minute survival. 
This blind spot could lead the team to optimize for a fictional retention loop. 
It distracts from the immediate payoff of the job cards.

**Q3. What did ALL responses miss that the council should consider?**

All responses missed the power of the instant profile document. 

Decision 4 states that a line writes itself into the profile document on every answer. 
This happens instantly. 
The level bar fills slowly, every few answers. 

Every response treated the level bar as the only way to show "how much we know." 
None of them used the instant document. 

Showing the user a growing list of facts is a better knowledge gauge than a number. 
Example: You answer a question, and the screen shows "Added: Managed a $2M budget." 
This proves the system is learning without ever grading the user. 
It makes the level number redundant. 

**The fork in the road is whether we use a slowly filling bar to show knowledge, or the instantly updating document.** 
Choose the document. 
The council should consider using the instant document as the primary "knowledge" feedback. 
Leave the bar as a simple, unnumbered countdown to the next unlock.

### Expansionist's Peer Review

# Council Evaluation

## Q1. Which response most changed how I'd answer the question?

**The Contrarian (Model C)**, specifically the "reasons attached to the match percent" proposal.

Before reading these responses, my position was close to the Executor's: option C is fine because the location change (number on the job, not the person) is the load-bearing fix. The Executor's text-nudge proposal ("Your matches are lower than they could be… the most common fix is adding more detail") is good, but it is a *delayed* signal — shown only when matches are bad.

The Contrarian reframes this. The match percent is itself vulnerable. A user who sees 34% on every card still reads it as "I am a 34% candidate." The user is not parsing "this job is 34% relative to my profile" — they are absorbing the number against themselves. The Contrarian's fix — `34% match. Missing: budget size, tools used, team size` — attaches the gap to specific absence-of-information in the user's profile, not to the user as a candidate. This is a genuinely different thing psychologically, and it surfaces the signal *on every card*, not only when something is wrong.

This matters because every other response leaves a hole in the same place. The Executor accepts match percent as safe and solves the weak-CV problem with a separate nudge. The Evidence Scout accepts the honesty cost. The Fundamentalist hides both numbers. None of those resolves the question of how a low-match user learns "what's missing about MY profile, and that more answers will help," without ever being told "you are bad."

The Contrarian's proposal is also consistent with Decision 2 (cards are the payoff) because the reasons point at the next answerable questions — they are framed as unlocking better jobs, not as grading the user. The other three responses don't fully close this loop.

## Q2. Which response has the biggest blind spot?

**The Evidence Scout (Model D).**

The Scout proposes named ranks ("Explorer", "Builder") as a soft alternative to raw level numbers. The argument is: words describe a state, numbers measure a test. The Scout cites LinkedIn's Profile Strength bar as a positive parallel.

This proposal has an internal contradiction at its core, and the Scout even raises the contradiction in the failure-modes section without resolving it: "If the names are 'Novice' and 'Expert,' it is still a test. We must choose neutral names." But there is no neutral name that escapes ordinality. "Explorer" implies less journey than "Builder." "Builder" implies less mastery than "Architect." The Scout provides exactly the hierarchy that demonstrates the problem.

LinkedIn Profile Strength is also a cautionary tale, not a clean success. Profile Strength with named tiers ("Beginner", "Intermediate", "Advanced", "All-Star") has been widely critiqued in product-design writing for producing exactly the "you are behind" stress the Scout claims to be solving. Citing it as evidence of a working model is selection-on-the-wrong-outcome.

The Scout also contradicts themselves in the framing: "Show two numbers in the onboarding flow. Show the job match percent. Show the user level as a named rank." But a named rank is by design not a number. So showing "two numbers" cannot be the recommendation if one of the two elements is a name. This is small but revealing — the proposal is not as concrete as it looks.

The material consequence: if JobCrush adopts named ranks with flat unlock cadence, the weakest no-CV users will sit at "Explorer" or "Newcomer" visibly while every strong-CV user climbs to whatever comes after. The grade-read migrates from a numeric axis to a lexical axis but does not exit. The Scout's claim that this protects from being read as a grade is wishful thinking, supported by exactly the kind of example that contradicts it.

A side blind spot in the same response: the Scout never solves what happens when the named ranks run out. If "Explorer → Builder → Architect → Sage → ... → ??? " is the ladder, what is rank 30? Another named material? Renaming every ten levels? The cap problem returns in a different costume.

## Q3. What did ALL responses miss that the council should consider?

**Two things, closely linked.**

**First, the multi-session experience is not addressed by any response.** JobCrush onboarding will not be completed in one sitting for many users, especially the no-CV users who are now in scope and who often have unstable time. A user opens the app at lunch, answers three questions, gets pulled into a meeting, returns Tuesday evening. What does she see?

- Does the bar remember its fill from Monday and continue from there?
- Does she see what she already answered, or is the next question silent about prior context?
- Does a day-old partial profile produce match percents safely, or does it produce stale or misleading numbers?
- If the bar rebuilds from session start, is that honest or is it a different kind of lie?

None of the four responses answers any of these. The Executor's "constant 5 questions per unlock" rule is silent across session boundaries. The Contrarian's reasons-on-match-percent assumes a session is contiguous. The Scout's named ranks assume monotonic ascent. The Fundamentalist's "5 steps to your first jobs" label assumes the user is currently in those 5 steps. The month-two retention question ("a number that meant something in week one must mean the same thing in month two") sits in "What's at Stake" and no response picks it up.

**Second, none of the four responses commits to what the E5 cluster engine must deliver before any of this UI design is safe.** The Executor raises this dependency and immediately flags it as "an engineering question I cannot resolve from the design alone." It is the single biggest unknown. The framing debate over level/match/reasons/rank is *downstream* of whether the cluster engine can produce at least one meaningful match from sparse first-session data. If E5 produces only "32%, 28%, 24%" cards for a no-CV user after 5 questions, then:

- match percent becomes the personal-grade we were trying to avoid;
- reasons attached to those percents describe gaps the user cannot close in one sitting;
- named ranks would be a covering distraction, not a fix.

The Executor is right to identify this dependency, but the rest of their answer treats it as someone else's problem. The Contrarian, Scout, and Fundamentalist do not even raise it. A complete council answer would have said: "Before we ship any of these screens, define a pass criterion for E5 — for instance, 'cluster engine must return at least one card at ≥55% match for a no-CV user after 5 grill answers, in 80% of test cases' — and gate the UI choice on it."

The genuine omission, then, is **a commitment to how we will know the design is safe to ship, before we ship it.** All four responses stopped at "this is the right design if X holds." None of them proposed how to validate X, or what to do if X doesn't hold, in time to affect the build order.

### Contrarian's Peer Review

**Q1. Most changed my view: Executor.**

Not because “hide the level number” was new.

The useful update was this: the first dangerous number may be the match percent, not the level.

Example: a no-CV user answers 5 questions. Then all first cards say `34%`, `38%`, `41%`. Even if the level number is hidden, the user may still think, “I am a weak candidate.”

So my answer would become stricter:

**Hide the level number. Also test whether early match percents are safe before showing them.**

Executor also correctly names the contradiction: a WoW-style curve capped near 100 fights Decision 5. Endless levels cannot also be an almost-100 completeness scale.

**Q2. Biggest blind spot: Expansionist.**

Expansionist sees the best upside. The “level as profile depth” idea could become strategically valuable.

But its blind spot is serious.

It says the level could later become an employer trust signal. That breaks the safety frame.

Example: “Level 40 profile” shown to employers will not mean “we know more.” It will mean “better candidate” or “more credible candidate.” That turns the level back into a grade by proxy.

So the Expansionist role was useful. It found the business upside. But it underweighted the first-minute emotional risk and the long-term grading risk.

**Q3. What all responses missed.**

None of them defined the match percent tightly enough.

This matters because `34% match` can mean many things.

It could mean:

- 34% chance of getting hired.
- 34% of job requirements covered.
- 34% similarity to current employees.
- 34% confidence from a sparse profile.
- 34% relative fit among available jobs.

Those are very different meanings.

Before deciding “one number” or “two numbers,” JobCrush must define what the match percent means in user language.

Concrete recommendation:

**The fork in the road is not only person-number vs job-number. It is precise score vs early signal.**

For the first reveal, after only ~5 answers, the safest label may be:

“Early match”

or

“Possible match”

Then show exact percents only when the system has enough evidence to stand behind them.

### Evidence Scout's Peer Review

## Q1. Which response most changed how you'd answer the question, and why?

**The Executor's response** changed my thinking the most, specifically through one insight: **the entire design recommendation is conditional on an unresolved engineering question.**

The Executor asks: *"Can the E5 cluster engine produce at least one match above 50% from five answers of a sparse profile?"*

This reframes the problem. I had been treating this as a UX design question — how to display numbers without causing harm. The Executor shows it is actually an engineering feasibility question first. If the cluster engine cannot produce decent matches from sparse data, then the match percent itself becomes the grade we were trying to avoid. The user sees "34%" on every card and reads "I am a 34% candidate" regardless of where the number is attached.

This forced an update: **the recommendation cannot be finalized without answering that engineering dependency.** The Executor also provides a concrete fallback (named ranks like "strong match / possible match / stretch" instead of percents for the first reveal) that I had not considered. This is a practical escape hatch if the engine underperforms.

The Expansionist's "information gain curve" idea was also valuable — it reframes the WoW curve from arbitrary gamification to honest signal about what each answer teaches the system. But this does not resolve the core tension about whether any number should be attached to the person.

---

## Q2. Which response has the biggest blind spot, and what is it?

**The Expansionist (Model B)** has the biggest blind spot.

The specific gap: **the Expansionist advocates for showing two numbers (match percent + small level number) while simultaneously accepting the core insight that "a number attached to a person is a score."** The claim is that making the level number small and subordinate to the bar visualization neutralizes the grade-read. But this is asserted, not demonstrated. The Executor, Contrarian, and Fundamentalist all argue that framing and visual hierarchy do not override the semantic meaning of a number attached to a person. The Expansionist does not engage with this counterargument — they simply assume the bar-plus-small-number design will work.

Additionally, the moat/switching-cost thesis is built on shaky ground. The Expansionist argues that "Level 35 on JobCrush" creates lock-in. But job seekers are transient by nature — they leave when they find a job. The switching cost only matters if users return, which depends on S3 succeeding. The Expansionist acknowledges this risk in their failure modes but still builds their strategic argument on it. This is a contradiction: the moat thesis is central to their recommendation, but they admit it may not materialize.

The B2B revenue path ("employers would pay for certainty about a Level 40 profile") is also premature speculation for a product that has not yet validated its core consumer experience. This distracts from the immediate design question.

---

## Q3. What did ALL responses miss that the council should consider?

**None of the responses adequately addressed the design of the match-percent explanation mechanism — and this is arguably the most important lever for solving the "honesty gap."**

The problem: if a user sees "34% match" on a job card with no explanation, they may read it as "I am inadequate" rather than "this job requires things I haven't specified yet." All responses acknowledge this risk but propose only vague solutions (text nudges, job-specific next steps) without designing the mechanism.

**What is missing is a concrete pattern for how match percents are explained.** For example:

- "34% match. This role requires: budget management experience, team size 10+, Agile delivery. You have specified: Agile delivery. Add details about budget and team size to improve this match."

This reframes the number from "you are 34% good" to "this job needs X, Y, Z — you have provided Z." It is job-specific, actionable, and does not grade the person. It also teaches the user what information the system values, which improves data quality over time.

The Contrarian gestures at this ("34% match. Missing: budget size, tools used, team size.") but does not develop it as a design pattern or address how it scales. The other responses do not engage with it at all.

**This mechanism is the actual solution to the honesty gap.** If the match percent always comes with a clear, job-specific explanation of what is missing, the number cannot be read as a personal grade — it becomes a gap analysis between the user's current profile and the job's requirements. This is fundamentally different from a CV-quality score (which grades the document) or a level number (which grades the person).

The council should consider: **before deciding how many numbers to show, design how each number will be explained.** If the explanation mechanism cannot be built, then showing any number is risky. If it can be built well, the match percent becomes safe and valuable.

### Fundamentalist's Peer Review

The user wants me to evaluate four responses from AI council members to a specific product design question about JobCrush onboarding. I need to answer three questions:

1. Which response most changed my thinking and why?
2. Which response has the biggest blind spot, and what is it?
3. What did ALL responses miss that the council should consider?

I need to be rigorous, impartial, and use short plain sentences, one idea per sentence, concrete examples before abstraction, and bold the fork in the road. The final answer is read by a non-native English speaker.

Let me analyze the four responses:

**Executor (Model A):**
- Direct answer: Option C modified - show one number (match percent), keep level bar as visual with no number. Reject WoW curve.
- Claims contradiction between WoW asymptotic cap and Decision 5 (endless levels).
- Suggests text nudge instead of CV quality score.
- Monday morning spec: bar component, no number, constant 5 questions per unlock.
- Raises uncertainty about whether E5 cluster can produce decent matches from sparse data.
- Failure modes: bar without number might not stimulate enough; match percent might still be read as grade.

**Expansionist (Model B):**
- Direct answer: Two numbers - match percent (big) and level (small, inside bar). Level is subordinate to bar visualization.
- WoW curve should mirror actual information gain, not arbitrary XP.
- Moat argument: level system is switching cost, trust signal, re-engagement trigger.
- Information gain curve should be self-calibrating.
- Failure modes: match percent might not improve with leveling; bar vs number distinction might not survive implementation; information gain might be lumpy; moat only matters if users return; privacy/surveillance concerns.
- Recommendation: prove flywheel before polishing gauge.

**Contrarian (Model C):**
- Direct answer: One number - match percent. No level number. Progress bar means "distance to next unlock" not "profile completeness."
- Framing doesn't control meaning.
- WoW curve makes it worse, contradicts Decision 5.
- Failure modes: might be wrong if tests show levels increase completion without shame; honesty gap if users see low matches and blame product.
- Recommendation: Option C with reasons, add job-specific guidance to explain low matches.

**Evidence Scout (Model D):**
- Direct answer: Two numbers - match percent and named rank (not raw number). Flat curve, not exponential.
- References WoW grind trap, Bonezzi goal gradient research.
- LinkedIn example: Profile Strength uses words not numbers.
- Failure modes: named ranks might still feel like grades; honesty cost; backend might need steep curve for accuracy.
- Recommendation: named rank + flat curve.

Now, I need to answer Q1, Q2, Q3 from my perspective as a rigorous critic.

**Q1: Which response most changed my thinking?**
I think the Executor (A) had a very strong argument about the contradiction between the WoW asymptotic cap and Decision 5. But the Expansionist (B) made me think about the moat/switching cost and the information gain curve. However, the most compelling "change" might be the Executor's point about the asymptotic cap directly contradicting Decision 5, or perhaps the Expansionist's point about the level being a moat.

Wait, I need to identify which response most changed how *I* would answer. As an AI evaluator, I should adopt a position. Let me think about what my natural position would be and what changed it.

My natural inclination might be Option C (one number) or the named rank approach. But the Executor's explicit naming of the contradiction between WoW asymptotic cap and Decision 5 is very rigorous. The Expansionist's point about the information gain curve being self-calibrating is interesting but complex.

Actually, the Contrarian (C) makes a very strong point that framing doesn't control meaning. The Executor (A) makes the strongest operational argument: the contradiction with Decision 5. But the Expansionist (B) points out that the level system is a moat - this is a strategic point others missed.

For Q1, I think the **Executor (A)** most changed my thinking because of the explicit contradiction named between the WoW asymptotic cap and Decision 5. This is a rigorous, concrete finding that forces a rejection of the PO's position regardless of psychological framing arguments. It's a locked-decision contradiction. Alternatively, the **Expansionist (B)** changed my thinking about the strategic value of the level as a moat.

But wait - the question asks which response most changed how *I* would answer. Let me decide: The **Executor's** identification of the explicit contradiction with Decision 5 is the most forceful update. It moves the question from "does WoW framing work psychologically?" to "does WoW curve literally violate a locked decision?" That's a binary, disqualifying finding. This is a strong candidate.

Alternatively, the **Contrarian's** stark framing: "The fork in the road is whether the product is about unlocking better job cards, or judging the user's CV." This is simple and powerful.

Actually, I think the **Executor (A)** is the strongest choice for Q1 because of the explicit contradiction finding. It provides a rigorous, non-negotiable reason to reject the WoW curve that doesn't depend on user psychology debates.

**Q2: Which response has the biggest blind spot?**
Let me look for gaps:

- Executor (A): Misses the strategic value of the level system (moat/switching cost). Also, doesn't address what happens if the bar with no number truly fails to stimulate. Also, doesn't address the naming/rank possibility (Option D) seriously, only as a fallback for match percent. But the biggest blind spot might be that they don't address whether the "no number" bar can still be read as a grade if it fills slowly. Actually, their blind spot is dismissing Option D too quickly and not considering that a named rank might solve the "number as grade" problem while keeping the strategic moat.

- Expansionist (B): Blind spot is implementation complexity and the "lumpy information gain" problem they themselves mention but don't resolve. They want the curve to mirror real information gain, but the user context says the bar measures distance to next unlock, not total completeness. Also, they underweight the risk that ANY number attached to a person is dangerous. They want to keep a small number, which is exactly what the Contrarian says will be read as a grade. But their biggest blind spot is **assuming the level system creates a moat before proving the core product works**. The moat argument is premature for an onboarding flow decision. They are optimizing for month 12 when the question is about minute 1.

- Contrarian (C): Blind spot is they don't address the stimulation problem seriously. They say "show match percent only" but don't fully address how to motivate users through the grill without a level/reward signal. They mention the progress bar but don't explain how to make it emotionally rewarding. Also, they don't address the Executor's contradiction point about Decision 5.

- Evidence Scout (D): Blind spot is the "named rank" approach might still carry ordinal ranking (Explorer < Builder < Master), which is just a number in disguise. They mention this as a failure mode but don't address how to avoid it. Also, they don't address the locked decisions. They don't explain how named ranks avoid the "grade" read - if there are ranks, there is still hierarchy. But their biggest blind spot is **ignoring the contradiction with Decision 5**. Decision 5 says endless levels. Named ranks with a flat curve still imply a sequence, but if it's endless, you need infinite names or recycling names, which becomes absurd.

Wait, actually the **Expansionist (B)** has the biggest blind spot: they advocate for showing a small level number attached to the user, which directly contradicts the sharpest finding from the other responses (from A and C) that numbers on people are read as grades. They underweight the "grade" risk in favor of strategic moat thinking. But is that a blind spot or just a different trade-off?

Alternatively, the **Evidence Scout (D)** has a blind spot: they propose named ranks with a flat curve, but they don't address whether the flat curve conflicts with the information density of early vs late questions. Decision 5 says the bar measures distance to next unlock. If every level takes the same amount of time, but the first 5 questions unlock the first cards, and later questions might need to unlock more cards or maintain the same spacing, that's fine. But the Evidence Scout doesn't address the "honesty cost" well - they actually say "We cannot fix their CV in the UI" which is a bit fatalistic.

Actually, looking carefully, I think the **Expansionist (B)** has the biggest blind spot: **the assumption that a small number inside a bar won't be read as a grade.** They dismiss the psychological risk without evidence. They also overweight the moat argument while underweighting the immediate conversion risk. The question asks about onboarding flow survival with real users. The moat is irrelevant if users drop off in minute one.

But wait - the **Evidence Scout (D)** has a glaring blind spot: they suggest named ranks with a flat curve, but Decision 5 says endless levels. If levels are endless and the curve is flat, you need an infinite supply of rank names. Or you recycle, which makes them meaningless. Or you attach numbers to names (Explorer III), which brings back the number. They don't solve the "endless" requirement.

Actually, the **Executor (A)** has a blind spot too: they recommend a constant 5 questions per unlock, but Decision 5 says the bar measures distance to the next unlock, never total completeness. A constant 5 questions is fine, but they don't address whether the visual bar should show "3 more answers until next unlock" vs a percentage. They suggest a countdown label as a fallback, which is good.

Let me reconsider. The **Expansionist (B)** biggest blind spot is **they don't address the locked decisions properly**. They propose a level system that asymptotically mirrors information gain (diminishing returns), which creates a similar slowdown problem as WoW. If information gain is diminishing, later levels require more questions, which contradicts Decision 5's requirement that the bar always feel close to the next unlock. They hide this behind "self-calibrating" language but it creates the same grind trap.

I think for Q2, the **Expansionist (B)** has the biggest blind spot: **failing to recognize that their "information gain curve" recreates the same grind trap as the WoW curve they implicitly criticize, while also violating Decision 5's requirement that the bar always feel close.** They want diminishing returns on information gain, which means the bar moves slower as you go, which means the distance to next unlock grows, which contradicts "the bar always feels close."

Wait, no - if the bar measures distance to next unlock, and it's a bar that fills, the user only sees the current segment. The "cost" of each level can grow exponentially, but the user only sees the current bar. However, Decision 5 says "the bar measures only distance to the next unlock, never total completeness." So if each level requires exponentially more questions, the bar for level 20 might require 500 questions to fill. The user sees "distance to next unlock" as 500 questions, which feels very far. That violates the spirit of Decision 5.

But the Expansionist wants the curve to mirror real information gain. Early questions give big info jumps, later ones give small. So the bar would fill fast early, slow later. The user sees the current segment filling slowly. That's the grind trap.

So yes, Expansionist (B) recreates the grind trap.

Alternatively, the **Contrarian (C)** has a blind spot around stimulation/motivation. They offer no solution for why users would keep answering beyond seeing a filling bar.

Actually, I think the **Expansionist (B)** is the strongest candidate for biggest blind spot because they **underweight the "grade" risk and contradict Decision 5's "always feels close" while claiming to support it.**

**Q3: What did ALL responses miss?**
Let me think about what none of them addressed.

- The user context mentions "The grill is already live." So the onboarding flow is partially live. None of them suggest using current live grill data to inform the decision. They all talk about "ship this" or "test that" but none mention: "look at the existing grill data to see where users currently drop off."

- None of them addressed the fact that the match percent itself might not be ready because S3 (E5 cluster engine) isn't built yet. The Executor mentions this as an unknown. But none address the temporal sequencing: if S3 isn't built, how do you show match percents during onboarding now?

- None addressed cultural/contextual differences in how "grades" are read. The audience note says non-native English speaker. But more importantly, different cultures read numbers differently.

- None addressed the interaction between the level bar and the claim graph in Postgres. The user context says S2 is complete with claim graph v1. The level is supposed to represent "how much we know about you" - this maps directly to the claim graph. But none propose using the claim graph size/complexity as the level metric.

- None addressed the "CV as shortcut" aspect. Users with a CV auto-answer questions. Does that mean they start with a filled bar? If so, the bar reads even more like "profile strength" because a CV user starts at a different point.

- None seriously addressed the "named rank" option (Option D) as a complete solution. Wait, Evidence Scout did.

- None addressed the visual/audio design of the bar. If the bar fills with animation, sound, color, it might be enough stimulation. But that's tactical.

- None addressed the **asymmetry of the first unlock**. Decision 3 says ~5 questions first, then three real cards. But what about users who arrive WITH a CV? They auto-answer. Do they skip the bar? Do they start with cards immediately? If a no-CV user sees an empty bar and a CV user sees cards immediately, the bar is implicitly saying "you are behind."

- None addressed the **competitive landscape of job boards** in terms of what users *expect* to see. LinkedIn shows profile strength. Indeed shows nothing. What do users expect?

- None addressed the **accessibility** of a filling bar without numbers. Screen readers need numbers.

Actually, I think the most important omission is: **None of the responses addressed the user who arrives with a CV (auto-answers) versus without a CV.** 

Decision 1 says one flow, CV is a shortcut that auto-answers. If a user uploads a CV and auto-answers 20 questions, does their bar instantly fill to the first unlock? If so, the bar is implicitly comparing users: "CV user starts at 80%, no-CV user starts at 0%." That makes the bar look like profile strength/completeness, not distance traveled. This is a huge flaw in the "knowledge gauge" framing.

Alternatively, another major omission: **None address what happens when the E5 engine isn't ready yet.** If the council is deciding on S3 pre-build, and the match percent depends on E5, the council should consider whether match percents can be shown at all during onboarding before S3 ships.

Actually, I think the best "miss" is: **All four responses missed that the level bar is meaningless without the E5 engine, and none proposed a phased rollout where the bar ships first while the match percent is hidden or mocked until the engine is proven.**

Wait, the Executor does mention this: "ask the engineering team one direct question... The answer determines whether match percent is safe to show." So they kind of address it.

Another miss: **None address the "short plain sentences" constraint of the audience.** But that's meta.

Let me think of something genuinely missed. 

What about: **None of them addressed the fact that showing "distance to next unlock" (e.g., "3 more answers") is itself a number that can cause anxiety.** The Executor suggests this as a fallback. But "3 more answers" is a countdown, which is actually very motivating (goal gradient). So that's good.

What about: **The difference between the first unlock and subsequent unlocks.** Decision 3 says ~5 questions first, then three cards. Decision 5 says endless levels, no stopping rule. But none of the council members addressed the "decay of novelty" - after the first card reveal, does the 5-question rhythm remain exciting? The Expansionist mentions this as a failure mode (monotonous), but doesn't solve it.

I think the strongest "miss" is: **None of the responses addressed how the level bar should behave for users who arrive with a CV (auto-answers) versus those who don't.**

If the CV auto-answers questions, the bar might jump instantly. This creates two problems:
1. It makes the bar look like "profile strength" (because having a CV = strong start).
2. It makes the no-CV user feel behind from second one.

Actually, looking at the user context again: "Decision 1: one flow, CV is a shortcut that auto-answers, not a separate path." This means both users see the same flow, but the CV user auto-answers some questions. The bar would fill differently. This is a critical interaction that none of the four council members addressed. It directly affects whether the bar reads as a grade.

So Q3 answer: All responses missed that the CV auto-answer mechanic creates a natural A/B test where the bar fills faster for some users than others. This makes the bar implicitly comparative. If a no-CV user sees "Level 1, empty bar" while a CV user sees "Level 4, half bar" after the same real time, the "knowledge gauge" framing collapses into a "profile strength" read. The council needs to decide whether the bar should be normalized to start at zero for everyone, with CV users getting "bonus" hidden progress, or whether the bar should be decoupled from the auto-answers entirely.

Wait, is that accurate? The user context says CV auto-answers. So yes, the bar would fill from those answers. But none of the responses addressed this.

Another possible miss: **None of the responses addressed the fact that the match percent on job cards is technically impossible to show truthfully before S3 (E5 engine) is built.** But the Executor does flag this.

Let me go with the CV auto-answer / comparative read miss. It's concrete and material.

Alternatively, the **accessibility** point is valid but maybe too technical.

Let me reconsider the blind spot question. 

Actually, for Q2, I might want to say the **Evidence Scout (D)** has the biggest blind spot because they recommend named ranks with a flat curve, but they don't explain how to make it "endless" (Decision 5). Named ranks with a flat curve and endless levels require an infinite sequence of names. If you recycle names (Explorer I, Explorer II), you're back to numbers. If you keep inventing new names, you run out. This is a concrete missing consideration.

But the Expansionist's blind spot is bigger because they are willing to risk the entire onboarding conversion on a strategic moat bet.

Let me structure my answers:

**Q1:** The Executor (Model A) most changed my thinking. The specific argument was the explicit contradiction between the WoW asymptotic cap and Decision 5 ("endless levels"). This is not a psychological guess. It is a logical lock. A curve that asymptotically approaches 100 is bounded and slows down. Decision 5 says the bar is endless and always feels close. These two cannot coexist. This forced me to reject the WoW curve on structural grounds, not just user-testing grounds.

**Q2:** The Expansionist (Model B) has the biggest blind spot. The gap is that they recreate the exact grind trap they criticize, while ignoring the locked decisions. They propose a "self-calibrating" information-gain curve that gives diminishing returns. This means later bar fills require more questions to move. The user sees the same bar graphic, but it moves slower and slower over time. This is the same mid-flow stall as WoW. It directly violates Decision 5's requirement that the bar always feel close to the next unlock. They also completely underweight the "number as grade" risk, betting on a "small number" distinction that has no evidence.

**Q3:** All four responses missed the CV auto-answer interaction. When a user uploads a CV, the system auto-answers questions. This means the bar fills instantly for CV users, while staying empty for no-CV users. If both users see the bar in the same flow, the bar stops looking like "distance traveled" and starts looking like "profile strength." The no-CV user sees an empty bar next to a CV user who sees a half-full bar. This is a direct grade comparison. The council must decide whether to hide the bar entirely until the user has manually answered enough questions, or to reset the bar to zero for everyone and treat CV answers as hidden background progress.

Wait, I need to check: does the flow allow users to see each other's bars? No, it's an individual onboarding flow. So the comparison is not between users, but between the user's own expectation. However, the *system* treats them differently. But the user doesn't see another user's bar. So my point is weak.

Let me reconsider. The user doesn't see other users' bars. So the CV auto-answer issue is only relevant if the user perceives the bar as "profile strength" because it filled fast due to their CV. Actually, that might make them think "my profile is strong" - which is good? But the point is the bar reads as profile strength, not distance.

Actually, if the bar fills because of auto-answers, the user might not even notice. But if they do, they might think "I started ahead because I have a CV." That reinforces the "profile strength" reading rather than "system knowledge" reading.

But is this the most important miss? Let me think of another.

**All four missed the first-card guarantee.** The Executor mentions it as a question for engineering. But none frame it as a design requirement: the first three cards must contain at least one match above a threshold, or the match percent becomes a grade. This is critical, but the Executor does flag it.

**All four missed the localization / non-native English speaker angle.** The prompt says "final answer read by a non-native English speaker who asks for explanations simply." But the council members' responses were complex. However, I'm the critic evaluating them, so I can note that none addressed whether game terminology ("level," "Explorer") translates well or carries grade-connotations in other languages.

**All four missed the possibility of a non-visual level indicator.** What about sound, haptics, or animation as the reward instead of a bar? The product owner wants stimulation. But all four focused on visual bars and numbers.

**All four missed Decision 4's build order.** Decision 4 says build order: bar first, then document, then unlock. The question is about the bar now. But none addressed what the "document" (instant feedback) looks like in relation to the bar. If the document writes a line on every answer, and the bar fills every few answers, the user already has instant stimulation. The bar is just slow feedback. If the document is rich, the bar might not need a number at all.

I think the strongest "miss" is: **None of the responses addressed the interaction between the instant document feedback (Decision 4) and the level bar.**

Decision 4 says there are three feedback speeds: instant (document writes), slow (bar fills), rare (cards unlock). The council is treating the bar as the primary stimulation, but the instant document is already live. The user sees their profile building in real time. This reduces the need for the bar to be heavily stimulating. The bar is just a pacing mechanism for cards. This strengthens the case for no number on the bar, but none of the council members used this argument.

Actually, looking at the user context: "The grill is the question-by-question interview that builds the user's profile. It is already live." So the instant feedback is already there. This means the user ALREADY has stimulation from watching their profile document grow. The bar is supplementary. This is a major point none of them leveraged.

But the prompt asks what did ALL responses miss that the council should consider. So I'll say: **All four missed that the grill already provides instant stimulation through the live profile document.** Because the user sees their CV build line-by-line in real time, the level bar does not need to carry the motivational load alone. The bar can be a purely functional "distance to next unlock" indicator without a number, because the document is already giving the emotional reward of progress. This makes Option C (no number on bar) safer than the council treated it.

Wait, is that true? The user context says "instant — a line writes itself into the profile document on every answer." But it also says "Build order: bar first, then document, then unlock." That implies the document is NOT yet built as user-facing instant feedback. The grill is live, but the instant document feedback might not be user-facing yet. The user context says S2 is complete, including audited root CV. But the build order says bar first, then document, then unlock. So the document feedback might be a future build item, even though the grill is live.

Hmm. Let me re-read: "Decision 4 (three feedback speeds): instant — a line writes itself into the profile document on every answer; slow — a level bar fills every few answers; rare — cards unlock at milestones. Build order: bar first, then document, then unlock."

This means the instant document is a designed decision, but in the build order, it comes AFTER the bar. So the bar ships first. The document is not yet providing stimulation when the bar ships. So my point is wrong.

Let me reconsider.

What about: **None of the responses addressed the temporal reality that the E5 engine is not yet built, so match percents cannot be shown during the first phase of the bar's life.** This means the first version of the onboarding flow will have a bar filling up but NO job cards with match percents at the end, or mocked cards. This is a huge material consideration. The cards are the payoff (Decision 2), but if the engine isn't ready, the cards might be fake or delayed.

Actually, the user context says "S3 ('the hunt') is next — E5 cluster engine first." And "Decision 3: ~5 questions first, then three real, fully visible, scored cards." So the scored cards depend on E5. If the bar is built first, and E5 is not ready, then the flow is built in a state where cards cannot be scored. The council should address whether the bar should be built before the engine is proven, or whether the whole flow should wait.

But the prompt says the level bar and unlock mechanic are being designed now, before S3 ships. So they are designing the bar now, but the cards (payoff) come later.

None of the four addressed this sequencing risk: **building the bar now, without the engine, means the first users will experience the grind without the proven payoff.** The bar might fill, unlock cards, but the match percents are meaningless until E5 works. This is a massive risk.

However, the Executor does say: "Can the E5 cluster engine produce at least one match above 50%...?" So they touch on it.

Let me think of something else. 

What about: **None of the responses addressed what the level bar measures if the grill has no stopping rule and the user can stop anytime.** Decision 5 says the user stops when they want and always leaves holding something real. If the level bar shows "distance to next unlock," and the user stops mid-bar, they leave with a partially filled bar and no new cards. Is that "holding something real"? The bar state is ephemeral. The real thing they hold is the CV document. So the bar is just a motivator for the optional continued engagement. But none of the council members addressed the fact that the bar is essentially an optional game layer on top of a completed document.

Actually, looking at Decision 2: "every question must read as unlocking jobs, not polishing a document." But Decision 5 says the user always leaves holding something real. The real thing is the CV. So there's a tension between Decision 2 and Decision 5. The council must not re-open decisions unless they find a contradiction. None found this tension.

Wait, is there a contradiction? Decision 2 says questions must read as unlocking jobs. Decision 5 says the user always leaves holding something real (the CV). The CV is a by-product (Decision 2). So the document is the real thing they hold, but the framing is jobs. That's not a contradiction, just a framing requirement.

But none of the council members addressed: **If the user stops at any time, and the bar is mid-fill, what do they see?** If the bar is "distance to next unlock," and they stop, the bar resets? Or stays? If it stays, returning users see a static bar. If it resets, that's punishing. This is relevant to month-two retention. The Expansionist mentions month-two retention but only about the level meaning. None address the mechanics of returning users.

Actually, the user context says "Decision 5: the bar measures only distance to the next unlock, never total completeness." So if a user stops mid-bar, the bar is just paused. When they return, they continue. But none of the responses addressed the UX of a returning user who sees a half-filled bar and no context.

I think the best "miss" is: **All four responses failed to address the returning user experience and the bar's meaning over time.** 

But wait, the prompt says "A number that meant something in week one must mean the same thing in month two, or retention breaks." The Expansionist mentions this. The Executor mentions it too? No, the prompt mentions it in the "What's at stake" section. The Expansionist mentions month-two retention. So it's not entirely missed.

Let me go with the **CV auto-answer making the bar implicitly comparative** even if not between users. Or maybe: **None addressed how the match percent and the level bar interact visually.** If both are on screen, the user sees "Level 4" and "This job: 34%." They will correlate them. If the level goes up but the match percent stays low, the user sees a broken promise.

Actually, the Expansionist explicitly mentions this: "If users can watch their match percentages visibly improve as they level up..." So they do address the interaction.

The Contrarian says: "If a user sees low match percentages and no explanation, they may blame JobCrush."

I think I need to pick something genuinely missed by all four.

**All four missed the possibility that the "level" should be attached to the claim graph depth, not the question count.**

The user context says the claim graph is in Postgres. "How much we know about you" should map to the complexity of the claim graph, not a raw question count. If the level is based on questions answered, it rewards volume over quality. A user who answers 5 questions with rich, detailed answers (producing many claims) might know more than a user who answers 10 questions with one-word answers. But all four responses assumed the level tracks questions-answered or information-gain-per-question. None proposed basing the level on the actual claim graph metrics (nodes, edges, confidence). This is a concrete omission because the system already has the claim graph built (S2 complete).

Actually, the Expansionist mentions "the claim graph in Postgres is already this" and "the level is the user-facing proxy for the depth of that graph." But they still talk about questions and answers for the leveling. They don't explicitly say "measure the graph, not the questions."

But the Executor says "the bar fills based on questions answered since the last card unlock, divided by questions needed for the next unlock." So they assume question count.

The product owner said "how much we know about you." The system knows about you via the claim graph. The level should be based on the claim graph state. But all four council members translated this into question-based XP. That's a miss.

Wait, but the user context says the level bar is being designed now. The claim graph is v1. Maybe it's not yet usable for level calculation.

I think I'll go with: **All four missed that the match percent number is not the only "job-attached" number that could appear.** Decision 2 says cards are the payoff. But what if the first cards show a match percent that is actually a *mocked* or *heuristic* percent because E5 isn't ready? None address the risk of showing a fake number. But that's speculative.

Let me reconsider the "returning user" angle. The prompt says: "A number that meant something in week one must mean the same thing in month two, or retention breaks." The Expansionist mentions this. But none address: **If the user stops and returns, and the system has learned new things (E5 improved, new jobs added), does the level change retroactively?** If the level is "how much we know," and the system learns better ways to extract knowledge from existing answers, does the level recalculate? If so, the meaning drifts. This is a concrete backend consideration.

Actually, I think the best "miss" is: **All four responses missed the interaction between the level bar and the "claim graph" as the actual measure of knowledge.** They all treat the level as a gamified progress bar (questions answered, XP curve, etc.), but the user context defines the level as "how much the system knows about you." The system knows about you through the claim graph, not through question count. A user might answer 5 questions that generate 50 claims, or 10 questions that generate 10 claims. The bar should measure claim graph richness, not question count. If it measures question count, it lies about "how much we know." This is a direct honesty issue.

But I need to be careful. The user context says "level/progress bar — how much the system knows about the user." And the product owner wants WoW-style leveling. The council members all assumed the level is based on answers/questions. The Executor proposes "questions answered since the last card unlock divided by questions needed." That's a question count, not a knowledge count. This contradicts the definition of the level as "how much the system knows." If the system knows more from some answers than others, the bar should not move uniformly.

The Expansionist mentions this: "The curve should reflect this real diminishing return... if a question teaches the system a lot... the bar should jump more." So they partially address it. But they still frame it as per-question information gain, not claim graph depth.

I think I'll use a different miss. Let me look at the prompt again.

The question asks about: "can a 'how much we know about you' level gauge survive contact with real users without being read as a grade, and does the WoW-style diminishing-returns leveling curve proposed by the product owner actually solve that problem or introduce new ones?"

All four answers focused on the user psychology. But **none of the four responses addressed the visual design specifics of the bar.** The prompt says "The bar measures only distance to the next unlock." But what does this look like? Is it a segmented bar (like 5 segments, one per question)? Is it a continuous fill? A segmented bar with clear "next unlock" markers might read very differently from a percentage bar. None of the council members proposed specific visual forms that would help the semantics.

For example, a thermometer bar with a "UNLOCK" label at the top reads as "distance to goal." A percentage bar reads as "completeness." The visual form matters as much as the number. None addressed this.

But maybe that's too tactical.

Let me go with: **All four missed the question of how the level bar behaves when the E5 engine cannot yet produce match percents.** The bar is being built before S3. The cards are the payoff. If the engine isn't ready, the first users will fill the bar and unlock cards with meaningless or hidden scores. This is a sequencing risk. But the Executor does ask about E5 capability.

Actually, looking at the user context again: "The level bar and unlock mechanic are being designed now, before S3 ships." And "Decision 3: ~5 questions first, then three real, fully visible, scored cards." This implies the scored cards are part of the design now, but S3 (E5) is next. There's a contradiction here: how do you show scored cards before the engine is built? None of the council members addressed this project sequencing contradiction.

But the prompt says the council must not re-open locked decisions unless they find a contradiction. None found this one. Maybe it's not a contradiction - the cards can be scored by a simpler heuristic until E5 is ready.

I think the best "miss" is: **All four missed the accessibility and internationalization burden of named ranks or game framing.** The audience is a non-native English speaker. The council members used complex game metaphors ("Explorer," "Builder," "WoW curve"). But the user context says the audience is a non-native English speaker who asks for explanations simply. None of the council members addressed whether game terminology ("level," "Explorer," "match percent") translates culturally or linguistically. In some cultures, any ordinal rank (even "Explorer") is read as a social grade. This is a concrete miss.

However, the prompt asks me to answer simply because the final answer is read by a non-native speaker. The council members weren't necessarily told to write simply (except maybe implicitly). But as a critic, I can note that none addressed the cross-cultural grade-read risk.

Let me settle on: **All four responses missed the returning-user state change problem.** If the user leaves and returns in month two, and the system has updated its models or added new question types, the meaning of the level bar (distance to next unlock) may have shifted. For example, if the user answered 5 questions last month, and the system now requires 8 questions for the next unlock because the question bank changed, the bar retroactively moves backward. This breaks the "stable meaning" requirement and would be a retention killer. None addressed versioning the bar or freezing unlock thresholds.

Actually, looking at the prompt's "What's at stake": "Month-two retention. If a returning user's level number has no stable meaning... the number becomes noise." The Expansionist mentions this. But they don't address the specific backend mechanism.

I think my final choice for Q3 will be: **All four missed that the auto-answer CV shortcut means the bar fills

**Anonymization mapping:**
- Model A = Executor (Fireworks (glm-5p2))
- Model B = Expansionist (Fireworks (minimax-m3))
- Model C = Contrarian (Codex (gpt-5.5))
- Model D = Evidence Scout (Fireworks (qwen3p7-plus))
- Model E = Fundamentalist (Fireworks (kimi-k2p6))

---

## Stage 3: Chairman's Synthesis

# CHAIRMAN'S SYNTHESIS

*A note on words, first. The council uses shorthand. Here is what it means. **The grill** is the question-by-question interview that builds the user's profile. **E5 / the cluster engine** is the not-yet-built part of S3 that decides how well a user fits a job. **The WoW curve** means World of Warcraft leveling: each level costs more than the last, so early levels come fast and later ones take forever. **Numbers 3 and 4** are the two CV-quality scores that already exist as a team tool — "is this CV well made" and "is it aimed at this job".*

---

## WHERE THE COUNCIL AGREES

**1. Do not put a number on the person. (5 of 5)**

Every role landed here. Four said it outright — Executor, Contrarian, Evidence Scout, Fundamentalist. The Expansionist argued for keeping a level number, but only as small type inside a bar, never as a headline. So even the dissenter agrees the number cannot be the loud thing on screen.

The reason is simple. In a game, your character is not you. In a job app, the character *is* you. "Level 3" next to your name is read as "I am a 3."

**2. Kill the WoW curve. (4 of 5, and the fifth rebuilt it by accident)**

Executor, Contrarian, Evidence Scout and Fundamentalist all reject it. The Expansionist proposed a curve based on "how much each answer teaches us" instead. But information gain also shrinks over time. So that curve slows down too. Two peer reviewers caught this: it is the same grind trap wearing a nicer name.

**3. The two CV-quality scores stay internal. (5 of 5, zero dissent)**

This is the highest-confidence item in the whole council. Nobody wanted numbers 3 and 4 on the user's screen. They carry the exact "you are poor" failure mode we are trying to avoid.

**4. There is a real contradiction in the product owner's proposal. Three roles found it independently.**

Executor, Contrarian and Fundamentalist each named it without seeing each other's work: **a curve that caps near 100 is a completeness score. Decision 5 forbids completeness scores and says levels are endless. A capped, endless scale cannot exist.**

That agreement matters because it is not a taste judgment. It is a logic error. Three different reasoning styles hit the same wall.

---

## WHERE THE COUNCIL CLASHES

**Clash 1 — Show a small level number, or none at all?**

The Expansionist says a small number inside a bar is safe. Everyone else says no number.

**Stronger position: no number.** The Expansionist asserted safety but never demonstrated it. Three peer reviews said so. Worse, the Contrarian found a hole in the Expansionist's own upside case: if the level is later shown to employers as a trust signal, it becomes a grade by proxy — the exact thing we banned.

**Clash 2 — Named ranks ("Explorer", "Builder") instead of numbers?**

The Evidence Scout proposed this. The Expansionist's review took it apart, correctly.

**Stronger position: no ranks either.** Names are still ordered. "Explorer" is clearly below "Builder". You have moved the grade from numbers to words, not removed it. And endless levels would need endless names. Also, the Scout's evidence was the weakest in the council: LinkedIn's "Profile Strength" bar is widely criticised for making people feel behind. It is a warning, not a model to copy.

**Clash 3 — Is the match percent itself actually safe?**

Stage 1 mostly assumed yes. Stage 2 broke that assumption. The Executor raised the doubt, then the Contrarian and the Evidence Scout both escalated it in review.

The worry: if a user with no CV sees 34%, 31%, 28% on every card, they will read "I am a 30% person" no matter where the number sits.

**Stronger position: the doubters.** Moving the number from the person to the job helps. It does not fully protect. This is the live risk in the recommendation below.

---

## BLIND SPOTS THE COUNCIL CAUGHT

**Nobody defined what the match percent means.** The Contrarian's review found this, and it is the sharpest catch of the session. "34%" could mean 34% chance of being hired, or 34% of the job's requirements covered, or 34% confidence from thin data. Four of five roles recommended showing this number without saying what it is.

**The profile document may be a better knowledge gauge than any bar.** The Executor's review found this. Decision 4 already promises that a line writes itself into your profile on every answer. Watching real facts appear — "Added: managed a €2M budget" — proves the system is learning, with no number anywhere. It makes the level redundant. This raises a soft flag on Decision 4's *build order* (bar first, then document): the document may be the stronger thing to build first. Not a contradiction, but worth a second look.

**Nobody handled the returning user.** The Expansionist's review caught this. A user answers three questions at lunch, comes back Tuesday. Is the bar where they left it? Does it still mean the same thing? "What's at Stake" names month-two retention; not one Stage-1 answer addressed it.

**Nobody set a pass bar for E5.** Also the Expansionist's review. Every recommendation is conditional on the engine producing decent matches from thin data, and nobody wrote down what "decent" means or what happens if it fails.

**The CV shortcut breaks the gauge.** Half-caught by the Fundamentalist. Decision 1 says uploading a CV auto-answers questions. So a CV user's bar fills instantly and a no-CV user starts empty. A bar that fills based on what you arrived with is a strength meter, not a knowledge meter.

*One honesty note: the Fundamentalist's Stage-2 review was never finished. It output its raw thinking notes and stopped mid-sentence. Its two half-formed catches are kept above. Its vote in Stage 1 stands and was clear.*

---

## THE RECOMMENDATION

**The fork in the road: put a number on the person, or put it only on the job. Put it only on the job.**

**Ship Option C, with three conditions.**

1. **One user-facing number: the match percent on the job card.** Nothing else gets a number.
2. **The level bar stays, with no number, no level count, no rank name.** Label it as a countdown, not a score. "3 answers until your next jobs." A countdown says how far the prize is. A score says how good you are.
3. **Flat pace. Five questions, three cards. Every time.** No curve to tune, no cap, no grind. This satisfies Decision 5 exactly as written: the bar only ever measures the distance to the next unlock. Since each unlock is a fixed five questions, question count *is* the honest measure of that distance — no claim-graph maths needed.

Three things must come with the number, or it becomes the grade we banned:

- **Define it in one plain sentence.** My recommendation: *"34% match = you have told us 34% of what this job asks for."* Coverage, not hire-probability. Coverage is explainable, and a low score honestly means "you have not told us yet", not "you are not good enough".
- **Always show the reasons.** The Contrarian's pattern: *"34% match. Missing: budget size, tools used, team size."* This is the single best idea produced by the council. It turns the number into a to-do list.
- **The first reveal shows the user's three best-matching jobs, not three random ones.** Pick the top three by coverage across the whole corpus. Even a thin profile then sees its own personal best, not an average.

Numbers 3 and 4 stay in the workbench. The product owner's WoW curve is rejected on a logic ground, not a taste ground: **a cap near 100 contradicts Decision 5's endless levels.**

**Confidence: high** on removing the level number — five roles, plus a named contradiction. **Medium** on the match percent being safe.

**The single condition that reverses this:** if the E5 engine cannot produce at least one card above ~55% for a no-CV user after five answers, in most test cases, then the percent *is* the grade. In that case show bands on the first reveal instead — "Strong match / Possible / Stretch" — and let real percentages appear only once the profile has enough signal to earn them.

---

## THE ONE THING TO DO FIRST

**Write one sentence defining the match percent, then set the pass bar for E5 against it — before any bar or card gets built.**

On one page, in this order:

> The match percent means: *you have told us N% of what this job asks for.*
> E5 passes if, for a user with no CV and five answers, it returns at least one job at 55% or higher — in 4 out of the 5 fixed test cases we already use for the CV workbench.
> If E5 fails that bar, the first reveal shows bands, not percentages.

That is one hour of work. It reuses the five test cases that already exist. It is the only thing that decides whether this recommendation stands or flips — and everything else on the screen is downstream of it.

---

## Council Composition

- Model A (Executor) → Fireworks (glm-5p2)
- Model B (Expansionist) → Fireworks (minimax-m3)
- Model C (Contrarian) → Codex (gpt-5.5)
- Model D (Evidence Scout) → Fireworks (qwen3p7-plus)
- Model E (Fundamentalist) → Fireworks (kimi-k2p6)
- Chairman → claude-opus-4-8 [max] (Claude Code CLI)