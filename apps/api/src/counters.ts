// #103 (E5 slice 2): small, named, in-process ops counters for the posting pool. Three distinct
// numbers, deliberately never folded together:
//   - postings.language_skipped: confirmed non-served-language posting, held back at ingest. A SKIP,
//     never a failure (#86 AC: the slice-3 failure alarm must not fire on language skips, or it
//     screams on every Hong Kong pull and gets ignored).
//   - postings.language_undetermined: detectLanguage() couldn't judge. **Treat a rise here as a
//     suspected fault, never as routine.** Measured in QA 2026-08-02: an ATS bullet-list advert
//     ("Responsibilities: - Manage end-to-end delivery") scores 0.03 on the English function-word
//     test and a bare skills blob scores 0.00, so genuinely English adverts in those formats land
//     here and are then hidden from EVERY reader. Held separate from the skip counter for exactly
//     that reason (#103 code review finding 3) — folding them together would let real English jobs
//     disappear behind a number that reads as benign.
//   - postings.read_failed: a model read could not be turned into a usable AdRequirementsV1 (or the
//     store itself failed) — the read-failure alarm's numerator. Declared here since #103; #104
//     (E5 slice 3, adReader.ts) is the first writer.
//   - postings.read_timed_out: the deck's own READ_TIMEOUT_MS deadline (routes/onboarding.ts)
//     elapsed before an uncached read finished — #115. Same shape of mistake #103 already drew a
//     line against for language skips: a slow-but-eventually-successful read is not the same event
//     as a read that produced nothing usable, and folding them into postings.read_failed would keep
//     the read-failure alarm firing through ordinary cold-pool warm-up. Deliberately excluded from
//     computeReadFailureAlarm's numerator AND denominator below.
//   - postings.read_in_time: the SAME deadline site's other outcome — readAd(posting) settled before
//     READ_TIMEOUT_MS elapsed, whatever it settled to (a real result OR a null already counted
//     elsewhere as postings.read_failed — this counter is about promptness, not validity). Exists
//     ONLY to give the timeout alarm below an honest denominator: read the mechanism precisely, not
//     optimistically — nothing CANCELS an overrunning read, it keeps running past the deadline and,
//     on success, increments adReader.read_succeeded and persists to the store ITSELF, on whatever
//     LATER request's dime happens to trigger it, with no idea the original caller already gave up.
//     adReader.read_succeeded therefore counts "a fresh read eventually worked", not "worked within
//     THIS request's deadline" — using it as the timeout alarm's denominator (#115 review) let a
//     sustained 100%-timeout incident asymptote to a 50% reported rate as those abandoned reads
//     self-healed in the background, capping it just under a threshold tuned to that same 50% and
//     making the alarm structurally unable to fire in the scenario it exists for. postings.read_in_time
//     fixes this by counting the outcome AT the deadline instead of AFTER it, at the same call site
//     as postings.read_timed_out. A cache hit still resolves through this same site (readAd(posting)
//     settles near-instantly from the store) and correctly counts as in-time — it genuinely is a read
//     the deck waited on and got back. #114: a SUPPRESSED read (adReader.ts's negative cache
//     returning null without a model call) resolves through this exact same site just as fast as a
//     cache hit does, and is ALSO counted in-time — correctly, in the sense that the deck really did
//     get an answer promptly, but it means a pool with a few permanently-broken adverts warmed into
//     the negative cache dilutes this counter (and therefore the timeout alarm's denominator) with
//     free no-ops that were never actually at risk of timing out. Same class of honest limit as
//     adReader.read_suppressed's own note below on the read-failure alarm — recorded here rather
//     than left for an operator to notice the denominator growing faster than real traffic explains.
//     None of this is persisted (this file's own accepted in-process
//     limit), so a process restart while a read is still overrunning drops that attempt from both
//     counters — it never becomes a counted timeout OR a counted in-time outcome, and simply
//     vanishes. A real, visible symptom regardless (the deck actually returned one fewer card this
//     request), so postings.read_timed_out is exposed on /ops/counters, alarmed on its own terms
//     below (READ_TIMEOUT_ALARM — story 26 requires a systemic timeout spike to be as loud as a
//     systemic validation-failure spike), and every occurrence is recorded in the recent-read-
//     failures ring buffer below, class "timeout".
//   - postings.fixture_invalid: a HAND-AUTHORED fixture failed to parse (e5stub.ts). Deliberately
//     its own counter, not folded into postings.read_failed (#104 review finding 6): a broken
//     fixture has nothing to do with the model, so it must not move the read-failure alarm's rate —
//     one malformed fixture would otherwise pin the alarm at 100% with zero model calls made and
//     point an operator straight at the wrong system. Counted once per bad fixture, at the fixture
//     INDEX's build time (e5stub.ts's buildFixtureIndex, shared by loadAdRequirements,
//     lookupAdRequirements, and listAdRequirements — #114 unified what used to be two independent
//     counting paths: listAdRequirements's own cache counted once, but the module also exported a
//     separate parseAdRequirementsList that counted on every call if driven directly, with nothing
//     stopping both running on the same request. #114 review deleted parseAdRequirementsList
//     outright rather than leaving it test-only-and-unused — a second implementation that could
//     still move this counter was the exact "two independent counting paths" hazard this ticket
//     exists to remove; the index is now the ONLY thing that ever increments it). #114 also gave
//     this counter its first PRODUCTION caller: before it,
//     resolveAdRequirements (routes/onboarding.ts) told "no fixture" and "a fixture that failed to
//     parse" apart with a bare try/catch, so a corrupt hand-curated entry looked identical to a
//     missing one, fell through to a paid model read, and this counter — despite existing since
//     #104 — could never move outside a test. resolveAdRequirements now asks e5stub.ts's
//     lookupAdRequirements for a found/missing/invalid answer instead, and "invalid" drops the card
//     with NO model call, exactly like "found" and "missing" already did for their own outcomes.
//
// #104 (E5 slice 3) adds nine more, namespaced adReader.* to stay visually distinct from the
// ingest-time postings.* counters above even though they share this one flat counts object and one
// /ops/counters route:
//   - adReader.read_succeeded: a model read produced a valid AdRequirementsV1. Denominator (with
//     read_failed) for the failure-rate alarm below.
//   - adReader.language_skipped: a posting held back at READ time because its language isn't
//     served — separate from postings.language_skipped (ingest time) so nothing double-counts. In
//     production this never fires on its own (eligiblePostings() already keeps a non-served
//     posting from ever reaching the reader); it exists as defense-in-depth inside adReader.ts
//     itself for a caller that skips that filter.
//   - adReader.requirements_produced / adReader.requirements_blocking: raw totals across every
//     successful read — the numerator/denominator for the blocking rate (AC: "the blocking rate is
//     observable"). Measured 2026-08-02: without the blocking definition pinned in the prompt, one
//     advert alone produced 4 blocking requirements, including a stakeholder-communication
//     capability that should never block. A sudden rise in this ratio is that regression recurring.
//   - adReader.blocking_clamped: how many blocking calls were down-classified to ordinary by the
//     code-level enforcement in adReader.ts (the mechanical safety net behind the prompt's
//     definition). A rising clamp count means the model is drifting toward over-blocking — the
//     output stays safe, but the trend is worth an operator's attention.
//   - adReader.cost_reads_recorded / cost_input_tokens_total / cost_output_tokens_total: the unit
//     economics #86 asked to be KNOWN, not estimated (#104 review finding 8 — cost was written per
//     advert but nothing ever exposed it, and it died with the process when DATABASE_URL was unset).
//     reads_recorded counts only reads whose usage was actually measured (AnthropicLlm's
//     completeWithUsage); a driver with no usage data (ClaudeCliLlm) contributes to
//     read_succeeded but not here, so reads_recorded / read_succeeded also tells an operator what
//     fraction of reads have real cost data at all. total ÷ reads_recorded is the average cost per
//     advert read.
//
// #105 (E5 slice 4) adds five more, namespaced judge.* — mirrors adReader.*'s own cost/success
// convention, deliberately smaller: judging has no blocking-style code-level enforcement to observe,
// and a judging failure never removes a card (it falls back to the deterministic tick), so there is
// no read-failure-shaped alarm to compute here — only "did it work" and "how often did we fall back".
//   - judge.judged_succeeded: a model call produced a valid, coverage-complete verdict set. Does NOT
//     fire on a cache hit (same convention as adReader.read_succeeded) or on the zero-facts shortcut
//     (judge.ts: no model call is made when there are no confirmed facts to judge).
//   - judge.judge_failed: judgeOne (judge.ts's makeJudge) couldn't produce a usable record — two
//     invalid model answers, a raw driver error, or a store outage on either side of the call.
//   - judge.cost_reads_recorded / cost_input_tokens_total / cost_output_tokens_total: same unit-
//     economics convention as adReader's — reads_recorded counts only judgements whose usage was
//     actually measured (a driver with completeWithUsage); total ÷ reads_recorded is the average
//     cost per judged card.
//   - judge.fallback_used: routes/onboarding.ts's resolveJudgement fell back to the deterministic
//     tick — a judge WAS wired but this card's judgement timed out or came back null. Deliberately
//     does NOT fire when no judge is wired at all (deps.judge absent, e.g. every pre-#105 test) —
//     that's a deployment/test configuration, not an operational fallback, same distinction
//     postings.read_failed draws against deps.readAd being absent.
//   - judge.fallback_timeout: a SUBSET of judge.fallback_used, counted additionally when the
//     fallback was specifically the READ_TIMEOUT_MS deadline firing rather than a clean null — same
//     split postings.read_timed_out already draws against postings.read_failed: a judge hanging on
//     every card (provider slow/down) and a judge cleanly failing to produce a verdict are different
//     operational signals, and folding them into one counter made them indistinguishable.
//
// #118 adds TWO more, namespaced usageLedger.* to stay visually distinct from every other prefix
// here even though it shares this one flat counts object:
//   - usageLedger.write_failed: a completed model call's ledger write raised (llmMeter.ts) — a
//     Postgres blip, pool saturation, whatever — AFTER the call itself already succeeded and
//     returned to its caller. Paired with the same console.error llmMeter.ts already logs, exactly
//     the log-plus-counter convention adRequirementsStore.ts/judgementStore.ts's own write-failure
//     paths use, so a metering outage is an OBSERVABLE signal on /ops/counters rather than only a
//     log line nobody happens to be tailing.
//   - usageLedger.pricing_override_rejected: an LLM_PRICING_JSON entry for one model failed
//     validation (a missing rate, a non-numeric value, or a non-finite one — NaN/Infinity) and was
//     dropped rather than merged; llmPricing.ts keeps that model's existing rate instead (its in-repo
//     default, or no rate at all if it never had one). QA found the failure this exists to catch: a
//     fat-fingered rate change is valid JSON, merges silently, and computeCostUsd then returns NaN —
//     real Postgres accepts a NaN cost_usd (pg-mem doesn't, which is why the test suite alone never
//     caught this), and totalCostUsd() returns NaN from that row onward, forever, with nothing to
//     say why. This counter (paired with a console.error at the point of rejection) makes a bad rate
//     change loud at boot instead.
//
// #117 adds SIX more:
//   - judge.subset_reused: judgeOne (judge.ts's makeJudge) found a stored record for the SAME advert
//     whose recorded fact set is a SUBSET of the visitor's current one and reused its already-passing
//     verdicts — either avoiding a model call entirely (every requirement was already met) or paying
//     for only the still-open requirements in one smaller call. This is what makes AC2 ("unchanged
//     verdicts are not re-purchased as the fact set grows") a number instead of an inference.
//   - deck.cards_judged / deck.cards_pending / deck.cards_unscored / deck.cards_estimated: the deck
//     route's own card provenance tally — one increment per rendered card, all four mutually
//     exclusive and exhaustive. Must-fix 2 (coordinator review) split what was one "pending" state
//     into two with opposite futures: `pending` is a card a PAID attempt was made for this request
//     that missed the shared budget — genuinely in flight, will self-heal into the store on a later
//     request. `unscored` is a card DECK_JUDGE_MAX_CARDS's bound never even attempted — nothing
//     coming unless a later request's own bound happens to select it. pending / (judged + pending) is
//     the cold-deck fallback rate AC6 asks to be measured — see /ops/spend (server.ts), which reports
//     it alongside cost per visitor from the same run; `unscored` is deliberately excluded from that
//     ratio (it isn't a fallback, it's a cost decision). `estimated` only ever rises when no judge is
//     wired at all (local dev with no key, every pre-#105 test) or from the tailor surface's own
//     always-estimated-on-fallback state; a rise here in a deployed environment with a judge
//     configured means the judge dependency silently stopped being wired — worth an operator's
//     attention on its own terms.
//   - deck.judge_bound_hit: this request's ELIGIBLE candidate pool was larger than
//     DECK_JUDGE_MAX_CARDS — the paid set (routes/onboarding.ts, must-fix A: ranked over EVERY
//     candidate, not just the still-unresolved ones, so it's a stable, pure function of the fact set
//     rather than something a repeat poll can grow) could not cover the whole pool. A rising rate
//     here is expected and healthy on a growing pool (it is the cost control doing its job); it
//     exists so an operator can see how often the bound is the limiting factor, distinct from
//     deck.cards_unscored's raw per-card count.
//
// #107 (E5 slice 6, D6/AC6) adds ONE more:
//   - deck.cards_withdrawn: one increment per candidate the deck route (routes/onboarding.ts) removed
//     via withdrawal.ts's findWithdrawingRequirement, BEFORE ranking/peek/judging ever saw it — a
//     genuinely blocking requirement the visitor explicitly said "no" to. This is the AC6 number: a
//     silently-shrinking deck would otherwise look identical to an honestly-scored one, and this
//     counter is what turns over-firing (the withdrawal predicate matching too eagerly) into
//     something an operator can see rather than jobs quietly disappearing. Sits alongside
//     adReader.requirements_blocking (the advert-side rate, unchanged by this ticket) as the other
//     half of the same story: how many requirements are stated blocking, and how many postings that
//     actually cost a session its card.
//
// #114 (E5 slice hazard cleanup) adds TWO more, namespaced adReader.* even though they describe the
// negative CACHE (makeAdReader's own bounded backoff, adReader.ts) rather than a read itself — kept
// in this prefix because they're the same reader's own bookkeeping and every other adReader.* number
// already lives here:
//   - adReader.read_suppressed: a request for an advert whose read already failed recently was
//     answered with null WITHOUT a model call — the negative cache hit. This is the AC's headline
//     number: "the number of reads saved by [the retry policy] is observable, so the policy can be
//     judged rather than assumed." Deliberately does NOT increment postings.read_failed a second
//     time — that counter was already moved once, on the ORIGINAL failure that created the
//     suppression entry. A suppression is a free no-op, not a new failed read, and re-counting it
//     would inflate the read-failure alarm's numerator with events that cost nothing. This
//     necessarily DAMPS the read-failure alarm's rate on both sides of its ratio once a pool has a
//     few permanently-broken adverts warmed into the negative cache (failed AND succeeded both
//     undercount slightly, since a suppressed request never reaches either branch) — the alarm still
//     fires on a genuinely systemic outage, because the FIRST failure per advert per backoff window
//     is always counted before any suppression can exist, but a reader watching read_failed climb
//     during a partial, adverts-that-can-never-parse-shaped incident will see it climb more slowly
//     than the true failure rate. Said explicitly here rather than left for an operator to work out
//     mid-incident.
//   - adReader.read_suppression_lifted: a PREVIOUSLY suppressed advert was allowed through again —
//     either its backoff window expired (the retry is bounded, never permanent — SUPPRESSION_MAX_MS
//     in adReader.ts is the operative guarantee here) or adReaderVersion() moved since the failure
//     was recorded. Review correction: adReaderVersion() is a memoised hash of a fixed on-disk
//     prompt file plus a hand-bumped constant, so it CANNOT change within a running process — a real
//     prompt/contract bump only takes effect via a redeploy, which restarts the process and empties
//     this in-memory negative cache anyway, making the version comparison unreachable in production
//     today. It stays in the entry as defense-in-depth for a future where the version COULD move at
//     runtime, not as the live mechanism preventing permanent invisibility — that job belongs to the
//     backoff cap alone. One counter for both triggers regardless, since the operator-relevant fact
//     is identical either way ("the negative cache let this advert be retried"). Paired with
//     read_suppressed as the honest denominator the AC asks for — suppressed reads against attempts
//     that were actually let through (fresh, or lifted) is how rarely the policy is retrying an
//     advert that turns out to still be broken.
//
// #100 (live-posting retrieval, §2.9 of docs/research/live-posting-retrieval-contract.md) adds FOUR
// more, namespaced postings.techmap_* — the real-call cost/health counterpart to the fixture-pool
// postings.* counters above, for the one real network provider client built so far
// (postingProvider.ts's TechmapPostingProvider):
//   - postings.techmap_calls_made / postings.techmap_calls_failed: one increment per HTTP attempt
//     (including retries — a retried attempt counts again, since it really did cost another call
//     against the vendor's rate limit), success/failure split. Together they're the observable
//     signal behind the AC that a rate-limit/transport failure is measured, not just returned.
//   - postings.techmap_records_fetched / postings.techmap_cost_usd_total: real measured totals —
//     records actually returned, and the spend computed from them via the registry's own costModel
//     (postings.ts's computeProviderCostUsd) — replacing #86's cost ESTIMATE with a number computed
//     from what a call actually returned. Named per-provider (techmap_*) rather than keyed by a
//     generic providerId, because exactly one real network provider exists today (§2.11 makes the
//     same call for a cost-normalization engine) — revisit when a second one lands.
// #100 review (must-fix round) adds TWO more, same techmap_* namespace:
//   - postings.techmap_normalize_dropped: one item from a 200 response that did NOT become a
//     ProviderPostingRecordV1 — either normalizeTechmapItem returned null (a required field genuinely
//     missing) or threw (the contract's own zod .parse() rejected it). A steady trickle is expected
//     background noise (a genuinely malformed advert); a sudden jump against a call that also reports
//     a healthy totalCount is the same shape-drift signal postings.techmap_calls_failed's
//     "normalized 0 records" case (postingProvider.ts) exists to catch, one level more granular.
//   - postings.techmap_budget_exceeded: this client's OWN in-process per-minute/per-day call budget
//     (FixedWindowBudget, postingProvider.ts) refused an attempt BEFORE any HTTP request was made —
//     distinct from postings.techmap_calls_failed, which only counts a call that actually reached the
//     vendor and got a 429/5xx/etc back. A rise here means our own conservative internal cap is the
//     limiting factor, not the vendor's.
//   - postings.techmap_budget_store_unavailable: the durable per-month reservation could not run,
//     so the client failed closed before HTTP. Kept separate from budget_exceeded so an operator can
//     distinguish database failure from genuine quota exhaustion.
// In-process and reset-on-restart. That's an accepted limit for this slice, not an oversight: there
// is no persisted metrics store yet, and standing one up before anything needs history would be the
// speculative abstraction this repo avoids (#86 decision 4 makes the same call for user languages).
const counts = {
  "postings.language_skipped": 0,
  "postings.language_undetermined": 0,
  "postings.read_failed": 0,
  "postings.read_timed_out": 0,
  "postings.read_in_time": 0,
  "postings.fixture_invalid": 0,
  "adReader.read_succeeded": 0,
  "adReader.language_skipped": 0,
  "adReader.requirements_produced": 0,
  "adReader.requirements_blocking": 0,
  "adReader.blocking_clamped": 0,
  "adReader.cost_reads_recorded": 0,
  "adReader.cost_input_tokens_total": 0,
  "adReader.cost_output_tokens_total": 0,
  "adReader.read_suppressed": 0,
  "adReader.read_suppression_lifted": 0,
  "judge.judged_succeeded": 0,
  "judge.judge_failed": 0,
  "judge.cost_reads_recorded": 0,
  "judge.cost_input_tokens_total": 0,
  "judge.cost_output_tokens_total": 0,
  "judge.fallback_used": 0,
  "judge.fallback_timeout": 0,
  "usageLedger.write_failed": 0,
  "usageLedger.pricing_override_rejected": 0,
  "judge.subset_reused": 0,
  "deck.cards_judged": 0,
  "deck.cards_pending": 0,
  "deck.cards_unscored": 0,
  "deck.cards_estimated": 0,
  "deck.judge_bound_hit": 0,
  "deck.cards_withdrawn": 0,
  "postings.techmap_calls_made": 0,
  "postings.techmap_calls_failed": 0,
  "postings.techmap_records_fetched": 0,
  "postings.techmap_cost_usd_total": 0,
  "postings.techmap_normalize_dropped": 0,
  "postings.techmap_budget_exceeded": 0,
  "postings.techmap_budget_store_unavailable": 0,
  // #162 AC5 — the stored years-of-experience total is a regenerable copy of the dated job records.
  // A recompute that disagrees with it is a real event (a correction that never reached the copy, or
  // a copy written by something that should not have): counted, never silently absorbed.
  "years.drift_detected": 0,
};

