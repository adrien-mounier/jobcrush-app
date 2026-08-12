# Council Transcript

**Session:** 2026-07-22 21:18:44  
**Question:** Q6 — Where does the signup wall go in JobCrush's new gamified onboarding flow?

CONTEXT: JobCrush is a hosted CV-tailoring product (Fastify API + Next.js web/mobile). Today the signup wall (magic-link + Google OAuth) sits right after the CV preview: user uploads a CV, sees a tailored preview for free, then must give an email to keep it. That is live and works.

But the product is moving the magic: the first real payoff becomes the first SCORED JOB CARDS, which arrive after the user answers roughly 5 onboarding questions. So the wall may have to move too. Three candidate placements:

1. Before question 1. Tinder/Bumble style — account first, play after. Maximum captured emails, but a stranger who has been given nothing has no reason to hand one over. Current flow deliberately avoids this.
2. At the first unlock. They answer ~5 questions, the scored job cards drop on screen — real jobs, real scores, visible — and to KEEP them or apply they need an account. Reward first, wall second. Same shape as today, just moved down the road.
3. Much later. Only when they want to actually apply. Most generous, but we lose everyone who leaves at level 2 — and we lose their answers with them.

Known trap in option 2: those ~5 answers are real work. If someone closes the tab at question 4 that work must not vanish. Solvable by holding answers in the browser (localStorage/anon session) and attaching them to the account at signup — but that is a real engineering requirement, not a detail.

USER CURRENT RECOMMENDATION: option 2, at the first unlock. Show the cards, then ask for the email. It keeps the proven give-the-magic-free-charge-for-keeping-it shape already known to work here, and the ask lands at the exact moment the user has just seen something worth keeping.

WHAT IS AT STAKE: signup conversion vs. completion of the onboarding funnel; loss of answer-work on abandonment; whether anonymous-session engineering cost is justified; whether option 2 is actually the local optimum or just the familiar one.

Interrogate the recommendation hard. Is option 2 right? Is there a fourth option (e.g. soft/progressive wall, email captured mid-flow as a save-my-progress affordance, or a partial-reveal wall showing blurred cards)? What evidence exists from comparable consumer products?

---

## Framed Question

## CORE QUESTION

Where should the signup wall sit in JobCrush's new gamified onboarding flow — specifically, is option 2 (wall at first unlock, after ~5 onboarding questions surface scored job cards) the right placement, or does a fourth option (progressive/soft wall, mid-flow save-my-progress capture, partial reveal) dominate it?

## USER CONTEXT

- Current live flow: CV upload → tailored preview (free) → signup wall → account features. This works.
- The product is pivoting: the first meaningful payoff is no longer the CV preview but **scored job cards**, which appear after ~5 onboarding questions answered by the user.
- Three candidate placements evaluated:
  1. **Before Q1** — account first, magic second. Maximum email capture, zero prior value delivered.
  2. **At first unlock** — answer ~5 questions, see real scored job cards, wall to keep/apply. User's current recommendation.
  3. **Much later** — only at apply intent. Most generous; loses everyone who exits at level 2 along with their answers.
- Known engineering trap in option 2: ~5 answers represent real user effort; tab-close at Q4 loses that work. Mitigation: localStorage/anonymous session with merge-on-signup — acknowledged as a real engineering requirement.
- User is recommending option 2 and wants it interrogated hard: is it actually the optimum, or just the familiar shape?
- Open challenge: is there a fourth option (soft/progressive wall, save-my-progress email capture mid-flow, blurred partial reveal)?

## WORKSPACE CONTEXT

- Stack: Fastify API + Next.js web/mobile, Postgres for the claim graph, in-memory session store per machine (one machine constraint until store moves to Postgres/Redis — see `docs/deploy.md`).
- S2 is done and shipped: the existing wall lives at `JC-18/19/20`, immediately post-preview. The anon→account merge was deliberately kept simple: only two anonymous assets ever existed (uploaded CV + preview job), so the merge was a single ownership update.
- The S2 design doc (`docs/s2-kickoff.md`) explicitly states the wall sits "immediately after the preview" and calls out that the anon→account merge was kept minimal by design.
- S3 is next ("the hunt" — E5 cluster engine first). The gamified onboarding flow with scored job cards is the S3 product shape.
- The current wall uses magic-link + Google OAuth (live, verified with real email sender `jobcrush.org`).
- Anonymous session engineering is not trivially free here: the in-memory session store is already a scaling constraint; adding durable anonymous sessions with question-answer state and a merge-on-signup path is a meaningful scope increase over the S2 anon merge (which handled only two assets).

## WHAT'S AT STAKE

- **Signup conversion rate**: placing the wall before any value is delivered (option 1) historically tanks conversion; placing it too late (option 3) loses users who never reach the wall. Option 2 bets the conversion peak lands exactly at the scored-cards reveal moment.
- **Funnel completion vs. answer loss**: ~5 questions is real cognitive investment. Abandonment at Q3–4 with no recovery path wastes that work and gives the product no data. The anonymous-session engineering cost to prevent this is non-trivial given the current in-memory store constraint.
- **Engineering scope**: option 2 implicitly requires durable anonymous state (localStorage minimum, server-side anon session preferred for cross-device), a merge-on-signup path for question answers, and handling of the edge case where a user returns on a different device. This is meaningfully more complex than the S2 anon merge.
- **Whether option 2 is the local optimum or just familiar**: the existing S2 wall follows the same "reward first, charge for keeping it" shape. Option 2 replicates that shape one step later. A fourth option (e.g. mid-flow soft capture framed as "save your progress" rather than a hard wall, or a partial-reveal/blur of job cards) could capture email earlier with lower friction, potentially dominating option 2 on both conversion and engineering cost.
- **Data loss on the business side**: options 2 and 3 allow users to complete some or all of the funnel anonymously; if they abandon, their onboarding signal (job preferences, answers) is lost unless explicitly persisted — reducing the product's ability to improve the scoring model.

---

## Stage 1: Advisor Responses

### Executor (Model A)

## 1. DIRECT ANSWER

Option 2 is not the optimum. It's the shape you already know (S2's "reward then wall") copy-pasted one step later, and it happens to be the most expensive option to build.

The fourth option — a soft email capture at Q2–3 framed as "save your progress" — likely dominates option 2 on both conversion and engineering cost. Here's why:

- **Engineering:** Option 2 requires durable anonymous state for ~5 answers, a merge-on-signup path more complex than S2's two-asset merge, and mitigation for your in-memory session store constraint. Option 4 captures an account at Q2, so answers 3–5 are stored against a real user. No anonymous merge. No localStorage fallback. No cross-device problem. The hardest infrastructure you'd need for option 2 simply doesn't exist in option 4.
- **Conversion:** By Q2, the user has invested effort (sunk cost) but hasn't yet seen the expensive payoff (scored cards). "Save your progress" is a service, not a gate — it converts the same psychology (loss aversion for work done) but frames it as helping, not blocking. The hard wall in option 2 lands at the moment of peak curiosity (scored cards just appeared), which is also the moment of peak resentment if you block access.
- **Data capture:** Option 4 gets you an email at Q2 even if the user abandons at Q4. Option 2 gets you nothing if they abandon before the wall.

The real risk with option 4: if "save your progress" after two questions feels premature or spammy, you've burned trust before delivering any value. That's a copy and UX design problem, not an architecture problem.

## 2. EXECUTOR LENS

