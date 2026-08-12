# Council Transcript

**Session:** 2026-07-22 23:05:44  
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

**Two numbers, and only one of them is really "about you."**

- **Match %** — on each card. The one graded number. "You vs this job: 78%."
- **A progress indicator with no grade** — shows *distance to the next card*, e.g. "2 more answers to unlock a card." Not a "Level 7," not a percent-of-you.

CV-quality scores (Well made / Aimed at this job) stay internal — but they are **not hidden**. They surface as *fix-actions on Match %*: "Add a metric to your last role → 4 cards jump above 70%." That's the honest truth-shape. The weak CV isn't concealed; it's expressed as headroom on the thing the user actually wants, with a button.

So: closest to **A**, but with the Level bar stripped of its number (borrowing C's instinct on the bar), and CV quality routed into Match-% actions instead of shown or buried.

On the honesty question directly: showing a static "Your CV: 41/100" is honest and demotivating and a dead end. Hiding it entirely is a comforting lie. The escape is neither — it's making CV weakness *actionable* through the Match % the user already trusts. "Bad CV" becomes "here are 4 cards one edit away."

## 2. EXECUTOR LENS

**Monday morning first step:** don't build a Level system yet. Build the card with a Match % and a "what would raise this" list under it. That single component is the whole product bet — if the Match % isn't obviously smarter than a LinkedIn search in 10 seconds (your decision-6 reversal trigger), no number scheme saves you.

**Implementation sequence:**
1. Ship the 3 scored cards with Match % + 2–3 fix-actions each. (This is S3 core anyway.)
2. Add the progress indicator as **plain text tied to a rule**: "answer N more → next card." No level math, no cumulative store, no calibration. Cheapest possible thing that satisfies decision 4's "slow bar" and decision 5's "distance to next unlock."
3. Wire fix-actions to the *internal* CV-quality panel — but only expose them as "+X% / unlocks card," never the raw score. The panel is already built as a workbench; you're reading it, not surfacing it.
4. CV upload gives a one-time visible jump: "Upload added 3 answers' worth — you're 1 away from a card." (decision 8)

**Where it breaks in practice:**
- **The fix-actions need the internal scores to be reliable enough to promise a Match-% delta.** Right now they're a *regression harness*, defined explicitly as not-a-live-meter. Promising "add a metric → +12%" means the panel now drives user-visible commitments. That's a real scope jump — you're upgrading a test fixture into production copy. If the delta is wrong, the user edits and Match % doesn't move → trust dead. **This is the unresolved dependency.** Ship v1 fix-actions as directional ("this usually helps"), not numeric-promise, until the panel is calibrated against real reveals.
- **"Distance to next unlock" needs a stock of next unlocks.** If the bar points at a card that doesn't exist yet (S3 not deep), the bar lies.

**Missing decision:** does the fix-action promise a number or a direction? Pick "direction" for v1. That's the one call that unblocks Monday.

## 3. FAILURE MODES

**What makes my answer wrong:**
- **If the internal panel can't be trusted to move Match % predictably**, the whole "route CV quality into fix-actions" bridge collapses, and you're back to A's stress-test problem: you're just hiding a weak CV. My answer depends on the fix-actions actually firing for weak CVs. If they don't, hiding is hiding.
- **Month-two returning user, the real killer:** they come back, the bar hasn't moved, the same 3 cards sit there, Match % unchanged (no new jobs, no new answers). The product looks dead. Endless levels (decision 5) only help if there's *fresh* material on return. A distance-to-next bar pointing at nothing is worse than no bar. **You need new questions or new cards to exist on return, or the whole reward loop is a monument.**
- **A numbered Level gets read as a grade no matter the copy.** Users screenshot "Level 2" and feel judged. This is why I killed the number on the bar — but even a segmented bar can be read as "I'm 20% of a person." Uncertain whether *any* persistent self-gauge survives real users. I lean no; when unsure, don't ship the number.
- **Bad-CV user runs the table blind:** applies to 3 cards month one, zero callbacks, and JobCrush never said the CV was the problem. If fix-actions are too gentle, this is the cheat wearing a nicer coat.

**Most uncertain about:** whether "direction-only" fix-actions are motivating enough, or whether users need a number to feel movement. That's an A/B test, not a debate.

## 4. FINAL RECOMMENDATION

**Show two numbers: Match % (the only grade) and a distance-to-next-card counter (no score). Keep CV-quality internal but expose it as directional fix-actions on Match %, not as a meter and not as silence.**

The one decision to lock Monday: **fix-actions are directional in v1, not numeric promises** — because the CV-quality scores are still a workbench harness, not a calibrated live driver. That keeps you honest (weak CVs get told, via cards) without shipping a Match-% delta you can't yet stand behind.

**Real contradiction to flag to the council:** locked decision 1 frames the bar as *"how much JobCrush knows about you"* (a cumulative knowledge gauge) while decision 5 says the bar *"only measures distance to next unlock"* (a local, resetting distance). Those are two different objects — a lifetime score vs. a countdown. Pick one. I recommend decision 5's version (distance-only, no number), because the cumulative-knowledge gauge is exactly the thing that gets read as a grade and can't survive month two.

### Contrarian (Model B)

## 1. DIRECT ANSWER

**One honest number, plus a bar with no number.**

- **Match %** — on each card. "You vs this job." This is the only number that should carry a value.
- **A progress bar toward the next card** — filling, no percentage, no "Level 7." Framed as *reward distance*, not *knowledge grade*.
- **CV quality (both scores): stays internal.** But it surfaces as **fix-actions** hung off a low Match % — "3 things are capping your matches at ~60%. Fix them?" — never as a score.

Concrete: bad-CV Dana uploads, gets 3 cards at 48% / 55% / 51%, and a line: *"Your CV buries your project results — matches are capped. Answer 2 questions to lift them."* Good-CV Sam uploads, gets 71% / 80% / 66% and fewer prompts. Neither sees a "CV: 62/100" grade. Both see the truth *through the Match %* and *through what to do next*.

This is closest to **Candidate D** — a trimmed version of A that kills the Level *number* while keeping the Level *motion*.

## 2. CONTRARIAN LENS

**The plan says "two numbers." Count again — the reveal screen shows four.** Level + three Match %s. Users don't read numbers in isolation; they rank them. The instant a user sees 48 / 55 / 51 they're not thinking "nice, three cards" — they're thinking "why is everything in the 50s?" You've already shipped the CV-quality signal you were trying to hide. You just refused to explain it.

**The assumption that destroys the plan: that a bar labeled "how much we know about you" won't be read as a grade.** It will. Every progress bar humans have ever seen — game XP, LinkedIn profile strength, download bars — means *how complete / how good am I*. You cannot re-train that reflex with a label. A half-full bar says "you are half a person" no matter what tooltip you attach. This is the real reason to strip the number: not honesty, but that the gauge lies in the *wrong direction* — it will feel like a grade you didn't intend, on an axis (our knowledge) the user doesn't care about.

**And here's the buried contradiction nobody's saying out loud:** Match % going *up* while Level goes *up* is the happy path everyone pictures. But the honest case is Level up, Match flat. "JobCrush knows more about me AND I'm still a bad fit" is a real, common state — and it reads as *the product is broken or mocking me*. Two numbers that can diverge is two numbers that can contradict, and the contradiction lands on the most fragile user.

## 3. FAILURE MODES

**The honesty question, answered straight:** Hiding the CV-quality *number* does **not** cheat users — *if and only if* Match % moves honestly and fix-actions exist. Match % is the outcome; CV-quality is a diagnostic input. Users are owed the outcome and the fix, not the diagnostic dial. But **Candidate A as written does cheat them**, because it hides CV quality *and* offers a comforting Level bar that climbs on upload — that combination says "you leveled up!" while the matches quietly stay in the 50s. That's the comforting lie. The fix isn't adding the CV score back (a shaming grade demotivates worse). The fix is: **the Level bar must never climb without Match % climbing too.** Tie the reward-motion to the outcome, or don't show it.

**Month-two returning user — the one that kills retention:**
- Dana comes back. She answered everything last month. The bar is stalled — nothing new to know. Decision 5 promised "endless levels," but a knowledge-stock bar has an end: *her*. It sits frozen. Feels like the game shipped, ended, and forgot her.
- A distance-to-next-unlock bar has the opposite failure: every unlock resets it near-empty. Next month Dana sees an almost-empty bar and reads "I lost progress."
- **These two failures come from Decision 1 and Decision 5 describing two different quantities as one bar** (see §5).

**What makes my answer wrong:** If the 3 reveal cards genuinely beat LinkedIn in 10 seconds (Decision 6's own bar), Match % alone may carry the whole load and *any* second gauge is noise — pushing me toward **Candidate C**, not D. I'm uncertain the progress bar earns its pixels at all on the reveal screen. It may only belong *after* the wall, where returning users need a "what's next" hook. Ship the bar there, not on first reveal.

## 4. FINAL RECOMMENDATION

**Show one number: Match %. Replace the Level number with a motion-only "next card" bar that is mechanically forbidden from advancing unless Match % also rises. Keep both CV-quality scores internal, and let them speak only as fix-actions attached to a low Match %.**

And fix this before building it — **Decision 1 contradicts Decision 5.** Decision 1 says the bar means *how much we know about you* (a cumulative stock that only grows). Decision 5 says the bar *only measures distance to the next unlock* (a local gauge that resets every unlock). One bar cannot be both — a knowledge stock never resets; an unlock-distance bar resets constantly. Pick one, in words, now: it's a **distance-to-next-card** bar (resets, no absolute number, safe from "grade" reading), and Decision 1's "how much we know" framing gets deleted. If you keep the knowledge framing instead, you get the stalled-bar month-two death in §3. That's the one real contradiction in the eight — resolve it or it resolves itself badly in front of a returning user.

### Fundamentalist (Model C)

## 1. DIRECT ANSWER

The user sees **one number: Match %** on each card. Nothing else on screen is a number.

The level bar stays, but strip the number off it. It's a *bar that fills*, labeled in actions — "2 answers to your next card" — not "Level 7" and not "we know 34% of you." The two CV-quality scores (Well made, Aimed at this job) stay exactly where the kickoff put them: internal, on the workbench. They never become a user number. When CV quality is weak, the user meets it as a **fix-this action that visibly moves Match %**, not as a grade.

So: closest to Candidate A, but with A's level number deleted. One number, one wordless-ish bar, zero CV-quality numbers. Call it A-minus-one.

Concrete: a bad-CV user sees a job card at "Match 54%." Under it: *"Add one result with a number to your last role → likely 61%."* They tap, answer, the card ticks to 61%. They were never told "your CV is a 3/10." They were told the truth in the only shape that helps: where they stand, and the next lever.

## 2. FUNDAMENTALIST LENS

**A number earns its place by doing one of three jobs: locate the user, direct them, or motivate them.** Anything else is decoration or anxiety. Grade the four:

- **Match %** — locates *and* directs *and* motivates. It's the only number about the actual product (a job you fit). Keep.
- **Level number** — motivates weakly, locates falsely (Level 12 means nothing across users on an endless ladder), directs not at all. The *bar* motivates; the *number* on it is noise. Cut the number, keep the bar.
- **Two CV-quality scores** — these were born as a regression harness. Surfacing them is a category error: turning a QA instrument into a scoreboard. They direct nothing the user can't get from a fix-action. Cut.

Now the assumption baked into the whole question: **that "how much we know about you" is a thing worth showing the user at all.** It isn't. Any gauge *about the user* gets read as a *verdict on the user*. "We know 20% of you" reads as "you're 80% not-enough." You cannot label-your-way out of this; real users don't read the tooltip. The only safe framing points at the machine's next gift, not the person's deficiency: *"2 answers → next card."* Same bar, opposite emotion.

So the real problem underneath "how many numbers" is: **where does the honest signal about a weak CV live?** The stress test assumes the choice is *hide the grade* vs *show the grade*. That's a false binary. The honesty already lives in Match % — a weak CV produces a low Match %, and that's not a lie, it's the market. The demotivating thing was never the low score; it's a *standalone grade on the person's raw material with no lever attached.* Truth + a lever motivates. Truth as a naked grade demoralizes.

The elegant version, if you want it: **"how much we know" is really the confidence band on Match %.** Off 5 answers, "62%" is a lie of precision. Show it as *62%, still rough* → each answer tightens it → *62%, confident*. Then the fuel gauge isn't a separate meter about the user; it's the Match % getting sharper. One number, honestly earning its confidence. That's the first-principles answer if onboarding can carry it.

## 3. FAILURE MODES

- **The frozen month-two number.** Returning user answered everything in month one. Bar full, Match % static. A number that can't move reads worse than no number — "I'm done, nothing here." *Fix: a returning user must always find new questions or new cards, or the number is a dead-end.* This is the biggest risk and it's not solved by the number choice at all.
- **Precision lie.** Match % off 5 answers looks as authoritative as Match % off 50. If you don't show roughness/confidence, you over-promise, then correct downward later — which feels like *losing*. Every downward correction of a number the user trusted is a small betrayal.
- **Ceiling despair.** User maxes out answers, dream-job Match % still says 55%, no levers left. Now the one honest number says "you're not good enough" with nothing to do. Needs an explicit floor: some gaps are the market, not you failing.
- **The upload leak.** Decision 8 gives a *visible* level-up on upload. Bad-CV uploader gets a small jump. The weakness A tried to hide **leaks through the size of the jump anyway.** So hiding CV quality buys you nothing durable — argues for being honest-via-actions from the start.
- **Bar-as-grade.** Even with "steps to next card" framing, a bar sitting near-empty on day one can read as "you're at the bottom." Mitigate with the *first* card unlocking fast, so the bar's story is "look how quickly it moves," not "look how empty it is."

What I'm least sure of: whether the confidence-band collapse is too clever for a cold-start user, and whether Match % is even *definable* honestly on 5 questions. If Match % can't be made trustworthy early, the whole one-number plan wobbles.

## 4. FINAL RECOMMENDATION

**Show one number the user can trust — Match % — and let it carry all the honesty; back it with a bar that counts down to the next card in actions, not percent; surface CV quality only as the next fix that moves Match %. No level number, no CV-quality number.**

And fix the one real contradiction before you build: **Decision 1 says the bar is "how much JobCrush knows about you"; Decision 5 says it "measures distance to next unlock."** Those are two different mental models on one bar — one implies a whole you approach (has a hidden 100%, breaks 5), the other is a repeating local segment (has no global total, breaks 1's framing). Pick "distance to next unlock" and kill "how much we know about you" entirely. That phrase is the comforting-lie trap and the grade-anxiety trap in one sentence.

### Evidence Scout (Model D)

I have enough evidence. Here is my council response.

## 1. DIRECT ANSWER

**Two numbers, but not the two in Candidate A. Show Match % and a named rank — not a level *number*.**

- **Match %** on each card. Keep it. It's the payoff and it's per-job, so it's naturally honest — a weak CV produces visibly lower Match %, and the user reads that as "this job, not me forever."
- **Named rank instead of a level number** for "how much JobCrush knows about you." Not "Level 7," not "62%." A word ladder: *Sketch → Profile → Contender → Sharp → ...* endless. The progress *bar* stays (distance to next unlock), but the thing the user reads is a name, not a score.

Keep **Well made** and **Aimed at this job** internal. They were built as a regression harness. A mechanical-lint number shown live becomes a grade the user can't act on in the moment, and it double-counts: Match % already carries "is this CV working for this job" in the only frame that matters to the user.

**On the stress test — the honest fix is not hiding, it's relocating the signal.** Don't show a CV-quality score. Do let the *cards* tell the truth. Bad-CV user and good-CV user both start at "Sketch," but the bad-CV user's three earned cards come back with lower Match % and, critically, **named fix-actions** ("Add one metric to your last role → +2 cards at 80%+"). The truth about CV weakness arrives as *a lever they can pull*, not *a grade they can't*. That's the difference between protecting and cheating.

So: **2 visible numbers (Match %, and the progress bar with no number), 1 visible name (the rank), CV-quality stays internal but surfaces as fix-actions.**

## 2. EVIDENCE SCOUT LENS

**LinkedIn already ran your exact experiment — and chose a named ladder, not a number.** Profile Strength uses *Beginner → Intermediate → Advanced → Expert → All-Star*, not "73%." This is the closest real-world comparable to your "how much we know about you" gauge, and the industry converged on **words over percentages** for precisely the grade-anxiety reason you're worried about. But note the documented trap: LinkedIn's meter measures *completeness, not quality* — "two profiles can both be All-Star and one gets 50× more inbound because the copy is actually good." **A completeness gauge silently teaches users that filling boxes = being good.** That is the exact "comforting lie" your stress test names, and LinkedIn lives with it. Your Match % is what saves you from that trap — it re-injects the quality signal LinkedIn's meter hides. ([LinkedIn profile level](https://www.linkedin.com/help/linkedin/answer/a594698), [meet-lea benchmarks](https://meet-lea.com/en/blog/good-linkedin-profile-score))

**Honest progress bars measurably lose users.** University of Michigan research: a *slow-to-fast* bar (the most technically honest representation of remaining work) produced the **highest** abandonment at 21.8%, while fast-to-slow produced the lowest at 11.3%. SurveyMonkey found a top-of-page "% complete" bar *increased* drop-off. This is direct evidence *against* Candidate C (Match-only, no bar) and against showing a raw completeness percentage — but it's also a warning that a naïvely honest number demotivates. The endowed-progress effect (Nunes & Drèze) says the opposite works: give a head start, motivation rises. Your CV-upload "one big jump" (locked decision 8) is textbook endowed progress — keep it. ([Irrational Labs](https://irrationallabs.com/blog/knowledge-cuts-both-ways-when-progress-bars-backfire/), [Userpilot](https://userpilot.com/blog/progress-bar-psychology/))

**Match % has a known credibility failure — and Tinder walked away from the alternative.** Research: people form more positive impressions when told they're "a good match" *regardless of whether the percentage was accurate*. That cuts both ways — a Match % you can't defend erodes the trust that is already the lowest-scoring dimension in dating-app UX (trust/loyalty at the 5th/8th percentile). And Tinder **abandoned its Elo "attractiveness score"** over exactly the fairness/transparency backlash a hidden personal grade invites. Lesson: a *per-job* Match % survives scrutiny (it's about fit); a *per-person* quality grade invites the Elo backlash. This is strong evidence to keep CV-quality out of the user's face. ([MeasuringU](https://measuringu.com/online-dating-benchmark-2024/), [datingadvice survey](https://www.datingadvice.com/studies/digital-deception-survey))

**Claims needing verification before you ship:** (a) that Match % actually *moves* when a user improves their CV — if it barely budges, the "truth via cards" mechanism is a lie and you're in Candidate-A's comforting-lie failure. Instrument this first. (b) LinkedIn's "40× more likely to be contacted" is LinkedIn's own marketing stat, not independent — don't build copy around it.

## 3. FAILURE MODES

What would make my answer wrong:

- **The named rank gets decoded into a number anyway.** Users screenshot, compare, and reverse-engineer "Sharp = 80%." Reddit will publish the ladder. Named ranks reduce grade-reading, they don't eliminate it — LinkedIn users obsess over All-Star. If your ladder is short, this happens fast; only *endless* + *vague thresholds* blunts it.
- **Match % and rank tell contradictory stories.** User is "Contender" (high rank from many answers) but all cards show 45% Match. Now the gauge *is* the comforting lie the stress test warned about — high self-worth number, low real outcomes. The two visible numbers must be *coupled*: rank should not outrun Match. If answering more questions raises rank but not Match, you've rebuilt LinkedIn's completeness trap.
- **Month-two returning user — the biggest risk.** The endowed-progress jump and card-unlock dopamine are *first-session* mechanics. A user returns in week 6: rank hasn't moved (they answered everything), no new cards (no new jobs matched), bar sits frozen mid-segment. Every source above is about *onboarding* motivation; none addresses *steady-state return*. A frozen bar reads as "JobCrush stopped working." You need a **returning-user number that can move without the user doing anything** — new jobs matched this week, or Match % drift as the market changes — or the whole reward structure is a one-session firework.
- **Fix-actions that don't change the score erode trust worse than hiding it.** If "add a metric → +2 cards at 80%" is a guess and the user does it and gets nothing, that's a broken promise, which is more damaging than never showing quality at all.
- **Most uncertain:** whether "one flow for everyone" (decision 1) survives the honesty mechanism. A genuinely weak-CV user needs *more, harder* fix-actions; a strong one needs almost none. The single flow may force the weak user through a demotivating grind that a grade would at least have explained upfront.

## 4. FINAL RECOMMENDATION

**Ship two visible numbers and one name: per-job Match %, an endless named rank (Sketch → Profile → Contender → Sharp → …) with a bar showing distance-to-next-unlock but no percentage, and keep Well-made / Aimed-at-this-job internal — surfaced only as named, verified fix-actions attached to cards.** This mirrors LinkedIn's word-ladder (avoids grade anxiety) while fixing LinkedIn's actual flaw (completeness masquerading as quality) by letting Match % carry the honest signal.

**But gate the whole thing on one instrumented fact before build: confirm that improving the CV measurably moves Match %.** If it does, hiding the CV-quality number *protects* users — the truth reaches them as a lever. If Match % doesn't move with CV quality, then Candidate A is the comforting lie the stress test fears, and no naming trick saves it — you'd be hiding a weakness you also can't help them fix. And decide the **month-two returning-user number now**, not in S4: a bar that can only be moved by finishing onboarding is a firework, not a retention loop.

### Expansionist (Model E)

## 1. DIRECT ANSWER

**Two numbers visible. CV quality shown as fix-actions, not a number.**

- **Match %** on each card — the payoff, one per job.
- **Level** — a *count* ("Level 3"), not a percent, with an unlabeled bar to the next unlock.
- **CV quality (both internal scores)** — never a number to the user. It becomes **"3 ways to make this card hit harder"** attached to each card.

Here's the concrete case. A weak-CV user gets a card that says *Match 71%*. Under it: "Add a number to your last role → this card jumps." A strong-CV user gets *Match 71%* with fewer or no fix-actions. Same number on the front. The difference shows up as **how much work is left**, not as a grade stamped on their forehead.

This resolves the stress test directly. Candidate A **as written** — hide the CV scores, let the good CV "just climb faster" — is a comforting lie, because the weak-CV user never learns their CV is the thing holding them back. But the fix isn't to bolt on a third number (B) that reads "your CV: 62/100" and demotivates. The fix is to **convert the hidden score into the next move**. You never hide the truth; you hand it to them as an arrow. That's answer **A's number-count with D's mechanism**.

On the honesty question: hiding CV quality *as a static grade* protects nobody long-term — the user finds out when applications bounce. But CV quality here isn't a verdict about the person; per your own decision 8, it's a *function of how much they've told you*. So the honest, non-demotivating truth-shape is: **"Not 'your CV is a 62.' Instead: 'This card is at 71% — here's the one answer that raises it.'"** Input-driven and fixable, never a judgment.

Can a "how much we know about you" gauge survive real users? **Not as a percent** — a percent begs "percent of what?" and gets read as a grade. As a **level count with a bar to next unlock**, yes. "Level 3, Scout" is clearly about your progress in the game, not your worth. Show it as a percent and you've built the report card you were trying to avoid.

---

## 2. EXPANSIONIST LENS

**The CV-quality harness you built for internal regression testing is your entire growth loop, and you're about to leave it in a drawer.**

Everyone's arguing whether it's a visible number. Wrong axis. The two scores — "well made" (mechanical) and "aimed at this job" (panel judgment) — are a machine that generates *specific, personalized next moves* for every user, forever. That's not a meter. That's a coach.

The upside being underweighted: **fix-actions solve your month-two problem before it exists.** A search product has nothing to say to a returning user — the jobs just refreshed. A coaching product always has the next move: "You added the number last week and this card went 71→79. Two more roles need the same." The CV scores are an infinite supply of reasons to come back, and each fix-action is *also* a data-collection prompt (more answers → better tailoring, exactly decision 8). The regression harness becomes the retention engine and the enrichment engine at the same time.

The adjacent opportunity nobody named: **close the loop with outcomes.** Match % + fix-action + "did your callback rate move after you applied the fix?" turns JobCrush from "here are jobs" into "here's proof the coaching works." That's the difference between a tool people use once and a habit they pay for. Success beyond expectations isn't a better job board — it's the product that can say *"users who did their top-3 fix-actions got 2x the callbacks,"* which is a marketing claim no LinkedIn search can make.

And it makes decision 6's 10-second reversal test *easier to win*: cards that arrive already saying "here's why this fits AND here's your one move" beat a static LinkedIn list in the first 10 seconds far more decisively than a bare Match % does.

---

## 3. FAILURE MODES

**The crux I'm most uncertain about: does Match % already encode CV quality, or not?**

- If Match % is **user-facts vs. job-requirements**, a badly-*written* CV doesn't lower it. So the weak-CV user sees a high Match %, applies, gets silently filtered by the ATS, and the number was a lie. This is the real cheat and it survives my answer unless fix-actions are **visibly urgent on weak cards**, not buried.
- If Match % **includes how well the tailored CV surfaces things**, then CV quality is already partly visible and honest — but then a weak CV *should* drag the number down, which contradicts decision 8's "same 3 cards for everyone." You can't have both "everyone gets 3 fully-scored cards" and "Match % honestly reflects a weak CV." One of those bends.

Other ways I'm wrong:

- **Fix-actions get ignored.** If they're optional garnish, the hiding-the-truth problem returns intact. At least one must be unavoidable on a genuinely weak card.
- **Month-two stall.** If Level = "how much we know about you," a user who answered everything hits a ceiling and the bar dies — which *directly contradicts your decision 5* (see part 5). New cards must come from the *market moving*, not just from the user answering more.
- **Two clocks confuse.** Instant doc-update, slow bar, rare card unlock (decision 4) means three response speeds. Users may not learn which number their action moved. The fix-action helps here — it names cause and effect ("do X → this card moves").

---

## 4. FINAL RECOMMENDATION

**Ship two visible numbers — Match % (per card) and Level (a count, never a percent) — and turn both CV-quality scores into per-card fix-actions instead of a third number.** That keeps the screen simple, kills the "report card" read, and — critically — never hides CV quality; it reframes it from a demotivating verdict into "here's your next move," which is simultaneously the honest signal, the month-two retention hook, and the enrichment prompt that feeds better tailoring.

**Before you build it, settle one thing:** does Match % reflect the *quality of the CV behind the card*, or only the *fit of the facts*? If it's fit-only, then hiding CV quality is a real lie and the fix-actions must be loud on weak cards. If it reflects CV quality, then decision 8's "everyone gets the same 3 scored cards" is the decision that has to bend. You can't leave that ambiguous — it's the seam the whole honesty question hangs on.

**Real contradiction to flag (part 5):** Decision 1 frames Level as *"how much JobCrush knows about you"* — a **finite** quantity (there's a bottom to the well of facts about one person). Decision 5 says levels are **endless, never 100% complete**. These can't both be true: knowledge-about-you caps, so the bar must eventually fill. Resolve it by reframing the bar from *"how much we know about you"* (finite) to *"your hunt readiness / power"* (endless, because the job market is endless). Same bar, honest meaning. Secondary soft tension: decision 3 ("about 5 questions for everyone") vs. decision 8 ("poor CV = more questions") — reconcile by making 5 the *default* and stating openly that a thin CV adds a few.

---

## Stage 2: Peer Reviews

### Executor's Peer Review

I'll skip the ceremony and go straight at the three questions. (Ponytail note: this is an analysis request, not code — I'm answering in full, no diffs to minimize.)

## Q1. Which response most changed how I'd answer — and why

**The Contrarian, with one line: "Count again — the reveal screen shows four numbers."**

Here's the concrete thing that flipped me. The parent framing is "two visible numbers vs three vs one." Every argument about *hiding* CV quality assumes you can hide it. But a weak-CV user's reveal screen shows three cards at **48% / 55% / 51%**. The user doesn't read those as "three nice cards" — they read the cluster: *why is everything in the 50s?* The CV-quality signal has already shipped. You just refused to explain it.

That reframes the whole honesty debate. The question isn't "hide the grade or show the grade." The signal leaks through the Match % cluster no matter what. So the only real choices are: **explain the leak (fix-actions) or leave it mute (comforting lie by omission).** That's a sharper cut than "how many meters," and it's the one that changed my answer from "two numbers, A" toward "Match % + fix-actions, and the level *number* is the weakest thing on the screen."

Runner-up that also moved me: the **Evidence Scout's** hard data that a *technically honest* slow-to-fast progress bar produced the **highest** abandonment (21.8%). That kills the intuition that "honest = safe." A naively honest gauge measurably demotivates. It's the empirical floor under everyone else's hand-waving about grade-anxiety.

## Q2. Biggest blind spot

**The Evidence Scout — its own recommendation contradicts its own evidence.**

Scout recommends a **named rank** (Sketch → Contender → Sharp) specifically to dodge grade-anxiety, citing LinkedIn choosing words over percentages. But Scout *also* documents that LinkedIn users obsess over "All-Star," that Reddit reverse-engineers the ladder into numbers, and that named tiers become grades anyway. So the evidence Scout gathered argues *against* the recommendation Scout made. A word-ladder is a *slower-decoding* grade, not a not-grade.

And the concrete gap: a named rank is arguably **more** of a verdict on the *person* than a number is. "62%" is cold and abstract; "**Contender**" is a character judgment. Endlessness doesn't fix that — "Contender" still sits on the person's forehead. Scout half-sees this (lists it as a failure mode) then recommends it anyway. That's the material miss: it adds a visible thing whose whole justification its own sources undercut.

(Honorable mention: the **Expansionist's** "close the loop with callback outcomes" marketing claim leans on callback-attribution data that is sparse, delayed, and noisy — you may never get a clean "users who did fix-actions got 2× callbacks" signal. Role-induced over-reach, but flagged as "adjacent opportunity," so less load-bearing than Scout's core recommendation.)

## Q3. What ALL four missed

**Decision 6 creates a structural incentive to inflate Match % — the one number all four made load-bearing.**

Every response converged on the same architecture: strip the level number, hide CV quality, and let **Match % carry all the honesty**. Fine. But look at Decision 6's reversal clause: *if v1 cards aren't obviously better than LinkedIn within 10 seconds, move the wall before the reveal.* That is direct product pressure to make the three reveal cards **look impressive fast**. The cheapest lever to pass that test is nudging Match % up.

So the plan has a built-in conflict none of the four named: **the reversal test pushes Match % upward, and the honesty of Match % is the entire foundation of every recommendation here.** The moment a PM tunes Match % to win the 10-second test, the "one honest number" becomes the comforting lie — and now it's the *only* signal, with the level number and CV grade already deleted as safety valves. You've concentrated all the trust into the number most exposed to inflation pressure.

The council should add a constraint: **Match % must be defined and calibrated against a real outcome (interview/callback correlation) and frozen against the reversal test.** Whatever makes cards "beat LinkedIn in 10 seconds" has to be *card copy, fix-actions, and relevance* — never a thumb on the Match % scale. Otherwise the whole "let Match % carry the truth" consensus is building a single point of failure and then wiring the product's own success metric to corrupt it.

Second, smaller thing all four glossed: three cards at 48/55/51 shown to a **brand-new** user is itself a bounce risk — the same abandonment logic Scout applied to progress bars applies to a cluster of mediocre Match %s as a *first impression*. Contrarian noticed the cluster but framed it as honesty, not as a cold-start bounce that could fail Decision 6 for exactly the weak-CV users the honesty debate is about.

---

**Net:** the council is right and unanimous on the mechanics (Match % + motion-only bar + fix-actions, kill the level number, keep CV scores internal, resolve Decision 1 vs 5 toward "distance-to-next-unlock"). The unexamined risk is that they've made Match % the sole truth-bearer *without noticing Decision 6 is engineered to corrupt it.* Fix that before build, alongside the month-two returning-user number they all correctly flagged.

### Contrarian's Peer Review

## Q1. Which response most changed how I'd answer

**Evidence Scout (D)** — because it's the only one that attacked the *premise* of the honesty question with data instead of intuition.

The specific update: everyone (including me, before reading it) was treating "honest" and "motivating" as compatible if you frame the number nicely. D's Michigan finding breaks that — the *most technically honest* progress bar (slow-to-fast, showing that the hard part remains) produced the **highest** abandonment (21.8% vs 11.3%). And the LinkedIn "completeness masquerading as quality" case is the stress-test's comforting lie, documented in a live product: two All-Star profiles, one gets 50× the inbound. That reframes the verdict. The question isn't "hide the CV grade or show it" — it's "an honest gauge *of the wrong thing* (completeness) is the actual trap, and Match % is what re-injects the quality signal LinkedIn's meter suppresses." That's a sharper argument than the other three's "route it into fix-actions," which they all asserted without evidence that fix-actions motivate better than a grade.

The Tinder Elo detail also earns its place: per-job % survives scrutiny, per-person grade invites the fairness backlash. That's the cleanest single reason CV-quality stays internal.

## Q2. Biggest blind spot

**Expansionist (E).** Its blind spot is calibration, and it's material because E's whole recommendation rests on the uncalibrated thing.

E wants to promote the internal CV-quality harness into "a coach," an "infinite supply of reasons to come back," and eventually an outcome loop ("did your callback rate move after the fix?"). But `docs/cv-quality-kickoff.md` defined those two scores as a **regression/workbench harness, explicitly not a live meter**. Executor caught exactly what E missed: the moment a fix-action promises "add a metric → this card jumps," you've made the test fixture drive a user-facing commitment, and if the delta doesn't fire, trust dies. E builds three floors (coach, retention engine, callback-proof marketing claim) on a foundation it never checks is load-bearing. The role (find the upside everyone underweights) is applied usefully — the retention insight is real — but it caused E to skip the one question that gates its own plan.

(Runner-up: **Fundamentalist's** confidence-band idea — "62%, still rough → 62%, confident" — is elegant but it's a *second* number-behavior smuggled onto the one number it just argued should carry everything, and cold-start users won't read a moving confidence band. C half-admits this in its own uncertainty note.)

## Q3. What ALL FOUR missed

Two things, both repo-grounded and both capable of changing the recommendation.

**1. The reveal shows THREE Match %s at once, and the aggregate is the personal grade everyone tried to avoid.**

Every response counted "Match %" as one number and reasoned about it in the singular. But locked decision 3/6 says the payoff is **3 scored cards, fully visible, side by side**. So the dominant numeric experience of onboarding is not one number — it's a *spread*: 78 / 71 / 54, or 45 / 44 / 41. The per-job framing ("this job, not you") is exactly the escape hatch all four leaned on, and it **collapses when all three read low**. Three cards at ~44% is not read as "three jobs I don't fit" — it's read as "44% is what I'm worth," delivered three times on one screen. The council debated whether a *level bar* becomes a grade; the real grade risk is the Match-% spread itself, and nobody modeled the aggregate read. That could push the answer toward Fundamentalist's one-number instinct being *worse*, not better, than they think — one number shown thrice is still a verdict.

**2. The "fix-actions" they all invented already partly exist — S2 shipped "fix-this review."**

CLAUDE.md: S2 (done) delivered an "audited root CV with **fix-this review**" plus claim-graph v1. All four independently proposed "surface CV quality as fix-actions" as a *new* mechanism, none noticing the product already has a fix-this surface on the root CV. The real design question isn't "should we invent fix-actions" — it's "how does the *card-level* fix-action relate to the *root-CV* fix-this review the user already met in the confirm deck?" Two fix surfaces that disagree (root CV says one thing, card says another) is a concrete month-two confusion none of them named. A council answer that reinvents a shipped feature is missing the seam where the new idea meets the existing one.

Minor shared gap worth a line: all four flagged the Decision-1-vs-5 contradiction ("how much we know about you" = finite vs. "endless levels"), and they're right it's the one real contradiction. But none noted it's *already partly resolved by the repo* — the claim graph is the substrate, so "readiness/power over an endless market" (E's reframe) is the honest and buildable meaning, and that's the cheapest fix, not a redesign.

### Fundamentalist's Peer Review

Not a coding task, so ponytail governs nothing here — straight critique.

First, the thing worth saying before the three answers: **all four converged hard.** Match % is the only real grade; kill/rename the Level number; keep CV-quality internal but surface it as fix-actions; flag Decision 1 vs Decision 5; worry about month-two; gate on "does Match % move with CV quality." That much agreement across five independent seats is either strong signal or shared blind spot. Mostly signal — but the shared crux they all landed on is, I think, the wrong crux (Q3).

## Q1. Which response most changed how I'd answer — Evidence Scout

Everyone else reasons from first principles toward "be honest." Evidence Scout is the only one that put a price on honesty, and the price flips the reflex.

The concrete update: the University of Michigan finding that the *most honest* progress representation — a slow-to-fast bar that truthfully shows work getting harder — produced the **highest** abandonment (21.8% vs 11.3% for fast-to-slow). Before reading that, my instinct matched the council's: "just represent progress truthfully." That finding says naive honesty in the *progress bar specifically* measurably loses users. Honesty about the CV (via Match %) and honesty about progress-remaining are different axes, and the second one demotivates when shown straight.

Second update from the same response: the LinkedIn "completeness masquerading as quality" trap is the exact shape of the stress-test's comforting lie, observed in a shipped product at scale. That reframes the whole question — the danger isn't hiding CV quality, it's a gauge that *teaches users box-filling equals being good*. That's a sharper statement of the risk than the parent's stress test, and it's evidence, not assertion.

(Honorable mention: the Contrarian's "count again — the reveal shows four numbers, three Match %s plus Level" is the single sharpest logical hit. Every "two numbers" answer is answering a question the screen contradicts. But it corrected the count more than it changed my recommendation.)

## Q2. Biggest blind spot — Contrarian

The Contrarian's central *mechanism* is self-defeating: **"the Level bar must be mechanically forbidden from advancing unless Match % also rises."**

Concrete failure: Match % is per-job and depends on the external job market, which the user does not control. A user answers three questions in week six — does real work — but no new well-fitting jobs posted that week, so Match % is flat. Under the Contrarian's rule, the bar is *frozen despite effort.* That recreates the exact month-two stall the Contrarian spent a paragraph warning about, except now it punishes the user for the market's behavior rather than their own inactivity. Coupling a controllable input (my answers) to an uncontrollable output (this week's job pool) is worse than either number alone. The instinct — don't let the bar climb while matches stay flat — is right as a *warning*, wrong as a *hard mechanical lock*.

## Q3. What all four missed — Match % is structurally inflated at reveal, so "does it move with CV quality" is the wrong crux

Every response converged on the same gate: *instrument whether improving the CV moves Match %.* Necessary, but it assumes the reveal-time Match % is trustworthy in the first place. Two reasons it isn't, neither of which any response named:

**1. Selection bias.** Decision 3 says the user earns *3 real, scored cards* — and any sane product shows the user their **best 3**, not 3 random jobs. A number computed over the top 3 of a ranked pool systematically overstates fit. The weak-CV user sees 55/51/48 as their *ceiling*, not their average — the true distribution is worse. So the "truth via Match %" mechanism everyone relied on is already biased upward before CV quality even enters. Nobody accounted for the cherry-pick.

**2. Thin data.** At reveal the user has answered ~5 questions and has *not* hit the wall. A Match % to the integer ("78%") computed off five facts is false precision — noise wearing a lab coat. The council spent real energy debating named-rank-vs-number for the *Level* gauge (Evidence Scout's LinkedIn ladder, etc.), and then unanimously kept the *Match* number as a raw integer percent — the one number they all agreed carries the honest load. But a precise percent invites the same reverse-engineering and grade-anxiety they rejected for Level, on far thinner data. A bucket ("Strong / Fair / Long-shot") would be both more honest about the uncertainty and harder to weaponize than "51%."

Why this changes the recommendation: the whole "hide CV quality, let Match % carry the truth" consensus rests on Match % being an honest per-job signal. If it's inflated by selection and over-precise on five answers, then at reveal *both* the good-CV and bad-CV user get comfortable-looking numbers — which is the parent's comforting-lie failure arriving through the front door everyone left open, independent of whether CV quality moves the number later.

The fix-shape: show Match as a **coarse bucket at reveal** (thin data, selection-biased) and let it **sharpen to a number only after the wall**, once enough answers exist to justify the precision. That also gives the month-two returning user something honest that can move — the bucket tightening as they answer is real, earned motion that doesn't depend on the market posting new jobs.

### Evidence Scout's Peer Review

I'm evaluating the four responses as a critic, not writing code — ponytail doesn't apply here. Straight to the three questions.

## Q1. Which response most changed how I'd answer — and why?

**The Expansionist (E).** One question it asked reframes the whole debate:

> *Does Match % reflect the quality of the CV behind the card, or only the fit of the facts?*

Here's why that lands. Everyone — A, B, C, and the parent — leans the entire honesty argument on one load-bearing assumption: *"Match % carries the truth, so we can hide CV quality safely."* E is the only one who checks whether that beam holds. And it doesn't, in one of the two cases:

- If Match % = **facts vs. job requirements**, then a badly *written* CV (right facts, buried, ATS-hostile) still scores high. The weak-CV user sees 78%, applies, gets silently filtered by the resume parser, and hears nothing. The number wasn't a comforting lie — it was an *actively wrong* one that sent them into a wall. That is worse than the stress test's fear, and it survives all of A/B/C's designs untouched.
- If Match % *does* include CV quality, then a weak CV must drag it down — which breaks Decision 8's "everyone gets the same 3 fully-scored cards."

So "how many numbers" was never the real question. The real question is *what the one honest number is actually measuring*, and until that's answered you can't know whether hiding CV quality is honest or fraudulent. That forced the biggest update in my own view: the verdict shouldn't be "two numbers vs one" — it should be **"define Match %'s inputs first; the number-count falls out of that."**

(Honorable mention: the Contrarian's "the reveal screen already shows *four* numbers — Level plus three Match %s — and users rank them the instant they see 48/55/51." That's a sharp catch that the "two numbers" framing was self-deceiving. But it changes the framing, not the recommendation.)

## Q2. Which response has the biggest blind spot?

**The Contrarian (B)** — and it's a self-inflicted one.

B's headline fix is: *"the Level bar must be mechanically forbidden from advancing unless Match % also rises."* It sounds tidy — tie reward-motion to outcome. But B itself diagnoses, two paragraphs earlier, that **"Level up, Match flat" is a real, common, honest state** ("JobCrush knows more about me AND I'm still a bad fit").

Put those together: in the *exact case B identified as common and honest*, B's own rule **freezes the bar**. And a frozen bar is the month-two death B spends its own §3 warning about.

It also quietly breaks two *locked* decisions:
- **Decision 8** — CV upload gives a "visible level-up." If the bar can't move without Match % moving, upload can't produce a jump on its own.
- **Decision 4** — three distinct feedback speeds (instant doc update, *slow bar*, rare card). Chaining the bar to Match % collapses two of the three speeds into one.

So B's central mechanism contradicts B's own analysis *and* two constraints it was told not to reopen. That's a bigger, more concrete defect than the others' (A and C both self-flag their weakest link; E's weak spot — trusting the regression harness as a live driver — is at least shared and acknowledged).

## Q3. What did ALL four miss?

**They optimized the number for honesty and motivation, and none of them checked what it does to signup conversion at the Decision-6 wall.**

Concrete case. Dana has a weak CV. Under the honest design everyone converges on, she hits the reveal and sees three cards at **48% / 55% / 51%** *before* the account wall (Decision 6: reveal, then account required to save/apply/see rest). Two things can happen:

1. She reads "I'm a 50% person here," feels the low number is a verdict, and **bounces before creating an account** — so JobCrush never captures the very user who has the most to gain from coaching.
2. The fix-actions are compelling enough that she pushes through the wall to act on them.

The whole product depends on outcome (2), and **not one of the four modeled it.** They debated whether the honest number *demotivates* — but demotivation right before an un-skippable signup gate isn't a UX feeling, it's a funnel collapse, and it hits weak-CV users hardest. That could flip the recommendation: show Match % *fit* pre-wall but hold the sharp low numbers / lead with the fix-action framing until the account exists — or it feeds directly into Decision 6's own reversal clause (move the wall before reveal).

A second thing all four skipped, worth one line: **a visible Match % is a Goodhart target.** Users will reverse-engineer and keyword-stuff their CVs to move it — the exact ATS anti-pattern `docs/cv-brain` exists to prevent. A visible fit score can train the precise behavior the source of truth forbids. That's not a nuance; it's the visible number picking a fight with the CV brain, and nobody named it.

---

**Net:** the council is right that the *shape* is "one honest number + a wordless bar + CV quality as fix-actions," and right that Decision 1 vs Decision 5 is the one real contradiction (all four found it — it's genuine). But before locking the count, settle E's question (what Match % measures), fix B's would-be frozen bar, and model what an honest low number does to a not-yet-signed-up weak-CV user.

### Expansionist's Peer Review

Not a coding task — ponytail governs what I build, not this critique. Straight analysis below.

First, the striking thing: all four converged. Match % is the only "real" grade, strip the number off the level bar, keep CV-quality internal and surface it as fix-actions, flag Decision 1 vs Decision 5 as the contradiction, name month-two as the top risk. When four decorrelated models land in the same place, either it's right or they share a blind spot. I think it's mostly right *and* they share one (Q3).

## Q1. Which response most changed my answer

**Evidence Scout (D).** The others reason from first principles about honesty; D brings the one thing the debate was missing — evidence that the honesty *reflex is measurably wrong in progress UX*.

The specific update: the Michigan finding that a **slow-to-fast bar (the most technically honest shape) produced the highest abandonment (21.8%)**, and SurveyMonkey's "% complete" bar *increasing* drop-off. Before reading D, my instinct — and every other member's — was "the honest move is to show truth, just shape it kindly." D shows that naïve honesty in a progress meter doesn't just risk demotivation, it empirically maximizes it, and that Decision 8's CV-upload jump is textbook *endowed progress* (Nunes & Drèze), i.e. evidence-based, not a comforting hack. That reframes the whole stress test: the question isn't "honest vs comforting," it's "which honest framing doesn't measurably bleed users." That's a real move.

The second thing D and the Executor both land — **instrument that improving the CV actually moves Match % before you build** — is the operational hinge the whole consensus rests on, and D states it as a hard gate. That sharpened my confidence that the answer is conditional, not clean.

## Q2. Biggest blind spot

**Contrarian (B).** Its central mechanic — "the Level bar must be *mechanically forbidden* from advancing unless Match % also rises" — has a concrete failure B never sees: **it directly contradicts locked Decision 8 and freezes progress for exactly the users who need encouragement most.**

Concrete case: Dana's dream jobs are genuine stretches. Match % is "user vs this specific job" — capped by real fit. She answers 20 more questions; her profile and tailoring improve, but the three shown cards' Match % barely moves because her underlying fit for *those* jobs hasn't changed. Under B's rule the bar sits frozen — punishing effort. Worse, Decision 8 *mandates* a "visible level-up" on CV upload; but upload improves tailoring, not necessarily the Match % of the specific shown cards, so B's rule can suppress the level-up the locked decision requires. B coupled reward-motion to an outcome the user frequently can't move, and called it honesty. It's demotivation by construction, and it breaks a locked constraint. B was so focused on killing the "leveled up while matches stay in the 50s" lie that it over-corrected into "you're not allowed to feel progress unless a stretch goal moves."

(Honorable mention: D's *named rank* reintroduces the per-person grade the stress test warns against — a word ladder about "how much we know about you" is still a self-worth verdict — but D at least concedes this openly. B's flaw is unseen.)

## Q3. What ALL four missed

**They all conflate two orthogonal things: Match % (fit) and CV quality (writing/ATS survivability). Match % cannot carry the CV-quality signal, because they don't measure the same thing.**

The consensus fix is "don't show CV quality — let the low Match % and its fix-actions tell the truth about a weak CV." But look at the definitions in the repo's own docs:

- **Match %** = user vs *this specific job* — the user's actual fit (skills, experience, trajectory).
- **Well made** = mechanical lint over CV *writing* rules.
- **Aimed at this job** = whether the tailored CV *surfaces the right things*.

None of those three is the other. A strong candidate with a badly-*written* CV can have genuinely **high fit** → **high Match %** → and a CV that a real ATS still shreds on formatting. JobCrush then shows "82% match" and stays silent on the writing weakness, because the writing weakness doesn't live in Match %. **That is the comforting lie the stress test is actually reaching for — and every response walked past it**, because they assumed "weak CV → low Match %." Sometimes yes (weak *aim* can lower Match %), but *mechanical* CV quality ("Well made") is close to orthogonal to fit. The whole "relocate the signal into Match %" strategy quietly drops the "Well made" axis on the floor.

This could change the recommendation. If Match % genuinely can't carry the "Well made" signal, then the council needs *either* a second surfacing path for mechanical quality (still as a fix-action, not a grade — "your dates aren't ATS-readable → fix") *or* an explicit decision that mechanical quality is JobCrush's job to silently fix in the tailored CV by-product, never the user's to see. That second option is actually the cleanest and nobody proposed it: **the tailored CV is a by-product JobCrush controls (Decision 2), so "Well made" should never be a user signal at all — the product should just make the output well-made and only ever surface "Aimed" gaps as answerable fix-actions.** That collapses the honesty problem, because the user is never responsible for the mechanical axis in the first place.

Secondary shared gap: everyone names month-two as the top risk, but nobody notes its fix is a **supply problem, not a UX-number problem** — "new jobs/questions on return" depends on job-inventory freshness, an S3+ data-pipeline commitment. No number scheme touches it; picking Match-only vs named-rank is irrelevant if the card supply is stale on return.

---

Net: the group's shared answer (Match % as the one number, no level number, CV-quality internal-as-fix-actions, resolve Decision 1 vs 5 toward distance-to-next-unlock) is the right frame — but it's built on a fit/writing conflation that needs resolving, and the cleanest resolution is one none of them named: mechanical quality is the product's job, not the user's number.

**Anonymization mapping:**
- Model A = Executor (Claude (opus) [medium])
- Model B = Contrarian (Claude (opus) [medium] [fallback from Fireworks (accounts/fireworks/models/deepseek-v4-pro)])
- Model C = Fundamentalist (Claude (opus) [medium] [fallback from Fireworks (accounts/fireworks/models/glm-5p2)])
- Model D = Evidence Scout (Claude (opus) [medium] [fallback from Fireworks (accounts/fireworks/models/qwen3p7-plus)])
- Model E = Expansionist (Claude (opus) [medium] [fallback from Fireworks (accounts/fireworks/models/kimi-k2p7-code)])

---

## Stage 3: Chairman's Synthesis

## WHERE THE COUNCIL AGREES

Dana uploads a weak CV and sees three cards at 52%, 56%, and 49%. The right response is not “Your CV is 41/100.” It is: “This role is a 56% match. Add one measurable result from your last job to improve this card.”

Executor, Contrarian, Fundamentalist, Evidence Scout, and Expansionist all converge on this: raw CV-quality scores stay internal. “Well made” and “Aimed at this job” are QA signals, not user meters.

They also agree that Match % is the only number that naturally belongs on the card. It is tied to the payoff: this user, this job, this tailored CV.

There is strong agreement that a numbered Level, percent-complete bar, or “how much we know about you” gauge will be read as a grade. The surviving version is not “Level 3” or “42% known.” It is a motion-only unlock bar: progress toward the next card.

## WHERE THE COUNCIL CLASHES

The main clash is whether Level should remain visible as a count or named rank. Expansionist and Evidence Scout allow “Level 3” or “Sketch / Contender / Sharp.” Executor, Contrarian, and Fundamentalist strip it out. The stronger position is: no visible level number or rank. Named ranks still become grades, and “how much we know about you” is finite while the product wants endless progress.

Contrarian wanted the bar forbidden from moving unless Match % rises. That is too rigid. A user can answer useful questions while the current job market does not produce a higher match. Progress should reflect earned unlock distance and profile confidence, not be chained mechanically to this week’s cards.

The deeper clash is what Match % measures. It cannot be a vague blend of “fit,” “CV quality,” and “product excitement.” The stronger answer: Match % measures job fit based on known facts and evidence confidence. Mechanical CV quality is JobCrush’s job to fix. Job-specific aiming gaps surface as fix-actions.

## BLIND SPOTS THE COUNCIL CAUGHT

“Two numbers” is misleading. The reveal screen shows three Match % values at once. A cluster like 48 / 51 / 55 will feel like a personal grade even if each number is per-job.

Match % is exposed to inflation pressure. Decision 6 pushes the product to beat LinkedIn within 10 seconds, and the easiest dishonest path is making scores look higher. Do not let the conversion test tune the score.

Five-question onboarding creates false precision. A raw 78% after thin data should be rounded, qualified, or treated as an early estimate.

Visible Match % can become a Goodhart target. Users may keyword-stuff to move the number, which fights the CV-brain rules.

S2 already has a root-CV “fix-this review.” Card-level fix-actions must reuse or reconcile with that surface. Two different fix systems will confuse returning users.

Month two is the biggest retention risk. A stale bar, stale cards, or repeated “nothing new” screen makes the product feel dead. This is a supply problem: new jobs, new questions, new market movement, and fresh card opportunities.

The real contradiction is the current Level framing versus locked decision 5. “How much JobCrush knows about you” is cumulative and finite. “Distance to next unlock” is local and repeating. Pick the second. Delete the first.

## THE RECOMMENDATION

Show one visible score type: **Match %**.

The user may see three instances of it because there are three cards, but it is one kind of number: **“Match for this job.”** Round it. Keep it plainly per-card. Do not let it become “your worth,” “your CV grade,” or a marketing score.

Do not show a Level number. Do not show a profile-completeness percent. Do not show named ranks. The progress bar should be framed as **Next card progress**, with motion and unlock feedback, not as “how much we know about you.”

Keep CV-quality scores internal.

“Well made” should mostly be silently handled by JobCrush in the generated CV. If the user must supply missing facts, show a concrete fix.

“Aimed at this job” should surface as card-level actions: “Add a metric from your ERP migration,” “Confirm budget size,” “Name the stakeholder group.” No raw score.

Hiding CV quality protects users only if the product either fixes the issue or turns it into a clear next action. It cheats them if weak CV quality stays invisible while the UI celebrates progress. The truth-shape is: “This card can improve if you add X,” not “your CV is bad.”

Confidence: high. The one condition that reverses this recommendation is if Match % cannot be defined and protected as a trustworthy fit score. If it becomes a fuzzy optimism meter, you need a separate visible readiness/fix state before apply.

## THE ONE THING TO DO FIRST

Write the **Job Card Score Contract** before UI work: define what Match % includes, what it excludes, how it is rounded, when it can change, how fix-actions relate to it, and the invariant that the 10-second reveal test may not inflate it.

---

## Council Composition

- Model A (Executor) โ’ Claude (opus) [medium]
- Model B (Contrarian) โ’ Claude (opus) [medium] [fallback from Fireworks (accounts/fireworks/models/deepseek-v4-pro)]
- Model C (Fundamentalist) โ’ Claude (opus) [medium] [fallback from Fireworks (accounts/fireworks/models/glm-5p2)]
- Model D (Evidence Scout) โ’ Claude (opus) [medium] [fallback from Fireworks (accounts/fireworks/models/qwen3p7-plus)]
- Model E (Expansionist) โ’ Claude (opus) [medium] [fallback from Fireworks (accounts/fireworks/models/kimi-k2p7-code)]
- Chairman -> Codex (gpt-5.5) [xhigh]