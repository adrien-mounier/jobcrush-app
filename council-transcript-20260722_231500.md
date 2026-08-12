# Council Transcript

**Session:** 2026-07-22 23:15:00  
**Question:** JobCrush UX/UI council decision: How many numbers does the onboarding user see, and what does each mean?

Repo/product context: jobcrush-app is a Fastify + Next.js hosted product. The onboarding reward structure has just been grilled. S3 is the upcoming hunt: show job cards with tailored CVs behind them. CV reasoning source of truth is docs/cv-brain. docs/cv-quality-kickoff.md locks two internal CV-quality scores: Well made = mechanical lint over CV writing rules; Aimed at this job = model-panel judgment of whether the tailored CV surfaces the right things. Those two never merge and were originally defined as a workbench/regression harness, not a live user meter.

Locked constraints from parent session. Do not re-open unless there is a real contradiction:
1. One flow for everyone. CV upload is only a shortcut that auto-answers questions.
2. Cards are the payoff, CV is the by-product. A card = one job with Match % and a tailored CV behind it.
3. Earn cards: about 5 questions first, then 3 real, fully visible, scored cards.
4. Three feedback speeds: instant profile-document update, slow level bar, rare card unlock.
5. Endless levels, never finite 100% complete. Bar only measures distance to next unlock.
6. Wall after reveal, on actions: 5 questions -> 3 scored cards fully visible -> account required to save/apply/see rest/get alerts. Google OAuth leads. Answers persist server-side from question 1. Reversal if v1 cards are not obviously better than LinkedIn search within 10 seconds: move wall before reveal.
7. Front door has one central invitation to be interviewed plus small CV-upload shortcut.
8. CV buys one big jump, then game continues. Upload -> visible level-up. Good CV = fewer questions to useful cards; poor CV = more. More answers = better profile/tailoring/chances.

Numbers currently in the design:
1. Level/progress bar: how much JobCrush knows about the user.
2. Match % on each job card: user vs this specific job.
3. Well made: mechanical CV quality lint.
4. Aimed at this job: whether tailored CV targets the right things.

Candidate answers:
A. Two visible numbers: Level and Match %. CV-quality scores stay internal. Parent recommendation.
B. Three visible: add a CV-quality number.
C. One visible: Match % only; level bar has no number.
D. Something else: named rank, movement-only, fix-actions, etc.

Stress test: Candidate A means the bad-CV user and good-CV user both start at Level 1; good-CV user just climbs faster because upload gives a jump. Is that honest, or a comforting lie that hides that their CV is weak and hurting matches?

Required verdict:
1. State how many numbers the user sees, and which.
2. Name/frame each visible number. Can a 'how much we know about you' gauge survive real users without being read as a grade?
3. Answer the honesty question. Does hiding CV quality protect users or cheat them? If it cheats them, what truth-shape avoids demotivation?
4. Name failure modes, especially month-two returning-user problems.
5. Name any real contradiction in the eight locked decisions.

Prefer plain English. One idea at a time. A concrete example before abstraction.

---

## Framed Question

JobCrush UX/UI council decision: How many numbers does the onboarding user see, and what does each mean?

Repo/product context: jobcrush-app is a Fastify + Next.js hosted product. The onboarding reward structure has just been grilled. S3 is the upcoming hunt: show job cards with tailored CVs behind them. CV reasoning source of truth is docs/cv-brain. docs/cv-quality-kickoff.md locks two internal CV-quality scores: Well made = mechanical lint over CV writing rules; Aimed at this job = model-panel judgment of whether the tailored CV surfaces the right things. Those two never merge and were originally defined as a workbench/regression harness, not a live user meter.

Locked constraints from parent session. Do not re-open unless there is a real contradiction:
1. One flow for everyone. CV upload is only a shortcut that auto-answers questions.
2. Cards are the payoff, CV is the by-product. A card = one job with Match % and a tailored CV behind it.
3. Earn cards: about 5 questions first, then 3 real, fully visible, scored cards.
4. Three feedback speeds: instant profile-document update, slow level bar, rare card unlock.
5. Endless levels, never finite 100% complete. Bar only measures distance to next unlock.
6. Wall after reveal, on actions: 5 questions -> 3 scored cards fully visible -> account required to save/apply/see rest/get alerts. Google OAuth leads. Answers persist server-side from question 1. Reversal if v1 cards are not obviously better than LinkedIn search within 10 seconds: move wall before reveal.
7. Front door has one central invitation to be interviewed plus small CV-upload shortcut.
8. CV buys one big jump, then game continues. Upload -> visible level-up. Good CV = fewer questions to useful cards; poor CV = more. More answers = better profile/tailoring/chances.

Numbers currently in the design:
1. Level/progress bar: how much JobCrush knows about the user.
2. Match % on each job card: user vs this specific job.
3. Well made: mechanical CV quality lint.
4. Aimed at this job: whether tailored CV targets the right things.

Candidate answers:
A. Two visible numbers: Level and Match %. CV-quality scores stay internal. Parent recommendation.
B. Three visible: add a CV-quality number.
C. One visible: Match % only; level bar has no number.
D. Something else: named rank, movement-only, fix-actions, etc.

Stress test: Candidate A means the bad-CV user and good-CV user both start at Level 1; good-CV user just climbs faster because upload gives a jump. Is that honest, or a comforting lie that hides that their CV is weak and hurting matches?

Required verdict:
1. State how many numbers the user sees, and which.
2. Name/frame each visible number. Can a 'how much we know about you' gauge survive real users without being read as a grade?
3. Answer the honesty question. Does hiding CV quality protect users or cheat them? If it cheats them, what truth-shape avoids demotivation?
4. Name failure modes, especially month-two returning-user problems.
5. Name any real contradiction in the eight locked decisions.

Prefer plain English. One idea at a time. A concrete example before abstraction.

---

## Stage 1: Advisor Responses

### Executor (Model A)

## 1. DIRECT ANSWER

**Two numbers, but not the two the parent recommended as-is. Show Match % as a real percent, and show the Level as a countdown ("2 answers to your next card") — not a percent, not a "profile strength" grade. CV-quality scores stay internal. So: Candidate A, with the Level number reframed toward D.**

Here's the concrete picture. A user finishes 5 questions and sees three job cards: "Warehouse Ops Lead — 71% match," "Site Coordinator — 64%," "Logistics Admin — 52%." Under the deck, one small line: "Answer 2 more to unlock your next card." That's it. Two numbers on screen: the Match % (honest, per-job) and a tiny countdown (movement, not a grade).

The reason to hide the CV-quality scores isn't kindness — it's that **a raw "your CV: 43/100" is a number with no next step, and a number with no next step is the thing I hate most.** The honesty about a weak CV should live in two places that already exist: the Match % is genuinely lower, and the fix-this actions (from S2) name the exact weakness. Truth as an action, not a report card.

But — and this is the load-bearing part — **that argument only holds if Match % actually drops for a weak CV and rises when the CV improves.** If Match % is computed mostly from role/keyword overlap and barely moves when writing quality changes, then hiding the CV-quality score IS a comforting lie, because there's no honest signal anywhere. So the answer to your stress test is conditional: A is honest *if and only if* Match % reflects CV weakness. That's testable, and it's the first thing to check.

## 2. EXECUTOR LENS

**Monday morning, first step — before touching any UI:** run 3 CVs through the existing pipeline — one strong, one weak, one middle — for the same job, and read the Match %. If the weak CV lands within a few points of the strong one, stop. You don't have a UI decision, you have a scoring bug. Everything below assumes this check passes.