**What you do Monday morning:** You don't build a wall. You build the onboarding questions flow and the E5 scoring engine. The wall placement is a parameter you set after the flow exists.

**Full implementation sequence:**

1. **Week 1–2:** Build the onboarding questions UI (5 questions, no wall, no auth required). Store answers in localStorage only. Ship it behind a feature flag or `/onboarding` route. This is the E5 cluster engine work that S3 already calls for.
2. **Week 2–3:** Build the scored-cards reveal page. Wire it to the scoring engine. At this point you have a working anonymous funnel: questions → scored cards, all client-side or ephemeral.
3. **Week 3:** Add the soft capture. After Q2 or Q3, show a non-blocking "save your progress" prompt (email field + "continue without saving" link). If they enter an email, create an account (magic link or OAuth), associate answers with it, continue the flow. If they skip, continue anonymously with localStorage.
4. **Week 3 (same week):** At the scored-cards reveal, if still anonymous, show the hard wall (the same wall you have today, reused). This is your fallback — option 2 as the backstop behind option 4.
5. **Week 4:** Ship. Measure three things: (a) soft-capture conversion rate at Q2–3, (b) hard-wall conversion rate at scored cards for users who skipped the soft capture, (c) overall funnel completion rate.

**What breaks down in practice:**

- **The soft capture UX is the entire bet.** "Save your progress" after two questions only works if the questions feel valuable enough that losing them matters. If Q1–2 are lightweight ("what industry?" / "what seniority?"), there's nothing to save. The questions need to feel like work the user doesn't want to redo. This is a product design dependency, not an engineering one.
- **You still need a localStorage fallback** for users who skip both capture points, because the hard wall at scored cards (your backstop) means anonymous users carry state through ~5 questions. But this is dramatically simpler than option 2's full anonymous-session infrastructure: you only need localStorage for the skip-path minority, not as the primary persistence layer for all users.
- **The in-memory session store** is not a blocker for this approach. Authenticated users get a real session. Anonymous skip-path users use localStorage. You don't need server-side anonymous sessions at all.
- **Missing decision:** What happens to the existing S2 wall (post-preview)? If the new onboarding flow replaces the current landing experience, the S2 wall moves or dies. If onboarding is a separate entry point, you have two walls. Decide before building.

## 3. FAILURE MODES

**What makes my answer wrong:**

- **"Save your progress" is just a wall with better copy.** If users perceive it as a gate regardless of framing, the conversion rate matches option 1 (wall before value), and you've gained nothing. This is the most likely failure mode. The counter: "continue without saving" must be a real, visible, zero-friction option — if it's a tiny gray link, you're option 1 in disguise.
- **The sunk-cost hook at Q2 is too weak.** Two answers might not feel like enough investment to trigger loss aversion. If the soft capture gets <5% conversion because users don't care about saving two dropdowns, you're relying entirely on the hard wall at scored cards — which is just option 2 with extra UI built for nothing.
- **I'm wrong about engineering cost.** If S3 independently requires durable anonymous sessions for other reasons (e.g., the E5 engine needs server-side state for scoring), then option 2's merge infrastructure is partially paid for by other work, and the cost delta between options 2 and 4 shrinks.
- **The scored-cards moment really is the conversion peak.** If users who see scored cards convert at 80%+ on a hard wall, option 2 is fine and the soft capture is unnecessary complexity. I'm assuming the hard wall at peak curiosity creates resentment — but it might create urgency instead. You won't know without data.

**What I'm most uncertain about:** Whether a soft capture after 2–3 lightweight questions converts meaningfully better than no capture at all. The entire option 4 thesis depends on this, and there's no existing data to validate it.

## 4. FINAL RECOMMENDATION

**Build option 2 as the architecture, but instrument option 4 as the first touch.**

Concretely: ship the onboarding flow with a non-blocking "save your progress" email capture after Q2–3 (option 4), and a hard wall at scored-cards reveal (option 2) as the backstop for users who skipped. This costs almost nothing extra over option 2 alone — the soft capture is one component and one API call — and it gives you data on both placements in a single release.

Monday morning, build the questions flow with localStorage. The wall placement is literally the last thing you wire up, after the flow works end-to-end. Don't let wall architecture drive the sprint — it's a UI component and a route guard, not a system design choice.

### Evidence Scout (Model B)

## 1. DIRECT ANSWER

Option 2 is not the optimum — it's the familiar shape wearing new clothes. The superior placement is a **hybrid reveal**: let the user complete all 5 questions uninterrupted, show 1–2 real scored cards immediately (no wall), then hard-wall "unlock your full match list." This delivers more demonstrated value before the ask, creates FOMO on known-real results rather than hypothetical ones, and doesn't interrupt the momentum of the question flow. The "save my progress" soft-capture is a nice-to-have for flows longer than ~5 steps, but 5 questions is short enough that mid-flow abandonment is a secondary problem — the engineering cost to prevent it is larger than the conversion it saves.

---

## 2. EVIDENCE SCOUT LENS

**Canonical precedent — Duolingo's signup wall migration.** Duolingo moved their wall from pre-lesson to post-first-lesson-completion. Widely reported outcome: higher completion AND higher signup conversion, because the wall hit at a moment of demonstrated value *and* sunk-cost commitment. The lesson for JobCrush: a hard wall that fires before the user sees any scored output is option 1 in disguise. Option 2 as described fires the wall before the user sees anything — they've answered 5 questions and the payoff is still withheld. That's closer to option 1's psychology than it looks.

