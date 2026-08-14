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

4. **Asking the user is allowed only when the machine cannot work it out** — a genuine
   2+-family ambiguity or broken-looking data (a university name in the employer slot). It
   never asks to double-check a confident placement; the accuracy bar exists so it doesn't
   have to. All such questions land batched on the review-your-jobs screen, never mid-flow.

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