**Full sequence (assuming it passes):**
1. Confirm Match % is already surfaced on cards (it's in the S3 design). No new number to build there.
2. Change the Level bar's label from any percent to a countdown string: "N answers to next card." The bar can still fill; the *number* is the countdown. This is a copy + label change, not a new system.
3. Wire **nothing** user-facing to `well-made` / `aimed-at-this-job`. They stay in the workbench harness exactly as `cv-quality-kickoff.md` locked them. Zero new work — the lazy win is that Candidate B is the only option that requires building a whole new display surface, and you're not building it.
4. Make sure the fix-this actions are reachable from a low card, so a weak-CV user has somewhere to click.

**Where it breaks in practice:** the "countdown" needs a real number behind it — *which* 2 answers, and does answering them actually move a card into unlock range? If the level→unlock mapping is hand-wavy, "2 answers to next card" becomes a lie the first time someone answers 2 and nothing unlocks. That mapping is unresolved and it's the actual dependency, more than the number-count question.

**Missing decision:** nobody has defined what makes the level bar *move per answer*. Decision 4 calls it a feedback speed; decision 5 says it only measures distance to a rare unlock. Those pull opposite directions (see §5).

## 3. FAILURE MODES

- **Match % doesn't track CV quality** → the whole honesty argument collapses and A becomes the comforting lie your stress test warns about. Highest uncertainty; check it first.
- **The "how much we know" gauge gets read as a self-worth grade anyway.** Two users compare: "I'm Level 5, you're Level 2." Now it's a social grade of the person, which is exactly what you wanted to avoid. A countdown label ("2 to next card") resists this better than "Profile strength 40%," but it doesn't fully kill it. A gauge survives *only* if every reading of it points at the next action, never at a total.
- **Month-two returning user — the dead bar.** They've answered everything cheap, so the countdown says "0 answers left" but the next unlock needs something they can't easily give. Bar sits still, feels broken, and the one-time CV-upload jump (decision 8) already fired — there's no repeat hook. Endless levels only help if there's *always a cheap reachable next action*, and today there isn't a defined supply of those.
- **Stale Match %.** Month-two user opens saved cards; the jobs are gone or the market shifted, but the 71% is frozen. A number that was honest in July is a lie in August unless it's recomputed or dated.
- **I'm most uncertain about** whether the countdown framing genuinely reads as "game progress" vs "grade" with real users. That's an empirical question one 5-user test answers faster than any council can argue it.

## 4. FINAL RECOMMENDATION

**Ship two numbers — Match % as a percent, Level as a countdown to the next card — and keep both CV-quality scores internal. But gate the whole decision on one 20-minute test Monday morning: does Match % actually drop for a weak CV?** If yes, Candidate A (with the Level reframed from percent to countdown) is honest and cheapest to build — the truth about a weak CV lives in the lower Match % plus the existing fix-this actions, which is a next step, not a demotivating grade. If no, you don't have a numbers question, you have a scoring bug, and you fix that before touching the UI.

**One real contradiction to resolve before building (§5/§2):** Decision 4 makes the Level bar a *feedback speed* (should move per answer), while Decision 5 says it *only measures distance to a rare unlock*. A slow bar creeping toward a rare event gives almost no per-answer feedback — so it can't be both "a feedback speed" and "rare-unlock distance." Pick one: either the bar visibly moves every answer (feedback), or it's a rare-unlock meter (not a feedback speed). That choice, not the count of numbers, is what actually determines whether onboarding feels alive.

### Contrarian (Model B)

## 1. DIRECT ANSWER

**How many numbers, which ones?**  
Two numbers, but not the two in Candidate A. Users see **Match %** on each job card and a **CV strength indicator** that is a single, actionable quality score—not the internal “Well made” / “Aimed” pair. The level bar becomes a purely visual, numberless progress track (like a filling battery) that signals progress toward the next card unlock, not “how much JobCrush knows about you.”

**Framing the visible numbers:**
- **Match %** – “How well your profile fits this job.” Kept exactly as-is; it’s the core payoff.
- **CV strength** – Branded as “CV readiness” or “CV boost.” It’s one number (1–100) that merges the two internal scores with a rule: it goes up when you fix concrete things (missing dates, vague bullets, missing keywords) and down when the system detects new gaps. It is shown *only after the upload shortcut is used*, never before. A first-time user who types answers never sees it—they just get cards.

**Can the level gauge survive without being read as a grade?**  
Only if you remove the number and stop calling it “how much we know about you.” Once you attach a digit, users treat it as a grade on themselves. A numberless bar with micro-animation (“+3 cards until next unlock”) avoids the grade trap. The label “JobCrush learning” is safer than “your profile completeness,” because completeness implies a finish line and a judgement.

**Honesty question: Does hiding CV quality protect or cheat?**  
Hiding the twin internal scores protects the user from noise; hiding the *fact* their CV is weak cheats them. A user who uploads a poorly formatted, unfocused CV and sees no feedback will blame the matches, not the input. The honest shape is: after upload, show one clear, non-judgmental strength score with a star or shield icon, plus one concrete fix action (“Add your current job title to boost relevance by 12 points”). That truth avoids demotivation because it ties the number to something the user can immediately change, not a permanent verdict.

**Failure modes (especially month-two returnees):**
- **The returning user who uploaded a CV last month.** They come back, see CV strength 68, remember it was 72, and rage-quit because “my CV got worse.” You must show a changelog (“We’re now matching against 40 new jobs in your field—adding your certification will raise this.”) or the score rots into a trust-killer.
- **The “Level 1 forever” problem.** If the bar is numberless, a user who answers 5 questions, gets 3 cards, and then stops for two months returns and still sees a half-full bar with no number—they may think the system forgot them. The bar needs a timestamp or a “last active” hint, and a low-friction way to nudge it without re-answering everything (e.g., “3 new jobs in your area—view one to progress”).
- **Match % obsession without CV context.** A user with a weak CV sees low match percentages and concludes the product doesn’t work. Without a CV strength signal, they have no lens to understand *why* the matches are low. So the hidden CV quality cheats in month two.

**Contradiction check in locked decisions:**  
Constraint 2 says “CV is the by-product,” yet constraint 8 gives CV upload a big jump and makes CV quality central to question count. That’s not a contradiction but a fudge: the product claims cards are the payoff, but the onboarding reward structure now treats CV quality as the engine. If the CV is truly a by-product, its quality shouldn’t gate the core experience so heavily. The locked decisions are consistent on paper but schizophrenic in user perception—users will feel the CV is the entrance exam, not a side effect.

---

## 2. CONTRARIAN LENS

The whole “Level = how much we know” framing is a comforting lie that will explode when the first user uploads a terrible CV, gets a big level jump, and then sees mediocre cards. The assumption that a level-up from a CV upload feels rewarding regardless of CV quality is dangerous. In reality, a bad-CV user will think: “I gave you my CV, you said you learned a lot, now you’re showing me junk. You’re either lying or stupid.” That moment destroys trust irreparably.

Everyone is glossing over the fact that **the level bar is a proxy for user effort, not system knowledge.** When you say “how much we know,” users think you’re building a model of them. But a poorly parsed CV doesn’t give the system true knowledge—it gives noisy signals. So the level bar becomes a participation trophy, not a truthful gauge. Card Match % then undermines it because it reflects the actual (poor) knowledge. The user sees a cognitive dissonance: high Level, low Match %. The only way to reconcile that is to believe the system is broken. You’ve manufactured your own trust crisis.

The parent recommendation’s answer to the honesty question (“hiding CV quality protects users”) is backwards. It protects the *designer’s aesthetic* of a clean, frictionless flow, not the user. Users are not fragile; they can handle a CV strength signal if it comes with agency. The real failure mode isn’t demotivation from a low score—it’s learned helplessness from being kept in the dark about why their results suck. And that helplessness will kill month-two retention deader than any low number.

---

## 3. FAILURE MODES

**What would make my direct answer wrong?**
- If JobCrush cannot produce a single, trustworthy CV strength score that updates sensibly over time, then my proposed CV strength number becomes a random number generator that wrecks trust even faster. Two bad internal scores merged badly are worse than zero.
- If the numberless level bar fails to communicate progress clearly, users may not understand what actions unlock cards, turning the entire reward loop into a mystery meat experience. Some users genuinely need a numeric target. Removing the number might increase anxiety for goal-oriented job seekers who want to know exactly how much effort until the next unlock.
- If CV strength is shown only to uploaders, the typing path becomes a second-class experience, and users who later upload a CV might see a retroactive score that “judges” their past effort, causing resentment.

**Greatest uncertainty:** Can the product actually deliver on CV strength as an actionable, single-number feedback loop? The internal scores were designed as regression harnesses, not user-facing metrics. Unless there’s a reliable, interpretable way to map them to one number and explain changes, my proposal is theoretically honest but practically dangerous. Also, the “move wall before reveal if cards aren’t better than LinkedIn search in 10 seconds” is a loaded gun—if the cards aren’t immediately impressive with a weak CV, the whole flow craters before CV strength ever surfaces.

---

## 4. FINAL RECOMMENDATION

**Kill the “Level = knowledge” narrative entirely.** Replace the number on the progress bar with a subtle “3 actions until next unlock” counter (no permanent label). Let Match % stay as the primary visible metric on cards. Introduce a single, action-oriented CV health score *only* for users who upload a CV, framed as “CV Boost,” with a clear, editable fix suggestion attached. Test this against the parent’s two-number approach with a cohort of users who upload poor CVs—watch trust and return rate, not just conversion. If the single CV score can’t be made reliable in two weeks, fall back to zero CV numbers and instead show concise, human-readable feedback like “Your CV is missing dates—add them for better matches,” with no score at all. The honesty line is this: never hide that CV quality matters when it demonstrably does.

### Evidence Scout (Model C)

## 1. DIRECT ANSWER

**1. How many numbers the user sees, and which:**
The user should see exactly **two numbers**. 
First, the **Match %** on the job card. Second, a **Progress/Distance indicator** (e.g., "2 steps to next card"). The internal CV-quality scores ("Well made" and "Aimed at this job") must remain hidden as raw integers. 

**2. Naming and framing each visible number:**
*   **Match %:** Frame it as **"Job Fit"** or **"Match"**. 
*   **Progress Bar:** Frame it as **"Distance to Next Card"** or **"Steps to Next Unlock"**. 
*   *Can the gauge survive without being a grade?* Yes, but only if it measures *system input* rather than *user output*. If the bar says "Level 4," users read it as "I am a Level 4 candidate" (a grade). If it says "3 questions to your next job card," it reads as "I am 3 actions away from a reward" (a progress tracker). Concrete example: Duolingo measures "XP" (input/time spent) and "Leagues" (output/rank). Keep your bar as XP. It measures how much work is left, not how good the user is.

**3. The honesty question:**
Hiding a standalone "CV Score" protects users from the anxiety of a red number, but hiding the *impact* of a bad CV cheats them. If a user has a terrible CV and sees a 60% Match, they need to know *why* it's 60% and *how* to fix it, otherwise they will just blame your algorithm. 
*The truth-shape that avoids demotivation:* Translate CV quality into the **Match % delta**. Do not show a static CV grade. Instead, show the upside. Example: "Your Match for this role is 62%. Adding three specific metrics to your experience section will push this to 85%." The CV quality becomes visible as *actionable potential*, not a permanent judgment.

**4. Failure modes (especially month-two returning users):**
*   **The Endless Treadmill:** By month two, the "endless level" loses its novelty. If the bar just means "distance to next unlock," and the unlocks are just "more of the same job cards," the user realizes they are running on a hamster wheel. Gamification decays when the reward (a card) stops feeling like a meaningful step toward the actual goal (a job offer).
*   **The False Precision Trap:** If a user sees an 84% Match, applies, and gets an automated rejection, they will feel betrayed by your number. Exact percentages imply a scientific precision that ATS (Applicant Tracking Systems) and human recruiters do not actually possess.

**5. Real contradiction in the eight locked

### Fundamentalist (Model D)

The user wants me to play the "Fundamentalist" role on an AI advisory council.
The topic is JobCrush onboarding UX/UI, specifically how many numbers the user sees during onboarding.
Current options:
- Level/progress bar: How much JobCrush knows.
- Match % on each job card: User vs specific job.
- Well made: CV quality lint (internal only by original design).
- Aimed at this job: CV tailoring judgment (internal only by original design).
Candidate answers: A (Level + Match%), B (Level + Match + CV quality), C (Match% only), D (Something else).

Stress test: Good-CV user and Bad-CV user both start at Level 1, but good-CV climbs faster. Is this honest or a comforting lie?

Required verdict:
1. State how many numbers, and which.
2. Name/frame each visible number. Can "how much we know about you" survive without being read as a grade?
3. Answer the honesty question. Does hiding CV quality protect or cheat? If cheats, what truth-shape avoids demotivation?
4. Name failure modes, especially month-two returning users.
5. Name any real contradiction in the eight locked decisions.

Format:
## 1. DIRECT ANSWER
## 2. FUNDAMENTALIST LENS
## 3. FAILURE MODES
## 4. FINAL RECOMMENDATION

Let's break down the problem.
The product is JobCrush. Onboarding flow: answer questions -> get job cards -> see tailored CV.
Two internal scores: Well made (lint), Aimed at this job (targeting).
The question asks: how many numbers does the user see, and what do they mean?

As the Fundamentalist, I need to challenge assumptions, ask what we are actually solving, and potentially say "you are asking the wrong question."

Assumptions in the question:
- Users *need* to see numbers at all.
- The numbers represent "truth" or "progress" in a way that matters to the user's actual goal (getting a job).
- "How much we know about you" is a useful metric for the user.
- Match % is a useful metric for the user.
- CV quality is a hidden internal thing vs a visible external thing.

What is the user actually trying to solve? "I need a job." "I want to know if I have a chance at *this* job." "I want to know if my CV is good enough."
If JobCrush gives them a "Level" (how much JobCrush knows), the user doesn't care about JobCrush's knowledge; they care about their *employability*.
If JobCrush gives them "Match %", does the user trust it? Match % is notoriously gamified and often misleading (like Tinder match %, or LinkedIn job match). If Match % is high but they don't get an interview, the product loses trust.

The stress test: Good-CV and Bad-CV user start at Level 1. Good-CV climbs faster.
Is that a comforting lie?
If a user has a bad CV, their "Match %" will be lower, or their tailored CV will be poor. If we hide "Well made" and "Aimed at this job", are we protecting them or cheating them?
If I'm a user with a terrible CV, and I see "Match 80%", but my CV is garbage, I will apply and get rejected. JobCrush becomes a slot machine.
If JobCrush shows me my CV is garbage, it demotivates me. But maybe that's the truth I need.

Wait, the core assumption: "The onboarding reward structure has just been grilled."
The real problem isn't "how many numbers do we show." The real problem is "how do we communicate the user's actual state and trajectory without lying to them, while keeping them motivated to complete the profile and improve their materials?"

Let's look at the locked decisions:
1. One flow. CV upload is a shortcut.
2. Cards are the payoff. Card = Match % + tailored CV.
3. Earn cards: ~5 questions -> 3 scored cards.
4. Feedback speeds: instant profile update, slow level bar, rare card unlock.
5. Endless levels.
6. Wall after reveal.
7. Central invitation + CV upload shortcut.
8. CV buys one big jump. Good CV = fewer questions. Poor CV = more questions.

If "Poor CV = more questions to useful cards", how does the user experience this?
If they upload a CV, they get a "visible level-up". But if it's poor, they still have to answer more questions. Do they know *why* they have to answer more questions? If they just see "Level 2", they might think "okay, I leveled up." But a good CV user might be at Level 5.

What is the fundamental contradiction?
Locked decision 2: Cards = Match % + tailored CV behind it.
If the user's CV is bad, the tailored CV might still be bad (or JobCrush fixes it?).
Match %: How is it calculated? It's based on the profile. But if the profile is built from a bad CV, the Match % might be inaccurate.
Decision 8: Good CV = fewer questions. Poor CV = more questions. This implies the system *evaluates* the CV's utility. If the system knows the CV is poor, it needs more questions to compensate.

What are the visible numbers?
If we show "Level", it's a measure of *input* (how much data JobCrush has).
If we show "Match %", it's a measure of *output* (fit to a job).
But wait. A user with a bad CV and a complete profile might get a high Match %, but if their CV is mechanically poor, they won't get the interview.
So Match % is a lie if it ignores "Well made".
But "Well made" and "Aimed at this job" were defined as workbench/regression harness, not a live user meter.

Are we asking the wrong question?
The question asks "How many numbers does the onboarding user see, and what does each mean?"
The underlying assumption is that numbers are the right way to communicate progress and fit.
But numbers imply precision. Match % implies a 87% chance. Level implies XP.
What if the user doesn't need numbers, but needs *status* and *actions*?
Instead of "Level 3", it's "We know enough to show you 3 jobs."
Instead of "Match 82%", it's "Strong Match" or "Stretch".

Let's evaluate the stress test: Is it a comforting lie to hide CV quality?
If I upload a bad CV, I get a small jump. I see I'm at Level 2. The other guy is at Level 5.
Do I know I'm at a disadvantage? No. I just think I answered fewer questions.
When I see my Match %, is it high or low?
If JobCrush shows me a 90% match, but my CV is terrible, JobCrush is lying. It's cheating the user.
If JobCrush hides the fact that my CV is weak, it's protecting my ego but setting me up for failure.
So hiding CV quality *cheats* them.

But how to show it without demotivating?
Don't show a "CV Quality Score". Show it as *actions*.
"Your CV is missing X, Y, Z. Add these to unlock better matches."
Or, integrate it into the "Match".
If the CV is bad, the Match % should reflect that. But Match % is "user vs this specific job". If the user has the skills but a bad CV, is it a match?
A match implies they can get the job. If the CV is bad, they can't.

Let's look at the locked decisions for contradictions.
Decision 4: "Three feedback speeds: instant profile-document update, slow level bar, rare card unlock."
Decision 5: "Endless levels... Bar only measures distance to next unlock."
Decision 8: "CV buys one big jump... Good CV = fewer questions to useful cards; poor CV = more."

Contradiction: If the bar "only measures distance to next unlock" (Decision 5), then a "visible level-up" from CV upload (Decision 8) means the bar jumps forward. But if the CV is poor, they need more questions. So the poor CV gives a smaller jump.
If the user sees the bar, they see the jump.
But the user doesn't know *why* the jump was big or small.
If we hide CV quality, the user who uploaded a CV and got a small jump might think "my CV upload didn't do much, this app is broken." They don't realize it's because *their CV is bad*.

Real contradiction: Decision 2 says "Cards are the payoff... A card = one job with Match % and a tailored CV behind it."
Decision 8 says "Good CV = fewer questions to useful cards; poor CV = more."
If a poor CV requires more questions, the user is being penalized but not told why. They just see a slower bar. That's obscure.

Fundamentalist take:
The question asks "How many numbers..." This assumes the user wants to monitor metrics.
The user wants a job. They want to know "Can I get this job?" and "What do I need to do to get it?"
Numbers like "Level" and "Match %" are gamified abstractions that create a false sense of objectivity.
"Level" measures your data contribution to JobCrush, not your employability.
"Match %" measures keyword overlap, not human hiring probability.
Showing "Level" as "How much JobCrush knows" is honest about the *system's* state, but users will read it as "How good my profile is." If I upload a CV and only go to Level 2, I think my profile is weak. But actually, my CV was just unparseable.

Can "how much we know about you" survive real users without being read as a grade?
No. Users always read progress bars as grades. If the bar is slow, they think they are failing.
Especially with Decision 8: poor CV = more questions. The user will feel they are being punished, but won't understand it's a fixable problem with their CV.

So what is the answer?
We should not show "Level" as a number. Show it as a progress bar to the *next card*, with explicit labels: "3 questions until your next job card."
This removes the "grade" feeling. It makes it transactional and honest. You are paying with answers to get cards.

What about Match %?
Match % is a number. Is it honest?
If we hide CV quality, Match % is dishonest because it ignores the delivery mechanism (the CV).
But we can't show two CV scores to the user (Well made, Aimed).
So the Match % must be the *only* number, and it must be a composite truth.
But wait, the prompt says CV-quality scores were defined as a workbench, not live meter. We shouldn't merge them into a single live score if they are structurally different.

Maybe the answer is: One visible number: Match %.
But Match % alone is dangerous if the CV is bad.
So we need to show CV health not as a number, but as *fix-actions* or *status*.
Instead of "Well made: 40%", say "Your CV has formatting issues that hide your skills. Fix them to improve matches."
This is not a number. It's a task.

Let's revisit the question's stress test: "Is that honest, or a comforting lie that hides that their CV is weak and hurting matches?"
It is a lie. It cheats them.
What truth-shape avoids demotivation?
Not a score. A diagnosis + prescription.
"Your CV is holding back your matches. Here are 3 things to fix."

So how many numbers?
One number: Match %.
But the Match % must be conditional. If the CV is bad, the Match % should be capped or reduced? Or the Match % is purely algorithmic, and we show a separate warning: "CV Health: Needs work."
The prompt asks: "State how many numbers the user sees, and which."
If we say "One number: Match %", what about the Level bar?
Decision 4 says there is a "slow level bar".
If we show a number on the bar, it's a grade. If we show a bar without a number, it's just progress.
The question asks "How many numbers... and what does each mean?"
Candidate A: Two numbers: Level + Match %.
Candidate C: One number: Match % only.

I think the Fundamentalist answer is:
You are asking the wrong question. You are trying to find the right *number* to represent a *relationship*.
The user doesn't need to know their "Level". They need to know how many questions until the next card.
They don't need to know their "CV Quality Score". They need to know if their CV is blocking them.

Let's formulate the Direct Answer.
Direct Answer: The user should see ONE number: Match %.
The "Level" should not be a number, just a visual progress bar labeled "X questions to next card." (Or "Profile Strength" but without a numeric value).
Wait, if the user sees "Match %", that's the payoff.
But does the user need to see CV quality?
If we hide CV quality, we cheat them. But showing a *number* for CV quality is demotivating.
So we show CV health as a *status* (e.g., "CV needs work to unlock better matches") or *actions*, not a number.

So, numbers: One. Match %.
Wait, if there is a level bar, is it a number? The question says "Level/progress bar: how much JobCrush knows".
If we show "Level 3", that's a number.
If we show "Match 82%", that's a number.
I will say: One visible number: Match %.
The progress bar should not display a numeric level. It should display progress to the next card unlock.

Let's check the "Honesty question".
If bad-CV user and good-CV user both start at Level 1.
If we hide CV quality, are we cheating them?
Yes. If a user uploads a bad CV, they get fewer rewards (smaller jump, more questions). If they don't know *why*, they will blame the app or feel inadequate. They need to know their CV is the bottleneck.
But showing a "CV Score: 2/10" is demotivating.
The truth-shape: "Your CV gave us a baseline, but it's missing details we need to find your best matches. Answer 3 more questions to compensate."
This explains the *consequence* (more questions) without a grade. It attributes the cause to the CV's *completeness*, not its *quality*. This is honest but soft.
"Well made" (mechanical lint) -> "Your CV format is hiding some skills."
"Aimed at this job" -> "We can't tell if you targeted this."

Let's look at the 8 locked decisions for contradictions.
1. One flow. CV upload is shortcut. -> OK.
2. Cards are payoff. Card = Match % + tailored CV. -> OK.
3. Earn cards: ~5 questions -> 3 cards. -> OK.
4. Feedback speeds: instant update, slow level bar, rare card unlock. -> OK.
5. Endless levels. Bar only measures distance to next unlock. -> Contradicts "Level" being a number? If it's endless and only measures distance, it's not a level, it's a progress bar. The prompt says "Level/progress bar". If it's endless, a numeric "Level" is an RPG stat, which implies a grade.
8. CV buys one big jump. Good CV = fewer questions. Poor CV = more.
Contradiction: If CV buys a "big jump", but poor CV = more questions, then a poor CV does *not* buy a big jump. It buys a small jump. But the user expects a "big jump" because they uploaded a CV.
If the user uploads a CV and gets a small jump, they feel cheated.
If we tell them "Your CV was weak, so small jump", we demotivate them.
If we tell them "Your CV gave us some info, but we need more," it's honest.

Wait, a real contradiction:
Decision 5: "Bar only measures distance to next unlock."
Decision 8: "CV buys one big jump... Good CV = fewer questions... poor CV = more questions."
If the bar *only* measures distance to next unlock, then a "jump" means you skip distance.
But if a good CV means fewer questions, you skip more distance.
If a poor CV means more questions, you skip less distance.
This means the "jump" is variable.
Is that a contradiction? Not a logical contradiction, but a UX contradiction. The user expects "Upload CV = Big Jump". If they get a small jump, the promise of "big jump" is broken for bad CVs.
So Decision 8 is conditional, but phrased as absolute. "CV buys one big jump". This is a lie for bad CVs.

Let's write the sections.

## 1. DIRECT ANSWER
The user should see ONE number: Match %.
The "Level" should not be a number. It is a progress bar labeled with an action: "3 answers to your next job card."
CV quality must not be a number. It must be a status flag with a fix-action.
Hiding CV quality as a number is good. Hiding the *consequence* of CV quality is a lie.

## 2. FUNDAMENTALIST LENS
The question asks "how many numbers..." This assumes users want to monitor metrics.
Users want jobs, not metrics.
Numbers create false precision and feel like grades.
"Level" implies a game stat. "Match %" implies a probability.
If we show "Level 3", a user with a bad CV who is stuck at Level 2 will feel they are failing.
The real problem is: How do we communicate the user's *current capacity* and *next required action* without judging them?
The user doesn't care how much JobCrush "knows". They care what JobCrush can *do* for them right now.
So the progress bar shouldn't measure knowledge. It should measure distance to the next payoff (cards).
And Match % shouldn't be a raw number if the CV is broken. It should be contextualized.

Wait, if Match % is the only number, does it survive?
If a user has a bad CV but good skills, Match % might be 90%. But they won't get the interview.
So Match % must be tempered by CV health.
But we can't merge the scores.
So Match % is the fit. CV health is the delivery.
If CV health is poor, we should show a warning on the card: "High match, but your CV needs formatting fixes to get noticed."
This is not a number.

## 3. FAILURE MODES
Month-two returning user:
User comes back. They have a profile. They see the progress bar. But they already have cards?
If levels are endless, what does the bar measure for a returning user? (Decision 5: endless levels).
If the bar only

### Expansionist (Model E)

We need answer as Expansionist persona. Need follow exact structure. Need parse problem deeply. We need produce verdict: how many numbers user sees, framing, honesty question, failure modes, contradictions. Then expansionist lens, failure modes, final recommendation.

We are AI advisory council. We are Expansionist. Need be optimistic about upside, but still answer questions. Need plain English, one idea at a time, concrete example before abstraction.

We must respect locked constraints. We shouldn't reopen unless real contradiction. Need maybe find contradiction? Let's think.

We have jobcrush app onboarding reward structure. Need decide numbers visible to onboarding user. Options: A two visible numbers: Level and Match %. CV quality internal. B add CV quality. C Match only. D something else.

Parent recommendation likely A. We need give direct answer: best honest answer. Expansionist should look for upside. But direct answer no role constraints? The structure says direct answer first, honest best. Then expansionist lens. So direct answer likely A or D? Need decide based on arguments. Let's think through.

Constraints:
- CV quality scores internal: Well made, Aimed at this job never merge and were originally workbench/regression harness, not live user meter.
- Onboarding reward structure: 5 questions, 3 scored cards, wall after reveal.
- CV upload is a shortcut auto-answers questions; good CV = fewer questions; poor CV = more.
- Endless levels, bar only measures distance to next unlock.
- Cards payoff, CV by-product.
- Wall after reveal, actions; reversal if cards not obviously better than LinkedIn search within 10 seconds move wall before reveal.
- Front door central invitation to be interviewed plus small CV upload shortcut.
- CV buys one big jump, then game continues.

Question: how many numbers and what each means. Candidate A: Level and Match visible. CV quality internal. Stress test: candidate A means bad-CV user and good-CV user both start at Level 1; good-CV user just climbs faster because upload gives a jump. Is that honest, or comforting lie hiding that CV is weak and hurting matches?

Need answer honestly. Since CV quality scores internal, user sees Level and Match. But if CV weak, they might see lower match % and slower progression. Level is amount known. That is honest: a weak CV is not a grade of the person, but it yields less data. But does it hide that their CV is weak and hurting matches? The Match % itself signals that: if CV is weak, matches might be lower. But the user can't see CV quality. However "Well made" is mechanical lint over CV writing rules; if poor, it may lower matches. But the model-panel "Aimed at this job" is per-job, not global. So showing CV quality number could be confusing.

We need consider whether the "level" should be a number or named rank/movement. The question asks candidate A: Level and Match. Candidate C: Match only, level bar has no number. Candidate D: named rank, movement-only, fix-actions. Which is best?

We need decide final recommendation. Let's think about user psychology. The Level is described as "how much JobCrush knows about you." If endless, it is a progress bar to next unlock. It measures knowledge, not skill. It could be read as a grade. But maybe with proper framing it survives: "Profile power" or "Interview readiness". But user might see it as grade. However it is useful for motivation (game loop). The question asks can a 'how much we know about you' gauge survive real users without being read as a grade? We need answer. I think yes if framed as "how much data we've collected / how far to next card pack" not "how good you are". But many users may still interpret as grade. We can mitigate: name it "Profile fuel", "Distance to next unlock", no number maybe just a progress bar. Candidate C or D.

But constraints say: "Three feedback speeds: instant profile-document update, slow level bar, rare card unlock." So level bar is a feedback speed. It says "slow level bar". So a level bar is in the design. The question is whether it has a number. Candidate A has number, C has bar but no number. "Slow level bar" maybe no number? The locked constraints say "endless levels, never finite 100% complete. Bar only measures distance to next unlock." So a bar with no numeric percent is possible, but maybe a level number? Since endless levels, level number is visible. Candidate A includes Level number.

The prompt: "How many numbers does the onboarding user see, and what does each mean? Numbers currently in design: 1. Level/progress bar... 2. Match %... 3. Well made... 4. Aimed at this job..." Candidate answers include A two visible numbers: Level and Match. B three visible: add CV quality. C one visible: Match only; level bar has no number. D something else.

We need maybe answer D: "Two visible numbers, but the level number is actually a 'Jobs Unlocked' or 'Cards Ready' count, not a user grade." But D says named rank, movement-only, fix-actions. Could propose something like:
- Visible numbers: Match % and a progress-bar label that shows distance to next unlock (e.g., "3 more answers to next pack").
- Hidden: Well made & Aimed at this job.
- The level number can be named (e.g., "Profile fuel"), not "Level 1". Good CV users jump to a higher named tier (e.g., "Loaded" vs "Starter"), but still the number is distance to next unlock, not a grade.

Need address stress test: Bad-CV user and good-CV user both start at Level 1; good CV gives jump. Is that honest? If we call the level "how much we know," then both start with little knowledge; good CV gives more data, so jump is honest. It is not a comforting lie. It doesn't hide that their CV is weak because the app will show fewer cards and lower match %. But it also doesn't expose raw CV quality. However the app can still offer fix-actions after the wall: "Strengthen your CV" to improve matches. The user might infer from slower progression.

But the prompt's stress test explicitly asks: "Is that honest, or a comforting lie that hides that their CV is weak and hurting matches?" Need answer carefully. Candidate A: both at Level 1; good CV climbs faster. The level is a data gauge, not a value gauge. So it's honest if we name it as such. But the fact that their CV is weak isn't hidden because it affects the match % and the number of questions. However not telling them "your CV scored 42% on Well made" might protect them from demotivation early. But is it cheating them? The question says if it cheats them, what truth-shape avoids demotivation?

We need propose a truth-shape: Don't show a single CV quality score; instead translate quality into actionable next steps: e.g., "Add 3 missing facts and you'll unlock better matches." This is a truth-shape: progress language, not grade. Also "Your CV gets us 60% of the way to your first card pack" vs "Your CV is a C+". That reveals the same information without a grade.

Need name failure modes, especially month-two returning-user problems.

Also name any real contradiction in the eight locked decisions. We need examine. Is there a contradiction between "CV upload is only a shortcut that auto-answers questions" and "CV buys one big jump, then game continues. Upload -> visible level-up. Good CV = fewer questions to useful cards; poor CV = more." That seems consistent: shortcut auto-answers; good CV = more correct answers, jump; poor CV = fewer answers. But maybe "One flow for everyone" and "CV upload is a shortcut" contradicts "Good CV = fewer questions; poor CV = more"? If one flow for everyone, the number of questions could differ. But locked constraint says "One flow for everyone" meaning same sequence of types (5 questions, then cards), not necessarily identical number of prompts? Wait it says "One flow for everyone. CV upload is only a shortcut that auto-answers questions." Then "Good CV = fewer questions to useful cards; poor CV = more." So flow can vary length but same structure. Not a contradiction.

Is there a contradiction between "Cards are the payoff, CV is the by-product" and "CV quality scores internal: Well made, Aimed at this job"? CV quality is internal regression harness; fine.

Is there a contradiction between "Wall after reveal, on actions: 5 questions -> 3 scored cards fully visible -> account required to save/apply/see rest/get alerts" and "Reversal if v1 cards are not obviously better than LinkedIn search within 10 seconds: move wall before reveal"? If wall moved before reveal, the flow becomes: 5 questions -> account required -> 3 scored cards? The prompt says "Reversal if v1 cards are not obviously better than LinkedIn search within 10 seconds: move wall before reveal." That means if cards aren't compelling, ask account before showing cards. But locked says "Wall after reveal, on actions: 5 questions -> 3 scored cards fully visible -> account required to save/apply/see rest/get alerts." This is a conditional reversal, not contradiction. But the contradiction might be: moving wall before reveal would violate "3 scored cards fully visible before account"? Could be a real contradiction in user promise: if wall is after reveal, then users see cards without account; if moved before reveal, they must sign up before payoff. The reversal clause explicitly overrides, so it's a deliberate escape hatch, not a contradiction.

Maybe there is a contradiction between "Endless levels, never finite 100% complete" and "CV buys one big jump, then game continues. Upload -> visible level-up." If the level is a number, a jump is visible, but endless; okay.

Maybe the most interesting contradiction: Constraint 1 says "One flow for everyone" and constraint 8 says "CV buys one big jump, then game continues. Upload -> visible level-up. Good CV = fewer questions to useful cards; poor CV = more." If CV determines number of questions, then there is not literally one flow for everyone; there is one flow shape but variable length. But the parent session might consider "one flow" meaning same conceptual flow. We can say there is no real contradiction, just a tension: variable length is still one flow if the question types and order are the same. But is that a real contradiction? We could name it as a tension, not a contradiction, or say it's a real contradiction if interpreted strictly. But the instructions say "Name any real contradiction in the eight locked decisions. Do not re-open unless there is a real contradiction." We need be careful. If we find a real contradiction, we should name it; if not, say none. We should not invent contradiction to re-open. Let's identify real contradictions carefully.

Let's list decisions:
1. One flow for everyone. CV upload is only a shortcut that auto-answers questions.
2. Cards are the payoff, CV is the by-product. A card = one job with Match % and a tailored CV behind it.
3. Earn cards: about 5 questions first, then 3 real, fully visible, scored cards.
4. Three feedback speeds: instant profile-document update, slow level bar, rare card unlock.
5. Endless levels, never finite 100% complete. Bar only measures distance to next unlock.
6. Wall after reveal, on actions: 5 questions -> 3 scored cards fully visible -> account required to save/apply/see rest/get alerts. Google OAuth leads. Answers persist server-side from question 1. Reversal if v1 cards are not obviously better than LinkedIn search within 10 seconds: move wall before reveal.
7. Front door has one central invitation to be interviewed plus small CV-upload shortcut.
8. CV buys one big jump, then game continues. Upload -> visible level-up. Good CV = fewer questions to useful cards; poor CV = more. More answers = better profile/tailoring/chances.

Potential contradictions:
- "One flow for everyone" vs "Good CV = fewer questions; poor CV = more." Strictly, different users see different number of questions, so not identical flow. But "one flow" might mean same sequence/stages, not count. Is it a real contradiction? The parent session likely resolved this: CV upload is a shortcut, so flow is same. However, if the number of questions differs, the experience is not identical. But still one flow.
- "Wall after reveal" vs "move wall before reveal" reversal: Could be a contradiction if both are claimed as locked decisions. But the reversal is conditional, so it's a built-in override, not contradiction. But if both are locked, which is the rule? The phrase "Wall after reveal, on actions" is a decision, and "Reversal if..." is a decision too. It could be seen as a contradiction because they prescribe opposite wall placements. But it's a contingency plan, not a contradiction. Maybe we can name it as "the only real contradiction: the wall is simultaneously after reveal and possibly before reveal; the reversal is a conditional escape, not a contradiction, so it's managed by an A/B kill-switch." But the prompt says "Do not re-open unless there is a real contradiction." We can name it as a tension, not contradiction, or note it as a contingency. Maybe the safest is to say there is no real contradiction; the apparent ones are resolved by conditional logic. But the question explicitly asks to name any real contradiction. If none, say none.

- "CV buys one big jump, then game continues" vs "Endless levels, never finite 100% complete." If CV gives a big jump, could it make the level seem finite? No, because endless.

- "Cards are the payoff, CV is the by-product" vs "CV upload gives a big jump and affects number of questions" - not contradiction.

- "Front door central invitation to be interviewed plus small CV-upload shortcut" vs "CV is the by-product; CV upload is a shortcut" - consistent.

- "Match % on each job card" vs "CV-quality scores internal" - no contradiction.

- "Three feedback speeds" and "slow level bar" - okay.

- "Bar only measures distance to next unlock" and "Level number" - okay.

I think no real contradiction. But we need answer if none.

But maybe the stress test reveals a contradiction between constraint 1 and 8. Let's examine the phrase "One flow for everyone." If the user uploads a CV, auto-answers questions; they skip questions. If another user doesn't upload CV, they answer more. So the flows are not identical. But maybe "one flow" means there is a single onboarding sequence, not a branching wizard. The CV is a shortcut within the same flow. It still means users experience different number of prompts. Is that a contradiction? It is a tension between uniformity and personalization. The parent session likely accepted it as "same flow, different speed." I'd call it a tension, not a real contradiction. If we call it a real contradiction, we might be seen as re-opening. But the prompt asks to name any real contradiction. We can name the tension and say it is not a contradiction because the sequence is the same; the CV is a shortcut, not a branch. That satisfies the requirement.

Now direct answer: Need decide between A, C, D. Let's think about best honest answer.

Candidate A is parent recommendation. It might be safest but we need be honest and consider stress test. The question is: "How many numbers does the onboarding user see, and what does each mean?" The direct answer should be specific.

Given the locked constraints, CV quality scores are internal and not a live user meter. That strongly suggests answer A (two visible numbers: Level and Match). However, we might want to rename/frame the level to avoid grade reading. Candidate C (Match only; level bar no number) is also plausible because the level bar is "distance to next unlock" and not a grade. But the locked constraints say "slow level bar" and "endless levels" - a bar may still have a number (e.g., "Level 3"). If the level bar is a feedback speed, maybe a number helps. But if the number is read as a grade, then maybe no number. But the question asks to name/frame each visible number. So answer A frames them.

Let's think about user experience: Onboarding sees Level (e.g., "Profile fuel 1") and Match % per card. The level is not a grade but a measure of how much data JobCrush has collected. The Match % is a match between user and job. The CV quality is internal. The user might be told "Good CV = fewer questions." They see the level-up. The stress test: Is it honest that both start at Level 1? Yes, because the level is a measure of data, not CV quality. The app has not yet learned anything from the user; the CV is a data source that yields a jump. So it's honest. The CV weakness is not hidden because it affects the match % and the quality of the cards. If their CV is poor, they might get lower match % and more questions. But if they uploaded CV, maybe the auto-answers may be poor and the match % is lower. So the match % reflects the weak CV. However, the user might not know why. The app can show "We couldn't read much from your CV; answer a few more questions to improve matches." That's actionable truth.

But the prompt says "CV buys one big jump, then game continues. Upload -> visible level-up. Good CV = fewer questions to useful cards; poor CV = more." So a poor CV actually buys a smaller jump, not a big jump. Wait "CV buys one big jump, then game continues. Upload -> visible level-up. Good CV = fewer questions to useful cards; poor CV = more. More answers = better profile/tailoring/chances." So good CV => fewer questions => they jump further in the level (because they have answered more). Poor CV => fewer answers => less jump, more questions. So both start at Level 1, but the good CV jumps to maybe Level 4, poor CV jumps to Level 2. They then continue. So it's not identical. The level number reflects how much we know. This is honest. But does it hide that their CV is weak? The user sees they didn't jump as far. They can infer. So not a lie.

But what about users who don't upload CV at all? They answer all questions, also start at Level 1. They will see progress after each answer. Good.

Honesty question: Does hiding CV quality protect users or cheat them? It protects them from being graded on a document they might not have prepared for the app. It also avoids a single score that is not actually a live user meter but a regression harness. However, if the CV quality is materially hurting their matches, not telling them could be seen as cheating. But the Match % is the honest signal of that. The user can see "Match 32%" and infer their profile is not aligning. The app can provide fix actions (e.g., "Your CV is missing key skills for these jobs"). The truth-shape: surface the *impact* of CV quality, not the *score*. For example, "Your CV gets us 40% of the way to great matches; add these 2 details to reach 80

---

## Stage 2: Peer Reviews

### Executor's Peer Review

**Framing note:** Two of the four (Fundamentalist D, Expansionist E) submitted mostly raw scratch-thinking and never landed a committed answer — E's text literally cuts off mid-sentence. I'm judging them on the arguments that actually surfaced, not on the missing conclusions.

## Q1. Which response most changed how I'd answer

**Evidence Scout (C)** — the single line: *translate CV quality into the Match % delta, not a static grade.* Concretely: don't show "CV quality: 62/100"; show *"This role is a 62% match. Adding three metrics to your experience section pushes it to 85%."*

This is the biggest update because it dissolves the whole stress-test dilemma instead of answering it. The parent's honesty problem ("do we hide CV weakness?") only exists if CV quality has to be *either* a hidden number *or* a visible grade. The delta reframing makes it neither: the CV weakness shows up as **unclaimed match points with a named fix**, which is honest (the user sees their matches are being held back) and motivating (the gap is an action, not a verdict). It also means the answer to "how many numbers" stays at two — Match % and progress — with CV quality riding *inside* Match % as upside, not as a third number. Contrarian (B) reached for a merged "CV strength" score to solve the same problem; the delta approach is strictly better because it never introduces a number that can rot.

## Q2. Biggest blind spot

**Contrarian (B).** Its own recommendation — surface CV strength *"only for users who upload a CV"* — quietly forks locked decision 1 ("one flow for everyone") into two tiers. The typed-answer user (who will be a large share, since the front door leads with "be interviewed," not "upload") gets a strictly blinder experience than the uploader, and B even notices this ("the typing path becomes a second-class experience… retroactive score that judges past effort") yet still recommends it. That's not a flagged tradeoff, it's an unresolved contradiction with a locked constraint sitting inside the final recommendation. The delta framing from C doesn't have this problem — Match % is shown to everyone regardless of entry path.

## Q3. What ALL four missed

**The Match % itself is the number most exposed to the honesty critique — because at reveal the profile is only ~5 questions deep.** Every response aimed the "comforting lie" question at CV quality and treated Match % as the trustworthy anchor. But a precise "84% match" computed off five answers is *more* of a false-precision lie than a hidden CV score — it's a confident number on a nearly-empty profile. C brushed "false precision" but pinned it on ATS unpredictability, not on the thin onboarding profile. This could change the recommendation: the honest move may be to show Match as a **band (Strong / Stretch / Reach)** during onboarding and only harden it to a % once the profile has enough signal — which also fixes the "10-second better than LinkedIn" reversal, since a confident band reads as more credible than a suspiciously precise number nobody believes.

Second shared miss, worth one line: none checked whether the two internal scores can actually run **live, per-card, cheaply**. `docs/cv-quality-kickoff.md` defined them as an *offline regression harness*. Both B's "CV strength" and C's "delta" recommendations assume a live per-job model-panel judgment exists. If it doesn't, both recommendations are unbuildable as described — the council should confirm the seam before locking either.

### Contrarian's Peer Review

**Q1. Which response most changed how you'd answer the question, and why?**  
The **Executor** response most changed my thinking. The specific insight that forced an update was the conditional honesty test: *«Candidate A is honest if and only if Match % actually drops for a weak CV.»* Before reading it, I was leaning toward a clean Candidate A (Level as a number plus Match %). The Executor made me realise that the whole recommendation turns on a single empirical question that should be answered *before* locking the UI. The countdown reframe for the Level bar—turning “how much we know” into “N answers to next card”—also landed as a cheap, practical way to avoid the grade-reading problem without abandoning the bar entirely. That combination of a gating test and a low-effort reframe shifted my answer from “pick A” to “pick A, but only after a morning check, and with the Level label changed.”

**Q2. Which response has the biggest blind spot, and what is it?**  
The **Executor** has the biggest blind spot. It assumes that if Match % genuinely falls for a weak CV, then hiding the CV-quality scores is honest because the truth “lives in the lower Match % plus the existing fix-this actions.” This ignores a conflation problem: a low Match % can mean *“you lack the skills”* just as easily as *“your CV is poorly written but you have the skills.”* A user with good skills and a mechanically weak CV will see a disappointing number and likely conclude they aren’t qualified, when the real blocker is document formatting. Fix-this actions help only if the user already knows the root cause, and a single Match % doesn’t separate those two signals. The Executor’s design therefore

### Evidence Scout's Peer Review

The user wants me to evaluate four AI responses to a UX/UI design question about an app called JobCrush.
The context: JobCrush onboarding, deciding how many numbers to show the user.
Locked constraints:
1. One flow, CV upload is shortcut.
2. Cards are payoff, CV is by-product.
3. Earn cards: ~5 questions -> 3 scored cards.
4. Three feedback speeds: instant profile update, slow level bar, rare card unlock.
5. Endless levels, bar only measures distance to next unlock.
6. Wall after reveal (with a conditional reversal).
7. Front door: interview invite + CV upload shortcut.
8. CV buys one big jump. Good CV = fewer questions; poor CV = more.

Numbers in design:
1. Level/progress bar (how much JobCrush knows)
2. Match % (user vs job)
3. Well made (internal CV lint)
4. Aimed at this job (internal CV targeting)

Candidate answers:
A. Two visible: Level + Match %. CV internal.
B. Three visible: add CV quality.
C. One visible: Match % only, level bar has no number.
D. Something else.

Stress test: Candidate A means bad-CV and good-CV both start at Level 1, good-CV climbs faster. Honest or comforting lie?

Required verdict elements:
1. How many numbers, which.
2. Name/frame each. Can 'how much we know' survive without being a grade?
3. Honesty question: hide CV quality = protect or cheat? Truth-shape?
4. Failure modes (month-two).
5. Real contradiction in the 8 locked decisions.

The four responses provided:
- Model A (Executor): 2 numbers (Match %, Level as countdown "2 answers to next card"). CV internal. Gate on testing if Match % reflects CV weakness. Contradiction: Decision 4 (feedback speed) vs Decision 5 (rare unlock distance).
- Model B (Contrarian): 2 numbers (Match %, CV strength 1-100). Level bar numberless. Contradiction: Constraint 2 (CV is by-product) vs Constraint 8 (CV quality gates experience).
- Model D (Fundamentalist): 1 number (Match %). Level is just a progress bar to next card (no number). CV quality is status/action, not number. Contradiction: Decision 8 (CV buys big jump) vs poor CV = more questions (so not a big jump for poor CV).
- Model E (Expansionist): (Wait, the prompt says "Responses from other council members" but Model E's response seems cut off or I need to read it carefully. Ah, Model E's response is incomplete in the prompt text: "For example, "Your CV gets us 40% of the way to great matches; add these 2 details to reach 80" - it just ends there. I must evaluate what is there, or note its incompleteness. Wait, I should evaluate the 4 responses provided. Model E is cut off. I will evaluate based on the text provided.)

Wait, I need to answer three specific questions:
Q1. Which response most changed how you'd answer the question, and why?
Q2. Which response has the biggest blind spot, and what is it?
Q3. What did ALL responses miss that the council should consider?

Let's analyze the responses to form my own baseline first, then answer the questions.
My baseline:
1. Numbers: 2 visible numbers. Match % and a Countdown ("X answers to next card"). CV scores stay internal. (Aligns with Model A's core insight, but Model A's framing is best).
2. Framing: Match % = fit. Countdown = distance to payoff. "How much we know" MUST be reframed as "distance to next unlock" or "answers remaining" to survive as a non-grade.
3. Honesty: Hiding the *score* protects them from a demotivating grade, but hiding the *impact* cheats them. The truth-shape is making Match % reflect CV quality, and using the countdown to show that a poor CV requires more answers.
4. Failure modes: Month 2: Stale Match % (jobs expired). Dead bar (nowhere to go after initial onboarding).
5. Contradiction: Decision 4 (slow level bar as feedback speed) vs Decision 5 (bar ONLY measures distance to rare unlock). If it only measures distance to a rare unlock, it can't be a "slow feedback speed" per answer. Also, Decision 8 ("CV buys one big jump") vs "poor CV = more questions" (meaning poor CV doesn't buy a big jump, breaking the promise of Decision 8).

Now, evaluating the models for the 3 questions.

Q1: Which response most changed how you'd answer the question, and why?
Model A (Executor) provides the most actionable, grounded insight: "run 3 CVs through the existing pipeline... If the weak CV lands within a few points of the strong one, stop. You don't have a UI decision, you have a scoring bug." This forces the realization that UI decisions are downstream of algorithmic reality. If Match % doesn't actually penalize a bad CV, then *any* UI choice about hiding/showing CV quality is moot because the system is already lying via Match %. This is a profound shift from "what numbers to show" to "do the numbers we are already showing actually work?"
Also, Model A's identification of the contradiction between Decision 4 and 5 is very sharp.

Q2: Which response has the biggest blind spot, and what is it?
Model B (Contrarian) suggests showing a "CV strength" number (1-100) merged from the two internal scores. But the prompt explicitly states: "Those two never merge and were originally defined as a workbench/regression harness, not a live user meter." Model B ignores this hard technical/product constraint, proposing a merged score that the prompt says doesn't exist and wasn't designed to exist. Furthermore, Model B's "Contradiction check" claims Constraint 2 and 8 are a contradiction, but Constraint 2 says "CV is the by-product" (meaning the user's goal is the card, the CV is just generated in the background), while Constraint 8 says CV upload affects the onboarding flow. These aren't contradictory; the CV is a by-product of the *job hunt*, but a lever in the *onboarding game*. Model B misses the distinction between the user's ultimate goal and the gamified mechanics.
Wait, Model E is cut off, but looking at Model D (Fundamentalist): Model D says "One visible number: Match %." But the prompt says "Level/progress bar: how much JobCrush knows about the user" is a number currently in the design. Model D says "The 'Level' should not be a number... just a visual progress bar labeled with an action". But Decision 5 says "Endless levels... Bar only measures distance". Model D misses that removing the level number entirely might violate the "Endless levels" constraint if "Level" implies a numeric tier, though a bar can be endless.
Actually, Model B's blind spot is the biggest because it directly violates a locked constraint ("Those two never merge") by proposing to merge them into a single user-facing score. It also fundamentally misunderstands "by-product" in Constraint 2.

