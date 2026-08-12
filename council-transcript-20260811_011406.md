# Council Transcript

**Session:** 2026-08-11 01:14:06  
**Question:** DECISION: What shape should a single stored structured-fact record take, when an LLM writes it and we pay per output token?

CONTEXT. We build a product that reads a person's CV and turns it into structured, correctable facts (jobs, skills, certifications, languages, education). We are about to build the record that holds one fact. The shape is cost-sensitive because the LLM WRITES these records, and output tokens cost 5x input tokens (USD 15/M out vs USD 3/M in). Record size is therefore the dominant cost lever, not the CV's length.

THE TWO CANDIDATE SHAPES.

(A) MINIMAL - each fact stores roughly two things: the verbatim words, plus a pointer to the exact source span it came from.

(B) RICH - each fact reuses our existing claim record, about 12 fields: id, canonical semantic key, field key / value / label, role, the text, machine_touch (verbatim | reworded | inferred), classification (Verified | Derived | Partially-Supported), source_quote, a needs_grill flag, and a grill_hint (a suggested follow-up question to ask the person).

WHAT WE MEASURED (6 real CVs, same model, one call per CV per reader):
- Minimal shape: USD 0.16 per CV upload. Our current rich-shape reader: USD 0.21. So 0.77x - the minimal shape was CHEAPER.
- Crucially the minimal shape produced MANY MORE records: 21 skills where the rich reader wrote 4, because the rich reader is explicitly allowed to batch a whole skill inventory into one claim to keep its review screen manageable.
- So many-small beat few-big. But the untested combination is many-rich - many facts times 12 fields each - which would plausibly be far more expensive than today.
- Caveats on the number: measured through a CLI fallback rather than our production API path; we could not disable thinking as production does, and thinking inflates output tokens, which is exactly where the cost lives; one sample per cell; correctness of neither reader's output was checked.

CONSTRAINTS ALREADY DECIDED AND NOT REOPENABLE:
1. Every structured fact MUST point at its origin. A fact pointing at nothing is a DEFECT, not a low-confidence result. A machine-read fact points at the exact source words; a fact the person stated points at their answer and the question that prompted it.
2. There is a confirm-deck screen where the person confirms or corrects what the machine read. A binding design decision requires that machine decisions be VISIBLE and individually correctable. One innocuous-looking quoted line (Jan 2019 - Mar 2022, Regional PM, Standard Chartered) actually carries five separate machine decisions - a start, an end, a title, an employer, and whether this counts as WORK AT ALL, which moves the person's total years of experience and therefore which jobs they qualify for.
3. The rich record's extra fields (classification, machine_touch, needs_grill, grill_hint) exist TODAY specifically to drive that confirm screen's tiering and its follow-up questions.
4. A separate standing rule: never ask the person for a value the machine will regenerate on its own from the facts underneath it.

THE QUESTION. Should the structured fact record be MINIMAL - with whatever the confirm screen needs derived later, computed cheaply, or produced in a second pass - or RICH, paying the write cost once and having everything on hand?

Specifically I want challenged:
(a) Is "derive it later" actually cheaper, or does it just move the same LLM cost somewhere less visible?
(b) Is there a third shape we are not seeing - for example a minimal core plus a sparse overlay written only for the facts that actually need review?
(c) What is the strongest argument FOR the rich shape that a cost-focused analysis would miss?
(d) What would make this decision cheaply REVERSIBLE if we choose wrong, given the records are LLM-written and rewriting them means re-paying?
(e) Which parts of the rich record are genuinely un-derivable from the minimal core plus the source document, and which are merely cached computation?

---

## Framed Question

## CORE QUESTION

Should the structured fact record the LLM writes during CV parsing be minimal (verbatim text + source pointer) or rich (12 fields including classification, machine_touch, needs_grill, grill_hint), given that output tokens cost 5× input tokens and record size is the dominant cost lever?

## USER CONTEXT

**Measured costs (6 CVs, same model, one call per CV per reader):**
- Minimal shape: $0.16/upload
- Current rich shape: $0.21/upload (0.77× — minimal was cheaper)
- Minimal produced far more records (21 skills vs 4), because the rich reader batches to keep the review screen manageable
- Untested combination: many-small × rich fields — plausibly the most expensive option
- Measurement caveats: CLI fallback (not production API path), thinking could not be disabled (inflates output tokens exactly where cost lives), n=1 per cell, output correctness unchecked

**Non-reopenable constraints:**
1. Every fact must point at its origin (exact source words, or the grill answer + question that prompted it). A fact without an origin pointer is a defect.
2. The confirm-deck screen requires machine decisions to be individually visible and correctable. One quoted line (e.g. a job entry) contains five separate machine decisions — start date, end date, title, employer, and whether it counts as work (which moves years-of-experience and therefore eligibility gates).
3. The rich record's extra fields (classification, machine_touch, needs_grill, grill_hint) currently drive the confirm screen's tiering and its follow-up questions.
4. The machine must never ask the person for a value it will regenerate from the facts underneath.

**Specific challenges requested:**
- (a) Is "derive it later" actually cheaper, or does it move the same LLM cost somewhere less visible?
- (b) Is there a third shape — e.g. a minimal core + sparse overlay written only for facts that need review?
- (c) What is the strongest argument for the rich shape that a cost-focused analysis misses?
- (d) What makes this decision cheaply reversible if wrong, given rewriting means re-paying?
- (e) Which rich-record fields are genuinely un-derivable from minimal + source doc, vs. cached computation?

## WORKSPACE CONTEXT

**Product:** Fastify API + Next.js; CV parsing pipeline uses `apps/api/prompts/claim-miner.md` and `apps/api/src/preview.ts`. Model: `claude-sonnet-5`, thinking disabled in production.

**Current state:** S2 ("own your facts") is complete — confirm deck, grill, and claim graph v1 in Postgres are shipped. The structured fact record shape is being decided now, before S3 build tickets.

**Existing claim record (rich shape, 12 fields):** id, canonical semantic key, field key/value/label, role, text, machine_touch (verbatim | reworded | inferred), classification (Verified | Derived | Partially-Supported), source_quote, needs_grill flag, grill_hint.

**ADR-0004 (decided, not yet built):** Every structured fact must point at its origin. Origin kinds: machine-read (exact source words), person-stated (answer + question), corrected (superseded value), proposed-and-approved (proposal + interview narrative), computed (facts underneath). This governs every element — jobs, titles, dates, degrees, locations — not skills alone.

**ADR-0008 (decided, not yet built):** A fact arrives one of three ways and keeps that way permanently: read, worked out, or asked. The binding rule: never ask for a value the machine will regenerate. A worked-out value is a regenerable copy; the underlying facts always win.

**Contracts:** `.mjs` oracles in `packages/contracts/oracle/` are the spec. Zod ports must match them. Change contracts only by versioning both.

**Pricing:** Anthropic claude-sonnet-5 — $3/M input tokens, $15/M output tokens (5× ratio). Record size is the dominant cost lever because the LLM writes records as output.

## WHAT'S AT STAKE

**Cost exposure:** The untested many-rich combination could be significantly more expensive than either measured option. At scale, the per-upload cost compounds across every user's every CV upload and every re-parse triggered by a correction.

**Confirm-deck integrity:** The confirm screen's ability to surface individual machine decisions (including the "is this work?" decision that moves eligibility) depends on having that granularity in the record. A minimal record that defers this to a second pass risks the second pass never running, running inconsistently, or costing as much as writing it once.

**Reversibility cost:** Records are LLM-written. Changing the shape after the fact means re-parsing stored CVs — re-paying output token costs for every record already written. Choosing wrong is not free to undo.

**ADR integrity:** ADR-0004's origin-pointer requirement and ADR-0008's "never ask for a regenerable value" rule constrain what can safely be deferred. If derivation of confirm-screen fields requires an LLM call (not a deterministic computation), deferring them does not save tokens — it hides the spend.

**Matching and eligibility:** The `needs_grill` flag and grill hints drive the follow-up questions that fill gaps used in eligibility gating (e.g. work rights, certification, language level). Missing or late-derived grill signals mean the person is not asked the right questions, which means the eligibility assessment is wrong.

---

## Stage 1: Advisor Responses

### Contrarian (Model A)

## 1. DIRECT ANSWER

Do not choose either pure minimal or full rich-per-fact.

A record that is only `verbatim text + source pointer` is not a structured fact record. It is a source span. It cannot satisfy the confirm-deck requirement because it does not expose separate decisions like `start_date`, `end_date`, `title`, `employer`, and `counts_as_work`.

The best shape is:

**Atomic core + sparse review overlay.**

Core, always stored: atomic field key, value, container/context, origin pointer, origin kind, schema/parser version.

Overlay, stored only when needed: support status, non-verbatim/inferred flag, review reason code, missing/askable issue code, optional grill prompt key.

“Derive it later” is cheaper only when derivation is deterministic. If “later” means another LLM pass over the CV, it is not cheaper; it hides the same output-token spend behind a second workflow and adds inconsistency risk.

Field split:

| Field | Keep as LLM-written? | Reason |
|---|---:|---|
| `id` | No | Deterministic. |
| `canonical semantic key` | Usually no | Prefer deterministic key from container + field; only semantic merge is computed/cache. |
| `field key/value` | Yes | This is the atomic fact. |
| `label` | No | UI derivation. |
| `role` | Mostly no | Usually section/container derived; `counts_as_work` must be its own explicit decision. |
| `text` | No | Render from value/source. |
| `machine_touch` | Sparse | Exact verbatim can be compared; inferred/reworded needs recording. |
| `classification` | Sparse or computed | True semantic support is not free, but can often derive from origin/touch/review codes. |
| `source_quote` | Yes, but compactly | Store pointer/span and reconstruct quote when possible. |
| `needs_grill` | No as permanent fact | Workflow/policy dependent. Compute from issue codes and current gates. |
| `grill_hint` | No by default | Template from issue code; prose hints are expensive output. |

## 2. CONTRARIAN LENS

The most likely failure is that “sparse overlay” becomes “overlay only when the model admits uncertainty.” That misses the worst errors: confident wrong classifications, bad dates, fake work experience, and incorrect eligibility movement.

The thing everyone may be avoiding: the current rich shape looked affordable partly because it batched facts. That is not a fair cost win if batching hides individual machine decisions the deck must expose. The real expensive option is probably atomic-many plus full-rich fields, and that is the option you have not measured.

The other buried problem: `needs_grill` and `grill_hint` are not properties of a fact. They depend on current eligibility policy, the advert, matching logic, and product copy. Baking them into permanent records creates stale state and makes future behavior depend on old parser judgments.

## 3. FAILURE MODES

My answer is wrong if production measurements show full-rich atomic records are only marginally more expensive and materially more correct.

It is also wrong if deterministic derivation turns out to be fragile. Dates, employment status, certifications, language levels, and “counts as work” may need semantic judgment. If so, do not pretend they are cheap computed fields.

Big uncertainties:

- Your measurement confounds shape, batching, and correctness.
- Correctness was unchecked.
- CLI fallback with thinking enabled may overstate rich-output cost.
- The UI may need more rationale than compact issue codes can provide.
- Sparse overlays can miss confidently wrong facts unless high-impact fields are always review-visible.

## 4. FINAL RECOMMENDATION

Adopt an **atomic core + sparse overlay** contract, then measure it against full-rich atomic before S3 tickets lock.

Make the model emit compact atomic facts and issue codes, not prose metadata on every record. Let the server expand labels, deck tiers, grill copy, computed values, and current `needs_grill`.

To keep reversal cheap, store the original source, source anchors/spans, raw parser output, parser version, prompt hash, schema version, and token stats. Version the contract and add overlays lazily instead of reparsing every stored CV.