export type CounterName = keyof typeof counts;

export function incrementCounter(name: CounterName): void {
  counts[name]++;
  // postings.read_failed / adReader.read_succeeded can move the failure alarm; postings.read_timed_out
  // can move the timeout alarm INTO firing. postings.read_in_time is deliberately not watched here —
  // it only ever dilutes the timeout alarm's rate (moves it down), never crosses it into firing, so
  // there is nothing to check on that touch. Check on every touch of a name that COULD flip firing,
  // rather than asking every call site to remember to (a rate an operator has to remember to poll for
  // isn't an alarm — see maybeLogAlarmTransitions's doc below).
  if (name === "postings.read_failed" || name === "postings.read_timed_out" || name === "adReader.read_succeeded")
    maybeLogAlarmTransitions();
}

/** Batch add — requirement/blocking counts arrive per advert as a batch (e.g. "this read produced
 *  6 requirements, 1 blocking"), not one unit at a time, so this avoids N calls for one read. */
export function addToCounter(name: CounterName, n: number): void {
  counts[name] += n;
}

/** A fresh snapshot, numbers only — safe to serialize straight onto an open ops route. */
export function readCounters(): Record<CounterName, number> {
  return { ...counts };
}

// --- recent read failures (#115 AC2: a failure counter says THAT; this says WHY) ------------------
// A count alone (postings.read_failed, postings.read_timed_out) tells an operator a read didn't
// land, never why — the exact gap #115 was opened against, where every failure path was a bare
// `catch {}` that destroyed the reason. This is the detail companion to those counters: same
// in-process, reset-on-restart, no-persisted-store limits this file already accepts for the counts
// above (module-level singleton; a restart is a clean slate, and that's fine — nothing here is an
// audit trail). Bounded to a small fixed size so a bad advert (or a bad batch) can't grow this
// unbounded in a long-running process; oldest entries fall off first.
// "reader-rejected" is distinct from "model-call-error": model-call-error is adReader.ts's own
// classification for a raw LLM-driver failure it caught directly. "reader-rejected" is
// onboarding.ts's classification for readAd(posting) itself rejecting for some reason OTHER than
// the timeout race — something the production reader (makeAdReader) never actually does, since
// every internal failure there is already caught and turned into a null return before it would
// reach this far. Kept as its own class, rather than reused as "model-call-error", because
// onboarding.ts genuinely cannot see what kind of failure produced that rejection; calling it a
// model-call-error would claim knowledge this call site doesn't have.
export type ReadFailureClass =
  | "timeout"
  | "model-output-invalid"
  | "model-call-error"
  | "store-unavailable"
  | "reader-rejected";

