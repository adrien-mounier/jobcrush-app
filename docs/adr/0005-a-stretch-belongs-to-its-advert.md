# ADR-0005 — A stretch belongs to its advert

- **Status:** Accepted
- **Date:** 2026-08-06
- **Decided in:** [#141](https://github.com/adrien-mounier/jobcrush-app/issues/141) (owner grilling), under map [#127](https://github.com/adrien-mounier/jobcrush-app/issues/127)
- **Depends on:** [ADR-0002](0002-how-a-structured-fact-reaches-the-cv.md) (how a fact reaches the page), [ADR-0003](0003-the-shared-parts-organisation-date-level.md) clause 9 (a stretch carries two independent labels), [ADR-0004](0004-each-elements-own-parts.md) clause 1a (every fact points at its origin; origin decides reuse), map #127 owner decision 9 (the product proposes stretches, it does not police honesty)
- **Does not decide:** the words on the decline control, or any other interface question (map #127, Out of scope) · where the visitor reads an interview narrative back ([#142](https://github.com/adrien-mounier/jobcrush-app/issues/142)) · whether a fact may be held but never printed ([#144](https://github.com/adrien-mounier/jobcrush-app/issues/144))

## Context

Owner decision 9 makes the product **propose** stretches: when a role wants a signal the person lacks,
the machine drafts a softened, defensible claim and a prepared interview narrative, and the person
approves it by hand. That philosophy is vindicated by the owner's own case — a light finance-trading
stretch, proposed against a banking advert, won an interview that was handled honestly in the room and
produced an offer.

**Then it leaked.** The approved claim became an ordinary fact about the person, and appeared on a
later, unrelated advert with nothing to do with finance — where it also **displaced a genuine fact** the
owner considered more relevant.

**The mechanism was written into the design as a feature.** The ported contract
(`JobCrush/contracts/enrichment_proposal.schema.md`) states that proposals are *"keyed to the claim
graph, not to any one offer — so they persist across offers and dedup recurring asks"*, and that on
approval the claim *"enters the graph as an `origin:enrichment` node"* — an ordinary node. The contract
**records `originOffer` on the proposal and then discards that scope at the exact moment it starts to
matter.** Cross-offer persistence was chosen so recurring asks could be deduped; the cost was never
priced.

**This ADR is not a guardrail on stretching, and must not be read as one.** Owner decision 9 governs
throughout: propose freely, never moralise. The leak is a problem *because it devalues the stretch* — a
claim that appears everywhere is no longer a targeted, defensible position, and the person cannot
prepare a narrative for an advert nobody told them it would appear on. That is decision 9's own clause
(*the machine never adds silently; the human owns every stretch*) being violated, not enforced.

**Nothing here is live yet.** `claimGraph.ts` defines `origin: "source" | "enrichment"` and already
refuses an enrichment node with no `narrative_ref`, but no code in this repo writes one; `graph.ts`
stamps `origin: "source"` with a comment deferring stretches to S3. The leak exists in the *design*, not
in this repo's behaviour, so every clause below was still free to take.

**ADR-0003 clause 9 already answered half of this ticket** — the owner's *degré de maîtrise* proposal is
two independent labels, both of which already exist (the evidence grade, and clause 8's ladder). What
remained, and what this ADR decides, is the leak itself.

## Decision

### 1. A stretch is a fact about one application, not a fact about the person

An approved stretch attaches to **the application it was made for**. The person's profile — the career
record owner decision 6 is building toward — holds only what is **true and theirs**: what they stated,
what they corrected, what was read from their CV.

**This makes the leak structurally impossible rather than policed.** The CV writer for a later advert
reads the profile; the stretch is not in it; there is nothing to filter and nothing to fail.

**Why the filtered alternative was rejected, specifically.** ADR-0004 clause 1 already carries the
warning: `santifer/career-ops`' anti-fabrication gate failed three separate times in the thirty days
before that decision — once failing truthful CVs, once missing from 16 of 18 localized prompt files,
once completely inert in five locales — and still reported `pass`. *"It manufactures confidence."* A
stretch sitting in the general pool behind a rule is that same shape: when the rule does not run, the
stretch is on every CV, which is precisely today's bug arriving again as a regression instead of a
design. **An absence cannot fail the way a check can.**

**This also answers, by construction, whether a stretch is re-confirmed at render time.** Yes — there is
no unconfirmed path. Every appearance of a stretch on any CV is a fresh per-advert approval.

**And it gives the interview narrative its first home.** Map #127 records that decision 9's narrative has
**no surface in this product at all**. It now lands on the application, beside the CV it defends.

### 2. Stretches are stored beside the profile, never inside it with a separation

The rejected alternative was to keep stretches in the profile, marked, with every reader expected to
skip them.

**A separation inside one store is a convention**, and a convention is enforced by every future reader
remembering it — the CV writer, the matcher, the confirm deck, the export. Miss one and the leak is
back, silently. **Beside** means the CV writer physically cannot see a stretch unless it is deliberately
handed one. This is clause 1's argument applied one level down, and weakening it here would undo
clause 1.

🚨 **This overwrites the ported contract.** *"The claim enters the graph as an `origin:enrichment`
node"* is no longer what happens: an approved stretch does **not** become a claim-graph node. Map #127
owner decision 9 already authorises this — *"review it completely and overwrite it if necessary; keep
only what we judge useful here."*

**Accepted cost, stated plainly:** *"everything JobCrush knows about me"* and *"everything JobCrush has
ever said about me"* become two different lists. That is chosen, not incidental.

### 3. The stretch library proposes. It never adds.

Approved stretches accumulate in a library, consulted **after** normal tailoring has run. It has two
jobs:

- **Offer a past stretch for a new advert** — surfacing it as a proposal the person approves for *this*
  advert.
- **Improve or skip a question about to be asked** — if the person is about to be asked cold about
  settlement and an approved stretch on settlement already exists with a narrative they have thought
  through, asking from scratch is waste. This is the job `tags` was invented for in the ported contract
  (*"dedup recurring asks"*), and it survives intact.

**The line that decides whether the library is a fix or the leak with extra machinery: it may propose,
never add.** If the pass can place something on a CV because it was approved once before, that **is**
the leak — approved for banking, appearing on marketing, with no warning and no prepared narrative.

⚠️ **This line will come under pressure and must hold.** Twenty banking applications means twenty taps,
and *"just remember his answer"* is one product decision away. That change reopens this ADR.

**Every suggestion states why it fired** — what in the advert matched. *"This advert mentions
settlement"* is checkable; *"this looked relevant"* is not. **This is not a guardrail** — owner decision 9
explicitly rejected no-rubber-stamp guardrails and that rejection stands. It is information, and a
stated reason the person can disagree with is the difference between approving and rubber-stamping.

**Running the library pass last is deliberate and protective.** Genuine facts get first claim on the
page; a stretch is never in the room while the CV is being built, because under clause 2 it cannot be.

**Accepted risk, not mitigated.** Over a year the library grows, and every application surfaces
suggestions from it. One tap each. The end state resembles the general pool this ADR exists to prevent —
except the person chose it every time. Under decision 9 that is their call and the product does not
moralise. What the product owes them is that the proposal is **visible, specific, and reasoned**; not
that it protects them from themselves.

### 4. A stretch may displace a genuine fact, but never invisibly

Two pages is a hard budget (`prompts/preview-tailor.md`: *"the whole CV fits two pages"*, *"8-12 items
total across groups"*), so *"add it and drop nothing"* is not available. Something gives.

**Clause 1 already dissolved most of this problem**: a stretch can only reach a CV if it was approved
**for that advert**, so any displacement is one the person sanctioned rather than one the machine
performed. What remains is whether they see the cost.

**The mechanism, in order:**

1. **Judge the stretch on its own merits for this advert** — is it worth adding at all?
2. **Find the least-relevant item in the same slot.** A stretch competes **slot-matched**: a bullet
   displaces a bullet under the same job, a skill displaces a skill (or nothing — the skills line is
   cheap), a summary line displaces a summary line.
3. **Check the stretch is actually better than what it would evict.**
4. **Propose the swap, showing both lines in full** — *"out: ran the office relocation / in: exposure to
   securities-adjacent data flows"* — never a summary of them.

**Step 1 before step 2 is deliberate.** Asking *"which bullet is weakest, shall we swap it?"* has already
assumed something is coming off.

🚨 **Step 3 is not redundant, and omitting it is the likely bug.** Steps 1 and 2 always find a victim.
Asked *"is this relevant?"* in isolation, a model says yes far too readily, so without an **explicit**
comparison every advert produces a swap. The comparison does not happen implicitly.

**Step 4 shows full text because the person is the only one who knows what a low-relevance bullet was
carrying** — the only number on the page, the thing that explains a gap, the sole evidence of seniority.
That judgement is theirs and it is free to give them, but only if they can read both lines.

⚠️ **The swap shown must be the swap made.** If the CV writer predicts one eviction and then rebuilds and
drops something else, the person has been told a comfortable lie. The prediction is the outcome, not an
estimate.

**Why "a stretch never displaces a genuine fact" was rejected** — the owner's own instinct, and his own
case is the counter-example. On a banking advert testing trade lifecycle, the genuine facts in the
marginal slots are the weakly relevant ones; the stretch that won him the interview was worth more than
the fact it beat. A rule protecting the 12th-best true fact would have blocked it.

**Why this does not violate ADR-0002.** That ADR rejected *"ask the visitor what to promote"* because
*"twenty applications become twenty decisions — saving exactly that time is the product's promise."*
This clause adds **no new question**: the person is already being asked whether to include the stretch.
It attaches the price tag to a tap they are already making.

### 5. A stretch never graduates. It is superseded by a real fact.

When a stretch becomes genuinely true — the person did the job, took the course, grew into it — the
stretch does **not** get promoted. **The person states the fact**, and *"the person said it"* is already
a legitimate origin under ADR-0004 clause 1a: permanent, theirs, reusable on every CV where it helps.

The old stretch stays where it is, on its application, with its narrative — an honest record of what was
claimed at the time. **A stretch does not graduate; it is superseded** — the same shape as ADR-0003
clause 7, where a correction supersedes a value rather than erasing it.

**Automatic promotion was rejected as the most dangerous option on this ticket.** Any trigger — the job
was won, the stretch was approved five times — is **the machine deciding a claim about the person became
true**, which is the one clause of owner decision 9 the owner named as his own. Winning the job proves
they were hired, not that the claim was accurate.

**A prompt, which is a question and therefore permitted:** when a stretch has been approved several
times, ask — *"you have used 'exposure to trading' on three applications. Is this now genuinely true?"*
The library becomes a quiet list of things the person may have grown into.

⚠️ **See what one tap does there.** It converts an advert-scoped stretch into a **permanent general fact**
that appears on every future CV where it helps. That is correct when it is true, and it is the person's
call to make — but it is a large transition behind a small control, and the interface must not make it
feel incidental.

### 6. Written once at proposal, frozen at render — and placed like any other fact

A proposal already contains the finished sentence (*"the softened, defensible CV claim"*), and that is
what the person approves. **The CV writer prints it verbatim and may not re-word it.**

**The interview narrative is attached to that sentence.** If the writer softens or sharpens it on the way
to the page, the person walks into the room having rehearsed a defence of a line that is not on their CV.
That destroys the mechanism that makes stretching safe. This is ADR-0002 clause 3's reasoning — *the
machine must not repair a number inside the visitor's own words, because only the visitor knows what it
measured* — applied to a sentence the visitor deliberately approved.

**This relocates tuning rather than removing it.** When a second bank wants the same stretch, the wording
that suited the first may be wrong. The library proposes it with **re-tuned text**, and the person
approves the new sentence with a narrative that matches it. **Wording is tuned when proposed, frozen when
rendered. Tuning stays visible; it never happens behind the person.**

**Placement is unchanged from ADR-0002 clause 4** — the normal position by default, rising into the
summary when the advert tests it. A stretch gets **no special demotion**. Demoting it would be a
guardrail decision 9 rejected, and it would be incoherent besides: approving a stretch *for this advert*
already says the person wants to be seen as having it.

### 7. There is no such thing as an approved stretch with no advert

The ported contract allows a proposal from a market scan with `originOffer: null`. Approving one of those
would create a stretch scoped to **nothing** — the leak, re-entering through a side door.

**A scan may raise a suggestion; only an advert can approve one.** The advert reference is **required the
moment a proposal is approved**, not merely recorded when it is raised. A scan-sourced suggestion waits
in the library until a real advert makes it concrete.

### 8. Each approval is its own record, pointing back at the one it came from

Because clause 6 tunes wording per advert, *"the same stretch"* approved for three banks is genuinely
three sentences with three narratives. They are tied together by **pointing at the proposal they were
derived from** — which is what ADR-0004 clause 1a already requires of every fact, not new machinery.

That lineage is what makes clause 5's *"you have used this three times"* countable at all.

### 9. Declining says which decline it is

The ported contract says a declined proposal is *"parked, never resurfaces."* Under a library that is
wrong: declining trading for a marketing job must not kill it for the next banking job.

**But a tap cannot tell the machine which "no" was meant.** *"Not for this job"* and *"I do not want to
claim this, ever"* are different, and guessing wrong is costly both ways — guess *never* and a stretch
that would have won the next banking interview is dead; guess *this job only* and the person is pestered
forever about something they have decided against on principle.

**So the decline states its own scope: this advert, or never again.** The contract's good instinct is
kept — *never again* still means never again — it is simply **said rather than assumed**.

⚠️ **The wording of that control is a design task and is explicitly not decided here.** The owner's own
observation: *"never suggest this again" is not good enough for the user to understand.* A misread
control produces principled declines from people who meant *not today*. Map #127 puts the interface out
of scope, so this is recorded as a **named requirement handed to the design effort**, not invented here.

## Consequences

**ADR-0002 gains a third kind of passenger, and does not reopen.** Its clause 1 table has two rows — a
stored structured part may be reformatted and computed on; the visitor's own words may be written up into
a CV line. A stretch is a third: **written once at proposal by the machine, approved by the person, and
frozen thereafter.** Both existing rows stay correct.

**ADR-0002 clause 2 needs a scope note, not an amendment** — and map #127's fog item on reconciling owner
decision 9 with the rules that appear to forbid it is largely cleared by this ADR. Read literally,
*"never a pre-filled draft to wave through"* bans the enrichment loop outright. It does not, because it
governs a different case: clause 2 is about **thin input on the person's own material**, where the honest
move is to show holes rather than invent filling. A stretch is the case where the person has no material
at all, and it carries three things a pre-filled draft lacks — a mandatory interview narrative, a
per-advert approval, and no route into the profile. **This follows the precedent ADR-0004 set for
ADR-0003 clause 8: a sound clause gains a scope note; amending it is how a rule loses its authority.**
- `prompts/claim-miner.md` rule 7 (*"Do not invent. Do not improve the candidate."*) needs **no change**
  — `CLAUDE.md` already scopes it to *reading a CV*, and this ADR touches nothing in the mining stage.
- #128 §1 (*never invent precision*) governs **facts**. A proposal is not a fact until a human approves
  it for a named advert, and it never enters the profile. The mining stage stays strictly non-inventive
  while a later, explicit stage proposes — which is exactly the reconciliation the fog item suggested.
- **Residue, still open:** the exact wording of the ADR-0002 clause 2 scope note.

**[#144](https://github.com/adrien-mounier/jobcrush-app/issues/144) inherits a neighbour it did not
have.** It owns *"a fact that must not print."* This ADR creates *"a fact that may print here and nowhere
else."* **ADR-0002 has no concept of conditional printing at all**, and both cases now need one.

**[#142](https://github.com/adrien-mounier/jobcrush-app/issues/142) finally has content.** The interview
narrative, the tailored CV, and the stretches claimed on each application all land there — which is what
that screen was flagged as existing for.

**The ported contract changes in four places**, all in `packages/contracts` (zod port **and** the `.mjs`
oracle, per the repo rule that the oracle is the spec):
1. an approved stretch does **not** become an `origin:enrichment` claim-graph node (clause 2);
2. `originOffer` becomes **required on approval**, not nullable (clause 7);
3. `state: "declined"` carries a **scope** — this advert, or never (clause 9);
4. an approval records the **proposal it derived from** (clause 8).

⚠️ **`conservationIssues()` does not catch the displacement this ADR governs.** It protects fact
*classes* by counting them; swapping one experience bullet for another is invisible to it. Clause 4's
step 4 is the only thing that surfaces a swap, so it is load-bearing rather than cosmetic.

🚨 **The library pass needs its own negative test.** If it silently does not run, the person sees no
suggestions — **indistinguishable from "there was nothing relevant."** That is the exact failure
`career-ops` shipped three times in one month, and ADR-0004 clause 1 already carries the warning: a check
that finds nothing must be distinguishable from one that did not run.

**Nothing here is buildable against current storage.** There is no application record, no stretch store,
and no enrichment code in `apps/api`. Every clause lands in build tickets.

## Alternatives rejected

| Rejected | Why it was attractive | What it cost |
|---|---|---|
| **A stretch is a fact about the person, filtered per advert** (clause 1) | One place to look; the profile is a complete picture; reuse is trivial. | A filter that does not run puts the stretch on every CV — today's bug as a regression. `career-ops` shipped exactly that failure three times in one month while reporting `pass`. |
| **Scope a stretch to a *kind* of advert via `tags`** (clause 1) | Solves the owner's case (finance stretch, non-finance advert) with a mechanism the contract already has. | Tags are machine-assigned. One loose tag and the stretch appears on an advert nobody approved it for — decision 9's *never adds silently*, violated with more steps. |
| **Inside the profile, with a marked separation** (clause 2) | No change to the ported contract; one store. | The separation is a convention every future reader must remember. One reader forgets and the leak returns invisibly. |
| **The library may auto-include a previously approved stretch** (clause 3) | Removes twenty taps across twenty banking applications — real, felt friction. | It **is** the leak. The person walks into an interview unprepared for a claim on their own CV. |
| **A stretch never displaces a genuine fact** (clause 4) | The owner's own instinct; protects true material by construction. | On a banking advert the marginal true facts are the weak ones. This rule would have blocked the stretch that won the owner his interview. |
| **Ask the person which item to drop, freely** (clause 4) | Total control; they know their own CV. | ADR-0002 already rejected this: twenty applications become twenty decisions, and saving that time is the product's promise. |
| **Promote a stretch automatically** — job won, or approved N times (clause 5) | Zero friction; the record self-heals over time. | The machine deciding a claim about the person became true. Decision 9's own clause, broken. Winning a job proves they were hired, not that the claim was accurate. |
| **The CV writer may re-word an approved stretch to fit the advert** (clause 6) | Better-fitting prose; the writer sees the whole page. | The interview narrative defends a sentence that is no longer on the CV. The safety mechanism that made the owner's stretch survive a real interviewer is destroyed silently. |
| **Demote a stretch — never let it into the summary** (clause 6) | Feels safer; the most-read space stays purely factual. | A guardrail decision 9 rejected, and incoherent: approving a stretch for this advert already says the person wants to be seen as having it. |
| **Keep decline global, as the ported contract has it** (clause 9) | Simplest; respects a "no" absolutely; nobody is asked twice. | Declining trading for a marketing job kills it for the next banking job, and the person never knows what they lost. |
| **Make decline per-advert always** (clause 9) | Never loses a stretch; contextual by default. | Someone who has decided on principle never to claim trading is asked about it forever. |

## Verification

**This ADR's own test:** [#142](https://github.com/adrien-mounier/jobcrush-app/issues/142)'s design pass
must be a **mechanical walk** through clauses 1, 5 and 6 — the application holds the stretch, its
narrative and the CV it printed on; nothing on that screen needs a new rule about what a stretch *is*. If
designing that screen reopens the question of where a stretch lives or whether it can be edited after the
fact, this ADR is wrong and #141 reopens.

**The clause most likely to be quietly broken is clause 3** (*propose, never add*), and the pressure will
arrive as a usability improvement, not as a disagreement. Any change that lets a previously approved
stretch reach a CV without a fresh per-advert approval reopens this ADR by definition.

**Unverifiable until built, and deliberately so:** whether clause 4 step 3's better-than comparison
actually fires. It is the step a model will skip while appearing to succeed, and it needs a test that
distinguishes *no swap was warranted* from *the comparison never ran*.
