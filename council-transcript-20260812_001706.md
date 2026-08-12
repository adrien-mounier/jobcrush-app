# Council Transcript

**Session:** 2026-08-12 00:17:06  
**Question:** For maximum CODE QUALITY and end-product quality (token cost is explicitly irrelevant), which setup is better: (A) an orchestrator agent on a top-tier model (Claude Fable 5) that dispatches work to a team of sub-agents on a mid-tier model (Claude Sonnet) with specialized roles - backend dev, frontend dev, designer, and a QA tester giving an independent GO/NO-GO with browser-driven evidence - versus (B) a single agent on the same top-tier model (Fable 5) doing everything itself: design, implementation, tests, and self-review before commit? Real context: the owner has run about 100 sessions of setup A on this TypeScript monorepo (jobcrush-app): TDD at pinned seams, two-axis code review, QA evidence screenshots, tracker-driven tickets. Its lessons.md shows the process catches real issues (the QA gate, vertical-slicing discipline) but also records process failures (skipped lifecycle steps, hand-slicing drift, an hour spent defending wrong slicing). Sub-questions the council must answer: (1) Does putting the top-tier model in the orchestrator seat while mid-tier models write the code produce significantly WORSE code than the top-tier model writing the code directly, and is the independent QA gate worth that trade? (2) Which failure modes dominate each setup? (3) What hybrid concretely maximizes quality - e.g. top-tier model both orchestrating AND implementing, with sub-agents kept only for independent QA/review?

---

## Framed Question

## CORE QUESTION

Which agent architecture maximizes end-product code quality for a TypeScript monorepo: (A) a top-tier orchestrator (Fable 5) dispatching implementation to mid-tier sub-agents (Sonnet) with specialized roles and an independent QA gate, or (B) a single top-tier model (Fable 5) doing all work — design, implementation, review, and self-verification — in one context? And specifically: does the model-tier downgrade for implementers cost more than the independent review gate gains?

## USER CONTEXT

- Token cost is explicitly irrelevant; only output quality matters.
- The owner has ~100 sessions of real production data on setup A running on this exact repo: TDD at pinned seams, two-axis code review (standards + correctness axes), QA agent with browser-driven evidence screenshots, GitHub issue tracker driving the work.
- `lessons.md` records that the QA gate and vertical-slicing discipline have caught real issues in production sessions.
- `lessons.md` also records process failures specific to setup A: skipped lifecycle steps, hand-slicing drift, and an hour lost defending incorrect slicing decisions.
- Three concrete sub-questions: (1) Does Sonnet writing the code while Fable orchestrates produce meaningfully worse code than Fable writing it directly? (2) What are the dominant failure modes of each setup? (3) What hybrid concretely maximizes quality — e.g. Fable both orchestrates and implements, Sonnet kept only for independent QA/review?

## WORKSPACE CONTEXT

- **Stack:** Fastify API + Next.js web, TypeScript monorepo managed with Turborepo, Vitest for tests.
- **Coding discipline:** "simplest thing that works, surgical diffs, no speculative abstractions" — explicit in `CLAUDE.md`. The ratchet rule on `routes/onboarding.ts` is a representative example of enforced constraints.
- **Current process (setup A) includes:** designer agent → backend dev agent → frontend dev agent → two-axis code review (standards + correctness) → QA agent with browser-driven Playwright evidence and GO/NO-GO verdict, all driven by GitHub issue tickets.
- **Known process failure modes from `lessons.md`:** lifecycle steps get skipped when orchestration is backgrounded, ticket slicing drifts from vertical to horizontal without the owner noticing, the orchestrator can spend significant time defending a wrong architectural call before correcting.
- **Domain complexity:** CV-reasoning rules in `docs/cv-brain/` must be kept consistent with prompts and schema — a failure mode where a capable implementer drifts from the documented rules without a reviewer catching it is plausible.
- **ADR discipline:** decisions in `docs/adr/` are the normative home; code must stay true to them. This creates a correctness-audit dimension that is nontrivial and benefits from a reviewer who read the ADRs independently.

## WHAT'S AT STAKE

- **If Sonnet-as-implementer is the binding constraint:** setup A's independence benefit is real but the ceiling is capped at Sonnet's implementation quality — bugs, misread specs, subtle schema violations that a Fable-as-implementer session would have avoided. The QA gate catches user-visible failures but not structural misalignments with the ADRs.
- **If independent review is the binding constraint:** a single Fable agent self-reviewing has a known blind spot — it confirms its own decisions rather than stress-testing them. The 100-session track record on setup A has already surfaced that the QA gate catches things the implementer missed; collapsing that into one context eliminates that signal.
- **If orchestration overhead is the binding constraint:** the documented hour lost to wrong slicing represents a class of failure that only exists in setup A — the orchestrator making and defending a bad architectural call before the owner can intervene. A single-agent setup has no orchestration layer to go wrong, but also has no independent party to catch what the single agent missed.
- **The hybrid question is the practical decision:** if Fable can orchestrate and implement simultaneously while Sonnet agents handle only independent QA/review, the question is whether that eliminates the model-tier gap without reintroducing the single-context blind spot.

---

## Stage 1: Advisor Responses

### Executor (Model A)

## 1. DIRECT ANSWER

The hybrid is the right architecture — Fable orchestrates and implements, Sonnet handles independent QA and review — but the framing mislocates the real trade, and the hybrid has one unverified assumption that needs to be tested before you commit.

The framing presents a trade: better implementation (Fable writes) vs. weaker review (Sonnet reviews Fable). That trade exists, but it's mis-calibrated because **the QA gate's value is tier-independent.** The 100-session data shows the QA gate catches things — but what it catches is browser-driven behavioral evidence: "did the onboarding flow actually complete?" That's diligence work, not capability work. Sonnet running Playwright against Fable-written code catches the same behavioral failures it catches against Sonnet-written code. The model tier of the implementer doesn't change what the QA gate can see.

The two-axis code review is where the tier question actually bites — and here's the part the framing doesn't resolve: **in setup A, who is doing the two-axis review?** If Fable reviewed Sonnet's code, that's a higher-tier reviewer catching a lower-tier implementer's mistakes — a strong pattern, and the hybrid downgrades it (Sonnet reviewing Fable). If Sonnet reviewed Sonnet's code in setup A, the hybrid is review-neutral and only implementation improves. Your process description doesn't specify. This is a critical unknown in your own documentation and it changes the analysis materially.

Setting that aside, the deeper question is: **what class of failure is actually binding in this repo?**

The documented failures in `lessons.md` are diligence failures: "lifecycle steps get skipped," "ticket slicing drifts from vertical to horizontal," "an hour lost defending incorrect slicing decisions." These are process and attention failures, not capability failures. Sonnet reviewing Fable's code can catch diligence failures — missed ADR references, skipped lifecycle steps, schema field omissions — because those are checklist-shaped. What Sonnet-as-reviewer cannot catch is **capability-level drift**: a wrong abstraction, conflated concerns, a subtle architectural misalignment with the cv-brain rules that requires Fable-tier reasoning to even see.

My honest read of your evidence: the binding failures are diligence-class. I don't see evidence in your 100 sessions that the review axis was catching capability-level issues that a Fable-as-implementer session would have avoided in the first place. So the hybrid should win — Fable writes better code, Sonnet catches diligence slips, the capability tier is covered by Fable being the implementer. **But this is a read of absence-of-evidence, and absence-of-evidence is exactly the kind of plausible-sounding argument that an Executor should refuse to act on without one decisive test.**

## 2. EXECUTOR LENS

**Concrete first step (Monday morning, first 90 minutes):**

Before running anything, resolve the unknown: open your last 10 setup A sessions and check who performed the two-axis review. If it was Fable, the hybrid is a review-tier downgrade and the experiment below is testing whether that downgrade costs you. If it was Sonnet, the hybrid is review-neutral on review and strictly better on implementation — the decision is nearly made and the experiment is confirmation.

Then: find one ticket in your 100-session corpus where setup A's review or QA caught a real issue — not a typo, an actual catch that mattered. Re-run that exact ticket under the hybrid: Fable implements end-to-end, Sonnet does two-axis review and QA gate with Playwright evidence. One ticket, one session.

The decisive question: **does the catch still happen, and is it the same class of catch?**

- If Sonnet catches the same issue → the catch was diligence-tier, the hybrid retains it, green light to broaden the test.
- If Sonnet misses it → the catch was capability-tier, the hybrid loses it, setup A stays.