export interface ReadFailureEntry {
  adId: string;
  class: ReadFailureClass;
  message: string;
  at: string; // ISO timestamp
}

// #115 review round 2: QA measured one fully-degraded deck request against today's 17-posting pool
// consuming 7 of a 20-entry buffer — comfortable today, but a SECOND degraded request in the same
// window would already start evicting the first's evidence. Sized to comfortably clear a single
// fully-degraded request across the WHOLE pool (17), not just the uncached subset, with room to
// spare for the pool growing somewhat before this needs revisiting again. Revisit if the pool grows
// meaningfully past this (e.g. live retrieval, #99-#101).
const READ_FAILURE_LOG_LIMIT = 40;
// Matches the tightest bound this file's own call sites already use for a final, externally-facing
// message (adReader.ts's `ad reader output failed validation twice: …` throw slices to 500) — not a
// new number invented for this path. Applied uniformly HERE, at the point of record, rather than
// trusting every call site to remember to truncate its own error before passing it in (#115 finding
// 3: two of the four classes were passing raw driver/provider error text — a pg auth failure, an
// internal hostname — through untruncated to an, at the time, ungated route).
const READ_FAILURE_MESSAGE_LIMIT = 500;
const recentReadFailures: ReadFailureEntry[] = [];

/** Records one dropped read AND logs it, so the reason lands in Fly's logs even for an operator who
 *  never hits the retrieval route below. Call alongside the matching incrementCounter call, not
 *  instead of it — this is detail, the counter is still the number. A "timeout" class logs its own
 *  wording rather than "failed" — the entire point of #115's counter split is that a timeout is not
 *  a failure, and reusing that word here would reintroduce the exact confusion the split removed. */