Let's look closely at Model B's text:
"Hiding the twin internal scores protects the user from noise; hiding the *fact* their CV is weak cheats them. A user who uploads a poorly formatted... CV... The honest shape is: after upload, show one clear... strength score... It’s one number (1–100) that merges the two internal scores with a rule..."
Prompt: "Those two never merge and were originally defined as a workbench/regression harness, not a live user meter."
Model B completely ignores the "never merge" constraint. This is a massive blind spot.

What about Model E? Model E's response is literally cut off mid-sentence. I should probably point out Model E's incompleteness, but Model B's conceptual blind spot is more substantive to critique. Let's focus on Model B for Q2.

Q3: What did ALL responses miss that the council should consider?
Let's review the 8 constraints and the prompt.
Constraint 6: "Reversal if v1 cards are not obviously better than LinkedIn search within 10 seconds: move wall before reveal."
None of the models really dug into the implications of this reversal on the *numbers*. If the wall moves *before* reveal, the user doesn't see the Match % or the cards until *after* they create an account. This completely changes the onboarding hook. If Match % is the payoff, and it's hidden behind a signup wall, the "instant profile-document update" and "Match %" lose their power as top-of-funnel hooks.
Wait, another thing: The prompt asks about the *onboarding* user.
What about the psychological effect of the "Match %" itself? If a user gets a 40% match, they might just leave. But more importantly, what about the *tailored CV behind the card*? Constraint 2: "A card = one job with Match % and a tailored CV behind it."
Did anyone address how the *tailored CV* is revealed and if it needs a number? No, they just focused on Level, Match, and CV quality.
What about the fact that the CV is *tailored*? If the CV is tailored for *this specific job*, then "Aimed at this job" (Constraint 4) is inherently per-card.
Wait, look at Constraint 8: "Good CV = fewer questions to useful cards; poor CV = more."
If a user uploads a poor CV, they have to answer *more* questions. But Constraint 3 says: "about 5 questions first, then 3 real... cards."
If they answer *more* than 5 questions, does the flow break?
Let's look at the "Numbers" again.
Is there a missing number? What about the number of *cards* they have earned or can see? "3 scored cards fully visible".
What did ALL responses miss?
They all focused heavily on the *user's* numbers (Level, Match, CV score). But what about the *system's* transparency regarding the *tailored CV*?
Actually, what about the "10 seconds" rule in Constraint 6? "Reversal if v1 cards are not obviously better than LinkedIn search within 10 seconds: move wall before reveal."
If the wall moves before reveal, the user *never sees the Match % or the cards during the initial anonymous onboarding*. They just answer questions and hit a wall. This means the "numbers" (Match %) are entirely deferred until post-signup. None of the models addressed how the wall placement fundamentally alters the visibility and purpose of these numbers during the actual anonymous onboarding phase. If the wall is before reveal, the onboarding is just a blind questionnaire. The "numbers" only exist post-auth.
Another thing: Model A mentioned the contradiction between 4 and 5. Model B mentioned 2 and 8. Model D mentioned 8 and the "big jump".
Did anyone notice that Constraint 1 says "One flow for everyone" but Constraint 8 says "Good CV = fewer questions... poor CV = more"? If the number of questions changes, it's not one flow. Model D touched on this but dismissed it.
What about the fact that the CV is a *by-product* (Constraint 2), but the user is uploading it as a *shortcut* (Constraint 1) and it gives a *big jump* (Constraint 8)?
Let's think about what ALL responses missed.
They all accepted "Match %" as a given, static number on the card. But a job's Match % changes over time (as the user answers more questions, or as the job market changes). Month-2 returning user: Model A and B mentioned stale Match %. But what about the *comparison*?
Wait, look at the prompt's stress test: "Candidate A means the bad-CV user and good-CV user both start at Level 1; good-CV user just climbs faster because upload gives a jump. Is that honest, or a comforting lie that hides that their CV is weak and hurting matches?"
All models answered this.
What did they ALL miss?
They all missed the implication of Constraint 7: "Front door has one central invitation to be interviewed plus small CV-upload shortcut."
If the front door is an "invitation to be interviewed", the user is in the mindset of *applying for a job / being evaluated*.
If they upload a CV, they are submitting to an evaluation.
If the app then *hides* the CV quality score, it feels like a black box.
But more importantly, what about the *tailored CV* itself? Constraint 2: "A card = one job with Match % and a tailored CV behind it."
The user sees a Match %, and *behind* it is a tailored CV. How does the user know the CV is tailored? Is there a number for "Tailoring score"? No, "Aimed at this job" is internal.
What if the missing element is the *delta*? The change in Match % when the CV is applied?
Let's consider the "Wall after reveal" vs "move wall before reveal". If the wall moves *before* reveal, the user answers 5 questions, sees NOTHING, and is asked to sign up. The "numbers" (Match %) are the bait. If the bait is hidden, the onboarding fails.
Actually, let's look at the "Endless levels" (Constraint 5). "Bar only measures distance to next unlock."
If it's endless, and it only measures distance to the *next* unlock, what happens when there are no more unlocks? (e.g., they've seen all jobs in their area).
Let's focus on the fact that ALL models treated "Match %" as a single, monolithic number. But Match % is a composite of *Profile* and *Job*. If the CV is weak, the Profile is weak.
What did they all miss?
They all missed the psychological impact of the *tailored CV* being the actual payoff, not just the Match %. Constraint 2: "Cards are the payoff, CV is the by-product. A card = one job with Match % and a tailored CV behind it."
Wait, if the CV is the by-product, why is it "behind" the card? The user sees the Match %, and *then* sees the tailored CV.
Did any model discuss how the *tailored CV* is presented? No.
Let's look at the "honesty" question again. "Does hiding CV quality protect users or cheat them?"
What if the real issue is that the user doesn't know *what* the Match % is measuring? Is it measuring their *potential* (skills) or their *document* (CV)?
If the Match % is based on the CV, and the CV is bad, the Match % is low. The user thinks "I don't match this job." But actually, they *do* match the job, their *CV* just sucks.
By hiding the CV quality, the user conflates "My CV is poorly formatted" with "I am not qualified for this job."
THIS is what they all missed! They talked about demotivation and grades, but they missed the *attribution error*. The user will attribute a low Match % to a lack of qualifications, rather than a lack of CV optimization, because the CV quality is hidden. The "truth-shape" isn't just about giving them a score or an action; it's about decoupling *job fit* from *document quality* so they don't falsely conclude they are unemployable.
Let me double check if any model mentioned this.
Model A: "a raw 'your CV: 43/100' is a number with no next step... The honesty about a weak CV should live in two places... Match % is genuinely lower, and the fix-this actions... name the exact weakness." (Model A touches on attribution slightly by saying fix-actions name the weakness, but doesn't explicitly name the attribution error of conflating job fit with document quality).
Model B: "A user with a weak CV sees low match percentages and concludes the product doesn't work. Without a CV strength signal, they have no lens to understand *why* the matches are low." (Model B gets close: they blame the product, not necessarily themselves, but they miss the "I am unqualified" attribution).
Model D: "If JobCrush shows me a 90% match, but my CV is garbage, I will apply and get rejected... If JobCrush shows me my CV is garbage, it demotivates me."
Model E: (Cut off).

Let's refine Q3: What did ALL responses miss?
They all missed the **Attribution Error** regarding Match %. If CV quality is hidden, a user with a great background but a terrible CV will see a low Match % and conclude "I am not qualified for these jobs" (attributing it to their career/skills), rather than "My CV is poorly formatted" (attributing it to the document). The UI must explicitly decouple *professional fit* from *document quality* to prevent users from falsely internalizing a low Match % as a judgment on their actual career viability.
Alternatively, what about the "10-second" rule in Constraint 6? If the wall moves *before* reveal, the user never sees the Match % during onboarding. The entire debate about "how many numbers during onboarding" is moot if the onboarding ends in a blind signup wall. None of the models analyzed how the conditional reversal in Constraint 6 completely invalidates the premise of showing numbers *during* the anonymous onboarding phase.
Let's state both or pick the strongest. The attribution error is a deep UX insight. The Constraint 6 wall placement is a deep product logic insight. I'll combine them or focus on the attribution error as it directly relates to the "honesty/cheating" stress test.
Actually, the prompt asks: "What did ALL responses miss that the council should consider? Something none of the four responses addressed, but which could change the recommendation."
The attribution error perfectly fits. If users conflate "bad CV" with "bad candidate", hiding the CV score doesn't just "demotivate" them—it actively misinforms them about their own employability, causing them to abandon their job search or apply for lower-tier jobs out of false insecurity. The recommendation must include a way to frame Match % so it clearly measures *role alignment*, while separate UI elements (or copy) isolate *document readiness*.

Let's review the questions and draft the answers.

**Q1. Which response most changed how you'd answer the question, and why?**
Model A (Executor).
Insight:

### Fundamentalist's Peer Review

**Q1. Which response most changed how you'd answer the question, and why?**

Evidence Scout (Model C) provided the most compelling update to my thinking with the concept of the **"Match % delta."** 

The core dilemma in the stress test is how to be honest about a weak CV without demotivating the user with a permanent grade. Evidence Scout solved this by suggesting we translate the internal CV quality into *actionable potential* on the existing Match % number. Example: *"Your Match for this role is 62%. Adding three specific metrics to your experience section will push this to 85%."* 

This elegantly solves the honesty problem without violating the locked constraints. The internal CV scores ("Well made" and "Aimed at this job") remain completely hidden as raw integers, but their *impact* is surfaced through the Match % the user already sees. It answers the stress test: it doesn't cheat the user, because it explicitly tells them *why* their match is low and *how* to fix it, but it avoids the demotivation of a static "CV Score: 40/100".

**Q2. Which response has the biggest blind spot, and what is it?**

Contrarian (Model B) has a fatal blind spot: it directly violates the locked constraints. 

Contrarian proposes creating a "CV strength indicator" that is "one number (1–100) that merges the two internal scores." However, the prompt explicitly states: *"Those two never merge and were originally defined as a workbench/regression harness, not a live user meter."* Because Contrarian's entire recommendation hinges on merging these scores into a live UI element, the proposal is unbuildable under the current product constraints. 

*(Note: Expansionist (Model E) also has a critical blind spot—it completely failed to answer the prompt, instead leaking its internal prompt-generation thought process and cutting off.)*

**Q3. What did ALL responses miss that the council should consider?**

None of the responses accounted for the fallback condition in Locked Constraint 6: *"Reversal if v1 cards are not obviously better than LinkedIn search within 10 seconds: move wall before reveal."*

Every council member analyzed the onboarding flow assuming the user gets to see the 3 scored cards (with Match %) *before* hitting the account wall. If the fallback triggers and the wall moves *before* the reveal, the user hits the Google OAuth wall after 5 questions and never sees a Match % during the initial onboarding flow. 

This completely changes the math of the core question. If the wall moves early, the only number the user sees before being forced to authenticate might be the Level/Progress bar—or zero numbers. The council should evaluate how the visible numbers function under the fallback flow, because a user being asked to sign up before they've even seen a Match % will require a very different "how much we know about you" gauge to convince them to convert.

### Expansionist's Peer Review

We need answer three questions, evaluating four responses. We must be rigorous impartial critic. Need identify which response most changed our thinking, why. Which biggest blind spot. What all responses missed. We need probably provide concise but thorough. Use plain English, one idea at a time, concrete example before abstraction as per the prompt style? The final prompt asks us to answer three specific questions, not necessarily repeat the original verdict. But the earlier instructions were the AI council member being evaluated; now we are evaluating. The three questions ask us to evaluate responses. Need maybe reference the responses by role. We must avoid revealing hidden identities. We can use role names: Executor, Contrarian, Evidence Scout, Fundamentalist. Note Model D's response was cut off? The prompt includes truncated "Evidence Scout" section and "Fundamentalist" maybe only partial? Let's inspect. The provided text includes Executor full, Contrarian full, Evidence Scout up to section 5 "Real contradiction in the eight locked" cut off, then Fundamentalist appears to be the model's own thinking? Actually the prompt says Responses from other council members (model identities hidden, roles revealed). It lists Executor (Model A), Contrarian (Model B), Evidence Scout (Model C), Fundamentalist (Model D). But the text after Evidence Scout is only a heading and then it cuts off? It seems the Fundamentalist response is not actually provided, instead there's a long draft of the Fundamentalist's own reasoning? Wait, let's read carefully.

The text after "Fundamentalist (Model D, identity hidden):" is:
"The user wants me to play the "Fundamentalist" role on an AI advisory council.
The topic is JobCrush onboarding UX/UI, specifically how many numbers the user sees during onboarding.
Current options:
..."

That looks like the model's own pre-response internal monologue draft, not the final formatted answer. Then after a long internal reasoning, it ends with the user's note: "Note: each response was written from a specific assigned role..." and then asks the three questions. It seems the Fundamentalist's actual final response is missing. But the prompt includes the raw thinking. Hmm. This is ambiguous. The user likely wants us to evaluate the four responses as provided, but Fundamentalist's final formatted response isn't fully included; we can still evaluate what is there (maybe the draft sections). We might need to note that Fundamentalist response is incomplete. However, the three questions ask which response changed our answer, which blind spot, what all missed. We can use the four as presented.

But maybe the "Fundamentalist" is actually the assistant's own response? The user's note at bottom says "Note: each response was written from a specific assigned role." The prompt says "Responses from other council members (model identities hidden, roles revealed): Executor, Contrarian, Evidence Scout, Fundamentalist." Then Fundamentalist appears as the assistant's own draft? Wait, the overall task is "You are evaluating responses from four other AI council members." So we are the critic. The four responses are provided. The Fundamentalist response is the one that seems to be a draft. It might be a final answer in a different format? It starts with "The user wants me to play the 'Fundamentalist' role..." which is weird as a response to the original council question. Maybe the model generated it as internal monologue and didn't produce the final sections. It is incomplete. But we can evaluate based on the substance present.

We need decide our own prior answer? The question Q1 asks "Which response most changed how you'd answer the question, and why?" That implies we have an answer to the original question. We need to perhaps state our own answer. But the three questions only ask these evaluative. We can answer based on our evaluation. We need to be impartial. Let's formulate.

We need analyze the responses.

Let's summarize each response.

Executor (A): Direct answer: Two numbers, but reframe Level from percent to countdown "N answers to next card." Keep CV-quality internal. Match % must reflect CV quality, else hiding is a lie. Failure modes: Match % doesn't track CV quality, level read as grade, month-two dead bar, stale Match %. Contradiction: Decision 4 vs 5: feedback speed vs rare unlock.

Contrarian (B): Two numbers: Match % and CV strength indicator (single 1-100, merged internal scores, only after upload). Level bar numberless, movement only. Hiding CV quality cheats; actionable CV strength with fix is needed. Failure modes: returning user sees CV strength dropped, level bar stale, Match % obsession without CV context. Contradiction: Decisions 2 vs 8: CV is by-product but gates experience.

Evidence Scout (C): Direct answer: Two numbers: Match % and Progress/Distance ("2 steps to next card"). Internal CV scores hidden. Match % as "Job Fit". Progress bar as "Distance to Next Card". Honesty: hide CV score but show impact via Match delta. Failure modes: endless treadmill, false precision trap. Then cuts off. (So we have partial.)

Fundamentalist (D): Draft (incomplete) argues maybe wrong question, one number: Match %, level no number, CV health as status/action, not number. Honesty: hiding CV quality as number is good, hiding consequence is bad; show fix actions. Contradiction: Decisions 5 and 8 maybe.

We need answer three questions. Let's craft a thorough evaluation.

First, consider our own answer to the original question. The original question asked: "How many numbers does the onboarding user see, and what does each mean?" The locked constraints. A good answer: Two visible numbers: Match % and a progress/level indicator, but level should be framed as "distance to next card" not a grade. CV quality scores remain internal. We need answer stress test: It is honest if the system clearly communicates the consequence of a weak CV via actions and Match % reflects CV quality. Hiding CV quality is protecting from noise if actionable feedback is given. Failure modes: month-two stale bar, dead bar, social grade, Match % precision. Contradiction: Decision 4 vs 5. That seems aligned with Executor and Evidence Scout.

Now Q1: Which response most changed how I'd answer? Perhaps Executor's conditional test: "run 3 CVs through pipeline and see if Match % changes." That made me realize the honesty of hiding CV quality is contingent on Match % actually encoding CV quality. It forced update: If Match % doesn't track CV quality, then the recommendation collapses. Also the countdown framing as "N answers to next card" is a useful reframing, but both Executor and Evidence Scout suggest it. The Executor's "number with no next step is the thing I hate most" and the conditional test is concrete and actionable.

But maybe Contrarian changed my view about the need to surface CV quality after upload. It raises good point: If CV quality is hidden, users with weak CV will blame the algorithm. However, its proposal to merge two internal scores into a single 1-100 is questionable because the two scores were locked as separate and not a live meter. It may be useful but not a change if we already believe fix actions are enough.

Evidence Scout's "Match % delta" (showing potential improvement) is an elegant truth-shape. That could change our answer: instead of showing static CV quality, show how CV fixes would raise the Match %. This aligns with Executor's "truth as an action."

So Q1: I think Executor most changed my thinking because of the concrete 20-minute test and the conditional nature of the honesty claim. It elevated a hidden dependency: Match % must be CV-sensitive.

Let's be ready to explain. Maybe also acknowledge Evidence Scout's delta framing and Contrarian's upload-only CV indicator.

Q2: Biggest blind spot. Which response misses a critical consideration that materially affects the answer?

Options:
- Executor: Blind spot about what happens when Match % doesn't track CV quality. It identifies it but maybe doesn't provide fallback if the test fails. However it is not a blind spot because it explicitly calls it out. Maybe Executor's blind spot is the month-two stale bar / lack of content loop? It mentions dead bar but doesn't address supply of actions enough. But it does say "Endless levels only help if there's always a cheap reachable next action, and today there isn't a defined supply of those." That's a blind spot but actually named.
- Contrarian: Biggest blind spot is locked constraint: the two CV quality scores are explicitly defined as workbench/regression harness, not a live user meter, and must not merge. It proposes merging them into a single user-facing CV strength score, ignoring the source-of-truth docs. It also says "show only after upload," which contradicts Decision 1 (one flow for everyone; CV upload is only a shortcut). Actually it creates a second experience for uploaders. That's a material blind spot. It also says "the level bar becomes a purely visual, numberless progress track" which is okay but its CV score may violate locked constraints. So we can say Contrarian ignores the locked architectural decision that Well made and Aimed are internal harnesses, not a live meter, and cannot be merged into a single user-facing score without breaking the design's source of truth. Also, the user-only-after-upload creates a split flow.

- Evidence Scout: The response is cut off, but its blind spot could be that it doesn't address the "CV buys one big jump" and how the level bar interacts with upload, or how to handle bad CV users. It says progress is "2 steps to next card" but doesn't explain how the CV upload affects the count or what users see after upload. Also it doesn't address the stress test enough.

- Fundamentalist: Incomplete, but its blind spot might be that it dismisses the level bar entirely as a meaningless metric, ignoring the locked requirement of a slow level bar (Decision 4). But actually it acknowledges it. However, it argues for no numeric level, which is okay.

We need choose the biggest blind spot. I think Contrarian's is the biggest because it proposes a user-facing CV-quality number that merges the two locked internal scores, directly violating the locked constraint that they "never merge" and are "not a live user meter." It also creates a second-class typing path and an upload-only display, conflicting with the one-flow principle. This is a concrete missing consideration that materially changes the answer: if we follow the locked docs, B is off the table.

Alternatively, the biggest blind spot could be Evidence Scout being cut off; but we can't know. The question says "Which response has the biggest blind spot, and what is it?" We can select Contrarian and explain.

But also, Executor has a blind spot: It doesn't propose a fallback if Match % fails to reflect CV quality. It just says "stop, fix scoring bug." But that's a test, not a blind spot. Actually it's a good point.

Another angle: The Contrarian misses that the CV strength score would be shown only after upload, creating a two-tier flow and contradicting the "One flow for everyone" locked constraint. That's a huge gap.

Q3: What did ALL responses miss that the council should consider? Something none addressed but could change recommendation.

Potential things:
- The actual computation of Match % and whether it includes CV quality. Most addressed. Executor did.
- The legal/ethical risk of displaying a "Match %" and its accuracy; false precision. Evidence Scout mentions false precision trap. So not all.
- The role of the tailored CV as the product payoff; maybe the visible numbers should be about the CV outcome, not the profile.
- The "front door" central invitation and CV-upload shortcut (Decision 7). None of the responses discuss how the front door invitation's wording influences what numbers are visible before any interaction. The first thing the user sees (the central invitation) may prime them to expect a "Match %" or "Level" or not. The front door framing could make the level bar feel like an assessment or an interview invitation.
- The account wall / Google OAuth and the point at which numbers are shown. The wall after reveal (Decision 6) means the user sees the 3 scored cards before account creation. The numbers are pre-account. Persistence server-side. The implications for returning users: their answers persist, but if they return month two and the wall is after reveal, they may have already seen cards without an account. This affects what numbers they see when they come back. None addressed.
- The "reversal if v1 cards are not obviously better than LinkedIn search within 10 seconds" (Decision 6). This is a major hidden risk. If cards are judged weak in 10 seconds, the wall moves before reveal. This could make the number question moot because onboarding may change entirely. None of the responses integrate this gate or how numbers affect the 10-second test. The Match % and card quality in first 10 seconds is crucial.
- The content supply of jobs/cards and how Match % is recalculated as market changes. Executor mentions stale Match %, but not all.
- The fact that the level bar is a "feedback speed" (Decision 4) with three speeds: instant profile-document update, slow level bar, rare card unlock. None addressed the *profile-document update* speed. What is the profile document? Is it a visible CV / profile preview? The instant update might itself be a number or a visible change. The question asks "how many numbers does the onboarding user see"—maybe the profile-document update is a number too (e.g., "Profile updated: 3 fields added"). The instant update might show a live preview of the extracted profile, which could be numbers or not. None considered this.
- The "one central invitation to be interviewed plus small CV-upload shortcut" (Decision 7) may mean the first number a user sees could be a "Match %" after answering, but the invitation is not a number.
- The CV quality scores as internal harnesses: maybe the real council should consider whether the test harness should be exposed as a *diagnostic* to the user, but not as a number. Maybe show a "CV check" with pass/fail items. None proposed that exact shape.
- The measurement/validation plan: The council should specify how to test whether the number framing works. Executor mentions a 20-minute test. Others don't. But all didn't miss it? Executor includes it.
- The "Month-two returning user" problem: None of the responses explicitly address the *job market dynamics* and the need for recalibration of Match % and cards. Executor mentions stale Match %; Contrarian mentions score changes. But no one addresses how the level bar behaves after the user has exhausted cheap questions; the "endless levels" need a content loop. Executor mentions supply of cheap actions.
- The "wall after reveal" and conversion: if the wall moves before reveal, then the visible numbers are different (maybe no cards at all). None address that.
- The "CV as by-product" vs "cards as payoff" tension: Contrarian addresses it, but maybe not fully. It says the product is "schizophrenic". Good point.
- The "match %" as a percentage may be misleading if the underlying score isn't calibrated to probability; all mention.

I think a strong "all missed" is the 10-second reversal gate and the front door invitation's priming effect, or the instant profile-document update as a visible number. Let's think which is most likely to change the recommendation.

The original question: "How many numbers does the onboarding user see, and what does each mean?" The context includes the onboarding flow: front door -> questions -> cards -> wall. The 10-second reversal is a huge contingency: if the cards are not better than LinkedIn search within 10 seconds, the wall moves before reveal. This means the numbers visible before account creation are critical. If cards are not good, users may see only the level bar and questions, and the "Match %" may not be visible until after account. This changes the number count and the meaning. Also the front door invitation is the first thing users see; it might show a "Match %" preview? It says "central invitation to be interviewed plus small CV-upload shortcut." That is not a number, but it sets expectations.

The instant profile-document update (Decision 4) could be a visible number or a live preview. The question says "Three feedback speeds: instant profile-document update, slow level bar, rare card unlock." The profile-document update is the fastest feedback. It might be a CV/profile completeness meter or a document preview. If it's a number, it adds to the count. None of the responses addressed it.

Also, the content supply loop for endless levels: not fully addressed by all. But Executor mentions it.

The fact that "Match %" is a number on a card that is a "payoff" but behind the card is a tailored CV. The user sees the card (Match %) before seeing the CV. The tailored CV is a by-product. The relationship between Match % and CV quality is central. Most addressed.

Another candidate all missed: The "Well made" and "Aimed at this job" scores are internal and never merge. The council should consider whether they can be used to generate *actionable text* without a number, e.g., "Your CV needs a clearer summary for this role." This is a "truth-shape" that avoids demotivation. Some mention fix actions, but not explicitly mapping each internal score to a user-facing diagnostic. Executor says fix actions, but not tying to the two scores. Contrarian says fix actions with score. Evidence Scout says match delta. Fundamentalist says status/action. But none explicitly say: "Use the two internal scores as a regression harness, but surface the *specific issues* they flag as plain-language fix-actions, not a number." That might be a good all-missed point.

Wait, the question asks "What did ALL responses miss that the council should consider?" So we need a single thing. Let's pick a high-impact one.

Option A: The 10-second reversal gate and the first impression effect on numbers. The whole number discussion assumes the current 3-card reveal flow survives. If it doesn't, the visible numbers may be completely different (e.g., only progress indicator before account). This is an omission that could change the recommendation.

Option B: The instant profile-document update as a potential visible number. The council didn't consider whether the "instant profile-document update" itself is a number. This could change the count.

Option C: The fact that the locked docs say CV-quality scores are a harness, but the system still needs to communicate CV weaknesses; the council should consider using them to generate plain-language fix-actions, not a score.

Which is more compelling? The question is about "how many numbers does the onboarding user see". The 10-second reversal gate changes the flow and thus the count. The instant profile-document update might add a number. The diagnostic fix-actions is more about the shape of the truth.

I think a good answer could be: "All four responses missed that the front door and the 10-second reversal gate (Decision 6) determine which numbers are even visible before the user has committed to an account. If the cards fail the 10-second test, the wall moves before reveal, so the only visible number during onboarding may be the progress-to-next-card indicator. The council should decide the numbers *conditional on* that gate, not as if the 3-card reveal is guaranteed."

But also, the instant profile-document update is another. Could combine: "They missed the first 10 seconds and the profile-document update as visible feedback." However, the question asks "What did ALL responses miss that the council should consider?" So one thing is fine. Let's decide.

We need

**Anonymization mapping:**
- Model A = Executor (Claude (opus) [medium])
- Model B = Contrarian (Fireworks (accounts/fireworks/models/deepseek-v4-pro))
- Model C = Evidence Scout (Fireworks (accounts/fireworks/models/qwen3p7-plus))
- Model D = Fundamentalist (Fireworks (accounts/fireworks/models/glm-5p2))
- Model E = Expansionist (Fireworks (accounts/fireworks/models/kimi-k2p7-code))

---

## Stage 3: Chairman's Synthesis

## WHERE THE COUNCIL AGREES

Concrete target screen: after five questions, the user sees three job cards like `Warehouse Ops Lead - 71% Match`, plus a small progress line like `2 answers to unlock another card`. They do not see `Well made: 58`, `Aimed at this job: 63`, or `Profile strength: 40%`.

Executor, Evidence Scout, and Fundamentalist agree that the two CV-quality scores should stay out of onboarding. They are diagnostic tools for the product team, not user meters.

Executor, Evidence Scout, and partly Fundamentalist agree that the progress mechanic must be framed as movement toward the next reward, not a grade on the person. `2 answers to your next card` is safer than `Level 2` or `40% profile complete`.

All serious responses agree on the honesty line: hiding raw CV-quality scores is fine; hiding the effect of a weak CV is not fine. The user needs to know what to fix, not receive a blunt document score.

## WHERE THE COUNCIL CLASHES

The main clash is whether to show a CV-quality number. Contrarian wants one visible `CV strength` score. The stronger position is against that. The repo decision says `Well made` and `Aimed at this job` never merge, and they were created as a workbench, not a live user-facing score. Turning them into `CV strength: 72` would be a new product metric, not a UI tweak.

The second clash is whether the progress bar has a number. Fundamentalist and Contrarian lean toward no number. Executor and Evidence Scout support a countdown. The stronger position is the countdown, because it gives the user a clear next action while avoiding the grade trap.

The third clash is how much trust to put in `Match %`. Executor is right: this whole recommendation depends on Match % actually reacting to weak CV evidence and missing profile facts. If it does not, the UI is dressing up a scoring bug.

## BLIND SPOTS THE COUNCIL CAUGHT

The biggest caught blind spot is attribution. A low Match % can mean three different things: the user is a poor fit, the CV is poorly written, or JobCrush simply does not know enough yet. The UI must not let users read `52% Match` as `you are a bad candidate` when the real issue is `your CV is missing dates and metrics`.

The peer reviews also caught that the `Match % delta` idea is useful but dangerous if overbuilt. Saying `add metrics to improve this match` is good. Showing speculative future percentages everywhere risks adding more false precision.

The account-wall fallback matters. If v1 cards are not clearly better than LinkedIn within 10 seconds and the wall moves before reveal, the visible-number design changes. Then the pre-auth experience may only have the progress counter, not Match %. That fallback should be treated as a separate UI state.

No hard contradiction breaks the eight locked decisions. The real wording risk is `CV buys one big jump` versus `poor CV = more questions`. Say the truth instead: `Upload gives us a starting jump. Clearer CVs answer more questions automatically.`

## THE RECOMMENDATION

Show exactly two numbers in onboarding.

First: **Match %** on each job card. Frame it as `Match`, `Job Fit`, or `Fit for this role`. It means: based on what JobCrush currently knows, this job looks more or less aligned. It must not be framed as chance of getting hired.

Second: **answers to next card**. Frame it as `2 answers to unlock another card`, not `Level 2`, not `Profile strength`, not `40% complete`. The bar can still exist, but the visible meaning is distance to the next card unlock.

Do not show `Well made`, `Aimed at this job`, or a merged CV-quality score. Instead, show CV truth as fix-actions: `Your CV gave us a start, but two roles are missing dates. Answer these two questions to improve matches.` That protects users from a demotivating grade without cheating them.

Month-two failure modes to design against: stale Match % on expired jobs, a dead progress bar when no easy questions remain, users mistaking low Match for personal rejection, and returning users wondering why their scores changed. Recompute or date Match %, keep a real next action available, and explain the cause of low fit in words.

Confidence: medium-high. The single condition that reverses this recommendation is simple: if weak and strong CVs for the same candidate/job produce nearly identical Match %, stop showing precise Match % in onboarding and use bands plus fix-actions until scoring is trustworthy.

## THE ONE THING TO DO FIRST

Run one smoke test: same target job, same candidate background, three inputs: strong CV, weak CV, and five typed answers with no CV. Record Match %, next-card countdown, and generated fix-actions. The weak-CV path must produce visibly different signals and a clear repair action before the UI decision is allowed to ship.

---

## Council Composition

- Model A (Executor) โ’ Claude (opus) [medium]
- Model B (Contrarian) โ’ Fireworks (accounts/fireworks/models/deepseek-v4-pro)
- Model C (Evidence Scout) โ’ Fireworks (accounts/fireworks/models/qwen3p7-plus)
- Model D (Fundamentalist) โ’ Fireworks (accounts/fireworks/models/glm-5p2)
- Model E (Expansionist) โ’ Fireworks (accounts/fireworks/models/kimi-k2p7-code)
- Chairman -> Codex (gpt-5.5) [xhigh]