**Full implementation sequence:**

1. **Day 1 morning:** Resolve the review-tier question from session logs. Run the crux experiment — one ticket, hybrid architecture.
2. **Day 1 afternoon:** Classify the catch (or miss). If the catch survived, proceed. If it didn't, stop — setup A is your architecture and the rest of this sequence is moot.
3. **Day 2-3:** Run 3 more tickets under the hybrid. One must be a cv-brain/schema consistency ticket — that's the domain-complexity axis where capability-level drift is most plausible and where Sonnet-as-reviewer is weakest. If you only test clean backend routes, you'll get a false green. The cv-brain ticket is non-optional.
4. **Day 4:** If all 4 pass, switch the default process to hybrid. Keep setup A's process structures (TDD seams, two-axis review definitions, QA gate, ticket-driven work) — only swap who writes code. Do not redesign the process; only swap the implementer tier.
5. **Day 5+:** First week on hybrid, log every catch and miss to a new `lessons.md` section. For each: who caught it, what tier was the catch (diligence vs. capability), would setup A have caught it too? This is your ongoing audit.

**Where this breaks down in practice:**

- **"Fable orchestrates and implements" is two jobs in one context with no defined boundary.** Setup A's orchestrator failed by spending an hour defending a wrong slice. In the hybrid, Fable is the architect who slices *and* the implementer who writes — there's no separate party to catch a bad slice before code is written. The owner becomes the only check on architectural decisions. The argument that Fable-as-implementer won't drift from its own slice the way Sonnet drifts from Fable's slice is plausible but unverified. This is a real regression in the catch surface and you should name it.
- **The tooling shape of "Fable implements" is unspecified.** Is Fable running in one long context doing design → backend → frontend → self-review → handoff to Sonnet QA? Or multiple Fable sessions with handoffs? Context-window and session-boundary design affects whether Fable actually holds the ADR/cv-brain consistency you're counting on. This is a missing implementation decision, not a detail.
- **Four tickets is thin.** The crux experiment gives you one decisive data point on the review-tier question. Three more gives you four total. That's enough to commit directionally but not enough to catch low-frequency failure modes. The ongoing `lessons.md` audit in step 5 is the real safety net — without it, you're flying blind after the switch.

**Missing decisions and dependencies:**

- The review-tier question in setup A (Fable or Sonnet doing two-axis review) — knowable from your own session logs, currently unspecified, changes the entire analysis.
- No definition of "caught" for the experiment. "The QA gate caught something" is loose. You need to classify each historical catch as diligence or capability *before* running the experiment, so that Sonnet catching or missing it in the hybrid is interpretable.
- No fallback criterion. If the hybrid catches 3 of 4, is that good enough? Define the threshold before you run, not after.

## 3. FAILURE MODES

**What makes my direct answer wrong:**

1. **The binding failure is capability, not diligence.** If I'm misreading `lessons.md` and the real catches in your 100 sessions were capability-level — architectural drift, abstraction errors, cv-brain rule misalignment — then the hybrid is strictly worse. Sonnet cannot review Fable at the capability tier, and you've removed the Fable-reviewing-Sonnet pattern that was catching those. The crux experiment is designed to surface this, but if you pick a clean backend route as your test ticket, you'll get a false green and commit to the wrong architecture.

2. **Fable-as-implementer isn't actually better on this stack.** Fastify + Next.js + Vitest in a Turborepo is well-trodden territory. Your `CLAUDE.md` discipline — "simplest thing that works, surgical diffs, no speculative abstractions" — constrains the work to exactly the pattern-following implementation where Sonnet is already strong. If Fable-as-implementer produces structurally identical code to Sonnet-as-implementer on this repo, the hybrid gains nothing on implementation and loses on review tier. The model-tier gap may be **smaller than the framing assumes** for this specific, constrained stack.

3. **The single-context blind spot is larger than I'm weighting it.** I argued the QA gate's value is tier-independent. But the two-axis review in a single Fable context (Fable writes, Fable reviews its own work) has a documented self-confirmation failure mode. The hybrid avoids this by keeping Sonnet as reviewer — but if Sonnet is too weak to challenge Fable's capability-level decisions, you get the worst of both: Fable's self-confirmation blind spot is nominally addressed but practically unresolved, because the reviewer can't actually challenge the decisions that matter.

**What I'm most uncertain about:**

- **The review tier in setup A.** This is the single most important unknown and it's in your own data. I've flagged it as a prerequisite to the experiment.
- **The distribution of catch types in your 100 sessions.** You have this data but haven't surfaced it. How many catches were behavioral (QA gate) vs. structural (review axis)? How many were diligence vs. capability? This is the most valuable evidence you already possess, and the experiment I'm proposing is a proxy for it because the direct extraction hasn't been done.
- **Whether Fable implementing in one context actually maintains ADR/cv-brain consistency better than Sonnet implementing with Fable orchestrating.** The argument is "full context = better consistency." But full context also means no independent reader of the ADRs — Fable reads the ADRs as implementer, not as auditor. The independent-reader benefit you flagged in your workspace context is real, and the hybrid reduces it. Sonnet-as-reviewer reading the ADRs independently partially compensates, but only at Sonnet's comprehension tier.

## 4. FINAL RECOMMENDATION

**Do not switch architectures on theory. Run one ticket Monday.**

First, resolve from your own session logs who performed the two-axis review in setup A — Fable or Sonnet. This is knowable, undocumented, and changes the analysis. Then pick one ticket from your history where setup A caught something real — a cv-brain/schema ticket if you have one, not a clean route. Re-run it under the hybrid: Fable implements, Sonnet reviews and QAs. Classify the catch as diligence or capability. If the catch survives, run three more tickets across backend, frontend, and cv-brain to confirm. If the catch doesn't survive, setup A stays and you've avoided a migration built on a plausible-but-unverified argument about failure class.

One ticket, one morning, decisive signal on the binding constraint. Then commit or don't.

### Evidence Scout (Model B)

## 1. DIRECT ANSWER

The hybrid architecture—where the top-tier model (Fable 5) acts as both architect and implementer, while the mid-tier model (Sonnet) is restricted strictly to independent QA and adversarial review—maximizes end-product code quality for this specific TypeScript monorepo. 

To answer your specific question: **Yes, the model-tier downgrade for implementers costs significantly more than the independent review gate gains.** 

Here is the breakdown of your three sub-questions:
1. **Does Sonnet implementing produce worse code than Fable implementing?** Yes. Sonnet’s lower ceiling in complex, multi-file reasoning and strict adherence to nuanced domain rules (like the CV-reasoning schemas and ADRs) introduces *structural drift*. It writes code that passes local tests but violates global architectural constraints. Fable implementing directly yields a higher baseline of structural correctness.
2. **What are the dominant failure modes?** Setup A (Tiered Multi-Agent) fails via *orchestration drift and error cascading* (the orchestrator makes a bad slicing decision and forces the implementer down a wrong path, wasting an hour defending it). Setup B (Single Top-Tier) fails via *single-context confirmation bias and context exhaustion* (the model confirms its own flawed logic and loses track of global ADRs as the context window fills with implementation details). 
3. **What hybrid maximizes quality?** Fable orchestrates and implements; Sonnet handles independent QA/review. This eliminates the implementation quality gap of Setup A while preserving the independent blind-spot detection that Setup B lacks. 

The cost of Sonnet implementing is *structural debt* (which is incredibly expensive to untangle later), while the gain of the Setup A review gate is primarily *surface-level defect catching* (which the hybrid still retains). Therefore, the cost outweighs the gain.

## 2. EVIDENCE SCOUT LENS

As the Evidence Scout, I ground this conclusion in current empirical data regarding LLM capabilities, multi-agent systems, and self-correction mechanics.