export function recordReadFailure(adId: string, cls: ReadFailureClass, message: string): void {
  const bounded = message.slice(0, READ_FAILURE_MESSAGE_LIMIT);
  const entry: ReadFailureEntry = { adId, class: cls, message: bounded, at: new Date().toISOString() };
  recentReadFailures.push(entry);
  if (recentReadFailures.length > READ_FAILURE_LOG_LIMIT) recentReadFailures.shift();
  console.error(
    cls === "timeout"
      ? `[ops] ad read timed out (not counted as a failure — still running, will self-heal into the cache if it completes) for ${adId}: ${bounded}`
      : `[ops] ad read failed (${cls}) for ${adId}: ${bounded}`,
  );
}

/** A fresh snapshot, oldest first — adId + a message already bounded at the point of record above,
 *  same "no secrets in error messages" discipline every call site follows. Gated behind OPS_KEY on
 *  its HTTP route (server.ts) regardless — a truncated driver error can still name an internal host
 *  or an auth-failure detail that has no business on an open URL, so truncation and gating are BOTH
 *  applied, neither alone (#115 finding 3). */
export function recentReadFailuresList(): ReadFailureEntry[] {
  return [...recentReadFailures];
}

// --- the read-failure alarm (AC: "an alarm exists" on a rising read-failure rate) ----------------
// Simplest honest thing per the ticket: a threshold plus a minimum sample size, computed on demand
// from the counters above — no metrics backend, no persisted alarm state (same accepted in-process
// limit as the counters themselves).
export const READ_FAILURE_ALARM = {
  threshold: 0.2, // >20% of read attempts failing is a prompt/provider regression, not noise
  minSamples: 5, // below this, one bad advert would swing the rate wildly — wait for real signal
} as const;

