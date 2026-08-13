# Target locations — design spec (#124)

Decided 2026-08-13, resolving #124. Research base: `docs/research/target-location-selection.md`.
Governing decisions inherited (recorded on #124's comment trail): ADR-0001 rule 5 (a target
location is a **preference** — stored, listable, correctable, and nothing else), ADR-0004 clause 7
(the shape of a place: the words as typed, plus a resolved country when one matches), and #125's
type-ahead-over-a-known-list precedent.

## The shape, in one paragraph

The visitor selects **up to 3 target locations** as a saved preference, at **covered-market
granularity** (today: Hong Kong, Singapore, Vietnam, Australia). They type free text — a city,
alias, or country — and each entry resolves to its canonical market or is honestly refused with the
existing early-access coverage line. The deck is **one deck over the union** of the selected
markets, never one deck per market. **Remote is not a location** and is out of this ticket's scope.
The right-to-work question is asked **once per selected market**, exactly the per-market question
that already exists — up to 3 instances of it.

## Where it lives (no new screens)

### 1. The front door (intent step) — `apps/web/app/page.tsx`

The existing single "Search area" input becomes the **chips + type-ahead** widget the languages
question already ships (`lang-typeahead` in `apps/web/app/discovery/page.tsx`: removable chips
above a text input with suggestion buttons):

- **Completions** are the covered markets and their known aliases (the same vocabulary
  `resolveSearchArea` already matches: "Sydney" suggests **Australia**, "Kowloon" suggests
  **Hong Kong**). Chips always display the **canonical market name**, never the raw typed text —
  the same must-fix #184 recorded for the confirmation sentence.
- **An uncovered entry is refused, not kept.** This deliberately diverges from the languages
  widget's keep-unknown-words rule: a language outside the list is still a true fact about the
  person; an uncovered market is a place we cannot serve, and pretending to store it would break
  the server-side coverage gate #184 built. The existing coverage line renders per refused entry:
  *"JobCrush is in early access — we currently cover Hong Kong, Singapore, Vietnam and Australia."*
- **The cap reads out when reached**: with 3 chips placed, the input disables and a helper line
  says *"Three places is the limit — remove one to add another."* Removal is the chip's existing
  ✕ button.
- **The checkpoint advances on ≥1 covered market**, same server-side gate as today — one covered
  chip is enough to proceed; more are optional.
- The confirmation sentence pluralises: *"We'll look for {role} in Hong Kong and Vietnam."*
  (Oxford-less join, the existing `joinCoverage` convention.)
- The placeholder drops *"or Remote in Vietnam"* — remote is not a location (see Out of scope).

### 2. Discovery — right-to-work, per selected market

`eligibilityDiscovery.ts` already builds the city-scoped question *"Can you already work in {city}
without visa sponsorship?"* and stores the answer at that market's slug. The only change: it is
asked **once per selected market** instead of once for the single resolved city — up to 3
instances, sequenced in the same eligibility band, each closable/declinable independently. No new
question copy, no new store shape. Withdrawal (`withdrawal.ts`) needs **no change at all**: it
already matches each posting's own location region against whichever market-scoped answer applies,
and fails open when it cannot place a posting.

### 3. The profile rail — list and correct

Target locations appear on the profile rail as the same chips, editable through the same widget —
the #185 re-open-door pattern work-rights and languages already use. Removing a market removes its
preference; its work-rights answer **stays stored** (it's an answer to a different question, the
same survival rule a placed language level has) and simply stops applying until the market is
re-selected.

## Data shape (server)

- `intent.searchArea: string | null` → **`intent.searchAreas`**: up to 3 entries, each carrying
  the ADR-0004 place shape — the words as typed, the resolved `marketKey`, **and `statedAt`**
  (see the timestamp decision below). Back-compat: an existing single `searchArea` reads as a
  one-entry list; pre-launch, no migration.
- Retrieval: `resolveSearchAreaToRegions` over each entry, deck query = the **union** of region
  codes. `resolvedCityFor`'s single-city consumers take the list instead.

## The timestamp decision (the open edge nobody had decided)

**A preference carries `statedAt` — when we learned it — and nothing else from fact machinery.**
#139's resolution flagged this as undecided anywhere: preferences got none of clause 7's
correction/supersession machinery, yet a target location goes stale exactly like "Present" does —
he moved. One timestamp column is the entire cost, and it is what makes *"you said Hong Kong
eighteen months ago — still?"* possible later. No supersession chain, no provenance stamp, no
correction history: correcting a preference still just overwrites it. Decided here because #124 is
where it surfaced first; if a later ticket builds the staleness re-ask, `statedAt` is already there.

## Out of scope (recorded, not silently dropped)

- **Remote/hybrid** — the industry-converged model is a separate workplace-type axis (LinkedIn's
  on-site/hybrid/remote field; SEEK requires a location *even for* remote roles). It is not a
  location and does not spend one of the 3 slots. A future axis, its own ticket when postings
  carry the signal.
- **SEEK's auto-add-on-apply** (applying to a job in a new location silently adds it to your
  preferences) — noted as a future candidate; it is machine-adding-silently, which the owner
  philosophy forbids without a visible proposal, so if it ever comes it comes as a proposal.
- **Region entries ("APAC")** — not selectable as a target (LinkedIn bans continents too);
  postings stating only a region keep failing open in withdrawal, as today.
- **Sub-country targets** ("Sydney, not Melbourne") — the market list is the granularity until the
  posting corpus and provider registry go sub-country; a typed city resolves to its country, as
  `resolveSearchArea` already does.