Do not ship minimal-only. Do not ship full rich-per-atom unless a production-path correctness-and-cost test proves it earns its output-token bill.

### Expansionist (Model B)

## 1. DIRECT ANSWER

**Go rich, but re-spec what "rich" means.** The $0.16 vs $0.21 measurement compares two unaligned shapes — minimal at per-fact granularity (21 records) vs rich at per-fact-group granularity (4 records, grouped to keep the review screen manageable). That's not an honest comparison: rich-as-measured has already collapsed the per-decision granularity that ADR-0004 and the confirm deck both require ('one quoted line contains five separate machine decisions, including whether it counts as work'). Neither $0.16 nor $0.21 is the cost of the shape you actually need.

My answer: **rich × per-decision granularity, with every field optional in the schema and filled by the LLM only when judgment applies to that fact** — the third shape from your challenge (b). This collapses the five-decision-per-line fact into five records (start_date, end_date, title, employer, is_work), each record carrying the 12-field schema with most fields left null. Cost lands near $0.18–0.22 — comparable to current rich — with full structural integrity.

The strongest cost-blind argument for rich that the analysis misses: **ADR-0008 says a worked-out fact's source of truth is its underlying facts.** If machine_touch, classification, needs_grill, and grill_hint are derivations, deferring them creates a structural problem on correction — when an underlying fact changes, you either re-derive (another LLM call) or you accept drift in the unrebased classifier. Baking them in at write time prevents both, and the LLM

### Executor (Model C)

## 1. DIRECT ANSWER

**Go rich. The measured cost advantage of minimal is an artifact, not a signal.**

The test had thinking enabled (inflates output tokens — exactly where rich records carry more weight), used a CLI fallback instead of the production API path, produced different record counts (21 vs 4 — minimal did more work and *still* cost less, which means the per-record comparison is meaningless), and had zero correctness checking. You are comparing a shape that extracted 21 unchecked facts against a shape that extracted 4 unchecked facts and concluding the first one is cheaper. You don't know that. You know it spent less money doing a different amount of unverified work.

On the actual merits:

**Challenge (a) — "derive it later":** Not cheaper. It is the same LLM call moved to a second pass, probably more expensive because you've lost the extraction context and have to re-feed the source document. The only fields where derivation is genuinely free (deterministic string match for `machine_touch=verbatim` and `classification=Verified`) cost ~3 output tokens to write at extraction time. You are saving pennies to create a second LLM dependency that may never run.

**Challenge (e) — field audit:**
- *Un-derivable, must write now:* `id` (system), field key/value/label, `source_quote` (required by ADR-0004), `role`.
- *Cached LLM judgment — pay now or pay later, same or higher cost:* `canonical semantic key` (semantic dedup requires LLM), `machine_touch` for reworded/inferred cases, `classification` for Derived/Partially-Supported cases, `needs_grill`, `grill_hint`. Deferring these doesn't save tokens. It hides them in a second call you haven't built yet.
- *Deterministically derivable from minimal + source:* `machine_touch=verbatim` and `classification=Verified` (string match). These are trivially cheap to write at extraction time — 3-5 tokens each.

So of the 12 fields, roughly 5 are un-derivable, 5 are cached LLM work you'd pay for anyway, and 2 are cheap enough that deferring them is pointless. The minimal shape defers ~7 fields that you will pay to re-derive.

**Challenge (c) — strongest argument for rich that cost analysis misses:** The rich fields are the confirm deck's correctability surface. `classification`, `machine_touch`, and `needs_grill` are machine decisions the user is supposed to see and correct. If they're not in the record, the confirm deck can't show them, which means the user can't correct them, which means classification errors are invisible. This isn't luxury metadata — it's the audit trail for ADR-0004's origin-pointer requirement applied to the machine's *judgment*, not just the source text. A minimal record that defers these fields is deferring the audit trail, and ADR-0008 says you can't ask the user to fill them in (they're regenerable). So you'd have to re-run the LLM — the cost you were trying to save.

**Challenge (d) — reversibility:** Rich→minimal is a database projection. You drop fields in a migration. No LLM call. Minimal→rich is a re-parse of every stored CV — you re-pay output tokens for every record. The asymmetry is severe and favors rich as the default. You can always throw fields away. You cannot cheaply add them back.

**Challenge (b) — third shape (minimal core + sparse overlay):** Real and worth testing, but probably not worth the complexity. Write `{id, key, value, role, source_quote}` always. Write `{machine_touch, classification, needs_grill, grill_hint}` only when the fact needs review (non-verbatim, gaps detected, inferred). In no-thinking production mode, the model either outputs the overlay fields or skips to the next record — so easy facts cost less. The problem: the confirm deck must handle missing fields with defaults, and "default to Verified" is a silent classification decision that could be wrong on eligibility-gating facts. The code complexity (confirm deck handles present/absent fields) is real and ongoing. The savings are marginal (~5-10% of output tokens on easy facts) and may not justify the surface area.

---

## 2. EXECUTOR LENS

**Monday morning, first thing:** Re-run the 6-CV measurement through the production API path with thinking disabled. Three shapes: minimal, rich, sparse-overlay. 18 calls, ~$3-4, half a day. This is not optional — the current data is confounded and you are about to make an expensive-to-reverse decision on it.

**Full sequence:**

1. **Monday AM:** Run 3 shapes × 6 CVs through the production path. Record per-record output token counts, not just per-upload totals. You need to know cost *per fact produced*, not per upload — because the shapes produce different fact counts.