export interface ReadFailureAlarm {
  firing: boolean;
  rate: number; // failed / (failed + succeeded); 0 when there have been no attempts yet
  sampleSize: number;
}

/** Pure — takes explicit counts rather than reading the module's live counters, so the threshold
 *  and sample-size logic is testable with exact numbers instead of fighting the shared counters
 *  singleton's cross-test accumulation (see resetCountersForTest's doc for why that matters). */
export function computeReadFailureAlarm(failed: number, succeeded: number): ReadFailureAlarm {
  const sampleSize = failed + succeeded;
  const rate = sampleSize > 0 ? failed / sampleSize : 0;
  return { firing: sampleSize >= READ_FAILURE_ALARM.minSamples && rate > READ_FAILURE_ALARM.threshold, rate, sampleSize };
}

/** The alarm's current state, straight off the live counters — what /ops/counters reports. */
export function readFailureAlarm(): ReadFailureAlarm {
  return computeReadFailureAlarm(counts["postings.read_failed"], counts["adReader.read_succeeded"]);
}

// --- the read-timeout alarm (#115: story 26 — "a systematic failure cannot remove a whole market
// silently" — must hold for a systemic TIMEOUT spike exactly as it already holds for a systemic
// validation-failure spike). Same shape as READ_FAILURE_ALARM above, deliberately a SEPARATE
// threshold rather than folded into the one above — that is the whole point of #115's counter split,
// and reusing one alarm for two different signals would silently re-couple what the split was for.
//
// The denominator is postings.read_in_time, NOT adReader.read_succeeded (#115 second review round):
// read_succeeded counts a read's EVENTUAL success on whatever later request's dime triggered it, so
// under a SUSTAINED 100%-timeout incident every abandoned read still self-heals into read_succeeded
// a few seconds after its own timeout — the rate asymptotes toward 0.5 as timedOut and succeeded grow
// in lockstep, and a threshold of 0.5 can structurally never be CROSSED by a value approaching it
// from below. read_in_time is counted at the SAME deadline site as read_timed_out (resolveAdRequirements)
// instead, so a total-degradation incident reads 100%, not 50%.
//
// Threshold re-derived against that fixed denominator, not tuned around the broken one: today's
// measured warm-up (the ticket's own incident) was 3 timed out of 7 deadline-bound attempts ≈ 43% —
// that must stay quiet, since it is the accepted ordinary shape of a cold pool, not a regression. 60%
// sits comfortably above that measured baseline (headroom against ordinary variance) while still
// catching a genuine "essentially everything is timing out" regression: on the confirmed cause here
// (a provider-side throughput drop pushing EVERY uncached read over the deadline at once), the rate
// heads toward 100%, not a scattered handful — so anything sustained past 60% is already a real
// signal. minSamples matches READ_FAILURE_ALARM's for the same reason: below it, one slow advert
// swings the rate wildly.
export const READ_TIMEOUT_ALARM = {
  threshold: 0.6,
  minSamples: 5,
} as const;

