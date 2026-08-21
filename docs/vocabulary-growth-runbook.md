# Vocabulary-growth run — runbook

_#254, spec #251, part of #218. Glossary terms as defined in `CONTEXT.md`: **unmapped label**,
**vocabulary-growth run**, **vocabulary proposal**, job family, family placement, family learning
attempt._

This is the written procedure a **vocabulary-growth run** follows: an agent session the owner
launches and sits in. It is not product machinery — nothing here runs on a schedule, and nothing
here publishes by itself. The run's whole output is one **vocabulary proposal** per researched
cluster, and every proposal enters the published vocabulary only by the owner's approval and only
through the existing publish gates, unchanged. **The machine never adds silently; the human owns
every word that enters the vocabulary.**

**The budget rule, stated once and honoured throughout:** price every provider spend from the
provider registry's own cost model (`apps/api/data/posting-providers.json`) **at the time of
spending**, never from memory or a doc. USD 10 cap per run. Check the monthly call quota as well as
the dollars, honour **whichever binds first**, and say which one it was. Every proposal carries a
receipt: call count, dollar figure, which limit bound. A run that hits the cap stops honestly and
lists what it could not measure.

**Preconditions** — have in hand before starting:

- `OPS_KEY` (the ops surface), `FAMILY_LEARNING_OPERATOR_KEY` (the operator progression route).
- Production database access (`fly postgres connect` / proxy) — the closing checklist reads the
  `family_learning_attempts` and `sessions` tables; no listing route exists for them.
- The posting provider key, for market word probes and posting evidence.
- The owner, in the room. Steps 2 and 5 are theirs and cannot be defaulted.

---

## 1. Harvest the waiting unmapped labels

Read the feed through the ops surface (never the database, never the logs — the label words are
visitor-typed / CV-read free text and stay behind the ops key):

```
GET /ops/unmapped-labels?key=<OPS_KEY>&waiting=1
```

`waiting=1` returns only the **unmapped labels** still waiting — labels earlier runs already
harvested keep their entries but leave the waiting set. The response carries the entries (words,
source `target_role` or `past_job`, session link, reason, recorded time) and the `waiting` counts
(`unharvested`, `distinctRoles`).

Do **not** mark anything harvested yet — that is the last step of the closing checklist, so an
aborted run leaves the labels waiting for the next one.

Discipline for the whole run: the raw entries (words + session links) never leave the session — not
into commits, not into logs, not into the proposal files. A proposal names the researched role in
its own words; it never reproduces the feed.

## 2. Cluster, and present the cluster map — the owner picks

Cluster the harvested labels by the role they describe (same judgment as the feed's distinct-role
count: "Harbour Pilot" and "harbour pilot " are one gap). Clustering happens in the session; there
is no clustering engine in the product and none should be built here.

Present the owner a cluster map, one row per cluster:

| Cluster (role words in the run's own phrasing) | Labels | **Distinct people** | Sources (target role / past job) | Recommendation |
|---|---|---|---|---|

- **Distinct people** = distinct non-null session links; count entries with no session (the eval
  harness) separately and say so.
- The recommendation is the agent's honest read: research / wait for more evidence / likely covered
  by an existing job family (a **family placement** that should not have gone unmapped is a labeler
  fault to report, not a vocabulary gap to research).
- **The owner picks which clusters get researched. There is no automatic threshold** — three people
  hitting one gap and one person retrying three times are different decisions, and both are the
  owner's.

## 3. Research each picked cluster

**The method below is normative** (#259, designed with the owner 2026-08-21). Before it existed, a
run's sampling was an accident of plumbing and its distillation was unwritten judgment: the pilot
read ~20 texts from two of four served markets because that is what two calls happened to return,
and "keep what recurs, drop employer-specific skills" lived only in the running agent's head. The
steps are in this order on purpose — each one's output is the next one's input.

### 3.1 Measure the market's words first

Served markets are the provider registry's `regionsServed` (today: HK, SG, VN, AU — read the
registry, not this sentence). For every served market, probe the job titles that market actually
uses for this work: one quoted title, one market, an advert count. A title measuring 0 adverts
cannot be published; `measuredOn` is the advert day the probe sampled.

**This step comes before the posting pull, not after it.** To fetch adverts you must search some job
title; if you pull first you are searching words you guessed, and the sample inherits the guess. Pull
second and each market is read through its own vocabulary.

Known blind spot, stated because it is unfixable rather than because it is small: the corpus only
ever contains adverts filed under a title someone thought to probe. Probe the cluster's own words,
the obvious seniority variants, and any title the first page of results reveals.

### 3.2 Read the whole market, not a sample

**Pull every advert each served market has, for every title that measured above 0.** Not a sample —
the market. The provider returns exactly 10 adverts per call (`TECHMAP_PAGE_SIZE`, a fixed vendor
constant), so a title measuring 29 adverts is 3 calls.

Business analysis, priced from the pilot's own probe figures, as the worked example:

| Market | Adverts across its titles | Calls |
|---|---|---|
| Singapore | 60 | 7 |
| Hong Kong | 33 | 4 |
| Australia | 24 | 3 |
| Vietnam | 3 | 1 |
| **Total** | **~120 adverts** | **15 calls — USD 0.15** |

Reading is not the constraint and money is not the constraint: 120 adverts is ~120 pages of text,
and 15 calls is 1.5% of the month's 1000. The constraint is what the market actually has — Vietnam
cannot supply 20 business-analyst adverts because it does not have 20.

- **Thin markets**: take what exists, and name the shortfall in the proposal. A market too thin to
  vote (see 3.3) still contributes its text.
- **The one cap — 50 adverts per title per market.** Not a reading limit. Past ~50 the demand counts
  stop moving: if 44 of 50 asked for a thing, adverts 51–300 will not change the decision. **If the
  counts are still moving at the cap, say so in the proposal** — a family whose adverts still
  disagree at 50 is drawn too wide, and that is a finding for the owner, not something to bury under
  more reading.
- **Keep the texts.** They are the **floor corpus** and they are kept, not discarded — see 3.4.

### 3.3 Distil the family floor

Count, then cut. Every judgment below is a number the owner can re-check.

**The threshold — two numbers doing different jobs:**

1. **On the floor if at least half the whole corpus asks for it.** The corpus is uneven by design
   (Singapore was half of the business-analysis corpus), so a whole-corpus fraction is the honest
   headline number.
2. **Off the floor if any market with 10 or more adverts is below 30%.** That is one market's local
   flavour, not the occupation. **Markets under 10 adverts inform the reading but do not vote** —
   one Vietnamese advert would otherwise be 33% of Vietnam. Name the non-voting markets in the
   proposal.

**Two rules on what counts:**

1. **A tool is judged by its demand count like anything else.** SQL for business analysis and Java
   for backend engineering clear the bar and belong on the floor; one bank's Copilot ask appears in
   1 advert of 120 and never does. There is no hand-written "skills aren't occupations" filter —
   when the count and a hand-written rule disagree, **the count wins**. But: **a tool never enters
   the family's `scope` sentence**, which is what decides membership. ADR-0015 carries the full
   shape and the one prompt property it depends on.
2. **Years, degrees, languages and locations are never floor items.** They clear any threshold —
   nearly every advert says "3–5 years" — and they are not the occupation. Length of experience is
   worked out, never asked (ADR-0014 amendment 1); the rest belong to other parts of the product.

**What the run produces: the full ranked list, every item that cleared the bar, each with its demand
count** — highest first. Not a top-4. **The floor's length is not yet decided** (#259 Q9/Q10, owner,
2026-08-21): no cap is written here, because no one has yet seen a real ranked list with real
numbers. The owner picks the cut looking at the curve. **Items that clear the bar and do not make
the cut stay in the proposal, marked as cut** — they are the natural first candidates for the next
version, and deleting them throws away paid-for evidence.

**If fewer than three items clear the bar, stop.** The adverts do not agree on what the work is: the
cluster is drawn too wide. Report that to the owner. **Do not lower the threshold to reach a
floor** — a floor reached by moving the bar is the exact failure #259 was filed to prevent.

**Question form:** yes/no by default — one tap, and "no" is a first-class explicit negative the
product never asks twice. Use options when the answer is genuinely graded: exposure to a tool is
("professional / study project / none"), an activity usually is not. The floor contract already
allows any option set and a `skills` CV destination, so this needs nothing built.

### 3.4 Keep the evidence the floor was distilled from

Three things, all in the proposal folder — **the published data file's shape does not change and no
gate is touched**, so the families already live stay live:

1. **The floor corpus** — the advert texts, in `docs/vocabulary-proposals/<family-id>-v<version>/corpus/`.
2. **The demand count beside every floor item**, in the summary: "requirements elicitation — 111 of
   120 adverts, all 4 markets".
3. **The items that cleared the bar and were cut**, with their counts.