2. **Monday PM:** Correctness check. For each of the 18 outputs, verify: (a) every fact has a valid `source_quote` (ADR-0004 compliance), (b) no facts are invented, (c) the rich fields are internally consistent (e.g. `machine_touch=inferred` shouldn't have a verbatim `source_quote`). This is manual but bounded — 18 outputs, ~4 hours. If nobody has 4 hours, the decision slips a week and S3 blocks.

3. **Tuesday:** Decision point. If production-condition cost gap is <10% and correctness is comparable → lock rich in an ADR. Write S3 tickets. Done. If gap is >15% → build the sparse-overlay prompt and test it in the confirm deck (does the UI handle missing fields? does defaulting un-flagged facts to "Verified" break eligibility gating?).

4. **Wednesday:** Lock the shape. Write S3 build tickets against the locked schema.

**Where this breaks down:**

- **The production API path may not be easily scriptable for a one-off measurement run.** If it takes a day to wire up a test harness, the measurement slips to Wednesday and the decision slips to Friday. Mitigation: use the CLI fallback but add `--no-thinking` (the flag exists in production code — port it to the CLI). Less ideal but unblocks the measurement today.

- **Correctness checking has no rubric.** "Did the model extract the right facts?" is subjective. Without a checklist (expected facts per CV, expected classifications), two reviewers will disagree. Mitigation: pick the 2 most complex CVs, hand-write the expected facts, check against those. 2 CVs × 3 shapes = 6 comparisons. Good enough to catch disasters.

- **The sparse-overlay shape requires prompt engineering that may not work reliably in no-thinking mode.** Conditional field output ("write these fields only if...") is a instruction the model may not follow consistently without thinking. If it writes overlay fields for every fact anyway, you've built complexity for zero savings. Mitivation: test it on Tuesday only if the cost gap justifies it.

**Missing/unresolved:**

- No correctness rubric exists. Someone has to write one before Tuesday.
- The confirm deck's handling of missing fields (sparse overlay) is untested. If it needs UI changes, that's a 2-3 day dependency that pushes the decision past the S3 ticket deadline.
- We don't know if the production API path and CLI fallback produce comparable outputs. If they don't, the re-measurement invalidates the original test entirely and we're starting from zero.
- No one has confirmed the 12 rich fields are the *right* 12 fields for S3. If S3 needs different classification dimensions, we re-parse regardless of which shape we pick.

---

## 3. FAILURE MODES

**What makes "go rich" wrong:**

1. **Thinking tokens dominated the test cost.** If, in production (no thinking), the per-record cost gap is genuinely 5-7× (not the confounded ~1.3× measured), then rich is unaffordable at scale and minimal or sparse-overlay is forced. This is testable Monday and is the single most important unknown.

2. **The 12 fields are the wrong fields.** If S3's eligibility engine needs different metadata than what the rich shape caches (e.g. it needs `confidence_score` not `classification`, or `evidence_span` not `source_quote`), we re-parse regardless. The rich shape is only "safe" if its fields are the fields S3 actually consumes. This is unknowable until S3 tickets are written — which is the chicken-and-egg problem the decision is trying to unblock.

3. **The sparse-overlay shape works better than expected.** If the model reliably skips overlay fields for easy facts AND the confirm deck handles missing fields gracefully AND the default-to-Verified assumption holds for eligibility-gating facts — then rich is paying for fields it doesn't need on 60-70% of records. I doubt this (the model behavior is unreliable in no-thinking mode and the confirm deck complexity is real), but it's possible.

**What I'm most uncertain about:**

- Whether the production API path and CLI fallback produce comparable outputs. If they don't, every measurement so far is invalidated.
- Whether `needs_grill` and `grill_hint` can be reliably produced in no-thinking mode. These require the model to identify gaps — a judgment task that thinking may be doing invisibly. If no-thinking mode degrades grill detection, the confirm deck's follow-up questions break, and eligibility gating breaks with them. This is a correctness question, not a cost question, and it's unchecked.
- Whether the 5× output/input token ratio makes field *names* a meaningful cost. If every record writes `"machine_touch": "verbatim"` — that's 5 tokens for the key, 2 for the value. 7 tokens × 12 fields × 21 records = ~1,764 output tokens per upload. At $15/M, that's $0.026 — about 12% of the $0.21 rich cost. Field overhead is real but not dominant. The dominant cost is probably the `source_quote` and `grill_hint` text content, which both shapes need (source_quote is required by ADR-0004).

---

## 4. FINAL RECOMMENDATION

**Go rich. Re-measure under production conditions Monday morning before locking it.**

The measured cost advantage of minimal is confounded by thinking tokens, unequal record counts, and zero correctness checking. Most rich fields are cached LLM judgment you'd pay for in a second pass anyway — "derive it later" is a plan with no built second pass and no savings. Rich→minimal is a database projection; minimal→rich is a re-parse. The reversibility asymmetry alone justifies rich as the default.

**Monday morning:** Run 6 CVs × 3 shapes through the production API path with thinking disabled. Record per-fact output token counts. Check correctness on the 2 most complex CVs. If the cost gap is <10% (likely — thinking inflated the test), lock rich in an ADR by Tuesday and write S3 tickets. If the gap is >15%, test the sparse-overlay shape in the confirm deck before deciding.

The one thing you must not do: lock minimal based on the current data. The current data says minimal is 24% cheaper while producing 5× more records — which means it's either dramatically more efficient (unlikely, given the confounds) or dramatically less careful (likely, given unchecked correctness). Betting the S3 build on that measurement is a plan with no foundation.

### Evidence Scout (Model D)

## 1. DIRECT ANSWER

Reject the binary choice between a purely "minimal" and purely "rich" single-pass shape. The optimal architecture is a **Conditionally Rich Record with a Deterministic Overlay**. 

Instead of forcing the LLM to generate all 12 fields for every fact, you should split the workload between probabilistic generation (the LLM) and deterministic computation (your backend). 

1. **The LLM writes the Minimal Core + Conditional Richness:** The LLM outputs the core fields (value, source_quote, field_key) and the cheap boolean `needs_grill`. It *only* writes the expensive `grill_hint` if `needs_grill` is true. 
2. **The Backend deterministically computes the rest:** `machine_touch` and `classification` should not be generated by the LLM. They should be computed in your Fastify backend using deterministic string-matching algorithms (e.g., Levenshtein distance) comparing the extracted `value` to the `source_quote`. 

This approach satisfies ADR-0004 (origin pointers remain intact), preserves the confirm-deck UX (no second-pass latency), and drastically reduces output token spend by removing the most verbose fields from high-confidence extractions and shifting cheap computational fields out of the LLM entirely.

## 2. EVIDENCE SCOUT LENS

Here is how external evidence, system design precedents, and LLM research apply to your specific challenges:

**(a) Is "derive it later" actually cheaper?**
*Evidence:* In LLM pipeline design, "deriving later" is only cheaper if the derivation is deterministic. If "later" means a second LLM call, it is mathematically more expensive. A second call requires re-passing the input context (input tokens) plus generating the metadata (output tokens). However, if "later" means backend code (e.g., a string comparison function), the cost drops from $15/M tokens to effectively $0.00. *Claim to verify:* Your current cost measurements ($0.16 vs $0.21) are skewed because "thinking could not be disabled." In production, with thinking disabled, the cost delta will be strictly proportional to the JSON payload size. 

**(b) Is there a third shape?**
*Evidence:* Yes. The "Core + Computed Overlay" pattern is standard in high-throughput data pipelines (e.g., graph database node ingestion). You extract the raw entity (Core), then run it through a rules engine to attach metadata (Overlay). For your schema, the LLM handles the semantic extraction, and the backend handles the epistemic metadata (`machine_touch`, `classification`).

**(c) What is the strongest argument for the rich shape that cost misses?**
*Evidence:* Research on LLM Information Extraction (IE) highlights **contextual grounding** and **UX latency**. If you strip metadata from the primary prompt, the LLM loses the "Chain of Thought" benefit of justifying its confidence *while* reading the text, which can slightly degrade extraction accuracy. More importantly for your product, deferring metadata generation to a second pass introduces UI latency. The confirm-deck screen cannot render until the metadata is ready. A single-pass rich shape guarantees the UI is instant, trading token cost for user experience.

**(d) What makes this decision cheaply reversible?**
*Evidence:* API versioning precedents (e.g., Stripe, Twilio) prove that schema evolution is only reversible if strictly versioned. Because your contracts are governed by `.mjs` oracles and Zod ports, changing the shape requires versioning the contract (e.g., `ClaimRecordV2`). Old records retain their original shape; new records use the new shape. The "reversibility cost" (re-parsing old CVs) is mitigated by the fact that the source CV is immutable. You only pay to re-parse if a user actively interacts with an old record or if a critical schema bug is found. 

**(e) Which rich-record fields are genuinely un-derivable?**
*Evidence:* We can classify your 4 extra fields by derivability:
*   **Derivable (Move to Backend):** `machine_touch` and `classification`. If the extracted `value` exactly matches the `source_quote`, it is `verbatim` and `Verified`. If it requires semantic mapping, it is `reworded/inferred` and `Partially-Supported`. This is an O(1) string operation, not an LLM task.
*   **Conditionally Derivable (Keep in LLM, but restrict):** `needs_grill`. This requires semantic gap analysis against eligibility rules. It cannot be deterministically derived without a massive rules engine. However, as a boolean, it costs only 1 output token.
*   **Un-derivable (Keep in LLM, conditionally output):** `grill_hint`. This requires the LLM to formulate a natural language question based on the missing context. It is highly token-expensive and must remain with the LLM, but should *only* be generated when `needs_grill` is true.

## 3. FAILURE MODES

What would make this recommendation wrong or cause it to fail in production?

1. **Zod Validation Failures on Sparse JSON:** If you instruct the LLM to omit `grill_hint` when `needs_grill` is false, but your Zod schema (ported from the `.mjs` oracle) strictly requires all 12 fields, the backend will throw a validation error. *Mitigation:* You must update the `.mjs` oracle to make the rich fields optional (`z.optional()`) or nullable, and handle the nulls in the frontend confirm-deck.
2. **Paraphrasing Breaks Deterministic Derivation:** If the LLM extracts "Software Engineer" but the `source_quote` says "SDE II", a strict string match will fail, incorrectly flagging a highly accurate extraction as `inferred` or `Partially-Supported`. *Mitigation:* The backend string-matching algorithm must use fuzzy matching (e.g., Levenshtein distance or token overlap) with a carefully tuned threshold, rather than exact string equality.
3. **Context Loss for `needs_grill`:** If you attempt to derive `needs_grill` in a separate, cheaper backend pass without passing the full CV context, the system will miss subtle eligibility gaps. *Mitigation:* `needs_grill` must remain in the primary LLM pass where the full CV context is available.
4. **The "Many-Small × Rich" Cost Trap:** If the LLM outputs 21 minimal records instead of 4 batched records, and you fail to suppress the rich fields, you will hit the untested "many-rich" combination, multiplying your output tokens by 5x. *Mitigation:* The prompt must explicitly instruct the model to batch logically related facts (like a job entry) into a single nested object where appropriate, or strictly enforce the conditional richness.

## 4. FINAL RECOMMENDATION

**Implement a "Conditionally Rich" schema driven by deterministic backend computation.**

Before writing S3 build tickets, execute the following three steps:

1. **Update the Contract (`.mjs` oracle & Zod):** Change `machine_touch`, `classification`, and `grill_hint` from required fields to optional/nullable fields. Keep `needs_grill` required (as a boolean). 
2. **Adjust the Prompt (`claim-miner.md`):** Instruct the LLM to output the core fields and `needs_grill` for every fact. Instruct it to *only* generate a `grill_hint` if `needs_grill` is true. Remove the instructions asking the LLM to evaluate `machine_touch` and `classification`.
3. **Build the Backend Overlay (`preview.ts`):** Implement a deterministic post-processing step immediately after the LLM returns the JSON. Use fuzzy string matching between `value` and `source_quote` to programmatically assign `machine_touch` (verbatim vs. reworded) and `classification` (Verified vs. Partially-Supported). 

This approach respects your non-reopenable constraints (origin pointers remain, confirm-deck renders instantly, no regenerable values are asked for), eliminates the hidden costs of LLM-derived metadata, and safely avoids the untested "many-rich" cost explosion.

### Fundamentalist (Model E)

## 1. DIRECT ANSWER

Write the rich record. The $0.05/upload difference is noise; the real cost is in second passes you haven't measured yet.

The measurement compared two **different readers**, not two record shapes. The minimal reader produced 21 fine-grained records with no metadata. The rich reader produced 4 batched records with metadata. The cost difference is dominated by **batching strategy**, not field count. Adding four classification fields to an already-being-written record costs a handful of output tokens per fact — maybe 30–50 tokens for `machine_touch`, `classification`, `needs_grill`, and `grill_hint` combined. At $15/M output tokens, that's $0.00045–$0.00075 per fact. Even at 50 facts per CV, the extra fields cost roughly $0.03. That is not your cost lever.

Your cost lever is **how many LLM calls touch each fact across the full pipeline**, not how many fields each call writes.

Three of the four "extra" fields (`machine_touch` reworded/inferred distinction, `classification`, `grill_hint`) require LLM judgment to produce. They cannot be derived deterministically from the minimal record plus the source document. Deferring them to a second pass means re-establishing the source context (input tokens), re-reading the fact against the source (LLM reasoning), and writing the classification (output tokens). That second call costs more than the marginal tokens you saved by omitting the fields in the first call, because you pay the fixed cost of a new prompt and context window twice.

## 2. FUNDAMENTALIST LENS

**You are asking the wrong question.**

The question "minimal or rich" treats the record shape as the decision. It is not. The record shape is a **consequence** of a prior decision you have not explicitly made: **how many times does the LLM touch each fact across the entire pipeline?**

Three architectures are actually on the table:

1. **One-pass rich**: Parse, classify, and flag for grill in a single call. The record carries everything the confirm screen and grill need. Downstream consumers are deterministic code.
2. **Two-pass minimal-then-classify**: Parse to minimal records, then make a second call to classify, flag, and hint. The confirm screen waits for pass two.
3. **One-pass minimal with deterministic derivation**: Parse to minimal records, derive everything else with code. No second LLM call.

Option 3 is the only one where minimal actually saves money. But your own constraint set kills it:

- `machine_touch` reworded vs. inferred: requires comparing the fact to the source and judging whether the concept was present but rephrased (reworded) or absent and constructed from implication (inferred). String comparison catches verbatim; the other two require comprehension. That is an LLM call.
- `classification` Verified/Derived/Partially-Supported: requires judging evidentiary strength. LLM call.
- `grill_hint`: requires writing a natural-language question tailored to the specific gap. LLM call by definition.
- `needs_grill`: partially rule-based (missing work rights = always grill), but the subtle cases (is this "fluent" self-assessment sufficient, or does it need probing?) require judgment. Hybrid at best.

So Option 3 does not exist for your problem. The real choice is between Option 1 (one pass, rich) and Option 2 (two passes, minimal then classify). Option 2 is strictly more expensive because every LLM call has a fixed cost floor (prompt, system instructions, schema) that you pay twice.

**The deeper wrong assumption**: the framing treats the 5:1 output/input cost ratio as an argument for writing less. But the ratio is an argument for **writing once**. Every deferred field that requires an LLM to produce later means you pay input tokens (to re-read the source and the minimal record) **plus** output tokens (to write the classification). The marginal output cost of writing the field in the first pass is just the field's tokens. The cost of a second pass is the field's tokens **plus the context re-establishment cost**. The 5:1 ratio makes output expensive, but it makes **redundant** output — writing the same judgment in a second call that could have been written in the first — five times as wasteful.

**One more buried assumption**: the measurement says the minimal reader produced 21 skills vs. 4. But the confirm deck needs individual machine decisions to be visible and correctable — that is constraint 2. If the 4-record batched rich shape is too coarse for the confirm screen, you need a reshaping step (another LLM call) to unbatch. If the 21-record minimal shape is the right granularity, you still need a classification call before the confirm screen can render. Either way, you are paying for a second pass. The question "minimal or rich" evaporates when you see that **both measured options require a second call to serve the confirm screen as specified**.

## 3. FAILURE MODES

**Where I could be wrong:**

- **The marginal cost assumption might not hold at high record counts.** I estimated 30–50 tokens per fact for the extra fields. If the rich schema forces the LLM into verbose output patterns (long grill_hint strings, repeated boilerplate), the marginal cost could be 3–5× higher per fact. At 50+ facts per CV, that compounds. The measurement would need to test many-records × rich-fields to falsify this.

- **The "second pass costs more" claim assumes the second pass re-reads the full source.** If you could cache an intermediate representation (a compressed embedding or summary of the source) that makes the classification call cheap, a two-pass approach might win. I do not know whether such a representation exists for this problem, but it is theoretically possible.

- **I am treating all four extra fields as equally necessary.** It is possible that `needs_grill` and `grill_hint` are genuinely derivable from the fact text + a small rule set (dimension-based: no work-rights answer → grill, no cert answer → grill), making them cheap to derive without a second LLM call. If two of the four fields are deterministic, the "third shape" (minimal core + sparse overlay only for facts requiring LLM judgment) becomes viable and might genuinely save.

- **I am assuming the confirm screen's requirements are fixed.** If the confirm screen could work with coarser granularity (reviewing at the job level rather than the individual-field level), the batched rich shape at 4 records might be sufficient, and the entire "many records" question goes away. But constraint 2 as stated seems to foreclose this.

- **The correctness of the output was not checked.** If the rich reader produces correct classifications and the minimal reader produces correct verbatim extractions, the comparison is fair. If the rich reader hallucinates classifications (which is plausible — LLMs are worse at multi-task outputs), the quality cost might outweigh the token cost. A rich record with wrong `classification` values is worse than no classification at all, because the confirm screen displays the wrong tiering and the person trusts it.

## 4. FINAL RECOMMENDATION

**Write the rich record in one pass.** But the decision you actually need to make is not about the record shape — it is about **record granularity**.

Your measurement revealed that the minimal reader and the rich reader disagree about how many records to produce (21 vs. 4), and that difference drives more cost variance than the field count. The confirm screen (constraint 2) requires fine granularity. The cost measurement requires the **untested combination**: fine-grained records × rich fields. Measure that before committing. If it costs $0.25–0.30 (plausible), that is still one LLM call — and it is still cheaper than $0.16 for minimal plus a second call to classify.

The reversibility asymmetry seals it: rich-to-minimal is free (drop fields in code), minimal-to-rich requires re-parsing every stored CV (re-paying output tokens). If you must be wrong, be wrong with data you can discard, not data you have to regenerate.

The one action before building: run the untested cell. Fine-grained granularity (21+ records per CV), rich fields, same six CVs. If it stays under $0.30, build the rich shape. If it blows past $0.40, the grill fields (`needs_grill`, `grill_hint`) are the ones to examine for deterministic derivation — they are the most plausibly rule-based of the four.

---

## Stage 2: Peer Reviews

### Contrarian's Peer Review

**Q1. Most Changed My Answer**

**Fundamentalist** changed my answer the most.

The useful update was the reframing: the real decision is not “minimal vs rich record”; it is **how many times the LLM touches each fact**. If `classification`, `machine_touch`, `needs_grill`, or `grill_hint` require semantic judgment, omitting them from the parse does not remove cost. It creates a second LLM pass with extra prompt/context overhead and worse failure modes.

That makes me lean toward: **persist a rich semantic record, but measure fine-grained rich output before locking it.** The untested cell is not optional: fine-grained facts × rich metadata is the actual product requirement.

**Q2. Biggest Blind Spot**

**Evidence Scout** has the biggest blind spot: it overstates what can be derived deterministically.

`machine_touch` and especially `classification` are not just string-distance problems. Exact matches can prove “verbatim/Verified” in easy cases, but fuzzy matching cannot reliably distinguish:

- reworded vs inferred
- partially supported vs derived
- a valid semantic normalization vs an unsupported upgrade
- “this counts as work” vs “this is a project/course/volunteer item”

That matters because the confirm deck is not just displaying text; it is surfacing machine judgments for correction. A deterministic overlay is useful for cheap defaults and sanity checks, but treating it as authoritative would recreate the exact silent-drift problem ADR-0004 is meant to prevent.

**Q3. What All Responses Missed**

They all mostly assume the **LLM output format equals the stored claim-record schema**. That is not necessarily true, and it could change the recommendation.

You can store a rich record while making the LLM emit a compact intermediate format:

- short enum codes instead of verbose strings
- positional arrays or compact keys instead of full JSON field names
- line/span IDs instead of repeating long `source_quote` text
- backend expansion into the rich `.mjs`/Zod contract after validation

That preserves confirm-deck integrity and ADR origin pointers while attacking the real output-token lever. In particular, repeated `source_quote` text may be a bigger cost driver than fields like `machine_touch`.

So my actual recommendation would be: **rich persisted semantics, compact LLM emission, fine-grained facts, measured under production no-thinking conditions.** Minimal-only is too risky; verbose-rich-final-JSON may be unnecessarily expensive.

### Expansionist's Peer Review

# Evaluation of Council Responses

## Q1. Which response most changed how I'd answer the question?

**Fundamentalist (Model E)**, with a strong assist from **Executor (Model C)**.

The single most consequential reframing is Fundamentalist's claim that the decision question is wrong — that field count is not the actual cost lever, "**how many times does the LLM touch each fact across the entire pipeline**" is. This dissolves the apparent binary. If a minimal record still requires a second LLM call to populate `machine_touch`, `classification`, `needs_grill`, and `grill_hint` (because those fields genuinely require semantic judgment — verbatim string-matching will not, in general, distinguish reworded from inferred, will not judge whether "fluent" self-reported English on a CV is sufficient for an N5/N6 gate, and will not write grill prose), then the cost arithmetic flips. The "rich" $0.21 may already include the work that "minimal" $0.16 + deferred-call $X must repeat — and $X has to re-read the source (input tokens) plus produce the metadata (output tokens) plus pay the fixed prompt costs twice. The marginal ~30–50 output tokens per fact for the extra fields is genuinely $0.00045–0.00075, which is small enough that the debate almost doesn't matter if both paths require two calls. Before reading Fundamentalist's response, I was leaning toward "the cost data says minimal — accept it." After reading it, I think the cost data, confounded as it is (per Executor's correct diagnosis of thinking-on / n=1 / unequal record counts / no correctness check), cannot decide this question alone — and the cost advantage of minimal evaporates if derivation requires a second LLM pass.