export interface ReadTimeoutAlarm {
  firing: boolean;
  rate: number; // timedOut / (timedOut + inTime); 0 when there have been no attempts yet
  sampleSize: number;
}

/** Pure, same reason computeReadFailureAlarm is pure — exact-number testability without fighting
 *  the shared counters singleton. */
export function computeReadTimeoutAlarm(timedOut: number, inTime: number): ReadTimeoutAlarm {
  const sampleSize = timedOut + inTime;
  const rate = sampleSize > 0 ? timedOut / sampleSize : 0;
  return { firing: sampleSize >= READ_TIMEOUT_ALARM.minSamples && rate > READ_TIMEOUT_ALARM.threshold, rate, sampleSize };
}

/** The timeout alarm's current state, straight off the live counters — what /ops/counters reports. */
export function readTimeoutAlarm(): ReadTimeoutAlarm {
  return computeReadTimeoutAlarm(counts["postings.read_timed_out"], counts["postings.read_in_time"]);
}

// Tracks whether each alarm was already firing, so its log line fires once on the TRANSITION into
// alarm state, not on every subsequent failure while it stays firing — spamming the log at exactly
// the moment an operator needs to find the one line that matters would defeat the point. Two
// separate latches — the two alarms transition independently.
//
// #115 review: fixing the timeout alarm's denominator above also fixes, as a side effect, a latch
// re-arm QA flagged — a self-healing read incrementing adReader.read_succeeded used to recompute
// THIS alarm too (read_succeeded was its denominator), so a sustained incident's rate wobbled up and
// down as abandoned reads landed one by one, potentially re-crossing the threshold and re-logging
// per batch instead of once. Now that this alarm depends only on read_timed_out/read_in_time,
// adReader.read_succeeded no longer moves it at all, so a self-heal can never perturb its firing
// state. NOT fixed by this change, and not addressed in this pass: two concurrent requests racing
// the SAME in-flight read (adReader.ts's makeAdReader inFlight map) each run their OWN independent
// withReadTimeout against it, so one slow underlying read can still increment postings.read_timed_out
// twice (once per waiting request) — a real over-count of "timed-out reads" vs "requests that timed
// out waiting", left as a known limit.
let alarmWasFiring = false;
let timeoutAlarmWasFiring = false;