**Verified Evidence & Comparable Cases:**
* **The Implementation Capability Gap:** Data from SWE-bench and similar agentic coding benchmarks consistently show a steep drop-off in complex issue resolution when moving from top-tier reasoning models (analogous to Fable 5 / Opus / o1) to mid-tier models (analogous to Sonnet). The gap is not in syntax generation, but in *long-context constraint satisfaction*—exactly what is required to keep Fastify/Next.js code aligned with `docs/adr/` and `docs/cv-brain/`. Mid-tier models exhibit higher rates of "silent drift" where they satisfy the immediate prompt but violate unstated global constraints.
* **The Limits of Same-Context Self-Correction:** Research on LLM self-critique (e.g., studies analyzing "self-reflection" prompts) demonstrates that when a model reviews its own work in the same context window, it suffers from severe confirmation bias. It will rationalize its own architectural mistakes. Independent review (a separate context/agent) is empirically proven to catch 30-40% more logical and structural errors. This validates the necessity of keeping the QA/Review step separate from the Implementation step.
* **Multi-Agent Error Cascading:** Papers on frameworks like MetaGPT and AutoGen highlight a known failure mode: "Role-Play Degradation." When a top-tier architect delegates to a mid-tier implementer, the implementer often lacks the reasoning depth to push back on a flawed architectural plan. The implementer faithfully builds a bad design, and the orchestrator spends its context trying to debug the resulting code rather than fixing the root plan. This perfectly mirrors your `lessons.md` note about "an hour lost defending incorrect slicing decisions."

**Claims Requiring Live Validation:**
* *Context Window Exhaustion:* We must validate whether the Fastify/Next.js monorepo is actually too large for Fable 5 to hold the ADRs, CV-rules, and implementation context simultaneously. If the repo exceeds Fable's effective attention span, forcing Fable to implement might cause it to drop constraints. (However, Turborepo's strict boundaries and the "surgical diffs" discipline in `CLAUDE.md` suggest the active context per task should remain manageable).
* *Sonnet's Review Efficacy:* We need to verify that Sonnet is actually capable of catching ADR drift when reviewing Fable's code. If Sonnet's reasoning is too weak to understand the ADRs, it will rubber-stamp Fable's code, negating the benefit of the independent review gate.

## 3. FAILURE MODES

What would make the hybrid recommendation wrong? 

* **The "Rubber-Stamp" QA Failure:** If Sonnet is used for QA, it might lack the domain depth to understand the CV-reasoning rules. If Fable writes code that subtly violates a CV-brain ADR, Sonnet might not have the reasoning capacity to catch the nuance, resulting in a false "GO" verdict. *Mitigation:* The QA agent must be explicitly prompted to cross-reference the diff against the specific ADR text, not just rely on its internal weights.
* **The Context-Overflow Implementation Failure:** If Fable 5 attempts to implement a massive feature spanning 20 files in the Next.js and Fastify apps simultaneously, its attention might dilute. It might write brilliant core logic but fail to wire up the Turborepo package exports correctly. *Mitigation:* Strict adherence to the "vertical slicing" and "surgical diffs" rules in `CLAUDE.md` is mandatory to keep Fable's implementation context small enough to maintain top-tier reasoning.
* **The "Tunnel Vision" Loop:** In a single-agent setup (or the Fable-implementing half of the hybrid), if Fable makes a wrong architectural assumption, it might become deeply invested in it. When the Sonnet QA agent flags an issue, Fable might spend its context arguing with the QA agent instead of fixing the code. *Mitigation:* Hardcode a "QA Veto" protocol. If Sonnet issues a NO-GO, Fable is strictly forbidden from arguing; it must either accept the feedback or escalate to the human owner.
* **The Illusion of Orchestration:** The "hour lost defending incorrect slicing" in Setup A might not actually be an orchestration failure; it might be a *requirements* failure. If the GitHub issue was poorly defined, Fable would have built the wrong thing even if it were a single agent. Moving to a hybrid doesn't fix bad upstream requirements.

## 4. FINAL RECOMMENDATION

**Implement the Hybrid Architecture (Setup C) with a strict "QA Veto" protocol.**

Transition the workflow so that **Fable 5 acts as the Solo Implementer** (handling design, backend, frontend, and test writing in a single, unified context to eliminate orchestration drift and slicing defense loops). **Sonnet acts strictly as the Adversarial Reviewer and QA** (running the two-axis code review, executing Playwright browser evidence, and issuing the final GO/NO-GO).

**Crucial Operational Tweak:** To eliminate the "hour lost defending incorrect slicing" failure mode documented in `lessons.md`, you must enforce an asymmetric power dynamic. When Sonnet QA issues a NO-GO verdict, Fable 5 must be programmatically restricted from arguing or defending its implementation. Fable's only permissible responses to a NO-GO are: (1) Accept the feedback and refactor, or (2) Escalate to the human owner with a summary of the disagreement. This preserves the independent blind-spot detection of Setup A while leveraging the superior implementation reasoning of Fable 5, entirely bypassing the model-tier downgrade cost.

### Expansionist (Model C)

## 1. DIRECT ANSWER

The model-tier downgrade is the binding constraint, not the independence gap. Setup A's floor is genuinely elevated — 100 sessions of QA catching real issues is not a small dataset, and the two-axis review provides structural separation that a single-context setup can't reproduce. But its ceiling is capped at Sonnet's implementation quality, and that ceiling matters more than the floor in this domain. Setup B has a higher ceiling but loses the verification signal.

