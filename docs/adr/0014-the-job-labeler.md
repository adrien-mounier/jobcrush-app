# A past job is labeled with a job family by an LLM against a closed list, stored on the record, and trusted only after measurement

Status: accepted (owner design pass, 2026-08-15, issue #134)

Every dated job record — and the target role — is placed in a **job family** so that
years-of-experience can be scoped ("5 years as a PM") instead of only totalled ("8 years").
The placement is made by an **LLM given the closed, versioned family list**, answering the
existing `FamilyPlacement` contract: `confirmed`, `needs_clarification` (2+ choices), or
`unmapped` — never the nearest family. One call per job, checkpointed so retries never
re-spend.

## The decisions, and the roads not taken

1. **Closed vocabulary on both axes.** Kind-of-work (job family) and kind-of-employer
   (**industry**) both come from closed, versioned lists we publish. Free-form labels were
   rejected: nothing would guarantee a job's label and an advert's requirement come from the
   same vocabulary, collapsing back into word-matching — the weakness the claim graph exists
   to remove. The cost (curation, honest `unmapped` for unlisted businesses) is accepted and
   handled by a pilot-phase vocabulary-growth process (own ticket).

2. **Industry is designed now, built later.** Its recorded shape: a seventh fact on the job
   record, closed vocabulary **with relatedness between entries** (banking is near finance,
   far from chemicals) so future advert scoring can judge partial fits. The field is added
   only when its labeler ships — an empty slot nothing writes or reads was rejected, and the
   relatedness design may still reshape what is stored.

3. **The label lives on the job record** as a sixth fact beside employer, title, start, end,
   kind — not in a separate placements store. This buys #128's correction rules for free: a
   correction supersedes, a re-read never overwrites it. Its origin is *worked out* (like the
   years number); it quotes no CV text.

4. ~~**Asking the user is allowed only when the machine cannot work it out** — a genuine
   2+-family ambiguity or broken-looking data (a university name in the employer slot). It
   never asks to double-check a confident placement; the accuracy bar exists so it doesn't
   have to. All such questions land batched on the review-your-jobs screen, never mid-flow.~~
   **Superseded by amendment 1 (#225): the labeler never asks. See below.**

5. **Unmapped never lowers a number.** An unmapped job counts toward total years and toward
   no family's years; boundaries beside it are never guessed at. It is shown honestly
   ("we couldn't place this") with the correction path as the lever, and recorded as feed for
   the vocabulary-growth process.

6. **Measured before trusted.** The labeler goes live only after passing a ~60-case
   hand-labeled grid (drafted by the agent, arbitrated by the owner) at the bars already
   enforced for publishing a family: comparable accuracy ≥ 0.95, stranger catch-rate ≥ 0.90,
   false-unknown rate ≤ 0.05. The grid stays as a permanent regression test. A heuristic
   second engine (embedding sanity check) was considered and deferred until measurement shows
   the LLM needs it.

7. **A stored placement keeps its family version.** Publishing a new family or version never
   mass-relabels stored jobs; corrected labels are never touched. A visitor's numbers never
   change under them overnight; re-labeling on next touch is the accepted cost.

## Consequences

Years-of-experience becomes one fact per family plus the career total (both at once — "8+
years of IT including 5+ as a PM" is two bars at two scopes). `resolveUserYears` reads the
advert's own family scope. The `resolveFamily()` stub retires. #216 and #63 unblock behind
this. Follow-up tickets: the industry labeler; the pilot vocabulary-growth process
(autonomous research on unmapped labels → owner-approved additions).

---

# Amendment 1 — a job can be in several families, the machine never asks, and doubt is carried by the ranking

Status: accepted (owner design pass, 2026-08-15, issue #225)

The original ADR left **cardinality** undecided. One placement per job record made "a job belongs
to one family" the standing answer by inheritance rather than by decision, and #222 was about to
turn that default into arithmetic a visitor is scored on. This amendment decides it.

The case it is decided against: a Technical Program Manager who runs delivery half the week and
decides the product the other half. Placed in one family, four years of the other vanish. An advert
asking for those years then scores her at nothing — a job she could win, scored as one she cannot,
which is the failure #86 ranks worst.

## The decisions

1. **The labeler never asks the user anything.** Reverses decision 4. Placement is an internal
   judgement from end to end. The rationale is not cost — it is that the question is unanswerable:
   a person cannot be expected to know whether their own job meets our definition of a job family,
   the family names mean different things to different people, and a person who is unsure will pick
   both out of fear of missing adverts, which tells us nothing. A question whose answer we cannot
   trust is worse than no question. The batched end-of-deck panel shipped by #221 is removed.

2. **A job record may hold more than one family.** `confirmed` carries one *or more*
   `FamilyVersionReference`s. `needs_clarification` is deleted with no replacement — with nobody to
   ask, "we cannot tell between A and B" and "it is genuinely both" produce the same arithmetic.
   Two outcomes remain: `confirmed` and `unmapped`. Contract change, so the zod port and the `.mjs`
   oracle move together by version (CLAUDE.md).

3. **No cap on families per job in the contract.** The instruction to the labeler holds the line at
   two, and the eval grid measures it. A refused write would hide the signal a hard cap exists to
   catch: if three families are named often, our families are drawn too narrow.

4. **Years count fully toward every family a job carries, never split.** Splitting invents a
   precision nobody has. The consequence is accepted and load-bearing: **the family numbers no
   longer sum to the career total** (six years of dual work reads as six in each), so no surface may
   ever present a sum of families as a figure. The career total stays separately derived, each job
   counted once.

5. **Confidence rides on the ranking, never on the fact.** The labeler returns an ordinal level —
   *certain / likely / possible* — not a float. A float invites false precision, is badly calibrated
   coming from an LLM, drifts with every prompt edit, and cannot be tested by the grid. The level
   **attenuates the card's score**, so a job we are less sure about sinks in the deck; it never
   changes the years fact, which stays a whole honest number the product can print. This preserves
   the separation the codebase already keeps everywhere else: facts stay true, uncertainty lives in
   the ordering. Nothing is ever filtered out — the deck's own shipped rule.

   **Uncertainty is not proportion.** A job we are 40% sure was product management still contributes
   its *full* years to product management, and sinks in the deck. Only our confidence in the label
   is attenuated, never the length of the work.

   **The magnitudes — decided by the owner 2026-08-15, after #231 shipped the ordinal.** This
   decision originally pinned the shape and stopped, which left the numbers to whoever built it
   first; #231 proposed them and they are now confirmed as the owner's:

   | level | weight on the card's score |
   |---|---|
   | certain | ×1.0 |
   | likely | ×0.9 |
   | possible | ×0.75 |

   Confirmed against the worked case rather than in the abstract: an 80% card reads 72% at *likely*
   and 60% at *possible*, which in a deck clustering around 60–85% moves it out of the top handful.
   **That is the intent, not an accepted side effect** — the owner's own words: *"this is reflecting
   reality and a score that is meaningful, that's what I want as a user."* A future pass that
   softens these to make cards look better is reversing the decision, not tuning it.

   The attenuation's implementation lives in **#222**, not #231 — the ordinal is produced and stored
   by the labeler, but the only place a card is scored against a visitor's years in a family is the
   per-family arithmetic. #231 shipped the rule with no caller; #222 owns wiring it.

6. **A known zero is not an unknown.** Refines decision 5 of the original and corrects an
   acceptance criterion in #222. Falling back to the career total is right only when some of her
   years are genuinely unaccounted for — an `unmapped` job. When every job record is placed and none
   is in the advert's family, we **know** the answer is zero, and zero is what the scoring uses. The
   generous fallback exists to protect a person from being deleted by an unknown, not to tell them
   they are experienced in work they have never done.

7. **The target role follows the same rule.** It may hold several families, and it selects the
   *essential* items of each family's floor, de-duplicated. The cost is a longer discovery interview,
   accepted: a question not asked is evidence that cannot be recovered once she has left.

## What is deliberately not decided here

- **The target-role gate.** ~~Posting retrieval today hard-refuses an unmapped target role
  (`family_not_published`) and routes to family research.~~ **Decided in #230 (2026-08-15), exactly
  as the recorded intent below said it should be: when there is no usable published family floor,
  retrieval stops refusing and searches the words she typed, while discovery asks the floors of the
  families her **CV** proves — at most two, strongest by years first. She is never told any of it;
  a search that returns nothing shows the ordinary "no jobs found" state, which reports her own
  result and never our vocabulary. Spec: #233. Built in #234 (the two facts split apart), #235 (the
  word search opens) and #236 (the background family-candidate screen). What happens when a
  word-search deck runs out stays undecided and belongs to #228.**

  The gate was the one place "never discard, only rank" was not true, and it could not be, since
  the family is what we search *with*. The answer is not to rank the unrankable but to search
  something else — the closed vocabulary (decision 1) is permanent, so unmapped target roles are its
  permanent cost, and this is the permanent shape of paying it, not a stopgap.
- **The "new to this family" sentence.** A career changer with a known zero now ranks low and
  honestly, but is told nothing about why. The score stays generous and the words carry the truth —
  never the reverse. Own ticket.
- **What happens when a family's adverts run out** (#228).
- **The clustering engine.** Still has no ticket. The pilot path remains #218.

## Consequences

#222's acceptance criteria change: years are written per family with full credit to each, the
career-total fallback narrows to genuinely-unaccounted years, and no surface sums the families.
#221's end-of-deck family panel is deleted along with `needs_clarification`. #227 (an unmapped job
offered the whole published list) is largely dissolved by decision 1 — with nobody asked, there is
no list to offer — but its second half survives: a null placement is a call we have not made, and
belongs to a retry, not a question.