function maybeLogAlarmTransitions(): void {
  const alarm = readFailureAlarm();
  if (alarm.firing && !alarmWasFiring) {
    console.error(
      `[ops] adReader read-failure alarm firing: ${(alarm.rate * 100).toFixed(1)}% of ${alarm.sampleSize} reads failed`,
    );
  }
  alarmWasFiring = alarm.firing;

  const timeoutAlarm = readTimeoutAlarm();
  if (timeoutAlarm.firing && !timeoutAlarmWasFiring) {
    console.error(
      `[ops] adReader read-timeout alarm firing: ${(timeoutAlarm.rate * 100).toFixed(1)}% of ${timeoutAlarm.sampleSize} reads timed out`,
    );
  }
  timeoutAlarmWasFiring = timeoutAlarm.firing;
}

/** Test-only: zeroes every counter and both alarms' latches. Never called by production code — it
 *  exists because counts is a module-level singleton with no other reset, and the alarm/threshold
 *  tests need a clean slate to assert exact rates rather than depending on whatever else happened
 *  to run earlier in the same test file's shared module instance. */
export function resetCountersForTest(): void {
  for (const key of Object.keys(counts) as CounterName[]) counts[key] = 0;
  alarmWasFiring = false;
  timeoutAlarmWasFiring = false;
  recentReadFailures.length = 0;
}