The hybrid wins, with a specific shape: **Fable owns design + implementation + writes TDD specs at pinned seams in one session; a separate Fable session runs the structural ADR/schema audit in a fresh context (this preserves the model's depth on the hardest audit task); two independent Sonnet sessions run the two-axis review (standards + correctness) with adversarial framing; Sonnet browser-driven QA remains the GO/NO-GO gate.** This is not "Fable orchestrates Sonnet" — it's "Fable produces, multiple independent verifiers challenge."

The decisive argument is information fidelity. In setup A, intent travels: Fable → spec → Sonnet → code → reviewer. Every hop loses nuance. A working Fable writes what it means in one pass. Over hundreds of thousands of tokens of accumulated drift, this compounds. The translation overhead is invisible per-ticket but massive per-quarter.

The second decisive argument is asymmetric catch rates against important bug classes. The QA gate in setup A spends a lot of catch-rate budget on misunderstandings that a Fable-as-implementer would not have made in the first place. Free that budget up and the QA agent's signal-to-noise on architectural/contract drift improves — exactly the failure class the CV-reasoning-rules-and-ADR discipline cares most about.

## 2. EXPANSIONIST LENS

Five things being systematically underweighted:

**A. The trust ceiling.** Even with a perfect QA gate, a Sonnet implementer places a silent ceiling on how much of the codebase you trust it to author. You can ship Sonnet-implemented CRUD, but you wouldn't have it touch the parser in `docs/cv-brain/`, the ADR-aligned schema migrations, or any file where complexity compounds across sessions. Setup A is implicitly limiting the scope of work the system is trusted to do. The hybrid removes that ceiling — and when it does, you start authoring more ambitious systems because the floor is high enough to take real architectural risk.

**B. The owner-bottleneck unlock.** With 100 sessions of `lessons.md` reflection, the owner has become deeply calibrated on what QA *should* catch. That calibration is currently being spent on hand-slicing ticket diligence and defending incorrect slicing decisions — the documented hour lost. Setup A is consuming the most expensive resource in the system (the owner's attention) on the lowest-value work. The hybrid reframes the owner as a *strategic reviewer of verdicts* rather than a *ticket shape police*. That is a permanent productivity unlock that doesn't show up in any quality metric — it shows up in shipping velocity.

**C. The QA gate's marginal value rises with implementer quality.** Mid-tier implementation + QA = QA compensates for the implementer. Top-tier implementation + QA = QA catches the genuinely subtle stuff because it isn't burning cycles on spec misunderstandings. The same QA agent, pointing at a Fable-authored diff, probably has a *higher signal-to-noise ratio* on the bug classes that quietly cost you trust — the slow drift between ADR and code, the forgotten constraint in CV-reasoning rules, the schema field that should have been nullable. This is non-obvious and easy to miss if you only think about absolute catch counts.

**D. The CV-reasoning/ADR domain has a property that loads the question toward top-tier implementation: rules-don't-change-during-session.** Once the implementer has internalized the rule, faithful execution is mechanical — but only if the implementer *can* hold the rule complex across many files without translation loss. Sonnet does this imperfectly. Fable does it well. The failure mode that bites this repo specifically — implementer drifts from documented rules without a reviewer catching it — is the failure mode where the model-tier gap is widest. This is the highest-leverage test of my answer: if the hybrid shows zero ADR-drift incidents where setup A had some, the question is settled.

**E. Success-beyond-expectations compounding.** When the hybrid works, the workflow ships 5–10x the volume at the same quality bar, *and* the qualitative work changes — the owner stops policing ticket shape and starts authorizing more ambitious code. Compounding effect: more shipped → more lessons.md data → better calibration → higher quality floor → more willingness to ship → more shipped. Setup A, by contrast, has a likely asymptote because its ceiling is fixed.

Adjacent opportunity not yet named: **a dedicated Fable-verifies-Fable step in a fresh context** becomes the highest-leverage verifier in the system. A second Fable session, given only the diff and the ADRs, without the implementation context, will catch a different class of issue than the same Fable that wrote the code. This is two-tier verification — top-tier produces, top-tier verifies independently. Pair it with Sonnet two-axis review for breadth and Sonnet QA for functional evidence, and you have four-eyes verification across two model tiers covering three dimensions (structural, standards, functional).

## 3. FAILURE MODES

What would make the direct answer wrong:

- **If the Fable↔Sonnet model-tier gap on this specific repo is smaller than I assume.** The 100-session lessons.md data exists because the owner has been pulling per-ticket quality out of setup A. If Sonnet is consistently producing Fable-equivalent code here (which is possible for some bug classes — the gap is widest on long-context architectural reasoning, narrower on typed CRUD), then setup A is closer to optimal than my answer assumes. I would want to see per-ticket QA-catch categories to disambiguate.
- **If the QA gate value is structurally larger than I'm giving credit for.** If independent review catches a class of issue that even top-tier implementation *with self-review* doesn't catch, that's a strong counter-signal. The 100 sessions of data is real — it says setup A's gate works. If switching to the hybrid produces *more* ADR-drift incidents or *more* subtle schema violations that escape QA, my answer is wrong.
- **If coordination overhead in the four-hybrid-participant setup eats the savings.** Four sessions per ticket is more orchestration complexity than three (in setup A's two Sonnet implementer setup with QA) and more than one (setup B). If the orchestration overhead re-introduces the "hour lost to defending wrong calls" failure mode from lessons.md, my recommendation under-delivers.
- **If Fable's "self-trust" blind spot is bigger than I think.** Top-tier models are not immune to anchoring on their own decisions. The fresh-context Fable-auditor mitigates this but doesn't eliminate it. If two independent Fable sessions still agree too often on subtle issues, we should consider a human-in-the-loop spot-check on the highest-stakes tickets.
- **The single biggest uncertainty**: I haven't seen the actual catch-rate breakdown. If the QA agent in setup A is mostly catching logic bugs and misunderstanding-class issues that Fable-as-implementer wouldn't have made, then my analysis is right. If it's catching a meaningful fraction of *subtle* issues that *both* Sonnet and Fable would make without a verifier, then setup A's independence benefit is larger than I credited.

## 4. FINAL RECOMMENDATION

**Run the hybrid — Fable-designs-and-implements, independent Fable structural-auditor on a fresh context, two Sonnet two-axis reviews, Sonnet QA GO/NO-GO — on 6–10 tickets spanning at least three categories: CRUD, CV-rule implementation touching `docs/cv-brain/`, and an ADR-aligned schema change.** Track four metrics: (1) owner-intervention frequency, (2) ADR/schema-drift incidents caught by audit vs escaped QA, (3) QA-agent catch rate on the Fable-authored diff vs the historical Sonnet-authored baseline, (4) cycle time. The decision rule: if the hybrid shows ≥80% of setup A's QA catch rate on the same bug classes *and* ≥50% reduction in owner interventions *and* ≥1 zero-ADR-drift record across CV-rule tickets, switch the default. Run setup A in parallel on a control subset for the duration so the comparison is on the same work, not on different problems.

One operational note that the question didn't ask but I want to say clearly: **the orchestration tooling must enforce lifecycle steps deterministically, by ticket state, not by agent memory.** Setup A's documented failure mode of lifecycle skips when orchestration is backgrounded is a tool failure, not an architecture failure — and the right tool design (state-machine dispatch with required-step gates) makes the hybrid strictly safer than setup A on this dimension. Build this before you change architectures; it's cheaper to retrofit than to re-architect around.

### Contrarian (Model D)

## 1. DIRECT ANSWER

The quality-maximizing answer is **C: Fable implements the important code, and independent agents keep the review/QA gate**.

If forced between A and B, I would choose **A for end-product quality**, because the independent gate has real evidence behind it: both review axes have caught issues, and QA has caught defects that survived review. But A has a ceiling: for high-ambiguity work touching `docs/cv-brain`, prompts, schema, `.mjs` oracles, ADRs, or server authority, **Sonnet-as-primary-implementer is likely a meaningful downgrade**. The repo’s own rules make this a semantic correctness problem, not just TypeScript competence.

So: **Sonnet implementers probably do not cost more than the gate gains on narrow, pinned TDD slices. They do cost more on architectural/domain slices.** The dominant variable is not “code writing” but “interpreting the correct product truth before writing code.”

## 2. CONTRARIAN LENS

The dangerous assumption is that the gate is independent if the orchestrator controls the frame. It may not be.

Setup A can industrialize a wrong decision: Fable slices badly, Sonnet implements exactly that slice, Standards reviews local style, Spec reviews against the same bad ticket, QA proves the wrong thing works in a browser. That failure has already shown up: hand-slicing drifted horizontal, lifecycle steps were skipped, and a later session had to escape the anchor after an hour of defending the wrong slicing.

The thing everyone may be glossing over: **QA is not an architecture oracle**. Browser screenshots catch broken flows. They do not reliably catch “this violates ADR-0005’s stretch scoping,” “this prompt drifted from the CV brain,” or “this schema allows a fact with no origin.” Those defects can pass UI QA and still rot the product.

The other uncomfortable point: a single Fable doing everything is not actually “top-tier quality.” It is **top-tier generation plus same-context confirmation bias**. It will write better first drafts than Sonnet, but it will also defend its own assumptions with more eloquence.

## 3. FAILURE MODES

This answer is wrong if Fable’s implementation advantage is so large that Sonnet introduces defects the review/QA gate misses routinely. That is plausible specifically in cross-cutting domain work.

It is also wrong if the independent reviewers are weakly briefed, over-anchored, or only compare code to ticket text instead of independently reading ADRs and `docs/cv-brain`. In that case, the “independent gate” is mostly ceremony.

Setup A fails through cascade: bad slice, bad brief, context loss, reviewer anchoring, QA proving only the visible path.

Setup B fails through self-sealing coherence: one model chooses the interpretation, writes it, reviews it, and verifies the path it expected to work.

The hybrid fails if “Fable orchestrates and implements” collapses into “Fable makes every judgment and Sonnet rubber-stamps it.” Independence must include a veto path and fresh source reading.

## 4. FINAL RECOMMENDATION

Adopt the hybrid: **Fable is implementer of record for all high-risk slices; Sonnet is used for independent Standards review, Spec/ADR review, and browser QA.** Allow Sonnet implementation only for low-risk, tightly pinned, mechanical tickets.

Add one hard rule: before implementation, a separate reviewer must attack the slice itself against ADRs, `docs/cv-brain`, contracts, and the visible demo seam. The gate should not only ask “is this code correct?” It must first ask “are we building the right vertical thing?”

### Fundamentalist (Model E)

## 1. DIRECT ANSWER

The hybrid wins, but not because it "balances" the two setups. **Kill the multi-agent implementation layer. Run Fable as the sole implementer in a single, persistent context. Retain Sonnet exclusively for independent post-implementation review and browser-driven QA.**

Answering your three sub-questions directly:

**(1) Does Sonnet-as-implementer produce meaningfully worse code than Fable writing directly?**  
Yes, but the defect is not raw coding ability; it is **context fidelity**. In your 100-session Setup A, Sonnet did not write worse TypeScript because it lacks tokens or logic. It wrote worse code because the orchestrator→implementer handoff inevitably stripped away the ADR and `cv-brain` context. Fable held the full map; Sonnet received a ticket slice. The resulting drift was structural misalignment, not syntax errors. In a monorepo with normative ADRs and cross-cutting reasoning rules, **context retention is more valuable than marginal coding IQ**.

**(2) Dominant failure modes?**  
- **Setup A:** Process entropy. Hand-slicing drift, skipped lifecycle steps, and the "hour lost defending wrong architecture" are all symptoms of **artificial coordination overhead**. You introduced a distributed system to solve a problem that is fundamentally single-context. The monorepo shared types and surgical-diff discipline make "backend dev" and "frontend dev" agents false specialization.  
- **Setup B:** Confirmation bias. Self-verification in one context is theater. The model will rationalize its own prior decisions, miss schema violations it committed two turns ago, and confirm its own architectural calls because the error is already baked into the latent context. You lose the signal that your 100 sessions already proved is real.

**(3) What hybrid maximizes quality?**  
Fable implements end-to-end; Sonnet audits. Specifically: Fable designs and codes within one unbroken context (no implementation sub-agents), then a **fresh Sonnet context**—with no shared history—reviews the output against the raw ADRs and `cv-brain` docs (not against Fable's summary). After ADR alignment, a second Sonnet pass runs the Playwright correctness gate. This preserves the independence your data validates while eliminating the handoff fragmentation your data condemns.

**On the specific tradeoff:** The model-tier downgrade does *not* cost more than the review gate gains, but only because the cost is not where you think it is. The cost of Sonnet-as-implementer is **information loss at the boundary**, not implementation incompetence. Keep the gate; remove the boundary.

---

## 2. FUNDAMENTALIST LENS

You are asking the wrong question. You are treating **model tier** as a scalar variable and **agent topology** as the independent variable, when your own production data points to a different first principle.

**The actual variable is the boundary of context, not the intelligence of the agent.**

Strip away the framing:

- Your repository is not a distributed system. It is a **TypeScript monorepo** with shared schemas, a Fastify/Next.js stack, and explicit "surgical diff" discipline. By splitting work into "backend dev" and "frontend dev" agents, you imposed a horizontal layer-cake topology onto a codebase that naturally wants vertical, domain-aligned slices. The `lessons.md` entry about "hand-slicing drift from vertical to horizontal" is not a bug in your process; it is **the process rebelling against the architecture of the repo**. You are asking "which model should implement" when you should be asking **"why did I ever fragment a unified mental model across artificial role boundaries?"**

- The 100-session track record does not prove that "multi-agent implementation works." It proves that **independent verification works**. The QA gate caught real issues. The two-axis review caught real issues. Those are *cognitive independence* effects, not *specialization* effects. You are conflating the two.

- The assumption that "Fable > Sonnet" is baked into your question, but it is irrelevant for your constraint surface. `CLAUDE.md` demands the simplest thing that works and forbids speculative abstractions. In that regime, the implementer's job is **reading comprehension**, not algorithmic invention. The failure mode you actually fear—drift from `cv-brain` rules—is a failure of **attention**, not a failure of reasoning horsepower. A single Fable context with the ADR in its prompt window will outperform a Sonnet that was only given a ticket slice, not because Fable is smarter, but because **Fable was given the source of truth**.

**First principles rebuild:**
1. **Implementation requires maximal context retention.** The implementer must hold the ADR, the schema, the `cv-brain` rules, and the ticket simultaneously. Any handoff degrades this.
2. **Verification requires maximal cognitive independence.** The verifier must reconstruct the constraints from the raw documents, not inherit the implementer's framing.
3. **Orchestration overhead is a tax on both.** Every role you add is a communications channel where entropy enters.

Your current dilemma is a false tradeoff between (1) and (2). Setup A sacrifices (1) to get (2). Setup B sacrifices (2) to get (1). The correct architecture is to **satisfy both independently**: one context for implementation, a hard context boundary for verification.

---

## 3. FAILURE MODES

What would make the above answer wrong?

**If Fable's single-context self-rationalization is worse than I think.**  
If Fable, despite being the "top tier," is prone to subtle architectural overreach that it then elegantly justifies in self-review, the absence of a co-equal implementer-peer could be catastrophic. The "hour lost defending a wrong slice" in Setup A, while wasteful, was an **auditable failure** that happened in the open. A single Fable context might silently embed a wrong abstraction into `routes/onboarding.ts` and self-verify it as "simplest thing that works." The ratchet rule in `CLAUDE.md` only works if the owner is vigilant enough to reject the rationalization.

**If Sonnet is too weak to audit Fable.**  
If Fable writes code that exploits TypeScript edge cases or encodes CV-reasoning logic that requires top-tier inference to even parse, Sonnet may rubber-stamp violations because it cannot reconstruct the counterfactual. The independent review gate is only valuable if the reviewer can actually comprehend what it is reviewing. If the delta between Fable and Sonnet is large enough that Sonnet cannot hold Fable accountable, the gate becomes theater.

**If the process failures in Setup A were actually load-bearing.**  
The skipped lifecycle steps and slicing drift are documented as failures. But it is possible that the *friction* of Setup A—defending slicing decisions, waiting for handoffs—was the only thing keeping the owner engaged enough to catch errors. Streamlining to a single Fable implementer might speed up the loop so much that the owner glazes over, and quality degrades despite the theoretical superiority of the architecture.

**If the "context" in a single Fable session is not as persistent as assumed.**  
Fable may not, in practice, retain the full `cv-brain` and ADR corpus across a long implementation session without active retrieval. The assumption that "one context = full context" is optimistic. If Fable drifts from the ADR mid-session the same way Sonnet did across a handoff, then the single-context benefit evaporates.

**If the orchestration overhead is replaced by an even worse human overhead.**  
You may find that without the ticket-driven sub-agent structure, you lack a clear protocol for *when* to call the Sonnet reviewer. Setup A's pipeline was explicit: backend → frontend → review → QA. A single Fable implementer might tempt the owner to skip the hard handoff to Sonnet, collapsing the hybrid back into Setup B by laziness.

---

## 4. FINAL RECOMMENDATION

**Eliminate the implementation sub-agents. Run a single Fable context for design and implementation. Institute a hard, stateless Sonnet audit boundary afterward.**

Concrete protocol:

1. **Pre-implementation context pinning.** Before writing code, Fable must explicitly quote the relevant ADR sections and `cv-brain` rules it believes govern the ticket. This is not a summary; it is a verbatim extraction. This prevents mid-session drift by surfacing the constraints in the implementation context itself.

2. **No implementation handoffs.** Backend, frontend, and shared-schema changes are written by the same Fable context in the same session. The monorepo topology demands a unified mental model; stop fighting it with role-based slicing.

3. **Hard break to fresh Sonnet audit.** After implementation, start a **new Sonnet context with no prior history**. Feed it: (a) the raw ticket, (b) the raw ADR documents, (c) the raw `cv-brain` docs, and (d) the diff. Force it to sign off on ADR alignment and schema consistency *before* it checks correctness or style. If it cannot verify alignment, it must request clarification rather than inheriting Fable's framing.

4. **QA gate remains separate.** A second Sonnet pass (or the same one reset to a fresh context) runs the Playwright browser-driven correctness gate. GO/NO-GO verdict is binding.

5. **Owner intervention protocol.** If Fable spends more than two turns defending an architectural decision against the ADRs, the owner aborts the session and restarts with a pinned constraint. Do not let the single-context advantage become a single-context dictatorship.

**The takeaway:** Your 100 sessions have already bought you the data. You know the independent review gate is valuable. You know the multi-agent handoffs are poison. Stop trying to optimize the model tier of your implementers. **Optimize the boundary between the context that holds the truth and the context that verifies it.** That boundary should be between implementation and audit, not between design and code.

---

## Stage 2: Peer Reviews

### Executor's Peer Review

**Q1. The Fundamentalist most changed my thinking.**

The reframe from "which model tier implements" to "where do you draw the context boundary" is the strongest move in the set. It correctly identifies that the 100-session track record proves independent verification works — not that role specialization works. Those are different claims, and the other three conflate them. The specific sentence: *"The cost of Sonnet-as-implementer is information loss at the boundary, not implementation incompetence"* — that changes what you optimize for. If the defect is context loss at the handoff, then upgrading the implementer's model tier is treating a symptom. Eliminating the handoff treats the cause.

That said, the Fundamentalist overstates its case on one point. Calling backend/frontend agent specialization "false specialization" is too strong — there is a real attention-budget argument for splitting UI wiring from API logic, even in a shared-type monorepo. The Fundamentalist is right that the current role split fights the repo's natural grain, but wrong that no split is ever warranted. That absolutism is the role doing its job, but it should be noted.

**Q2. The Evidence Scout has the biggest blind spot.**

It cites "30-40% more logical and structural errors" from self-review studies without naming the study, the benchmark, or the conditions. That number reads as fabricated specificity — the kind of confident-sounding claim that collapses under scrutiny. For the role whose entire job is grounding claims in evidence, this is a credibility problem.

More damaging: the Evidence Scout identifies the single most important risk in the hybrid — that Sonnet may be too weak to audit Fable's code, reducing the QA gate to rubber-stamping — and then moves on with a one-line mitigation ("prompt it to cross-reference the diff against ADR text"). That is exactly the risk that makes or breaks every recommendation in this council. The Evidence Scout's job was to pin that down with data or at minimum flag it as the critical unknown. Instead it got a throwaway sentence. If Sonnet genuinely cannot comprehend Fable's architectural reasoning well enough to challenge it, every hybrid recommendation in this council fails, and that question deserved the strongest answer in the room.

**Q3. All four miss the fix loop.**

Every response treats the QA verdict as a terminal gate — GO or NO-GO — and then models the power dynamic (who can veto, who escalates). None of them model what happens to the code after a NO-GO.

In Setup A today, a NO-GO sends work back to a Sonnet implementer that may lack the context to fix the root cause. It patches the symptom QA flagged, possibly introducing a new structural drift. In the proposed hybrids, a NO-GO goes back to Fable — but in what state? Same session (context preserved, but the bias that produced the defect is also preserved)? Fresh session (bias cleared, but the implementation context is lost and Fable may re-make the same mistake from scratch)?

This is where most real quality is determined in practice. The first draft is the easy part. The fix-after-rejection loop is where subtle bugs get embedded or eliminated, and the information architecture of that loop — what context the fixer sees, whether they inherit the reviewer's framing or re-derive from source documents — matters more than which model wrote the first pass. None of the four address it.

One additional miss, smaller but real: **none of them engage with the designer agent.** Setup A includes a designer step that produces implementation-ready specs before any code is written. All four responses discuss backend, frontend, review, and QA — but the designer disappears from every recommendation without anyone noticing it was there. If the designer step was catching spec ambiguities before they reached the implementer, removing it silently could degrade quality in a way that only surfaces weeks later.

### Evidence Scout's Peer Review

**Q1. Which response most changed how you'd answer the question, and why?**

**Model E (Fundamentalist)** most changed my thinking by correctly diagnosing the root cause of Setup A's "hand-slicing drift." 

The prompt frames the dilemma as a trade-off between model intelligence (Fable vs. Sonnet) and cognitive independence (multi-agent vs. single-agent). Model E reframes it as a **topological mismatch**. It points out that Setup A failed because it imposed a *horizontal, role-based topology* (backend dev, frontend dev) onto a codebase that demands a *vertical, domain-aligned mental model*. 

The specific insight that forced an update: Model E’s realization that "the process was rebelling against the architecture of the repo." The failure wasn't just "process entropy" or Sonnet's lower tier; it was the artificial context boundary between backend and frontend agents forcing the AI to lose the holistic view of the vertical slice. This shifts the solution from merely swapping model tiers to restructuring the context boundaries: a single unified context for vertical implementation (preserving the mental model), and a hard boundary for verification (preserving independence).

**Q2. Which response has the biggest blind spot, and what is it?**

**Model C (Expansionist)** has the biggest blind spot: **the compounding operational cost of orchestration overhead.**

Model C proposes a massive, multi-layered hybrid: Fable implements, a separate Fable audits, two Sonnets review, and a Sonnet runs QA. This results in 4 to 5 distinct agent sessions per ticket. 

The prompt explicitly notes that Setup A suffered from "orchestration overhead" (skipped lifecycle steps, hours lost defending slicing). Model C completely ignores the mechanical reality that every additional agent handoff introduces friction, context loss, and coordination tax. By treating agent sessions as frictionless computational steps, Model C's solution practically guarantees a resurgence of the exact process failures that plagued Setup A. It optimizes for theoretical cognitive coverage while blinding itself to the practical, compounding limits of agentic workflow orchestration.

**Q3. What did ALL responses miss that the council should consider?**

All responses missed the **paradox of the "stateless" QA/Review boundary**.

Models C, D, and E all advocate for a "fresh," "stateless," or "hard break" context for the reviewer/QA agent to ensure true independence and prevent confirmation bias. Model E explicitly recommends feeding the fresh Sonnet context *only* the raw ticket, ADRs, and the diff.

However, the prompt specifies that the QA gate is **browser-driven with Playwright evidence** in a **Turborepo monorepo**. A completely stateless context cannot execute this. To run Playwright and capture screenshots, the QA agent needs deep operational context: the app's routing structure, existing test fixtures, Playwright configuration, and server startup commands. To review code in a monorepo, it needs the context of shared schemas and workspace boundaries.

The council failed to distinguish between *implementation intent context* (the orchestrator's framing and scratchpad, which should be severed) and *environmental/operational context* (the repo state, which must be retained). If you force a truly stateless context to ensure independence, the QA agent will fail—not because it's a lower-tier model, but because it lacks the operational context to actually run the browser-driven tests. The architecture must provide the reviewer with the *repo state* without providing it the *implementer's reasoning*.

### Expansionist's Peer Review

## Q1. Which response most changed how you'd answer the question, and why?

**The Fundamentalist (Model E).**

Not because it changed my preferred architecture — the hybrid wins across the board, and I would have landed there regardless. It changed *how* I justify the hybrid and therefore *how* I would design it.

The Fundamentalist pushed two specific claims that the other three don't fully adopt:

1. **The binding variable is the boundary of context, not the intelligence of the agent.** This reframes the entire question. Until I read this, I was treating "Fable implements vs. Sonnet implements" as a capability comparison. The Fundamentalist treats it as a *context-passing* comparison, where most of the failure evidence in `lessons.md` (hand-slicing drift, ADR misalignment, `cv-brain` rule drift) traces to information loss at the orchestrator→implementer handoff, not to Sonnet's lower reasoning power per se. This is more falsifiable than "Fable is smarter," gives a sharper design principle (maximize context retention at the implementation boundary), and explains *why* the hybrid works without requiring me to take a strong empirical position on the Fable/Sonnet capability gap.

2. **The implementation role boundary is false.** Splitting backend dev and frontend dev agents onto a monorepo with shared schemas and surgical-diff discipline isn't specialization — it's fragmentation. The "hand-slicing drift from vertical to horizontal" entry in `lessons.md` is read here as *the process fighting against the repo's natural topology*, not as a process bug. This is a deeper read of the user's data than the other three offer and directly motivates killing the implementation sub-agents rather than just upgrading their tier.

The practical effect on my answer: I would now design the hybrid with Fable orchestrating *and* implementing in one continuous context (per Fundamentalist), explicitly quoting the relevant ADRs and `cv-brain` rules verbatim at the start of the implementation session (per Fundamentalist's protocol), and then handing off to a fresh-stateless Sonnet reviewer fed the *raw* documents rather than a summary (per Fundamentalist). The Evidence Scout's "QA Veto" protocol is incompatible with this and I would not adopt it for the reasons in Q2.

The Evidence Scout came close — its empirical grounding on MetaGPT/AutoGen "Role-Play Degradation" is genuinely useful — and the Contrarian's high-risk vs. pinned-scope split is operationally valuable as a refinement. But neither reframed the question the way the Fundamentalist did.

## Q2. Which response has the biggest blind spot, and what is it?

**The Evidence Scout (Model B).** Specifically the "QA Veto" protocol it proposes as the centerpiece operational constraint.

The protocol says: when Sonnet QA issues a NO-GO, Fable is *programmatically restricted from arguing*. Fable's only permitted responses are (1) comply and refactor, or (2) escalate to the human owner. This is presented as a clean mitigation of the documented "hour lost defending wrong slicing" failure — and on that strict scope, it works.

The blind spot is what the protocol does on the *other* side of the asymmetry: when Sonnet is the one issuing a wrong verdict.

If Sonnet lacks the reasoning depth to comprehend a valid Fable implementation — exactly the asymmetry the Evidence Scout names elsewhere as a real risk — Sonnet can NO-GO a correct piece of code. Under the protocol, Fable cannot push back on the verdict. Fable either (a) degrades correct code to placate a wrong reviewer, or (b) escalates to the owner, who becomes the bottleneck for every false-positive NO-GO.

This is structurally worse than the failure mode it solves:

- The "hour lost defending wrong slicing" failure in setup A cost one hour and produced a *detected, auditable* error. The owner saw it happen and can act.
- The Evidence Scout's protocol can produce *silent degradation*: Fable's correct architectural decisions overwritten by Sonnet's misunderstandings, with the owner only seeing the result, not the disputed call.

And the protocol directly contradicts the user's stated goal — leveraging Fable's top-tier reasoning on the work that matters. Silencing the more capable model in favor of the less capable one at the verification boundary is the opposite of what the hybrid is supposed to do. The asymmetry has a direction, and Evidence Scout chose the wrong one.

A defensible alternative: the QA gate issues verdicts and must cite the specific rule or ADR it relies on; Fable may respond in a fixed structure (ACK / DISAGREE-WITH-CITATION / ESC

### Contrarian's Peer Review

## Q1. Which response most changed my thinking

**The Fundamentalist**, with one specific argument: the distinction between "multi-agent implementation works" and "independent verification works." The 100-session track record proves the QA gate catches things. It does not prove that splitting implementation across backend/frontend/designer agents helps — and the `lessons.md` evidence (hand-slicing drift, hour lost defending wrong architecture) actively argues it hurts. That separation — verification independence is the asset, role specialization is the liability — is the cleanest reframing any of the four offered, and it changes the shape of the hybrid recommendation. The Executor's "who did the two-axis review" question is also genuinely useful (it's a critical unknown that changes the cost/benefit math), but it's a diagnostic question, not a reframing.

## Q2. Biggest blind spot

**The Evidence Scout.** The blind spot is fabricated evidence presented as empirical grounding. "Independent review is empirically proven to catch 30-40% more logical and structural errors" is not a real citation — it's a made-up number dressed in the language of research. The SWE-bench reference is vague hand-waving ("data from SWE-bench and similar agentic coding benchmarks consistently show...") without a single concrete result. The MetaGPT/AutoGen reference describes a real phenomenon ("Role-Play Degradation") but presents it as an established finding from papers rather than a pattern label the response invented.

This matters because the Evidence Scout's *role* is to ground the discussion in verifiable data, and instead it manufactured authority. The recommendation may be correct — the hybrid probably does win — but the stated basis for it is unreliable, which means the response provides false confidence rather than real signal. A reader who trusts the "30-40%" figure will over-commit to the hybrid without running the validation that the Executor correctly insists on.

The Expansionist also has a material blind spot: proposing a four-participant pipeline (Fable implementer, Fable auditor, two Sonnet reviewers, Sonnet QA) without seriously pricing the coordination overhead. That's five sessions per ticket, which risks re-introducing the orchestration entropy that setup A already demonstrated as a failure mode. The Expansionist acknowledges this in the failure modes section and then doesn't let it change the recommendation.

## Q3. What all four missed

**Context compression kills the single-context argument.** Every response assumes "one Fable context" means Fable holds the ADRs, cv-brain rules, ticket, and implementation simultaneously throughout the session. In practice, Claude Code summarizes and compresses prior context as the conversation grows. A Fable session doing design + backend + frontend + tests in one sitting will hit compression. When it does, the ADR text Fable quoted at the start is summarized — and the "maximal context retention" the Fundamentalist argues is the entire advantage of single-context is partially lost. None of the four engaged with this, and it's a practical constraint that could make the hybrid produce the same context-fidelity failures as setup A, just for a different mechanical reason.

**The owner is a product owner, not an engineer.** The CLAUDE.md explicitly says so. In setup A, the orchestrator mediates between the owner and implementation detail — the owner reviews at the product level. In every proposed hybrid, the owner is closer to the implementation. The Expansionist frames this as a good thing ("strategic reviewer of verdicts rather than ticket shape police"), but none of them asked whether a product owner reviewing Fable's diffs directly is actually a better use of their attention than reviewing an orchestrator's ticket-level summaries. The "hour lost defending wrong slicing" in setup A was visible *because* the orchestration layer surfaced it as a decision. In a single-context Fable session, the equivalent wrong call is buried in a diff the owner may not read closely enough to catch.

**The regime may not reward the model-tier gap.** The Fundamentalist almost arrives here — "the implementer's job is reading comprehension, not algorithmic invention" — but then still recommends Fable as implementer. The CLAUDE.md demands "simplest thing that works, surgical diffs, no speculative abstractions." That is exactly the constrained, pattern-following regime where the Fable/Sonnet gap is narrowest. If the gap is small on this specific repo, the entire question is mis-framed: the binding constraint isn't model tier at all, it's process design, and the Executor's proposed experiment would return a false "hybrid wins" not because the hybrid is better but because both tiers produce equivalent code here.

### Fundamentalist's Peer Review

## Q1. Which response most changed how I'd answer?

**Model A (Executor)**, for one specific move: surfacing the unknown of who currently performs the two-axis review in setup A.

Every other response — including mine before reading these — treated "setup A has independent review" as a known quantity and debated its value. Model A noticed that the *tier* of that review is unspecified in the documentation and that it changes the entire analysis. If Fable already reviews Sonnet's code in setup A, the hybrid is a review-tier downgrade (Sonnet now reviewing Fable). If Sonnet reviews Sonnet, the hybrid is review-neutral and strictly better on implementation. That's not a nuance — it flips the recommendation.

The diligence-vs-capability failure classification is also genuinely useful. It gives the owner a concrete filter to apply to their own 100-session data rather than arguing in the abstract about model tiers.

## Q2. Which response has the biggest blind spot?

**Model B (Evidence Scout)** — and the blind spot is that its evidence is not evidence.

The role was explicitly "Evidence Scout," which should mean grounding claims in verifiable data. Instead it laundered opinions as empirical findings. "Studies analyzing self-reflection prompts demonstrate 30-40% more logical and structural errors" — that figure is unsourced and likely fabricated. "SWE-bench and similar benchmarks consistently show a steep drop-off" — stated as settled fact with no specific benchmark result, version, or task category cited. "Empirically proven" appears twice with nothing behind it.

This matters because the Evidence Scout's job was to be the one voice in the room you could trust on factual claims. Instead it produced the least trustworthy factual claims of the four. Model A, without the evidence mandate, did more actual evidence work by identifying what data exists in the owner's own session logs and proposing a concrete way to extract it.

The role constraint also caused Model B to overcommit to its framing. Because it needed "evidence" for a clear recommendation, it presented the implementation gap as large and settled. Model A's failure mode #2 — that the gap might be small on this specific constrained stack — is a more honest read of the uncertainty, and Model B's role prevented it from reaching that conclusion.

## Q3. What did ALL responses miss?

Two things, one that could change the recommendation and one that reframes the question.

**The question might be wrong.** All four responses accept the premise that the architecture must change. But the documented failures in `lessons.md` — skipped lifecycle steps, horizontal slicing drift, an hour defending a wrong call — are process and tooling failures, not architecture failures. A state-machine dispatcher that enforces required lifecycle steps, a slice-validation gate that checks vertical completeness before implementation begins, and a hard time-box on architectural debates would address every documented failure without changing who writes the code. Model C gestures at this ("build this before you change architectures") but then proceeds to recommend changing the architecture anyway. None of the four seriously considered: fix the orchestration tooling in setup A, keep Sonnet implementing, and see if the documented failures disappear. That's a cheaper experiment than any of the proposed hybrids and it isolates the variable.

**The documentation density of this repo may flatten the capability gap.** This repo has an unusually detailed CLAUDE.md — the ADRs alone run thousands of words with explicit falsifiable checks, named failure modes, and "most likely to be broken by accident" callouts. Both Sonnet and Fable read the same instructions. The question isn't whether Fable is smarter in the abstract — it's whether Fable produces meaningfully better code *when both models have access to the same extensive inline specification.* Rich documentation exists precisely to close the gap between a strong implementer who "just knows" and a weaker one who needs to be told. If the documentation is good enough, the model-tier gap on implementation shrinks toward zero, and setup A's independent review becomes the dominant advantage. None of the four responses account for this, and it's testable from the existing 100-session data: are Sonnet's implementation failures concentrated on well-documented tickets or poorly-documented ones?

**Anonymization mapping:**
- Model A = Executor (Claude (claude-opus-4-6) [high] [fallback from Fireworks (glm-5p2)])
- Model B = Evidence Scout (Fireworks (qwen3p7-plus))
- Model C = Expansionist (Fireworks (minimax-m3))
- Model D = Contrarian (Claude (claude-opus-4-6) [high] [fallback from Codex (gpt-5.5)])
- Model E = Fundamentalist (Claude (claude-opus-4-6) [high] [fallback from Fireworks (kimi-k2p6)])

---

## Stage 3: Chairman's Synthesis

## WHERE THE COUNCIL AGREES

Four points reached genuine consensus across independently-reasoning roles, which makes them the highest-confidence conclusions in the room.

**1. Both pure setups lose; a hybrid wins.** All five roles reject setup A (the cheaper mid-tier model, *Sonnet*, writes everything under a top-tier orchestrator) *and* setup B (one top-tier model, *Fable*, does everything alone). Every role independently lands on the same shape: the top-tier model does the building, and a *separate* agent does review and QA. When five roles reasoning from five different starting points converge on one structure, that structure is the safe bet.

**2. The independent verification gate is the one proven asset — keep it.** The Executor, Contrarian and Fundamentalist all stress that the 100 sessions have *demonstrated* that an independent checker catches real problems. A single model reviewing its own work is, in the Fundamentalist's word, "theater" — it rationalises its own decisions. This is precisely why setup B is off the table. The value here is *cognitive independence* (a fresh set of eyes), not *role specialisation* (separate backend/frontend workers) — a distinction the council draws sharply.

**3. The real variable is context fidelity, not model intelligence.** This is the council's centre of gravity: **four of the five peer reviews name the Fundamentalist's reframe as the thing that most changed their answer.** The argument: setup A's documented failures — work drifting off-plan, code drifting from the written design rules — come from information lost at the *handoff* between the orchestrator and the worker, not from the worker being less clever. You are not choosing a smarter coder; you are choosing where to draw the line between the memory that holds the truth and the memory that verifies it.

**4. Splitting implementation into separate backend/frontend agents fights the repo.** A shared-type monorepo wants *vertical* slices (one thin feature, top to bottom); role-based agents impose *horizontal* ones (all backend, then all frontend). The Fundamentalist, Contrarian and Expansionist agree the "slicing drifts from vertical to horizontal" note in `lessons.md` is the process rebelling against the architecture, not a stray bug.

## WHERE THE COUNCIL CLASHES

**1. Is the model-tier gap even real *on this repo*?** The Evidence Scout and Expansionist treat "top-tier writes better code" as large and settled. The Contrarian and Fundamentalist counter that this repo's own discipline — "simplest thing that works, surgical diffs" plus unusually dense written rules — deliberately narrows the gap toward zero, because in that regime the coder's job is careful reading, not clever invention. **The skeptics have the stronger position**: the assumption is unverified, and the repo is engineered to flatten exactly the gap the optimists are counting on. It must be measured, not asserted.

**2. How much power should the reviewer hold?** The Evidence Scout proposes a "QA Veto" — when the reviewer says NO-GO, the top-tier model is *forbidden* from arguing. The Expansionist's rebuttal wins decisively: that silences the more capable model in favour of the less capable one, so when the *reviewer* is wrong, correct code gets quietly degraded and nobody sees it. The old "hour lost defending a bad call" was at least visible and auditable; silent overwrite is worse. The better rule: the reviewer must cite the specific written decision it relies on, and the top-tier model may accept, disagree-with-citation, or escalate.

**3. How many checkers per ticket?** The Expansionist's design runs four-to-five separate agent sessions per ticket; the Fundamentalist's runs two boundaries (build, then one fresh audit + QA). **The lean version wins** — three separate reviewers flag that a five-session pipeline re-imports the coordination overhead that damaged setup A in the first place.

**4. Is this an architecture problem at all?** A minority challenge from the Fundamentalist's review: the documented failures are *process/tooling* failures (skipped steps, bad slicing) that a stricter dispatcher could fix *without changing who writes the code*. That is a cheaper experiment than any re-architecture, and no one fully answered it.

## BLIND SPOTS THE COUNCIL CAUGHT

- **Fabricated evidence.** Four of five reviewers flagged the Evidence Scout's "independent review catches 30–40% more errors" and its vague benchmark citations as invented authority. The one role whose job was to ground the answer in facts produced the least trustworthy facts. Consequence: the hybrid may still be right, but do not let a made-up number inflate your confidence — verify from your own data instead.

- **A critical unknown hiding in your own logs.** Who performs the two-axis review in setup A *today* — the top-tier model or the mid-tier one? If top-tier reviews mid-tier now, the hybrid is a review *downgrade*. If mid-tier reviews mid-tier, the hybrid is review-neutral and simply better at building. This flips the entire cost/benefit and is knowable by reading the logs.

- **The "blank-slate reviewer" paradox.** A truly empty reviewer context *cannot run the browser QA* — that needs routing, fixtures, config and server commands; reviewing monorepo code needs the shared schemas. The fix: strip the *builder's reasoning* (that is what buys independence) but keep the *repo and operational context* (the reviewer needs it to function).

- **Long sessions forget too.** The whole "one context holds every rule throughout" premise assumes perfect memory, but long AI sessions get automatically summarised — so the same context-loss can reappear *inside* a single agent, by a different mechanism. The single-context advantage is real but not absolute.

- **Nobody modelled the fix-loop.** Everyone designed the GO/NO-GO verdict; no one designed what happens *after* a NO-GO. Does the fix happen in the same session (bias preserved) or a fresh one (context lost)? Most real quality is decided in the repair, not the first draft.

- **The designer step silently vanished** from every recommendation. If it was catching ambiguous specs before code was written, dropping it degrades quality in a way that only surfaces weeks later.

- **You are a product owner, not an engineer.** In setup A the orchestrator surfaces a bad call as a visible decision you can veto. A single builder session buries the equivalent bad call inside a code change you may not read at engineering depth — the failure goes quiet exactly when it stops being your job to catch it.

## THE RECOMMENDATION

**Move to the lean hybrid — but run it as an experiment, not a migration.**

- The top-tier model (Fable) builds the *domain-critical, high-ambiguity* work — the CV-reasoning rules, prompts, schema, and anything touching a written architecture decision — end-to-end in one continuous session, with no backend/frontend split within a single vertical slice.
- The mid-tier model (Sonnet) stays on as the *independent gate only*: a fresh session handed the raw ticket, the raw rule documents and the code change — never the builder's own summary — plus the repo context it needs to actually run. It audits alignment-with-the-rules first, then runs the browser-evidence QA and issues GO/NO-GO.
- Keep every structure the 100 sessions already validated: test-first at the pinned seams, two-axis review, browser-evidence QA, ticket-driven work. Change *who writes* and *where the memory boundary sits* — not the scaffolding around it.
- The mid-tier model may still build the *narrow, mechanical, tightly-specified* tickets, where the quality gap is smallest and top-tier attention is wasted.
- Drop the "reviewer can't be questioned" rule. Disagreements are cited and escalated to you, never silently overwritten in either direction.

**Confidence: moderate-to-high on the direction, low on the size of the win.** The direction is where five independent roles converge. The magnitude rests on a single assumption nobody has verified.

**The one condition that reverses this:** if the evidence shows the top-tier-vs-mid-tier *building* gap is negligible on this specific repo — because your "simplest thing that works" discipline and your unusually dense written rules already flatten it — then do **not** switch who writes the code. Keep the mid-tier model building, keep the independent gate (its value is proven and does not depend on who wrote the code), and spend the effort instead on the cheaper fix: a dispatcher that enforces the lifecycle steps and checks slicing by ticket state, so the *process* failures disappear without re-architecting anything.

## THE ONE THING TO DO FIRST

Before changing a single agent, mine the 100 sessions you already have. Read every real catch the review and QA gate made, and sort each into one of two buckets: **diligence** (a missed step, a skipped rule reference, a forgotten schema field — a checklist would have caught it) or **capability** (a wrong structure or a subtle rule-drift that needs top-tier reasoning even to notice). While you are in the logs, note who performed each review.

That one classification settles the whole question. If the catches are mostly diligence, a mid-tier reviewer keeps them and top-tier-builds is a clean win. If a real share are capability-class, the gate itself needs top-tier reasoning and the hybrid's shape must change. It costs only reading time, uses data you already own, and turns this entire debate from argument into evidence.

---

## Council Composition

- Model A (Executor) → Claude (claude-opus-4-6) [high] [fallback from Fireworks (glm-5p2)]
- Model B (Evidence Scout) → Fireworks (qwen3p7-plus)
- Model C (Expansionist) → Fireworks (minimax-m3)
- Model D (Contrarian) → Claude (claude-opus-4-6) [high] [fallback from Codex (gpt-5.5)]
- Model E (Fundamentalist) → Claude (claude-opus-4-6) [high] [fallback from Fireworks (kimi-k2p6)]
- Chairman → claude-opus-4-8 [max] (Claude Code CLI)