Recording this in the *published* file was considered and rejected: the field would have to be
optional (the two live families' corpora are gone and cannot be reconstructed), and an optional
audit trail is a voluntary one.

### 3.5 Posting evidence for the published file

Separately from the corpus, the published file needs **3 or more distinct employers**: real, current
postings whose work is the cluster's role — employer, role title, location, source URL, capture
date, normalized requirements. Draw them from the corpus you already have; no extra calls. The gate
counts employers after trimming and case-folding, so three spellings of one employer are one
employer.

### 3.6 Budget

Pricing the probes and the corpus pull, concretely:

- Read `apps/api/data/posting-providers.json` **now** and price the planned calls from its
  `costModel` (e.g. techmap: USD 1 per 1000 postings) — before spending, not after.
- Quota: the same registry row carries `rateLimit.perMonth` (techmap: 1000 calls/month). The app's
  internal ledger is the `provider_monthly_calls` table, and it **drifts low** — calls made outside
  the app (this run's included) bypass it — so check the vendor's own dashboard too. Calls, not
  dollars, is usually the tighter cap.
- Keep a running count. At USD 10 or at the quota — whichever binds first — **stop**, write the
  receipt, and list per cluster what was not measured. An under-evidenced proposal is not submitted
  (the gates refuse it anyway; the refusals are rehearsed in
  `apps/api/test/vocabularyProposalRehearsal.test.ts`).

## 4. Draft one complete proposal package per cluster

A **vocabulary proposal** package is:

1. **The publication data file** — drafted by copying
   `apps/api/research/vocabulary-proposal-template.json` (a complete worked example that passes the
   real gates; every value gets replaced). Set `publicationStatus: "provisional"` in the draft —
   only the owner's approval flips it to `"published"`.
2. **A plain-language summary** the owner can decide on in one sitting: what the family covers and
   where its edge is, the evidence, the spend receipt, and what (if anything) the budget cut off.
3. **The alias list** — the job titles the family's own `scope` sentence names as inside it
   ("the agile equivalents of this job (scrum master, agile coach, delivery lead, release manager)
   are inside this family"). They go in the data file's `aliases` field, beside `marketSearchTitles`,
   and are approved with the rest of the package. **Drafted from the scope, never invented**: a hint
   word must trace to a boundary the owner already approved. They are **hint-only** — question 1's
   type-ahead matches them so a visitor typing one is offered the family's market titles, and that
   is all they ever do: never sent to a provider, never shown to the labeler, never gated on advert
   counts. Publishing is refused if an alias is already findable in another family (its aliases,
   label or market titles) — #258.
4. **For a new job family only: the drafted evaluation grid** — the data file's `rawCases`, restated
   in plain language for owner arbitration (ADR-0014: drafted by the agent, arbitrated by the
   owner; the grid stays as a permanent regression test at the bars ADR-0014 set).

Both proposal kinds, and the difference that matters:

- **New job family**: new `familyId`, `version: 1`, full package including the drafted grid.
- **New version widening an existing family**: same `familyId`, `version` = active version + 1,
  scope wording widened. **All served markets must be freshly re-measured — the gate refuses copied
  measurements** (each market's newest `measuredOn` must be strictly newer than the active
  version's; #244). Budget for that re-measurement when the owner picks the cluster.
- **Amending a live family in place, at the same version** (#258 decision 3): allowed for
  publication data that **cannot change a family placement** — the alias list is the case this rule
  was written for. Anything that CAN change a placement — scope, floor items, the family's boundary,
  its market words — is a new version through the normal gates, re-measurement included. The version
  number exists to protect stored placements (ADR-0014 decision 7); data no placement depends on
  does not need one, and a version bump would force a paid re-measurement for nothing.
- Neither kind ever touches a stored **family placement** — a published change reaches new
  placements only (ADR-0014 decision 7).

Park draft packages in `docs/vocabulary-proposals/<family-id>-v<version>/` (data file +
`summary.md` + the `corpus/` of §3.4) until the owner has decided.

## 5. Owner decision

Per proposal, exactly one of:

- **Approve** — the owner sets `publicationStatus: "published"`, and `reviewedBy` / `reviewedAt`
  name them and the moment. Continue to step 6.
- **Annotate and return** — the owner's notes go back to step 3/4 for that cluster; the spend
  already made counts against this run's cap.
- **Reject** — record the reason beside the parked draft; the cluster's labels still count as
  harvested (the gap was answered, the answer was no).

Nothing publishes without an approval. There is no third path.

## 6. Publish through the existing gates, unchanged

An approved proposal ships exactly the way the hand-published family did:

1. Move the data file to `apps/api/research/<family-id>-v<version>.json`.
2. New family: add its `store.publish(...)` load to `initialProductionFamilyFloors()`
   (`apps/api/src/familyFloors.ts`). A new version of a loaded family: point the existing load at
   the new file. **The gates themselves are never edited** — a run that finds itself modifying
   validation has left this runbook.
3. `pnpm test && pnpm typecheck` — the boot-time publish means a malformed package fails the suite
   here, before any deploy.
4. Commit, push when green. CI deploys `main` to staging; the publish happens at boot, behind every
   gate: reviewed status, 3+ distinct employers, search words for every served market with no
   0-advert titles, the evaluation regenerated and its thresholds met, monotonically increasing
   version, freshly re-measured market words on any re-publication.

From its next placement onward the labeler places into the new family; stored placements stay
untouched.

## 7. Closing checklist

Run it in this order, and record each outcome in the session log — the checklist is auditable, not
remembered:

1. **Find the family learning attempts the new family covers.** No listing route exists — read the
   `family_learning_attempts` table: `screening_outcome = 'accepted'`, status `research_started` or
   `validation_passed`, target role covered by the new family's scope.
2. **Check each attempt's session claim first**: `sessions.claimed_by_user_id` for the attempt's
   `session_id`.
3. **Claimed sessions** — progress the attempt through the existing operator progression, one event
   at a time (`POST /operator/family-learning/attempts/<id>/progress`, bearer
   `FAMILY_LEARNING_OPERATOR_KEY`), **starting from the attempt's current status**:
   `validation_passed` (only for attempts still at `research_started`), then `family_published`,
   then `fulfillment_evaluated` with the honest `relevantVacancy` answer. The credible-matches email
   (subject "Credible {target role} matches are ready") fires **only** behind that existing
   relevant-vacancy check and needs a live mail provider — matches, not homework. If no relevant
   vacancy exists yet, `relevantVacancy: false` resumes the search; the promise stays open, not
   broken. That `false` answer is one-shot: the attempt is now `search_resumed`, and a second
   `false` is an illegal transition (a 500) — once resumed, send `fulfillment_evaluated` again
   only when the answer is `true`.
4. **Unclaimed sessions are unnotifiable.** An attempt whose session was never claimed has no
   account email to keep the promise with. Progress it to `family_published` and **stop** — do not
   evaluate fulfillment for it: a `relevantVacancy: true` on an unclaimed session strands the
   attempt at `notification_pending`, a state with no exit until the session is claimed. List it
   in the run record as unnotifiable, so the gap between the promise and reality is visible to the
   owner rather than silently dropped.
5. **Record which attempts were progressed and which could not be**, and why.
6. **Mark the harvest**: `POST /ops/unmapped-labels/harvest?key=<OPS_KEY>` (answers
   `{marked, waiting}`). The waiting count drops to zero; every entry stays readable with its
   harvest time (nothing is ever deleted — owner decision 2026-08-20). Re-running marks nothing
   (`marked: 0`). The action marks **everything waiting at call time**, not the exact entries this
   run read — which is why it is the last step: a label recorded mid-run gets marked without being
   researched, and marking last keeps that window as small as it can be.
7. Update `roadmap.md` and `session-log.md` as usual.

---

## Appendix — the package's plain-language parts (template)

```markdown
# Vocabulary proposal: <family label> (v<version>)

**Kind**: new job family | new version widening <family-id> v<n>
**Cluster**: <role words> — <N> labels from <M> distinct people (<sources>)

## What this family covers, and where its edge is
<the data file's scope, in the summary's own words>

## Evidence
- Postings: <N> postings from <N distinct> employers (<names>)
- Market search words: <per served market: title — adverts, measured on>
- Not measured (budget): <list, or "nothing — the run stayed under cap">

## The floor corpus and its demand counts (§3.2-3.4)
- Corpus: <N> adverts — <per market: N adverts across "<titles>">; kept in `corpus/`
- Markets too thin to vote (under 10 adverts): <list, or "none">
- Cap bound at 50/title/market: <where, and whether counts were still moving — or "nowhere">

| # | Floor item | Demand count | Markets |
|---|---|---|---|
| 1 | <item> | <n> of <N> | <all 4 / which> |

- Cleared the bar, cut from the floor: <item — n of N>, … (or "nothing was cut")

## Evaluation grid (new family only — for owner arbitration)
<each rawCase in plain language: "<target role> should come back <confirmed /
needs clarification / unmapped> because <signals>">
(NB: "needs clarification" here is the evaluator's historical calibration bucket only —
#231 deleted it from the live family placement contract.)

## Spend receipt
- Calls: <n> · Dollars: USD <x.xx> (priced from posting-providers.json at spend time)
- Which limit bound: <calls | dollars | neither>
- Ledger note: calls made in this run bypass provider_monthly_calls; vendor dashboard read <date>

## Decision
- [ ] Approve   - [ ] Annotate and return   - [ ] Reject
```