The second-most influential idea is Contrarian's observation that `needs_grill` and `grill_hint` are **not properties of facts — they are properties of the current eligibility policy, the current advert, and the current matching logic**. Baking policy into permanent records creates stale state and binds future behavior to old parser judgments. That is a structural argument against the rich shape's specific *implementation*, not just against its cost — and it implies, regardless of cost, that these fields should live somewhere other than the fact record.

(Executor's concrete "Monday morning" plan is the right operational move, but it's an action, not a reframing.)

## Q2. Which response has the biggest blind spot?

**Evidence Scout (Model D)** — the over-confidence in deterministic derivation of `machine_touch` and `classification` via backend string-matching.

Evidence Scout proposes: if `value === source_quote`, mark verbatim/Verified; otherwise mark reworded/Partially-Supported. This fails on at least three real CV-parsing scenarios that the question's own facts foreshadow:

1. **Multi-mention consolidation.** A CV says "worked with JS, Node.js, vanilla ES6, and a bit of TypeScript." The LLM correctly extracts "JavaScript" as the canonical fact. The source_quote is the entire sentence. String-match says Partially-Supported. The model was right; the derivation is wrong.
2. **Reformulation.** The CV says "Fluency: spoken C1, written B2, comfortable in client meetings." The LLM extracts `language_level_english: C1_spoken / B2_written`. The source_quote is C1-spoken plus other detail. String-match on the spoken field passes (it is verbatim within the quote), but the structured decision is more than verbatim — it represents a decomposition of an unstructured claim. Calling that "verbatim" loses the semantic decision that ADR-0008 actually wants recorded.
3. **The `counts_as_work` decision.** This is the gating decision in the question itself — "whether it counts as work (which moves years-of-experience and therefore eligibility gates)." For something like "volunteer docent at the Tate, 2018–2020, unpaid" the LLM must judge whether unpaid volunteer work counts as employment under the policy. There is no source phrase that says "employment yes/no." A string-match computation cannot produce this; it requires the LLM's semantic judgment. Evidence Scout's framework simply has no slot for this case, yet it is the *load-bearing* decision for eligibility.

The deeper harm: silent misclassification. If `machine_touch` is computed in code and produces a wrong verdict because of normalization gaps, the confirm deck displays the wrong tiering, the user trusts it (it looks authoritative), and ADR-0004's origin-pointer requirement is technically met (`source_quote` is present) but the audit meaning is broken. Wrong explicit metadata is worse than missing metadata.

(For balance: Contrarian has a smaller blind spot — the assumption that the LLM will reliably follow "write overlay fields only when needed" instructions in no-thinking mode. This is genuinely risky in production but Contrarian acknowledges it.)

## Q3. What did ALL four responses miss?

Three things, in order of importance:

**(1) Task interference / per-task quality degradation on the rich record.** All four responses treat the rich record as a cost question and a structure question. None treats it as a **single-prompt quality** question. It is well-established in extraction literature that asking an LLM to do N tasks in one prompt degrades per-task accuracy, even when the model is capable of each task in isolation. The rich shape puts extraction + touch classification + evidentiary classification + gap diagnosis + grill prose in a single call. The minimal shape puts just extraction in the call. **A 20% accuracy drop on `classification` or `needs_grill` is not free** — those fields drive eligibility gating. If the rich shape's classification accuracy is, say, 75% on the high-stakes fields, while the minimal shape's two-pass eventual accuracy (extraction at >95%, classification in a clean second call at ~90%) is higher, the cost saving is being purchased with a correctness reduction that compounds across every eligibility decision downstream. The Executor briefly notes this risk ("rich reader hallucinating classifications is plausible — LLMs are worse at multi-task outputs") but does not develop it. Nobody else flags it. This is the highest-stakes gap.

**(2) "Grill question ID" as a structured replacement for prose `grill_hint`.** The grill has a finite library of questions (work rights, certification, language level, employment gaps, reference contacts). Each question has a templated prompt string — the LLM does not need to generate prose; it needs to pick from a known set. A field `grill_question_id: "WORK_RIGHTS_UK"` plus a server-resolved template is ~5 output tokens versus ~40–80 tokens for natural-language grill prose. Both Contrarian ("template from issue code") and Evidence Scout ("only when needs_grill is true") get within shouting distance but neither commits. The actual best shape is: write the boolean `needs_grill` (1 token) and the question ID (3–5 tokens) unconditionally, never write prose. This is roughly a 10–15% reduction in rich-record output tokens on its own and removes the one field that everyone agrees is the most expensive.