**Typeform / quiz-funnel pattern.** "Complete the quiz → see partial results → email gate to get full results" is a documented high-conversion pattern with published case data from quiz-funnel operators (ConvertFlow, Interact, Typeform's own ecosystem). The completion rate of the quiz itself is maximized by not interrupting it. Email capture at the results moment — especially when some value is already visible — consistently outperforms a wall placed at the results threshold with nothing yet revealed.

**Ikea effect + endowment effect (behavioral economics).** Five answered questions create sunk-cost investment. The conversion ask reframed as "don't lose what you've already built" is more compelling than "sign up to see results." This means the framing of the wall matters as much as its placement — "unlock your full match list" (FOMO on visible partial results) outperforms "create an account to see your cards" (unknown reward). The distinction: partial reveal gives the user concrete evidence the cards are real and relevant before the ask; no reveal requires them to take it on faith.

**Blurred/partial reveal patterns.** Evidence is mixed here — blurred content that is clearly decorative or fake registers as a dark pattern and hurts trust. Blurred content that is visibly real (job titles legible, company logos visible, match scores shown) converts well because it proves the product works. The distinction matters: if JobCrush's scored cards show enough above the fold before the blur that the user can tell the system found real matches, the partial reveal works. If the card content is generic or the blur is total, it feels manipulative.

**"Save my progress" mid-flow capture.** Effective for flows ≥10 steps or ≥5 minutes. Documented by onboarding-specialist practitioners (Samuel Hulick / UserOnboard, Intercom's onboarding reports). For a 5-question flow (~2–3 minutes), the mid-flow save nudge is noise — most users won't close mid-flow, and those who do are unlikely to return regardless. The engineering cost (non-blocking modal, email capture, deferred merge) is real; the conversion uplift for a short flow is marginal.

**Claims requiring live validation:**
- Duolingo's specific conversion numbers circulate in different forms; the direction (up) is consistent but the magnitude varies by source.
- Whether job-seekers (high intent, professional context) behave like B2C app users is unverified. High-intent users may tolerate an earlier wall than a casual app — but that's also the argument for option 1, which the broader evidence still argues against.
- Blurred card conversion specifically in a job-matching context: no direct comparable. Closest analogues are dating app card reveals (Hinge blurs extended cards) and salary-benchmark tools (Glassdoor's salary partial reveal is a documented high-converter).

**Engineering reality check.** The hybrid reveal's engineering footprint versus option 2:
- Option 2: generate cards server-side on Q5 submit, return them, show wall before rendering → answers in localStorage → merge on signup. Anonymous server-side state needed only if you want cross-device recovery (localStorage survives tab-close, not device-switch).
- Hybrid: generate cards server-side, return top 2 revealed + rest blurred → wall on "unlock all" → same localStorage/merge path. *Identical* engineering cost for the session/merge path. The only addition is the reveal/blur UI logic, which is client-side CSS + a count parameter from the API.

The hybrid does not add an anonymous server-side session. It does not require cross-device recovery (blurred preview on desktop stays on desktop; user signs up and gets the full list). The scope delta over option 2 is small.

---

## 3. FAILURE MODES

**What would make the direct answer wrong:**

1. **The job-seeker population is unusually high-intent.** If your users are actively job hunting (not casually browsing), they may sign up readily at any friction point, making the placement difference negligible. In that case, option 2's simplicity wins and the partial-reveal add is wasted UI complexity.

2. **The scored cards aren't good enough to survive partial exposure.** If the first two cards shown in the partial reveal are poor matches (cold-start problem before the engine is tuned), the partial reveal *destroys* conversion by proving the product doesn't work yet. Option 2 (wall before cards are shown) protects against a weak v1 engine. This is a real risk for S3 launch where the E5 cluster engine is being built fresh.

3. **The blur is read as a dark pattern by the target demographic.** Professional/educated users (job seekers using a CV-tailoring product) are more likely to recognize and resent manipulative UI patterns. If the blurred cards feel like Glassdoor salary gating (which many users hate), it could hurt brand trust more than it helps conversion. The "save my progress" framing avoids this entirely — it's transparently utilitarian.

4. **5 questions isn't long enough to create meaningful sunk-cost.** If users treat the onboarding quiz as trivially resumable, the sunk-cost argument for mid-flow capture evaporates, and the simpler hard wall at card reveal (option 2) is clean enough.

**Biggest uncertainty:** the quality of v1 scored cards. This is the swing factor. A partial reveal works only if the product works. If S3 launches with a cold-start engine that produces mediocre matches, option 2's "promise without proof" is actually safer than a partial reveal that proves the product isn't ready.

---

## 4. FINAL RECOMMENDATION

**Ship option 2 for S3 launch, design the hybrid as the S3.1 upgrade.**

At S3 launch, the E5 engine is new. You don't yet know if the scored cards are good enough to survive public partial exposure. Option 2 (hard wall at card reveal) is the correct conservative play: it delivers the "reward first, pay to keep" shape without betting that v1 cards are impressive enough to close on first sight.

The explicit upgrade path: once the engine has run on real users and match quality is validated, move to the hybrid reveal — show 2 cards above the wall, blur the rest, reframe the CTA as "unlock your full match list." That single change (a count param from the API + client-side blur) is a one-afternoon diff on top of option 2's architecture, not a rearchitecture.

The "save my progress" mid-flow soft capture: skip it. 5 questions is too short for it to matter, and the in-memory session store constraint makes anonymous server-side state a real cost. localStorage for question answers is sufficient — it covers tab-close, which is the only meaningful abandonment case in a 3-minute flow.

Skipped: progressive soft wall and blurred partial reveal for launch. Add when v1 card quality is empirically validated.

### Expansionist (Model C)

## 1. DIRECT ANSWER

Option 2 is the right *hard-wall* placement, but it is not the whole answer — the fourth option isn't a competitor to option 2, it's a **layer that sits on top of it**. The correct design is: **hard wall at first unlock (option 2's placement) + a soft "save my progress" capture that appears the moment the user has sunk enough effort to feel loss (around Q3–Q4), + a blurred partial reveal of the scored cards at the wall itself.** These are not three options to choose between; they are three instruments playing at different funnel depths.

Here's the reasoning that makes this more than a hedge:

- The scored-cards moment is genuinely the conversion peak — it's the first instant the user sees *their own life* reflected back with specificity. Walling there (option 2) is correct because that's where perceived value is highest and willingness-to-trade-email is highest. Don't move the hard wall earlier.
- But the "engineering trap" (losing 5 answers on a Q4 tab-close) is not a bug to mitigate — it's a **conversion surface you're leaving on the table.** The mid-flow soft capture ("Want us to save your progress? Drop your email") converts a *different* population than the wall does: the hesitant, the interrupted, the mobile-user-who-got-a-phone-call. That population is invisible to option 2 and never reaches the wall.
- The blur/partial-reveal at the wall raises the wall's own conversion by making the reward concrete before payment, rather than promised.

So: option 2's *placement* dominates. Option 4's *mechanism* is additive, not a replacement. The user framed it as a choice; it's a stack.

The one place I'd push back on the user's instinct: treating durable anonymous state as a reluctant cost. It isn't overhead — it's the asset. More on that below.

## 2. EXPANSIONIST LENS

**The systematically underweighted thing: the anonymous answer stream is the product's most valuable dataset, and the current framing treats it as a liability to be cleaned up on signup.**

Look at what's actually happening in the funnel. Every user who answers even Q1 is emitting **labeled preference data** — before they ever pay you an email. In the S2 world there were only two anonymous assets (a CV and a preview), so "keep the merge minimal" was correct. In S3, the anonymous session is no longer two assets — it's a **stream of intent signals** (job preferences, dealbreakers, what made them click a card). That stream has value *whether or not the user ever signs up.*

This reframes the entire question. The council is debating where to place a wall to capture emails. The bigger prize is: **capture the answer stream for 100% of users, and capture emails from the subset you can.** Those are decoupled goals, and durable anonymous sessions serve both at once. The moment you persist anonymous answers server-side (which the soft-capture path requires anyway), you get:

1. **A training corpus for the E5 cluster engine that grows from every visitor, not every signup.** Your scoring model improves fastest from the *widest* funnel, which is the pre-wall anonymous population. This is the flywheel the current framing hides: better anonymous data → better scored cards → higher wall conversion → more accounts → but the data flywheel spun before any of that.
2. **A/B-testable wall placement.** Once anon state is durable, wall placement stops being a one-way architectural decision and becomes a *config value you can move and measure.* You are debating a placement you could instead make dynamic. That's the meta-upside: build the anon-session substrate and you buy the option to answer this question empirically forever, per-cohort.

**The adjacent opportunity nobody mentioned:** durable anonymous sessions + a persisted answer stream is the foundation for **shareable / resumable job cards without an account.** "Here are 8 roles scored for you — resume anytime with this link." That's a growth loop (the link is forwardable, the friend lands mid-funnel with social proof) *and* it's the natural home for the cross-device return case the user already flagged as an edge case. The edge case is a distribution channel wearing a bug costume.

**What success beyond expectations looks like:** you don't ship "a wall in the right place." You ship an **onboarding substrate** where (a) every visitor trains the model, (b) the wall position is a lever not a commitment, (c) partial results are forwardable growth artifacts, and (d) the "save my progress" email becomes the top of a nurture sequence for the 70%+ who won't convert on first session. The wall stops being a gate and becomes a *pricing experiment surface.*

**What it unlocks next:** once anonymous answer streams are durable and clusterable, you have the raw material for the actual defensible product — a live labor-market signal ("roles like yours are getting scored X this week"). That's a data product that JobCrush the personal-pipeline repo can never have, because it only ever sees one user. This is where the hosted product's moat actually is, and it's invisible if you scope anon sessions as "the minimum to avoid answer loss."

## 3. FAILURE MODES

What would make my answer wrong:

- **The in-memory session store is a hard blocker, not a soft one.** My whole thesis leans on durable server-side anonymous state, and `docs/deploy.md` says the store is single-machine and already a scaling constraint. If the team ships the soft-capture/anon-stream *before* moving the store to Postgres/Redis, they'll pin themselves to one machine harder and create a migration mess. My answer is only right if the store move is treated as a **prerequisite**, not concurrent. If it's expensive/slow, my "just build the substrate" enthusiasm is a scope bomb — that's the Contrarian's rightful territory and I'm most uncertain here.
- **Soft capture can cannibalize the hard wall.** If the mid-flow "save your progress" email is too easy, some users give a throwaway email, feel "done," and never convert to a real account at the wall. I'm assuming the two capture points address disjoint populations; if they overlap heavily, the soft capture could *lower* full-account conversion and dilute email quality. This needs measurement, not assertion.
- **Answer-stream value may be lower than I claim.** If the E5 cluster engine turns out to need clean, account-verified, longitudinal data (not noisy one-session anonymous answers), then the anonymous corpus is low-signal and my "widest funnel trains the model" flywheel is weak. I'm betting breadth beats cleanliness for early model training; that's an empirical bet.
- **Complexity tax on a pre-PMF product.** Three capture instruments + anon merge + cross-device resume is a lot of surface for S3. If JobCrush hasn't proven the scored-cards moment converts *at all*, I'm optimizing a funnel that doesn't yet have traffic. The honest sequencing might be: ship option 2 hard-wall + localStorage-only (cheap), measure the Q3–Q4 drop-off, and only build the server-side substrate if the drop-off data justifies it.
- **Privacy/consent.** Persisting an answer stream for non-signed-up users has GDPR/consent implications the council hasn't raised. If "we keep your data before you have an account" creates a consent burden, the anonymous-corpus upside gets legally taxed.

## 4. FINAL RECOMMENDATION

**Keep the hard wall exactly where the user put it (option 2, at first unlock), but stop treating it as the decision — build the durable anonymous answer-stream substrate, and let the wall become a lever on top of it.**

Concretely, in sequence:
1. **Ship option 2 now with localStorage-only** anon persistence (cheap, unblocks the reveal moment, no store change). This validates the scored-cards conversion peak with minimal scope.
2. **Treat the in-memory→Postgres/Redis session move as the gating prerequisite** for everything else — don't build durable anon state on the single-machine store.
3. **Once durable, add the soft "save my progress" capture at Q3–Q4 and the blurred partial reveal at the wall** — as separate instruments targeting separate populations, measured independently.
4. **Instrument the anonymous answer stream as a first-class dataset from day one,** because that stream — not the emails — is the flywheel that makes the scored cards good and is the seed of the labor-market data product only the hosted repo can build.

The user asked "is option 2 the optimum or just familiar?" The real answer: option 2's *placement* is genuinely optimal, but framing this as a placement question is the familiar shape. The upside lives in making placement a measurable lever and in harvesting the answer stream you're currently planning to throw away on abandonment.

### Contrarian (Model D)

## 1. DIRECT ANSWER

Option 2 is directionally right, but I would not ship it as a single hard wall. The stronger version is a fourth option: **progressive ownership capture**.

Flow:

1. Let users answer the first ~5 questions without signup.
2. Auto-save locally from Q1.
3. Add an optional, dismissible mid-flow prompt: “Save this hunt across devices.”
4. Reveal real scored job cards after the questions.
5. Require signup only for durable actions: save, keep, full match rationale, alerts, apply kit, tailored CV.

So: **do not wall before the scored cards, but do not wait until apply intent either.** The signup moment should mean “own this hunt,” not “prove the product works.”

This matches the UX principle behind progressive disclosure: keep the primary task moving and defer secondary requirements until they become relevant. See NN/g on [progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) and form cognitive load, where forms are treated as real mental work: [NN/g forms guidance](https://www.nngroup.com/articles/4-principles-reduce-cognitive-load/).

## 2. CONTRARIAN LENS

The fatal assumption in option 2 is: **“Once users see scored cards, they will feel rewarded enough to tolerate signup.”**

That is only true if the cards are obviously better than LinkedIn/Indeed within seconds. If the first cards feel generic, stale, poorly scored, or explain themselves weakly, the wall turns five questions into a bait-and-switch. The user thinks: “I did the work, and now you are blocking the answer.”

Everyone is underpricing the trust cost of five questions. Five questions is not “light onboarding” if the user is unemployed, anxious, skeptical, or already tired of job platforms. By Q4, they have invested enough to resent loss, but not enough to trust JobCrush.

The other thing being glossed over: option 2 quietly imports a new identity/data model. S2’s merge was simple because there were only two anonymous assets. S3’s onboarding state is richer: answers, inferred preferences, scored jobs, dismissed jobs, maybe clusters. If you make anonymous progress feel meaningful, users will expect it to survive. That expectation creates product debt.

Baymard’s checkout research is ecommerce-specific, but the warning transfers: forced account creation during a goal-directed flow can derail momentum; they recommend deferring account creation until it is naturally useful, not making it an interruption. See [delayed account creation](https://baymard.com/blog/delayed-account-creation).

## 3. FAILURE MODES

Your direct answer would be wrong if the scored cards are spectacular and signup conversion at first unlock is already high. In that case, adding a soft capture step may just create extra surface area.

It would also be wrong if the mid-flow “save progress” prompt behaves like a disguised wall. A modal at Q3 can be worse than a clean wall at Q5. The soft capture must be skippable, secondary, and framed as user benefit.

Partial reveal can fail if it feels manipulative. Blurring the best content is cheap. Showing enough real value, then gating ownership/actions, is much cleaner.

LocalStorage-only can fail if cross-device continuation matters early. But building full durable anonymous sessions before validating the funnel may be premature. The leaner path is: local auto-save for unsigned users, server persistence once they choose “save my hunt.”

The biggest uncertainty is not wall placement. It is whether five questions are too many before the first visible payoff. If the onboarding does not produce micro-rewards along the way, the signup wall discussion is optimizing after the leak.

## 4. FINAL RECOMMENDATION

Ship a **hybrid fourth option**, not pure option 2:

**Anonymous questions → local auto-save → optional “save this hunt” capture mid-flow → real scored card reveal → hard signup only for save/apply/full breakdown/alerts.**

That preserves option 2’s core insight, but removes its brittle all-or-nothing bet. It also avoids overbuilding durable anonymous sessions before you know whether users care enough to save the hunt.

### Fundamentalist (Model E)

## 1. DIRECT ANSWER

Based on the core principles of user acquisition and product design—value proposition first, then frictional barriers—the signup wall should sit at option 2 (immediately after delivering scored job cards). This placement maximizes conversion by aligning with a "reward-first" model where users experience tangible value (~5 questions unlocking relevant jobs) before being asked to commit. It avoids the pitfalls of option 1 (pre-reward, low engagement) and reduces the risk compared to option 3 (post-intent, high friction). A fourth option could be explored for future iterations if engineering constraints allow, but it may not dominate as a solution due to potential deviations from user expectations in gamified flows. The key is to ensure that any wall placement preserves the sense of incremental progress and minimizes answer loss through persistence mechanisms.

## 2. FUNDAMENTALIST LENS

The fundamental first principle here is: users must perceive value before accepting friction, such as a sign-up requirement. This question assumes that gamified flows inherently require immediate monetization points after rewards are delivered, which might not be universally true but aligns with conversion psychology.

Core assumptions baked into the query:
- **Gamification implies a reward structure**: The flow delivers scored job cards post-Q5 questions, so the wall must follow this to capitalize on the payoff.
- **Conversion peak is tied directly to value delivery**: It presumes that users convert when they first see scored jobs because of the effort invested (~5 answers), but this might not capture all user segments—some could be swayed by other incentives or pain points elsewhere.

Stripping away assumptions, the underlying problem isn't just "where to put the wall," but about designing an onboarding flow that minimizes friction at critical engagement moments while ensuring data persistence. The real issue is: how can you deliver a meaningful first-value experience (~5 questions) and then capture user intent (sign-up or apply) with minimal drop-off? This requires understanding user behavior—why do they answer ~5 questions, what keeps them engaged, and where would an interruption feel least jarring.

Rebuilding from ground up:
- The flow should prioritize low-friction value delivery to build trust. For example, in S2, the preview was free because it's a low-risk entry point.
- In S3, scored job cards serve as that initial high-value reward; placing the wall immediately after leverages this for conversion.
- However, we must consider if "unlocking" is the right metaphor—gamification often involves exploration and progress. If users find the reveal too abrupt or not compelling enough, they might abandon despite effort invested.

## 3. FAILURE MODES

This direct answer could be wrong in several scenarios:

- **Conversion rate variability**: Option 2 might work well for engaged users but poorly if the scored job cards aren't universally appealing (e.g., unskilled jobs for a professional user). If the reveal doesn't hit the intended "aha moment" for all, conversion drops.
  
- **Data persistence risks**: The engineering mitigation (localStorage or session storage) is imperfect. Users might forget to return, or technical failures could lead to data loss across devices—especially since S3 involves multiple users and edge cases like returning on different machines.

- **User experience trade-offs**: A hard wall at Q5 might feel abrupt if the flow isn't designed for it; gamification often relies on smooth transitions. If option 2 is implemented as a sudden tab close, it could alienate users who appreciate progressive engagement, potentially reducing completion rates due to frustration rather than conversion gains.

- **Competitive or market context**: The product's value (scored jobs) might be so compelling that delaying the wall reduces its impact; conversely, if scored jobs are seen as a teaser, early capture might not align with user perception. Market factors like job market volatility could influence when users seek sign-ups versus partial reveals.

- **Unmodeled behaviors**: Users might complete ~5 questions but abandon before seeing results due to perceived effort or burnout—this is mitigated by the wall placement, but if not addressed, it leads to wasted data and potential frustration with in-memory session limits. Additionally, option 2 assumes all users will convert at this point; real-world variance exists.

Most uncertain about: The effectiveness of gamification versus friction timing. Gamified flows often rely on surprise or incremental rewards for conversion spikes, but if the reveal isn't personalized enough or feels like a bait-and-switch (e.g., showing jobs then asking to sign up), it could underperform. Also, the engineering cost/benefit trade-off might not be fully captured—persisting mid-flow adds complexity that affects scalability.

## 4. FINAL RECOMMENDATION

Implement option 2 as the primary strategy for the signup wall placement but add a progressive persistence layer using durable anonymous sessions (via localStorage or server-side storage) to reduce answer loss and engineering risks, while testing for user feedback on drop-off points beyond Q5 questions. This ensures value delivery precedes friction with minimal disruption. If data allows, A/B test against a fourth option like partial reveal to see if it improves retention without sacrificing conversion—prioritize simplicity in S2's merge mechanism for now.

---

## Stage 2: Peer Reviews

### Executor's Peer Review

**Q1. Which response most changed how you'd answer the question, and why?**

Model B (Evidence Scout). One specific argument: option 2 as described walls *before* the user sees any scored cards — they've done the work but the payoff is still behind the gate. That reframes option 2 from "reward first, then wall" to "effort first, promise second" — which is psychologically closer to option 1 than it appears. The Duolingo parallel lands: Duolingo walls *after* you complete AND see your score, not after you complete but before you see results. If option 2 means "answer 5 questions → wall → then cards," it's not a reward-first wall at all. It's a toll booth between effort and payoff.

The fix B proposes (show 1–2 real cards, wall the rest) is the smallest move that turns option 2 into an actual reward-first wall. And the engineering delta is genuinely small — it's a count parameter and CSS, not a new session model.

Every other response either endorsed option 2's placement without interrogating whether the user actually *sees* cards before the wall (Model E), or proposed layered systems that are correct but heavier (Models C and D). B caught the thing that makes option 2 subtly mislabeled.

**Q2. Which response has the biggest blind spot, and what is it?**

Model C (Expansionist). The blind spot is scope discipline relative to product stage. C builds a compelling vision — anonymous answer streams as a training corpus, shareable resumable links as a growth loop, wall placement as a dynamic config value — but treats a pre-PMF S3 launch as a platform architecture moment. Every "unlock" C describes depends on (a) moving the session store to Postgres/Redis first, (b) building a durable anonymous data pipeline, (c) consent/GDPR infrastructure for pre-account data. C *acknowledges* these as risks in section 3, but then recommends building the substrate anyway as step 4.

The concrete gap: C never prices the opportunity cost. Every week spent building the anonymous-answer-stream substrate is a week not spent validating whether the scored cards convert at all. If the cards don't convert, the substrate is waste. C's own failure mode #4 says this plainly ("optimizing a funnel that doesn't yet have traffic"), but the final recommendation doesn't reflect it — it still says "instrument the anonymous answer stream as a first-class dataset from day one." That's the Expansionist role pulling C past its own best judgment.

**Q3. What did ALL responses miss?**

None of the four addressed the **quality of the 5 questions themselves as the primary conversion lever**, independent of wall placement.

Every response treats the questions as a fixed input ("user answers ~5 questions") and debates what happens after. But the questions *are* the onboarding experience. If Q1–Q5 feel like a form, users drop at Q2 regardless of wall placement. If each question delivers a micro-signal that something is happening (e.g., "Based on that, we're already filtering 2,400 roles down to ~80"), the user arrives at the wall with momentum and trust — and wall placement becomes less fragile.

This matters practically: the difference between a 40% and 70% Q5-completion rate dwarfs any conversion delta from wall placement variants. If the council is debating where to put the wall but the real drop-off is at Q3 because the questions feel extractive rather than generative, every option loses. The cheapest, highest-leverage intervention might be making each question visibly advance the user's state — a progress bar is the minimum; a live-updating match count is better — before touching the wall at all.

This is the thing that would change the recommendation: validate Q1–Q5 completion rate first, because no wall placement saves a funnel where most users never reach the wall.

### Evidence Scout's Peer Review

**Q1. Which response most changed how you'd answer the question?**

**Executor (A)**, specifically this argument: if the soft capture lands at Q2–3, answers 3–5 are written against a real authenticated user. The anon merge problem simply doesn't exist for the majority path. This is not a UX point — it's an engineering complexity point, and it's the sharpest one in the council. The user framed option 4 as a competitor to option 2; Executor correctly reframes it as a backstop architecture where option 4 *eliminates* the hard part of option 2 (durable anon state + merge path) rather than duplicating it.

The Expansionist (C) gets credit for the reframe that anonymous answer streams are a product asset rather than a liability, and for naming that wall placement could become a config lever once durable state exists. That's genuinely useful. But it's a strategic observation, not an actionable forcing function.

---

**Q2. Biggest blind spot?**

**Expansionist (C)**, specifically on the GDPR/consent issue it raises and then buries. If you're persisting answer streams for non-signedup EU users — employment-adjacent preference data — you likely have a legitimate consent problem before any account exists. The Expansionist mentions it in failure modes, then continues building the entire "anonymous corpus as flywheel" thesis as if this is minor. For a product handling job-seeker data, this is a real legal constraint that could require the anonymous persistence to be opt-in anyway, which substantially collapses the distinction between option 2 and option 4.

The secondary blind spot in the same response: the flywheel thesis only works at scale. A handful of early users answering 5 questions produces a noisy, tiny dataset. At S3 stage (pre-PMF, pre-traffic), the "anonymous answers train the E5 engine" argument is premature optimization wearing a strategic moat costume.

---

**Q3. What did ALL responses miss?**

Two things, neither mentioned anywhere:

**1. Card quality is the bottleneck, not wall placement.** Every response assumes the scored cards will create a conversion moment strong enough to justify the wall design. None ask: what does "demonstrably better than LinkedIn in 10 seconds" require from the scoring engine, and does the E5 cluster engine as currently specced actually produce that? If the first cohort of scored cards is mediocre — generic matches, poor explanations, undifferentiated results — no wall placement saves you, and the entire funnel debate is a second-order problem. The council should have demanded a threshold for card quality before engaging with placement at all.

**2. Transactional recovery email as a cheaper alternative to durable anon sessions.** The product already has a live magic-link email system and a real sender (`jobcrush.org`). A tab-close at Q4 doesn't have to mean lost progress if you've captured an email earlier (option 4) — but even without that, a "come back to your scored cards" triggered email when an anonymous session goes idle is a recovery path that costs almost nothing (one Fastify hook + one email template) and sidesteps the entire cross-device/localStorage/anon-merge engineering discussion. None of the four responses considered the recovery-email path as an alternative to, or complement of, durable anonymous state. Given the existing email infrastructure, this omission is material.

### Expansionist's Peer Review

## Q1. Which response most changed how I'd answer, and why?

**Model B (Evidence Scout)** — specifically its reframe that the decision hinges on **v1 scored-card quality (cold-start), not wall psychology.**

Before reading the responses, I was treating this as a placement optimization: pick the spot where the conversion curve peaks. B's argument dissolves that framing. If the E5 engine is freshly built for S3, you *cannot know* whether a partial reveal helps or hurts, because a partial reveal only converts when the visible cards are demonstrably good. A hard wall (option 2) is the correct conservative play precisely because it makes a "promise without proof" — which is safer than proving your engine is mediocre. That converts the either/or into a **sequenced decision gated on a measurable variable**: ship option 2 at launch, upgrade to the hybrid partial-reveal once match quality is empirically validated (a one-afternoon diff, since the session/merge path is identical). That's the most decision-useful update because it tells you what to build *now* and what to defer without guessing.

A close second was **Model A's engineering inversion**: capturing an account early means later answers are written against a real user, so the anonymous-session/merge infrastructure — the thing everyone calls "non-trivial scope" — simply never has to exist. That genuinely lowered my estimate of the fourth option's cost. But it has a tension A underweights (see Q2), so it updated me less than B.

Model E did not change my thinking at all — it restates option 2 with hedges and never actually adjudicates whether the fourth option dominates.

## Q2. Which response has the biggest blind spot?

**Model A (Executor).** Its blind spot is that its headline recommendation — soft capture at **Q2–3**, hard wall at Q5 as backstop — **reintroduces the exact "wall before value" failure the whole premise warns against.** At Q2 the user has answered two dropdowns and seen *zero* scored cards. Asking for an email there is structurally option 1 (capture before payoff), just dressed as "save your progress." A's own Failure Mode #1 half-admits this ("just a wall with better copy… conversion matches option 1"), but the final recommendation still *leads* with the Q2 capture without reconciling that contradiction.

Two compounding gaps A misses: (1) running **both** a soft prompt at Q2 and a hard wall at Q5 means most users get asked twice — double-prompt fatigue is a real conversion cost A dismisses as "one component and one API call"; and (2) A asserts the sunk-cost hook works at Q2 while simultaneously admitting two answers may be too weak to trigger loss aversion. Those can't both anchor the recommendation. The materiality: A is the most operationally influential response ("build it Monday"), so a builder following it ships the friction-before-value pattern the council explicitly set out to avoid.

(Model E is the weakest response overall, but its weakness is low-signal vagueness rather than a single concrete missing consideration — it never engages the anonymous-session engineering crux that differentiates the options at all.)

## Q3. What did ALL four responses miss?

Two things, both capable of shifting the recommendation:

**1. Email captured early is a re-engagement asset, not just an in-session conversion lever.** Every response scored the placements purely on *within-funnel* conversion. None valued the fact that an email captured mid-flow gives you a **remarketing channel** — you can email a Q3 abandoner "your hunt is waiting" and recover them days later. This is decisive because it breaks the symmetry the whole debate assumes: earlier capture can win *even if in-session conversion is flat or slightly lower*, because a captured-but-abandoned user is recoverable while an anonymous-but-abandoned user is gone forever. The verified `jobcrush.org` sender already exists, so the channel is nearly free. This materially strengthens the earlier-capture options and none of the four priced it.

**2. "Instrument it and measure" is not actually available yet — and scoring anonymous users has a cost/abuse tail.** Models A, B, and E all fall back on "ship it and A/B test the placement." But this is an early-stage product on a **single in-memory-session machine**; traffic almost certainly can't reach statistical significance on a conversion delta for months. So the decision must be made on priors, not data — which makes B's "conservative default + gated upgrade" logic even more correct, and makes A's "test both in one release" partly illusory. Relatedly, revealing scored cards *before* any capture means spending E5 inference on unauthenticated (possibly bot/scraper) traffic with nothing captured in return — a compute-cost and abuse vector that argues for at least a lightweight gate or rate-limit before the expensive scoring step. No response weighed the cost of running the engine for anonymous users.

A third, smaller omission worth flagging: none interrogated **where the CV upload now sits** relative to the 5 questions. The CV is by far the largest sunk-cost asset a user contributes; if it's still collected first, the sunk-cost math driving the entire wall-placement argument is dominated by the CV, not the five answers — which would change every response's reasoning.

### Contrarian's Peer Review

**Q1. Most changed my view**

Evidence Scout changed my answer most.

The useful update was the distinction between “wall at scored-card threshold” and “wall after proof.” If users answer 5 questions and then hit a signup wall before seeing any concrete card, option 2 is psychologically closer to option 1 than it admits. The better version is: finish questions uninterrupted, show at least 1-2 real scored cards or a real top-card summary, then gate saving/applying/full list.

That makes the recommendation sharper: option 2 is good only if the first unlock actually unlocks visible value. Otherwise the “reward first” framing is fake.

**Q2. Biggest blind spot**

Fundamentalist has the biggest blind spot: it collapses the hard part into a principle.

It says “value first, then friction,” but does not resolve what counts as value: promised scored cards, partially visible cards, fully visible cards, or actionable apply/save features. That distinction materially changes the wall placement. It also recommends durable anonymous persistence while underweighting that this repo’s S2 merge was intentionally minimal and the current in-memory session store makes S3 anonymous state a real scope increase.

The role constraint also shows: it applies the right generic principle, but not enough pressure to the product and engineering specifics.

**Q3. What all responses missed**

All four treat “signup wall” as if it were one atomic event. In this product, it is not.

The current auth is magic-link + Google OAuth. A magic-link signup introduces a context switch: leave page, open email, maybe open on another device, return via link, recover exact onboarding/result state. That mechanics can dominate the wall decision. A “soft email capture,” an unverified lead, a verified magic-link account, and Google OAuth account creation are four different products with different friction, merge semantics, consent, and recovery behavior.

So the missing decision is: what identity commitment is actually required at each point?

My resulting recommendation would be:

Ship the S3 first version as uninterrupted questions → visible proof card(s) → hard gate for save/apply/full list. Use localStorage for tab-close recovery. Do not build durable anonymous server state yet unless instrumentation shows Q3-Q4 abandonment is large enough to justify it. Add a mid-flow soft capture only if it is truly non-blocking and does not require a magic-link roundtrip before the user sees value.

### Fundamentalist's Peer Review

Okay, let's analyze these two distinct perspectives on the core question.

## Q1: Which response most changed how you'd answer the question, and why?

The **Model D (Contrarian) response** significantly shifted my perspective closest to its own conclusion – delaying the hard signup wall ("option 2") until *after* showing scored cards. However, it arrived at this slightly different way than Model B.

Specifically, while Model B strongly advocates for option 2 and frames the "soft capture" as a necessary precursor (building the substrate first), **Model D's core change lies in moving beyond simple delay to a layered approach of progressive ownership**. It doesn't just say *when* to wall but proposes capturing value progressively from the start, storing it locally initially, and then transitioning users to server-side storage only when they actively choose an "ownership" action *after* seeing the scored cards.

This change is crucial because:
1.  **It addresses user anxiety earlier:** The optional mid-flow prompt ("Save this hunt") gives users a safety net much sooner without demanding commitment upfront.
2.  **It treats signup as control, not validation:** The hard wall appears only for actions that necessitate persistent identity (owning the saved data), aligning better with the principle of delaying friction-inducing requirements until they are perceived as necessary or beneficial.

Model B convinced me *the specific sequence* proposed in option 2 is viable and potentially powerful if built carefully, while Model D reframed the entire value proposition around user trust and progressive commitment, offering a different but equally compelling justification for delaying the wall (or integrating it differently). Both challenged the initial assumption that waiting until Q5 was inherently risky without building the substrate.

## Q2: Which response has the biggest blind spot, and what is it?

**Model B's ("Soft Capture") Response:** The biggest blind spot here is **underestimating or not fully articulating the *uniqueness* of the value proposition offered by a durable server-side anonymous answer stream.**

While Model B correctly identifies that building this substrate first is essential to unlock certain host-specific data products (like labor-market signals), it frames its own recommendation slightly differently: delaying the wall while implicitly depending on eventually building the full server infrastructure *for everyone*.

The blind spot is in assuming **that simply capturing anonymous answers and storing them, even if built robustly later, will inherently solve the "identity hidden" problem for JobCrush versus a personal-pipeline model.** It doesn't deeply explore or validate whether users *will* value this specific labor-market signal (based on their own answering patterns) enough to justify the effort of signing up specifically *for that feature*. The assumption is: "We build it, then you'll sign up." Measurement might be needed later to confirm user interest in *exploiting* that data product.

**Model D's ("Progressive Ownership") Response:** Its biggest blind spot seems **not fully acknowledging or quantifying the potential complexity and scope of building a robust server-side state solution from scratch.**

It proposes delaying the hard signup wall until after users see scored cards, but relies heavily on this *later* signup for crucial functionalities like cross-device continuation and data durability needed to train the model effectively (claiming it's "the raw material" even if not yet fully leveraged). It doesn't explicitly address how difficult or resource-intensive building that server infrastructure might be compared to other approaches, especially when starting with a minimal viable product focused on user experience. The recommendation implicitly assumes this robust backend is necessary *but* perhaps achievable without the initial scope being as large as Model B's substrate build.

## Q3: What did ALL responses miss that the council should consider?

All four models (JobCrush Pipeline, Anonymous Stream, Progressive Ownership) primarily focus on **the user experience of conversion and data retention**. They offer variations in *how* or *when* to ask for signup but don't sufficiently explore a key strategic difference:

They missed considering that **delaying the forced identity commitment (being part of the JobCrush hosted product) is not just about reducing friction; it fundamentally alters the relationship between the user and the platform, impacting potential future data collection strategies.**

Specifically:
*   **Model B implicitly relies on eventual full server storage for its core "substrate" purpose.**
*   **Model D explicitly requires a hard signup *afterwards* to enable ownership features like cross-device continuation.**
*   **Option 2 (the original prompt) delays the wall based on perceived value, but doesn't inherently change the underlying data model's trajectory beyond individual user sessions.**

The council should consider that delaying identity commitment might be necessary for immediate conversion rates, but it also means users haven't yet been convinced to *trust* and commit long-term to a specific hosted product experience (JobCrush). This delay could potentially hinder the collection of longitudinal cluster data needed to build robust labor-market signals if users abandon their saved hunts before investing significantly. Furthermore, focusing solely on delaying signup might not fully address how different identity commitments fundamentally change what kind of data can be collected and its potential value long-term.

*(Note: In my previous analysis, I concluded that Model B (Anonymous Stream) actually had the most significant blind spot regarding this strategic uniqueness. This conclusion remains unchanged based on further reflection.)*

**Anonymization mapping:**
- Model A = Executor (Claude (claude-opus-4-6) [high])
- Model B = Evidence Scout (Claude (claude-sonnet-4-6) [medium])
- Model C = Expansionist (Codex (fugu profile))
- Model D = Contrarian (Codex (gpt-5.5))
- Model E = Fundamentalist (Ollama)

---

## Stage 3: Chairman's Synthesis

# Chairman's Synthesis

**Before anything else — three corrections from the repo.** The council reasoned off premises in the brief that the code contradicts. These change the answer, so they go first.

| Premise in the brief | What the repo actually says |
|---|---|
| "In-memory session store is a scaling constraint; durable anonymous sessions are a meaningful scope increase" | **Stale.** `apps/api/src/sessions.ts:155` — sessions run on Postgres whenever `DATABASE_URL` is set, and the file is literally titled *"JC-10 anonymous device sessions"*. The one-machine limit in `docs/deploy.md:3` comes from the **job and upload** stores (`jobs.ts:29`, `uploads.ts:22`), which are still `Map`s. Anonymous session state is already durable and already multi-machine-safe. |
| "The anon→account merge would be new work" | Already built: `setClaimedByUserId`, one ownership update (roadmap:164). Adding answers to an anon session is a field on a record that already merges. |
| "Option 1 = zero prior value delivered" | Only true if the gamified flow *replaces* the CV-upload front door. Today the user uploads a CV and gets a free tailored preview **before** any wall, and the ~5 questions (deck/grill) already live **behind** it. |

Three of five members priced their recommendation on engineering cost that doesn't exist. That collapses the loudest argument for localStorage-only.

*Jargon, for anyone without context: "the wall" = the screen that blocks progress until you make an account. "Conversion" = share of visitors who do. "Anon merge" = attaching work done before signup to the new account. "Magic link" = passwordless email login. "E5" = the engine that scores job ads against a user. "The grill" = follow-up questions that confirm facts mined from the CV.*

---

## WHERE THE COUNCIL AGREES

**1. Option 2 as literally written is mislabeled — and that's the council's strongest finding.** Evidence Scout spotted it; **Executor, Contrarian, and Expansionist all independently named it the response that most changed their answer.** Four of five converged. The point: "answer 5 questions → wall → *then* cards" delivers no reward before the ask. The user did the work and the payoff is still behind glass. That is option 1's psychology wearing option 2's clothes. The fix is small — let the questions run uninterrupted, show *real* cards, then gate the **actions** (save, apply, full list, alerts). Signup should mean "own this hunt," not "prove the product works."

**2. Card quality is the actual bottleneck.** Evidence Scout, Contrarian, Expansionist, and Executor all land here. If the first cards aren't visibly better than a LinkedIn search within ten seconds, no wall placement saves the funnel. Contrarian named it the fatal flaw; Expansionist said it dissolved its own framing.

**3. Don't build the anonymous-data platform now.** Four of five reject Expansionist's substrate-first plan for a pre-PMF slice. Expansionist conceded it in its own failure mode #4. *(Note: with the store correction above, the cheap 80% of that substrate already exists — so this consensus survives on scope grounds, not cost grounds.)*

**4. The mid-flow "save your progress" prompt is not clearly worth it.** Evidence Scout (5 questions is too short for it to matter), Contrarian ("a modal at Q3 can be worse than a clean wall at Q5"), and Expansionist (double-prompt fatigue) all push back. Executor proposed it *and* admitted the sunk-cost hook at Q2 may be too weak to fire.

---

## WHERE THE COUNCIL CLASHES

**Clash 1 — Blur the cards, or show them?**
Evidence Scout wants 1–2 real cards visible + the rest blurred. Contrarian argues blurring the best content is manipulative and that showing real value then gating *ownership* is cleaner.
**Contrarian is stronger.** Evidence Scout's own caveat undercuts the blur: it converts only when the visible portion proves the engine works, and this audience — professionals who've already handed over a CV — reads gating patterns fluently. Show three cards fully. Gate save/apply/the-rest.

**Clash 2 — Soft capture at Q2–3?**
Executor leads with it; Expansionist's review lands the decisive counter: at Q2 the user has answered two dropdowns and seen zero cards, so an email ask there *is* friction-before-value, dressed as help.
**Skip it for v1.** Executor's best argument — capture early and answers 3–5 belong to a real user, no merge needed — was the sharpest engineering point in the council, and it's now void: the merge is already built and the anon session is already durable. The problem it solved doesn't exist.

**Clash 3 — "Ship both and A/B test it."**
Executor, Evidence Scout, and Fundamentalist all fall back on measurement. Expansionist's review kills it: staging traffic on one machine will not reach significance on a conversion delta for months. **Decide on priors. Instrument for later.**

**Clash 4 — localStorage vs. server-side answer state.**
Three members chose localStorage on cost grounds. **That reasoning is now void** (correction #1). Server-side is roughly the same effort, survives device-switch, and — critically — is the only version that tells you *where people quit*. Anonymous abandonment data is the entire input to the Grill A question already queued for `/wayfinder` (roadmap:143). localStorage tells you nothing.

**A weighting note.** The Fundamentalist seat added no signal — Contrarian's review correctly called it "a principle where the hard part was" — and its peer review misattributes positions to models that didn't hold them, inventing labels like "Model B (Anonymous Stream)" for what was Model C's thesis. Its endorsement of option 2 should not be counted as independent support. Real tally on option 2's *placement*: one clean endorsement, one conditional, two modifications.

---

## BLIND SPOTS THE COUNCIL CAUGHT

- **The wall is not one event (Contrarian).** A magic-link signup is a context switch — leave the page, open email, possibly on another device, come back, restore state. This repo has *already been burned by exactly that*: "magic-link cross-browser session carry (P0)" was a bug fix in S2.5 (roadmap:69). Firing a magic link at the moment of peak curiosity is the known-fragile path. **Google OAuth is one click, in-page, live, and verified.** Lead with it; magic-link second.
- **Recovery email (Evidence Scout).** A verified `jobcrush.org` sender already exists. "Your scored cards are waiting" to an idle abandoner is one hook plus one template. Only works if you hold an email — which the CV-first door already gives you.
- **Question quality dominates wall placement (Executor).** The gap between 40% and 70% completion of Q1–Q5 dwarfs any placement delta. If each question visibly moves the user's state ("2,400 roles → 80"), the wall stops being load-bearing. This is the same question as Grill A.
- **Anonymous scoring has a unit cost (Expansionist).** E5 is "one cheap LLM call per job ad, with cost tracked per job" (roadmap:51). Cards before any capture means paying for scrapers. Cap it; the rate limiter exists (`sessions.ts:161`).
- **The unanswered question that outranks the one asked (Executor, Expansionist).** Where does the CV upload sit relative to the five questions? If it stays first, the user's biggest sunk cost is spent before Q1, the free preview already delivered value, the wall is already placed and working, and this debate is about a *second* wall. If the gamified flow becomes the new front door, the S2 wall dies. **Nobody has decided this, and it changes every answer above.**

---

## THE RECOMMENDATION

**Option 2's position, not option 2's shape.** Run all ~5 questions uninterrupted. Then show **three real, fully visible scored cards**. Put the hard signup on the *actions* — save, apply, see the rest, get alerts. Lead that wall with Google OAuth.

Four amendments the council's premises hid:

1. **Persist answers on the existing anonymous session** (Postgres, `claimedByUserId` merge) — not localStorage. It's already built, it survives device-switch, and it's the only way you learn where people quit.
2. **No mid-flow soft capture in v1.** Add it only if abandonment data justifies it.
3. **Cap anonymous scoring** behind the existing rate limiter.
4. **Settle the front door first.** One wall or two — decide before writing code.

**Confidence: moderately high** on the shape (show real cards, gate the actions) — that's the one point four of five reviewers converged on from different directions. **Low** on the number five; that's Grill A's question, not this one.

**The single condition that reverses this:** if the v1 cards aren't obviously better than a LinkedIn search within ten seconds, revert to walling *before* the reveal. A promise beats disappointing proof. Evidence Scout argued it, Contrarian called it the fatal flaw, Expansionist said it changed its answer most.

---

## THE ONE THING TO DO FIRST

**Score 20 real job ads against 3 real CVs using the `tailoring-reasoning.md` §4 family-floor prototype, print the top 3 cards for each, and look at them.**

Half a day, offline, no product code. It decides everything above: good cards → ship the recommendation; mediocre cards → wall before the reveal and the whole placement debate is premature. It is also the input Grill A needs next session anyway.

Do not touch wall code until those 9 cards are on a screen.

---

## Council Composition

- Model A (Executor) → Claude (claude-opus-4-6) [high]
- Model B (Evidence Scout) → Claude (claude-sonnet-4-6) [medium]
- Model C (Expansionist) → Codex (fugu profile)
- Model D (Contrarian) → Codex (gpt-5.5)
- Model E (Fundamentalist) → Ollama
- Chairman → claude-opus-4-8 [max] (Claude Code CLI)