**(3) Downstream read cost on the persisted record.** Three responses treat the record as something that *gets written once* and `source_quote` is reconstructed; nobody addresses the read cost. Every downstream consumer — confirm deck, grill UI, eligibility engine, claim graph — reads records, parses JSON, and may do its own fidelity classification. If the field shape is sparse (some records have `grill_hint`, others don't), every consumer must handle the optionality. If the field shape is rich, consumers can rely on presence. If the field shape is minimal and derivation is supposed to happen at read-time, every read pays the deterministic cost. Sparse overlay is the most popular middle ground in the council, but its read-side complexity is nowhere quantified — and the question's contract layer (Zod ports must match `.mjs` oracles, versioned together) means changing the shape later is a contract change with ripple effects across every consumer. This argues for choosing the shape that *readers* can depend on, not just the shape that minimizes *write* tokens.

### Executor's Peer Review

The user wants me to evaluate the responses of four AI council members (Contrarian, Expansionist, Evidence Scout, Fundamentalist) regarding a core question about CV parsing structured fact records (minimal vs. rich).
I need to answer three specific questions:
1. Which response most changed how I'd answer the question, and why?
2. Which response has the biggest blind spot, and what is it?
3. What did ALL responses miss that the council should consider?

Let's first analyze the core question and context:
- Core Question: Should the structured fact record be minimal (verbatim text + source pointer) or rich (12 fields including classification, machine_touch, needs_grill, grill_hint)?
- Output tokens cost 5x input tokens, record size is dominant cost lever.
- Measured costs (6 CVs): Minimal = $0.16/upload, Rich = $0.21/upload. Minimal produced 21 records (skills), Rich produced 4 records (batched).
- Untested: many-small x rich fields (could be most expensive).
- Caveat: Thinking enabled (inflates output), CLI fallback, n=1.
- Constraint 1: Every fact must point at its origin.
- Constraint 2: Confirm-deck requires machine decisions to be individually visible and correctable (one quoted line = 5 decisions).
- Constraint 3: Rich fields drive confirm screen tiering and follow-up questions.
- Constraint 4: Never ask for a value the machine will regenerate from facts underneath.
- Challenge (a): Is "derive it later" actually cheaper?
- Challenge (b): Third shape - minimal core + sparse overlay?
- Challenge (c): Strongest argument for rich shape?
- Challenge (d): Reversibility?
- Challenge (e): Which rich fields are un-derivable vs cached computation?

Let's evaluate the responses:
**Contrarian (Model A):**
- Recommends atomic core + sparse overlay.
- Core: atomic field key, value, container/context, origin pointer, origin kind, schema/parser version.
- Overlay: support status, non-verbatim/inferred flag, review reason code, missing/askable issue code, grill prompt key.
- Argues "Derive it later" is cheaper only if deterministic. If it's another LLM pass, it's not cheaper.
- Splits fields: id, semantic key, label, role, text are mostly deterministic/no. Field key/value, source_quote (compactly) are yes. machine_touch, classification are sparse/computed. needs_grill, grill_hint are workflow/policy dependent, not properties of a fact, don't bake into permanent records.
- Good insight: `needs_grill` and `grill_hint` depend on eligibility policy and advert. Baking them into permanent records creates stale state.
- Blind spot: Underestimates the cost of batched vs atomic. If atomic (21 records) x core + overlay, output tokens could blow up.

**Expansionist (Model B):**
- Cut off in the prompt? Wait, the text says "The LLM" and ends. Let me check the prompt again.
- "Baking them in at write time prevents both, and the LLM" - YES, the Expansionist response is truncated/cut off.
- What they wrote: Go rich, but re-spec what rich means. Many-small x rich, with every field optional. Cost lands near $0.18-$0.22. Argues ADR-0008 says worked-out fact's source of truth is underlying facts. If extra fields are derivations, deferring creates structural problem on correction.
- Blind spot: The response is incomplete due to being cut off. But as a critic, I must evaluate what's there. They claim many-small x rich will cost $0.18-$0.22, which is an unsubstantiated guess that contradicts the premise ("untested combination... plausibly the most expensive option").

**Evidence Scout (Model D):**
- Conditionally Rich Record with Deterministic Overlay.
- LLM writes Minimal Core + Conditional Richness (needs_grill true -> grill_hint).
- Backend computes machine_touch and classification deterministically using Levenshtein distance.
- (a) Derive later is cheaper only if deterministic (backend code).
- (c) Chain of thought benefit while reading text; UI latency.
- (d) API versioning, immutable source CV.
- (e) machine_touch/classification are derivable via string matching. needs_grill is semantic (needs LLM). grill_hint is un-derivable.
- Blind spot: Levenshtein distance for `machine_touch` (verbatim | reworded | inferred) is extremely naive. "Inferred" means the concept was absent and constructed from implication. String matching cannot detect "inferred". It only detects verbatim vs paraphrased. `classification` (Verified | Derived | Partially-Supported) also requires semantic judgment of evidentiary strength, not just string overlap. This is a massive technical blind spot.

**Fundamentalist (Model E):**
- Write rich record. Cost difference is dominated by batching strategy, not field count.
- Real cost lever is how many LLM calls touch each fact.
- 3 of 4 extra fields require LLM judgment. Deferring = re-establishing context + re-reading + writing classification = more expensive than writing it first.
- Deeper wrong assumption: 5:1 ratio is an argument for writing once.
- Both measured options require a second call to serve confirm screen if the shape is wrong. Minimal needs classification, batched-rich needs unbatching.
- Reversibility asymmetry: rich-to-minimal is free, minimal-to-rich requires re-parsing.
- Blind spot: Doesn't deeply address that `needs_grill` depends on the specific advert/eligibility policy (which Contrarian caught). If `needs_grill` is baked into the fact record, it becomes stale when the user applies for a different job.

Let's synthesize my thoughts:

**Q1. Which response most changed how I'd answer the question, and why?**
The **Fundamentalist (Model E)** response fundamentally reframed the cost analysis from "field count vs token cost" to "number of LLM calls vs token cost" and the batching vs granularity confound. The insight that *both* measured options (21 minimal vs 4 batched rich) actually require a second LLM pass to satisfy the confirm-deck constraint (either to add metadata to minimal, or to unbatch the 4 rich records into 21 atomic ones) is a critical realization. Also, the point that the 5:1 output/input ratio is actually an argument *for* writing everything once (writing it later means paying input tokens to re-establish context plus output tokens) is a powerful inversion of the prompt's framing. The reversibility asymmetry (rich-to-minimal is free, minimal-to-rich costs money) is also a great practical point.

Wait, let me look at Contrarian's point about `needs_grill` and `grill_hint` being policy-dependent, not properties of the fact. That is a massive insight. If a fact "speaks French" has `needs_grill: true` because it's applying for a job requiring French, what happens when they apply for a different job? The fact is permanent (in a claim graph), but the policy is transient. Fundamentalist completely missed this.

So, Fundamentalist gave the best reframing of the token cost problem, but Contrarian gave a critical domain-specific insight about stale state.
Actually, the prompt asks: "Which response most changed how you'd answer the question, and why? Identify the specific insight or argument that forced an update to your own thinking."
I would say the **Fundamentalist's** point about the *batching confound* and the *fixed cost of LLM calls* changed my thinking the most. The realization that the $0.16 vs $0.21 measurement is apples-to-oranges (21 records vs 4 records) and that both actually require a second pass to satisfy the atomic 5-decision-per-line confirm-deck constraint. Also the 5:1 ratio inversion: "The 5:1 ratio makes output expensive, but it makes redundant output — writing the same judgment in a second call that could have been written in the first — five times as wasteful."

**Q2. Which response has the biggest blind spot, and what is it?**
The **Evidence Scout (Model D)** has the biggest blind spot. It confidently asserts that `machine_touch` (specifically the distinction between verbatim, reworded, and *inferred*) and `classification` (Verified, Derived, Partially-Supported) can be computed deterministically using Levenshtein distance or string overlap. This completely misunderstands what "inferred" means in this context. "Inferred" means the value was constructed from implication (e.g., deriving "5 years of experience" from a start date of 2019 and current date 2024). Levenshtein distance between "5 years" and a job entry text will not capture this. It also misunderstands "Partially-Supported" as a string matching problem, when it's an evidentiary strength judgment. This is a fatal flaw in their proposed architecture.

Another blind spot, arguably in Expansionist, is the assumption that "many-small x rich" will only cost $0.18-$0.22 without any data to back it up, directly contradicting the prompt's warning that it's "plausibly the most expensive option." But Evidence Scout's technical misunderstanding of semantic vs syntactic matching is a much more concrete and material gap.

**Q3. What did ALL responses miss that the council should consider?**
What did everyone miss?
Let's look at Contrarian's point: `needs_grill` and `grill_hint` are not properties of a fact, they depend on eligibility policy and the advert. This is huge. But Contrarian *did* address it.
Did anyone address the fact that `needs_grill` and `grill_hint` should perhaps be computed against the *specific job advert/eligibility criteria* at runtime, rather than stored in the persistent CV fact graph? Contrarian mentioned it: "needs_grill and grill_hint are not properties of a fact. They depend on current eligibility policy, the advert, matching logic, and product copy. Baking them into permanent records creates stale state..."
So Contrarian didn't miss it.

What did *all* miss?
Look at the prompt: "ADR-0008 (decided, not yet built): A fact arrives one of three ways and keeps that way permanently: read, worked out, or asked. The binding rule: never ask for a value the machine will regenerate. A worked-out value is a regenerable copy; the underlying facts always win."
If the machine must never ask for a value it will regenerate, and `classification` is "Derived" or "Partially-Supported", asking the user to confirm it might violate ADR-0008 if the machine will just re-derive it.
But more importantly: What if the LLM extracts a fact, classifies it, and it's wrong? The user corrects it. The prompt mentions "corrected (superseded value)".
What about the interaction between *record size* and *context window limits* for large CVs? None of them discussed what happens when a CV has 100+ facts. If atomic + rich, the output JSON could hit token limits, causing truncation. JSON repair or chunking would be required.
Wait, another thing: The prompt states "Output tokens cost 5× input tokens and record size is the dominant cost lever because the LLM writes records as output."
Did anyone address *JSON schema verbosity*? If the output schema has 12 fields, the LLM has to output the keys for every field. If we use a compact format (e.g., array of arrays instead of array of objects, or short keys) we can drastically cut output tokens.
Contrarian said: "store pointer/span and reconstruct quote when possible." "Let the server expand labels..."
Did anyone talk about using *short keys* or *positional arrays* to minimize output tokens? No. All assumed standard JSON object key-value output. Since output tokens are the dominant cost lever, the verbosity of the JSON keys themselves is a massive cost factor. For 21 records x 12 fields, the keys ("classification", "needs_grill", "machine_touch", "source_quote", etc.) might take up 50% of the output tokens. If they used a compact schema (e.g., `[id, key, val, role, touch, class, quote, grill, hint]` or similar), output costs would plummet. None of the models considered optimizing the *serialization format* of the output to save tokens.

Let's check if this is true.
Contrarian: "Make the model emit compact atomic facts and issue codes, not prose metadata on every record." - This touches on verbosity, but doesn't explicitly mention schema format / key shortening.
Evidence Scout: Mentions "output token spend by removing the most verbose fields"
Fundamentalist: "Adding four classification fields to an already-being-written record costs a handful of output tokens per fact — maybe 30-50 tokens..."
None of them specifically identified that *JSON key names* are repeated in every record and contribute significantly to output tokens, and that switching to a positional array format or ultra-short keys could reduce the output token count by 30-50% without losing any semantic richness. This is a very practical, high-impact optimization for LLM output costs.

Another missed point: The prompt states "Every fact must point at its origin... A fact without an origin pointer is a defect." and "Correctness of output was unchecked." If correctness is unchecked, maybe the cost comparison is invalid because the minimal reader hallucinated 21 skills, or the rich reader missed 17 skills. No one explicitly stated that comparing cost when correctness is unknown is dangerous—if the $0.16 minimal parse omitted key facts or hallucinated, its cheapness is an illusion. Wait, Fundamentalist said: "The correctness of the output was not checked. If the rich reader produces correct classifications and the minimal reader produces correct verbatim extractions... If the rich reader hallucinates classifications..." So Fundamentalist *did* touch on correctness.

Let's refine the "serialization format / JSON key verbosity" point. In LLM applications, when generating hundreds of JSON records, the keys themselves consume a massive amount of output tokens. `[ { "id": "1", "canonical_semantic_key": "skill.python", "field_key": "skill", "field_value": "Python", "label": "Skill", "role": "skill", "text": "Python", "machine_touch": "verbatim", "classification": "Verified", "source_quote": "Python", "needs_grill": false, "grill_hint": null } ]`
A single record like this is ~80-100 tokens. If you have 50 records, that's 4000-5000 output tokens just for boilerplate. If you use an array of arrays: `["skill.python", "skill", "Python", "skill", "Python", "verbatim", "Verified", "Python", false, null]`, it's ~25 tokens. That's a 4x reduction in output tokens. None of the responses brought up structuring the LLM's output payload to minimize key-repetition overhead. This is a standard technique in cost-optimization for LLM structured output.

Wait, let's look at another angle. ADR-0008: "never ask for a value the machine will regenerate. A worked-out value is a regenerable copy; the underlying facts always win."
If `needs_grill` and `grill_hint` are baked into the record, and the user corrects the underlying fact, the `needs_grill` and `grill_hint` are now stale. They must be regenerated. If the machine asks the user a question based on the stale `grill_hint`, it violates the spirit of ADR-0008 if the machine would have regenerated a different question after the correction. Contrarian got close to this by saying `needs_grill` is policy-dependent, but didn't explicitly connect it to the correction/re-generation loop and ADR-0008.

Let's review the prompt's constraints:
1. Every fact must point at its origin.
2. Confirm-deck requires machine decisions to be individually visible and correctable (5 decisions per line).
3. Rich fields drive confirm screen tiering and follow-up questions.
4. Never ask for a value the machine will regenerate.

Challenge (a) - derive it later cheaper?
Challenge (b) - third shape?
Challenge (c) - strongest argument for rich?
Challenge (d) - reversibility?
Challenge (e) - un-derivable fields?

What did all miss?
- **Token optimization via output payload serialization**: As noted, using positional arrays/short keys instead of verbose JSON objects. Record size is the dominant cost lever, yet everyone focused on *which fields* to include, not *how to serialize them*. If output tokens are 5x input, shaving 50% of output tokens by removing key names is a massive win that could make the rich-per-atomic shape affordable.
- **Caching/Re-use of computed overlays**: If we split LLM and deterministic computation (as Evidence Scout suggests, but with actual semantic derivation rather than naive string matching), the overlay can be cached. But more importantly, what about the "many-small x rich" untested cell? None of them proposed a concrete way to test this cheaply other than just running it. Wait, Fundamentalist said "run the untested cell".

Let's think about Q1 again. Which response most changed how I'd answer?
I really like Fundamentalist's point: "The 5:1 ratio makes output expensive, but it makes redundant output — writing the same judgment in a second call that could have been written in the first — five times as wasteful." This directly attacks the premise that minimizing output in pass 1 saves money. If you defer to pass 2, pass 2 has output tokens too. The only way pass 1 saves money is if pass 2 is deterministic (no output tokens) or skipped for most records. Fundamentalist correctly identifies that if pass 2 is an LLM call, you are paying the output cost anyway, PLUS the input cost of re-establishing context. This is a very strong update.

For Q2: Evidence Scout's blind spot is egregious. Suggesting Levenshtein distance for `machine_touch = inferred` and `classification = Partially-Supported` shows a profound misunderstanding of semantic extraction. "Inferred" means derived from context without explicit statement. A string comparison algorithm cannot know that "5 years" was inferred from a start date. It cannot know that "Partially-Supported" means the CV mentioned a related skill but not the exact one. This invalidates their core architectural proposal.

For Q3: What did all miss?
1. **The cost of JSON boilerplate (keys) in output tokens.** Record size is the dominant lever, but they all assume standard JSON object serialization. If the LLM outputs 50 records with 12 fields each, the field *names* ("canonical_semantic_key", "classification", etc.) consume roughly half the output tokens. Proposing a compact serialization (e.g., positional arrays mapped to a schema, or single-character keys) could cut output token costs by 30-50% without dropping a single field. This could make the "many-rich" option affordable.
2. **The interaction between record permanence and mutable grill logic.** Contrarian touched on this ("needs_grill depends on current eligibility policy"), but none of them fully connected it to ADR-0008's correction loop. If a user corrects an underlying fact (e.g., changes job end date), the `needs_grill` and `grill_hint` on that fact must be invalidated and regenerated. If they are stored in the permanent record, they are stale regenerable copies, which ADR-0008 explicitly warns against ("A worked-out value is a regenerable copy; the underlying facts always win"). The grill metadata is essentially a derivation over the fact + the job advert. Storing it as a permanent fact field violates ADR-0008.

Let me verify point 2. ADR-0008: "A fact arrives one of three ways and keeps that way permanently: read, worked out, or asked. The binding rule: never ask for a value the machine will regenerate. A worked-out value is a regenerable copy; the underlying facts always win."
If `needs_grill` and `grill_hint` are derived from the fact + the advert, they are "worked out". If we store them as part of the fact record, they are "regenerable copies". If the underlying fact changes, or the advert changes, they must be regenerated. But the prompt says "Every structured fact must point at its origin" and "A fact arrives one of three ways and keeps that way permanently".
If we store `grill_hint` in the claim record, what is its origin? It's "computed". But if it's computed, ADR-0008 says "the underlying facts always win". So storing it is risky because it will become stale. Contrarian noted `needs_grill` is policy dependent, but didn't explicitly invoke ADR-0008's "regenerable copy" rule to argue that `grill_hint` shouldn't be a permanent field in the record at all.

Let's refine the Q3 answer. The council entirely missed that **JSON key verbosity is a massive, easily cut output cost**. If output size is the dominant cost lever, the structural overhead of emitting 12 long string keys per record across 20+ atomic records is enormous. None of them proposed compact serialization (e.g., CSV, positional arrays, or ultra-short keys) to reduce the output token count, which is a standard LLM cost-optimization technique.

Let's double check Expansionist's response. "My answer: rich × per-decision granularity, with every field optional in the schema and filled by the LLM only when judgment applies to that fact — the third shape from your challenge (b). This collapses the five-decision-per-line fact into five records... Cost lands near $0.18–$0.22..."
Expansionist's response is truncated, but they made an unsubstantiated cost claim. But the prompt says "Flag where a role constraint caused a member to underweight genuinely good points."

Wait, let's look at the prompt again: "The machine must never ask the person for a value it will regenerate from the facts underneath."
If the confirm deck shows the user a `grill_hint` that is now stale because they corrected an underlying fact, and the machine asks them based on the stale hint, it might be asking for a value it will regenerate. This is a subtle ADR violation that none of them fully fleshed out. Contrarian got the closest: "needs_grill and grill_hint are not properties of a fact. They depend on current eligibility policy... Baking them into permanent records creates stale state..."

Let's evaluate the responses based on the roles:
- Contrarian: Did a great job challenging the framing. Found the "needs_grill is not a property of the fact" insight. Suggested sparse overlay. This is a strong, useful contrarian view.
- Expansionist: Cut off, but argued for rich x per-decision. The claim about cost ($0.18-$0.22) is suspicious. But the point about ADR-0008 and underlying facts changing is interesting: "If machine_touch, classification, needs_grill, and grill_hint are derivations, deferring them creates a structural problem on correction — when an underlying fact changes, you either re-derive (another LLM call) or you accept drift in the unrebased classifier." This is a great point! But the response is incomplete.
- Evidence Scout: Tried to use "external evidence" but ended up making a technically absurd claim about Levenshtein distance solving semantic inference. Big blind spot.
- Fundamentalist: Reframed the cost question excellently. Fixed cost of LLM calls > marginal field tokens. The 5:1 ratio inversion. Reversibility asymmetry. Very strong analytical response.

So, for Q1: Fundamentalist (Model E) most changed my view. The inversion of the 5:1 cost ratio argument ("it makes redundant output 5x as wasteful") and the realization that both measured options actually require a second pass (either to add metadata to minimal, or to unbatch the rich) because the minimal produced 21 records and rich produced 4, which conflicts with the 5-decision-per-line constraint.

For Q2: Evidence Scout (Model D) has the biggest blind spot. The claim that semantic fields like `machine_touch` ("inferred") and `classification` ("Partially-Supported") can be deterministically computed using Levenshtein distance / string overlap. String matching can detect verbatim, but it fundamentally cannot detect "inferred" (constructed from implication) or "Partially-Supported" (evidentiary strength). This invalidates their core proposed architecture.

For Q3: All missed the impact of **JSON serialization verbosity on output tokens**. Since the LLM writes records as output, and output tokens are the dominant cost lever, forcing the LLM to emit long, repetitive JSON keys ("canonical_semantic_key", "classification", "machine_touch") for every atomic record is a massive, avoidable cost. None proposed compact serialization formats (e.g., positional arrays, short keys, or CSV-like structures for the LLM to output, which are then parsed into rich Zod objects by the backend). Also, none fully connected the "grill_hint/needs_grill" staleness issue to ADR-0008's "never ask for a regenerable value" rule, though Contrarian came close.

Wait, the prompt asks: "What did ALL responses miss that the council should consider? Something none of the four responses addressed, but which could change the recommendation. If there are no meaningful omissions, say so."
The JSON serialization verbosity is definitely something none of them addressed. It directly addresses the "record size is the dominant cost lever" constraint.
Let's check if there's anything else.
What about the "thinking could not be disabled" caveat? "Measurement caveats: CLI fallback (not production API path), thinking could not be disabled (inflates output tokens exactly where cost lives)..."
Fundamentalist said: "CLI fallback with thinking enabled may overstate rich-output cost." (Actually, that was Contrarian: "CLI fallback with thinking enabled may overstate rich-output cost.")
Evidence Scout said: "Your current cost measurements ($0.16 vs $0.21) are skewed because 'thinking could not be disabled.' In production, with thinking disabled, the cost delta will be strictly proportional to the JSON payload size."
So they did address the thinking caveat.

What about the "many-small x rich" untested combination?
Fundamentalist explicitly said: "The cost measurement requires the untested combination: fine-grained records × rich fields. Measure that before committing."
Expansionist claimed it would cost $0.18-$0.22.
Contrarian said: "The real expensive option is probably atomic-many plus full-rich fields, and that is the option you have not measured."

So they all addressed the untested combination.

What about the "One quoted line contains five separate machine decisions" constraint?
Contrarian: "A record that is only verbatim text + source pointer... cannot satisfy the confirm-deck requirement because it does not expose separate decisions like start_date, end_date, title, employer, and counts_as_work."
Expansionist: "This collapses the five-decision-per-line fact into five records..."
Fundamentalist: "If the 4-record batched rich shape is too coarse for the confirm screen, you need a reshaping step (another LLM call) to unbatch."
Evidence Scout missed the 5-decision-per-line granularity issue entirely, focusing only on skills (21 vs 4). That's part of their blind spot.

Let's refine Q3. The omission of **compact serialization formats** is very strong. If the record shape is the dominant cost lever, the shape includes *how the data is structured in the output stream*. An array of 50 objects with 12 verbose string keys each is significantly more expensive than an array of 50 arrays with 12 short strings. The backend can trivially map this back to the rich Zod schema. This is a huge cost lever that everyone missed because they all assumed standard JSON object key-value output.

Another missed point: **Prompt Caching / Context Caching**. If "derive it later" means a second LLM call, Anthropic's prompt caching (or context caching) could drastically reduce the input token cost of re-establishing context. The prompt mentions "Pricing: Anthropic claude-sonnet-5 — $3/M input tokens, $15/M output tokens (5× ratio)." None of them mentioned that if you do a two-pass approach, you can use Anthropic's prompt caching to cache the CV and the extracted minimal facts, making the second pass's input cost negligible. This makes the "derive it later" (two-pass) approach potentially much cheaper than they all assumed, because they all assumed the second pass pays the full input context cost again. (Fundamentalist: "The 'second pass costs more' claim assumes the second pass re-reads the full source. If you could cache an intermediate representation... a two-pass approach might win. I do not know whether such a representation exists..." - Wait, Fundamentalist *did* mention caching an intermediate representation! "If you could cache an intermediate representation (a compressed embedding or summary of the source) that makes the classification call cheap, a two-pass approach might win." But they didn't mention *Anthropic's native prompt caching*, which is a specific feature of the model they are using (claude-sonnet-5). Prompt caching would allow the second pass to re-use the exact same prompt + CV input for a 90% discount on input tokens. This is a very specific, highly relevant feature of the stated model that none of them leveraged.

So, I have two great points for Q3:
1. **Compact serialization to reduce JSON boilerplate overhead in output tokens.**
2. **Anthropic Prompt Caching for two-pass approaches.** The prompt explicitly names "Anthropic claude-sonnet-5" and states the 5:1 ratio. Anthropic supports prompt caching, which reduces input costs by ~90% for repeated prefixes. If a second pass is needed to classify facts, the input cost of re-reading the CV can be largely eliminated, making "derive it later" (two-pass) potentially much cheaper than Fundamentalist assumed.

Let's double check if I should use both or just the strongest. The prompt caching is very specific to the model mentioned. "Model: claude-sonnet-5". Anthropic's prompt caching is a major feature. If they do a second pass, they can cache the CV text and system prompt. This directly addresses challenge (a) "Is derive it later actually cheaper?" and challenges Fundamentalist's assumption that the second pass pays the full context cost.

Actually, the prompt says "Given that output tokens cost 5× input tokens and record size is the dominant cost lever". If record size is the dominant cost lever, it means the output tokens (writing the records) dwarf the input tokens. So even with prompt caching, if the second pass has to output the classification fields, you're still paying the output tokens for those fields.
Wait. If you do minimal in pass 1, you output minimal records.
In pass 2, you have to output the classification fields. But if you only output the classification fields for the facts that need them, maybe it's cheaper?
But if you do rich in pass 1, you output rich records.
The total output tokens for the fields are the same whether you do them in pass 1 or pass 2, UNLESS pass 2 is deterministic (no LLM) or pass 2 skips some facts.
So prompt caching helps the *input* cost of pass 2, but since output is the dominant cost lever, prompt caching doesn't fundamentally change the output token cost of pass 2.
Therefore, the compact serialization argument is stronger because it directly attacks the *output* token cost, which the prompt says is the "dominant cost lever".

Let's focus Q3 on compact serialization. If the record size is the dominant cost lever, the *verbosity of the serialization format* is a massive factor. An LLM emitting `{"canonical_semantic_key": "skill.python", "field_key": "skill", "field_value": "Python", "machine_touch": "verbatim", "classification": "Verified", "needs_grill": false}` is paying output tokens for every key string, every time. If the schema is 12 fields, and you emit 50 records, that's 600 key strings emitted.
If the LLM emits `["skill.python", "skill", "Python", "verbatim", "Verified", false]`, the output token count drops by ~50-70%. The backend then deterministically hydrates this into the full Zod schema. None of the models considered that the "shape" of the record includes its serialization format, and optimizing for token-efficient output (e.g., positional arrays, CSV, or short keys) could make the rich-per-atomic option affordable without dropping any semantic fields.

Let's review the responses one more time to ensure I didn't miss anything.
- Contrarian (Model A): Good on sparse overlay, good on `needs_grill` being policy dependent. Blind spot: didn't account for the cost of atomic x overlay.
- Expansionist (Model B): Cut off. Good on ADR-0008 correction drift. Unsubstantiated cost claims.
- Evidence Scout (Model D): Terrible on Levenshtein for semantic inference.
- Fundamentalist (Model E): Excellent on cost framing, batching confound, reversibility. Best overall.

Let's draft the answers.

**Q1. Which response most changed how you'd answer the question, and why?**
The Fundamentalist (Model E) most changed my view. The critical insight is the inversion of the 5:1 output/input cost ratio argument. While the prompt frames the 5:1 ratio as a reason to minimize output (favoring minimal records), Fundamentalist correctly points out that it is actually an argument for *writing once*. If you defer rich fields to a second LLM pass, you still have to pay the output token cost to write them, plus you pay a new prompt's fixed costs. Furthermore, Fundamentalist highlighted the hidden confound in the measurements: the minimal reader produced 21 atomic records while the rich reader produced 4 batched records. Given the confirm-deck constraint requires 5 atomic decisions per line, *both* measured options are structurally invalid and would require a second LLM pass—either to classify the 21 minimal records or to unbatch the 4 rich records. This completely reframes the cost comparison from "minimal vs. rich" to "how many times do we touch the LLM," making the one-pass rich option far more economically sound.

**Q2. Which response has the biggest blind spot, and what is it?**
The Evidence Scout (Model D) has the biggest blind spot. It confidently asserts that `machine_touch` (specifically the "inferred" state) and `classification` ("Partially-Supported") can be computed deterministically in the backend using Levenshtein distance or fuzzy string matching between the extracted value and the source quote. This fundamentally misunderstands semantic extraction. "Inferred" means the value was constructed from implication (e.g., deriving "5 years of experience" from dates), which no string-matching algorithm can detect. "Partially-Supported" is a judgment of evidentiary strength, not syntactic overlap. This naive assumption invalidates their entire "Conditionally Rich" architecture, as it offloads semantic LLM judgments to a deterministic string matcher that will fail on the exact complex cases it needs to handle.

**Q3. What did ALL responses miss that the council should consider?**
All responses missed the impact of **JSON serialization verbosity on output token costs**. The prompt explicitly states "record size is the dominant cost lever because the LLM writes records as output." Yet, every respondent assumed standard JSON object key-value serialization. If the LLM writes 50 atomic records with 12 fields each, it must emit the verbose key names (e.g., `"canonical_semantic_key"`, `"classification"`, `"machine_touch"`) 600 times. These repeated keys likely consume 40-50% of the output tokens.
The council should consider having the LLM emit a **compact serialization format**—such as positional arrays, CSV, or single-character keys—which the Fastify backend then deterministically hydrates into the full 12-field Zod schema. This structural change could cut output token costs by up to half without sacrificing a single semantic field, potentially making the untested "many-small × rich" combination highly affordable and rendering the minimal-vs-rich cost debate moot.

Let me review this to ensure it meets all constraints.
- Rigorous, impartial critic.
- Evaluate responses.
- Answer three specific questions.

Is the JSON serialization verbosity point valid? Yes, it's a widely known optimization for LLM structured output. When you have many records, the keys eat up tokens.
Is it addressed in any of the responses?
Contrarian: "Make the model emit compact atomic facts and issue codes, not prose metadata on every record." -> This touches on prose metadata, but does not explicitly mention the overhead of JSON keys or propose positional arrays/compact formats. They still imply standard JSON objects with sparse overlays.
Evidence Scout: "drastically reduces output token spend by removing the most verbose fields" -> removing fields, not optimizing serialization.
Fundamentalist: "Adding four classification fields... costs maybe 30-50 tokens per fact" -> assumes standard JSON keys.
Expansionist: "12-field schema with most fields left null" -> assumes standard JSON keys.

So yes, the explicit omission is the *serialization format* itself.

What about Anthropic Prompt Caching? I mentioned it earlier. Should I include it? The prompt specifically says "Model: claude-sonnet-5". Anthropic introduced prompt caching for Claude 3.5 Sonnet (and presumably 5 in this hypothetical context). If you do a two-pass approach, you can cache the system prompt + CV, making the input cost of the second pass negligible. This makes the "derive it later" (two-pass) approach potentially much cheaper than Fundamentalist assumed, challenging their "you pay input tokens twice" argument.
However, the prompt says: "Given that output tokens cost 5× input tokens and record size is the dominant cost lever". If record size is the dominant cost lever, then the *output* tokens of the second pass are the main concern, not the input tokens. So prompt caching, while relevant, might not be as impactful as the serialization format,

### Evidence Scout's Peer Review

**Q1. Which response most changed how you'd answer the question, and why?**

**Model A (Contrarian)** most changed my thinking. 

The specific insight that forced an update was the realization that `needs_grill` and `grill_hint` are not intrinsic properties of a parsed fact, but *relational* properties dependent on external context (the job advert, current eligibility policy, and the rest of the CV). 

The other models treat the 12 rich fields as a monolithic block of "metadata" to be written at parse time. Model A correctly identifies that baking context-dependent workflow states into a permanent, canonical fact record violates the "own your facts" (S2) principle and guarantees stale state. This forces a crucial paradigm shift: the record shape cannot be evaluated solely on "parse cost," but on whether the fields actually belong in a *fact graph* at all. Some fields (like grill hints) must be computed at render-time for the confirm deck based on current policy, not stored in the database as permanent attributes of a historical fact.

**Q2. Which response has the biggest blind spot, and what is it?**

**Model C (Executor)** has the biggest blind spot.

The specific gap is its flawed **reversibility asymmetry argument**. Model C claims that "Rich→minimal is a database projection. You drop fields in a migration. No LLM call," using this to justify defaulting to the rich shape as a "safe" bet. 

The blind spot: Model C's own field audit explicitly proves that 5 of the 12 fields are *un-derivable* without an LLM (e.g., `classification` for Derived/Partially-Supported, `machine_touch` for inferred). If you drop these fields from the database to simplify the schema, you permanently destroy the LLM's expensive judgment. If you later need them (e.g., to render the confirm deck), you cannot simply "project" them back; you *must* re-run the LLM. Therefore, Rich→Minimal is not a free projection; it is the permanent deletion of un-derivable computations. The asymmetry is a mirage: both directions require an LLM call if you ever need to cross back, because the missing data cannot be deterministically reconstructed from the minimal core.

**Q3. What did ALL responses miss that the council should consider?**

All four responses missed the impact of the record shape on the **user correction loop (mutations to the fact graph)**. 

The models treat the CV parse as an isolated, one-and-done event, debating only the cost of the *initial* write. However, Constraint 2 and ADR-0008 dictate that facts are individually correctable on the confirm deck, and corrections change the origin to "corrected" (meaning the underlying facts always win). 

If the record is "rich" and bakes in LLM judgments (`classification`, `needs_grill`), a user correction to an underlying fact (e.g., changing a start date or confirming a reworded skill) instantly invalidates those baked-in judgments. The system must now either:
1. Re-run the LLM to re-evaluate the `classification` and `needs_grill` status of the mutated fact (incurring the exact "second pass" cost the models are trying to avoid).
2. Leave the baked-in judgments stale, showing the user incorrect tiering on the confirm deck.

If the record is "minimal" (or uses deterministic derivation for the overlay), a user correction simply updates the minimal fact, and the UI can instantly re-derive the `classification` and `needs_grill` state at render-time without any LLM call. 

None of the models evaluated the cost of *maintaining* the record shape through the interactive correction lifecycle. The true architectural lock-in—and the hidden cost of "rich" records—will occur not during the initial parse, but every time a user corrects a fact and forces the system to reconcile stale, baked-in LLM judgments.

### Fundamentalist's Peer Review

**Q1. Model A (Contrarian) — the insight that `needs_grill` and `grill_hint` are not properties of a fact.**

Every other response treats the 12 fields as a cost question: pay now or pay later, write them or derive them. Model A is the only one that asks whether two of the fields *belong on the record at all*. The argument is short but consequential: `needs_grill` depends on the advert's eligibility gates, the current matching policy, and which dimensions are active — all of which change per application. Baking it into the fact record at parse time means the flag is stale the moment the person applies to a second job. This connects directly to the ADR pattern already established in the repo (ADR-0005: a stretch belongs to its advert; ADR-0007: what prints is decided per application). By that logic, what gets *grilled* should also be decided per application, not stamped permanently at parse time. This isn't a cost optimisation — it's a correctness fix that happens to also save tokens.

Model C's reversibility argument (rich-to-minimal is a projection; minimal-to-rich is a re-parse) is the second-most useful framing, but it's an argument from caution, not from design correctness. Model A identified a genuine structural error in the rich shape.

---

**Q2. Model D (Evidence Scout) — the deterministic derivation claim is not load-bearing.**

Model D's entire recommendation rests on computing `machine_touch` and `classification` via backend string matching between the extracted `value` and the `source_quote`. The problem: CV parsing decomposes compound sentences into atomic structured fields. When the source quote is *"Senior Software Engineer and Team Lead, Feb 2021 – present"* and the extracted values are `title: "Senior Software Engineer"`, `start_date: "2021-02"`, and `is_work: true`, no string-matching algorithm — fuzzy or otherwise — can reliably determine whether the title extraction was verbatim, a paraphrase, or an inference. "Team Lead" was dropped. Is that reworded or inferred? That's a semantic judgment, not a Levenshtein calculation.

Model D acknowledges this in failure mode #2 but then proposes fuzzy matching as the fix, which doesn't solve the problem — it just makes the wrong answer probabilistic instead of deterministic. The recommendation to "remove the instructions asking the LLM to evaluate `machine_touch` and `classification`" would replace an imperfect LLM judgment with a reliably wrong string comparison, and the confirm deck would show the user a confidence level the backend fabricated. This is the biggest gap because it's structural to the recommendation, not a minor caveat.

---

**Q3. All four conflate two independent decisions, and the conflation is why the measurement was unreadable in the first place.**

The cost measurement compared 4 rich records against 21 minimal records. Every response notices this and calls the comparison unfair — then proceeds to argue about field count anyway, as if the granularity question will resolve itself. It won't. There are two orthogonal choices:

1. **Granularity:** How many records per CV? One per quoted line (batched, current rich shape), or one per atomic machine decision (per-field, what ADR-0004 and the confirm deck actually need)?
2. **Richness:** How many fields per record? Core only, or core plus metadata?

The cost is the *product* of these two numbers, not a function of either alone. The untested "many-rich" combination the user flagged is exactly the cell where both are maximised — and it's the cell the confirm deck's requirements push toward (per-decision granularity × metadata for correctability). None of the four responses prices that cell or recommends measuring it first, even though three of them recommend shapes that land in it.

A secondary omission: nobody mentions that re-parsing isn't just a token cost — it's a **user disruption** cost. If you re-parse a CV after the person has already corrected facts on the confirm deck, their corrections may not survive the new record IDs and different extractions. The person has to re-confirm. This makes the reversibility penalty worse than any response acknowledges, and it strengthens Model A's and Model C's caution, but for a reason neither of them stated.

**Anonymization mapping:**
- Model A = Contrarian (Codex (gpt-5.5))
- Model B = Expansionist (Fireworks (minimax-m3))
- Model C = Executor (Fireworks (glm-5p2))
- Model D = Evidence Scout (Fireworks (qwen3p7-plus))
- Model E = Fundamentalist (Claude (claude-opus-4-6) [high] [fallback from Fireworks (kimi-k2p6)])

---

## Stage 3: Chairman's Synthesis

# Chairman's Synthesis

*Plain-language note up front, because this decision reaches beyond engineering: the "record" here is the row of data the AI writes down for every fact it pulls off a CV. "Minimal" means it writes just the quote and where the quote came from. "Rich" means it also writes 12 columns of its own judgments — did it copy the words exactly or reword them, how well-supported the fact is, and whether we should ask the person a follow-up question. The whole cost fight turns on one fact: it costs the AI about 5× more to **write** a word than to **read** one, so the size of what it writes each time is the main bill. Everything below is about whether those 12 columns earn their place.*

## WHERE THE COUNCIL AGREES

Five roles, working blind, converged on more than the format suggests.

1. **Nobody recommends pure minimal.** Every single role — Contrarian, Expansionist, Executor, Evidence Scout, Fundamentalist — landed on "rich" or "rich, re-shaped." That is the strongest signal in the whole exercise: the one option the numbers appeared to favour is the one no role will defend once you look past the numbers.

2. **The measurement can't decide this — it's broken four ways.** Contrarian, Executor, Fundamentalist and Expansionist all independently reject the $0.16-vs-$0.21 comparison. It compared *different amounts of work* (21 small records for minimal vs 4 lumped-together records for rich), ran with the AI's "thinking" left on (which inflates exactly the written-output cost we care about), used a test path instead of the real one, ran once, and never checked whether the output was correct. The cheaper number came from a shape the review screen can't even use.

3. **"Derive it later" is only cheaper if "later" is plain code, never a second AI call.** Unanimous (Contrarian, Executor, Evidence Scout, Fundamentalist). Moving a judgment to a second AI pass doesn't save the writing cost — it re-pays it, and adds the cost of re-reading the CV to rebuild context. Deferral only saves money when the deferred step is deterministic arithmetic or string-matching.

4. **The 5× write-cost ratio, read correctly, argues for writing once.** Fundamentalist's inversion — endorsed by Contrarian and Executor in review — reframes the whole premise. The ratio doesn't say "write less"; it says "don't write the same judgment twice," because redundant writing is what's 5× expensive.

5. **Direction of no-regret: rich preserves options, minimal forecloses them.** Executor and Fundamentalist both note you can always project a rich record down to a minimal one going forward, but you cannot rebuild a rich record from a minimal one without re-running (and re-paying) the AI over every stored CV. (Evidence Scout sharpens this in review — see clashes.)

## WHERE THE COUNCIL CLASHES

**Clash 1 — Can the AI's judgment columns be computed for free in ordinary code?**
Evidence Scout stakes its entire proposal on *yes*: compute "did it reword or infer this" and "how well-supported is it" with string-distance math on the backend, keeping them out of the AI's output entirely. **All four other roles refuted this in review, and they are right.** String-matching can tell you a quote was copied verbatim; it cannot tell reworded from *inferred*, cannot judge evidentiary strength, and — critically — cannot make the "does this count as paid work?" call that moves someone's years-of-experience and therefore their eligibility. Fundamentalist's verdict is the sharpest: fuzzy matching doesn't fix this, it just makes the wrong answer *probabilistic*, and the review screen would then show the person a confidence level the machine fabricated. **Position that wins: these are AI judgments; they cannot be faked in code.** Evidence Scout stands alone, 4-to-1 against.

**Clash 2 — Is "rich → minimal" actually a free downgrade?**
Executor says yes, it's a database projection. Evidence Scout's review catches the flaw: it's only free if you *keep* the rich data in storage. If you genuinely delete the un-derivable judgment columns, you've destroyed work you can only rebuild by re-running the AI — so both directions cost money once you actually discard. **Resolution:** the *optionality* argument survives (start rich and you never need a re-parse), but the glib "throwing fields away is free" framing does not. Default to rich to keep the door open, not because deletion is costless.

**Clash 3 — Do the follow-up-question fields belong on the permanent record at all?**
This is the most consequential disagreement, and it *modifies* the winning answer rather than sitting beside it. Executor and Fundamentalist (in Stage 1) treat `needs_grill` and `grill_hint` as ordinary rich fields to bake in. Contrarian argues they are not properties of a *fact* at all — whether to ask a follow-up depends on the specific job advert and current eligibility rules, which change with every application. Bake them into a permanent fact and they're stale the moment the person applies to a second job. **By the review stage, four of five roles had converged on Contrarian's side** (Evidence Scout, Fundamentalist and Expansionist all endorsed it), and Fundamentalist tied it to the repo's own settled pattern — ADR-0005 and ADR-0007 already say *what belongs to an application is decided per application*. **Position that wins: the grill fields come off the frozen record and are computed per-application at render time.**

**Clash 4 — Is the "sparse overlay" third shape worth its complexity?**
Contrarian, Expansionist and Evidence Scout say yes in various forms; Executor says the savings are marginal and the ongoing code complexity real; Fundamentalist says only if some fields turn out deterministic. **Unresolved, and correctly so** — this one depends on the measurement nobody has run yet.

## BLIND SPOTS THE COUNCIL CAUGHT

The peer-review round earned its keep. Six things surfaced that no single Stage-1 answer had right:

- **Evidence Scout's whole architecture rests on a false premise** (caught by all four reviewers). Its "compute the judgments in code" plan can't survive contact with real CVs — compound lines, consolidated skills, and the counts-as-work decision all defeat string-matching. This is the most important catch: it removes one of the five proposals from contention.

- **You are conflating two independent dials** (Fundamentalist's review). *Granularity* (how many records per CV) and *richness* (how many columns per record) are separate choices, and cost is their **product**. The confirm screen forces fine granularity; the cost question was always about the fine × rich cell — and that is the exact cell nobody measured.

- **The output format need not equal the stored format** (Contrarian *and* Executor, independently). If writing is the dominant cost, the repeated column names and repeated full quotes in verbose JSON may be eating 40–50% of the bill. Have the AI emit a compact, token-lean form (short codes, source *pointers* instead of repeated quote text) and expand it into the full rich record on the backend. This attacks the real lever and could shrink the cost gap to nothing.

- **The hidden cost isn't the first parse — it's every correction afterward** (Evidence Scout's review). When someone fixes an underlying fact on the review screen, any baked-in AI judgment about that fact goes stale. You then either re-run the AI (the very second pass we're avoiding) or show them wrong information. This is the ongoing tax the parse-time cost analysis never sees.

- **Re-parsing isn't only a token bill — it's user disruption** (Fundamentalist's review). Re-running the AI can produce different record IDs and different extractions, so a person's earlier corrections may not survive. They'd have to re-confirm. That makes "choosing wrong" more expensive than any role first admitted.

- **Doing five jobs in one prompt lowers accuracy on each** (Expansionist's review). A rich single pass asks the AI to extract *and* classify *and* diagnose gaps at once; a wrong classification on an eligibility-gating fact is worse than no classification, because the person trusts the screen. Also from Expansionist: the follow-up hint should be a **question ID** picked from a finite library (~5 tokens), never freshly written prose (~40–80 tokens) — that removes the single most expensive field outright.

## THE RECOMMENDATION

**Write a rich record, at one-record-per-decision granularity, in a single AI pass — but re-shaped in three specific ways the raw "rich" proposal got wrong.**

1. **One record per atomic machine decision, not per quoted line.** A job entry becomes five records (start date, end date, title, employer, counts-as-work), each pointing at its origin. This is forced by your own non-reopenable constraints — the review screen must expose each decision, and every fact must point at its source. The 4-lumped-records shape that produced the cheap $0.21 number literally cannot do this.

2. **Keep the AI's genuine judgments on the record; drop the policy-dependent ones.** *Machine-touch* (copied / reworded / inferred) and *classification* (how well-supported) require the AI's reading and stay. `needs_grill` / `grill_hint` are **not facts** — they depend on the advert and today's eligibility rules — so they move off the frozen record and are computed per application at render time, as a question-ID lookup, not written prose. This is a correctness fix that happens to also cut cost, and it's consistent with decisions you've already made (ADR-0005, ADR-0007).

3. **Emit compact, store rich.** Have the AI write a token-lean output (short codes, source pointers instead of repeated quote text) and expand it into the full contract on the backend. Compute the *free* cases (verbatim / verified by exact match) in code; leave every semantic case to the AI. Keep the raw output and a version stamp so the shape can evolve by versioning rather than re-parsing.

**Confidence: High** that the answer is rich-and-fine-grained, not minimal — the council is near-unanimous, and the one measurement that looked pro-minimal is confounded four independent ways. **Medium** on the exact overlay-and-compaction details until the missing measurement exists.

**The single condition that reverses this:** if a properly run measurement of the fine-grained × rich cell (production path, thinking off, correctness checked) shows a cost gap over fine-grained minimal that is *large and survives compact serialization* — then, and only then, defer the derivable columns to a minimal core plus a sparse overlay. Nothing in the current data meets that bar; that's why it can't be the basis for locking minimal.

## THE ONE THING TO DO FIRST

**Run the one cell nobody measured: fine-grained records × rich fields, on the same six CVs, through the production path with thinking disabled** — recording tokens per fact, not just per upload, and spot-checking correctness on the two most complex CVs. Both existing numbers describe shapes you can't ship (four lumped records the review screen can't use; a minimal record that can't expose the five decisions), so they can't settle anything. This measurement is roughly half a day and a few dollars, and it is the difference between locking the S3 build on evidence versus locking it on an artifact.

---

## Council Composition

- Model A (Contrarian) → Codex (gpt-5.5)
- Model B (Expansionist) → Fireworks (minimax-m3)
- Model C (Executor) → Fireworks (glm-5p2)
- Model D (Evidence Scout) → Fireworks (qwen3p7-plus)
- Model E (Fundamentalist) → Claude (claude-opus-4-6) [high] [fallback from Fireworks (kimi-k2p6)]
- Chairman → claude-opus-4-8 [max] (Claude Code CLI)